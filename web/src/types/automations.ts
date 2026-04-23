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

// Discriminated union — children added by prompts 13-23
export type AutomationStep = AutomationStepBase;

export interface AutomationFull extends Automation {
  triggers: AutomationStep[];
  conditions: AutomationStep[];
  actions: AutomationStep[];
}
