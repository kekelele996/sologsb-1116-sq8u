import { afterEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import type { FungusRecord, SporePrint } from '@/types'
import { FungiGuideDb } from '@/hooks/usePersistentStore'

const DB_NAME = 'gbfungiguide-migration-test'

/**
 * 以 v1 结构打开一个老库并写入历史数据：
 * - 条目没有 fleshReaction（v1 时代字段）；
 * - 孢子印观察完整存在，升级后必须原样保留。
 */
async function seedVersion1(): Promise<void> {
  const old = new Dexie(DB_NAME)
  old.version(1).stores({
    records: 'id, code, pointId, attachment',
    spores: 'id, recordId, color',
    points: 'id, name, substrate',
    identifies: 'id, recordId, conclusion',
    meta: 'key'
  })
  const spores = old.table('spores') as Table<SporePrint, string>
  const records = old.table('records') as unknown as Table<Record<string, unknown>, string>
  await records.put({
    id: 'legacy_rec',
    code: 'OLD-2025-001',
    pointId: 'legacy_pt',
    attachment: '弯生'
    // 注意：没有 capShape、fleshReaction，模拟 v1 老数据
  })
  await spores.put({
    id: 'legacy_spo',
    recordId: 'legacy_rec',
    color: '粉褐',
    shape: '历史印形：不规则',
    hours: 20,
    observeDate: '2025-08-12',
    moisture: '历史干湿度备注'
  })
  await old.close()
}

const opened: Dexie[] = []

afterEach(async () => {
  await Promise.all(opened.map((d) => d.close()))
  await Dexie.delete(DB_NAME)
})

describe('v1 → v3 升级', () => {
  it('升级后历史孢子印记录一条都不丢，老条目补齐菌肉反应默认值', async () => {
    await seedVersion1()

    const upgraded = new FungiGuideDb(DB_NAME)
    opened.push(upgraded)
    await upgraded.open()
    expect(upgraded.verno).toBe(3)

    // 孢子印完整保留（核心诉求：旧数据升级后孢子印记录不能丢）
    const spo = await upgraded.spores.get('legacy_spo')
    expect(spo).toMatchObject({
      id: 'legacy_spo',
      recordId: 'legacy_rec',
      color: '粉褐',
      shape: '历史印形：不规则',
      hours: 20,
      observeDate: '2025-08-12',
      moisture: '历史干湿度备注'
    })

    // v2 迁移补的默认值仍在
    const rec = (await upgraded.records.get('legacy_rec')) as FungusRecord | undefined
    expect(rec?.fleshReaction).toBe('不变色')
    expect(rec?.code).toBe('OLD-2025-001')

    // 新表可用
    expect(await upgraded.batches.count()).toBe(0)
    expect(await upgraded.conflicts.count()).toBe(0)
    expect(await upgraded.mergeBackups.count()).toBe(0)
  })
})
