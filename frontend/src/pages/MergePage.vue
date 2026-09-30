<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useStore } from '@/hooks/usePersistentStore'
import { mergeStore } from '@/stores/mergeStore'
import { pointStore } from '@/stores/pointStore'
import { FIELD_MORPHOLOGY_KEYS, FIELD_SPORE_KEYS } from '@/utils/merge'
import type { ConflictRow } from '@/types/batch'

const mergeState = useStore(mergeStore)
const pointState = useStore(pointStore)

const fileInput = ref<HTMLInputElement | null>(null)
const importing = computed(() => mergeState.importing)
const applying = computed(() => mergeState.applying)

const pendingConflicts = computed(() => mergeState.conflicts.filter((item) => item.status === 'pending'))
const handledConflicts = computed(() => mergeState.conflicts.filter((item) => item.status !== 'pending'))

const MORPH_LABELS: Record<string, string> = {
  tempName: '暂定名',
  fruitBodyCount: '子实体数量',
  capDiameter: '菌盖直径',
  capShape: '菌盖形状',
  capMargin: '菌盖边缘',
  capTexture: '表面质地',
  fleshThickness: '菌肉厚度',
  fleshReaction: '菌肉反应',
  attachment: '着生方式',
  gillDensity: '菌褶密度',
  stipeLength: '菌柄长度',
  stipeDiameter: '菌柄直径',
  ring: '菌环',
  volva: '菌托',
  odor: '气味',
  hostTree: '关联树种',
  collectDate: '采集日期',
  collector: '采集人',
  note: '备注'
}

const SPORE_LABELS: Record<string, string> = {
  color: '印色',
  shape: '印形',
  hours: '获取时长',
  observeDate: '观察日期',
  moisture: '样本干湿度'
}

interface DiffRow {
  label: string
  field: string
  atlas: string
  diff: boolean
}

function morphDiffs(conflict: ConflictRow): DiffRow[] {
  return FIELD_MORPHOLOGY_KEYS.map((key) => {
    const f = String(conflict.field.record[key] ?? '')
    const a = String(conflict.atlas.record[key] ?? '')
    return { label: MORPH_LABELS[key] ?? key, field: f, atlas: a, diff: f !== a }
  }).filter((row) => row.diff)
}

function sporeDiffs(conflict: ConflictRow): DiffRow[] {
  return FIELD_SPORE_KEYS.map((key) => {
    const f = conflict.field.spore ? String(conflict.field.spore[key] ?? '') : '—'
    const a = conflict.atlas.spore ? String(conflict.atlas.spore[key] ?? '') : '—'
    return { label: SPORE_LABELS[key] ?? key, field: f, atlas: a, diff: f !== a }
  }).filter((row) => row.diff)
}

function pointName(pointId: string): string {
  return pointState.points.find((point) => point.id === pointId)?.name ?? '未关联采集点'
}

function latestConclusion(conflict: ConflictRow): string {
  const logs = conflict.atlas.logs
  return logs.length > 0 ? logs[0].conclusion : '尚无鉴定留痕'
}

function triggerImport(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const result = await mergeStore.getState().importBatchText(text)
  if (result.ok && result.summary) {
    const s = result.summary
    if (s.alreadyApplied) {
      ElMessage.warning(`该批次（${s.batchId}）已合并过，重复导入不会新增条目`)
    }
    ElMessage.success(
      `批次已读取：新增 ${s.added} 条 · 冲突 ${s.conflicts} 条 · 一致跳过 ${s.same} 条。请逐条确认冲突后提交。`
    )
  } else {
    ElMessage.error(result.error ?? '批次导入失败')
  }
  input.value = ''
}

async function setChoice(conflictId: string, choice: 'field' | 'atlas'): Promise<void> {
  await mergeStore.getState().setChoice(conflictId, choice)
}

async function discard(conflictId: string): Promise<void> {
  await mergeStore.getState().discardConflict(conflictId)
}

async function applyAll(): Promise<void> {
  if (pendingConflicts.value.length > 0) {
    const unconfirmed = pendingConflicts.value.filter((item) => item.choice === 'atlas')
    if (unconfirmed.length > 0) {
      ElMessage.info(`有 ${unconfirmed.length} 条选择保留图谱库形态，提交时将按图谱库版本落地`)
    }
  }
  const result = await mergeStore.getState().applyAll()
  if (result.ok) {
    ElMessage.success(`合并完成：新增 ${result.added} 条 · 落地冲突 ${result.updated} 条`)
  } else {
    ElMessage.error(`合并失败，已回滚到本地上一版：${result.error ?? ''}`)
  }
}

onMounted(() => {
  if (!mergeState.loaded) void mergeStore.getState().hydrate()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">外业批次合并</h2>
        <p class="page-sub">
          平板离线登记的批次带回后在此合并：形态与孢子印按外业那份算，鉴定留痕与采集点按图谱库那份算；两版都留着逐条认。
        </p>
      </div>
      <div class="head-actions">
        <el-button :loading="importing" @click="triggerImport">
          <el-icon><Upload /></el-icon>导入外业批次
        </el-button>
        <el-button type="primary" plain @click="mergeStore.getState().exportBatch()">
          <el-icon><Download /></el-icon>导出当前批次
        </el-button>
        <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onFileChange" />
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      title="合并规则"
      description="同一采集编号两边都动过：形态与孢子印采用外业版本；采集点与鉴定留痕沿用图谱库版本。冲突不会直接覆盖，两版快照都保留，逐条确认后才在一个事务内落地——失败自动回滚到本地上一版，同一批次重复提交不会新增条目。"
      class="rule-alert"
    />

    <div v-if="mergeState.lastResult" class="last-result">
      <el-tag v-if="mergeState.lastResult.ok" type="success" effect="dark">
        上次合并成功：新增 {{ mergeState.lastResult.added }} · 落地 {{ mergeState.lastResult.updated }}
      </el-tag>
      <el-tag v-else type="danger" effect="dark">
        上次合并失败已回滚：{{ mergeState.lastResult.error }}
      </el-tag>
    </div>

    <div class="section-bar">
      <h3 class="section-title">待逐条认（{{ pendingConflicts.length }}）</h3>
      <el-button type="primary" :loading="applying" :disabled="pendingConflicts.length === 0" @click="applyAll">
        提交合并（{{ pendingConflicts.length }} 条待认）
      </el-button>
    </div>

    <el-empty v-if="pendingConflicts.length === 0" description="暂无待确认的冲突。导入外业批次后，有差异的采集编号会列在这里" />

    <div class="conflict-list">
      <el-card v-for="conflict in pendingConflicts" :key="conflict.id" shadow="never" class="conflict-card">
        <template #header>
          <div class="conflict-head">
            <span class="mono code">{{ conflict.code }}</span>
            <el-tag size="small" type="warning" effect="plain">两边都动过</el-tag>
            <el-tag size="small" effect="plain">批次 {{ conflict.batchId.slice(0, 10) }}</el-tag>
          </div>
        </template>

        <el-row :gutter="16">
          <el-col :span="12">
            <div class="side field-side">
              <div class="side-title">外业版本（形态 / 孢子印归属方）</div>
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item v-for="row in morphDiffs(conflict)" :key="row.label" :label="row.label">
                  <span class="diff-value">{{ row.field }}</span>
                </el-descriptions-item>
                <el-descriptions-item v-for="row in sporeDiffs(conflict)" :key="`sp-${row.label}`" :label="`孢子印·${row.label}`">
                  <span class="diff-value">{{ row.field }}</span>
                </el-descriptions-item>
              </el-descriptions>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="side atlas-side">
              <div class="side-title">图谱库版本（采集点 / 鉴定留痕归属方）</div>
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item v-for="row in morphDiffs(conflict)" :key="row.label" :label="row.label">
                  <span class="muted">{{ row.atlas }}</span>
                </el-descriptions-item>
                <el-descriptions-item v-for="row in sporeDiffs(conflict)" :key="`sp-${row.label}`" :label="`孢子印·${row.label}`">
                  <span class="muted">{{ row.atlas }}</span>
                </el-descriptions-item>
              </el-descriptions>
            </div>
          </el-col>
        </el-row>

        <div class="atlas-own">
          <el-tag size="small" type="info" effect="plain">采集点（图谱库）：{{ pointName(conflict.atlas.record.pointId) }}</el-tag>
          <el-tag size="small" type="info" effect="plain">鉴定留痕（图谱库）：{{ latestConclusion(conflict) }}</el-tag>
        </div>

        <div class="choice-bar">
          <el-radio-group
            :model-value="conflict.choice"
            @update:model-value="(value: 'field' | 'atlas') => setChoice(conflict.id, value)"
          >
            <el-radio value="field">采用外业形态与孢子印</el-radio>
            <el-radio value="atlas">保留图谱库形态与孢子印</el-radio>
          </el-radio-group>
          <el-button link type="info" size="small" @click="discard(conflict.id)">丢弃该冲突（不合并）</el-button>
        </div>
      </el-card>
    </div>

    <h3 class="section-title">已处理（{{ handledConflicts.length }}）</h3>
    <el-empty v-if="handledConflicts.length === 0" description="暂无已处理记录" :image-size="60" />
    <el-table v-else :data="handledConflicts" border stripe size="small" class="handled-table">
      <el-table-column prop="code" label="采集编号" width="160" />
      <el-table-column label="结果" width="140">
        <template #default="{ row }: { row: ConflictRow }">
          <el-tag v-if="row.status === 'resolved'" type="success" size="small">已落地</el-tag>
          <el-tag v-else type="info" size="small">已丢弃</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="形态/孢子印选择" width="200">
        <template #default="{ row }: { row: ConflictRow }">
          {{ row.status === 'discarded' ? '—' : row.choice === 'field' ? '采用外业' : '保留图谱库' }}
        </template>
      </el-table-column>
      <el-table-column prop="batchId" label="批次" min-width="180" show-overflow-tooltip />
    </el-table>

    <h3 class="section-title">批次历史（{{ mergeState.batches.length }}）</h3>
    <el-empty v-if="mergeState.batches.length === 0" description="尚无合并记录" :image-size="60" />
    <el-table v-else :data="mergeState.batches" border stripe size="small">
      <el-table-column prop="batchId" label="批次号" min-width="200" show-overflow-tooltip />
      <el-table-column label="导出设备" width="140">
        <template #default="{ row }: { row: { device: string } }">{{ row.device || '—' }}</template>
      </el-table-column>
      <el-table-column label="应用时间" width="180">
        <template #default="{ row }: { row: { appliedAt: string } }">{{ row.appliedAt.replace('T', ' ').slice(0, 19) }}</template>
      </el-table-column>
      <el-table-column label="新增" width="80">
        <template #default="{ row }: { row: { added: number } }">{{ row.added }}</template>
      </el-table-column>
      <el-table-column label="落地" width="80">
        <template #default="{ row }: { row: { updated: number } }">{{ row.updated }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }: { row: { status: string } }">
          <el-tag v-if="row.status === 'applied'" type="success" size="small">已应用</el-tag>
          <el-tag v-else type="danger" size="small">失败</el-tag>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.rule-alert {
  margin: 12px 0;
}
.last-result {
  margin: 0 0 12px;
}
.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 8px;
}
.section-title {
  margin: 16px 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.conflict-card {
  border-radius: 12px;
}
.conflict-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code {
  font-size: 14px;
  color: #2f6f8f;
}
.side {
  border-radius: 8px;
  padding: 8px;
}
.field-side {
  background: #fdf6ee;
  border: 1px solid #f0d9bd;
}
.atlas-side {
  background: #f4f7f4;
  border: 1px solid #d6e2d8;
}
.side-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #6f7d72;
}
.diff-value {
  color: #a45b1f;
  font-weight: 600;
}
.muted {
  color: #7f8d82;
}
.atlas-own {
  display: flex;
  gap: 8px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.choice-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed #e8e2d6;
}
.handled-table {
  margin-bottom: 8px;
}
</style>
