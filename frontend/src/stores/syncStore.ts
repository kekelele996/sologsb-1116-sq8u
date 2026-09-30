import { createStore } from 'zustand/vanilla'
import type { FungusRecord, SporePrint } from '@/types'
import type {
  BatchRecord,
  ConflictRow,
  FieldBatch,
  FieldGroup,
  MergePlan,
  ResolveSide
} from '@/types/sync'
import { BatchAlreadyMergedError } from '@/types/sync'
import { db, readLocalSnapshot, restoreSnapshot, syncAll } from '@/hooks/usePersistentStore'
import { applyResolution, buildMergePlan, parseFieldBatch } from '@/utils/sync'

export interface SyncState {
  batches: BatchRecord[]
  conflicts: ConflictRow[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 解析批次文件并与当前图谱库预检（不落库） */
  preview: (raw: unknown) => Promise<{ batch: FieldBatch; plan: MergePlan }>
  /** 导入并合并；失败自动回滚到本地上一版，返回是否曾回滚 */
  mergeBatch: (batch: FieldBatch) => Promise<{ plan: MergePlan; rolledBack: boolean }>
  /** 按外业批次这一侧重试此前失败的合并 */
  retryBatch: (batchId: string) => Promise<{ plan: MergePlan; rolledBack: boolean }>
  /** 逐条认：保存某冲突分组的裁决并落库 */
  resolveConflict: (conflictId: string, sides: Partial<Record<FieldGroup, ResolveSide>>) => Promise<void>
}

/** 锁定分组：鉴定留痕与采集点恒按图谱库，不可改判 */
const LOCKED_ATLAS_GROUPS: FieldGroup[] = ['point', 'identify']

function sideFor(conflict: ConflictRow, group: FieldGroup): ResolveSide {
  if (LOCKED_ATLAS_GROUPS.includes(group)) return 'atlas'
  return conflict.resolution[group] ?? 'field'
}

/**
 * 写入冲突条目的两版孢子印：当前生效那份关联到条目，另一份 recordId 置空挂起。
 * 两版都保留在库，改判时只改 recordId 指向即可来回切换、一条不多一条不丢。
 */
async function writeConflictSpores(
  tx: { table: (name: string) => { put: (row: SporePrint) => Promise<unknown> } },
  params: { activeSpore: SporePrint | null; sideRows: { id: string; row: SporePrint }[]; recordId: string }
): Promise<void> {
  for (const side of params.sideRows) {
    const linked = side.id === params.activeSpore?.id
    await tx.table('spores').put({ ...side.row, recordId: linked ? params.recordId : '' })
  }
}

/** 执行一次合并：单事务原子写入；任意一步失败都整体回滚 */
async function executeMerge(batch: FieldBatch): Promise<{ plan: MergePlan; rolledBack: boolean }> {
  const existing = await db.batches.get(batch.batchId)
  if (existing?.status === 'merged') {
    throw new BatchAlreadyMergedError(batch.batchId, existing.stats)
  }

  // 每次执行都基于「当前」图谱库重建计划：重试时按外业批次这一侧重新对齐
  const local = await readLocalSnapshot()
  const plan = buildMergePlan(batch, local)

  // 合并前先把本地上一版快照落到 mergeBackups，失败时据此兜底
  const backup = {
    batchId: batch.batchId,
    createdAt: new Date().toISOString(),
    snapshot: local
  }

  const batchRow: BatchRecord = {
    batchId: batch.batchId,
    exportedAt: batch.exportedAt,
    device: batch.device,
    note: batch.note,
    status: 'merged',
    importedAt: existing?.importedAt ?? new Date().toISOString(),
    mergedAt: new Date().toISOString(),
    stats: plan.stats,
    checksum: plan.checksum,
    payload: batch.payload
  }

  try {
    await db.transaction(
      'rw',
      [db.points, db.records, db.spores, db.identifies, db.batches, db.conflicts, db.mergeBackups],
      async (tx) => {
        await tx.table('mergeBackups').put(backup)

        // 新采集点入库（同 id 的图谱库已有点不动）
        for (const np of plan.newPoints) {
          await tx.table('points').put(np.source)
        }

        for (const item of plan.items) {
          if (item.kind === 'new') {
            // 图谱库缺号：外业整份入库（条目 + 孢子印 + 外业鉴定留痕）
            await tx.table<FungusRecord, string>('records').put(item.fieldRecord)
            if (item.fieldSpore) await tx.table<SporePrint, string>('spores').put(item.fieldSpore)
            for (const log of item.fieldIdentifies) {
              await tx.table('identifies').put(log)
            }
            continue
          }

          // 同号：形态/孢子印按裁决（默认外业），鉴定留痕/采集点按图谱库
          const conflict = plan.conflicts.find((c) => c.code === item.code)
          let finalRecord: FungusRecord = item.atlasRecord as FungusRecord
          let activeSpore: SporePrint | null = item.atlasSpore
          let parkedSideRows = false

          if (conflict) {
            const merged = applyResolution(conflict, (g) => sideFor(conflict, g))
            finalRecord = merged.record
            activeSpore = merged.activeSpore
            parkedSideRows = merged.sideRows.length > 0
            // 两版孢子印都保留：默认外业那份关联本条目，图谱库那份挂起
            await writeConflictSpores(tx, {
              activeSpore: merged.activeSpore,
              sideRows: merged.sideRows,
              recordId: finalRecord.id
            })
          } else if (item.fieldSpore && !item.atlasSpore) {
            // 图谱库原本没做孢子印：补登外业这份（主键关联到图谱库条目）
            activeSpore = { ...item.fieldSpore, recordId: finalRecord.id }
          }
          await tx.table<FungusRecord, string>('records').put(finalRecord)
          if (activeSpore && !parkedSideRows) {
            await tx.table<SporePrint, string>('spores').put(activeSpore)
          }
          // 同号更新不并入外业鉴定留痕，也不改写采集点 —— 这两侧恒按图谱库
        }

        // 两版都留着：冲突行 upsert（确定性主键，重试不产生重复行）
        for (const conflict of plan.conflicts) {
          const previous = await tx.table<ConflictRow, string>('conflicts').get(conflict.id)
          await tx.table('conflicts').put({
            ...conflict,
            // 已逐条认过的分组保留用户裁决，重试不把人的选择冲掉
            resolution: previous ? { ...conflict.resolution, ...previous.resolution } : conflict.resolution,
            status: previous?.status === 'resolved' ? 'resolved' : 'pending',
            resolvedAt: previous?.resolvedAt
          })
        }

        await tx.table('batches').put(batchRow)
      }
    )
    return { plan, rolledBack: false }
  } catch (error) {
    // 合并中途失败：先保住本地上一版，再把批次标记为失败以便重试
    await db.transaction('rw', [db.points, db.records, db.spores, db.identifies], async (tx) => {
      await restoreSnapshot(tx, backup.snapshot)
    })
    await db.transaction('rw', [db.batches, db.mergeBackups], async (tx) => {
      await tx.table('batches').put({
        ...batchRow,
        status: 'failed',
        mergedAt: undefined,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    throw error
  }
}

export const syncStore = createStore<SyncState>((set, get) => ({
  batches: [],
  conflicts: [],
  loaded: false,
  hydrate: async () => {
    const [batches, conflicts] = await Promise.all([syncAll<BatchRecord>(db.batches), syncAll<ConflictRow>(db.conflicts)])
    batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
    conflicts.sort((a, b) =>
      a.status === b.status ? a.code.localeCompare(b.code, 'zh-Hans-CN') : a.status === 'pending' ? -1 : 1
    )
    set({ batches, conflicts, loaded: true })
  },
  preview: async (raw) => {
    const batch = parseFieldBatch(raw)
    const local = await readLocalSnapshot()
    return { batch, plan: buildMergePlan(batch, local) }
  },
  mergeBatch: async (batch) => {
    const result = await executeMerge(batch)
    await get().hydrate()
    return result
  },
  retryBatch: async (batchId) => {
    const stored = await db.batches.get(batchId)
    if (!stored) throw new Error(`本地没有批次「${batchId}」的外业载荷，无法重试`)
    if (stored.status === 'merged') throw new BatchAlreadyMergedError(batchId, stored.stats)
    // 用保存下来的外业批次载荷重建批次对象，按外业这一侧重试
    const batch: FieldBatch = {
      format: 'gbfungiguide-field-batch',
      formatVersion: 1,
      batchId: stored.batchId,
      exportedAt: stored.exportedAt,
      device: stored.device,
      note: stored.note,
      payload: stored.payload
    }
    const result = await executeMerge(batch)
    await get().hydrate()
    return result
  },
  resolveConflict: async (id, sides) => {
    const conflict = get().conflicts.find((item) => item.id === id)
    if (!conflict) return
    const next: ConflictRow = {
      ...conflict,
      resolution: { ...conflict.resolution, ...sides },
      status: 'resolved',
      resolvedAt: new Date().toISOString()
    }
    const { record, activeSpore, sideRows } = applyResolution(next, (g) => sideFor(next, g))
    await db.transaction('rw', [db.records, db.spores, db.conflicts], async (tx) => {
      await tx.table<FungusRecord, string>('records').put(record)
      if (sideRows.length) {
        // 两版孢子印都保留在库：切换 recordId 指向，不删除任何一版
        await writeConflictSpores(tx, { activeSpore, sideRows, recordId: record.id })
      } else if (activeSpore) {
        await tx.table<SporePrint, string>('spores').put(activeSpore)
      }
      await tx.table<ConflictRow, string>('conflicts').put(next)
    })
    await get().hydrate()
  }
}))
