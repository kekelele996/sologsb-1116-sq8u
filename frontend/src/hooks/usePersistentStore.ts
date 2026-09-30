import { onUnmounted, reactive } from 'vue'
import type { StoreApi } from 'zustand/vanilla'
import Dexie, { type Table } from 'dexie'
import type { CollectPoint, FungusRecord, IdentifyLog, SporePrint } from '@/types'
import type { BatchAudit, ConflictRow } from '@/types/batch'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  /** schemaVersion 存数字；外业批次信封存 JSON 字符串（key 以 batch: 开头） */
  value: number | string
}

/** 整库快照（用于合并失败时回滚到本地上一版） */
export interface FullSnapshot {
  records: FungusRecord[]
  spores: SporePrint[]
  points: CollectPoint[]
  identifies: IdentifyLog[]
  batches: BatchAudit[]
  conflicts: ConflictRow[]
}

/** Dexie 封装：条目 / 孢子印 / 采集点 / 鉴定结论 + 批次审计 / 冲突 六张业务表 + 元数据表 */
class FungiGuideDb extends Dexie {
  records!: Table<FungusRecord, string>
  spores!: Table<SporePrint, string>
  points!: Table<CollectPoint, string>
  identifies!: Table<IdentifyLog, string>
  batches!: Table<BatchAudit, string>
  conflicts!: Table<ConflictRow, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbfungiguide')
    this.version(1).stores({
      records: 'id, code, pointId, attachment',
      spores: 'id, recordId, color',
      points: 'id, name, substrate',
      identifies: 'id, recordId, conclusion',
      meta: 'key'
    })
    // v2：新增「菌肉变色反应」字段，迁移时为历史条目补齐默认值（不变色）
    this.version(2)
      .stores({
        records: 'id, code, pointId, attachment, capShape',
        spores: 'id, recordId, color, observeDate',
        points: 'id, name, substrate, vegetation',
        identifies: 'id, recordId, conclusion, date',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table<FungusRecord, string>('records')
          .toCollection()
          .modify((record) => {
            if (!record.fleshReaction) {
              record.fleshReaction = '不变色'
            }
          })
      })
    // v3：新增批次审计与冲突表；为历史数据补齐溯源字段 originBatchId。
    // 迁移只新增字段、绝不删除既有行——孢子印记录随升级完整保留。
    this.version(SCHEMA_VERSION)
      .stores({
        records: 'id, code, pointId, attachment, capShape, originBatchId',
        spores: 'id, recordId, color, observeDate, originBatchId',
        points: 'id, name, substrate, vegetation, originBatchId',
        identifies: 'id, recordId, conclusion, date, originBatchId',
        batches: '&batchId, status, appliedAt',
        conflicts: '&id, batchId, code, status',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        const backfill = async <T extends { originBatchId?: string }>(table: string): Promise<void> => {
          await tx
            .table<T, string>(table)
            .toCollection()
            .modify((row) => {
              if (row.originBatchId === undefined) row.originBatchId = ''
            })
        }
        await backfill<FungusRecord>('records')
        await backfill<SporePrint>('spores')
        await backfill<CollectPoint>('points')
        await backfill<IdentifyLog>('identifies')
      })
  }
}

export const db = new FungiGuideDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function syncAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function syncPut<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function syncDelete<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** 读取整库快照（合并前备份，失败时回滚到本地上一版） */
export async function snapshotAll(): Promise<FullSnapshot> {
  const [records, spores, points, identifies, batches, conflicts] = await Promise.all([
    db.records.toArray(),
    db.spores.toArray(),
    db.points.toArray(),
    db.identifies.toArray(),
    db.batches.toArray(),
    db.conflicts.toArray()
  ])
  return { records, spores, points, identifies, batches, conflicts }
}

/** 用快照覆盖整库（回滚）。在事务内调用，失败不产生半成品数据。 */
export async function restoreAll(snapshot: FullSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [db.records, db.spores, db.points, db.identifies, db.batches, db.conflicts],
    async () => {
      await Promise.all([
        db.records.clear(),
        db.spores.clear(),
        db.points.clear(),
        db.identifies.clear(),
        db.batches.clear(),
        db.conflicts.clear()
      ])
      await Promise.all([
        db.records.bulkPut(snapshot.records),
        db.spores.bulkPut(snapshot.spores),
        db.points.bulkPut(snapshot.points),
        db.identifies.bulkPut(snapshot.identifies),
        db.batches.bulkPut(snapshot.batches),
        db.conflicts.bulkPut(snapshot.conflicts)
      ])
    }
  )
}

/** 把 Zustand vanilla store 桥接到 Vue 响应式状态 */
export function useStore<T extends object>(store: StoreApi<T>): T {
  const state = reactive({ ...store.getState() }) as T
  const unsubscribe = store.subscribe((next: T) => {
    Object.assign(state, next)
  })
  onUnmounted(() => unsubscribe())
  return state
}

/** 首次打开写入示例数据，保证各页面进入即有事可做 */
export async function seedDemoData(): Promise<void> {
  const count = await db.points.count()
  if (count > 0) return

  const today = new Date().toISOString().slice(0, 10)

  await db.points.bulkPut([
    {
      id: 'pt_bhs',
      name: '百花山栎树林样线',
      longitude: 115.6218,
      latitude: 39.8152,
      altitude: 1420,
      vegetation: '针阔混交林',
      substrate: '落叶层',
      companionTrees: '辽东栎、油松',
      collectDate: today,
      collector: '沈禾'
    },
    {
      id: 'pt_yls',
      name: '云龙山腐木沟',
      longitude: 117.2841,
      latitude: 34.2615,
      altitude: 260,
      vegetation: '常绿阔叶林',
      substrate: '腐木',
      companionTrees: '麻栎、枫香',
      collectDate: today,
      collector: '沈禾'
    }
  ])

  await db.records.bulkPut([
    {
      id: 'rec_001',
      code: 'BHS-2026-001',
      tempName: '橙黄牛肝菌（暂定）',
      fruitBodyCount: 3,
      pointId: 'pt_bhs',
      capDiameter: 9.5,
      capShape: '半球形',
      capMargin: '全缘',
      capTexture: '绒状',
      fleshThickness: 2.1,
      fleshReaction: '缓慢变蓝',
      attachment: '直生',
      gillDensity: '中等',
      stipeLength: 7.4,
      stipeDiameter: 2.2,
      ring: '膜质菌环',
      volva: '无菌托',
      odor: '淡淡坚果味',
      hostTree: '辽东栎',
      collectDate: today,
      collector: '沈禾',
      note: '菌管层易剥离，仅作形态记录'
    },
    {
      id: 'rec_002',
      code: 'BHS-2026-002',
      tempName: '灰紫小伞（暂定）',
      fruitBodyCount: 6,
      pointId: 'pt_bhs',
      capDiameter: 4.2,
      capShape: '平展',
      capMargin: '波状',
      capTexture: '光滑',
      fleshThickness: 0.6,
      fleshReaction: '不变色',
      attachment: '离生',
      gillDensity: '密集',
      stipeLength: 6.8,
      stipeDiameter: 0.8,
      ring: '无菌环',
      volva: '无菌托',
      odor: '无明显气味',
      hostTree: '油松',
      collectDate: today,
      collector: '沈禾',
      note: '菌褶边缘略带紫晕'
    },
    {
      id: 'rec_003',
      code: 'YLS-2026-001',
      tempName: '褐褶韧革菌（暂定）',
      fruitBodyCount: 2,
      pointId: 'pt_yls',
      capDiameter: 12.6,
      capShape: '漏斗形',
      capMargin: '内卷',
      capTexture: '鳞片状',
      fleshThickness: 1.4,
      fleshReaction: '变褐',
      attachment: '延生',
      gillDensity: '稀疏',
      stipeLength: 3.2,
      stipeDiameter: 3.6,
      ring: '无菌环',
      volva: '无菌托',
      odor: '土腥味',
      hostTree: '麻栎',
      collectDate: today,
      collector: '祁野',
      note: '生于倒木侧面，质地木栓化'
    }
  ])

  await db.spores.bulkPut([
    {
      id: 'spo_001',
      recordId: 'rec_001',
      color: '淡黄',
      shape: '圆形印痕，边缘略散',
      hours: 12,
      observeDate: today,
      moisture: '子实体偏干，印痕较薄'
    },
    {
      id: 'spo_002',
      recordId: 'rec_002',
      color: '白色',
      shape: '圆形印痕，中心致密',
      hours: 8,
      observeDate: today,
      moisture: '新鲜子实体，印痕厚实'
    },
    {
      id: 'spo_003',
      recordId: 'rec_003',
      color: '粉褐',
      shape: '不规则印痕',
      hours: 24,
      observeDate: today,
      moisture: '木质化样本，印痕浅'
    }
  ])

  await db.identifies.bulkPut([
    {
      id: 'idf_001',
      recordId: 'rec_001',
      conclusion: 'Boletus sp.',
      basis: '形态特征',
      referenceBook: '《中国大型真菌》',
      referencePage: 'P.312',
      confidence: '低',
      needReview: true,
      reviewer: '祁野',
      date: today
    },
    {
      id: 'idf_002',
      recordId: 'rec_002',
      conclusion: 'Lepista sordida',
      basis: '孢子印',
      referenceBook: '《菌物图鉴》',
      referencePage: 'P.145',
      confidence: '中',
      needReview: false,
      reviewer: '祁野',
      date: today
    }
  ])
}
