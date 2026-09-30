<script setup lang="ts">
import { computed } from 'vue'
import type { GillAttachment } from '@/types'

const props = withDefaults(
  defineProps<{
    attachment: GillAttachment
    /** 是否附带释义 */
    withHint?: boolean
  }>(),
  { withHint: false }
)

const COLORS: Record<GillAttachment, string> = {
  离生: '#8e6bbf',
  弯生: '#2f6f8f',
  直生: '#1f8a70',
  延生: '#c98a1b'
}

const HINTS: Record<GillAttachment, string> = {
  离生: '菌褶不与菌柄相连',
  弯生: '菌褶上弯与柄相接',
  直生: '菌褶垂直着生于柄',
  延生: '菌褶沿柄向下延伸'
}

const color = computed(() => COLORS[props.attachment] ?? '#6b7280')
</script>

<template>
  <span class="gill-tag" :style="{ '--tag-color': color }" :title="HINTS[attachment]">
    <i class="dot" />
    {{ attachment }}
    <em v-if="withHint">{{ HINTS[attachment] }}</em>
  </span>
</template>

<style scoped>
.gill-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--tag-color) 38%, transparent);
  white-space: nowrap;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tag-color);
}
em {
  font-style: normal;
  color: #7a8896;
  font-size: 11px;
}
</style>
