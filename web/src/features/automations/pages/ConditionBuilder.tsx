/**
 * ConditionBuilder — manages an array of conditions, each with a type-specific sub-form.
 *
 * Condition types: state_check, time_window, cooldown, day_filter, location, seasonal, variable_check
 */
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useGeofences } from '@/api/hooks/useLocations';
import {
  CONDITION_TYPES, NUMERIC_OPERATORS, BOOL_OPERATORS,
  MONTHS, DAYS, COMMON_TIMEZONES,
} from '@/lib/constants';
import { Plus, Trash2 } from 'lucide-react';

// Re-export so existing consumers of CONDITION_TYPES from this file keep working
export { CONDITION_TYPES } from '@/lib/constants';

const STATE_CHECK_FIELDS = [
  { value: 'battery_level', label: 'Battery Level' },
  { value: 'inside_temp', label: 'Inside Temperature' },
  { value: 'outside_temp', label: 'Outside Temperature' },
  { value: 'speed', label: 'Speed' },
  { value: 'is_locked', label: 'Is Locked' },
  { value: 'is_charging', label: 'Is Charging' },
  { value: 'is_climate_on', label: 'Climate On' },
  { value: 'sentry_mode', label: 'Sentry Mode' },
  { value: 'state', label: 'Vehicle State' },
];

const BOOL_FIELDS = new Set(['is_locked', 'is_charging', 'is_climate_on', 'sentry_mode']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConditionBuilderProps {
  conditions: Record<string, unknown>[];
  onChange: (conditions: Record<string, unknown>[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  const { t } = useTranslation();
  const { data: geofences } = useGeofences();

  const geofenceOptions = useMemo(
    () => (geofences ?? []).map((g) => ({ value: String(g.id), label: g.name })),
    [geofences],
  );

  const addCondition = useCallback(() => {
    onChange([...conditions, { type: 'state_check', field: 'battery_level', operator: 'lt', value: 20 }]);
  }, [conditions, onChange]);

  const removeCondition = useCallback(
    (index: number) => onChange(conditions.filter((_, i) => i !== index)),
    [conditions, onChange],
  );

  const updateCondition = useCallback(
    (index: number, patch: Record<string, unknown>) => {
      const next = conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
      onChange(next);
    },
    [conditions, onChange],
  );

  const replaceConditionType = useCallback(
    (index: number, newType: string) => {
      const defaults: Record<string, Record<string, unknown>> = {
        state_check: { type: 'state_check', field: 'battery_level', operator: 'lt', value: 20 },
        time_window: { type: 'time_window', start_time: '06:00', end_time: '09:00', timezone: '' },
        cooldown: { type: 'cooldown', minutes: 30 },
        day_filter: { type: 'day_filter', days: [1, 2, 3, 4, 5], timezone: '' },
        location: { type: 'location', geofence_id: 0, operator: 'inside' },
        seasonal: { type: 'seasonal', start_month: 1, end_month: 12 },
        variable_check: { type: 'variable_check', key: '', operator: 'eq', value: '' },
      };
      const next = conditions.map((c, i) => (i === index ? (defaults[newType] ?? { type: newType }) : c));
      onChange(next);
    },
    [conditions, onChange],
  );

  return (
    <div className="space-y-3">
      {conditions.map((cond, index) => {
        const condType = str(cond.type);
        return (
          <GlassPanel key={index} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-3">
                <div className="flex gap-3 items-end">
                  <Select
                    label={index === 0 ? t('automations.builder.conditionType', 'Condition Type') : undefined}
                    options={CONDITION_TYPES.map((ct) => ({ value: ct.value, label: ct.label }))}
                    value={condType}
                    onChange={(e) => replaceConditionType(index, e.target.value)}
                    className="w-48"
                  />
                  <ConditionFields
                    type={condType}
                    config={cond}
                    onChange={(patch) => updateCondition(index, patch)}
                    geofenceOptions={geofenceOptions}
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeCondition(index)}
                aria-label={t('automations.builder.removeCondition', 'Remove condition')}
                className="mt-6 text-red-400 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </GlassPanel>
        );
      })}

      <Button variant="ghost" size="sm" onClick={addCondition}>
        <Plus className="h-4 w-4 mr-1" />
        {t('automations.builder.addCondition', 'Add Condition')}
      </Button>
    </div>
  );
}

// ─── Condition-type fields ────────────────────────────────────────────────────

interface ConditionFieldsProps {
  type: string;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  geofenceOptions: { value: string; label: string }[];
}

function ConditionFields({ type, config, onChange, geofenceOptions }: ConditionFieldsProps) {
  const { t } = useTranslation();

  switch (type) {
    case 'state_check': {
      const field = str(config.field);
      const isBool = BOOL_FIELDS.has(field);
      const isString = field === 'state';
      const operators = isBool ? BOOL_OPERATORS : NUMERIC_OPERATORS;

      return (
        <div className="flex gap-3 items-end flex-wrap flex-1">
          <Select
            options={STATE_CHECK_FIELDS}
            value={field}
            onChange={(e) => {
              const newField = e.target.value;
              const newIsBool = BOOL_FIELDS.has(newField);
              onChange({
                field: newField,
                operator: newIsBool ? 'eq' : str(config.operator) || 'lt',
                value: newIsBool ? true : (newField === 'state' ? 'online' : 20),
              });
            }}
            className="w-40"
          />
          <Select
            options={operators}
            value={str(config.operator)}
            onChange={(e) => onChange({ operator: e.target.value })}
            className="w-20"
          />
          {isBool ? (
            <Select
              options={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' },
              ]}
              value={String(config.value)}
              onChange={(e) => onChange({ value: e.target.value === 'true' })}
              className="w-24"
            />
          ) : isString ? (
            <Input
              value={str(config.value)}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="online, asleep, offline"
              className="w-36"
            />
          ) : (
            <Input
              type="number"
              value={num(config.value)}
              onChange={(e) => onChange({ value: parseFloat(e.target.value) || 0 })}
              className="w-24"
            />
          )}
        </div>
      );
    }

    case 'time_window':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Input
            label={t('automations.builder.startTime', 'Start')}
            type="time"
            value={str(config.start_time)}
            onChange={(e) => onChange({ start_time: e.target.value })}
            className="w-32"
          />
          <Input
            label={t('automations.builder.endTime', 'End')}
            type="time"
            value={str(config.end_time)}
            onChange={(e) => onChange({ end_time: e.target.value })}
            className="w-32"
          />
          <Select
            options={COMMON_TIMEZONES}
            value={str(config.timezone)}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className="w-40"
          />
        </div>
      );

    case 'cooldown':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Input
            label={t('automations.builder.cooldownMinutes', 'Minutes')}
            type="number"
            min={1}
            max={1440}
            value={num(config.minutes, 30)}
            onChange={(e) => onChange({ minutes: parseInt(e.target.value, 10) || 1 })}
            className="w-28"
          />
        </div>
      );

    case 'day_filter': {
      const days = numArr(config.days);
      return (
        <div className="flex gap-3 items-end flex-wrap flex-1">
          <div className="flex gap-1">
            {DAYS.map((label, i) => {
              const active = days.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  className={`w-9 h-9 rounded text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)] ring-1 ring-[var(--accent)]/50'
                      : 'bg-white/[0.03] text-white/40 hover:bg-white/[0.06]'
                  }`}
                  onClick={() => {
                    const next = active ? days.filter((d) => d !== i) : [...days, i].sort();
                    onChange({ days: next });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Select
            options={COMMON_TIMEZONES}
            value={str(config.timezone)}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className="w-40"
          />
        </div>
      );
    }

    case 'location':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Select
            options={[{ value: '', label: 'Select geofence...' }, ...geofenceOptions]}
            value={String(config.geofence_id ?? '')}
            onChange={(e) => onChange({ geofence_id: e.target.value ? Number(e.target.value) : 0 })}
            className="w-48"
          />
          <Select
            options={[
              { value: 'inside', label: 'Inside' },
              { value: 'outside', label: 'Outside' },
            ]}
            value={str(config.operator) || 'inside'}
            onChange={(e) => onChange({ operator: e.target.value })}
            className="w-28"
          />
        </div>
      );

    case 'seasonal':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Select
            label={t('automations.builder.startMonth', 'From')}
            options={MONTHS}
            value={String(num(config.start_month, 1))}
            onChange={(e) => onChange({ start_month: parseInt(e.target.value, 10) })}
            className="w-36"
          />
          <Select
            label={t('automations.builder.endMonth', 'To')}
            options={MONTHS}
            value={String(num(config.end_month, 12))}
            onChange={(e) => onChange({ end_month: parseInt(e.target.value, 10) })}
            className="w-36"
          />
        </div>
      );

    case 'variable_check':
      return (
        <div className="flex gap-3 items-end flex-1">
          <Input
            label={t('automations.builder.variableKey', 'Variable Key')}
            value={str(config.key)}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="my_var"
            className="w-36"
          />
          <Select
            options={NUMERIC_OPERATORS}
            value={str(config.operator) || 'eq'}
            onChange={(e) => onChange({ operator: e.target.value })}
            className="w-20"
          />
          <Input
            label={t('automations.builder.variableValue', 'Value')}
            value={str(config.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            className="w-28"
          />
        </div>
      );

    default:
      return null;
  }
}
