import { computed, type Ref } from 'vue'
import type { FungusRecord, GillAttachment, SporeColor, SporePrint } from '@/types'
import { SPORE_ATTACHMENT_AFFINITY, TRAIT_WEIGHTS, traitScore, toPercent } from '@/utils/spore'

/** 鉴定工作页的可勾选特征条件 */
export interface MatchCriteria {
  attachment: GillAttachment | ''
  sporeColor: SporeColor | ''
  capShape: string
  capMargin: string
  capTexture: string
  gillDensity: string
  fleshReaction: string
  hostTree: string
}

export interface Candidate {
  record: FungusRecord
  spore: SporePrint | null
  score: number
  percent: number
  /** 命中与未命中的特征说明 */
  matched: string[]
  missed: string[]
}

export const EMPTY_CRITERIA: MatchCriteria = {
  attachment: '',
  sporeColor: '',
  capShape: '',
  capMargin: '',
  capTexture: '',
  gillDensity: '',
  fleshReaction: '',
  hostTree: ''
}

/** 单条候选打分 */
export function scoreRecord(record: FungusRecord, spore: SporePrint | null, criteria: MatchCriteria): Candidate {
  let score = 0
  const matched: string[] = []
  const missed: string[] = []

  const judge = (label: string, ok: boolean, weight: number, partial = false): void => {
    const value = traitScore(weight, ok, partial)
    score += value
    if (ok) matched.push(label)
    else missed.push(label)
  }

  if (criteria.attachment) {
    judge(`着生方式=${record.attachment}`, record.attachment === criteria.attachment, TRAIT_WEIGHTS.attachment)
  }
  if (criteria.sporeColor) {
    const affinity = SPORE_ATTACHMENT_AFFINITY[criteria.sporeColor] ?? []
    const colorOk = spore?.color === criteria.sporeColor
    const partial = !colorOk && affinity.includes(record.attachment)
    judge(`孢子印=${spore?.color ?? '未记录'}`, colorOk, TRAIT_WEIGHTS.sporeColor, partial)
  }
  if (criteria.capShape) judge(`菌盖形状=${record.capShape}`, record.capShape === criteria.capShape, TRAIT_WEIGHTS.capShape)
  if (criteria.capMargin) judge(`菌盖边缘=${record.capMargin}`, record.capMargin === criteria.capMargin, TRAIT_WEIGHTS.capMargin)
  if (criteria.capTexture) judge(`表面质地=${record.capTexture}`, record.capTexture === criteria.capTexture, TRAIT_WEIGHTS.capTexture)
  if (criteria.gillDensity) judge(`菌褶密度=${record.gillDensity}`, record.gillDensity === criteria.gillDensity, TRAIT_WEIGHTS.gillDensity)
  if (criteria.fleshReaction) judge(`菌肉反应=${record.fleshReaction}`, record.fleshReaction === criteria.fleshReaction, TRAIT_WEIGHTS.fleshReaction)
  if (criteria.hostTree) {
    judge(
      `关联树种含「${criteria.hostTree}」`,
      record.hostTree.includes(criteria.hostTree),
      TRAIT_WEIGHTS.substrateHost
    )
  }

  return { record, spore, score, percent: toPercent(score), matched, missed }
}

/**
 * 输入形态特征与孢子印条件，返回按匹配度排序的候选条目。
 * 同时把「菌褶/菌管着生方式 + 孢子印颜色」作为主排序键。
 */
export function useCandidateMatch(
  records: Ref<FungusRecord[]>,
  spores: Ref<SporePrint[]>,
  criteria: Ref<MatchCriteria>
): { candidates: Ref<Candidate[]>; hasCondition: Ref<boolean> } {
  const hasCondition = computed(() =>
    Object.values(criteria.value).some((value) => String(value).trim() !== '')
  )

  const candidates = computed<Candidate[]>(() => {
    const list = records.value.map((record) =>
      scoreRecord(record, spores.value.find((item) => item.recordId === record.id) ?? null, criteria.value)
    )
    return list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aPrimary = a.record.attachment === criteria.value.attachment ? 1 : 0
      const bPrimary = b.record.attachment === criteria.value.attachment ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      return a.record.code.localeCompare(b.record.code, 'zh-Hans-CN')
    })
  })

  return { candidates, hasCondition }
}
