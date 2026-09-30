import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from '@/types'

/** 外业批次文件格式标识 */
export const FIELD_BATCH_FORMAT = 'gbfungiguide-field-batch'
export const FIELD_BATCH_FORMAT_VERSION = 1

/** 冲突分组：形态 / 孢子印按外业，采集点 / 鉴定留痕按图谱库 */
export type FieldGroup = 'morphology' | 'spore' | 'point' | 'identify'
/** 裁决选择的一侧 */
export type ResolveSide = 'field' | 'atlas'

export const FIELD_GROUPS: { key: FieldGroup; label: string; defaultSide: ResolveSide; locked: boolean; hint: string }[] = [
  { key: 'morphology', label: '形态描述', defaultSide: 'field', locked: false, hint: '默认按外业那份' },
  { key: 'spore', label: '孢子印', defaultSide: 'field', locked: false, hint: '默认按外业那份' },
  { key: 'point', label: '采集点', defaultSide: 'atlas', locked: true, hint: '按图谱库那份，不可改判' },
  { key: 'identify', label: '鉴定留痕', defaultSide: 'atlas', locked: true, hint: '按图谱库那份，外业留痕不并入' }
]

/**
 * 形态分组字段：除主键 id、采集编号 code、采集点 pointId 之外的全部条目字段。
 * 同号两边都动过时，这一整组默认按外业那份算。
 */
export const MORPH_FIELDS = [
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
] as const
export type MorphField = (typeof MORPH_FIELDS)[number]

/** 字段中文名（冲突对照与逐条认界面使用） */
export const FIELD_LABELS: Partial<Record<keyof FungusRecord, string>> = {
  code: '采集编号',
  tempName: '暂定名',
  fruitBodyCount: '子实体数量',
  pointId: '采集点',
  capDiameter: '菌盖直径(cm)',
  capShape: '菌盖形状',
  capMargin: '菌盖边缘',
  capTexture: '表面质地',
  fleshThickness: '菌肉厚度(cm)',
  fleshReaction: '菌肉变色反应',
  attachment: '着生方式',
  gillDensity: '菌褶密度',
  stipeLength: '菌柄长度(cm)',
  stipeDiameter: '菌柄直径(cm)',
  ring: '菌环',
  volva: '菌托',
  odor: '气味',
  hostTree: '关联树种',
  collectDate: '采集日期',
  collector: '采集人',
  note: '备注'
}

/** 孢子印可对照字段 */
export const SPORE_FIELDS = ['color', 'shape', 'hours', 'observeDate', 'moisture'] as const
export const SPORE_FIELD_LABELS: Record<string, string> = {
  color: '印色',
  shape: '印形',
  hours: '获取时长(h)',
  observeDate: '观察日期',
  moisture: '样本干湿度'
}

/* ---------- 外业批次文件 ---------- */

export interface FieldBatchPayload {
  points: CollectPoint[]
  records: FungusRecord[]
  spores: SporePrint[]
  identifies: IdentifyLog[]
}

export interface FieldBatchMeta {
  /** 外业批次号：同一批次重复送合并的幂等键 */
  batchId: string
  exportedAt: string
  /** 导出设备（同伴的平板标识） */
  device?: string
  note?: string
}

export interface FieldBatch extends FieldBatchMeta {
  format: typeof FIELD_BATCH_FORMAT
  formatVersion: number
  payload: FieldBatchPayload
}

/* ---------- 合并预检计划（纯函数产物） ---------- */

export interface FieldDiff {
  group: FieldGroup
  key: string
  label: string
  atlas: unknown
  field: unknown
}

/** 冲突行中两侧的完整快照，保证「两版都留着」可随时改判 */
export interface ConflictVersion {
  record: FungusRecord
  spore: SporePrint | null
  identifies: IdentifyLog[]
  point: CollectPoint | null
}

export type ConflictStatus = 'pending' | 'resolved'

export interface ConflictRow {
  /** 由 批次号+采集编号 确定性生成，重试不产生重复冲突行 */
  id: string
  batchId: string
  code: string
  /** 图谱库条目 id */
  recordId: string
  groups: FieldGroup[]
  diffs: FieldDiff[]
  /** 各分歧分组的裁决；形态/孢子印可逐条改判，采集点/鉴定锁定图谱库 */
  resolution: Partial<Record<FieldGroup, ResolveSide>>
  status: ConflictStatus
  atlasVersion: ConflictVersion
  fieldVersion: ConflictVersion
  /** 外业孢子印落库行主键：有孢子印分歧时图谱库原印保留，外业印另存，改判可回退 */
  fieldSporeRowId?: string
  createdAt: string
  resolvedAt?: string
}

export interface MergeItem {
  code: string
  /** new=图谱库没有该采集编号；update=同号 */
  kind: 'new' | 'update'
  fieldRecord: FungusRecord
  atlasRecord?: FungusRecord
  fieldSpore: SporePrint | null
  atlasSpore: SporePrint | null
  fieldIdentifies: IdentifyLog[]
  atlasIdentifies: IdentifyLog[]
  fieldPoint: CollectPoint | null
  atlasPoint: CollectPoint | null
}

export interface MergeStats {
  total: number
  inserted: number
  updated: number
  conflicts: number
  pointsInserted: number
  sporesInserted: number
  sporesReplaced: number
  identifiesImported: number
}

export interface MergePlan {
  batchId: string
  checksum: string
  items: MergeItem[]
  /** 图谱库中不存在、需要随批次入库的采集点（外业点 id → 入库 id） */
  newPoints: { source: CollectPoint; targetId: string }[]
  conflicts: ConflictRow[]
  stats: MergeStats
}

/* ---------- Dexie 落库行 ---------- */

export type BatchStatus = 'imported' | 'merged' | 'failed'

export interface BatchRecord extends FieldBatchMeta {
  status: BatchStatus
  importedAt: string
  mergedAt?: string
  error?: string
  stats?: MergeStats
  checksum?: string
  /** 保留批次载荷，合并中途失败后按外业批次这一侧重试 */
  payload: FieldBatchPayload
}

export interface MergeBackup {
  /** 即 batchId，每个批次只保留最近一次合并前快照 */
  batchId: string
  createdAt: string
  snapshot: FieldBatchPayload
  restoredAt?: string
}

export class BatchAlreadyMergedError extends Error {
  stats: MergeStats | undefined
  constructor(batchId: string, stats?: MergeStats) {
    super(`批次「${batchId}」已合并过，重复送合并不会多出条目`)
    this.name = 'BatchAlreadyMergedError'
    this.stats = stats
  }
}
