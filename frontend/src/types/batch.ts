import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from './index'

/** 外业批次信封格式标识 */
export const BATCH_FORMAT = 'gbfungiguide-batch'
/** 外业批次信封版本 */
export const BATCH_VERSION = 1

/** 外业批次：平板离线登记后导出、回到驻地合并进图谱库的自包含数据包 */
export interface FieldBatch {
  format: typeof BATCH_FORMAT
  version: number
  /** 批次幂等键：同一批次重复导入不产生重复条目 */
  batchId: string
  /** 来源标记：外业 */
  source: 'field'
  /** 导出时间（ISO 字符串） */
  exportedAt: string
  /** 采集人 / 设备备注 */
  device?: string
  points: CollectPoint[]
  records: FungusRecord[]
  spores: SporePrint[]
  identifies: IdentifyLog[]
}

/** 批次内一侧（外业 / 图谱库）的完整快照 */
export interface BatchSide {
  record: FungusRecord
  spore: SporePrint | null
  point: CollectPoint | null
  logs: IdentifyLog[]
}

/** 冲突条目：同一采集编号两边都动过，两版快照都留下供逐条认 */
export interface ConflictRow {
  id: string
  batchId: string
  /** 采集编号（两边匹配的自然键） */
  code: string
  status: 'pending' | 'resolved' | 'discarded'
  /** 外业版本 */
  field: BatchSide
  /** 图谱库版本 */
  atlas: BatchSide
  /** 按字段级规则预合并的结果（形态/孢子印取外业，采集点/鉴定留痕取图谱库） */
  merged: {
    record: FungusRecord
    spore: SporePrint | null
  }
  /** 逐条认的选择：field=采用外业形态与孢子印；atlas=保留图谱库形态与孢子印 */
  choice: 'field' | 'atlas'
  createdAt: string
}

/** 合并计划：纯函数 buildMergePlan 的产物 */
export interface MergePlan {
  batchId: string
  exportedAt: string
  device: string
  /** 新增条目（外业有、图谱库无此编号） */
  newItems: BatchSide[]
  /** 冲突条目（两边都动过），需逐条认 */
  conflicts: ConflictRow[]
  /** 编号一致且内容相同，无需处理 */
  sameCount: number
  /** 图谱库独有、本批次未触及（保持原样） */
  atlasOnlyCount: number
}

/** 批次审计行：记录已应用过的批次，用于幂等与历史 */
export interface BatchAudit {
  batchId: string
  source: 'field'
  exportedAt: string
  device: string
  appliedAt: string
  /** 本次应用新增条目数 */
  added: number
  /** 本次应用更新（冲突落地）条目数 */
  updated: number
  /** 本次应用识别出的冲突数 */
  conflicts: number
  /** 应用结果状态 */
  status: 'applied' | 'failed' | 'partial'
  /** 失败原因（status=failed 时记录） */
  error?: string
}

/** 合并应用结果 */
export interface MergeResult {
  ok: boolean
  batchId: string
  added: number
  updated: number
  conflicts: number
  error?: string
}
