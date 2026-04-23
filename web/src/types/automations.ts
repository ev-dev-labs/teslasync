export interface Automation {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}

export type AutomationStepKind =
  // triggers
  | 'trigger_signal'
  | 'trigger_geofence'
  | 'trigger_time'
  | 'trigger_webhook'
  // conditions
  | 'condition_signal'
  | 'condition_time_window'
  | 'condition_geofence'
  | 'condition_day_of_week'
  // actions
  | 'action_notification'
  | 'action_vehicle_command'
  | 'action_set_state';

export type AutomationStepLane = 'trigger' | 'condition' | 'action';

export interface AutomationStepBase {
  id: number;
  automation_id: number;
  kind: AutomationStepKind;
  lane: AutomationStepLane;
  position: number;
  created_at: string;
}

export interface AutomationStepTriggerSignal extends AutomationStepBase {
  kind: 'trigger_signal';
  lane: 'trigger';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'changed';
  threshold_numeric: number | null;
  threshold_text: string | null;
  threshold_bool: boolean | null;
}

export interface AutomationStepTriggerGeofence extends AutomationStepBase {
  kind: 'trigger_geofence';
  lane: 'trigger';
  geofence_id: number;
  direction: 'enter' | 'exit' | 'either';
}

export interface AutomationStepTriggerTime extends AutomationStepBase {
  kind: 'trigger_time';
  lane: 'trigger';
  cron_expr: string;
  timezone: string;
}

export interface AutomationStepTriggerWebhook extends AutomationStepBase {
  kind: 'trigger_webhook';
  lane: 'trigger';
  webhook_token: string;
  require_signature: boolean;
}

export interface AutomationStepConditionSignal extends AutomationStepBase {
  kind: 'condition_signal';
  lane: 'condition';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  compare_numeric: number | null;
  compare_text: string | null;
  compare_bool: boolean | null;
}

export interface AutomationStepConditionTimeWindow extends AutomationStepBase {
  kind: 'condition_time_window';
  lane: 'condition';
  start_time: string;
  end_time: string;
  timezone: string;
}

export interface AutomationStepConditionGeofence extends AutomationStepBase {
  kind: 'condition_geofence';
  lane: 'condition';
  geofence_id: number;
  must_be_inside: boolean;
}

export interface AutomationStepConditionDayOfWeek extends AutomationStepBase {
  kind: 'condition_day_of_week';
  lane: 'condition';
  days_of_week: number[];
  timezone: string;
}

export interface AutomationStepActionNotification extends AutomationStepBase {
  kind: 'action_notification';
  lane: 'action';
  channel_id: number;
  template: string;
}

export interface AutomationStepActionVehicleCommand extends AutomationStepBase {
  kind: 'action_vehicle_command';
  lane: 'action';
  command: string;
  /** Sole jsonb carve-out (ADR-001). Tesla command params are inherently dynamic. */
  command_params: Record<string, unknown>;
}

// Discriminated union — children added by prompts 13-23
export type AutomationStep =
  | AutomationStepTriggerSignal
  | AutomationStepTriggerGeofence
  | AutomationStepTriggerTime
  | AutomationStepTriggerWebhook
  | AutomationStepConditionSignal
  | AutomationStepConditionTimeWindow
  | AutomationStepConditionGeofence
  | AutomationStepConditionDayOfWeek
  | AutomationStepActionNotification
  | AutomationStepActionVehicleCommand
  | AutomationStepBase;

export interface AutomationFull extends Automation {
  triggers: AutomationStep[];
  conditions: AutomationStep[];
  actions: AutomationStep[];
}
