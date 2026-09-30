import type { FieldBatch, FieldBatchPayload } from '@/types/sync'
import { FIELD_BATCH_FORMAT, FIELD_BATCH_FORMAT_VERSION } from '@/types/sync'
import { db } from '@/hooks/usePersistentStore'

/**
 * 生成一份「同伴平板离线登记」的外业批次样例：
 * - 取图谱库第一条做同号冲突：外业改了着生方式与形态（默认按外业），
 *   并改了孢子印颜色；图谱库那份鉴定留痕与采集点保留；
 * - 再带一条图谱库没有的新采集编号，演示整份新增（含新采集点、孢子印、外业留痕）。
 */
export async function sampleFieldBatch(): Promise<FieldBatch> {
  const anchor = (await db.records.toArray())[0]
  const anchorSpore = anchor ? await db.spores.where('recordId').equals(anchor.id).first() : undefined

  const today = new Date().toISOString().slice(0, 10)
  const payload: FieldBatchPayload = { points: [], records: [], spores: [], identifies: [] }

  if (anchor) {
    payload.points.push({
      id: `field_pt_${anchor.pointId}`,
      name: '外业临时点（不应覆盖图谱库采集点）',
      longitude: 0,
      latitude: 0,
      altitude: 0,
      vegetation: '灌丛',
      substrate: '土壤',
      companionTrees: '外业随手填',
      collectDate: today,
      collector: '外业平板'
    })
    payload.records.push({
      ...anchor,
      id: 'field_rec_anchor',
      pointId: `field_pt_${anchor.pointId}`,
      attachment: anchor.attachment === '离生' ? '弯生' : '离生',
      capShape: '中凹',
      capTexture: '粘滑',
      odor: '外业补记：略带杏仁味',
      collector: '同伴（平板）',
      note: '山里离线登记：着生方式现场复核后改动'
    })
    payload.spores.push({
      id: 'field_spo_anchor',
      recordId: 'field_rec_anchor',
      color: anchorSpore && anchorSpore.color !== '紫褐' ? '紫褐' : '黑褐',
      shape: '外业重制：圆形印痕，放射棱清晰',
      hours: anchorSpore ? anchorSpore.hours + 4 : 10,
      observeDate: today,
      moisture: '新鲜样本，印痕浓厚'
    })
    // 外业这条鉴定留痕不应并入图谱库（鉴定留痕按图谱库那份算）
    payload.identifies.push({
      id: 'field_idf_anchor',
      recordId: 'field_rec_anchor',
      conclusion: 'Field-only note (不应入库覆盖)',
      basis: '形态特征',
      referenceBook: '外业速查卡',
      referencePage: 'P.9',
      confidence: '低',
      needReview: true,
      reviewer: '',
      date: today
    })
  }

  // 全新采集编号：整份新增
  payload.points.push({
    id: 'field_pt_new',
    name: '雾灵山北沟外业点',
    longitude: 117.3856,
    latitude: 40.6201,
    altitude: 1180,
    vegetation: '针阔混交林',
    substrate: '落叶层',
    companionTrees: '白桦、落叶松',
    collectDate: today,
    collector: '同伴（平板）'
  })
  const newCode = anchor ? `${anchor.code.split('-').slice(0, -1).join('-')}-OFF1` : 'FIELD-2026-001'
  payload.records.push({
    id: 'field_rec_new',
    code: newCode,
    tempName: '外业新见伞菌（暂定）',
    fruitBodyCount: 4,
    pointId: 'field_pt_new',
    capDiameter: 6.8,
    capShape: '钟形',
    capMargin: '附着菌幕残片',
    capTexture: '光滑',
    fleshThickness: 0.9,
    fleshReaction: '不变色',
    attachment: '离生',
    gillDensity: '密集',
    stipeLength: 8.6,
    stipeDiameter: 1.1,
    ring: '膜质菌环',
    volva: '杯状菌托',
    odor: '无',
    hostTree: '白桦',
    collectDate: today,
    collector: '同伴（平板）',
    note: '平板离线登记，回驻地批量合并'
  })
  payload.spores.push({
    id: 'field_spo_new',
    recordId: 'field_rec_new',
    color: '白色',
    shape: '圆形印痕',
    hours: 8,
    observeDate: today,
    moisture: '印痕厚实'
  })
  payload.identifies.push({
    id: 'field_idf_new',
    recordId: 'field_rec_new',
    conclusion: 'Amanita sp. (field)',
    basis: '形态特征',
    referenceBook: '外业速查卡',
    referencePage: 'P.21',
    confidence: '中',
    needReview: true,
    reviewer: '',
    date: today
  })

  return {
    format: FIELD_BATCH_FORMAT,
    formatVersion: FIELD_BATCH_FORMAT_VERSION,
    batchId: `BATCH-${today.replace(/-/g, '')}-01`,
    exportedAt: new Date().toISOString(),
    device: 'field-tablet-07',
    note: '雾灵山样线外业离线批次',
    payload
  }
}
