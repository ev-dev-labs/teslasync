// Native parity port of web/src/features/automations/pages/ConditionBuilder.tsx.
//
// `ConditionBuilder` is the automation-rule editor row list: it renders one
// GlassPanel per condition, lets the user pick a condition kind (Signal Check /
// Time Window / Geofence State / Other Automation) and then edits the
// kind-specific fields, and exposes Add / Remove affordances. All of the
// business logic — the four condition kinds, the eight signal operators, the
// bool/state/numeric value coercion in `conditionValueFromInput`, the
// `createDefaultCondition` factory, the `numericValue` clamp, and the
// days-of-week toggle math — is preserved verbatim from the web source so the
// emitted `AutomationConditionStepInput[]` payload is byte-identical.
//
// The web build leans on browser-only pieces that have no React Native analog;
// each is reproduced natively and recorded in the sidecar:
//   - react-i18next `useTranslation()` -> a module-level English-default `t(key,
//     fallback, vars?)` (the established native idiom) that keeps every i18n key
//     and copy string verbatim and interpolates i18next `{{var}}` placeholders.
//   - @/components/ui Input -> a labelled <TextInput> (InputField); Select -> a
//     labelled <Pressable> trigger that opens a <Modal> option picker
//     (SelectField). The web `<select>` natively expands inline; native uses a
//     centered modal listbox (the Combobox/HelpTooltip popover idiom). `type=
//     "time"` has no RN input — it degrades to a free-text HH:MM TextInput with a
//     numbers-and-punctuation keyboard (documented), preserving the string state.
//   - @/components/ui Button (ghost icon buttons) -> bare <Pressable>s carrying
//     the shared SemanticIcon ('add' for lucide Plus, 'delete' for lucide
//     Trash2); the day pills become accessible Pressables with the same
//     active/inactive treatment.
//   - GlassPanel -> the shared native GlassPanel (same glass surface); the web
//     `p-4` padding becomes a StyleSheet value.
//   - The `help={{i18nKey, content}}` Select/Input affordance -> the converted
//     native HelpTooltip (content -> defaultValue), keeping every help key.
//   - @/lib/constants DAYS/COMMON_TIMEZONES, @/lib/signals SIGNAL_FIELD_OPTIONS/
//     BOOL_FIELD_KEYS, @/types/automations, and ../components/stepInputTypes are
//     not exposed through the native parity layer as aliases, so the small pieces
//     this file needs are inlined here (the automation discriminated-union types
//     are reused from ../../../api/hooks/useAutomations to avoid drift).
//   - Tailwind utility classes + CSS vars become StyleSheet styles + theme
//     tokens. Fixed `w-NN` widths become responsive flex so rows wrap on phones.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {useGeofences} from '../../../api/hooks/useLocations';
import type {
  AutomationConditionKind,
  AutomationConditionSignalOp,
  AutomationConditionStep,
  AutomationGeofenceState,
  AutomationOtherAutomationState,
} from '../../../api/hooks/useAutomations';
import {HelpTooltip} from '../../../components/ui/HelpTooltip';

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English fallback verbatim and interpolates any i18next `{{var}}` tokens,
 * preserving the web translation keys and copy.
 */
function t(
  _key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  });
}

/* ─── Inlined dependencies (web @/lib/constants + @/lib/signals) ─────────── */

// web/src/lib/constants.ts DAYS — short weekday labels indexed Sun..Sat (0..6).
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// web/src/lib/constants.ts COMMON_TIMEZONES — timezone options for the select.
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

// web/src/lib/signals.ts SIGNAL_FIELDS — the registry behind SIGNAL_FIELD_OPTIONS
// (Select options) and BOOL_FIELD_KEYS (the set of boolean-valued signals).
type SignalFieldType = 'numeric' | 'boolean' | 'string';
interface SignalField {
  key: string;
  label: string;
  type: SignalFieldType;
  unit?: string;
}
const SIGNAL_FIELDS: SignalField[] = [
  {key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%'},
  {key: 'inside_temp', label: 'Inside Temperature', type: 'numeric', unit: '°C'},
  {key: 'outside_temp', label: 'Outside Temperature', type: 'numeric', unit: '°C'},
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

/* ─── Inlined type (web ../components/stepInputTypes) ────────────────────── */

// Distributive omit of the persistence-only keys, identical to the web
// `StepInput<T>` helper, applied to the reused AutomationConditionStep union.
type StepInput<T> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>
  : never;
export type AutomationConditionStepInput = StepInput<AutomationConditionStep>;

/* ─── Option registries (verbatim from the web source) ───────────────────── */

type ConditionKindOption = {
  value: AutomationConditionKind;
  labelKey: string;
  fallback: string;
};

export const CONDITION_TYPES: ConditionKindOption[] = [
  {
    value: 'condition_signal',
    labelKey: 'automations.conditions.signal',
    fallback: 'Signal Check',
  },
  {
    value: 'condition_time_window',
    labelKey: 'automations.conditions.timeWindow',
    fallback: 'Time Window',
  },
  {
    value: 'condition_geofence',
    labelKey: 'automations.conditions.geofence',
    fallback: 'Geofence State',
  },
  {
    value: 'condition_other_automation',
    labelKey: 'automations.conditions.otherAutomation',
    fallback: 'Other Automation',
  },
];

const CONDITION_SIGNAL_OPERATORS: {
  value: AutomationConditionSignalOp;
  labelKey: string;
  fallback: string;
  numericOnly?: boolean;
}[] = [
  {value: '=', labelKey: 'automations.operators.equals', fallback: '='},
  {value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!='},
  {value: '<', labelKey: 'automations.operators.lessThan', fallback: '<', numericOnly: true},
  {value: '<=', labelKey: 'automations.operators.lessThanOrEqual', fallback: '<=', numericOnly: true},
  {value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>', numericOnly: true},
  {value: '>=', labelKey: 'automations.operators.greaterThanOrEqual', fallback: '>=', numericOnly: true},
  {value: 'between', labelKey: 'automations.operators.between', fallback: 'Between', numericOnly: true},
  {value: 'in', labelKey: 'automations.operators.in', fallback: 'In'},
];

const GEOFENCE_STATES: {value: AutomationGeofenceState; labelKey: string; fallback: string}[] = [
  {value: 'inside', labelKey: 'automations.geofence.inside', fallback: 'Inside'},
  {value: 'outside', labelKey: 'automations.geofence.outside', fallback: 'Outside'},
  {value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell'},
];

const OTHER_AUTOMATION_STATES: {
  value: AutomationOtherAutomationState;
  labelKey: string;
  fallback: string;
}[] = [
  {value: 'enabled', labelKey: 'automations.otherAutomation.enabled', fallback: 'Enabled'},
  {value: 'disabled', labelKey: 'automations.otherAutomation.disabled', fallback: 'Disabled'},
  {
    value: 'recently_triggered',
    labelKey: 'automations.otherAutomation.recentlyTriggered',
    fallback: 'Recently Triggered',
  },
];

interface ConditionBuilderProps {
  conditions: AutomationConditionStepInput[];
  onChange: (conditions: AutomationConditionStepInput[]) => void;
}

interface ConditionFieldsProps {
  condition: AutomationConditionStepInput;
  onChange: (condition: AutomationConditionStepInput) => void;
  geofenceOptions: {value: string; label: string}[];
}

/* ─── Pure logic helpers (verbatim from the web source) ──────────────────── */

export function createDefaultCondition(
  kind: AutomationConditionKind,
): AutomationConditionStepInput {
  switch (kind) {
    case 'condition_signal':
      return {kind, signal: 'battery_level', op: '<', value_num: 20};
    case 'condition_time_window':
      return {
        kind,
        start_time: '06:00',
        end_time: '09:00',
        timezone: 'UTC',
        days_of_week: [1, 2, 3, 4, 5],
      };
    case 'condition_geofence':
      return {kind, place_id: 0, state: 'inside'};
    case 'condition_other_automation':
      return {kind, other_automation_id: 0, state: 'enabled'};
  }
}

function conditionValueFromInput(
  condition: Extract<AutomationConditionStepInput, {kind: 'condition_signal'}>,
  value: string,
): AutomationConditionStepInput {
  if (BOOL_FIELD_KEYS.has(condition.signal)) {
    return {
      kind: 'condition_signal',
      signal: condition.signal,
      op: condition.op,
      value_bool: value === 'true',
    };
  }
  if (condition.signal === 'state' || condition.op === 'in') {
    return {
      kind: 'condition_signal',
      signal: condition.signal,
      op: condition.op,
      value_text: value,
    };
  }
  return {
    kind: 'condition_signal',
    signal: condition.signal,
    op: condition.op,
    value_num: Number.parseFloat(value) || 0,
  };
}

function numericValue(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/* ─── Native field primitives (web Input / Select / icon buttons) ────────── */

const CHEVRON_GLYPH = '\u25BE'; // ▾ — closed-select affordance (lucide ChevronDown).

interface FieldHelp {
  i18nKey?: string;
  content: string;
}

function FieldHeader({label, help}: {label?: string; help?: FieldHelp}) {
  if (!label && !help) {
    return null;
  }
  return (
    <View style={styles.fieldHeader}>
      {label ? (
        <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
          {label}
        </AppText>
      ) : null}
      {help ? (
        <HelpTooltip
          defaultValue={help.content}
          i18nKey={help.i18nKey}
          size="xs"
        />
      ) : null}
    </View>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label?: string;
  help?: FieldHelp;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  testID?: string;
}

/**
 * Labelled select. Mirrors the web `<Select label options value onChange help>`:
 * the trigger shows the selected option's label and opens a modal listbox of the
 * options. Selecting a row reports its value and closes the picker.
 */
function SelectField({
  label,
  help,
  options,
  value,
  onValueChange,
  placeholder,
  testID,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const displayLabel = selected?.label ?? placeholder ?? '';
  const accessibilityLabel = label ?? placeholder ?? displayLabel;

  return (
    <View style={styles.field}>
      <FieldHeader help={help} label={label} />
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectTriggerText}>
          {displayLabel}
        </AppText>
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={styles.selectChevron}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('common.close', 'Close')}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityRole="menu"
            style={styles.pickerCard}
            testID={testID ? `${testID}-options` : undefined}>
            {label ? (
              <AppText style={styles.pickerTitle} weight="semibold">
                {label}
              </AppText>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.pickerList}>
              {options.map(option => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    accessibilityLabel={option.label}
                    accessibilityRole="menuitem"
                    accessibilityState={{selected: isSelected}}
                    key={option.value}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.optionRow,
                      isSelected && styles.optionRowSelected,
                      pressed && styles.pressed,
                    ]}
                    testID={
                      testID ? `${testID}-option-${option.value}` : undefined
                    }>
                    <AppText
                      style={
                        isSelected
                          ? styles.optionTextSelected
                          : styles.optionText
                      }>
                      {option.label}
                    </AppText>
                    {isSelected ? (
                      <AppText
                        accessible={false}
                        allowFontScaling={false}
                        style={styles.optionCheck}>
                        {'\u2713'}
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface InputFieldProps {
  label?: string;
  help?: FieldHelp;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: KeyboardTypeOptions;
  placeholder?: string;
  testID?: string;
}

/** Labelled text input. Mirrors the web `<Input label type value onChange>`. */
function InputField({
  label,
  help,
  value,
  onChangeText,
  keyboardType,
  placeholder,
  testID,
}: InputFieldProps) {
  return (
    <View style={styles.field}>
      <FieldHeader help={help} label={label} />
      <TextInput
        accessibilityLabel={label ?? placeholder}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID={testID}
        value={value}
      />
    </View>
  );
}

/* ─── ConditionBuilder ───────────────────────────────────────────────────── */

export function ConditionBuilder({conditions, onChange}: ConditionBuilderProps) {
  const {data: geofences} = useGeofences();

  const geofenceOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectGeofence', 'Select geofence...')},
      ...(geofences ?? []).map(g => ({value: String(g.id), label: g.name})),
    ],
    [geofences],
  );

  const conditionTypeOptions = useMemo(
    () =>
      CONDITION_TYPES.map(condition => ({
        value: condition.value,
        label: t(condition.labelKey, condition.fallback),
      })),
    [],
  );

  const addCondition = useCallback(() => {
    onChange([...conditions, createDefaultCondition('condition_signal')]);
  }, [conditions, onChange]);

  const removeCondition = useCallback(
    (index: number) =>
      onChange(conditions.filter((_, currentIndex) => currentIndex !== index)),
    [conditions, onChange],
  );

  const replaceCondition = useCallback(
    (index: number, nextCondition: AutomationConditionStepInput) => {
      onChange(
        conditions.map((condition, currentIndex) =>
          currentIndex === index ? nextCondition : condition,
        ),
      );
    },
    [conditions, onChange],
  );

  return (
    <View style={styles.list} testID="condition-builder">
      {conditions.map((condition, index) => (
        <GlassPanel key={`${condition.kind}-${index}`} style={styles.panel}>
          <View style={styles.conditionRow}>
            <View style={styles.conditionFields}>
              <View style={styles.fieldsWrap}>
                <SelectField
                  label={
                    index === 0
                      ? t('automations.builder.conditionType', 'Condition Type')
                      : undefined
                  }
                  onValueChange={kind =>
                    replaceCondition(
                      index,
                      createDefaultCondition(kind as AutomationConditionKind),
                    )
                  }
                  options={conditionTypeOptions}
                  testID={`condition-${index}-kind`}
                  value={condition.kind}
                />
                <ConditionFields
                  condition={condition}
                  geofenceOptions={geofenceOptions}
                  onChange={nextCondition =>
                    replaceCondition(index, nextCondition)
                  }
                />
              </View>
            </View>
            <Pressable
              accessibilityLabel={t(
                'automations.builder.removeCondition',
                'Remove condition',
              )}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => removeCondition(index)}
              style={({pressed}) => [styles.removeButton, pressed && styles.pressed]}
              testID={`condition-${index}-remove`}>
              <SemanticIcon decorative name="delete" size="sm" />
            </Pressable>
          </View>
        </GlassPanel>
      ))}

      <Pressable
        accessibilityLabel={t('automations.builder.addCondition', 'Add Condition')}
        accessibilityRole="button"
        onPress={addCondition}
        style={({pressed}) => [styles.addButton, pressed && styles.pressed]}
        testID="condition-builder-add">
        <SemanticIcon decorative name="add" size="sm" />
        <AppText style={styles.addButtonText} weight="semibold">
          {t('automations.builder.addCondition', 'Add Condition')}
        </AppText>
      </Pressable>
    </View>
  );
}

/* ─── ConditionFields ────────────────────────────────────────────────────── */

function ConditionFields({
  condition,
  onChange,
  geofenceOptions,
}: ConditionFieldsProps) {
  const operatorOptions = useMemo(() => {
    const isBool =
      condition.kind === 'condition_signal' &&
      BOOL_FIELD_KEYS.has(condition.signal);
    return CONDITION_SIGNAL_OPERATORS.filter(
      operator => !isBool || !operator.numericOnly,
    ).map(operator => ({
      value: operator.value,
      label: t(operator.labelKey, operator.fallback),
    }));
  }, [condition]);

  const timezoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.map(option => ({
        value: option.value,
        label: t(`timezones.${option.value || 'utc'}`, option.label),
      })),
    [],
  );

  switch (condition.kind) {
    case 'condition_signal': {
      const isBool = BOOL_FIELD_KEYS.has(condition.signal);
      const isRange = condition.op === 'between';
      const value = isBool
        ? String(condition.value_bool ?? true)
        : condition.signal === 'state' || condition.op === 'in'
          ? condition.value_text ?? ''
          : String(condition.value_num ?? 20);

      return (
        <View style={styles.fieldsWrapFlex}>
          <SelectField
            help={{
              i18nKey: 'help.fields.automations.signal',
              content:
                'The vehicle telemetry signal this condition reads. Booleans use true/false, "state" uses keywords like online/asleep, all others compare numeric values.',
            }}
            label={t('automations.builder.signal', 'Signal')}
            onValueChange={signal => {
              const nextCondition: AutomationConditionStepInput =
                BOOL_FIELD_KEYS.has(signal)
                  ? {kind: 'condition_signal', signal, op: '=', value_bool: true}
                  : signal === 'state'
                    ? {kind: 'condition_signal', signal, op: '=', value_text: 'online'}
                    : {kind: 'condition_signal', signal, op: '<', value_num: 20};
              onChange(nextCondition);
            }}
            options={SIGNAL_FIELD_OPTIONS}
            testID="condition-signal-field"
            value={condition.signal}
          />
          <SelectField
            help={{
              i18nKey: 'help.fields.automations.operator',
              content:
                'How the live signal value is compared to your typed value. "between" expects a Min and Max; "in" expects a comma-separated list.',
            }}
            label={t('automations.builder.operator', 'Operator')}
            onValueChange={opValue => {
              const op = opValue as AutomationConditionSignalOp;
              if (op === 'between') {
                onChange({
                  kind: 'condition_signal',
                  signal: condition.signal,
                  op,
                  value_min: numericValue(
                    condition.value_min ?? condition.value_num,
                    0,
                  ),
                  value_max: numericValue(condition.value_max, 100),
                });
                return;
              }
              onChange(conditionValueFromInput({...condition, op}, value));
            }}
            options={operatorOptions}
            testID="condition-signal-operator"
            value={condition.op}
          />
          {isRange ? (
            <>
              <InputField
                keyboardType="numbers-and-punctuation"
                label={t('automations.builder.minValue', 'Min')}
                onChangeText={text =>
                  onChange({
                    ...condition,
                    value_min: Number.parseFloat(text) || 0,
                  })
                }
                testID="condition-signal-min"
                value={String(numericValue(condition.value_min, 0))}
              />
              <InputField
                keyboardType="numbers-and-punctuation"
                label={t('automations.builder.maxValue', 'Max')}
                onChangeText={text =>
                  onChange({
                    ...condition,
                    value_max: Number.parseFloat(text) || 0,
                  })
                }
                testID="condition-signal-max"
                value={String(numericValue(condition.value_max, 100))}
              />
            </>
          ) : isBool ? (
            <SelectField
              label={t('automations.builder.value', 'Value')}
              onValueChange={next =>
                onChange(conditionValueFromInput(condition, next))
              }
              options={[
                {value: 'true', label: t('common.true', 'True')},
                {value: 'false', label: t('common.false', 'False')},
              ]}
              testID="condition-signal-bool"
              value={value}
            />
          ) : (
            <InputField
              keyboardType={
                condition.signal === 'state' || condition.op === 'in'
                  ? 'default'
                  : 'numbers-and-punctuation'
              }
              label={t('automations.builder.value', 'Value')}
              onChangeText={next =>
                onChange(conditionValueFromInput(condition, next))
              }
              placeholder={
                condition.signal === 'state'
                  ? t('automations.builder.statePlaceholder', 'online')
                  : undefined
              }
              testID="condition-signal-value"
              value={value}
            />
          )}
        </View>
      );
    }

    case 'condition_time_window':
      return (
        <View style={styles.fieldsWrapFlex}>
          <InputField
            keyboardType="numbers-and-punctuation"
            label={t('automations.builder.startTime', 'Start')}
            onChangeText={text => onChange({...condition, start_time: text})}
            placeholder="06:00"
            testID="condition-time-start"
            value={condition.start_time}
          />
          <InputField
            keyboardType="numbers-and-punctuation"
            label={t('automations.builder.endTime', 'End')}
            onChangeText={text => onChange({...condition, end_time: text})}
            placeholder="09:00"
            testID="condition-time-end"
            value={condition.end_time}
          />
          <SelectField
            help={{
              i18nKey: 'help.fields.automations.timezone',
              content:
                'IANA time zone used to interpret the start/end window. Defaults to your browser zone if left blank.',
            }}
            label={t('automations.builder.timezone', 'Timezone')}
            onValueChange={next => onChange({...condition, timezone: next})}
            options={timezoneOptions}
            testID="condition-time-timezone"
            value={condition.timezone}
          />
          <View style={styles.daysField}>
            <AppText style={styles.daysLabel} variant="caption" weight="semibold">
              {t('automations.builder.days', 'Days')}
            </AppText>
            <View style={styles.daysRow}>
              {DAYS.map((label, day) => {
                const active = condition.days_of_week.includes(day);
                return (
                  <Pressable
                    accessibilityLabel={t(`common.days.short.${day}`, label)}
                    accessibilityRole="button"
                    accessibilityState={{selected: active}}
                    key={label}
                    onPress={() => {
                      const days = active
                        ? condition.days_of_week.filter(
                            currentDay => currentDay !== day,
                          )
                        : [...condition.days_of_week, day].sort();
                      onChange({...condition, days_of_week: days});
                    }}
                    style={({pressed}) => [
                      styles.dayButton,
                      active ? styles.dayButtonActive : styles.dayButtonInactive,
                      pressed && styles.pressed,
                    ]}
                    testID={`condition-day-${day}`}>
                    <AppText
                      style={active ? styles.dayTextActive : styles.dayTextInactive}>
                      {t(`common.days.short.${day}`, label)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      );

    case 'condition_geofence':
      return (
        <View style={styles.fieldsWrapFlex}>
          <SelectField
            help={{
              i18nKey: 'help.fields.automations.geofence',
              content:
                'The named place this condition checks. Define new places under Settings → Locations.',
            }}
            label={t('automations.builder.geofence', 'Geofence')}
            onValueChange={next =>
              onChange({
                ...condition,
                place_id: next ? Number(next) : 0,
              })
            }
            options={geofenceOptions}
            testID="condition-geofence-place"
            value={condition.place_id > 0 ? String(condition.place_id) : ''}
          />
          <SelectField
            label={t('automations.builder.state', 'State')}
            onValueChange={next =>
              onChange({
                ...condition,
                state: next as AutomationGeofenceState,
              })
            }
            options={GEOFENCE_STATES.map(state => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            testID="condition-geofence-state"
            value={condition.state}
          />
        </View>
      );

    case 'condition_other_automation':
      return (
        <View style={styles.fieldsWrapFlex}>
          <InputField
            help={{
              i18nKey: 'help.fields.automations.otherAutomation',
              content:
                'Numeric ID of another automation whose state this condition tracks. Useful for chaining or guarding rules.',
            }}
            keyboardType="numbers-and-punctuation"
            label={t('automations.builder.otherAutomationId', 'Automation ID')}
            onChangeText={text =>
              onChange({
                ...condition,
                other_automation_id: Number.parseInt(text, 10) || 0,
              })
            }
            testID="condition-other-id"
            value={condition.other_automation_id ? String(condition.other_automation_id) : ''}
          />
          <SelectField
            label={t('automations.builder.state', 'State')}
            onValueChange={next =>
              onChange({
                ...condition,
                state: next as AutomationOtherAutomationState,
              })
            }
            options={OTHER_AUTOMATION_STATES.map(state => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            testID="condition-other-state"
            value={condition.state}
          />
        </View>
      );
  }
}

const dialogShadow = shadows.panel as object;

const styles = StyleSheet.create({
  // space-y-3 — 12px vertical rhythm between condition panels.
  list: {
    gap: spacing.md,
  },
  // GlassPanel p-4 — 16px padding inside each condition panel.
  panel: {
    padding: 16,
  },
  // flex items-start gap-3
  conditionRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  // flex-1 space-y-3
  conditionFields: {
    flex: 1,
    gap: spacing.md,
  },
  // flex flex-wrap items-end gap-3
  fieldsWrap: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  // flex flex-1 flex-wrap items-end gap-3
  fieldsWrapFlex: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  // A single labelled control; the web fixed `w-NN` widths become a responsive
  // flex basis so rows wrap gracefully on phones.
  field: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 120,
    rowGap: spacing.xs,
  },
  fieldHeader: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  fieldLabel: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  // Select trigger surface (web <select>): rounded, hairline border, glass fill.
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 15,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  // web Input: labelled TextInput with the same glass surface as the trigger.
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.82,
  },
  // mt-6 text-red-400 ghost icon button.
  removeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    padding: spacing.xs,
  },
  // Ghost "Add Condition" button (Plus + label).
  addButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  addButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  // Day-of-week toggle group.
  daysField: {
    rowGap: spacing.xs,
  },
  daysLabel: {
    color: colors.textSecondary,
  },
  daysRow: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
    marginTop: spacing.xs,
  },
  // web !h-9 !w-9 !rounded day pill.
  dayButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  dayButtonActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  dayButtonInactive: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  dayTextActive: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '500',
  },
  dayTextInactive: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  // Modal picker (web inline <select> dropdown).
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerCard: {
    ...dialogShadow,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: '70%',
    maxWidth: 420,
    padding: spacing.md,
    rowGap: spacing.sm,
    width: '92%',
  },
  pickerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: spacing.xs,
  },
  pickerList: {
    flexGrow: 0,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionRowSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  optionTextSelected: {
    color: colors.accent,
    fontSize: 15,
  },
  optionCheck: {
    color: colors.accent,
    fontSize: 15,
    marginLeft: spacing.sm,
  },
});

export default ConditionBuilder;
