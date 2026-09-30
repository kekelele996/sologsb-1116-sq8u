import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from '@/types'
import {
  FIELD_BATCH_FORMAT,
  FIELD_BATCH_FORMAT_VERSION,
  FIELD_LABELS,
  MORPH_FIELDS,
  SPORE_FIELDS,
  SPORE_FIELD_LABELS,
  type ConflictRow,
  type ConflictVersion,
  type FieldBatch,
  type FieldBatchPayload,
  type FieldDiff,
  type FieldGroup,
  type MergeItem,
  type MergePlan,
  type ResolveSide
} from '@/types/sync'

/* ---------- 确定性 ID：同一份批次重送，所有行主键稳定，不产生重复条目 ---------- */

function hash32(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** 批次内条目的入库主键：外业批次号 + 采集编号 确定性生成 */
export function fieldRecordId(batchId: string, code: string): string {
  return `frec_${hash32(`${batchId}::${code}`)}`
}
/** 批次内孢子印的入库主键（每条目至多一份孢子印） */
export function fieldSporeId(batchId: string, code: string): string {
  return `fspo_${hash32(`${batchId}::${code}`)}`
}
/** 外业新建采集点的入库主键 */
export function fieldPointId(batchId: string, sourcePointId: string): string {
  return `fpt_${hash32(`${batchId}::${sourcePointId}`)}`
}
/** 外业鉴定留痕的入库主键（保留原始内容生成） */
export function fieldIdentifyId(batchId: string, log: IdentifyLog): string {
  const raw = [log.recordId, log.date, log.conclusion, log.referenceBook, log.referencePage].join('|')
  return `fidf_${hash32(`${batchId}::${raw}`)}`
}
/** 冲突行主键：同一批次同一采集编号只留一条冲突 */
export function conflictId(batchId: string, code: string): string {
  return `conf_${hash32(`${batchId}::${code}`)}`
}

/* ---------- 批次文件解析 ---------- */

export class BatchParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BatchParseError'
  }
}

/** 解析并校验同伴平板导出的外业批次 JSON */
export function parseFieldBatch(input: unknown): FieldBatch {
  if (typeof input !== 'object' || input === null) throw new BatchParseError('批次文件不是有效的 JSON 对象')
  const batch = input as Partial<FieldBatch>
  if (batch.format !== FIELD_BATCH_FORMAT) {
    throw new BatchParseError(`格式标识应为 ${FIELD_BATCH_FORMAT}，无法识别该文件`)
  }
  if (batch.formatVersion !== FIELD_BATCH_FORMAT_VERSION) {
    throw new BatchParseError(`批次格式版本 v${batch.formatVersion ?? '?'} 与当前 v${FIELD_BATCH_FORMAT_VERSION} 不兼容`)
  }
  if (typeof batch.batchId !== 'string' || !batch.batchId.trim()) {
    throw new BatchParseError('批次缺少 batchId（外业批次号），无法保证重复导入幂等')
  }
  const payload = batch.payload
  if (!payload || typeof payload !== 'object') throw new BatchParseError('批次缺少 payload 数据区')
  for (const key of ['points', 'records', 'spores', 'identifies'] as const) {
    if (!Array.isArray(payload[key])) throw new BatchParseError(`批次数据区缺少数组：${key}`)
  }
  const codes = new Set<string>()
  for (const record of payload.records) {
    if (!record || typeof record.code !== 'string' || !record.code.trim()) {
      throw new BatchParseError('存在缺少采集编号的条目，批次无法合并')
    }
    if (codes.has(record.code)) throw new BatchParseError(`批次内采集编号「${record.code}」重复`)
    codes.add(record.code)
  }
  return batch as FieldBatch
}

/* ---------- 差异比较 ---------- */

function isDifferent(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => (v === null || v === undefined ? '' : v)
  return norm(a) !== norm(b)
}

/** 比较两份条目的形态分组字段，列出逐条分歧 */
export function diffMorphology(atlas: FungusRecord, field: FungusRecord): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const key of MORPH_FIELDS) {
    if (isDifferent(atlas[key], field[key])) {
      diffs.push({ group: 'morphology', key, label: FIELD_LABELS[key] ?? key, atlas: atlas[key], field: field[key] })
    }
  }
  return diffs
}

/** 比较两份孢子印的观察字段；缺侧的一方标为「未记录」 */
export function diffSpore(atlas: SporePrint | null, field: SporePrint | null): FieldDiff[] {
  const diffs: FieldDiff[] = []
  if (!atlas && !field) return diffs
  for (const key of SPORE_FIELDS) {
    const av = atlas ? atlas[key] : '（图谱库未记录）'
    const fv = field ? field[key] : '（外业未记录）'
    if (isDifferent(av, fv)) {
      diffs.push({ group: 'spore', key, label: SPORE_FIELD_LABELS[key] ?? key, atlas: av, field: fv })
    }
  }
  return diffs
}

function buildVersion(
  record: FungusRecord,
  spore: SporePrint | null,
  identifies: IdentifyLog[],
  point: CollectPoint | null
): ConflictVersion {
  return { record, spore, identifies, point }
}

/* ---------- 主键归一 ---------- */

/**
 * 让外业条目的主键/关联键稳定：新条目用确定性主键，孢子印/留痕/点关联同步重写。
 * 这样同一份批次再送一次，put 的主键完全一致，不会多出条目。
 */
export function normalizePayload(payload: FieldBatchPayload, batchId: string): FieldBatchPayload {
  const recordIdMap = new Map<string, string>()
  for (const record of payload.records) {
    recordIdMap.set(record.id, fieldRecordId(batchId, record.code))
  }
  const pointIdMap = new Map<string, string>()
  for (const point of payload.points) {
    pointIdMap.set(point.id, fieldPointId(batchId, point.id))
  }
  const codeByOriginalRecordId = new Map(payload.records.map((r) => [r.id, r.code]))
  return {
    points: payload.points.map((p) => ({ ...p, id: pointIdMap.get(p.id) ?? p.id })),
    records: payload.records.map((r) => ({
      ...r,
      id: recordIdMap.get(r.id) ?? r.id,
      pointId: pointIdMap.get(r.pointId) ?? r.pointId
    })),
    spores: payload.spores.map((s) => ({
      ...s,
      id: fieldSporeId(batchId, codeByOriginalRecordId.get(s.recordId) ?? ''),
      recordId: recordIdMap.get(s.recordId) ?? s.recordId
    })),
    identifies: payload.identifies.map((l) => ({
      ...l,
      id: fieldIdentifyId(batchId, l),
      recordId: recordIdMap.get(l.recordId) ?? l.recordId
    }))
  }
}

/* ---------- 预检计划 ---------- */

/**
 * 把外业批次与当前图谱库对齐，生成合并计划（纯函数，不写库）。
 * 匹配键是采集编号 code；同号即「两边都有」，再逐字段判定是否两边都动过。
 */
export function buildMergePlan(batch: FieldBatch, local: FieldBatchPayload): MergePlan {
  const { batchId } = batch
  const payload = normalizePayload(batch.payload, batchId)
  const localRecordsByCode = new Map(local.records.map((r) => [r.code, r]))
  const localPointsById = new Map(local.points.map((p) => [p.id, p]))

  // 外业采集点：图谱库已存在（按 id 命中）就不重复入库，否则分配确定性新 id
  const newPoints: MergePlan['newPoints'] = []
  for (const source of payload.points) {
    if (!localPointsById.has(source.id)) {
      newPoints.push({ source, targetId: source.id })
    }
  }

  const items: MergeItem[] = []
  const conflicts: ConflictRow[] = []
  const stats: MergePlan['stats'] = {
    total: payload.records.length,
    inserted: 0,
    updated: 0,
    conflicts: 0,
    pointsInserted: newPoints.length,
    sporesInserted: 0,
    sporesReplaced: 0,
    identifiesImported: 0
  }

  for (const fieldRecord of payload.records) {
    const atlasRecord = localRecordsByCode.get(fieldRecord.code)
    const fieldSpore = payload.spores.find((s) => s.recordId === fieldRecord.id) ?? null
    const fieldIdentifies = payload.identifies.filter((l) => l.recordId === fieldRecord.id)
    const fieldPoint = payload.points.find((p) => p.id === fieldRecord.pointId) ?? null

    if (!atlasRecord) {
      // 图谱库没有该编号 → 新条目，整份（含其孢子印、外业鉴定留痕）直接入库
      items.push({
        code: fieldRecord.code,
        kind: 'new',
        fieldRecord,
        fieldSpore,
        atlasSpore: null,
        fieldIdentifies,
        atlasIdentifies: [],
        fieldPoint,
        atlasPoint: null
      })
      stats.inserted += 1
      if (fieldSpore) stats.sporesInserted += 1
      stats.identifiesImported += fieldIdentifies.length
      continue
    }

    // 同号 → 两边逐字段比对
    const atlasSpore = local.spores.find((s) => s.recordId === atlasRecord.id) ?? null
    const atlasIdentifies = local.identifies.filter((l) => l.recordId === atlasRecord.id)
    const atlasPoint = local.points.find((p) => p.id === atlasRecord.pointId) ?? null

    const morphDiffs = diffMorphology(atlasRecord, fieldRecord)
    // 孢子印：只有两边都做了印且观察不一致才算「两边都动过」；
    // 一侧缺印时不构成冲突——外业缺印保留图谱库那份，图谱库缺印则补登外业那份。
    const sporeDiffs = atlasSpore && fieldSpore ? diffSpore(atlasSpore, fieldSpore) : []
    // 有分歧时外业印另存一行（不覆盖图谱库原印），使孢子印分组可在两侧间反复改判
    const fieldSporeRowId =
      atlasSpore && fieldSpore && sporeDiffs.length
        ? `${fieldSpore.id}_alt_${hash32(batchId)}`.slice(0, 64)
        : undefined
    const groups: FieldGroup[] = []
    if (morphDiffs.length) groups.push('morphology')
    if (sporeDiffs.length) groups.push('spore')
    // 鉴定留痕与采集点恒按图谱库：外业留痕不并入、外业点信息不覆盖，故不列入待认冲突

    items.push({
      code: fieldRecord.code,
      kind: 'update',
      fieldRecord,
      atlasRecord,
      fieldSpore,
      atlasSpore,
      fieldIdentifies,
      atlasIdentifies,
      fieldPoint,
      atlasPoint
    })
    stats.updated += 1
    if (fieldSpore && !atlasSpore) stats.sporesInserted += 1
    if (fieldSpore && atlasSpore && sporeDiffs.length) stats.sporesReplaced += 1

    if (morphDiffs.length + sporeDiffs.length > 0) {
      // 两边都动过：形态/孢子印默认按外业，两版完整快照都留着让人逐条认
      const resolution: ConflictRow['resolution'] = {}
      for (const g of groups) resolution[g] = 'field'
      conflicts.push({
        id: conflictId(batchId, fieldRecord.code),
        batchId,
        code: fieldRecord.code,
        recordId: atlasRecord.id,
        groups,
        diffs: [...morphDiffs, ...sporeDiffs],
        resolution,
        status: 'pending',
        atlasVersion: buildVersion(atlasRecord, atlasSpore, atlasIdentifies, atlasPoint),
        fieldVersion: buildVersion(fieldRecord, fieldSpore, fieldIdentifies, fieldPoint),
        fieldSporeRowId,
        createdAt: new Date().toISOString()
      })
      stats.conflicts += 1
    }
  }

  return {
    batchId,
    checksum: checksumOf(items, newPoints, conflicts),
    items,
    newPoints,
    conflicts,
    stats
  }
}

function checksumOf(items: MergeItem[], newPoints: MergePlan['newPoints'], conflicts: ConflictRow[]): string {
  return hash32(
    JSON.stringify({
      codes: items.map((i) => i.code),
      points: newPoints.map((p) => p.targetId),
      conflicts: conflicts.map((c) => c.id)
    })
  )
}

/* ---------- 裁决应用 ---------- */

/**
 * 按冲突行的逐条裁决生成最终条目/孢子印。
 * - morphology：field → 形态字段取外业；atlas → 保留图谱库
 * - spore：field → 当前生效取外业；atlas → 当前生效取图谱库
 * - identify / point 恒为图谱库侧（鉴定留痕与采集点不被外业覆盖）
 *
 * 返回 activeSpore（当前生效的孢子印）与 sideRows（两侧各自的孢子印落库行）：
 * 有分歧时两版孢子印都各自存一行，改判只是切换哪一行指向该条目，两版都不丢。
 */
export function applyResolution(
  conflict: ConflictRow,
  sideOf: (group: FieldGroup) => ResolveSide
): {
  record: FungusRecord
  activeSpore: SporePrint | null
  sideRows: { id: string; row: SporePrint }[]
} {
  const { atlasVersion, fieldVersion } = conflict
  const record: FungusRecord = { ...atlasVersion.record }

  if (sideOf('morphology') === 'field') {
    for (const key of MORPH_FIELDS) {
      ;(record as unknown as Record<string, unknown>)[key] = fieldVersion.record[key]
    }
  }
  // 采集点恒按图谱库：即使形态取外业，也不把 pointId 带成外业点
  record.pointId = atlasVersion.record.pointId

  const sideRows: { id: string; row: SporePrint }[] = []
  let activeSpore: SporePrint | null = atlasVersion.spore

  if (atlasVersion.spore && fieldVersion.spore && conflict.fieldSporeRowId) {
    // 两边都有印：图谱库原印保留原主键，外业印存独立行，按裁决决定哪份生效
    const atlasRow: SporePrint = { ...atlasVersion.spore, recordId: atlasVersion.record.id }
    const fieldRow: SporePrint = {
      ...fieldVersion.spore,
      id: conflict.fieldSporeRowId,
      recordId: atlasVersion.record.id
    }
    sideRows.push({ id: atlasRow.id, row: atlasRow }, { id: fieldRow.id, row: fieldRow })
    activeSpore = sideOf('spore') === 'atlas' ? atlasRow : fieldRow
  } else if (fieldVersion.spore && !atlasVersion.spore) {
    // 图谱库缺印：补登外业印（沿用图谱库条目主键关联）
    activeSpore = { ...fieldVersion.spore, id: fieldVersion.spore.id, recordId: atlasVersion.record.id }
  }
  return { record, activeSpore, sideRows }
}
