/** 维修步骤类型 */
export type StepType = '拆解' | '清洗' | '润滑' | '装配' | '调试' | '走时测试';

export const STEP_TYPES: StepType[] = ['拆解', '清洗', '润滑', '装配', '调试', '走时测试'];

/** 步骤状态 */
export type StepState = 'pending' | 'done' | 'rolledback' | 'waiting';

/** 一天毫秒数 */
const DAY_MS = 24 * 3600 * 1000;

/** 停工（等待配件）记录 */
export interface StepHold {
  id: string;
  /** 缺失零件 id 列表 */
  partIds: string[];
  /** 停工原因 */
  reason: string;
  /** 停工时间 */
  heldAt: number;
  /** 预计到件日 */
  expectedAt: number;
  /** 实际复工时间 */
  resumedAt?: number;
  /** 本次累计等待天数（复工时结算） */
  waitDays?: number;
}

/** 计算一次停工从 heldAt 到 at 的等待天数 */
export function holdWaitDays(heldAt: number, at: number): number {
  return Math.max(0, Math.round((at - heldAt) / DAY_MS));
}

/** 取工序当前进行中的停工记录（未复工的最后一条） */
export function openHold(step: RepairStep): StepHold | undefined {
  const holds = step.holds ?? [];
  const last = holds[holds.length - 1];
  return last && !last.resumedAt ? last : undefined;
}

/** 工序已结算的累计等待天数（进行中的不计） */
export function settledWaitDays(step: RepairStep): number {
  return (step.holds ?? []).reduce((sum, h) => sum + (h.waitDays ?? 0), 0);
}

/** 各步骤类型的动态字段开关 */
export const STEP_FIELD_MAP: Record<
  StepType,
  { needSolvent: boolean; needOil: boolean; needTorque: boolean }
> = {
  拆解: { needSolvent: false, needOil: false, needTorque: true },
  清洗: { needSolvent: true, needOil: false, needTorque: false },
  润滑: { needSolvent: false, needOil: true, needTorque: false },
  装配: { needSolvent: false, needOil: true, needTorque: true },
  调试: { needSolvent: false, needOil: false, needTorque: false },
  走时测试: { needSolvent: false, needOil: false, needTorque: false },
};

/** 维修工序 */
export interface RepairStep {
  id: string;
  clockId: string;
  stepType: StepType;
  /** 顺序号，不得跳号 */
  seq: number;
  /** 关联零件 */
  partIds: string[];
  /** 清洗液 */
  cleanSolvent: string;
  /** 清洗方式 */
  cleanMethod: string;
  /** 润滑油脂型号 */
  oilType: string;
  /** 润滑点位 */
  oilPoints: string;
  /** 拧紧力矩 N·m */
  torque: number;
  troubleNote: string;
  operator: string;
  startedAt: number;
  finishedAt?: number;
  state: StepState;
  /** 停复工记录（老数据可能缺省，按空数组处理） */
  holds?: StepHold[];
}

export type RepairStepDraft = Omit<RepairStep, 'id'>;
