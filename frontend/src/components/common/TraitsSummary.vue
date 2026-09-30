<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FungusRecord, SporePrint } from '@/types'
import GillAttachmentTag from './GillAttachmentTag.vue'
import SporePrintSwatch from './SporePrintSwatch.vue'

const props = withDefaults(
  defineProps<{
    record: FungusRecord
    spore?: SporePrint | null
    /** 默认展开的分区 */
    defaultOpen?: string[]
    /** 是否紧凑模式（用于对比视图） */
    compact?: boolean
  }>(),
  { spore: null, defaultOpen: () => ['cap', 'gill'], compact: false }
)

const open = ref<string[]>([...props.defaultOpen])

function toggle(key: string): void {
  open.value = open.value.includes(key) ? open.value.filter((item) => item !== key) : [...open.value, key]
}

interface Row {
  label: string
  value: string
}

const capRows = computed<Row[]>(() => [
  { label: '菌盖直径', value: `${props.record.capDiameter} cm` },
  { label: '菌盖形状', value: props.record.capShape },
  { label: '菌盖边缘', value: props.record.capMargin },
  { label: '表面质地', value: props.record.capTexture }
])

const fleshRows = computed<Row[]>(() => [
  { label: '菌肉厚度', value: `${props.record.fleshThickness} cm` },
  { label: '变色反应', value: props.record.fleshReaction }
])

const gillRows = computed<Row[]>(() => [
  { label: '着生方式', value: props.record.attachment },
  { label: '菌褶密度', value: props.record.gillDensity }
])

const stipeRows = computed<Row[]>(() => [
  { label: '菌柄长度', value: `${props.record.stipeLength} cm` },
  { label: '菌柄直径', value: `${props.record.stipeDiameter} cm` },
  { label: '菌环', value: props.record.ring },
  { label: '菌托', value: props.record.volva }
])

const ecoRows = computed<Row[]>(() => [
  { label: '气味', value: props.record.odor || '—' },
  { label: '关联树种', value: props.record.hostTree || '—' },
  { label: '子实体数量', value: `${props.record.fruitBodyCount} 个` },
  { label: '采集日期', value: props.record.collectDate }
])

const sections = computed(() => [
  { key: 'cap', title: '菌盖', rows: capRows.value },
  { key: 'flesh', title: '菌肉', rows: fleshRows.value },
  { key: 'gill', title: '菌褶 / 菌管', rows: gillRows.value },
  { key: 'stipe', title: '菌柄 / 菌环菌托', rows: stipeRows.value },
  { key: 'eco', title: '气味与生境', rows: ecoRows.value }
])
</script>

<template>
  <div class="traits" :class="{ compact }">
    <div class="head">
      <span class="code">{{ record.code }}</span>
      <span class="name">{{ record.tempName || '未命名条目' }}</span>
      <GillAttachmentTag :attachment="record.attachment" />
      <SporePrintSwatch :color="spore?.color ?? null" :caption="spore ? `${spore.hours} h` : '未做印'" />
    </div>
    <section v-for="section in sections" :key="section.key" class="block">
      <button type="button" class="block-head" @click="toggle(section.key)">
        <span>{{ section.title }}</span>
        <span class="arrow">{{ open.includes(section.key) ? '−' : '+' }}</span>
      </button>
      <dl v-show="open.includes(section.key)" class="rows">
        <div v-for="row in section.rows" :key="row.label" class="row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.traits {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #dde6ee;
}
.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #2f6f8f;
}
.name {
  font-size: 14px;
  font-weight: 600;
  color: #2b3a2f;
}
.block {
  border-radius: 8px;
}
.block-head {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: #f3f6f8;
  font-size: 12px;
  color: #3c4b57;
  cursor: pointer;
}
.arrow {
  color: #8a97a3;
}
.rows {
  margin: 4px 0 0;
  padding: 0 8px;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
  border-bottom: 1px dotted #eef2f6;
}
.row dt {
  color: #7a8896;
  white-space: nowrap;
}
.row dd {
  margin: 0;
  text-align: right;
  color: #2b3a2f;
}
.compact .rows {
  padding: 0 4px;
}
</style>
