/** 维修步骤类型 */
export type StepType = '拆解' | '清洗' | '润滑' | '装配' | '调试' | '走时测试';

export const STEP_TYPES: StepType[] = ['拆解', '清洗', '润滑', '装配', '调试', '走时测试'];

/** 步骤状态 */
export type StepState = 'pending' | 'done' | 'rolledback' | 'waiting';

/** 停工（等待配件）记录 */
export interface StepHold {
  id: string;
  /** 缺件零件 id */
  partId: string;
  /** 停工原因 */
  reason: string;
  /** 预计到件日 */
  expectedAt: number;
  /** 停工时间 */
  heldAt: number;
  /** 实际复工时间，未复工为空 */
  resumedAt?: number;
  /** 本次等待天数，复工时按自然日结算 */
  waitDays?: number;
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
  /** 停复工记录（等待配件），按发生先后排列 */
  holds: StepHold[];
}

export type RepairStepDraft = Omit<RepairStep, 'id'>;

/** 当前未复工的停工记录 */
export function activeHold(step: RepairStep): StepHold | undefined {
  return step.holds.find((h) => h.resumedAt === undefined);
}

/** 已结算的累计等待天数（不含进行中的停工） */
export function settledWaitDays(step: RepairStep): number {
  return step.holds.reduce((sum, h) => sum + (h.waitDays ?? 0), 0);
}
