import type {
  AutomationActionStep,
  AutomationConditionStep,
  AutomationTriggerStep,
} from '@/types/automations';

type BuilderStepInput<T> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id'>
  : never;

export type BuilderTriggerInput = BuilderStepInput<AutomationTriggerStep>;
export type BuilderConditionInput = BuilderStepInput<AutomationConditionStep>;
export type BuilderActionInput = BuilderStepInput<AutomationActionStep>;
export type BuilderAutomationStepInput =
  | BuilderTriggerInput
  | BuilderConditionInput
  | BuilderActionInput;

export type BuilderActionCommandInput = Extract<
  BuilderActionInput,
  { kind: 'action_command' }
>;

export type BuilderActionSetSettingInput = Extract<
  BuilderActionInput,
  { kind: 'action_set_setting' }
>;
