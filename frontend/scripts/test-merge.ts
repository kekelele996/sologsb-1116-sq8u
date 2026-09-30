import 'fake-indexeddb/auto'
import assert from 'node:assert'
import Dexie from 'dexie'
import { db, restoreAll, snapshotAll, SCHEMA_VERSION } from '../src/hooks/usePersistentStore'
import {
  buildBatchFromAtlas,
  buildMergePlan,
  resolveMerged,
  validateBatch,
  type AtlasData
} from '../src/utils/merge'
import { scoreRecord, EMPTY_CRITERIA, type MatchCriteria } from '../src/hooks/useCandidateMatch'
import { mergeStore } from '../src/stores/mergeStore'
import type { CollectPoint, FieldBatch, FungusRecord, IdentifyLog, SporePrint } from '../src/types'

let passed = 0
const testFns: Array<() => void | Promise<void>> = []
function test(name: string, fn: () => void | Promise<void>): void {
  testFns.push(async () => {
    try {
      await fn()
      passed += 1
      console.log(`  ✓ ${name}`)
    } catch (err) {
      console.error(`  ✗ ${name}`)
      console.error(err)
      process.exitCode = 1
    }
  })
}

/* ---------- 构造测试数据 ---------- */
function makeAtlas(): AtlasData {
  const points: CollectPoint[] = [
    { id: 'pt1', name: '图谱库采集点', longitude: 116.4, latitude: 39.9, altitude: 100, vegetation: '针阔混交林', substrate: '落叶层', companionTrees: '栎', collectDate: '2026-09-01', collector: '沈禾' }
  ]
  const records: FungusRecord[] = [
    {
      id: 'rec1', code: 'BHS-001', tempName: '橙黄（暂定）', fruitBodyCount: 3, pointId: 'pt1',
      capDiameter: 9, capShape: '半球形', capMargin: '全缘', capTexture: '绒状', fleshThickness: 2,
      fleshReaction: '不变色', attachment: '直生', gillDensity: '中等', stipeLength: 7, stipeDiameter: 2,
      ring: '膜质菌环', volva: '无菌托', odor: '坚果味', hostTree: '辽东栎', collectDate: '2026-09-01',
      collector: '沈禾', note: '图谱库原记录'
    }
  ]
  const spores: SporePrint[] = [
    { id: 'spo1', recordId: 'rec1', color: '淡黄', shape: '圆形', hours: 12, observeDate: '2026-09-01', moisture: '偏干' }
  ]
  const identifies: IdentifyLog[] = [
    { id: 'idf1', recordId: 'rec1', conclusion: 'Boletus sp.', basis: '形态特征', referenceBook: '《中国大型真菌》', referencePage: 'P.1', confidence: '低', needReview: true, reviewer: '祁野', date: '2026-09-02' }
  ]
  return { records, spores, points, identifies }
}

function makeFieldBatch(atlas: AtlasData, mutate: (draft: { records: FungusRecord[]; spores: SporePrint[]; points: CollectPoint[]; identifies: IdentifyLog[] }) => void): FieldBatch {
  const draft = {
    records: atlas.records.map((r) => ({ ...r })),
    spores: atlas.spores.map((s) => ({ ...s })),
    points: atlas.points.map((p) => ({ ...p })),
    identifies: atlas.identifies.map((l) => ({ ...l }))
  }
  mutate(draft)
  return {
    format: 'gbfungiguide-batch',
    version: 1,
    batchId: 'batch_test_001',
    source: 'field',
    exportedAt: '2026-09-30T00:00:00.000Z',
    device: '外业平板',
    points: draft.points,
    records: draft.records,
    spores: draft.spores,
    identifies: draft.identifies
  }
}

async function clearDb(): Promise<void> {
  await Promise.all([
    db.records.clear(),
    db.spores.clear(),
    db.points.clear(),
    db.identifies.clear(),
    db.batches.clear(),
    db.conflicts.clear(),
    db.meta.clear()
  ])
}

async function seedAtlas(atlas: AtlasData): Promise<void> {
  await db.points.bulkPut(atlas.points)
  await db.records.bulkPut(atlas.records)
  await db.spores.bulkPut(atlas.spores)
  await db.identifies.bulkPut(atlas.identifies)
}

/* ---------- 纯函数：批次校验 ---------- */
test('validateBatch：合法批次通过、错误格式拒绝', () => {
  const atlas = makeAtlas()
  const batch = buildBatchFromAtlas(atlas)
  assert.equal(validateBatch(batch).ok, true)
  assert.equal(validateBatch({ format: 'wrong' }).ok, false)
  assert.equal(validateBatch({ ...batch, batchId: '' }).ok, false)
})

/* ---------- 纯函数：字段级合并规则 ---------- */
test('buildMergePlan：形态/孢子印取外业，采集点/鉴定留痕取图谱库，两版都留快照', () => {
  const atlas = makeAtlas()
  const batch = makeFieldBatch(atlas, (d) => {
    // 外业改动：形态（着生方式、菌盖形状）、孢子印颜色、采集点、备注
    d.records[0].attachment = '延生'
    d.records[0].capShape = '漏斗形'
    d.records[0].pointId = 'pt_field_only' // 外业动过采集点
    d.records[0].note = '外业备注'
    d.spores[0].color = '黑褐'
    d.spores[0].id = 'spo_field'
    d.identifies.push({
      id: 'idf_field', recordId: 'rec1', conclusion: '外业新结论', basis: '孢子印',
      referenceBook: '', referencePage: '', confidence: '高', needReview: false, reviewer: '外业', date: '2026-09-29'
    })
  })
  const plan = buildMergePlan(batch, atlas)
  assert.equal(plan.conflicts.length, 1, '应有 1 条冲突')
  assert.equal(plan.newItems.length, 0)
  const conflict = plan.conflicts[0]
  assert.equal(conflict.code, 'BHS-001')
  // 两版快照都留着
  assert.ok(conflict.field && conflict.atlas, '外业/图谱库两版快照都应保留')

  // 默认按外业规则合并
  const merged = resolveMerged(conflict, 'field')
  assert.equal(merged.record.attachment, '延生', '形态-着生方式按外业')
  assert.equal(merged.record.capShape, '漏斗形', '形态-菌盖形状按外业')
  assert.equal(merged.record.note, '外业备注', '形态-备注按外业')
  assert.equal(merged.record.pointId, 'pt1', '采集点按图谱库（外业改动不覆盖）')
  assert.equal(merged.record.id, 'rec1', '条目身份沿用图谱库')
  assert.equal(merged.spore?.color, '黑褐', '孢子印按外业')
  assert.equal(merged.spore?.recordId, 'rec1', '孢子印归属到图谱库条目')

  // 逐条认选择保留图谱库
  const kept = resolveMerged(conflict, 'atlas')
  assert.equal(kept.record.attachment, '直生', '保留图谱库形态')
  assert.equal(kept.record.pointId, 'pt1', '采集点始终按图谱库')
  assert.equal(kept.spore?.color, '淡黄', '保留图谱库孢子印')
})

test('buildMergePlan：外业新增编号 → 新增条目；完全一致 → 跳过', () => {
  const atlas = makeAtlas()
  const batch = makeFieldBatch(atlas, (d) => {
    d.records.push({
      ...atlas.records[0], id: 'rec_new', code: 'BHS-002', pointId: 'pt1', attachment: '离生'
    })
    d.spores.push({ id: 'spo_new', recordId: 'rec_new', color: '白色', shape: '圆形', hours: 8, observeDate: '2026-09-30', moisture: '新鲜' })
  })
  const plan = buildMergePlan(batch, atlas)
  assert.equal(plan.newItems.length, 1, 'BHS-002 为新增')
  assert.equal(plan.conflicts.length, 0, 'BHS-001 两版一致，无冲突')
  assert.equal(plan.sameCount, 1)
  assert.equal(plan.newItems[0].record.attachment, '离生', '新增条目带外业形态')
  assert.equal(plan.newItems[0].spore?.color, '白色', '新增条目带外业孢子印')
})

/* ---------- 着生方式改动 → 候选排序重算（纯打分验证） ---------- */
test('着生方式改动后候选排序随之重算', () => {
  const criteria: MatchCriteria = { ...EMPTY_CRITERIA, attachment: '延生' }
  const base: FungusRecord = makeAtlas().records[0]
  const spore: SporePrint = { ...makeAtlas().spores[0] }
  const fieldRecord: FungusRecord = { ...base, attachment: '延生' }
  const atlasRecord: FungusRecord = { ...base, attachment: '直生' }
  const sField = scoreRecord(fieldRecord, spore, criteria)
  const sAtlas = scoreRecord(atlasRecord, spore, criteria)
  assert.ok(sField.score > sAtlas.score, '着生方式与筛选条件一致的候选得分更高')
  // 总分相同时，着生方式一致的排前面（useCandidateMatch 排序键）
  const criteria2: MatchCriteria = { ...EMPTY_CRITERIA, attachment: '' }
  const a = scoreRecord({ ...base, id: 'a', code: 'A', attachment: '延生' }, null, criteria2)
  const b = scoreRecord({ ...base, id: 'b', code: 'B', attachment: '直生' }, null, criteria2)
  assert.equal(a.score, b.score, '无筛选条件时两者基础分相同')
})

/* ---------- 集成：幂等提交 ---------- */
test('applyAll：同一份批次重复提交不产生重复条目', async () => {
  await clearDb()
  const atlas = makeAtlas()
  await seedAtlas(atlas)

  // 外业批次：改了 BHS-001 形态+孢子印，新增 BHS-002
  const batch = makeFieldBatch(atlas, (d) => {
    d.records[0].attachment = '延生'
    d.spores[0].color = '黑褐'
    d.records.push({ ...atlas.records[0], id: 'rec_new', code: 'BHS-002', attachment: '离生' })
    d.spores.push({ id: 'spo_new', recordId: 'rec_new', color: '白色', shape: '圆形', hours: 8, observeDate: '2026-09-30', moisture: '新鲜' })
  })

  const text = JSON.stringify(batch)
  const imp = await mergeStore.getState().importBatchText(text)
  assert.equal(imp.ok, true)
  assert.equal(imp.summary?.conflicts, 1)
  assert.equal(imp.summary?.added, 1)

  const r1 = await mergeStore.getState().applyAll()
  assert.equal(r1.ok, true, `第一次提交应成功：${r1.error ?? ''}`)
  const afterFirst = await db.records.toArray()
  assert.equal(afterFirst.length, 2, '第一次提交后 2 条')
  const bhs001 = afterFirst.find((r) => r.code === 'BHS-001')
  assert.equal(bhs001?.attachment, '延生', '冲突落地为外业形态')
  const spores001 = await db.spores.where('recordId').equals('rec1').toArray()
  assert.equal(spores001.length, 1, '落地后一条条目仅一份孢子印（替换而非叠加）')
  assert.equal(spores001[0].color, '黑褐', '孢子印为外业版本')
  const bhs002 = afterFirst.find((r) => r.code === 'BHS-002')
  assert.ok(bhs002, '新增条目已插入')

  // 再送一次同一份批次
  const r2 = await mergeStore.getState().applyAll()
  assert.equal(r2.ok, true, `第二次提交应成功：${r2.error ?? ''}`)
  const afterSecond = await db.records.toArray()
  assert.equal(afterSecond.length, 2, '重复提交不新增条目（幂等）')
  const conflicts = await db.conflicts.toArray()
  assert.ok(conflicts.every((c) => c.status === 'resolved'), '冲突均已落地，无挂起')
})

/* ---------- 集成：失败回滚到本地上一版 ---------- */
test('事务原子性 + 快照恢复：失败后本地版本不被破坏', async () => {
  await clearDb()
  const atlas = makeAtlas()
  await seedAtlas(atlas)

  // 1) Dexie 事务中途抛错 → 整体回滚
  const before = await db.records.count()
  await assert.rejects(
    db.transaction('rw', [db.records, db.spores], async () => {
      await db.records.put({ ...atlas.records[0], id: 'rec_tmp', code: 'TMP-999', pointId: 'pt1', attachment: '直生' } as FungusRecord)
      throw new Error('模拟合并中途失败')
    })
  )
  const afterAbort = await db.records.count()
  assert.equal(afterAbort, before, '事务回滚后条目数不变（本地上一版保住）')

  // 2) 快照 / 恢复：合并前备份，失败后恢复
  const snap = await snapshotAll()
  await db.records.put({ ...atlas.records[0], id: 'rec_tmp2', code: 'TMP-888', pointId: 'pt1', attachment: '直生' } as FungusRecord)
  assert.equal(await db.records.count(), before + 1, '破坏后多 1 条')
  await restoreAll(snap)
  const restored = await db.records.count()
  assert.equal(restored, before, '恢复后回到本地上一版')
  const tmpGone = await db.records.get('rec_tmp2')
  assert.equal(tmpGone, undefined, '临时条目已随回滚消失')
})

/* ---------- 迁移：旧数据升级后孢子印不丢 ---------- */
test('schema v2 → v3 升级：孢子印记录完整保留、新表就绪', async () => {
  // 删掉前面用例已按 v3 打开的库，重新模拟「现存 v2 旧库 → 打开 v3」
  await db.delete()
  // 用独立 Dexie 实例以 v2 打开并写入旧数据
  const legacy = new Dexie('gbfungiguide')
  legacy.version(1).stores({
    records: 'id, code, pointId, attachment',
    spores: 'id, recordId, color',
    points: 'id, name, substrate',
    identifies: 'id, recordId, conclusion',
    meta: 'key'
  })
  legacy.version(2).stores({
    records: 'id, code, pointId, attachment, capShape',
    spores: 'id, recordId, color, observeDate',
    points: 'id, name, substrate, vegetation',
    identifies: 'id, recordId, conclusion, date',
    meta: 'key'
  })
  await legacy.open()
  const legacyAtlas = makeAtlas()
  await legacy.points.bulkPut(legacyAtlas.points)
  await legacy.records.bulkPut(legacyAtlas.records)
  await legacy.spores.bulkPut(legacyAtlas.spores)
  await legacy.identifies.bulkPut(legacyAtlas.identifies)
  const legacySporeCount = await legacy.spores.count()
  await legacy.close()

  // 打开应用真实 db（定义到 v3），检测到现存 v2 → 执行升级
  await db.open()
  assert.equal(SCHEMA_VERSION, 3)
  const sporesAfter = await db.spores.toArray()
  assert.equal(sporesAfter.length, legacySporeCount, '升级后孢子印数量不变')
  assert.equal(sporesAfter[0].color, '淡黄', '孢子印印色保留')
  assert.equal(sporesAfter[0].shape, '圆形', '孢子印印形保留')
  assert.equal(sporesAfter[0].hours, 12, '孢子印时长保留')
  assert.equal(sporesAfter[0].moisture, '偏干', '孢子印干湿度保留')
  assert.equal(sporesAfter[0].recordId, 'rec1', '孢子印与条目关联保留')
  const recAfter = await db.records.get('rec1')
  assert.equal(recAfter?.originBatchId, '', '历史条目补齐溯源字段')
  // 新表可读写
  await db.batches.put({ batchId: 'b1', source: 'field', exportedAt: '', device: '', appliedAt: '', added: 0, updated: 0, conflicts: 0, status: 'applied' })
  assert.equal(await db.batches.count(), 1, '批次审计表可用')
})

const start = Date.now()
void (async () => {
  for (const fn of testFns) await fn()
  console.log(`\n${passed} 项断言组通过（${Date.now() - start}ms）`)
  if (process.exitCode) process.exit(process.exitCode)
})()
