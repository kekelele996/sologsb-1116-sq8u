/** 植被类型 */
export const VEGETATIONS = ['常绿阔叶林', '针阔混交林', '针叶林', '灌丛', '草坡'] as const
export type Vegetation = (typeof VEGETATIONS)[number]

/** 基物 */
export const SUBSTRATES = ['腐木', '落叶层', '土壤', '粪生'] as const
export type Substrate = (typeof SUBSTRATES)[number]

/** CollectPoint 采集点 */
export interface CollectPoint {
  id: string
  name: string
  longitude: number
  latitude: number
  altitude: number
  vegetation: Vegetation
  substrate: Substrate
  /** 伴生树种 */
  companionTrees: string
  collectDate: string
  collector: string
  /** 溯源：该采集点来自哪个外业批次（图谱库手工新建为空） */
  originBatchId?: string
}
