/** 鉴定依据 */
export const ID_BASES = ['形态特征', '孢子印', '显微观察'] as const
export type IdBasis = (typeof ID_BASES)[number]

/** 置信度 */
export const ID_CONFIDENCES = ['高', '中', '低'] as const
export type IdConfidence = (typeof ID_CONFIDENCES)[number]

/** IdentifyLog 鉴定结论 */
export interface IdentifyLog {
  id: string
  recordId: string
  /** 结论学名 */
  conclusion: string
  basis: IdBasis
  /** 参考图鉴名称 */
  referenceBook: string
  /** 页码 */
  referencePage: string
  confidence: IdConfidence
  needReview: boolean
  reviewer: string
  date: string
  /** 溯源：该鉴定留痕来自哪个外业批次（图谱库手工新建为空） */
  originBatchId?: string
}
