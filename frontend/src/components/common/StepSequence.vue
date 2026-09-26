<script setup lang="ts">
import { computed, ref } from 'vue';
import { holdWaitDays, settledWaitDays, type RepairStep } from '../../types/step';
import { findSeqGaps } from '../../utils/id';
import { usePartStore } from '../../stores/partStore';
import StateBadge from './StateBadge.vue';

const props = defineProps<{
  items: RepairStep[];
  /** 是否展示上下移动/拖拽排序 */
  sortable?: boolean;
  /** 是否展示停工/复工操作 */
  manageHolds?: boolean;
}>();

const emit = defineEmits<{
  (e: 'finish', id: string): void;
  (e: 'rollback', id: string): void;
  (e: 'hold', id: string): void;
  (e: 'resume', id: string): void;
  (e: 'move', payload: { id: string; direction: 'up' | 'down' }): void;
  (e: 'reorder', payload: { fromId: string; toId: string }): void;
}>();

const partStore = usePartStore();
const dragId = ref<string>('');

const gaps = computed(() => findSeqGaps(props.items.map((it) => it.seq)));
const conflict = computed(() => gaps.value.length > 0);

function partName(id: string): string {
  const part = partStore.items.find((p) => p.id === id);
  return part ? `${part.name}（${part.position}）` : '未知零件';
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN');
}

function onDragStart(row: RepairStep) {
  if (row.state === 'waiting') return;
  dragId.value = row.id;
}
function onDrop(toId: string) {
  const target = props.items.find((it) => it.id === toId);
  if (dragId.value && dragId.value !== toId && target?.state !== 'waiting') {
    emit('reorder', { fromId: dragId.value, toId });
  }
  dragId.value = '';
}
</script>

<template>
  <div class="seq-wrap" data-testid="step-sequence">
    <el-alert
      v-if="conflict"
      type="error"
      :closable="false"
      show-icon
      :title="`顺序号存在缺口：${gaps.join('、')}（不得跳号，请用上下移动补齐）`"
      style="margin-bottom: 10px"
    />
    <el-table :data="items" size="small" border row-key="id">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="hold-panel">
            <el-timeline v-if="(row.holds ?? []).length > 0" style="padding-left: 4px">
              <el-timeline-item
                v-for="h in row.holds"
                :key="h.id"
                :type="h.resumedAt ? 'success' : 'warning'"
                :timestamp="`停工于 ${fmt(h.heldAt)}`"
                placement="top"
              >
                <div>原因：{{ h.reason }}</div>
                <div>缺件：{{ h.partIds.map(partName).join('、') || '—' }}</div>
                <div>预计到件：{{ fmtDay(h.expectedAt) }}</div>
                <div v-if="h.resumedAt" class="resumed">
                  复工于 {{ fmt(h.resumedAt) }} · 本次等待 {{ h.waitDays ?? 0 }} 天
                </div>
                <div v-else class="holding">等待中，已等待 {{ holdWaitDays(h.heldAt, Date.now()) }} 天</div>
              </el-timeline-item>
            </el-timeline>
            <span v-else class="muted">暂无停复工记录</span>
            <div v-if="settledWaitDays(row) > 0" class="total-wait">累计等待 {{ settledWaitDays(row) }} 天</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="顺序" width="70">
        <template #default="{ row }">
          <span :class="{ gap: conflict && gaps.includes(row.seq) }">#{{ row.seq }}</span>
        </template>
      </el-table-column>
      <el-table-column label="步骤" width="100">
        <template #default="{ row }">{{ row.stepType }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <StateBadge :state="row.state" />
        </template>
      </el-table-column>
      <el-table-column label="清洗/润滑" min-width="180">
        <template #default="{ row }">
          <div v-if="row.cleanSolvent">清洗液：{{ row.cleanSolvent }}（{{ row.cleanMethod }}）</div>
          <div v-if="row.oilType">油脂：{{ row.oilType }} · 点位 {{ row.oilPoints }}</div>
          <div v-if="row.torque">力矩：{{ row.torque }} N·m</div>
          <div v-if="!row.cleanSolvent && !row.oilType && !row.torque">—</div>
        </template>
      </el-table-column>
      <el-table-column label="异常说明" min-width="140">
        <template #default="{ row }">{{ row.troubleNote || '—' }}</template>
      </el-table-column>
      <el-table-column label="责任人" width="90">
        <template #default="{ row }">{{ row.operator }}</template>
      </el-table-column>
      <el-table-column label="停复工" width="90">
        <template #default="{ row }">
          <el-tag v-if="(row.holds ?? []).length > 0" size="small" type="warning" effect="plain">
            {{ (row.holds ?? []).length }} 次
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300">
        <template #default="{ row, $index }">
          <template v-if="row.state === 'waiting'">
            <el-button v-if="manageHolds" size="small" type="warning" @click="emit('resume', row.id)">
              复工
            </el-button>
            <el-tooltip v-else content="等待配件中，请到钟表详情页复工" placement="top">
              <span class="muted">等待配件</span>
            </el-tooltip>
          </template>
          <template v-else-if="row.state !== 'done'">
            <el-button size="small" type="primary" @click="emit('finish', row.id)">完成</el-button>
            <el-button v-if="manageHolds" size="small" type="warning" plain @click="emit('hold', row.id)">
              停工
            </el-button>
          </template>
          <el-button v-if="row.state === 'done'" size="small" type="warning" @click="emit('rollback', row.id)">
            回退
          </el-button>
          <template v-if="sortable">
            <el-button
              size="small"
              :disabled="$index === 0 || row.state === 'waiting'"
              @click="emit('move', { id: row.id, direction: 'up' })"
            >
              上移
            </el-button>
            <el-button
              size="small"
              :disabled="$index === items.length - 1 || row.state === 'waiting'"
              @click="emit('move', { id: row.id, direction: 'down' })"
            >
              下移
            </el-button>
          </template>
          <span
            v-if="sortable && row.state !== 'waiting'"
            class="drag-handle"
            draggable="true"
            title="拖拽到目标行可交换顺序"
            @dragstart="onDragStart(row)"
            @dragover.prevent
            @drop="onDrop(row.id)"
            >⣿</span
          >
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="items.length === 0" description="暂无工序，请到「新建维修工序」登记" />
  </div>
</template>

<style scoped>
.gap {
  color: #d93025;
  font-weight: 700;
}
.drag-handle {
  margin-left: 8px;
  cursor: grab;
  color: #97a0ad;
  user-select: none;
}
.hold-panel {
  padding: 8px 16px;
  font-size: 13px;
  line-height: 1.8;
}
.hold-panel .resumed {
  color: #2b8a3e;
}
.hold-panel .holding {
  color: #b76e00;
}
.total-wait {
  margin-top: 4px;
  color: #b76e00;
  font-weight: 600;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
</style>
