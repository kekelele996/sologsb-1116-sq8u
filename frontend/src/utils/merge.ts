import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from '@/types'
import {
  BATCH_FORMAT,
  BATCH_VERSION,
  type BatchSide,
  type ConflictRow,
  type FieldBatch,
  type MergePlan
} from '@/types/batch'
import { uid } from './id'

/** 图谱库一侧的完整数据（合并引擎的输入） */
export interface AtlasData {
  records: FungusRecord[]
  spores: SporePrint[]
  points: CollectPoint[]
  identifies: IdentifyLog[]
}

/**
 * 形态字段（外业归属）：菌盖、菌肉、菌褶菌管（含着生方式）、菌柄、菌环菌托、
 * 气味、生境树种、子实体数量、暂定名、采集日期/人、备注。
 * 这些字段冲突时按外业那份算。
 */
export const FIELD_MORPHOLOGY_KEYS = [
  'tempName',
  'fruitBodyCount',
  'capDiameter',
  'capShape',
  'capMargin',
  'capTexture',
  'fleshThickness',
  'fleshReaction',
  'attachment',
  'gillDensity',
  'stipeLength',
  'stipeDiameter',
  'ring',
  'volva',
  'odor',
  'hostTree',
  'collectDate',
  'collector',
  'note'
] as const satisfies readonly (keyof FungusRecord)[]

/** 孢子印字段（外业归属）：冲突时按外业那份算 */
export const FIELD_SPORE_KEYS = ['color', 'shape', 'hours', 'observeDate', 'moisture'] as const

/** 采集点归属字段（图谱库归属）：pointId 不在形态字段里，冲突时按图谱库那份算 */

/** 生成批次幂等键 */
export function makeBatchId(): string {
  return uid('batch')
}

/** 由当前图谱库数据打包一个外业批次（供平板导出 / 离线登记） */
export function buildBatchFromAtlas(atlas: AtlasData, opts: { device?: string } = {}): FieldBatch {
  return {
    format: BATCH_FORMAT,
    version: BATCH_VERSION,
    batchId: makeBatchId(),
    source: 'field',
    exportedAt: new Date().toISOString(),
    device: opts.device ?? '',
    points: atlas.points,
    records: atlas.records,
    spores: atlas.spores,
    identifies: atlas.identifies
  }
}

export interface BatchValidation {
  ok: boolean
  error?: string
  batch?: FieldBatch
}

/** 校验导入的批次信封 */
export function validateBatch(data: unknown): BatchValidation {
  if (!data || typeof data !== 'object') return { ok: false, error: '文件内容不是有效的批次对象' }
  const b = data as Partial<FieldBatch>
  if (b.format !== BATCH_FORMAT) return { ok: false, error: `批次格式不正确，应为 ${BATCH_FORMAT}` }
  if (b.version !== BATCH_VERSION) return { ok: false, error: `批次版本不受支持：${String(b.version)}` }
  if (typeof b.batchId !== 'string' || !b.batchId.trim()) return { ok: false, error: '批次缺少 batchId' }
  if (b.source !== 'field') return { ok: false, error: '批次来源不是 field（外业）' }
  if (!Array.isArray(b.records)) return { ok: false, error: '批次缺少 records 数组' }
  if (!Array.isArray(b.spores)) return { ok: false, error: '批次缺少 spores 数组' }
  if (!Array.isArray(b.points)) return { ok: false, error: '批次缺少 points 数组' }
  if (!Array.isArray(b.identifies)) return { ok: false, error: '批次缺少 identifies 数组' }
  return { ok: true, batch: b as FieldBatch }
}

function sporeOf(spores: SporePrint[], recordId: string): SporePrint | null {
  return spores.find((item) => item.recordId === recordId) ?? null
}

function logsOf(logs: IdentifyLog[], recordId: string): IdentifyLog[] {
  return logs
    .filter((item) => item.recordId === recordId)
    .slice()
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
}

function pointOf(points: CollectPoint[], pointId: string): CollectPoint | null {
  return points.find((item) => item.id === pointId) ?? null
}

/** 孢子印可比较签名（用于判断孢子印是否被改动） */
function sporeSignature(spore: SporePrint | null): string {
  if (!spore) return '∅'
  return FIELD_SPORE_KEYS.map((key) => `${key}:${String(spore[key])}`).join('|')
}

/** 形态字段是否被改动 */
function morphologyChanged(field: FungusRecord, atlas: FungusRecord): boolean {
  return FIELD_MORPHOLOGY_KEYS.some((key) => String(field[key]) !== String(atlas[key]))
}

/** 构造某一侧（外业 / 图谱库）的完整快照 */
function buildSide(
  record: FungusRecord,
  allSpores: SporePrint[],
  allPoints: CollectPoint[],
  allLogs: IdentifyLog[]
): BatchSide {
  return {
    record,
    spore: sporeOf(allSpores, record.id),
    point: pointOf(allPoints, record.pointId),
    logs: logsOf(allLogs, record.id)
  }
}

/**
 * 按字段级规则计算冲突条目应落地的合并结果：
 * - 形态与孢子印：外业那份（choice=field）或图谱库那份（choice=atlas，逐条认时可改）
 * - 采集点（pointId）与鉴定留痕：始终按图谱库那份
 */
export function resolveMerged(conflict: ConflictRow, choice: 'field' | 'atlas'): {
  record: FungusRecord
  spore: SporePrint | null
} {
  const fieldSide = conflict.field
  const atlasSide = conflict.atlas
  const base = choice === 'field' ? fieldSide.record : atlasSide.record
  const record: FungusRecord = {
    ...base,
    // 条目身份与采集点始终沿用图谱库
    id: atlasSide.record.id,
    pointId: atlasSide.record.pointId,
    originBatchId: choice === 'field' ? conflict.batchId : atlasSide.record.originBatchId
  }
  let spore: SporePrint | null = null
  if (choice === 'field') {
    spore = fieldSide.spore ?? atlasSide.spore
  } else {
    spore = atlasSide.spore
  }
  if (spore) {
    spore = {
      ...spore,
      recordId: atlasSide.record.id,
      originBatchId: spore.originBatchId ?? (choice === 'field' ? conflict.batchId : undefined)
    }
  }
  return { record, spore }
}

/**
 * 合并外业批次与图谱库数据，生成合并计划（纯函数，不落库）。
 * 匹配的自然键是采集编号 code：
 * - 仅外业有 → 新增；
 * - 两边都有且形态/孢子印有差异 → 冲突（两版快照都留着）；
 * - 两边一致 → 跳过。
 */
export function buildMergePlan(batch: FieldBatch, atlas: AtlasData): MergePlan {
  const atlasByCode = new Map<string, FungusRecord>()
  for (const record of atlas.records) atlasByCode.set(record.code, record)

  const newItems: BatchSide[] = []
  const conflicts: ConflictRow[] = []
  let sameCount = 0

  for (const fieldRecord of batch.records) {
    const atlasRecord = atlasByCode.get(fieldRecord.code)
    if (!atlasRecord) {
      // 新增条目：外业的形态、孢子印、采集点、鉴定留痕一并带入
      newItems.push(buildSide(fieldRecord, batch.spores, batch.points, batch.identifies))
      continue
    }

    const fieldSide = buildSide(fieldRecord, batch.spores, batch.points, batch.identifies)
    const atlasSide = buildSide(atlasRecord, atlas.spores, atlas.points, atlas.identifies)

    const morphDiff = morphologyChanged(fieldRecord, atlasRecord)
    const sporeDiff = sporeSignature(fieldSide.spore) !== sporeSignature(atlasSide.spore)
    if (!morphDiff && !sporeDiff) {
      sameCount += 1
      continue
    }

    const base: ConflictRow = {
      id: uid('cf'),
      batchId: batch.batchId,
      code: fieldRecord.code,
      status: 'pending',
      field: fieldSide,
      atlas: atlasSide,
      merged: { record: atlasSide.record, spore: atlasSide.spore },
      choice: 'field',
      createdAt: new Date().toISOString()
    }
    base.merged = resolveMerged(base, 'field')
    conflicts.push(base)
  }

  const touchedCodes = new Set(batch.records.map((record) => record.code))
  const atlasOnlyCount = atlas.records.filter((record) => !touchedCodes.has(record.code)).length

  return {
    batchId: batch.batchId,
    exportedAt: batch.exportedAt,
    device: batch.device ?? '',
    newItems,
    conflicts,
    sameCount,
    atlasOnlyCount
  }
}

/** 冲突条目数统计 */
export function planCounts(plan: MergePlan): { new: number; conflicts: number; same: number } {
  return { new: plan.newItems.length, conflicts: plan.conflicts.length, same: plan.sameCount }
}
