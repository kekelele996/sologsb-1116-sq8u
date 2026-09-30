/** 菌褶/菌管着生方式 */
export const GILL_ATTACHMENTS = ['离生', '弯生', '直生', '延生'] as const
export type GillAttachment = (typeof GILL_ATTACHMENTS)[number]

/** 菌褶密度 */
export const GILL_DENSITIES = ['稀疏', '中等', '密集'] as const
export type GillDensity = (typeof GILL_DENSITIES)[number]

/** 菌盖形状 */
export const CAP_SHAPES = ['半球形', '平展', '中凹', '漏斗形', '钟形'] as const
export type CapShape = (typeof CAP_SHAPES)[number]

/** 菌盖边缘 */
export const CAP_MARGINS = ['全缘', '内卷', '波状', '开裂', '附着菌幕残片'] as const
export type CapMargin = (typeof CAP_MARGINS)[number]

/** 表面质地 */
export const CAP_TEXTURES = ['光滑', '绒状', '鳞片状', '粘滑', '龟裂'] as const
export type CapTexture = (typeof CAP_TEXTURES)[number]

/** 菌肉变色反应 */
export const FLESH_REACTIONS = ['不变色', '缓慢变蓝', '迅速变蓝', '变红', '变褐', '变黑'] as const
export type FleshReaction = (typeof FLESH_REACTIONS)[number]

/** 菌环 */
export const RING_TYPES = ['无菌环', '膜质菌环', '蛛网状', '易脱落'] as const
export type RingType = (typeof RING_TYPES)[number]

/** 菌托 */
export const VOLVA_TYPES = ['无菌托', '杯状菌托', '鳞片状菌托', '苞状菌托'] as const
export type VolvaType = (typeof VOLVA_TYPES)[number]

/** FungusRecord 菌物条目 */
export interface FungusRecord {
  id: string
  /** 采集编号 */
  code: string
  /** 暂定名 */
  tempName: string
  /** 子实体数量 */
  fruitBodyCount: number
  pointId: string
  /** 菌盖直径（cm） */
  capDiameter: number
  capShape: CapShape
  capMargin: CapMargin
  capTexture: CapTexture
  /** 菌肉厚度（cm） */
  fleshThickness: number
  /** 菌肉变色反应 */
  fleshReaction: FleshReaction
  /** 菌褶或菌管着生方式 */
  attachment: GillAttachment
  gillDensity: GillDensity
  /** 菌柄长度（cm） */
  stipeLength: number
  /** 菌柄直径（cm） */
  stipeDiameter: number
  ring: RingType
  volva: VolvaType
  /** 气味 */
  odor: string
  /** 生境关联树种 */
  hostTree: string
  collectDate: string
  collector: string
  /** 备注（不可作为食用依据） */
  note: string
}
