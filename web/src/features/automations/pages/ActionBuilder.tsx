/**
 * ActionBuilder — manages an ordered array of automation actions.
 *
 * Action types: command, wait, notify, set_variable
 * Each row has type dropdown, type-specific config fields, delete, and move up/down.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Textarea } from '@/components/ui/Textarea';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

// ─── Type registry ────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  { value: 'command', label: 'Vehicle Command' },
  { value: 'wait', label: 'Wait / Delay' },
  { value: 'notify', label: 'Send Notification' },
  { value: 'set_variable', label: 'Set Variable' },
] as const;

// Grouped Tesla commands (curated list, no aliases)
const COMMAND_GROUPS: { label: string; commands: { value: string; label: string }[] }[] = [
  {
    label: 'Security & Access',
    commands: [
      { value: 'lock', label: 'Lock Doors' },
      { value: 'unlock', label: 'Unlock Doors' },
      { value: 'sentry_on', label: 'Sentry Mode On' },
      { value: 'sentry_off', label: 'Sentry Mode Off' },
      { value: 'valet_on', label: 'Valet Mode On' },
      { value: 'valet_off', label: 'Valet Mode Off' },
      { value: 'guest_mode_on', label: 'Guest Mode On' },
      { value: 'guest_mode_off', label: 'Guest Mode Off' },
    ],
  },
  {
    label: 'Climate',
    commands: [
      { value: 'climate_on', label: 'Climate On' },
      { value: 'climate_off', label: 'Climate Off' },
      { value: 'set_temps', label: 'Set Temperature' },
      { value: 'seat_heater', label: 'Seat Heater' },
      { value: 'seat_cooler', label: 'Seat Cooler' },
      { value: 'steering_wheel_heat', label: 'Steering Wheel Heater' },
      { value: 'preconditioning_max', label: 'Max Preconditioning' },
      { value: 'preconditioning_reset', label: 'Reset Preconditioning' },
      { value: 'dog_mode', label: 'Dog Mode' },
      { value: 'camp_mode', label: 'Camp Mode' },
      { value: 'bioweapon_on', label: 'Bioweapon Defense On' },
      { value: 'bioweapon_off', label: 'Bioweapon Defense Off' },
      { value: 'cop_on', label: 'Cabin Overheat Protection On' },
      { value: 'cop_off', label: 'Cabin Overheat Protection Off' },
    ],
  },
  {
    label: 'Charging',
    commands: [
      { value: 'charge_start', label: 'Start Charging' },
      { value: 'charge_stop', label: 'Stop Charging' },
      { value: 'set_charge_limit', label: 'Set Charge Limit' },
      { value: 'set_charging_amps', label: 'Set Charging Amps' },
      { value: 'open_charge_port', label: 'Open Charge Port' },
      { value: 'close_charge_port', label: 'Close Charge Port' },
      { value: 'charge_max_range', label: 'Charge to Max Range' },
    ],
  },
  {
    label: 'Doors & Trunk',
    commands: [
      { value: 'frunk_open', label: 'Open Frunk' },
      { value: 'trunk_open', label: 'Open Trunk' },
    ],
  },
  {
    label: 'Windows & Sunroof',
    commands: [
      { value: 'vent_windows', label: 'Vent Windows' },
      { value: 'close_windows', label: 'Close Windows' },
      { value: 'sunroof_vent', label: 'Vent Sunroof' },
      { value: 'sunroof_close', label: 'Close Sunroof' },
    ],
  },
  {
    label: 'Alerts',
    commands: [
      { value: 'honk', label: 'Honk Horn' },
      { value: 'flash', label: 'Flash Lights' },
    ],
  },
  {
    label: 'Media',
    commands: [
      { value: 'media_toggle_playback', label: 'Toggle Playback' },
      { value: 'media_next_track', label: 'Next Track' },
      { value: 'media_prev_track', label: 'Previous Track' },
    ],
  },
  {
    label: 'Navigation',
    commands: [
      { value: 'navigation_request', label: 'Navigate to Address' },
      { value: 'navigation_gps_request', label: 'Navigate to GPS' },
      { value: 'trigger_homelink', label: 'Trigger HomeLink' },
    ],
  },
  {
    label: 'Drive & Software',
    commands: [
      { value: 'remote_start_drive', label: 'Remote Start' },
      { value: 'schedule_software_update', label: 'Schedule Update' },
      { value: 'cancel_software_update', label: 'Cancel Update' },
      { value: 'wake_up', label: 'Wake Up' },
    ],
  },
];

const FLAT_COMMANDS = COMMAND_GROUPS.flatMap((g) =>
  g.commands.map((c) => ({ value: c.value, label: `${g.label} — ${c.label}` })),
);

const NOTIFY_CHANNELS = [
  { value: 'all', label: 'All Channels' },
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Email' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'ntfy', label: 'ntfy' },
  { value: 'pushover', label: 'Pushover' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function getDefaultAction(type: string): Record<string, unknown> {
  switch (type) {
    case 'command':
      return { type: 'command', command: 'climate_on', params: {} };
    case 'wait':
      return { type: 'wait', duration_seconds: 10 };
    case 'notify':
      return { type: 'notify', channel: 'all', message: '', title: '' };
    case 'set_variable':
      return { type: 'set_variable', key: '', value: '' };
    default:
      return { type };
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ActionBuilderProps {
  actions: Record<string, unknown>[];
  onChange: (actions: Record<string, unknown>[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActionBuilder({ actions, onChange }: ActionBuilderProps) {
  const { t } = useTranslation();

  const addAction = useCallback(() => {
    onChange([...actions, getDefaultAction('command')]);
  }, [actions, onChange]);

  const removeAction = useCallback(
    (index: number) => onChange(actions.filter((_, i) => i !== index)),
    [actions, onChange],
  );

  const updateAction = useCallback(
    (index: number, patch: Record<string, unknown>) => {
      const next = actions.map((a, i) => (i === index ? { ...a, ...patch } : a));
      onChange(next);
    },
    [actions, onChange],
  );

  const replaceActionType = useCallback(
    (index: number, newType: string) => {
      const next = actions.map((a, i) => (i === index ? getDefaultAction(newType) : a));
      onChange(next);
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
      {actions.map((action, index) => {
        const actionType = str(action.type);
        return (
          <GlassPanel key={index} className="p-4">
            <div className="flex items-start gap-2">
              <span className="text-xs text-white/30 font-mono mt-8 w-6 text-right shrink-0">
                {index + 1}.
              </span>
              <div className="flex-1 space-y-3">
                <div className="flex gap-3 items-end flex-wrap">
                  <Select
                    label={index === 0 ? t('automations.builder.actionType', 'Action Type') : undefined}
                    options={ACTION_TYPES.map((at) => ({ value: at.value, label: at.label }))}
                    value={actionType}
                    onChange={(e) => replaceActionType(index, e.target.value)}
                    className="w-44"
                  />
                  <ActionFields
                    type={actionType}
                    config={action}
                    onChange={(patch) => updateAction(index, patch)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1 mt-6 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveAction(index, -1)}
                  disabled={index === 0}
                  aria-label={t('automations.builder.moveUp', 'Move up')}
                  className="p-1"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveAction(index, 1)}
                  disabled={index === actions.length - 1}
                  aria-label={t('automations.builder.moveDown', 'Move down')}
                  className="p-1"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAction(index)}
                  aria-label={t('automations.builder.removeAction', 'Remove action')}
                  className="p-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </GlassPanel>
        );
      })}

      <Button variant="ghost" size="sm" onClick={addAction}>
        <Plus className="h-4 w-4 mr-1" />
        {t('automations.builder.addAction', 'Add Action')}
      </Button>
    </div>
  );
}

// ─── Action-type fields ───────────────────────────────────────────────────────

interface ActionFieldsProps {
  type: string;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

function ActionFields({ type, config, onChange }: ActionFieldsProps) {
  const { t } = useTranslation();

  switch (type) {
    case 'command': {
      const params = (typeof config.params === 'object' && config.params !== null)
        ? config.params as Record<string, unknown>
        : {};
      const paramsStr = Object.keys(params).length > 0 ? JSON.stringify(params, null, 2) : '';

      return (
        <div className="flex gap-3 items-end flex-wrap flex-1">
          <Select
            options={[{ value: '', label: t('automations.builder.selectCommand', 'Select command...') }, ...FLAT_COMMANDS]}
            value={str(config.command)}
            onChange={(e) => onChange({ command: e.target.value })}
            className="w-64"
          />
          <div className="flex-1 min-w-[160px]">
            <Input
              label={t('automations.builder.commandParams', 'Params (JSON, optional)')}
              value={paramsStr}
              onChange={(e) => {
                try {
                  const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                  onChange({ params: parsed });
                } catch {
                  // Keep invalid input for user to fix — don't overwrite
                }
              }}
              placeholder='{"temp": 21}'
              className="font-mono text-xs"
            />
          </div>
        </div>
      );
    }

    case 'wait':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Input
            label={t('automations.builder.waitSeconds', 'Duration (seconds)')}
            type="number"
            min={1}
            max={3600}
            value={num(config.duration_seconds, 10)}
            onChange={(e) => onChange({ duration_seconds: parseInt(e.target.value, 10) || 1 })}
            className="w-36"
          />
        </div>
      );

    case 'notify':
      return (
        <div className="flex gap-3 items-end flex-wrap flex-1">
          <Select
            options={NOTIFY_CHANNELS}
            value={str(config.channel) || 'all'}
            onChange={(e) => onChange({ channel: e.target.value })}
            className="w-36"
          />
          <div className="flex-1 min-w-[200px]">
            <Textarea
              label={t('automations.builder.notifyMessage', 'Message')}
              value={str(config.message)}
              onChange={(e) => onChange({ message: e.target.value })}
              placeholder={t('automations.builder.notifyPlaceholder', 'Car is warming up! 🔥')}
              rows={2}
            />
          </div>
        </div>
      );

    case 'set_variable':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Input
            label={t('automations.builder.variableKey', 'Key')}
            value={str(config.key)}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="my_var"
            className="w-40"
          />
          <Input
            label={t('automations.builder.variableValue', 'Value')}
            value={str(config.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="42"
            className="w-40"
          />
        </div>
      );

    default:
      return null;
  }
}
