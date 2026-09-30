import { createStore } from 'zustand/vanilla'
import {
  db,
  restoreAll,
  snapshotAll,
  syncAll
} from '@/hooks/usePersistentStore'
import type { BatchAudit, ConflictRow, FieldBatch, MergeResult } from '@/types/batch'
import { buildMergePlan, resolveMerged, validateBatch, type AtlasData } from '@/utils/merge'
import { uid } from '@/utils/id'
import { downloadJson } from '@/utils/export'
import { identifyStore } from './identifyStore'
import { pointStore } from './pointStore'
import { recordStore } from './recordStore'
import { sporeStore } from './sporeStore'

/** 批次信封在 meta 表中的 key 前缀 */
const BATCH_META_PREFIX = 'batch:'

export interface MergeState {
  loaded: boolean
  importing: boolean
  applying: boolean
  /** 待逐条认的冲突（含已落地 / 已丢弃） */
  conflicts: ConflictRow[]
  /** 批次审计历史 */
  batches: BatchAudit[]
  /** 暂存的外业批次信封（batchId -> 信封），用于提交时插入新增条目 */
  envelopes: Record<string, FieldBatch>
  lastResult: MergeResult | null
  hydrate: () => Promise<void>
  exportBatch: () => Promise<void>
  importBatchText: (text: string) => Promise<{ ok: boolean; error?: string; summary?: ImportSummary }>
  setChoice: (conflictId: string, choice: 'field' | 'atlas') => Promise<void>
  discardConflict: (conflictId: string) => Promise<void>
  applyAll: () => Promise<MergeResult>
}

export interface ImportSummary {
  batchId: string
  added: number
  conflicts: number
  same: number
  alreadyApplied: boolean
}

/** 读取当前图谱库全量数据 */
async function readAtlas(): Promise<AtlasData> {
  const [records, spores, points, identifies] = await Promise.all([
    db.records.toArray(),
    db.spores.toArray(),
    db.points.toArray(),
    db.identifies.toArray()
  ])
  return { records, spores, points, identifies }
}

async function rehydrateAll(): Promise<void> {
  await Promise.all([
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    pointStore.getState().hydrate(),
    identifyStore.getState().hydrate()
  ])
}

/** 把外业批次信封存入 meta（JSON 字符串） */
async function putEnvelope(batch: FieldBatch): Promise<void> {
  await db.meta.put({ key: `${BATCH_META_PREFIX}${batch.batchId}`, value: JSON.stringify(batch) })
}

async function loadEnvelopes(): Promise<Record<string, FieldBatch>> {
  const rows = await db.meta.filter((row) => row.key.startsWith(BATCH_META_PREFIX)).toArray()
  const envelopes: Record<string, FieldBatch> = {}
  for (const row of rows) {
    try {
      const batch = JSON.parse(String(row.value)) as FieldBatch
      if (batch && batch.batchId) envelopes[batch.batchId] = batch
    } catch {
      // 损坏的信封忽略
    }
  }
  return envelopes
}

export const mergeStore = createStore<MergeState>((set, get) => ({
  loaded: false,
  importing: false,
  applying: false,
  conflicts: [],
  batches: [],
  envelopes: {},
  lastResult: null,

  hydrate: async () => {
    const [conflicts, batches, envelopes] = await Promise.all([
      syncAll<ConflictRow>(db.conflicts),
      syncAll<BatchAudit>(db.batches),
      loadEnvelopes()
    ])
    conflicts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    batches.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
    set({ conflicts, batches, envelopes, loaded: true })
  },

  /** 导出当前图谱库为外业批次 JSON（可放到平板 / 离线登记后带回） */
  exportBatch: async () => {
    const atlas = await readAtlas()
    const batch: FieldBatch = {
      format: 'gbfungiguide-batch',
      version: 1,
      batchId: uid('batch'),
      source: 'field',
      exportedAt: new Date().toISOString(),
      device: '图谱库导出',
      points: atlas.points.map((item) => ({ ...item })),
      records: atlas.records.map((item) => ({ ...item })),
      spores: atlas.spores.map((item) => ({ ...item })),
      identifies: atlas.identifies.map((item) => ({ ...item }))
    }
    const stamp = new Date().toISOString().slice(0, 10)
    downloadJson(`外业批次_${stamp}_${batch.batchId}.json`, batch)
  },

  /** 导入外业批次文本：校验 → 生成合并计划 → 暂存冲突，不覆盖任何数据 */
  importBatchText: async (text) => {
    set({ importing: true })
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return { ok: false, error: '文件不是合法 JSON' }
      }
      const validation = validateBatch(parsed)
      if (!validation.ok || !validation.batch) return { ok: false, error: validation.error }
      const batch = validation.batch

      const atlas = await readAtlas()
      const plan = buildMergePlan(batch, atlas)
      const alreadyApplied = get().batches.some((item) => item.batchId === batch.batchId)

      // 暂存批次信封（提交时据此插入新增条目）
      await putEnvelope(batch)
      // 暂存冲突（两版快照都留着）；同一批次重复导入时跳过已存在的冲突
      const existing = new Set((await syncAll<ConflictRow>(db.conflicts)).map((item) => `${item.batchId}:${item.code}`))
      const newConflicts = plan.conflicts.filter((item) => !existing.has(`${item.batchId}:${item.code}`))
      await db.conflicts.bulkPut(newConflicts)

      await get().hydrate()
      return {
        ok: true,
        summary: {
          batchId: batch.batchId,
          added: plan.newItems.length,
          conflicts: plan.conflicts.length,
          same: plan.sameCount,
          alreadyApplied
        }
      }
    } finally {
      set({ importing: false })
    }
  },

  /** 逐条认：选择 采用外业 / 保留图谱库（形态与孢子印），采集点与鉴定留痕始终按图谱库 */
  setChoice: async (conflictId, choice) => {
    const conflict = get().conflicts.find((item) => item.id === conflictId)
    if (!conflict) return
    const merged = resolveMerged(conflict, choice)
    await db.conflicts.update(conflictId, { choice, merged })
    set({
      conflicts: get().conflicts.map((item) => (item.id === conflictId ? { ...item, choice, merged } : item))
    })
  },

  discardConflict: async (conflictId) => {
    await db.conflicts.update(conflictId, { status: 'discarded' })
    set({
      conflicts: get().conflicts.map((item) => (item.id === conflictId ? { ...item, status: 'discarded' } : item))
    })
  },

  /**
   * 提交合并：单个 Dexie 读写事务，要么全部落地，要么整体回滚到本地上一版。
   * 幂等：按采集编号匹配，同一批次重复提交不会新增条目。
   */
  applyAll: async () => {
    set({ applying: true, lastResult: null })
    const startedAt = new Date().toISOString()
    let backup: Awaited<ReturnType<typeof snapshotAll>> | null = null
    try {
      backup = await snapshotAll()
      const pending = get().conflicts.filter((item) => item.status === 'pending')

      // 在事务内读取最新图谱库，避免闭包脏数据
      let added = 0
      let updated = 0
      await db.transaction(
        'rw',
        [db.records, db.spores, db.points, db.identifies, db.batches, db.conflicts],
        async () => {
          const atlasNow = await readAtlas()

          // 1) 落地冲突：形态/孢子印按逐条认结果，采集点/鉴定留痕按图谱库
          for (const conflict of pending) {
            const merged = resolveMerged(conflict, conflict.choice)
            await db.records.put(merged.record)
            // 孢子印：先清掉该条目旧孢子印，再放合并后的（保证一条条目一份孢子印）
            await db.spores.where('recordId').equals(merged.record.id).delete()
            if (merged.spore) await db.spores.put(merged.spore)
            await db.conflicts.update(conflict.id, { status: 'resolved' })
            updated += 1
          }

          // 2) 插入新增条目（逐批次信封重新规划，天然幂等：编号已存在则不再是新增）
          const pointIdMap = new Map<string, string>()
          for (const point of atlasNow.points) pointIdMap.set(point.id, point.id)
          // 事务内已处理编号集合：覆盖同一批次 / 多个信封含相同编号的去重
          const seenCodes = new Set<string>(atlasNow.records.map((record) => record.code))

          for (const batch of Object.values(get().envelopes)) {
            const plan = buildMergePlan(batch, atlasNow)
            for (const side of plan.newItems) {
              if (seenCodes.has(side.record.code)) continue
              seenCodes.add(side.record.code)
              // 采集点：已存在则沿用图谱库；外业带来的新采集点才新建并 remap
              let pointId = side.record.pointId
              if (pointId && !pointIdMap.has(pointId)) {
                if (side.point) {
                  const newPointId = uid('pt')
                  pointIdMap.set(pointId, newPointId)
                  await db.points.put({ ...side.point, id: newPointId, originBatchId: batch.batchId })
                  pointId = newPointId
                } else {
                  pointId = ''
                }
              } else if (pointId) {
                pointId = pointIdMap.get(pointId) ?? pointId
              }

              const newRecordId = uid('rec')
              await db.records.put({
                ...side.record,
                id: newRecordId,
                pointId,
                originBatchId: batch.batchId
              })
              added += 1

              if (side.spore) {
                await db.spores.put({
                  ...side.spore,
                  id: uid('spo'),
                  recordId: newRecordId,
                  originBatchId: batch.batchId
                })
              }

              for (const log of side.logs) {
                await db.identifies.put({
                  ...log,
                  id: uid('idf'),
                  recordId: newRecordId,
                  originBatchId: batch.batchId
                })
              }
            }
          }

          // 3) 批次审计（幂等键 batchId）
          for (const batch of Object.values(get().envelopes)) {
            const already = await db.batches.get(batch.batchId)
            const audit: BatchAudit = {
              batchId: batch.batchId,
              source: 'field',
              exportedAt: batch.exportedAt,
              device: batch.device ?? '',
              appliedAt: startedAt,
              added,
              updated,
              conflicts: pending.filter((item) => item.batchId === batch.batchId).length,
              status: 'applied'
            }
            if (already) {
              await db.batches.update(batch.batchId, {
                appliedAt: startedAt,
                added,
                updated,
                status: 'applied'
              })
            } else {
              await db.batches.put(audit)
            }
          }

          return { added, updated }
        }
      )

      // 事务成功：刷新各 store（着生方式等改动会触发候选排序重算）
      await rehydrateAll()
      await get().hydrate()
      const result: MergeResult = {
        ok: true,
        batchId: '',
        added,
        updated,
        conflicts: pending.length
      }
      set({ lastResult: result })
      return result
    } catch (err) {
      // 失败：Dexie 事务已自动回滚；再显式恢复到本地上一版，双保险
      if (backup) {
        try {
          await restoreAll(backup)
        } catch {
          // 恢复失败也保留原事务回滚结果
        }
      }
      const message = err instanceof Error ? err.message : String(err)
      const result: MergeResult = {
        ok: false,
        batchId: '',
        added: 0,
        updated: 0,
        conflicts: 0,
        error: message
      }
      set({ lastResult: result })
      // 记录失败审计（单独事务，不影响回滚结果）
      try {
        for (const batch of Object.values(get().envelopes)) {
          await db.batches.put({
            batchId: batch.batchId,
            source: 'field',
            exportedAt: batch.exportedAt,
            device: batch.device ?? '',
            appliedAt: startedAt,
            added: 0,
            updated: 0,
            conflicts: 0,
            status: 'failed',
            error: message
          })
        }
      } catch {
        // 审计写入失败可忽略
      }
      return result
    } finally {
      set({ applying: false })
    }
  }
}))
