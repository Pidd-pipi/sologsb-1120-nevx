<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { judgeTest } from '../types/test';
import { holdWaitDays, openHold } from '../types/step';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, waiting, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const activeTab = ref('steps');

async function finish(id: string) {
  try {
    await stepStore.finish(id);
    ElMessage.success('步骤已完成');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function rollback(id: string) {
  try {
    await stepStore.rollback(id);
    ElMessage.warning('步骤已回退');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  try {
    await stepStore.swapSeq(payload.id, target.id);
    ElMessage.success('顺序已调整');
  } catch (e) {
    ElMessage.warning((e as Error).message);
  }
}
async function reorder(payload: { fromId: string; toId: string }) {
  try {
    await stepStore.swapSeq(payload.fromId, payload.toId);
    ElMessage.success('已按拖拽交换顺序');
  } catch (e) {
    ElMessage.warning((e as Error).message);
  }
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

/* ---------- 停工（等待配件） ---------- */
const holdDialogVisible = ref(false);
const holdStepId = ref('');
const holdError = ref('');
const holdForm = reactive<{ partIds: string[]; reason: string; expectedAt: number | '' }>({
  partIds: [],
  reason: '',
  expectedAt: '',
});
const holdStep = computed(() => steps.value.find((it) => it.id === holdStepId.value));

function openHoldDialog(id: string) {
  holdStepId.value = id;
  holdForm.partIds = [];
  holdForm.reason = '';
  holdForm.expectedAt = '';
  holdError.value = '';
  holdDialogVisible.value = true;
}

async function submitHold() {
  holdError.value = '';
  if (holdForm.partIds.length === 0) {
    holdError.value = '请选择缺失零件';
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
    await stepStore.hold(holdStepId.value, {
      partIds: holdForm.partIds,
      reason: holdForm.reason,
      expectedAt: Number(holdForm.expectedAt),
    });
    holdDialogVisible.value = false;
    ElMessage.warning(`工序 #${holdStep.value?.seq ?? ''} 已停工，等待配件`);
  } catch (e) {
    holdError.value = (e as Error).message;
  }
}

/* ---------- 复工 ---------- */
const resumeDialogVisible = ref(false);
const resumeStepId = ref('');
const resumeOperator = ref('');
const resumeError = ref('');
const resumeStep = computed(() => steps.value.find((it) => it.id === resumeStepId.value));
const resumeHold = computed(() => (resumeStep.value ? openHold(resumeStep.value) : undefined));
/** 缺件及其就绪状态（已换新且登记来源批号） */
const resumeParts = computed(() =>
  (resumeHold.value?.partIds ?? []).map((pid) => {
    const part = partStore.items.find((p) => p.id === pid);
    const ready = !!part && part.decision === '换新' && part.sourceLot.trim() !== '';
    return { part, ready };
  }),
);
const allPartsReady = computed(
  () => resumeParts.value.length > 0 && resumeParts.value.every((it) => it.ready),
);

function openResumeDialog(id: string) {
  resumeStepId.value = id;
  resumeOperator.value = '';
  resumeError.value = '';
  resumeDialogVisible.value = true;
}

async function submitResume() {
  resumeError.value = '';
  if (!resumeOperator.value.trim()) {
    resumeError.value = '请填写经手人';
    return;
  }
  try {
    const hold = await stepStore.resume(resumeStepId.value, resumeOperator.value);
    resumeDialogVisible.value = false;
    ElMessage.success(`已复工，本次等待 ${hold?.waitDays ?? 0} 天`);
  } catch (e) {
    resumeError.value = (e as Error).message;
  }
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}
function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN');
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <el-tag v-if="waiting.length" type="warning">等待配件 {{ waiting.length }} 道</el-tag>
      <div class="spacer" />
      <el-tooltip
        :disabled="waiting.length === 0"
        :content="`工序 #${waiting[0]?.seq} 正在等待配件，复工后才能追加`"
        placement="top"
      >
        <span>
          <el-button type="primary" :disabled="waiting.length > 0" @click="router.push(`/steps/new?clockId=${clockId}`)">
            追加维修工序
          </el-button>
        </span>
      </el-tooltip>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />
    <el-alert
      v-for="w in waiting"
      :key="w.id"
      type="warning"
      :closable="false"
      show-icon
      :title="`工序 #${w.seq} ${w.stepType} 正在等待配件：完成、排序与追加工序已锁定，缺件换新并登记来源批号后由「${w.operator}」复工`"
    />

    <div v-if="clock" class="grid">
      <el-card shadow="never">
        <template #header><strong>机芯信息</strong></template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
          <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
          <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
          <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
          <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
          <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
          <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
          <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
          <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
          <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
        </el-descriptions>
        <div class="grade-row">
          <span>品相等级：</span>
          <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
                <template v-if="current.state === 'waiting'">· 等待配件</template>
              </span>
              <span v-else class="muted">全部步骤已完成</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                sortable
                manage-holds
                @finish="finish"
                @rollback="rollback"
                @hold="openHoldDialog"
                @resume="openResumeDialog"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="holdDialogVisible" title="停工 · 等待配件" width="520px">
      <el-alert v-if="holdError" :title="holdError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="110px">
        <el-form-item label="工序">
          <span v-if="holdStep">#{{ holdStep.seq }} {{ holdStep.stepType }} · {{ holdStep.operator }}</span>
        </el-form-item>
        <el-form-item label="缺失零件" required>
          <el-select v-model="holdForm.partIds" multiple style="width: 100%" placeholder="选择缺件">
            <el-option
              v-for="p in parts"
              :key="p.id"
              :label="`${p.name} · ${p.position}（${p.wearState}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="停工原因" required>
          <el-input
            v-model="holdForm.reason"
            type="textarea"
            :rows="3"
            placeholder="如 拆解中发现擒纵轮齿折断，需待新件到货"
          />
        </el-form-item>
        <el-form-item label="预计到件日" required>
          <el-date-picker
            v-model="holdForm.expectedAt"
            type="date"
            value-format="x"
            placeholder="选择日期"
            :disabled-date="(d: Date) => d.getTime() < Date.now() - 24 * 3600 * 1000"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="holdDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="submitHold">确认停工</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resumeDialogVisible" title="复工确认" width="560px">
      <el-alert v-if="resumeError" :title="resumeError" type="error" :closable="false" style="margin-bottom: 10px" />
      <template v-if="resumeStep && resumeHold">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 12px">
          <el-descriptions-item label="工序">
            #{{ resumeStep.seq }} {{ resumeStep.stepType }} · 原经手人 {{ resumeStep.operator }}
          </el-descriptions-item>
          <el-descriptions-item label="停工原因">{{ resumeHold.reason }}</el-descriptions-item>
          <el-descriptions-item label="停工时间">{{ fmt(resumeHold.heldAt) }}</el-descriptions-item>
          <el-descriptions-item label="预计到件">{{ fmtDay(resumeHold.expectedAt) }}</el-descriptions-item>
          <el-descriptions-item label="已等待">
            {{ holdWaitDays(resumeHold.heldAt, Date.now()) }} 天
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="resumeParts" size="small" border style="margin-bottom: 12px">
          <el-table-column label="缺件" min-width="140">
            <template #default="{ row }">
              {{ row.part ? `${row.part.name} · ${row.part.position}` : '未知零件' }}
            </template>
          </el-table-column>
          <el-table-column label="处理决定" width="90">
            <template #default="{ row }">{{ row.part?.decision ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="来源批号" width="120">
            <template #default="{ row }">{{ row.part?.sourceLot || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.ready" type="success" size="small">已备齐</el-tag>
              <el-tag v-else type="danger" size="small">未备齐</el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-alert
          v-if="!allPartsReady"
          type="warning"
          :closable="false"
          show-icon
          title="缺件尚未全部「换新」并登记来源批号，请先到「零件与配换清单」处理"
          style="margin-bottom: 12px"
        />
        <el-form label-width="110px">
          <el-form-item label="复工经手人" required>
            <el-input v-model="resumeOperator" :placeholder="`须为原经手人：${resumeStep.operator}`" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="resumeDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!allPartsReady" @click="submitResume">确认复工</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
</style>
