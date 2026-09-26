import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { daysBetween } from '../utils/timeCalc';
import { activeHold, type RepairStep, type RepairStepDraft, type StepHold } from '../types/step';
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
      if (this.items.some((it) => it.clockId === draft.clockId && it.state === 'waiting')) {
        throw new Error('存在等待配件的工序，复工前不能追加后道工序');
      }
      const record: RepairStep = { ...toPlain(draft), id: newId('stp') };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async finish(id: string) {
      const step = this.items.find((it) => it.id === id);
      if (step?.state === 'waiting') throw new Error('工序等待配件中，请先复工再完成');
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    async rollback(id: string) {
      const step = this.items.find((it) => it.id === id);
      if (step?.state === 'waiting') throw new Error('工序等待配件中，请先复工再回退');
      const patch: Partial<RepairStep> = { state: 'rolledback', finishedAt: undefined };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /** 停工等件：登记缺件、原因与预计到件日，状态转为等待配件 */
    async hold(id: string, input: { partId: string; reason: string; expectedAt: number }) {
      const step = this.items.find((it) => it.id === id);
      if (!step) throw new Error('工序不存在');
      if (step.state === 'done') throw new Error('已完成的工序不能停工');
      if (step.state === 'waiting') throw new Error('该工序已在等待配件中');
      const hold: StepHold = {
        id: newId('hld'),
        partId: input.partId,
        reason: input.reason.trim(),
        expectedAt: input.expectedAt,
        heldAt: Date.now(),
      };
      const patch: Partial<RepairStep> = { state: 'waiting', holds: [...step.holds, hold] };
      await db.steps.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /** 复工：缺件已换新并登记来源批号后，由原经手人办理，结算本次等待天数 */
    async resume(id: string, input: { operator: string; resumedAt: number }) {
      const step = this.items.find((it) => it.id === id);
      if (!step) throw new Error('工序不存在');
      if (step.state !== 'waiting') throw new Error('该工序不在等待配件状态');
      const open = activeHold(step);
      if (!open) throw new Error('未找到待复工的停工记录');
      if (input.operator.trim() !== step.operator) {
        throw new Error(`仅原经手人 ${step.operator} 可办理复工`);
      }
      const part = usePartStore().items.find((p) => p.id === open.partId);
      if (!part) throw new Error('缺件记录不存在，无法核对换新状态');
      if (part.decision !== '换新' || !part.sourceLot.trim()) {
        throw new Error('缺件尚未标记换新并填写来源批号，暂不能复工');
      }
      const waitDays = daysBetween(open.heldAt, input.resumedAt);
      const holds = step.holds.map((h) =>
        h.id === open.id ? { ...h, resumedAt: input.resumedAt, waitDays } : h,
      );
      const patch: Partial<RepairStep> = { state: 'pending', holds };
      await db.steps.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /** 上下移动排序：交换两个相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      if (a.state === 'waiting' || b.state === 'waiting') {
        throw new Error('等待配件的工序不能调整顺序，请先复工');
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
