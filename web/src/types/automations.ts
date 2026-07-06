export interface Automation {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}

export type AutomationTriggerKind =
  | 'trigger_signal'
  | 'trigger_geofence'
  | 'trigger_schedule'
  | 'trigger_event';

export type AutomationConditionKind =
  | 'condition_signal'
  | 'condition_time_window'
  | 'condition_geofence'
  | 'condition_other_automation';

export type AutomationActionKind =
  | 'action_command'
  | 'action_notify'
  | 'action_set_setting'
  | 'action_call_automation';

export type AutomationStepKind =
  | AutomationTriggerKind
  | AutomationConditionKind
  | AutomationActionKind;

export type AutomationStepLane = 'trigger' | 'condition' | 'action';

export type AutomationTriggerSignalOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'changed'
  | 'crossed_above'
  | 'crossed_below';

export type AutomationConditionSignalOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'between'
  | 'in';

export type AutomationGeofenceEvent =
  | 'enter'
  | 'exit'
  | 'leave'
  | 'both'
  | 'dwell';

export type AutomationGeofenceState = 'inside' | 'outside' | 'dwell';

export type AutomationEventType =
  | 'drive_start'
  | 'drive_end'
  | 'charge_start'
  | 'charge_end'
  | 'sleep_start'
  | 'sleep_end'
  | 'online'
  | 'offline'
  | 'sentry_alert';

export type AutomationOtherAutomationState =
  | 'enabled'
  | 'disabled'
  | 'recently_triggered';

export interface AutomationStepSummary {
  id: number;
  automation_id: number;
  step_order: number;
  kind: AutomationStepKind;
}

export interface AutomationStepBase {
  id?: number;
  automation_id?: number;
  step_id?: number;
  kind: AutomationStepKind;
  step_order?: number;
}

export interface AutomationStepTriggerSignal extends AutomationStepBase {
  kind: 'trigger_signal';
  signal: string;
  op: AutomationTriggerSignalOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
}

export interface AutomationStepTriggerGeofence extends AutomationStepBase {
  kind: 'trigger_geofence';
  place_id: number;
  event: AutomationGeofenceEvent;
  dwell_minutes?: number | null;
}

export interface AutomationStepTriggerSchedule extends AutomationStepBase {
  kind: 'trigger_schedule';
  cron_expr: string;
  timezone: string;
}

export interface AutomationStepTriggerEvent extends AutomationStepBase {
  kind: 'trigger_event';
  event_type: AutomationEventType;
}

export interface AutomationStepConditionSignal extends AutomationStepBase {
  kind: 'condition_signal';
  signal: string;
  op: AutomationConditionSignalOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
}

export interface AutomationStepConditionTimeWindow extends AutomationStepBase {
  kind: 'condition_time_window';
  start_time: string;
  end_time: string;
  timezone: string;
  days_of_week: number[];
}

export interface AutomationStepConditionGeofence extends AutomationStepBase {
  kind: 'condition_geofence';
  place_id: number;
  state: AutomationGeofenceState;
}

export interface AutomationStepConditionOtherAutomation extends AutomationStepBase {
  kind: 'condition_other_automation';
  other_automation_id: number;
  state: AutomationOtherAutomationState;
}

export interface AutomationStepActionCommand extends AutomationStepBase {
  kind: 'action_command';
  command_name: string;
  command_params?: Record<string, unknown>;
}

export interface AutomationStepActionNotify extends AutomationStepBase {
  kind: 'action_notify';
  channel_id: number;
  template: string;
}

export interface AutomationStepActionSetSetting extends AutomationStepBase {
  kind: 'action_set_setting';
  setting_key: string;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
}

export interface AutomationStepActionCallAutomation extends AutomationStepBase {
  kind: 'action_call_automation';
  target_automation_id: number;
}

export type AutomationTriggerStep =
  | AutomationStepTriggerSignal
  | AutomationStepTriggerGeofence
  | AutomationStepTriggerSchedule
  | AutomationStepTriggerEvent;

export type AutomationConditionStep =
  | AutomationStepConditionSignal
  | AutomationStepConditionTimeWindow
  | AutomationStepConditionGeofence
  | AutomationStepConditionOtherAutomation;

export type AutomationActionStep =
  | AutomationStepActionCommand
  | AutomationStepActionNotify
  | AutomationStepActionSetSetting
  | AutomationStepActionCallAutomation;

export type AutomationStep =
  | AutomationTriggerStep
  | AutomationConditionStep
  | AutomationActionStep;

// Per-member ("distributive") Omit over a step union.
//
// The `T extends unknown ? … : never` wrapper is load-bearing, not cosmetic.
// A naked `Omit<AutomationTriggerStep, …>` collapses the discriminated union to
// only its *common* keys (`kind` + `step_order`), silently dropping `signal`,
// `op`, `place_id`, `command_name`, … . Worse, the collapsed `kind` widens back
// to the full `AutomationTriggerKind`, so `Extract<…, { kind: 'trigger_signal' }>`
// resolves to `never` and every per-kind build/narrow site is unusable.
// Distributing the conditional applies `Omit` to each member individually, so
// every branch keeps its own fields and a narrowable discriminant. Do not
// "simplify" this back to a plain `Omit` (see stepInputTypes.ts for the same
// trap documented at the builder call-sites).
type AutomationStepInput<T extends AutomationStep> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id'>
  : never;

export type AutomationTriggerInput = AutomationStepInput<AutomationTriggerStep>;
export type AutomationConditionInput = AutomationStepInput<AutomationConditionStep>;
export type AutomationActionInput = AutomationStepInput<AutomationActionStep>;

export interface AutomationFull extends Automation {
  steps?: AutomationStepSummary[];
  triggers: AutomationTriggerStep[];
  conditions: AutomationConditionStep[];
  actions: AutomationActionStep[];
}
