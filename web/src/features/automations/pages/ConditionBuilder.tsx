import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  GlassPanel,
  Text,
} from '@/components/ui';
import { useGeofences } from '@/api/hooks/useLocations';
import { DAYS, COMMON_TIMEZONES } from '@/lib/constants';
import { Plus, Trash2 } from 'lucide-react';
import { buildSignalFieldOptions, BOOL_FIELD_KEYS } from '@/lib/signals';
import type {
  AutomationConditionKind,
  AutomationConditionSignalOp,
  AutomationGeofenceState,
  AutomationOtherAutomationState,
} from '@/types/automations';
import type { AutomationConditionStepInput } from '../components/stepInputTypes';

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
  { value: '=', labelKey: 'automations.operators.equals', fallback: '=' },
  { value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!=' },
  { value: '<', labelKey: 'automations.operators.lessThan', fallback: '<', numericOnly: true },
  { value: '<=', labelKey: 'automations.operators.lessThanOrEqual', fallback: '<=', numericOnly: true },
  { value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>', numericOnly: true },
  { value: '>=', labelKey: 'automations.operators.greaterThanOrEqual', fallback: '>=', numericOnly: true },
  { value: 'between', labelKey: 'automations.operators.between', fallback: 'Between', numericOnly: true },
  { value: 'in', labelKey: 'automations.operators.in', fallback: 'In' },
];

const GEOFENCE_STATES: { value: AutomationGeofenceState; labelKey: string; fallback: string }[] = [
  { value: 'inside', labelKey: 'automations.geofence.inside', fallback: 'Inside' },
  { value: 'outside', labelKey: 'automations.geofence.outside', fallback: 'Outside' },
  { value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell' },
];

const OTHER_AUTOMATION_STATES: {
  value: AutomationOtherAutomationState;
  labelKey: string;
  fallback: string;
}[] = [
  { value: 'enabled', labelKey: 'automations.otherAutomation.enabled', fallback: 'Enabled' },
  { value: 'disabled', labelKey: 'automations.otherAutomation.disabled', fallback: 'Disabled' },
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
  geofenceOptions: { value: string; label: string }[];
}

export function createDefaultCondition(kind: AutomationConditionKind): AutomationConditionStepInput {
  switch (kind) {
    case 'condition_signal':
      return { kind, signal: 'battery_level', op: '<', value_num: 20 };
    case 'condition_time_window':
      return {
        kind,
        start_time: '06:00',
        end_time: '09:00',
        timezone: 'UTC',
        days_of_week: [1, 2, 3, 4, 5],
      };
    case 'condition_geofence':
      return { kind, place_id: 0, state: 'inside' };
    case 'condition_other_automation':
      return { kind, other_automation_id: 0, state: 'enabled' };
    default:
      // Defensive fallback: the declared return type is non-optional, so an
      // unrecognized kind (e.g. a future step type reaching this code before
      // its case is added) must still yield a valid condition rather than
      // `undefined`, which would corrupt the conditions array.
      return { kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20 };
  }
}

function conditionValueFromInput(
  condition: Extract<AutomationConditionStepInput, { kind: 'condition_signal' }>,
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

export function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  const { t } = useTranslation();
  const { data: geofences } = useGeofences();

  const geofenceOptions = useMemo(
    () => [
      { value: '', label: t('automations.builder.selectGeofence', 'Select geofence...') },
      ...(geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    ],
    [geofences, t],
  );

  const conditionTypeOptions = useMemo(
    () => CONDITION_TYPES.map((condition) => ({
      value: condition.value,
      label: t(condition.labelKey, condition.fallback),
    })),
    [t],
  );

  const addCondition = useCallback(() => {
    onChange([...conditions, createDefaultCondition('condition_signal')]);
  }, [conditions, onChange]);

  const removeCondition = useCallback(
    (index: number) => onChange(conditions.filter((_, currentIndex) => currentIndex !== index)),
    [conditions, onChange],
  );

  const replaceCondition = useCallback(
    (index: number, nextCondition: AutomationConditionStepInput) => {
      onChange(conditions.map((condition, currentIndex) => (
        currentIndex === index ? nextCondition : condition
      )));
    },
    [conditions, onChange],
  );

  return (
    <div className="space-y-3">
      {conditions.map((condition, index) => (
        <GlassPanel key={`${condition.kind}-${index}`} className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <UiSelect
                  label={index === 0
                    ? t('automations.builder.conditionType', 'Condition Type')
                    : undefined}
                  options={conditionTypeOptions}
                  value={condition.kind}
                  onChange={(event) => replaceCondition(
                    index,
                    createDefaultCondition(event.target.value as AutomationConditionKind),
                  )}
                  className="w-56"
                />
                <ConditionFields
                  condition={condition}
                  onChange={(nextCondition) => replaceCondition(index, nextCondition)}
                  geofenceOptions={geofenceOptions}
                />
              </div>
            </div>
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCondition(index)}
              aria-label={t('automations.builder.removeCondition', 'Remove condition')}
              className="mt-6 text-red-400 hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
            </UiButton>
          </div>
        </GlassPanel>
      ))}

      <UiButton type="button" variant="ghost" size="sm" onClick={addCondition}>
        <Plus className="mr-1 h-4 w-4" />
        {t('automations.builder.addCondition', 'Add Condition')}
      </UiButton>
    </div>
  );
}

function ConditionFields({ condition, onChange, geofenceOptions }: ConditionFieldsProps) {
  const { t } = useTranslation();

  const signalOptions = useMemo(() => buildSignalFieldOptions(t), [t]);

  const operatorOptions = useMemo(() => {
    const isBool = condition.kind === 'condition_signal' && BOOL_FIELD_KEYS.has(condition.signal);
    return CONDITION_SIGNAL_OPERATORS
      .filter((operator) => !isBool || !operator.numericOnly)
      .map((operator) => ({
        value: operator.value,
        label: t(operator.labelKey, operator.fallback),
      }));
  }, [condition, t]);

  const timezoneOptions = useMemo(
    () => COMMON_TIMEZONES.map((option) => ({
      value: option.value,
      label: t(`timezones.${option.value || 'utc'}`, option.label),
    })),
    [t],
  );

  switch (condition.kind) {
    case 'condition_signal': {
      const isBool = BOOL_FIELD_KEYS.has(condition.signal);
      const isRange = condition.op === 'between';
      const value = isBool
        ? String(condition.value_bool ?? true)
        : condition.signal === 'state' || condition.op === 'in'
          ? (condition.value_text ?? '')
          : String(condition.value_num ?? 20);

      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiSelect
            label={t('automations.builder.signal', 'Signal')}
            help={{
              i18nKey: 'help.fields.automations.signal',
              content: 'The vehicle telemetry signal this condition reads. Booleans use true/false, "state" uses keywords like online/asleep, all others compare numeric values.',
            }}
            options={signalOptions}
            value={condition.signal}
            onChange={(event) => {
              const signal = event.target.value;
              const nextCondition: AutomationConditionStepInput = BOOL_FIELD_KEYS.has(signal)
                ? { kind: 'condition_signal', signal, op: '=', value_bool: true }
                : signal === 'state'
                  ? { kind: 'condition_signal', signal, op: '=', value_text: 'online' }
                  : { kind: 'condition_signal', signal, op: '<', value_num: 20 };
              onChange(nextCondition);
            }}
            className="w-44"
          />
          <UiSelect
            label={t('automations.builder.operator', 'Operator')}
            help={{
              i18nKey: 'help.fields.automations.operator',
              content: 'How the live signal value is compared to your typed value. "between" expects a Min and Max; "in" expects a comma-separated list.',
            }}
            options={operatorOptions}
            value={condition.op}
            onChange={(event) => {
              const op = event.target.value as AutomationConditionSignalOp;
              if (op === 'between') {
                onChange({
                  kind: 'condition_signal',
                  signal: condition.signal,
                  op,
                  value_min: numericValue(condition.value_min ?? condition.value_num, 0),
                  value_max: numericValue(condition.value_max, 100),
                });
                return;
              }
              onChange(conditionValueFromInput({ ...condition, op }, value));
            }}
            className="w-36"
          />
          {isRange ? (
            <>
              <UiInput
                label={t('automations.builder.minValue', 'Min')}
                type="number"
                value={numericValue(condition.value_min, 0)}
                onChange={(event) => onChange({
                  ...condition,
                  value_min: Number.parseFloat(event.target.value) || 0,
                })}
                className="w-28"
              />
              <UiInput
                label={t('automations.builder.maxValue', 'Max')}
                type="number"
                value={numericValue(condition.value_max, 100)}
                onChange={(event) => onChange({
                  ...condition,
                  value_max: Number.parseFloat(event.target.value) || 0,
                })}
                className="w-28"
              />
            </>
          ) : isBool ? (
            <UiSelect
              label={t('automations.builder.value', 'Value')}
              options={[
                { value: 'true', label: t('common.true', 'True') },
                { value: 'false', label: t('common.false', 'False') },
              ]}
              value={value}
              onChange={(event) => onChange(conditionValueFromInput(condition, event.target.value))}
              className="w-28"
            />
          ) : (
            <UiInput
              label={t('automations.builder.value', 'Value')}
              type={condition.signal === 'state' || condition.op === 'in' ? 'text' : 'number'}
              value={value}
              onChange={(event) => onChange(conditionValueFromInput(condition, event.target.value))}
              placeholder={condition.signal === 'state'
                ? t('automations.builder.statePlaceholder', 'online')
                : undefined}
              className="w-40"
            />
          )}
        </div>
      );
    }

    case 'condition_time_window': {
      const selectedDays = condition.days_of_week ?? [];
      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiInput
            label={t('automations.builder.startTime', 'Start')}
            type="time"
            value={condition.start_time}
            onChange={(event) => onChange({ ...condition, start_time: event.target.value })}
            className="w-32"
          />
          <UiInput
            label={t('automations.builder.endTime', 'End')}
            type="time"
            value={condition.end_time}
            onChange={(event) => onChange({ ...condition, end_time: event.target.value })}
            className="w-32"
          />
          <UiSelect
            label={t('automations.builder.timezone', 'Timezone')}
            help={{
              i18nKey: 'help.fields.automations.timezone',
              content: 'IANA time zone used to interpret the start/end window. Defaults to your browser zone if left blank.',
            }}
            options={timezoneOptions}
            value={condition.timezone}
            onChange={(event) => onChange({ ...condition, timezone: event.target.value })}
            className="w-44"
          />
          <div>
            <Text as="span" variant="subhead">
              {t('automations.builder.days', 'Days')}
            </Text>
            <div className="mt-1 flex gap-1">
              {DAYS.map((label, day) => {
                const active = selectedDays.includes(day);
                return (
                  <UiButton
                    key={label}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={active}
                    className={`!h-9 !w-9 !rounded !p-0 text-xs font-medium ${
                      active
                        ? '!bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                        : '!bg-white/[0.03] text-[var(--text-muted)] hover:!bg-white/[0.06]'
                    }`}
                    onClick={() => {
                      const days = active
                        ? selectedDays.filter((currentDay) => currentDay !== day)
                        : [...selectedDays, day].sort((a, b) => a - b);
                      onChange({ ...condition, days_of_week: days });
                    }}
                  >
                    {t(`common.days.short.${day}`, label)}
                  </UiButton>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    case 'condition_geofence':
      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiSelect
            label={t('automations.builder.geofence', 'Geofence')}
            help={{
              i18nKey: 'help.fields.automations.geofence',
              content: 'The named place this condition checks. Define new places under Settings → Locations.',
            }}
            options={geofenceOptions}
            value={condition.place_id > 0 ? String(condition.place_id) : ''}
            onChange={(event) => onChange({
              ...condition,
              place_id: event.target.value ? Number(event.target.value) : 0,
            })}
            className="w-52"
          />
          <UiSelect
            label={t('automations.builder.state', 'State')}
            options={GEOFENCE_STATES.map((state) => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            value={condition.state}
            onChange={(event) => onChange({
              ...condition,
              state: event.target.value as AutomationGeofenceState,
            })}
            className="w-32"
          />
        </div>
      );

    case 'condition_other_automation':
      return (
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <UiInput
            label={t('automations.builder.otherAutomationId', 'Automation ID')}
            help={{
              i18nKey: 'help.fields.automations.otherAutomation',
              content: 'Numeric ID of another automation whose state this condition tracks. Useful for chaining or guarding rules.',
            }}
            type="number"
            min={1}
            value={condition.other_automation_id || ''}
            onChange={(event) => onChange({
              ...condition,
              other_automation_id: Number.parseInt(event.target.value, 10) || 0,
            })}
            className="w-40"
          />
          <UiSelect
            label={t('automations.builder.state', 'State')}
            options={OTHER_AUTOMATION_STATES.map((state) => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            value={condition.state}
            onChange={(event) => onChange({
              ...condition,
              state: event.target.value as AutomationOtherAutomationState,
            })}
            className="w-48"
          />
        </div>
      );
  }
}
