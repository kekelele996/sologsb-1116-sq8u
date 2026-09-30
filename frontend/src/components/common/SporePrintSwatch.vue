<script setup lang="ts">
import { computed } from 'vue'
import type { SporeColor } from '@/types'
import { SPORE_COLOR_VALUES, SPORE_TEXT_VALUES } from '@/utils/spore'

const props = withDefaults(
  defineProps<{
    color: SporeColor | null
    /** 尺寸：small 用于列表，large 用于详情 */
    size?: 'small' | 'large'
    /** 是否显示色卡与色名 */
    withLabel?: boolean
    /** 附加说明（如印形、时长） */
    caption?: string
  }>(),
  { size: 'small', withLabel: true, caption: '' }
)

const value = computed(() => (props.color ? SPORE_COLOR_VALUES[props.color] : '#e9edf1'))
const textColor = computed(() => (props.color ? SPORE_TEXT_VALUES[props.color] : '#7a8896'))
</script>

<template>
  <div class="swatch" :class="size">
    <span class="chip" :style="{ background: value, color: textColor }">
      {{ color ?? '未记录' }}
    </span>
    <span v-if="withLabel" class="meta">
      <slot name="caption">{{ caption }}</slot>
    </span>
  </div>
</template>

<style scoped>
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid rgba(31, 45, 36, 0.18);
  font-size: 12px;
  letter-spacing: 0.5px;
}
.swatch.large .chip {
  min-width: 104px;
  height: 44px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}
.meta {
  font-size: 12px;
  color: #7a8896;
}
</style>
