import type {
  AutomationActionStep,
  AutomationConditionStep,
  AutomationStep,
  AutomationTriggerStep,
} from '@/types/automations';

type StepInput<T extends AutomationStep> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>
  : never;

export type AutomationTriggerStepInput = StepInput<AutomationTriggerStep>;
export type AutomationConditionStepInput = StepInput<AutomationConditionStep>;
export type AutomationActionStepInput = StepInput<AutomationActionStep>;
export type AutomationStepInput =
  | AutomationTriggerStepInput
  | AutomationConditionStepInput
  | AutomationActionStepInput;

export type AutomationActionCommandStepInput = Extract<
  AutomationActionStepInput,
  { kind: 'action_command' }
>;

export type AutomationActionSetSettingStepInput = Extract<
  AutomationActionStepInput,
  { kind: 'action_set_setting' }
>;
