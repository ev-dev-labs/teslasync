import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Input as UiInput,
  Select as UiSelect,
  Text,
  Toggle,
  Button as UiButton,
} from '@/components/ui';
import { useGeofences } from '@/api/hooks/useLocations';
import { DAYS, COMMON_TIMEZONES } from '@/lib/constants';
import { buildSignalFieldOptions, BOOL_FIELD_KEYS } from '@/lib/signals';
import {
  Clock,
  Zap,
  MapPin,
  Activity,
} from 'lucide-react';
import type {
  AutomationEventType,
  AutomationGeofenceEvent,
  AutomationTriggerKind,
  AutomationTriggerSignalOp,
} from '@/types/automations';
import type { AutomationTriggerStepInput } from '../components/stepInputTypes';

type TriggerTypeOption = {
  value: AutomationTriggerKind;
  labelKey: string;
  fallback: string;
  icon: typeof Clock;
};

export const TRIGGER_TYPES: TriggerTypeOption[] = [
  {
    value: 'trigger_schedule',
    labelKey: 'automations.builder.triggerSchedule',
    fallback: 'Schedule',
    icon: Clock,
  },
  {
    value: 'trigger_event',
    labelKey: 'automations.builder.triggerEvent',
    fallback: 'Vehicle Event',
    icon: Zap,
  },
  {
    value: 'trigger_geofence',
    labelKey: 'automations.builder.triggerGeofence',
    fallback: 'Geofence',
    icon: MapPin,
  },
  {
    value: 'trigger_signal',
    labelKey: 'automations.builder.triggerSignal',
    fallback: 'Signal Threshold',
    icon: Activity,
  },
];

const VEHICLE_EVENTS: { value: AutomationEventType; labelKey: string; fallback: string }[] = [
  { value: 'drive_start', labelKey: 'automations.events.driveStart', fallback: 'Drive Starts' },
  { value: 'drive_end', labelKey: 'automations.events.driveEnd', fallback: 'Drive Ends' },
  { value: 'charge_start', labelKey: 'automations.events.chargeStart', fallback: 'Charging Starts' },
  { value: 'charge_end', labelKey: 'automations.events.chargeEnd', fallback: 'Charging Ends' },
  { value: 'sleep_start', labelKey: 'automations.events.sleepStart', fallback: 'Sleep Starts' },
  { value: 'sleep_end', labelKey: 'automations.events.sleepEnd', fallback: 'Sleep Ends' },
  { value: 'online', labelKey: 'automations.events.online', fallback: 'Comes Online' },
  { value: 'offline', labelKey: 'automations.events.offline', fallback: 'Goes Offline' },
  { value: 'sentry_alert', labelKey: 'automations.events.sentryAlert', fallback: 'Sentry Alert' },
];

const GEOFENCE_EVENTS: { value: AutomationGeofenceEvent; labelKey: string; fallback: string }[] = [
  { value: 'enter', labelKey: 'automations.geofence.enter', fallback: 'Enter' },
  { value: 'exit', labelKey: 'automations.geofence.exit', fallback: 'Exit' },
  { value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell' },
];

const SIGNAL_OPERATORS: {
  value: AutomationTriggerSignalOp;
  labelKey: string;
  fallback: string;
}[] = [
  { value: '=', labelKey: 'automations.operators.equals', fallback: '=' },
  { value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!=' },
  { value: '<', labelKey: 'automations.operators.lessThan', fallback: '<' },
  { value: '<=', labelKey: 'automations.operators.lessThanOrEqual', fallback: '<=' },
  { value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>' },
  { value: '>=', labelKey: 'automations.operators.greaterThanOrEqual', fallback: '>=' },
  { value: 'changed', labelKey: 'automations.operators.changed', fallback: 'Changed' },
  { value: 'crossed_above', labelKey: 'automations.operators.crossedAbove', fallback: 'Crossed Above' },
  { value: 'crossed_below', labelKey: 'automations.operators.crossedBelow', fallback: 'Crossed Below' },
];

interface TriggerConfiguratorProps {
  trigger: AutomationTriggerStepInput;
  onChange: (trigger: AutomationTriggerStepInput) => void;
}

function buildCronExpr(hour: number, minute: number, days: number[]): string {
  const dow = days.length === 0 || days.length === 7 ? '*' : days.join(',');
  return `${minute} ${hour} * * ${dow}`;
}

function parseCronExpr(expr: string): { hour: number; minute: number; days: number[] } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return null;
  // Simple mode can only round-trip a single integer minute/hour. Reject
  // lists, ranges, and steps (e.g. "*/15", "0,30", "9-17") so those stay in
  // the raw editor instead of being silently flattened to a lossy value.
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hr)) return null;
  const minute = Number.parseInt(min, 10);
  const hour = Number.parseInt(hr, 10);
  if (minute > 59 || hour > 23) return null;
  const days: number[] = [];
  if (dow !== '*') {
    // A weekday range/step ("1-5", "*/2") is a valid cron the simple UI cannot
    // represent. Only a comma list of 0-6 day indices is safe to parse — any
    // other token keeps the expression in advanced mode so it is not corrupted
    // (e.g. a weekday-only schedule must never be shown as "every day").
    for (const token of dow.split(',')) {
      if (!/^\d$/.test(token)) return null;
      const day = Number.parseInt(token, 10);
      if (day > 6) return null;
      days.push(day);
    }
  }
  return { hour, minute, days };
}

export function createDefaultTrigger(kind: AutomationTriggerKind): AutomationTriggerStepInput {
  switch (kind) {
    case 'trigger_schedule':
      return { kind, cron_expr: '0 8 * * *', timezone: 'UTC' };
    case 'trigger_event':
      return { kind, event_type: 'online' };
    case 'trigger_geofence':
      return { kind, place_id: 0, event: 'enter' };
    case 'trigger_signal':
      return { kind, signal: 'battery_level', op: '<', value_num: 20 };
  }
}

function signalValueFromInput(
  trigger: Extract<AutomationTriggerStepInput, { kind: 'trigger_signal' }>,
  value: string,
): AutomationTriggerStepInput {
  if (trigger.op === 'changed') {
    return {
      kind: 'trigger_signal',
      signal: trigger.signal,
      op: trigger.op,
    };
  }
  if (BOOL_FIELD_KEYS.has(trigger.signal)) {
    return {
      kind: 'trigger_signal',
      signal: trigger.signal,
      op: trigger.op,
      value_bool: value === 'true',
    };
  }
  if (trigger.signal === 'state') {
    return {
      kind: 'trigger_signal',
      signal: trigger.signal,
      op: trigger.op,
      value_text: value,
    };
  }
  return {
    kind: 'trigger_signal',
    signal: trigger.signal,
    op: trigger.op,
    value_num: Number.parseFloat(value) || 0,
  };
}

export function TriggerConfigurator({ trigger, onChange }: TriggerConfiguratorProps) {
  const { t } = useTranslation();
  const { data: geofences, isLoading: geofencesLoading, isError: geofencesError } = useGeofences();
  const [advancedMode, setAdvancedMode] = useState(false);

  const geofenceOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectGeofence', 'Select geofence...') },
      ...(geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    ],
    [geofences, t],
  );

  const eventOptions = useMemo(
    () => VEHICLE_EVENTS.map((event) => ({
      value: event.value,
      label: t(event.labelKey, event.fallback),
    })),
    [t],
  );

  const geofenceEventOptions = useMemo(
    () => GEOFENCE_EVENTS.map((event) => ({
      value: event.value,
      label: t(event.labelKey, event.fallback),
    })),
    [t],
  );

  const signalOperatorOptions = useMemo(
    () => SIGNAL_OPERATORS.map((operator) => ({
      value: operator.value,
      label: t(operator.labelKey, operator.fallback),
    })),
    [t],
  );

  const signalFieldOptions = useMemo(() => buildSignalFieldOptions(t), [t]);

  const handleDayToggle = useCallback((days: number[], day: number) => {
    if (days.length === 0) {
      return DAYS.map((_, index) => index).filter((index) => index !== day);
    }
    const next = days.includes(day)
      ? days.filter((current) => current !== day)
      : [...days, day].sort();
    return next.length === 7 ? [] : next;
  }, []);

  switch (trigger.kind) {
    case 'trigger_schedule': {
      const parsed = parseCronExpr(trigger.cron_expr);
      const showSimple = parsed !== null && !advancedMode;
      const hour = parsed?.hour ?? 8;
      const minute = parsed?.minute ?? 0;
      const selectedDays = parsed?.days ?? [];

      const updateCron = (h: number, m: number, d: number[]) => {
        onChange({ ...trigger, cron_expr: buildCronExpr(h, m, d) });
      };

      return (
        <div className="space-y-4">
          {showSimple ? (
            <>
              <UiInput
                label={t('automations.builder.time', 'Time')}
                type="time"
                value={`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
                onChange={(event) => {
                  const [rawHour, rawMinute] = event.target.value.split(':');
                  const nextHour = Number.parseInt(rawHour, 10);
                  const nextMinute = Number.parseInt(rawMinute, 10);
                  updateCron(
                    Number.isNaN(nextHour) ? hour : nextHour,
                    Number.isNaN(nextMinute) ? minute : nextMinute,
                    selectedDays,
                  );
                }}
                className="w-36"
              />
              <div>
                <Text as="span" variant="subhead">
                  {t('automations.builder.days', 'Days')}
                </Text>
                <div className="mt-1 flex gap-2">
                  {DAYS.map((label, index) => {
                    const active = selectedDays.length === 0 || selectedDays.includes(index);
                    return (
                      <UiButton
                        key={label}
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={active}
                        className={`!h-10 !w-10 !rounded-lg !p-0 text-xs font-medium ${
                          active
                            ? '!bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                            : '!bg-white/[0.03] text-[var(--text-muted)] hover:!bg-white/[0.06]'
                        }`}
                        onClick={() => updateCron(hour, minute, handleDayToggle(selectedDays, index))}
                      >
                        {t(`common.days.short.${index}`, label)}
                      </UiButton>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <UiInput
              label={t('automations.builder.cronExpr', 'Cron Expression')}
              help={{
                i18nKey: 'help.fields.automations.cronExpr',
                content: 'Standard 5-field cron syntax (minute hour day-of-month month day-of-week). Use the simple mode above for the most common schedules.',
              }}
              value={trigger.cron_expr}
              onChange={(event) => onChange({ ...trigger, cron_expr: event.target.value })}
              placeholder={t('automations.builder.cronPlaceholder', '0 8 * * 1-5')}
              hint={t(
                'automations.builder.cronHint',
                'minute hour day-of-month month day-of-week',
              )}
            />
          )}
          <UiButton
            type="button"
            variant="ghost"
            className="!h-auto !px-0 !py-0 text-xs text-[var(--text-muted)] underline hover:!bg-transparent hover:text-[var(--text-secondary)]"
            onClick={() => {
              if (showSimple) {
                setAdvancedMode(true);
                return;
              }
              setAdvancedMode(false);
              if (parsed === null) {
                onChange({ ...trigger, cron_expr: '0 8 * * *' });
              }
            }}
          >
            {showSimple
              ? t('automations.builder.advancedCron', 'Use advanced cron expression')
              : t('automations.builder.simpleCron', 'Switch to simple mode')}
          </UiButton>
          <UiSelect
            label={t('automations.builder.timezone', 'Timezone')}
            options={COMMON_TIMEZONES.map((option) => ({
              value: option.value,
              label: t(`timezones.${option.value || 'utc'}`, option.label),
            }))}
            value={trigger.timezone}
            onChange={(event) => onChange({ ...trigger, timezone: event.target.value })}
          />
        </div>
      );
    }

    case 'trigger_event':
      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.event', 'Event')}
            options={eventOptions}
            value={trigger.event_type}
            onChange={(event) => onChange({
              ...trigger,
              event_type: event.target.value as AutomationEventType,
            })}
          />
        </div>
      );

    case 'trigger_geofence': {
      const geofenceHint = geofencesLoading
        ? t('automations.builder.geofenceLoading', 'Loading geofences…')
        : geofencesError
          ? t('automations.builder.geofenceError', 'Could not load geofences')
          : (geofences ?? []).length === 0
            ? t('automations.builder.geofenceEmpty', 'No geofences configured yet')
            : undefined;

      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.geofence', 'Geofence')}
            options={geofenceOptions}
            hint={geofenceHint}
            value={trigger.place_id > 0 ? String(trigger.place_id) : ''}
            onChange={(event) => onChange({
              ...trigger,
              place_id: event.target.value ? Number(event.target.value) : 0,
            })}
          />
          <UiSelect
            label={t('automations.builder.geofenceEvent', 'Event')}
            options={geofenceEventOptions}
            value={trigger.event}
            onChange={(event) => onChange({
              ...trigger,
              event: event.target.value as AutomationGeofenceEvent,
              dwell_minutes: event.target.value === 'dwell' ? (trigger.dwell_minutes ?? 5) : undefined,
            })}
          />
          {trigger.event === 'dwell' && (
            <UiInput
              label={t('automations.builder.dwellMinutes', 'Dwell Minutes')}
              help={{
                i18nKey: 'help.fields.automations.dwellMinutes',
                content: 'How many minutes the vehicle must stay inside the geofence before this dwell trigger fires.',
              }}
              type="number"
              min={1}
              max={60}
              value={trigger.dwell_minutes ?? 5}
              onChange={(event) => onChange({
                ...trigger,
                dwell_minutes: Number.parseInt(event.target.value, 10) || 1,
              })}
              hint={t('automations.builder.dwellHint', 'Required for dwell triggers')}
            />
          )}
        </div>
      );
    }

    case 'trigger_signal': {
      const isBool = BOOL_FIELD_KEYS.has(trigger.signal);
      const value = isBool
        ? String(trigger.value_bool ?? true)
        : trigger.signal === 'state'
          ? (trigger.value_text ?? 'online')
          : String(trigger.value_num ?? 20);

      return (
        <div className="space-y-4">
          <UiSelect
            label={t('automations.builder.signal', 'Signal')}
            options={signalFieldOptions}
            value={trigger.signal}
            onChange={(event) => {
              const signal = event.target.value;
              const next: AutomationTriggerStepInput = BOOL_FIELD_KEYS.has(signal)
                ? { kind: 'trigger_signal', signal, op: '=', value_bool: true }
                : signal === 'state'
                  ? { kind: 'trigger_signal', signal, op: '=', value_text: 'online' }
                  : { kind: 'trigger_signal', signal, op: '<', value_num: 20 };
              onChange(next);
            }}
          />
          <UiSelect
            label={t('automations.builder.operator', 'Operator')}
            options={signalOperatorOptions}
            value={trigger.op}
            onChange={(event) => {
              const op = event.target.value as AutomationTriggerSignalOp;
              if (op === 'changed') {
                onChange({ kind: 'trigger_signal', signal: trigger.signal, op });
                return;
              }
              onChange(signalValueFromInput({ ...trigger, op }, value));
            }}
          />
          {trigger.op !== 'changed' && (
            isBool ? (
              <UiSelect
                label={t('automations.builder.value', 'Value')}
                options={[
                  { value: 'true', label: t('common.true', 'True') },
                  { value: 'false', label: t('common.false', 'False') },
                ]}
                value={value}
                onChange={(event) => onChange(signalValueFromInput(trigger, event.target.value))}
              />
            ) : (
              <UiInput
                label={t('automations.builder.value', 'Value')}
                type={trigger.signal === 'state' ? 'text' : 'number'}
                value={value}
                onChange={(event) => onChange(signalValueFromInput(trigger, event.target.value))}
                placeholder={trigger.signal === 'state'
                  ? t('automations.builder.statePlaceholder', 'online')
                  : undefined}
              />
            )
          )}
          <Toggle
            label={t('automations.builder.changedOnly', 'Fire on any change')}
            checked={trigger.op === 'changed'}
            onChange={(checked) => {
              onChange(checked
                ? { kind: 'trigger_signal', signal: trigger.signal, op: 'changed' }
                : signalValueFromInput({ ...trigger, op: '=' }, value));
            }}
          />
        </div>
      );
    }

    default:
      return null;
  }
}
