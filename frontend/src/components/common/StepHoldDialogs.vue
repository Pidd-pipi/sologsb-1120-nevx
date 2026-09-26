<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { usePartStore } from '../../stores/partStore';
import { useStepStore } from '../../stores/stepStore';
import { activeHold, settledWaitDays, type RepairStep } from '../../types/step';
import { daysBetween } from '../../utils/timeCalc';

/**
 * 工序停工 / 复工对话框。
 * 页面通过 ref 调用 openHold(step) / openResume(step)，数据直接走 store。
 */
const partStore = usePartStore();
const stepStore = useStepStore();

const target = ref<RepairStep | null>(null);

/* ---------- 停工 ---------- */
const holdVisible = ref(false);
const holdError = ref('');
const holdForm = reactive<{ partId: string; reason: string; expectedAt: Date | null }>({
  partId: '',
  reason: '',
  expectedAt: null,
});

const clockParts = computed(() => (target.value ? partStore.byClock(target.value.clockId) : []));

function openHold(step: RepairStep) {
  target.value = step;
  holdError.value = '';
  holdForm.partId = '';
  holdForm.reason = '';
  holdForm.expectedAt = null;
  holdVisible.value = true;
}

async function submitHold() {
  if (!target.value) return;
  holdError.value = '';
  if (!holdForm.partId) {
    holdError.value = '请选择缺件零件';
    return;
  }
  if (!holdForm.reason.trim()) {
    holdError.value = '请填写停工原因';
    return;
  }
  if (!holdForm.expectedAt) {
    holdError.value = '请选择预计到件日';
    return;
  }
  try {
    await stepStore.hold(target.value.id, {
      partId: holdForm.partId,
      reason: holdForm.reason,
      expectedAt: holdForm.expectedAt.getTime(),
    });
    holdVisible.value = false;
    ElMessage.warning(`工序 #${target.value.seq} 已停工，等待配件到件`);
  } catch (err) {
    holdError.value = err instanceof Error ? err.message : String(err);
  }
}

/* ---------- 复工 ---------- */
const resumeVisible = ref(false);
const resumeError = ref('');
const resumeForm = reactive<{ operator: string; resumedAt: Date | null }>({
  operator: '',
  resumedAt: new Date(),
});
const lotDraft = ref('');

const currentHold = computed(() => (target.value ? activeHold(target.value) : undefined));
const resumePart = computed(() => (currentHold.value ? partStore.byId(currentHold.value.partId) : undefined));
/** 缺件已换新且写好来源批号 */
const partReady = computed(
  () =>
    !!resumePart.value &&
    resumePart.value.decision === '换新' &&
    resumePart.value.sourceLot.trim() !== '',
);
const waitDaysPreview = computed(() =>
  currentHold.value && resumeForm.resumedAt
    ? daysBetween(currentHold.value.heldAt, resumeForm.resumedAt.getTime())
    : 0,
);
const cumulativePreview = computed(
  () => (target.value ? settledWaitDays(target.value) : 0) + waitDaysPreview.value,
);

function openResume(step: RepairStep) {
  target.value = step;
  resumeError.value = '';
  resumeForm.operator = '';
  resumeForm.resumedAt = new Date();
  lotDraft.value = '';
  resumeVisible.value = true;
}

/** 复工日期不得早于停工日期 */
function disableBeforeHold(date: Date): boolean {
  const held = currentHold.value?.heldAt ?? 0;
  const day = new Date(held);
  day.setHours(0, 0, 0, 0);
  return date.getTime() < day.getTime();
}

/** 快捷处理：把缺件标记为换新并写入来源批号 */
async function markPartReplaced() {
  if (!resumePart.value) return;
  resumeError.value = '';
  if (!lotDraft.value.trim()) {
    resumeError.value = '请填写来源批号';
    return;
  }
  await partStore.update(resumePart.value.id, {
    decision: '换新',
    sourceLot: lotDraft.value.trim(),
  });
  lotDraft.value = '';
  ElMessage.success('缺件已标记换新并登记来源批号');
}

async function submitResume() {
  if (!target.value) return;
  resumeError.value = '';
  if (!partReady.value) {
    resumeError.value = '缺件尚未标记换新并填写来源批号，暂不能复工';
    return;
  }
  if (!resumeForm.operator.trim()) {
    resumeError.value = '请填写经手人';
    return;
  }
  if (!resumeForm.resumedAt) {
    resumeError.value = '请选择实际复工日期';
    return;
  }
  try {
    await stepStore.resume(target.value.id, {
      operator: resumeForm.operator,
      resumedAt: resumeForm.resumedAt.getTime(),
    });
    resumeVisible.value = false;
    ElMessage.success(`工序 #${target.value.seq} 已复工，本次等待 ${waitDaysPreview.value} 天`);
  } catch (err) {
    resumeError.value = err instanceof Error ? err.message : String(err);
  }
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString('zh-CN');
}

defineExpose({ openHold, openResume });
</script>

<template>
  <!-- 停工：选择缺件、填写原因与预计到件日 -->
  <el-dialog v-model="holdVisible" title="停工 · 等待配件" width="520px">
    <template v-if="target">
      <el-alert v-if="holdError" :title="holdError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-alert
        v-if="clockParts.length === 0"
        title="该钟表尚未登记零件，请先到「零件清单」登记缺件后再办理停工"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 10px"
      />
      <el-form label-width="110px">
        <el-form-item label="工序">
          <span>#{{ target.seq }} {{ target.stepType }} · 经手人 {{ target.operator }}</span>
        </el-form-item>
        <el-form-item label="缺件零件" required>
          <el-select v-model="holdForm.partId" style="width: 100%" placeholder="选择缺少的零件">
            <el-option
              v-for="p in clockParts"
              :key="p.id"
              :label="`${p.name} · ${p.position}（${p.wearState} / ${p.decision}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="停工原因" required>
          <el-input
            v-model="holdForm.reason"
            type="textarea"
            :rows="3"
            placeholder="如 擒纵叉叉瓦碎裂，需等待新件"
          />
        </el-form-item>
        <el-form-item label="预计到件日" required>
          <el-date-picker
            v-model="holdForm.expectedAt"
            type="date"
            placeholder="选择日期"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="holdVisible = false">取消</el-button>
      <el-button type="warning" :disabled="clockParts.length === 0" @click="submitHold">确认停工</el-button>
    </template>
  </el-dialog>

  <!-- 复工：核对换新与来源批号，原经手人办理 -->
  <el-dialog v-model="resumeVisible" title="复工 · 配件到件" width="560px">
    <template v-if="target && currentHold">
      <el-alert v-if="resumeError" :title="resumeError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-descriptions :column="1" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="工序">#{{ target.seq }} {{ target.stepType }}</el-descriptions-item>
        <el-descriptions-item label="缺件">
          <span v-if="resumePart">{{ resumePart.name }} · {{ resumePart.position }}</span>
          <span v-else>（零件记录已删除）</span>
        </el-descriptions-item>
        <el-descriptions-item label="停工原因">{{ currentHold.reason }}</el-descriptions-item>
        <el-descriptions-item label="停工日期">{{ fmtDate(currentHold.heldAt) }}</el-descriptions-item>
        <el-descriptions-item label="预计到件日">{{ fmtDate(currentHold.expectedAt) }}</el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="partReady"
        type="success"
        :closable="false"
        show-icon
        :title="`缺件已换新 · 来源批号 ${resumePart?.sourceLot}`"
        style="margin-bottom: 12px"
      />
      <el-card v-else shadow="never" class="fix-card">
        <div class="fix-title">
          <el-tag type="warning" size="small">缺件未就绪</el-tag>
          <span>需将缺件标记为「换新」并填写来源批号后才能复工，可在此直接处理：</span>
        </div>
        <div class="fix-row">
          <el-input v-model="lotDraft" placeholder="来源批号，如 MS-2024-07" style="width: 220px" />
          <el-button type="primary" plain @click="markPartReplaced">标记换新并保存批号</el-button>
        </div>
      </el-card>

      <el-form label-width="110px" style="margin-top: 12px">
        <el-form-item label="经手人" required>
          <el-input v-model="resumeForm.operator" :placeholder="`须为原经手人 ${target.operator}`" />
        </el-form-item>
        <el-form-item label="实际复工日期" required>
          <el-date-picker
            v-model="resumeForm.resumedAt"
            type="date"
            :disabled-date="disableBeforeHold"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="等待天数">
          <el-tag type="warning">本次 {{ waitDaysPreview }} 天</el-tag>
          <el-tag type="warning" effect="plain" style="margin-left: 8px">累计 {{ cumulativePreview }} 天</el-tag>
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="resumeVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!partReady" @click="submitResume">确认复工</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fix-card {
  margin-bottom: 12px;
}
.fix-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.fix-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
