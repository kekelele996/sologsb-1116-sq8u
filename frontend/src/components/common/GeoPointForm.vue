<script setup lang="ts">
import { computed } from 'vue'
import { SUBSTRATES, VEGETATIONS, type CollectPoint, type Substrate, type Vegetation } from '@/types'

const props = defineProps<{
  modelValue: CollectPoint
  /** 是否显示采集日期与采集人 */
  withMeta?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: CollectPoint): void
}>()

function patch(next: Partial<CollectPoint>): void {
  emit('update:modelValue', { ...props.modelValue, ...next })
}

/** 经纬度格式校验 */
const coordError = computed<string | null>(() => {
  const { longitude, latitude } = props.modelValue
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return '经纬度必须是数字'
  if (longitude < -180 || longitude > 180) return '经度必须在 -180 ~ 180 之间'
  if (latitude < -90 || latitude > 90) return '纬度必须在 -90 ~ 90 之间'
  if (longitude === 0 && latitude === 0) return '经纬度不能同时为 0（请填写真实坐标）'
  return null
})
</script>

<template>
  <div class="geo-form">
    <div class="grid">
      <label class="cell">
        <span class="lab">采集点名称</span>
        <el-input
          :model-value="modelValue.name"
          :disabled="disabled"
          placeholder="如 百花山栎树林样线"
          @update:model-value="(value: string) => patch({ name: value })"
        />
      </label>
      <label class="cell">
        <span class="lab">经度</span>
        <el-input-number
          :model-value="modelValue.longitude"
          :disabled="disabled"
          :precision="4"
          :step="0.0001"
          :controls="false"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => patch({ longitude: Number(value ?? 0) })"
        />
      </label>
      <label class="cell">
        <span class="lab">纬度</span>
        <el-input-number
          :model-value="modelValue.latitude"
          :disabled="disabled"
          :precision="4"
          :step="0.0001"
          :controls="false"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => patch({ latitude: Number(value ?? 0) })"
        />
      </label>
      <label class="cell">
        <span class="lab">海拔（m）</span>
        <el-input-number
          :model-value="modelValue.altitude"
          :disabled="disabled"
          :precision="0"
          :controls="false"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => patch({ altitude: Number(value ?? 0) })"
        />
      </label>
      <label class="cell">
        <span class="lab">植被类型</span>
        <el-select
          :model-value="modelValue.vegetation"
          :disabled="disabled"
          style="width: 100%"
          @update:model-value="(value: Vegetation) => patch({ vegetation: value })"
        >
          <el-option v-for="item in VEGETATIONS" :key="item" :label="item" :value="item" />
        </el-select>
      </label>
      <label class="cell">
        <span class="lab">基物</span>
        <el-select
          :model-value="modelValue.substrate"
          :disabled="disabled"
          style="width: 100%"
          @update:model-value="(value: Substrate) => patch({ substrate: value })"
        >
          <el-option v-for="item in SUBSTRATES" :key="item" :label="item" :value="item" />
        </el-select>
      </label>
      <label class="cell wide">
        <span class="lab">伴生树种</span>
        <el-input
          :model-value="modelValue.companionTrees"
          :disabled="disabled"
          placeholder="如 辽东栎、油松"
          @update:model-value="(value: string) => patch({ companionTrees: value })"
        />
      </label>
      <template v-if="withMeta">
        <label class="cell">
          <span class="lab">采集日期</span>
          <el-date-picker
            :model-value="modelValue.collectDate"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            @update:model-value="(value: string | null) => patch({ collectDate: value ?? '' })"
          />
        </label>
        <label class="cell">
          <span class="lab">采集人</span>
          <el-input
            :model-value="modelValue.collector"
            :disabled="disabled"
            @update:model-value="(value: string) => patch({ collector: value })"
          />
        </label>
      </template>
    </div>
    <p v-if="coordError" class="err">{{ coordError }}</p>
    <p v-else class="ok">坐标校验通过：{{ modelValue.longitude.toFixed(4) }}, {{ modelValue.latitude.toFixed(4) }}</p>
  </div>
</template>

<style scoped>
.geo-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cell.wide {
  grid-column: span 2;
}
.lab {
  font-size: 12px;
  color: #6b7b8c;
}
.err {
  margin: 0;
  font-size: 12px;
  color: #c0392b;
}
.ok {
  margin: 0;
  font-size: 12px;
  color: #1f8a70;
}
</style>
