import type { AutomationActionKind } from '@/types/automations';
import type {
  AutomationActionCommandStepInput,
  AutomationActionSetSettingStepInput,
  AutomationActionStepInput,
} from '../stepInputTypes';

type CommandParams = NonNullable<AutomationActionCommandStepInput['command_params']>;
export type SettingValueKind = 'text' | 'number' | 'boolean';

export function isCommandParams(value: unknown): value is CommandParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createDefaultAction(kind: AutomationActionKind, channelId = 0): AutomationActionStepInput {
  switch (kind) {
    case 'action_command':
      return { kind, command_name: 'climate_on' };
    case 'action_notify':
      return { kind, channel_id: channelId, template: '' };
    case 'action_set_setting':
      return { kind, setting_key: '', value_text: '' };
    case 'action_call_automation':
      return { kind, target_automation_id: 0 };
  }
}

export function settingValueKind(action: AutomationActionSetSettingStepInput): SettingValueKind {
  if ('value_num' in action) return 'number';
  if (action.value_bool != null) return 'boolean';
  return 'text';
}

export function actionWithSettingValue(
  action: AutomationActionSetSettingStepInput,
  kind: SettingValueKind,
  value: string | number | null,
): AutomationActionStepInput {
  if (kind === 'number') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_num: typeof value === 'number' && Number.isFinite(value) ? value : null,
    };
  }
  if (kind === 'boolean') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_bool: value === 'true',
    };
  }
  return {
    kind: 'action_set_setting',
    setting_key: action.setting_key,
    value_text: value == null ? '' : String(value),
  };
}
