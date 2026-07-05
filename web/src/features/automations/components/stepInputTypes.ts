import type {
  AutomationActionStep,
  AutomationConditionStep,
  AutomationStep,
  AutomationTriggerStep,
} from '@/types/automations';

/**
 * Per-member ("distributive") `Omit` over a step union.
 *
 * The `T extends unknown ? … : never` wrapper is load-bearing, not cosmetic.
 * A naked `Omit<AutomationTriggerStep, …>` collapses the discriminated union to
 * only its *common* keys (`kind`), silently dropping `signal`, `op`, `place_id`,
 * `command_name`, … . Distributing the conditional applies `Omit` to each member
 * individually, so every branch keeps its own fields and its discriminant. That
 * is exactly what lets `Extract<…, { kind: 'action_command' }>` below resolve to
 * a real member and every `switch (step.kind)` in the builder narrow correctly.
 * Do not "simplify" this to a plain `Omit`.
 */
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
