import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from '@/types'
import type { FieldBatch } from '@/types/sync'
import { FIELD_BATCH_FORMAT } from '@/types/sync'
import { db } from '@/hooks/usePersistentStore'
import { syncStore } from '@/stores/syncStore'
import { parseFieldBatch } from '@/utils/sync'

type AnyTable = { name: string; put: (...args: unknown[]) => Promise<unknown> }
const TABLE_PROTO = Object.getPrototypeOf(db.spores) as AnyTable
const TODAY = '2026-09-30'
// 仅保存方法引用，绝不 bind：调用时 this 必须仍是具体的 Table 实例
const ORIGINAL_PUT = TABLE_PROTO.put

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'pt_local',
    name: '本地采集点',
    longitude: 115.6,
    latitude: 39.8,
    altitude: 1400,
    vegetation: '针阔混交林',
    substrate: '落叶层',
    companionTrees: '辽东栎',
    collectDate: TODAY,
    collector: '驻地',
    ...over
  }
}

function record(over: Partial<FungusRecord> = {}): FungusRecord {
  return {
    id: 'rec_1',
    code: 'BHS-2026-001',
    tempName: '本地暂定名',
    fruitBodyCount: 3,
    pointId: 'pt_local',
    capDiameter: 9,
    capShape: '半球形',
    capMargin: '全缘',
    capTexture: '绒状',
    fleshThickness: 2,
    fleshReaction: '不变色',
    attachment: '直生',
    gillDensity: '中等',
    stipeLength: 7,
    stipeDiameter: 2,
    ring: '无菌环',
    volva: '无菌托',
    odor: '无',
    hostTree: '辽东栎',
    collectDate: TODAY,
    collector: '驻地',
    note: '',
    ...over
  }
}

function spore(over: Partial<SporePrint> = {}): SporePrint {
  return {
    id: 'spo_1',
    recordId: 'rec_1',
    color: '淡黄',
    shape: '本地印形',
    hours: 12,
    observeDate: TODAY,
    moisture: '本地干湿度',
    ...over
  }
}

function identify(over: Partial<IdentifyLog> = {}): IdentifyLog {
  return {
    id: 'idf_1',
    recordId: 'rec_1',
    conclusion: 'Atlas conclusion',
    basis: '形态特征',
    referenceBook: '本地图鉴',
    referencePage: 'P.1',
    confidence: '高',
    needReview: false,
    reviewer: '驻地复核人',
    date: TODAY,
    ...over
  }
}

function fieldBatch(over: {
  batchId?: string
  records?: FungusRecord[]
  spores?: SporePrint[]
  points?: CollectPoint[]
  identifies?: IdentifyLog[]
} = {}): FieldBatch {
  return {
    format: FIELD_BATCH_FORMAT,
    formatVersion: 1,
    batchId: over.batchId ?? 'BATCH-001',
    exportedAt: new Date().toISOString(),
    device: 'tablet-7',
    payload: {
      points: over.points ?? [point()],
      records: over.records ?? [
        record({
          id: 'field_rec_1',
          attachment: '离生', // 外业改了着生方式
          capShape: '中凹',
          odor: '外业杏仁味',
          pointId: 'pt_local'
        })
      ],
      spores: over.spores ?? [
        spore({
          id: 'field_spo_1',
          recordId: 'field_rec_1',
          color: '紫褐' // 外业改了孢子印
        })
      ],
      identifies: over.identifies ?? [
        identify({
          id: 'field_idf_1',
          recordId: 'field_rec_1',
          conclusion: 'FIELD-ONLY-LOG'
        })
      ]
    }
  }
}

beforeEach(async () => {
  await db.points.clear()
  await db.records.clear()
  await db.spores.clear()
  await db.identifies.clear()
  await db.batches.clear()
  await db.conflicts.clear()
  await db.mergeBackups.clear()
})

afterEach(async () => {
  TABLE_PROTO.put = ORIGINAL_PUT
  // 切断 store 与旧库行的隐式关联，保持用例独立
  await syncStore.getState().hydrate()
})

describe('外业批次合并', () => {
  it('同号两边都动过：形态与孢子印按外业，鉴定留痕与采集点按图谱库', async () => {
    await db.points.put(point())
    await db.records.put(record())
    await db.spores.put(spore())
    await db.identifies.put(identify())

    const { plan } = await syncStore.getState().mergeBatch(parseFieldBatch(fieldBatch()))

    expect(plan.stats.updated).toBe(1)
    expect(plan.stats.conflicts).toBeGreaterThan(0)

    const merged = await db.records.get('rec_1')
    expect(merged?.attachment).toBe('离生') // 形态按外业
    expect(merged?.capShape).toBe('中凹')
    expect(merged?.odor).toBe('外业杏仁味')
    expect(merged?.pointId).toBe('pt_local') // 采集点按图谱库，未被带成外业点

    const mergedSpore = await db.spores.where('recordId').equals('rec_1').first()
    expect(mergedSpore?.color).toBe('紫褐') // 孢子印默认按外业（生效那份关联本条目）
    expect(mergedSpore?.recordId).toBe('rec_1')

    // 图谱库那版孢子印也没丢：作为挂起行保留（recordId 置空），逐条认时可接回
    const parked = (await db.spores.toArray()).find((s) => s.color === '淡黄')
    expect(parked?.recordId).toBe('')
    expect(await db.spores.count()).toBe(2) // 两版都留着，不多不少

    const logs = await db.identifies.where('recordId').equals('rec_1').toArray()
    expect(logs.map((l) => l.conclusion)).toEqual(['Atlas conclusion']) // 外业留痕未并入
    const pointRow = await db.points.get('pt_local')
    expect(pointRow?.name).toBe('本地采集点') // 图谱库采集点未被覆盖
  })

  it('两版完整快照都留着，可逐条改判：形态改取图谱库后落库', async () => {
    await db.points.put(point())
    await db.records.put(record())
    await db.spores.put(spore())
    await syncStore.getState().mergeBatch(parseFieldBatch(fieldBatch()))

    const conflicts = await db.conflicts.toArray()
    const conflict = conflicts.find((c) => c.code === 'BHS-2026-001')
    expect(conflict).toBeTruthy()
    expect(conflict?.atlasVersion.record.attachment).toBe('直生')
    expect(conflict?.fieldVersion.record.attachment).toBe('离生')
    expect(conflict?.atlasVersion.spore?.color).toBe('淡黄')
    expect(conflict?.fieldVersion.spore?.color).toBe('紫褐')
    expect(conflict?.status).toBe('pending')

    // 逐条认：形态改判为图谱库
    await syncStore.getState().resolveConflict(conflict!.id, { morphology: 'atlas' })

    const after = await db.records.get('rec_1')
    expect(after?.attachment).toBe('直生') // 形态回到图谱库
    expect(after?.capShape).toBe('半球形')
    const afterSpore = await db.spores.where('recordId').equals('rec_1').first()
    expect(afterSpore?.color).toBe('紫褐') // 孢子印仍按外业（分组独立裁决）

    // 孢子印分组改判为图谱库：生效那份切回淡黄，外业紫褐挂起但不丢
    await syncStore.getState().resolveConflict(conflict!.id, { spore: 'atlas' })
    const atlasSporeNow = await db.spores.where('recordId').equals('rec_1').first()
    expect(atlasSporeNow?.color).toBe('淡黄')
    expect((await db.spores.toArray()).find((s) => s.color === '紫褐')?.recordId).toBe('')

    // 再切回外业：紫褐重新生效，总数仍为两版（不产生新条目）
    await syncStore.getState().resolveConflict(conflict!.id, { spore: 'field' })
    const fieldSporeNow = await db.spores.where('recordId').equals('rec_1').first()
    expect(fieldSporeNow?.color).toBe('紫褐')
    expect(await db.spores.count()).toBe(2)

    const updatedConflict = await db.conflicts.get(conflict!.id)
    expect(updatedConflict?.status).toBe('resolved')
  })

  it('同一份批次再送一次不多出条目（幂等）', async () => {
    await db.points.put(point())
    await db.records.put(record())
    await db.spores.put(spore())
    await db.identifies.put(identify())

    const batch = parseFieldBatch(fieldBatch())
    await syncStore.getState().mergeBatch(batch)

    await expect(syncStore.getState().mergeBatch(batch)).rejects.toThrow(/已合并过/)

    expect(await db.records.count()).toBe(1)
    expect(await db.spores.count()).toBe(2) // 两版孢子印各留一行
    expect(await db.identifies.count()).toBe(1)
    expect(await db.batches.count()).toBe(1)
    expect(await db.conflicts.count()).toBe(1)
  })

  it('图谱库缺号的新条目整份入库，含新采集点、孢子印与外业鉴定留痕', async () => {
    const batch = parseFieldBatch(
      fieldBatch({
        points: [point({ id: 'pt_new_field', name: '外业新点' })],
        records: [
          record({
            id: 'field_new_rec',
            code: 'FIELD-2026-009',
            pointId: 'pt_new_field',
            attachment: '延生'
          })
        ],
        spores: [spore({ id: 'field_new_spo', recordId: 'field_new_rec' })],
        identifies: [identify({ id: 'field_new_idf', recordId: 'field_new_rec', conclusion: 'NEW-LOG' })]
      })
    )
    const { plan } = await syncStore.getState().mergeBatch(batch)

    expect(plan.stats.inserted).toBe(1)
    const rows = await db.records.where('code').equals('FIELD-2026-009').toArray()
    expect(rows).toHaveLength(1)
    const newRec = rows[0]
    expect(newRec.id).not.toBe('field_new_rec') // 主键被归一为确定性 fid
    expect(await db.points.get(newRec.pointId)).toMatchObject({ name: '外业新点' })
    const newSpores = await db.spores.where('recordId').equals(newRec.id).toArray()
    expect(newSpores).toHaveLength(1)
    const newLogs = await db.identifies.where('recordId').equals(newRec.id).toArray()
    expect(newLogs.map((l) => l.conclusion)).toEqual(['NEW-LOG'])
  })

  it('合并中途失败先保住本地上一版，并可按外业侧重试成功', async () => {
    await db.points.put(point())
    await db.records.put(record())
    await db.spores.put(spore())
    await db.identifies.put(identify())

    // 制造一次必失败：在 Table.prototype.put 上拦截「孢子印表」的写入。
    // 合并事务内用的是 tx.table('spores') 新建的 Table 实例，只能在原型层拦截。
    const protoPut = ORIGINAL_PUT
    let failOnce = true
    TABLE_PROTO.put = function patchedPut(this: AnyTable, ...args: unknown[]) {
      if (failOnce && this.name === 'spores') {
        failOnce = false
        throw new Error('模拟写入中断')
      }
      return protoPut.apply(this, args as never[])
    }

    const batch = parseFieldBatch(fieldBatch({ batchId: 'BATCH-FAIL' }))
    await expect(syncStore.getState().mergeBatch(batch)).rejects.toThrow('模拟写入中断')
    TABLE_PROTO.put = ORIGINAL_PUT

    // 本地上一版完好
    const intact = await db.records.get('rec_1')
    expect(intact?.attachment).toBe('直生')
    const intactSpore = await db.spores.get('spo_1')
    expect(intactSpore?.color).toBe('淡黄')

    // 批次被标记为失败，保留外业载荷
    const failedRow = await db.batches.get('BATCH-FAIL')
    expect(failedRow?.status).toBe('failed')
    expect(failedRow?.error).toContain('模拟写入中断')

    // 按外业批次这一侧重试 → 成功，且条目只一条、孢子印两版各一行
    const { plan } = await syncStore.getState().retryBatch('BATCH-FAIL')
    expect(plan.stats.updated).toBe(1)
    expect(await db.records.count()).toBe(1)
    expect(await db.spores.count()).toBe(2)
    expect((await db.records.get('rec_1'))?.attachment).toBe('离生')
    expect((await db.spores.where('recordId').equals('rec_1').first())?.color).toBe('紫褐')
    expect((await db.batches.get('BATCH-FAIL'))?.status).toBe('merged')
  })

  it('外业未做孢子印而图谱库有：保留图谱库孢子印，不产生冲突', async () => {
    await db.points.put(point())
    await db.records.put(record())
    await db.spores.put(spore())

    const batch = parseFieldBatch(
      fieldBatch({
        spores: [],
        records: [record({ id: 'field_rec_1', attachment: '离生', pointId: 'pt_local' })]
      })
    )
    const { plan } = await syncStore.getState().mergeBatch(batch)
    expect(plan.conflicts.every((c) => !c.groups.includes('spore'))).toBe(true)
    expect((await db.spores.get('spo_1'))?.color).toBe('淡黄')
  })
})
