import type { GillAttachment, SporeColor } from '@/types'

/** 印色 → 可辨识色卡色值 */
export const SPORE_COLOR_VALUES: Record<SporeColor, string> = {
  白色: '#fbfaf6',
  奶油色: '#f3e3c3',
  淡黄: '#ecd489',
  粉褐: '#d8a08c',
  紫褐: '#8b6a8f',
  黑褐: '#4b3a33'
}

/** 印色 → 文字对比色（深浅底自动切换） */
export const SPORE_TEXT_VALUES: Record<SporeColor, string> = {
  白色: '#3b3a36',
  奶油色: '#4a3d24',
  淡黄: '#4a3d0c',
  粉褐: '#4a2318',
  紫褐: '#f6f1f7',
  黑褐: '#f5efe9'
}

/** 印色十六进制转换 */
export function sporeColorHex(color: SporeColor): string {
  return SPORE_COLOR_VALUES[color] ?? '#cccccc'
}

/** 印色对应的菌褶着生方式先验倾向（用于候选排序加分） */
export const SPORE_ATTACHMENT_AFFINITY: Record<SporeColor, GillAttachment[]> = {
  白色: ['离生', '弯生'],
  奶油色: ['弯生', '直生'],
  淡黄: ['直生', '弯生'],
  粉褐: ['直生', '延生'],
  紫褐: ['弯生', '延生'],
  黑褐: ['离生', '延生']
}

/** 形态特征权重表：每个特征参与候选打分的权重 */
export const TRAIT_WEIGHTS = {
  attachment: 26,
  sporeColor: 22,
  capShape: 12,
  capMargin: 8,
  capTexture: 10,
  gillDensity: 10,
  fleshReaction: 8,
  substrateHost: 4
} as const

export type TraitKey = keyof typeof TRAIT_WEIGHTS

/** 单特征匹配得分（0-1） */
export function traitScore(weight: number, matched: boolean, partial = false): number {
  if (matched) return weight
  return partial ? weight * 0.5 : 0
}

/** 把得分归一为百分比 */
export function toPercent(score: number): number {
  const total = Object.values(TRAIT_WEIGHTS).reduce((sum, item) => sum + item, 0)
  return Math.max(0, Math.min(100, Math.round((score / total) * 100)))
}

/** 印色文字色 */
export function sporeTextColor(color: SporeColor): string {
  return SPORE_TEXT_VALUES[color] ?? '#222222'
}
