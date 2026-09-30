<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FieldBatch, FieldGroup, MergePlan, ResolveSide } from '@/types/sync'
import { FIELD_GROUPS } from '@/types/sync'
import { BatchAlreadyMergedError } from '@/types/sync'
import { useStore } from '@/hooks/usePersistentStore'
import { syncStore } from '@/stores/syncStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { downloadJson } from '@/utils/export'
import { sampleFieldBatch } from '@/utils/sampleBatch'

const syncState = useStore(syncStore)
const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const previewBatch = ref<FieldBatch | null>(null)
const previewPlan = ref<MergePlan | null>(null)
const merging = ref(false)
const parseError = ref('')
/** 合并前是否发生过回滚（用于提示“已保住本地上一版”） */
const lastRolledBack = ref(false)

const pendingConflicts = computed(() => syncState.conflicts.filter((c) => c.status === 'pending'))
const resolvedConflicts = computed(() => syncState.conflicts.filter((c) => c.status === 'resolved'))

/** 重新拉取四张业务表，合并/改判后图谱与鉴定页立即反映 */
async function rehydrateBusiness(): Promise<void> {
  await Promise.all([
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    pointStore.getState().hydrate(),
    identifyStore.getState().hydrate()
  ])
}

async function onPickFile(): Promise<void> {
  parseError.value = ''
  previewBatch.value = null
  previewPlan.value = null
  const file = fileInput.value?.files?.[0]
  if (!file) return
  fileName.value = file.name
  try {
    const raw = JSON.parse(await file.text()) as unknown
    const { batch, plan } = await syncStore.getState().preview(raw)
    previewBatch.value = batch
    previewPlan.value = plan
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function doMerge(): Promise<void> {
  if (!previewBatch.value) return
  merging.value = true
  try {
    const { plan, rolledBack } = await syncStore.getState().mergeBatch(previewBatch.value)
    lastRolledBack.value = rolledBack
    await rehydrateBusiness()
    ElMessage.success(
      `批次合并完成：新增 ${plan.stats.inserted} 条、更新 ${plan.stats.updated} 条、待逐条认冲突 ${plan.stats.conflicts} 处`
    )
    previewBatch.value = null
    previewPlan.value = null
    fileName.value = ''
  } catch (error) {
    if (error instanceof BatchAlreadyMergedError) {
      ElMessage.info(error.message)
    } else {
      ElMessage.error(`合并中途失败，已保住本地上一版（数据已回滚）：${(error as Error).message}。可按外业批次这一侧重试`)
    }
  } finally {
    merging.value = false
  }
}

async function retry(batchId: string): Promise<void> {
  merging.value = true
  try {
    const { plan } = await syncStore.getState().retryBatch(batchId)
    await rehydrateBusiness()
    ElMessage.success(`已按外业批次重试成功：新增 ${plan.stats.inserted}、更新 ${plan.stats.updated}，未产生重复条目`)
  } catch (error) {
    if (error instanceof BatchAlreadyMergedError) ElMessage.info(error.message)
    else ElMessage.error(`重试仍失败，本地数据维持上一版：${(error as Error).message}`)
  } finally {
    merging.value = false
  }
}

/** 各冲突分组当前选择（形态/孢子印可改判；鉴定/采集点锁定图谱库） */
function sideOf(conflictId: string, group: FieldGroup): ResolveSide {
  const conflict = syncState.conflicts.find((c) => c.id === conflictId)
  return conflict?.resolution[group] ?? 'field'
}

async function chooseSide(conflictId: string, group: FieldGroup, side: ResolveSide): Promise<void> {
  await syncStore.getState().resolveConflict(conflictId, { [group]: side })
  await rehydrateBusiness()
  ElMessage.success('裁决已落库，可继续逐条认其余冲突')
}

async function downloadSample(): Promise<void> {
  const batch = await sampleFieldBatch()
  downloadJson(`field-batch-${batch.batchId}.json`, batch)
}

function statusLabel(status: string): { text: string; type: 'success' | 'warning' | 'info' } {
  if (status === 'merged') return { text: '已合并', type: 'success' }
  if (status === 'failed') return { text: '失败待重试', type: 'warning' }
  return { text: '已导入', type: 'info' }
}

async function clearPreview(): Promise<void> {
  await ElMessageBox.confirm('清空该批次的预检结果？（不会删除已合并数据）', '提示', { type: 'info' })
  previewBatch.value = null
  previewPlan.value = null
  fileName.value = ''
  parseError.value = ''
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">外业批次合并</h2>
        <p class="page-sub">
          同伴平板离线登记的批次按「采集编号」并入图谱库：形态与孢子印默认按外业那份，鉴定留痕与采集点按图谱库那份；
          同号两边都动过的两版都留着，可逐条认。合并失败自动回滚到本地上一版，同一批次重送不多出条目。
        </p>
      </div>
      <div class="head-actions">
        <el-button @click="downloadSample">下载外业批次样例</el-button>
      </div>
    </div>

    <el-card shadow="never" class="block">
      <template #header><span>1. 选择外业批次文件（.json）</span></template>
      <div class="import-row">
        <input ref="fileInput" type="file" accept="application/json,.json" class="file-input" @change="onPickFile" />
        <span v-if="fileName" class="muted">已选择：{{ fileName }}</span>
        <el-button v-if="previewPlan" size="small" link type="info" @click="clearPreview">清除预检</el-button>
      </div>
      <el-alert v-if="parseError" :title="parseError" type="error" :closable="false" class="alert" />

      <template v-if="previewBatch && previewPlan">
        <el-descriptions :column="3" border class="desc">
          <el-descriptions-item label="批次号">{{ previewBatch.batchId }}</el-descriptions-item>
          <el-descriptions-item label="导出时间">{{ previewBatch.exportedAt }}</el-descriptions-item>
          <el-descriptions-item label="设备">{{ previewBatch.device || '—' }}</el-descriptions-item>
          <el-descriptions-item label="条目总数">{{ previewPlan.stats.total }}</el-descriptions-item>
          <el-descriptions-item label="新增条目">{{ previewPlan.stats.inserted }}</el-descriptions-item>
          <el-descriptions-item label="同号更新">{{ previewPlan.stats.updated }}</el-descriptions-item>
          <el-descriptions-item label="新增采集点">{{ previewPlan.stats.pointsInserted }}</el-descriptions-item>
          <el-descriptions-item label="补登孢子印">{{ previewPlan.stats.sporesInserted }}</el-descriptions-item>
          <el-descriptions-item label="两边都动过">
            <el-tag type="danger" size="small" effect="plain">{{ previewPlan.stats.conflicts }} 处待认</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-table :data="previewPlan.items" border stripe size="small" class="plan-table">
          <el-table-column prop="code" label="采集编号" width="170" />
          <el-table-column label="类型" width="100">
            <template #default="{ row }">
              <el-tag :type="row.kind === 'new' ? 'success' : 'warning'" size="small">
                {{ row.kind === 'new' ? '新增' : '同号' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="默认处理">
            <template #default="{ row }">
              <template v-if="row.kind === 'new'">外业整份入库（含孢子印与外业鉴定留痕）</template>
              <template v-else>
                形态 / 孢子印取外业
                <template v-if="row.fieldSpore && !row.atlasSpore">；图谱库缺印，补登外业孢子印</template>
                ；鉴定留痕、采集点保留图谱库
              </template>
            </template>
          </el-table-column>
        </el-table>

        <div class="form-actions">
          <el-button type="primary" :loading="merging" @click="doMerge">执行合并</el-button>
          <span class="muted">合并前会自动备份本地上一版；中途失败整体回滚。</span>
        </div>
      </template>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>
        <span>2. 冲突逐条认（{{ pendingConflicts.length }} 处待认 · {{ resolvedConflicts.length }} 处已认）</span>
      </template>
      <el-empty v-if="syncState.conflicts.length === 0" description="暂无同号两边都动过的冲突" />
      <div v-for="conflict in syncState.conflicts" :key="conflict.id" class="conflict" :class="{ resolved: conflict.status === 'resolved' }">
        <div class="conflict-head">
          <span class="mono">{{ conflict.code }}</span>
          <el-tag size="small" :type="conflict.status === 'pending' ? 'danger' : 'success'" effect="plain">
            {{ conflict.status === 'pending' ? '待逐条认' : '已认' }}
          </el-tag>
          <span class="muted">批次 {{ conflict.batchId }}</span>
        </div>

        <el-table :data="conflict.diffs" border size="small" class="diff-table">
          <el-table-column prop="label" label="分歧项" width="150" />
          <el-table-column label="图谱库那份" min-width="160">
            <template #default="{ row }">
              <span :class="{ chosen: sideOf(conflict.id, row.group) === 'atlas' }">{{ String(row.atlas) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="外业那份（默认）" min-width="160">
            <template #default="{ row }">
              <span :class="{ chosen: sideOf(conflict.id, row.group) === 'field' }">{{ String(row.field) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="裁决" width="230">
            <template #default="{ row }">
              <el-radio-group
                :model-value="sideOf(conflict.id, row.group)"
                size="small"
                @update:model-value="(v: ResolveSide) => chooseSide(conflict.id, row.group, v)"
              >
                <el-radio-button value="field">取外业</el-radio-button>
                <el-radio-button value="atlas">取图谱库</el-radio-button>
              </el-radio-group>
            </template>
          </el-table-column>
        </el-table>

        <div class="locked-line">
          <el-tag v-for="g in FIELD_GROUPS.filter((x) => x.locked)" :key="g.key" size="small" type="info" effect="plain">
            {{ g.label }}：恒按图谱库（{{ g.hint }}）
          </el-tag>
          <el-tag
            v-if="conflict.groups.includes('morphology') && conflict.status === 'pending'"
            size="small"
            type="warning"
            effect="plain"
          >
            形态当前：{{ sideOf(conflict.id, 'morphology') === 'field' ? '取外业' : '取图谱库' }}
          </el-tag>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header><span>3. 外业批次记录（失败可按外业侧重试，已合并批次重送不多出条目）</span></template>
      <el-table :data="syncState.batches" border stripe size="small">
        <el-table-column prop="batchId" label="批次号" width="200" />
        <el-table-column prop="exportedAt" label="外业导出时间" width="120" />
        <el-table-column prop="device" label="设备" width="120">
          <template #default="{ row }">{{ row.device || '—' }}</template>
        </el-table-column>
        <el-table-column label="结果" min-width="220">
          <template #default="{ row }">
            <el-tag :type="statusLabel(row.status).type" size="small">{{ statusLabel(row.status).text }}</el-tag>
            <span v-if="row.stats" class="muted">
              新增 {{ row.stats.inserted }} · 更新 {{ row.stats.updated }} · 冲突 {{ row.stats.conflicts }}
            </span>
            <p v-if="row.error" class="err-text">失败原因：{{ row.error }}</p>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button v-if="row.status === 'failed'" size="small" type="warning" :loading="merging" @click="retry(row.batchId)">
              按外业侧重试
            </el-button>
            <span v-else class="muted">幂等已守</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="syncState.batches.length === 0" description="尚未导入过外业批次" />
    </el-card>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
.block {
  border-radius: 12px;
  margin-bottom: 16px;
}
.import-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.file-input {
  font-size: 13px;
}
.alert {
  margin-top: 10px;
}
.desc {
  margin-top: 14px;
}
.plan-table {
  margin-top: 12px;
}
.form-actions {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.conflict {
  border: 1px solid #ecd9c8;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.conflict.resolved {
  border-color: #bfe0cc;
  background: #f6fbf8;
}
.conflict-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.diff-table {
  margin-bottom: 8px;
}
.chosen {
  font-weight: 700;
  color: #c96f3a;
}
.locked-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.err-text {
  margin: 4px 0 0;
  color: #c0392b;
  font-size: 12px;
}
.muted {
  color: #7f8d82;
  font-size: 12px;
}
</style>
