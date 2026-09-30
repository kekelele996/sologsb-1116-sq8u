<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FungusRecord, SporePrint } from '@/types'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)

const selectedIds = ref<string[]>([])
const keyword = ref('')

watch(
  () => [route.query.ids, recordState.records.length] as const,
  () => {
    const raw = typeof route.query.ids === 'string' ? route.query.ids : ''
    if (raw) {
      selectedIds.value = raw.split(',').filter(Boolean).slice(0, 3)
    } else if (selectedIds.value.length === 0 && recordState.records.length >= 2) {
      selectedIds.value = recordState.records.slice(0, 2).map((item) => item.id)
    }
  },
  { immediate: true }
)

const candidatesList = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return recordState.records
  return recordState.records.filter((item) =>
    [item.code, item.tempName, item.hostTree].join(' ').toLowerCase().includes(text)
  )
})

const selected = computed(() =>
  selectedIds.value
    .map((id) => recordState.records.find((item) => item.id === id))
    .filter((item): item is FungusRecord => Boolean(item))
)

function toggle(id: string): void {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
    return
  }
  if (selectedIds.value.length >= 3) {
    ElMessage.warning('最多并排对比 3 条')
    return
  }
  selectedIds.value = [...selectedIds.value, id]
}

function syncQuery(): void {
  void router.replace({ path: '/compare', query: { ids: selectedIds.value.join(',') } })
}

function sporeOf(recordId: string): SporePrint | null {
  return sporeState.spores.find((item) => item.recordId === recordId) ?? null
}

function pointName(pointId: string): string {
  return pointState.points.find((point) => point.id === pointId)?.name ?? '未关联采集点'
}

function conclusionOf(recordId: string): string {
  const log = identifyState.logs.find((item) => item.recordId === recordId)
  return log ? `${log.conclusion}（${log.confidence}${log.needReview ? '，待复核' : ''}）` : '尚无结论'
}

interface DiffRow {
  label: string
  values: string[]
  same: boolean
}

/** 逐项对照：菌盖、菌褶/菌管、孢子印、菌肉、菌柄、气味生境 */
const diffRows = computed<DiffRow[]>(() => {
  const build = (label: string, pick: (record: FungusRecord) => string): DiffRow => {
    const values = selected.value.map((record) => pick(record))
    return { label, values, same: new Set(values).size <= 1 }
  }
  if (selected.value.length === 0) return []
  return [
    build('菌盖形状', (record) => record.capShape),
    build('菌盖边缘', (record) => record.capMargin),
    build('菌盖直径', (record) => `${record.capDiameter} cm`),
    build('表面质地', (record) => record.capTexture),
    build('菌肉变色反应', (record) => record.fleshReaction),
    build('着生方式', (record) => record.attachment),
    build('菌褶密度', (record) => record.gillDensity),
    build('孢子印印色', (record) => sporeOf(record.id)?.color ?? '未记录'),
    build('孢子印时长', (record) => {
      const spore = sporeOf(record.id)
      return spore ? `${spore.hours} h` : '未记录'
    }),
    build('菌柄长×径', (record) => `${record.stipeLength} × ${record.stipeDiameter} cm`),
    build('菌环/菌托', (record) => `${record.ring} / ${record.volva}`),
    build('气味', (record) => record.odor || '—'),
    build('关联树种', (record) => record.hostTree || '—'),
    build('采集点', (record) => pointName(record.pointId)),
    build('鉴定结论', (record) => conclusionOf(record.id))
  ]
})

const diffCount = computed(() => diffRows.value.filter((row) => !row.same).length)

/** 差异行高亮（模板里不写类型注解，避免模板表达式解析失败） */
function diffRowClass(param: { row: DiffRow }): string {
  return param.row.same ? '' : 'diff-row'
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">条目对比视图</h2>
        <p class="page-sub">
          并排最多 3 条，逐项对照菌盖、菌褶/菌管与孢子印差异；差异项在对照表中高亮，便于核对鉴定口径。
        </p>
      </div>
      <el-tag type="warning" effect="plain">差异项 {{ diffCount }} / {{ diffRows.length }}</el-tag>
    </div>

    <el-card shadow="never" class="picker">
      <template #header>选择条目（已选 {{ selectedIds.length }} / 3）</template>
      <div class="picker-bar">
        <el-input v-model="keyword" placeholder="按编号 / 暂定名 / 树种筛选" clearable style="width: 280px" />
        <el-button @click="syncQuery">同步到地址栏</el-button>
        <el-button @click="selectedIds = []">清空选择</el-button>
      </div>
      <div class="chips">
        <el-check-tag
          v-for="item in candidatesList"
          :key="item.id"
          :checked="selectedIds.includes(item.id)"
          class="chip"
          @change="toggle(item.id)"
        >
          {{ item.code }} · {{ item.tempName || '未命名' }}
        </el-check-tag>
      </div>
    </el-card>

    <div v-if="selected.length > 0" class="columns">
      <el-card v-for="record in selected" :key="record.id" shadow="never" class="column">
        <template #header>
          <div class="col-head">
            <span class="mono">{{ record.code }}</span>
            <span class="col-name">{{ record.tempName || '未命名条目' }}</span>
          </div>
        </template>
        <div class="col-tags">
          <GillAttachmentTag :attachment="record.attachment" with-hint />
          <SporePrintSwatch :color="sporeOf(record.id)?.color ?? null" size="large" :caption="sporeOf(record.id) ? `获取 ${sporeOf(record.id)?.hours} h` : '未做印'" />
        </div>
        <TraitsSummary :record="record" :spore="sporeOf(record.id)" :default-open="['cap', 'gill']" compact />
        <p class="col-ident">鉴定结论：{{ conclusionOf(record.id) }}</p>
        <el-button size="small" @click="router.push(`/atlas/${record.id}`)">查看详情</el-button>
      </el-card>
    </div>
    <el-empty v-else description="请至少选择 1 条条目进行查看，2 条以上可对比差异" />

    <h3 v-if="selected.length > 1" class="section-title">逐项对照表</h3>
    <el-table v-if="selected.length > 1" :data="diffRows" border :row-class-name="diffRowClass">
      <el-table-column prop="label" label="对照项" width="150" />
      <el-table-column v-for="(record, index) in selected" :key="record.id" :label="record.code" min-width="180">
        <template #default="{ row }: { row: DiffRow }">
          <span :class="{ diff: !row.same }">{{ row.values[index] }}</span>
        </template>
      </el-table-column>
      <el-table-column label="是否一致" width="110">
        <template #default="{ row }: { row: DiffRow }">
          <el-tag :type="row.same ? 'success' : 'warning'" size="small" effect="plain">
            {{ row.same ? '一致' : '有差异' }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.picker {
  border-radius: 12px;
  margin-bottom: 16px;
}
.picker-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  font-size: 12px;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.column {
  border-radius: 12px;
}
.col-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.col-name {
  font-size: 14px;
  font-weight: 600;
}
.col-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.col-ident {
  margin: 10px 0;
  font-size: 12px;
  color: #6f7d72;
}
:deep(.diff-row) {
  background: #fdf3e7;
}
.diff {
  color: #a45b1f;
  font-weight: 600;
}
</style>
