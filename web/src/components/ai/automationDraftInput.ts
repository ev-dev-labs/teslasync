import type {
  AutomationActionInput,
  AutomationConditionInput,
  AutomationTriggerInput,
} from '@/types/automations';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => key === 'kind' || key === 'step_order' || allowed.includes(key))
    && (value.step_order === undefined || Number.isInteger(value.step_order));
}

function positiveID(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function clock(value: unknown): boolean {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function scalars(value: Record<string, unknown>, allowRange = false): boolean {
  return (value.value_text == null || typeof value.value_text === 'string')
    && (value.value_num == null || typeof value.value_num === 'number' && Number.isFinite(value.value_num))
    && (value.value_bool == null || typeof value.value_bool === 'boolean')
    && (!allowRange || ['value_min', 'value_max'].every(key =>
      value[key] == null || typeof value[key] === 'number' && Number.isFinite(value[key])));
}

export function isAutomationTriggerInput(value: unknown): value is AutomationTriggerInput {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'trigger_geofence':
      return fields(value, ['place_id', 'event', 'dwell_minutes']) && positiveID(value.place_id)
        && ['enter', 'exit', 'dwell'].includes(String(value.event))
        && (value.dwell_minutes === undefined || value.event === 'dwell' && positiveID(value.dwell_minutes));
    case 'trigger_event':
      return fields(value, ['event_type']) && [
        'drive_start', 'drive_end', 'charge_start', 'charge_end', 'sleep_start',
        'sleep_end', 'online', 'offline', 'sentry_alert',
      ].includes(String(value.event_type));
    case 'trigger_schedule':
      return fields(value, ['cron_expr', 'timezone']) && text(value.cron_expr) && typeof value.timezone === 'string';
    case 'trigger_signal':
      return fields(value, ['signal', 'op', 'value_text', 'value_num', 'value_bool'])
        && text(value.signal) && scalars(value)
        && ['=', '!=', '<', '<=', '>', '>=', 'changed', 'crossed_above', 'crossed_below'].includes(String(value.op))
        && ['value_text', 'value_num', 'value_bool'].filter(key => value[key] != null).length
          === (value.op === 'changed' ? 0 : 1);
    default:
      return false;
  }
}

export function isAutomationConditionInput(value: unknown): value is AutomationConditionInput {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'condition_time_window':
      return fields(value, ['start_time', 'end_time', 'timezone', 'days_of_week'])
        && clock(value.start_time) && clock(value.end_time) && typeof value.timezone === 'string'
        && Array.isArray(value.days_of_week) && value.days_of_week.every(day =>
          typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6);
    case 'condition_geofence':
      return fields(value, ['place_id', 'state']) && positiveID(value.place_id)
        && ['inside', 'outside', 'dwell'].includes(String(value.state));
    case 'condition_other_automation':
      return fields(value, ['other_automation_id', 'state']) && positiveID(value.other_automation_id)
        && ['enabled', 'disabled', 'recently_triggered'].includes(String(value.state));
    case 'condition_signal': {
      if (!fields(value, ['signal', 'op', 'value_text', 'value_num', 'value_bool', 'value_min', 'value_max'])
        || !text(value.signal) || !scalars(value, true)) return false;
      const count = ['value_text', 'value_num', 'value_bool'].filter(key => value[key] != null).length;
      if (value.op === 'between') return count === 0 && typeof value.value_min === 'number'
        && typeof value.value_max === 'number';
      if (value.value_min != null || value.value_max != null) return false;
      if (['<', '<=', '>', '>='].includes(String(value.op))) return count === 1 && typeof value.value_num === 'number';
      return ['=', '!=', 'in'].includes(String(value.op)) && count === 1;
    }
    default:
      return false;
  }
}

export function isAutomationActionInput(value: unknown): value is AutomationActionInput {
  if (!record(value)) return false;
  switch (value.kind) {
    case 'action_wait':
      return fields(value, ['duration_s']) && typeof value.duration_s === 'number'
        && Number.isInteger(value.duration_s) && value.duration_s >= 1 && value.duration_s <= 3600;
    case 'action_command':
      return fields(value, ['command_name', 'command_params']) && text(value.command_name)
        && (value.command_params === undefined || record(value.command_params));
    case 'action_notify':
      return fields(value, ['channel_id', 'template']) && positiveID(value.channel_id) && text(value.template);
    case 'action_set_setting':
      return fields(value, ['setting_key', 'value_text', 'value_num', 'value_bool'])
        && text(value.setting_key) && scalars(value)
        && ['value_text', 'value_num', 'value_bool'].filter(key => value[key] != null).length === 1;
    case 'action_call_automation':
      return fields(value, ['target_automation_id']) && positiveID(value.target_automation_id);
    default:
      return false;
  }
}

export { record as isAutomationDraftRecord };
