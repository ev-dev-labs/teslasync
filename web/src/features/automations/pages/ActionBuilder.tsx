import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  GlassPanel,
  Text,
  Textarea as UiTextarea,
} from '@/components/ui';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { UnitInput } from '@/components/forms';
import { useSettings } from '@/hooks/useSettings';
import { parseForUnit } from '@/lib/unitInput';
import type { NotificationChannel } from '@/types/notifications';
import type {
  AutomationActionKind,
} from '@/types/automations';
import type {
  AutomationActionCommandStepInput,
  AutomationActionSetSettingStepInput,
  AutomationActionStepInput,
} from '../components/stepInputTypes';

type ActionKindOption = {
  value: AutomationActionKind;
  labelKey: string;
  fallback: string;
};

type CommandParams = NonNullable<AutomationActionCommandStepInput['command_params']>;
type SettingValueKind = 'text' | 'number' | 'boolean';

export const ACTION_TYPES: ActionKindOption[] = [
  {
    value: 'action_command',
    labelKey: 'automations.actions.command',
    fallback: 'Vehicle command',
  },
  {
    value: 'action_notify',
    labelKey: 'automations.actions.notify',
    fallback: 'Send notification',
  },
  {
    value: 'action_set_setting',
    labelKey: 'automations.actions.setSetting',
    fallback: 'Set setting',
  },
  {
    value: 'action_call_automation',
    labelKey: 'automations.actions.callAutomation',
    fallback: 'Call automation',
  },
];

const COMMAND_GROUPS: {
  labelKey: string;
  fallback: string;
  commands: { value: string; labelKey: string; fallback: string }[];
}[] = [
  {
    labelKey: 'automations.commandGroups.security',
    fallback: 'Security & access',
    commands: [
      { value: 'lock', labelKey: 'automations.commands.lock', fallback: 'Lock doors' },
      { value: 'unlock', labelKey: 'automations.commands.unlock', fallback: 'Unlock doors' },
      { value: 'sentry_on', labelKey: 'automations.commands.sentryOn', fallback: 'Sentry mode on' },
      { value: 'sentry_off', labelKey: 'automations.commands.sentryOff', fallback: 'Sentry mode off' },
      { value: 'valet_on', labelKey: 'automations.commands.valetOn', fallback: 'Valet mode on' },
      { value: 'valet_off', labelKey: 'automations.commands.valetOff', fallback: 'Valet mode off' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.climate',
    fallback: 'Climate',
    commands: [
      { value: 'climate_on', labelKey: 'automations.commands.climateOn', fallback: 'Climate on' },
      { value: 'climate_off', labelKey: 'automations.commands.climateOff', fallback: 'Climate off' },
      { value: 'set_temps', labelKey: 'automations.commands.setTemps', fallback: 'Set temperature' },
      { value: 'seat_heater', labelKey: 'automations.commands.seatHeater', fallback: 'Seat heater' },
      { value: 'seat_cooler', labelKey: 'automations.commands.seatCooler', fallback: 'Seat cooler' },
      {
        value: 'steering_wheel_heat',
        labelKey: 'automations.commands.steeringWheelHeat',
        fallback: 'Steering wheel heater',
      },
      { value: 'dog_mode', labelKey: 'automations.commands.dogMode', fallback: 'Dog mode' },
      { value: 'camp_mode', labelKey: 'automations.commands.campMode', fallback: 'Camp mode' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.charging',
    fallback: 'Charging',
    commands: [
      { value: 'charge_start', labelKey: 'automations.commands.chargeStart', fallback: 'Start charging' },
      { value: 'charge_stop', labelKey: 'automations.commands.chargeStop', fallback: 'Stop charging' },
      {
        value: 'set_charge_limit',
        labelKey: 'automations.commands.setChargeLimit',
        fallback: 'Set charge limit',
      },
      {
        value: 'set_charging_amps',
        labelKey: 'automations.commands.setChargingAmps',
        fallback: 'Set charging amps',
      },
      {
        value: 'open_charge_port',
        labelKey: 'automations.commands.openChargePort',
        fallback: 'Open charge port',
      },
      {
        value: 'close_charge_port',
        labelKey: 'automations.commands.closeChargePort',
        fallback: 'Close charge port',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.doors',
    fallback: 'Doors & trunk',
    commands: [
      { value: 'frunk_open', labelKey: 'automations.commands.frunkOpen', fallback: 'Open frunk' },
      { value: 'trunk_open', labelKey: 'automations.commands.trunkOpen', fallback: 'Open trunk' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.alerts',
    fallback: 'Alerts',
    commands: [
      { value: 'honk', labelKey: 'automations.commands.honk', fallback: 'Honk horn' },
      { value: 'flash', labelKey: 'automations.commands.flash', fallback: 'Flash lights' },
    ],
  },
  {
    labelKey: 'automations.commandGroups.navigation',
    fallback: 'Navigation',
    commands: [
      {
        value: 'navigation_request',
        labelKey: 'automations.commands.navigationRequest',
        fallback: 'Navigate to address',
      },
      {
        value: 'navigation_gps_request',
        labelKey: 'automations.commands.navigationGpsRequest',
        fallback: 'Navigate to GPS',
      },
      {
        value: 'trigger_homelink',
        labelKey: 'automations.commands.triggerHomelink',
        fallback: 'Trigger HomeLink',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.driveSoftware',
    fallback: 'Drive & software',
    commands: [
      {
        value: 'remote_start_drive',
        labelKey: 'automations.commands.remoteStartDrive',
        fallback: 'Remote start',
      },
      { value: 'wake_up', labelKey: 'automations.commands.wakeUp', fallback: 'Wake up' },
    ],
  },
];

const GUIDED_COMMAND_FIELDS: Record<string, {
  key: string;
  labelKey: string;
  fallback: string;
  min: number;
  max?: number;
}[]> = {
  set_charge_limit: [
    { key: 'percent', labelKey: 'automations.builder.chargeLimit', fallback: 'Charge limit', min: 0, max: 100 },
  ],
  set_charging_amps: [
    { key: 'charging_amps', labelKey: 'automations.builder.chargingAmps', fallback: 'Charging current (A)', min: 1 },
  ],
  set_temps: [
    { key: 'driver_temp', labelKey: 'automations.builder.driverTemp', fallback: 'Driver temperature', min: 15, max: 30 },
    { key: 'passenger_temp', labelKey: 'automations.builder.passengerTemp', fallback: 'Passenger temperature', min: 15, max: 30 },
  ],
};

interface ActionBuilderProps {
  actions: AutomationActionStepInput[];
  channels: NotificationChannel[];
  onChange: (actions: AutomationActionStepInput[]) => void;
}

interface ActionFieldsProps {
  action: AutomationActionStepInput;
  channelOptions: { value: string; label: string; disabled?: boolean }[];
  onChange: (action: AutomationActionStepInput) => void;
}

function isCommandParams(value: unknown): value is CommandParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createDefaultAction(kind: AutomationActionKind, channelId = 0): AutomationActionStepInput {
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

function settingValueKind(action: AutomationActionSetSettingStepInput): SettingValueKind {
  if ('value_num' in action) return 'number';
  if (action.value_bool != null) return 'boolean';
  return 'text';
}

function actionWithSettingValue(
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

export function ActionBuilder({ actions = [], channels = [], onChange }: ActionBuilderProps) {
  const { t } = useTranslation();

  const defaultChannelId = useMemo(
    () => channels.find((channel) => channel.enabled)?.id ?? channels[0]?.id ?? 0,
    [channels],
  );

  const actionTypeOptions = useMemo(
    () => ACTION_TYPES.map((action) => ({
      value: action.value,
      label: t(action.labelKey, action.fallback),
    })),
    [t],
  );

  const channelOptions = useMemo(
    () => channels.map((channel) => ({
      value: String(channel.id),
      label: `${channel.name} (${channel.kind})`,
      disabled: !channel.enabled,
    })),
    [channels],
  );

  const addAction = useCallback(() => {
    onChange([...actions, createDefaultAction('action_command', defaultChannelId)]);
  }, [actions, defaultChannelId, onChange]);

  const removeAction = useCallback(
    (index: number) => onChange(actions.filter((_, currentIndex) => currentIndex !== index)),
    [actions, onChange],
  );

  const replaceAction = useCallback(
    (index: number, nextAction: AutomationActionStepInput) => {
      onChange(actions.map((action, currentIndex) => (
        currentIndex === index ? nextAction : action
      )));
    },
    [actions, onChange],
  );

  const moveAction = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= actions.length) return;
      const next = [...actions];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [actions, onChange],
  );

  return (
    <div className="space-y-3">
      {actions.map((action, index) => (
        <GlassPanel key={`${action.kind}-${index}`} className="p-4 sm:p-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Text as="span" variant="bodySm">
                {t('automations.builder.actionNumber', 'Action {{number}}', { number: index + 1 })}
              </Text>
              <div className="flex items-center gap-1">
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveAction(index, -1)}
                  disabled={index === 0}
                  aria-label={t('automations.builder.moveUp', 'Move up')}
                  className="p-1"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveAction(index, 1)}
                  disabled={index === actions.length - 1}
                  aria-label={t('automations.builder.moveDown', 'Move down')}
                  className="p-1"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAction(index)}
                  aria-label={t('automations.builder.removeAction', 'Remove action')}
                  className="p-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </UiButton>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]">
              <div className="min-w-0">
                <UiSelect
                  id={`automation-action-kind-${index}`}
                  label={t('automations.builder.actionType', 'Action type')}
                  options={actionTypeOptions}
                  value={action.kind}
                  onChange={(event) => replaceAction(
                    index,
                    createDefaultAction(event.target.value as AutomationActionKind, defaultChannelId),
                  )}
                  className="w-full"
                />
              </div>
              <ActionFields
                action={action}
                channelOptions={channelOptions}
                onChange={(nextAction) => replaceAction(index, nextAction)}
              />
            </div>
          </div>
        </GlassPanel>
      ))}

      <UiButton type="button" variant="ghost" size="sm" onClick={addAction}>
        <Plus className="mr-1 h-4 w-4" />
        {t('automations.builder.addAction', 'Add action')}
      </UiButton>
    </div>
  );
}

function ActionFields({ action, channelOptions, onChange }: ActionFieldsProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const guidedFields = action.kind === 'action_command'
    ? GUIDED_COMMAND_FIELDS[action.command_name] ?? [] : [];
  // Initialise the params editor once from the action's stored params. The
  // parent remounts this component (its GlassPanel key includes action.kind
  // and the row index) whenever the kind changes or rows are reordered, so a
  // lazy initialiser is enough — and it avoids the previous effect that
  // re-stringified (pretty-printed) the textarea on every keystroke, which
  // clobbered in-progress input the instant it became valid JSON.
  const [paramsText, setParamsText] = useState<string>(() => (
    action.kind === 'action_command' && action.command_params
      ? JSON.stringify(action.command_params, null, 2)
      : ''
  ));
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(
    action.kind === 'action_command' && action.command_params &&
    Object.keys(action.command_params).some((key) => !guidedFields.some((field) => field.key === key)),
  ));

  const commandOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectCommand', 'Select command...') },
      ...COMMAND_GROUPS.flatMap((group) => {
        const groupLabel = t(group.labelKey, group.fallback);
        return group.commands.map((command) => ({
          value: command.value,
          label: `${groupLabel} - ${t(command.labelKey, command.fallback)}`,
        }));
      }),
    ],
    [t],
  );

  switch (action.kind) {
    case 'action_command':
      return (
        <div className="min-w-0 space-y-4">
          <UiSelect
            label={t('automations.builder.command', 'Command')}
            options={commandOptions}
            value={action.command_name}
            onChange={(event) => {
              setParamsText('');
              setParamsError(null);
              setShowAdvanced(false);
              onChange({ ...action, command_name: event.target.value, command_params: undefined });
            }}
            className="w-full sm:max-w-md"
          />
          {guidedFields.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {guidedFields.map(({ key, labelKey, fallback, min, max }) => (
                <UnitInput
                  key={key}
                  label={t(labelKey, fallback)}
                  unit={action.command_name === 'set_temps' ? 'temperature' : key === 'percent' ? 'percent' : 'count'}
                  min={min}
                  max={max}
                  value={typeof action.command_params?.[key] === 'number'
                    ? action.command_params[key] : null}
                  commitOnChange
                  onChange={(value) => {
                    const next = { ...action.command_params };
                    if (value === null) delete next[key];
                    else next[key] = value;
                    const command_params = Object.keys(next).length ? next : undefined;
                    setParamsText(command_params ? JSON.stringify(command_params, null, 2) : '');
                    onChange({ ...action, command_params });
                  }}
                  className="w-full"
                />
              ))}
            </div>
          )}
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={showAdvanced && Boolean(paramsError)}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced
              ? t('automations.builder.hideAdvancedParams', 'Hide advanced parameters')
              : t('automations.builder.showAdvancedParams', 'Advanced parameters (JSON)')}
          </UiButton>
          {showAdvanced && (
            <UiTextarea
              label={t('automations.builder.commandParams', 'Params (JSON, optional)')}
              value={paramsText}
              onChange={(event) => {
                const nextText = event.target.value;
                setParamsText(nextText);
                if (!nextText.trim()) {
                  setParamsError(null);
                  event.target.setCustomValidity('');
                  onChange({ ...action, command_params: undefined });
                  return;
                }
                try {
                  const parsed: unknown = JSON.parse(nextText);
                  if (!isCommandParams(parsed)) {
                    const message = t(
                      'automations.builder.commandParamsObjectError',
                      'Params must be a JSON object.',
                    );
                    setParamsError(message);
                    event.target.setCustomValidity(message);
                    return;
                  }
                  setParamsError(null);
                  event.target.setCustomValidity('');
                  onChange({ ...action, command_params: parsed });
                } catch (error) {
                  const message = error instanceof Error
                    ? error.message
                    : t('automations.builder.invalidJson', 'Invalid JSON');
                  setParamsError(message);
                  event.target.setCustomValidity(message);
                }
              }}
              placeholder={t('automations.builder.commandParamsPlaceholder', '{}')}
              rows={2}
              error={paramsError ?? undefined}
              className="font-mono text-xs"
            />
          )}
        </div>
      );

    case 'action_notify':
      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiSelect
            label={t('automations.builder.channel', 'Channel')}
            options={channelOptions.length > 0
              ? channelOptions
              : [{ value: '0', label: t('automations.builder.noChannels', 'No channels configured') }]}
            value={String(action.channel_id)}
            onChange={(event) => onChange({
              ...action,
              channel_id: Number.parseInt(event.target.value, 10) || 0,
            })}
            className="w-48"
          />
          <div className="min-w-[220px] flex-1">
            <UiTextarea
              label={t('automations.builder.notifyMessage', 'Message')}
              value={action.template}
              onChange={(event) => onChange({ ...action, template: event.target.value })}
              placeholder={t('automations.builder.notifyPlaceholder', 'Car is warming up!')}
              rows={2}
            />
          </div>
        </div>
      );

    case 'action_set_setting': {
      const valueKind = settingValueKind(action);
      const value = valueKind === 'number'
        ? action.value_num == null ? '' : String(action.value_num)
        : valueKind === 'boolean'
          ? String(action.value_bool ?? false)
          : (action.value_text ?? '');

      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiInput
            label={t('automations.builder.settingKey', 'Setting key')}
            value={action.setting_key}
            onChange={(event) => onChange({ ...action, setting_key: event.target.value })}
            placeholder={t('automations.builder.settingKeyPlaceholder', 'charge_limit')}
            className="w-44"
          />
          <UiSelect
            label={t('automations.builder.valueType', 'Value type')}
            options={[
              { value: 'text', label: t('automations.builder.valueText', 'Text') },
              { value: 'number', label: t('automations.builder.valueNumber', 'Number') },
              { value: 'boolean', label: t('automations.builder.valueBoolean', 'Boolean') },
            ]}
            value={valueKind}
            onChange={(event) => {
              const nextKind = event.target.value as SettingValueKind;
              onChange(actionWithSettingValue(action, nextKind,
                nextKind === 'number' ? parseForUnit(value, 'number', settings) : value));
            }}
            className="w-36"
          />
          {valueKind === 'boolean' ? (
            <UiSelect
              label={t('automations.builder.value', 'Value')}
              options={[
                { value: 'true', label: t('common.true', 'True') },
                { value: 'false', label: t('common.false', 'False') },
              ]}
              value={value}
              onChange={(event) => onChange(actionWithSettingValue(action, valueKind, event.target.value))}
              className="w-28"
            />
          ) : valueKind === 'number' ? (
            <UnitInput
              label={t('automations.builder.value', 'Value')}
              unit="number"
              value={action.value_num ?? null}
              commitOnChange
              onChange={(next) => onChange(actionWithSettingValue(action, valueKind, next))}
              placeholder={t('automations.builder.valueNumberPlaceholder', '80')}
              className="w-44"
            />
          ) : (
            <UiInput
              label={t('automations.builder.value', 'Value')}
              value={value}
              onChange={(event) => onChange(actionWithSettingValue(action, valueKind, event.target.value))}
              placeholder={t('automations.builder.valueTextPlaceholder', 'enabled')}
              className="w-44"
            />
          )}
        </div>
      );
    }

    case 'action_call_automation':
      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiInput
            label={t('automations.builder.targetAutomationId', 'Target automation ID')}
            type="number"
            min={1}
            value={action.target_automation_id || ''}
            onChange={(event) => onChange({
              ...action,
              target_automation_id: Number.parseInt(event.target.value, 10) || 0,
            })}
            className="w-48"
          />
        </div>
      );
  }
}
