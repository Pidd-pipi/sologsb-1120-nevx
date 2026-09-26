import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import {
  holdWaitDays,
  openHold,
  type RepairStep,
  type RepairStepDraft,
  type StepHold,
} from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';
import { usePartStore } from './partStore';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests.filter((it) => it.clockId === clockId).sort((a, b) => b.testedAt - a.testedAt),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.loaded = true;
    },
    async add(draft: RepairStepDraft) {
      const record: RepairStep = { ...toPlain(draft), id: newId('stp') };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async finish(id: string) {
      const step = this.items.find((it) => it.id === id);
      if (step?.state === 'waiting') throw new Error('工序正在等待配件，请先复工再完成');
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    async rollback(id: string) {
      const step = this.items.find((it) => it.id === id);
      if (step?.state === 'waiting') throw new Error('工序正在等待配件，请先复工再回退');
      const patch: Partial<RepairStep> = { state: 'rolledback', finishedAt: undefined };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /** 停工等待配件：登记缺件、原因与预计到件日 */
    async hold(id: string, payload: { partIds: string[]; reason: string; expectedAt: number }) {
      const step = this.items.find((it) => it.id === id);
      if (!step) throw new Error('工序不存在');
      if (step.state !== 'pending') throw new Error('只有待办中的工序才能停工等待配件');
      if (payload.partIds.length === 0) throw new Error('请选择缺失零件');
      const record: StepHold = {
        id: newId('hold'),
        partIds: [...payload.partIds],
        reason: payload.reason.trim(),
        heldAt: Date.now(),
        expectedAt: payload.expectedAt,
      };
      const holds = [...(step.holds ?? []), record];
      const patch: Partial<RepairStep> = { state: 'waiting', holds };
      await db.steps.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
      return record;
    },
    /** 复工：缺件全部换新并登记来源批号后，由原经手人复工 */
    async resume(id: string, operator: string) {
      const step = this.items.find((it) => it.id === id);
      if (!step || step.state !== 'waiting') throw new Error('该工序不在等待配件状态');
      if (operator.trim() !== step.operator.trim()) {
        throw new Error(`只有原经手人「${step.operator}」才能复工`);
      }
      const open = openHold(step);
      if (!open) throw new Error('未找到进行中的停工记录');
      const partStore = usePartStore();
      const notReady = open.partIds
        .map((pid) => partStore.items.find((p) => p.id === pid))
        .filter((p) => !p || p.decision !== '换新' || !p.sourceLot.trim());
      if (notReady.length > 0) {
        const names = notReady.map((p) => p?.name ?? '未知零件').join('、');
        throw new Error(`缺件尚未备齐：${names} 需标记为「换新」并填写来源批号`);
      }
      const now = Date.now();
      const holds = (step.holds ?? []).map((h) =>
        h.id === open.id ? { ...h, resumedAt: now, waitDays: holdWaitDays(h.heldAt, now) } : h,
      );
      const patch: Partial<RepairStep> = { state: 'pending', holds };
      await db.steps.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
      return holds[holds.length - 1];
    },
    /** 上下移动排序：交换两个相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      if (a.state === 'waiting' || b.state === 'waiting') {
        throw new Error('等待配件中的工序不参与排序，请先复工');
      }
      const aSeq = a.seq;
      await db.steps.update(a.id, { seq: b.seq });
      await db.steps.update(b.id, { seq: aSeq });
      this.items = this.items.map((it) => {
        if (it.id === a.id) return { ...it, seq: b.seq };
        if (it.id === b.id) return { ...it, seq: aSeq };
        return it;
      });
    },
    async addTest(draft: TimekeepingTestDraft) {
      const record: TimekeepingTest = { ...toPlain(draft), id: newId('tst') };
      await db.tests.put(toPlain(record));
      this.tests = [record, ...this.tests];
      return record;
    },
    async removeTest(id: string) {
      await db.tests.delete(id);
      this.tests = this.tests.filter((it) => it.id !== id);
    },
  },
});
