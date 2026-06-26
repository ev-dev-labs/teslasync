// Native parity port of web/src/features/automations/pages/TriggerConfigurator.tsx.
//
// A controlled trigger-configuration form used inside the automation builder.
// It is NOT a full page (no PageContainer / route): it renders one of four
// trigger editors keyed off `trigger.kind` and bubbles every edit up through
// the `onChange(trigger)` callback. The exported helpers (TRIGGER_TYPES,
// createDefaultTrigger) and the props contract (TriggerConfiguratorProps:
// { trigger, onChange }) keep their names so the parent builder can consume
// them identically.
//
// Behaviour is preserved one-for-one with the web source:
//   - The four pure data tables (TRIGGER_TYPES, VEHICLE_EVENTS, GEOFENCE_EVENTS,
//     SIGNAL_OPERATORS) keep their values, ordering, i18n keys and English
//     fallbacks verbatim.
//   - buildCronExpr / parseCronExpr / createDefaultTrigger / signalValueFromInput
//     are ported byte-for-byte (same guards, same defaults '0 8 * * *' / 'UTC' /
//     'online' / place_id 0 / battery_level '<' 20, same BOOL/'state'/numeric
//     branching, same `Number.parseFloat(value) || 0`).
//   - The four useMemo option lists (geofenceOptions, eventOptions,
//     geofenceEventOptions, signalOperatorOptions) and the handleDayToggle
//     useCallback keep identical logic and dependency arrays.
//   - The schedule branch's parseCronExpr-driven simple/advanced split, the
//     hour/minute/day derivations, updateCron, the day-toggle ring logic, the
//     simple<->advanced link, and the timezone select are reproduced exactly.
//   - The event / geofence / signal branches keep the same controls, the same
//     conditional dwell-minutes field, the same bool-vs-text-vs-number value
//     editor, and the same "Fire on any change" toggle wiring.
//   - Every t('key', 'English default') call keeps its exact key + default so
//     i18n intent is preserved (a native (key, fallback) shim returns the
//     fallback, mirroring i18next's missing-key behaviour with the dev copy).
//
// Unit handling: this configurator stores RAW threshold values exactly as the
// web source does (`value_num: Number.parseFloat(value) || 0`, dwell minutes
// via Number.parseInt). No SI<->display conversion happens on web and none is
// added here — the signal threshold the user types is persisted as-is.
//
// Web dependencies absent from the native parity layer are remapped to
// native-safe equivalents (contract rules 4, 5, 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation():
//     a stable (key, fallback) => fallback shim.
//   - @/components/ui Input  -> <TextField>: a labelled RN <TextInput> with the
//     same label / value / onChange (DOM `event.target.value` becomes RN
//     `onChangeText(text)`), optional help + hint captions, and optional
//     placeholder. The web `type="time"` DOM time picker and `type="number"`
//     min/max spinners have no native widget, so they degrade to a controlled
//     text field ("HH:MM" for time, numeric keyboards for numbers); the exact
//     split(':')/parseInt/parseFloat parsing is unchanged so stored values stay
//     identical.
//   - @/components/ui Select -> <SelectField>: a horizontal chip row (the
//     established native dropdown analogue) with the same options/value and an
//     onValueChange(value) that replaces `event.target.value`.
//   - @/components/ui Toggle -> <Toggle>: an RN <Switch> + tappable label, same
//     checked / onChange(checked) contract.
//   - @/components/ui Button (the day chips + the simple/advanced link) ->
//     <DayButton> / <LinkButton> Pressables preserving the active-ring and
//     underlined-link visual intent.
//   - lucide-react Clock/Zap/MapPin/Activity (used ONLY as TRIGGER_TYPES.icon
//     metadata, never rendered in this file) -> the native SemanticIconName
//     strings 'clock'/'bolt'/'mapPinned'/'activity', so each trigger type keeps
//     a distinct, meaning-preserving icon when the parent renders it.
//   - @/lib/constants DAYS + COMMON_TIMEZONES and @/lib/signals SIGNAL_FIELDS
//     (-> SIGNAL_FIELD_OPTIONS + BOOL_FIELD_KEYS) -> inlined verbatim as local
//     constants (plain data, no DOM dependency).
//   - ../components/stepInputTypes AutomationTriggerStepInput -> reproduced
//     locally as Omit<AutomationTriggerStep,'id'|'automation_id'|'step_id'|
//     'step_order'> distributed over the union, identical to the web type.
//   - @/api/hooks/useLocations useGeofences -> the already-ported native
//     ../../../api/hooks/useLocations useGeofences.
//   - @/types/automations -> the already-ported native ../../../api/hooks/
//     useAutomations (identical type shapes).
//
// Tailwind/CSS-var styling maps to theme tokens: --accent -> colors.accent,
// bg-accent/20 -> colors.accentSoft, ring-accent/50 -> colors.borderAccent,
// --text-secondary -> colors.textSecondary, --text-muted -> colors.textMuted,
// --text-primary / text-white -> colors.textPrimary. No DOM-only modules, HTML
// elements, react-i18next, lucide-react, Recharts, Leaflet, or web UI
// components are imported — only react, react-native primitives, the ported
// web-parity hooks/types, and the existing apps/native AppText + theme tokens.

import React, {useCallback, useMemo} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import type {SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';
import {useGeofences} from '../../../api/hooks/useLocations';
import type {
  AutomationEventType,
  AutomationGeofenceEvent,
  AutomationTriggerKind,
  AutomationTriggerSignalOp,
  AutomationTriggerStep,
} from '../../../api/hooks/useAutomations';

/* ── Local analogue of web ../components/stepInputTypes ───────────────────── */

type TriggerStepInput<T> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>
  : never;

export type AutomationTriggerStepInput =
  TriggerStepInput<AutomationTriggerStep>;

/* ── Inlined @/lib/constants (DAYS, COMMON_TIMEZONES) ─────────────────────── */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const COMMON_TIMEZONES: {value: string; label: string}[] = [
  {value: '', label: 'UTC (Default)'},
  {value: 'America/New_York', label: 'Eastern (US)'},
  {value: 'America/Chicago', label: 'Central (US)'},
  {value: 'America/Denver', label: 'Mountain (US)'},
  {value: 'America/Los_Angeles', label: 'Pacific (US)'},
  {value: 'Europe/London', label: 'London (UK)'},
  {value: 'Europe/Berlin', label: 'Berlin (EU)'},
  {value: 'Europe/Paris', label: 'Paris (EU)'},
  {value: 'Asia/Tokyo', label: 'Tokyo (JP)'},
  {value: 'Asia/Shanghai', label: 'Shanghai (CN)'},
  {value: 'Australia/Sydney', label: 'Sydney (AU)'},
];

/* ── Inlined @/lib/signals (SIGNAL_FIELD_OPTIONS, BOOL_FIELD_KEYS) ─────────── */

type SignalFieldType = 'numeric' | 'boolean' | 'string';

interface SignalField {
  key: string;
  label: string;
  type: SignalFieldType;
  unit?: string;
}

const SIGNAL_FIELDS: SignalField[] = [
  {key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%'},
  {
    key: 'inside_temp',
    label: 'Inside Temperature',
    type: 'numeric',
    unit: '°C',
  },
  {
    key: 'outside_temp',
    label: 'Outside Temperature',
    type: 'numeric',
    unit: '°C',
  },
  {key: 'speed', label: 'Speed', type: 'numeric', unit: 'mph'},
  {key: 'is_locked', label: 'Is Locked', type: 'boolean'},
  {key: 'is_charging', label: 'Is Charging', type: 'boolean'},
  {key: 'is_climate_on', label: 'Climate On', type: 'boolean'},
  {key: 'sentry_mode', label: 'Sentry Mode', type: 'boolean'},
  {key: 'state', label: 'Vehicle State', type: 'string'},
];

const BOOL_FIELD_KEYS = new Set(
  SIGNAL_FIELDS.filter(f => f.type === 'boolean').map(f => f.key),
);

const SIGNAL_FIELD_OPTIONS = SIGNAL_FIELDS.map(f => ({
  value: f.key,
  label: f.label,
}));

/* ── Trigger metadata tables (ported verbatim) ────────────────────────────── */

type TriggerTypeOption = {
  value: AutomationTriggerKind;
  labelKey: string;
  fallback: string;
  // web `icon: typeof Clock` (a lucide component) -> native SemanticIconName.
  icon: SemanticIconName;
};

export const TRIGGER_TYPES: TriggerTypeOption[] = [
  {
    value: 'trigger_schedule',
    labelKey: 'automations.builder.triggerSchedule',
    fallback: 'Schedule',
    icon: 'clock',
  },
  {
    value: 'trigger_event',
    labelKey: 'automations.builder.triggerEvent',
    fallback: 'Vehicle Event',
    icon: 'bolt',
  },
  {
    value: 'trigger_geofence',
    labelKey: 'automations.builder.triggerGeofence',
    fallback: 'Geofence',
    icon: 'mapPinned',
  },
  {
    value: 'trigger_signal',
    labelKey: 'automations.builder.triggerSignal',
    fallback: 'Signal Threshold',
    icon: 'activity',
  },
];

const VEHICLE_EVENTS: {
  value: AutomationEventType;
  labelKey: string;
  fallback: string;
}[] = [
  {
    value: 'drive_start',
    labelKey: 'automations.events.driveStart',
    fallback: 'Drive Starts',
  },
  {
    value: 'drive_end',
    labelKey: 'automations.events.driveEnd',
    fallback: 'Drive Ends',
  },
  {
    value: 'charge_start',
    labelKey: 'automations.events.chargeStart',
    fallback: 'Charging Starts',
  },
  {
    value: 'charge_end',
    labelKey: 'automations.events.chargeEnd',
    fallback: 'Charging Ends',
  },
  {
    value: 'sleep_start',
    labelKey: 'automations.events.sleepStart',
    fallback: 'Sleep Starts',
  },
  {
    value: 'sleep_end',
    labelKey: 'automations.events.sleepEnd',
    fallback: 'Sleep Ends',
  },
  {
    value: 'online',
    labelKey: 'automations.events.online',
    fallback: 'Comes Online',
  },
  {
    value: 'offline',
    labelKey: 'automations.events.offline',
    fallback: 'Goes Offline',
  },
  {
    value: 'sentry_alert',
    labelKey: 'automations.events.sentryAlert',
    fallback: 'Sentry Alert',
  },
];

const GEOFENCE_EVENTS: {
  value: AutomationGeofenceEvent;
  labelKey: string;
  fallback: string;
}[] = [
  {value: 'enter', labelKey: 'automations.geofence.enter', fallback: 'Enter'},
  {value: 'exit', labelKey: 'automations.geofence.exit', fallback: 'Exit'},
  {value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell'},
];

const SIGNAL_OPERATORS: {
  value: AutomationTriggerSignalOp;
  labelKey: string;
  fallback: string;
}[] = [
  {value: '=', labelKey: 'automations.operators.equals', fallback: '='},
  {value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!='},
  {value: '<', labelKey: 'automations.operators.lessThan', fallback: '<'},
  {
    value: '<=',
    labelKey: 'automations.operators.lessThanOrEqual',
    fallback: '<=',
  },
  {value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>'},
  {
    value: '>=',
    labelKey: 'automations.operators.greaterThanOrEqual',
    fallback: '>=',
  },
  {
    value: 'changed',
    labelKey: 'automations.operators.changed',
    fallback: 'Changed',
  },
  {
    value: 'crossed_above',
    labelKey: 'automations.operators.crossedAbove',
    fallback: 'Crossed Above',
  },
  {
    value: 'crossed_below',
    labelKey: 'automations.operators.crossedBelow',
    fallback: 'Crossed Below',
  },
];

interface TriggerConfiguratorProps {
  trigger: AutomationTriggerStepInput;
  onChange: (trigger: AutomationTriggerStepInput) => void;
}

/* ── Cron helpers (ported byte-for-byte) ──────────────────────────────────── */

function buildCronExpr(hour: number, minute: number, days: number[]): string {
  const dow = days.length === 0 || days.length === 7 ? '*' : days.join(',');
  return `${minute} ${hour} * * ${dow}`;
}

function parseCronExpr(
  expr: string,
): {hour: number; minute: number; days: number[]} | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [min, hr, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') {
    return null;
  }
  const minute = Number.parseInt(min, 10);
  const hour = Number.parseInt(hr, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return null;
  }
  const days =
    dow === '*'
      ? []
      : dow
          .split(',')
          .map(Number)
          .filter(day => !Number.isNaN(day));
  return {hour, minute, days};
}

export function createDefaultTrigger(
  kind: AutomationTriggerKind,
): AutomationTriggerStepInput {
  switch (kind) {
    case 'trigger_schedule':
      return {kind, cron_expr: '0 8 * * *', timezone: 'UTC'};
    case 'trigger_event':
      return {kind, event_type: 'online'};
    case 'trigger_geofence':
      return {kind, place_id: 0, event: 'enter'};
    case 'trigger_signal':
      return {kind, signal: 'battery_level', op: '<', value_num: 20};
  }
}

function signalValueFromInput(
  trigger: Extract<AutomationTriggerStepInput, {kind: 'trigger_signal'}>,
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

/* ── i18n shim (react-i18next useTranslation) ─────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ── Native-safe form primitives (web @/components/ui Input/Select/Toggle) ── */

function FieldLabel({children}: {children: string}) {
  return (
    <AppText
      style={styles.fieldLabel}
      tone="secondary"
      variant="caption"
      weight="semibold"
    >
      {children}
    </AppText>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  help?: string;
  hint?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  compact?: boolean;
}

function TextField({
  label,
  value,
  onChangeText,
  help,
  hint,
  placeholder,
  keyboardType,
  compact = false,
}: TextFieldProps) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      {help ? (
        <AppText style={styles.helpHint} tone="muted" variant="caption">
          {help}
        </AppText>
      ) : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, compact && styles.inputCompact]}
        value={value}
      />
      {hint ? (
        <AppText style={styles.hint} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

interface SelectFieldProps {
  label: string;
  options: {value: string; label: string}[];
  value: string;
  onValueChange: (value: string) => void;
}

function SelectField({label, options, value, onValueChange}: SelectFieldProps) {
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.selectRow}
      >
        {options.map(option => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              hitSlop={4}
              key={option.value === '' ? '__empty__' : option.value}
              onPress={() => onValueChange(option.value)}
              style={({pressed}) => [
                styles.selectChip,
                active && styles.selectChipActive,
                pressed && styles.pressed,
              ]}
            >
              <AppText
                style={
                  active ? styles.selectChipTextActive : styles.selectChipText
                }
                variant="caption"
                weight="semibold"
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function DayButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.dayButton,
        active && styles.dayButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <AppText
        style={active ? styles.dayButtonTextActive : styles.dayButtonText}
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function LinkButton({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [styles.linkButton, pressed && styles.pressed]}
    >
      <AppText style={styles.linkText} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Switch
        ios_backgroundColor={colors.surfaceRaised}
        onValueChange={onChange}
        thumbColor={colors.textPrimary}
        trackColor={{false: colors.surfaceRaised, true: colors.accent}}
        value={checked}
      />
      <Pressable hitSlop={4} onPress={() => onChange(!checked)}>
        <AppText tone="secondary" variant="caption" weight="semibold">
          {label}
        </AppText>
      </Pressable>
    </View>
  );
}

/* ── TriggerConfigurator ──────────────────────────────────────────────────── */

export function TriggerConfigurator({
  trigger,
  onChange,
}: TriggerConfiguratorProps) {
  const t = useNativeTranslation();
  const {data: geofences} = useGeofences();

  const geofenceOptions = useMemo(
    () => [
      {
        value: '',
        label: t('automations.builder.selectGeofence', 'Select geofence...'),
      },
      ...(geofences ?? []).map(g => ({value: String(g.id), label: g.name})),
    ],
    [geofences, t],
  );

  const eventOptions = useMemo(
    () =>
      VEHICLE_EVENTS.map(event => ({
        value: event.value,
        label: t(event.labelKey, event.fallback),
      })),
    [t],
  );

  const geofenceEventOptions = useMemo(
    () =>
      GEOFENCE_EVENTS.map(event => ({
        value: event.value,
        label: t(event.labelKey, event.fallback),
      })),
    [t],
  );

  const signalOperatorOptions = useMemo(
    () =>
      SIGNAL_OPERATORS.map(operator => ({
        value: operator.value,
        label: t(operator.labelKey, operator.fallback),
      })),
    [t],
  );

  const handleDayToggle = useCallback((days: number[], day: number) => {
    if (days.length === 0) {
      return DAYS.map((_, index) => index).filter(index => index !== day);
    }
    const next = days.includes(day)
      ? days.filter(current => current !== day)
      : [...days, day].sort();
    return next.length === 7 ? [] : next;
  }, []);

  switch (trigger.kind) {
    case 'trigger_schedule': {
      const parsed = parseCronExpr(trigger.cron_expr);
      const isSimple = parsed !== null;
      const hour = parsed?.hour ?? 8;
      const minute = parsed?.minute ?? 0;
      const selectedDays = parsed?.days ?? [];

      const updateCron = (h: number, m: number, d: number[]) => {
        onChange({...trigger, cron_expr: buildCronExpr(h, m, d)});
      };

      return (
        <View style={styles.container}>
          {isSimple ? (
            <>
              <TextField
                compact
                label={t('automations.builder.time', 'Time')}
                onChangeText={text => {
                  const [nextHour, nextMinute] = text.split(':').map(Number);
                  updateCron(
                    nextHour ?? hour,
                    nextMinute ?? minute,
                    selectedDays,
                  );
                }}
                value={`${String(hour).padStart(2, '0')}:${String(
                  minute,
                ).padStart(2, '0')}`}
              />
              <View>
                <FieldLabel>{t('automations.builder.days', 'Days')}</FieldLabel>
                <View style={styles.daysRow}>
                  {DAYS.map((label, index) => {
                    const active =
                      selectedDays.length === 0 || selectedDays.includes(index);
                    return (
                      <DayButton
                        active={active}
                        key={label}
                        label={t(`common.days.short.${index}`, label)}
                        onPress={() =>
                          updateCron(
                            hour,
                            minute,
                            handleDayToggle(selectedDays, index),
                          )
                        }
                      />
                    );
                  })}
                </View>
              </View>
            </>
          ) : (
            <TextField
              help={t(
                'help.fields.automations.cronExpr',
                'Standard 5-field cron syntax (minute hour day-of-month month day-of-week). Use the simple mode above for the most common schedules.',
              )}
              hint={t(
                'automations.builder.cronHint',
                'minute hour day-of-month month day-of-week',
              )}
              label={t('automations.builder.cronExpr', 'Cron Expression')}
              onChangeText={text => onChange({...trigger, cron_expr: text})}
              placeholder={t(
                'automations.builder.cronPlaceholder',
                '0 8 * * 1-5',
              )}
              value={trigger.cron_expr}
            />
          )}
          <LinkButton
            label={
              isSimple
                ? t(
                    'automations.builder.advancedCron',
                    'Use advanced cron expression',
                  )
                : t('automations.builder.simpleCron', 'Switch to simple mode')
            }
            onPress={() => {
              onChange({
                ...trigger,
                cron_expr: isSimple ? trigger.cron_expr : '0 8 * * *',
              });
            }}
          />
          <SelectField
            label={t('automations.builder.timezone', 'Timezone')}
            onValueChange={value => onChange({...trigger, timezone: value})}
            options={COMMON_TIMEZONES.map(option => ({
              value: option.value,
              label: t(`timezones.${option.value || 'utc'}`, option.label),
            }))}
            value={trigger.timezone}
          />
        </View>
      );
    }

    case 'trigger_event':
      return (
        <View style={styles.container}>
          <SelectField
            label={t('automations.builder.event', 'Event')}
            onValueChange={value =>
              onChange({
                ...trigger,
                event_type: value as AutomationEventType,
              })
            }
            options={eventOptions}
            value={trigger.event_type}
          />
        </View>
      );

    case 'trigger_geofence':
      return (
        <View style={styles.container}>
          <SelectField
            label={t('automations.builder.geofence', 'Geofence')}
            onValueChange={value =>
              onChange({
                ...trigger,
                place_id: value ? Number(value) : 0,
              })
            }
            options={geofenceOptions}
            value={trigger.place_id > 0 ? String(trigger.place_id) : ''}
          />
          <SelectField
            label={t('automations.builder.geofenceEvent', 'Event')}
            onValueChange={value =>
              onChange({
                ...trigger,
                event: value as AutomationGeofenceEvent,
                dwell_minutes:
                  value === 'dwell' ? trigger.dwell_minutes ?? 5 : undefined,
              })
            }
            options={geofenceEventOptions}
            value={trigger.event}
          />
          {trigger.event === 'dwell' && (
            <TextField
              help={t(
                'help.fields.automations.dwellMinutes',
                'How many minutes the vehicle must stay inside the geofence before this dwell trigger fires.',
              )}
              hint={t(
                'automations.builder.dwellHint',
                'Required for dwell triggers',
              )}
              keyboardType="number-pad"
              label={t('automations.builder.dwellMinutes', 'Dwell Minutes')}
              onChangeText={text =>
                onChange({
                  ...trigger,
                  dwell_minutes: Number.parseInt(text, 10) || 1,
                })
              }
              value={String(trigger.dwell_minutes ?? 5)}
            />
          )}
        </View>
      );

    case 'trigger_signal': {
      const isBool = BOOL_FIELD_KEYS.has(trigger.signal);
      const value = isBool
        ? String(trigger.value_bool ?? true)
        : trigger.signal === 'state'
        ? trigger.value_text ?? 'online'
        : String(trigger.value_num ?? 20);

      return (
        <View style={styles.container}>
          <SelectField
            label={t('automations.builder.signal', 'Signal')}
            onValueChange={signal => {
              const next: AutomationTriggerStepInput = BOOL_FIELD_KEYS.has(
                signal,
              )
                ? {kind: 'trigger_signal', signal, op: '=', value_bool: true}
                : signal === 'state'
                ? {
                    kind: 'trigger_signal',
                    signal,
                    op: '=',
                    value_text: 'online',
                  }
                : {kind: 'trigger_signal', signal, op: '<', value_num: 20};
              onChange(next);
            }}
            options={SIGNAL_FIELD_OPTIONS}
            value={trigger.signal}
          />
          <SelectField
            label={t('automations.builder.operator', 'Operator')}
            onValueChange={opValue => {
              const op = opValue as AutomationTriggerSignalOp;
              if (op === 'changed') {
                onChange({
                  kind: 'trigger_signal',
                  signal: trigger.signal,
                  op,
                });
                return;
              }
              onChange(signalValueFromInput({...trigger, op}, value));
            }}
            options={signalOperatorOptions}
            value={trigger.op}
          />
          {trigger.op !== 'changed' &&
            (isBool ? (
              <SelectField
                label={t('automations.builder.value', 'Value')}
                onValueChange={v => onChange(signalValueFromInput(trigger, v))}
                options={[
                  {value: 'true', label: t('common.true', 'True')},
                  {value: 'false', label: t('common.false', 'False')},
                ]}
                value={value}
              />
            ) : (
              <TextField
                keyboardType={
                  trigger.signal === 'state' ? 'default' : 'numeric'
                }
                label={t('automations.builder.value', 'Value')}
                onChangeText={text =>
                  onChange(signalValueFromInput(trigger, text))
                }
                placeholder={
                  trigger.signal === 'state'
                    ? t('automations.builder.statePlaceholder', 'online')
                    : undefined
                }
                value={value}
              />
            ))}
          <Toggle
            checked={trigger.op === 'changed'}
            label={t('automations.builder.changedOnly', 'Fire on any change')}
            onChange={checked => {
              onChange(
                checked
                  ? {
                      kind: 'trigger_signal',
                      signal: trigger.signal,
                      op: 'changed',
                    }
                  : signalValueFromInput({...trigger, op: '='}, value),
              );
            }}
          />
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    marginBottom: 2,
  },
  helpHint: {
    marginBottom: 2,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputCompact: {
    width: 144,
  },
  hint: {
    marginTop: 2,
  },
  selectRow: {
    flexGrow: 0,
  },
  selectChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  selectChipText: {
    color: colors.textMuted,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  daysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dayButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  dayButtonActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  dayButtonText: {
    color: colors.textMuted,
  },
  dayButtonTextActive: {
    color: colors.accent,
  },
  linkButton: {
    alignSelf: 'flex-start',
  },
  linkText: {
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
