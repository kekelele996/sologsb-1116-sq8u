import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { FungusRecord } from '@/types'
import type { SporePrint } from '@/types'
import { EMPTY_CRITERIA, useCandidateMatch, type MatchCriteria } from '@/hooks/useCandidateMatch'

function rec(id: string, attachment: FungusRecord['attachment']): FungusRecord {
  return {
    id,
    code: id,
    tempName: id,
    fruitBodyCount: 1,
    pointId: 'p',
    capDiameter: 5,
    capShape: '平展',
    capMargin: '全缘',
    capTexture: '光滑',
    fleshThickness: 1,
    fleshReaction: '不变色',
    attachment,
    gillDensity: '中等',
    stipeLength: 5,
    stipeDiameter: 1,
    ring: '无菌环',
    volva: '无菌托',
    odor: '',
    hostTree: '',
    collectDate: '2026-09-30',
    collector: '',
    note: ''
  }
}

describe('着生方式改动后候选排序跟着重算', () => {
  it('合并改写入数据后，排序结果即时刷新', () => {
    const records = ref<FungusRecord[]>([rec('a', '离生'), rec('b', '直生')])
    const spores = ref<SporePrint[]>([])
    const criteria = ref<MatchCriteria>({ ...EMPTY_CRITERIA, attachment: '直生' })

    const { candidates } = useCandidateMatch(records, spores, criteria)
    expect(candidates.value[0].record.id).toBe('b') // 直生匹配排第一

    // 模拟外业合并把 a 的着生方式改为直生
    records.value = records.value.map((r) => (r.id === 'a' ? { ...r, attachment: '直生' } : r))

    const top = candidates.value[0]
    expect(top.record.attachment).toBe('直生')
    // 同为直生、同分，按采集编号排序，a 应排到 b 前面
    expect(top.record.id).toBe('a')
    expect(candidates.value.map((c) => c.record.id)).toEqual(['a', 'b'])
  })

  it('筛选条件里的着生方式变化也会重算', () => {
    const records = ref<FungusRecord[]>([rec('a', '离生'), rec('b', '延生')])
    const spores = ref<SporePrint[]>([])
    const criteria = ref<MatchCriteria>({ ...EMPTY_CRITERIA, attachment: '离生' })
    const { candidates } = useCandidateMatch(records, spores, criteria)
    expect(candidates.value[0].record.id).toBe('a')
    criteria.value = { ...EMPTY_CRITERIA, attachment: '延生' }
    expect(candidates.value[0].record.id).toBe('b')
  })
})
