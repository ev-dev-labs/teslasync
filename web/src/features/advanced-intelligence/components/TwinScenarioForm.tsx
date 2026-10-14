import { useState, type ChangeEvent, type FormEvent } from 'react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { SI } from '@/lib/unitConversion';
import type { TwinScenarioInput } from '@/types/advancedIntelligence';

type NumericField = Exclude<keyof TwinScenarioInput, 'name'>;

interface TwinScenarioFormProps {
  scenarios: TwinScenarioInput[];
  pending: boolean;
  disabled: boolean;
  onUpdate: (index: number, patch: Partial<TwinScenarioInput>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function TwinScenarioForm({
  scenarios,
  pending,
  disabled,
  onUpdate,
  onRemove,
  onAdd,
  onSubmit,
}: TwinScenarioFormProps) {
  const { t } = useTranslation();
  const units = useUnits();
  const [drafts, setDrafts] = useState<Partial<Record<NumericField, string>>[]>(
    () => scenarios.map(() => ({})),
  );
  const draftValue = (index: number, field: NumericField) => {
    const raw = drafts[index]?.[field];
    if (raw === undefined) return scenarios[index][field];
    return raw === '' ? null : Number(raw);
  };

  const numericProps = (index: number, field: NumericField, siUnit: string) => ({
    type: 'number',
    step: 'any',
    className: 'min-h-11 md:min-h-10',
    value: drafts[index]?.[field] ?? String(scenarios[index][field] ?? ''),
    suffix: <Text as="span" variant="caption" color="muted">{siUnit}</Text>,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const raw = input.value;
      setDrafts((current) => {
        const next = [...current];
        next[index] = { ...next[index], [field]: raw };
        return next;
      });
      if (!input.validity.valid) return;
      if (field === 'outside_temp_c' && raw === '') {
        onUpdate(index, { outside_temp_c: null });
      } else if (raw !== '' && Number.isFinite(input.valueAsNumber)) {
        onUpdate(index, { [field]: input.valueAsNumber });
      }
    },
  });

  return (
    <form className="space-y-5" onSubmit={(event) => {
      if (!event.currentTarget.reportValidity()) {
        event.preventDefault();
        return;
      }
      onSubmit(event);
    }}>
      {scenarios.map((scenario, index) => (
        <div key={index} className="rounded-panel border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Text as="h3" variant="label">
              {t('advancedIntelligence.twin.form.scenario', 'Scenario {{number}}', {
                number: index + 1,
              })}
            </Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('advancedIntelligence.twin.form.remove', 'Remove scenario')}
              disabled={scenarios.length <= 1}
              onClick={() => {
                setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
                onRemove(index);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Input
              id={`twin-name-${index}`}
              label={t('advancedIntelligence.twin.form.name', 'Scenario name')}
              value={scenario.name}
              required
              maxLength={80}
              onChange={(event) => onUpdate(index, { name: event.target.value })}
            />
            <Input
              {...numericProps(index, 'distance_m', SI.distance)}
              id={`twin-distance-${index}`}
              label={t('advancedIntelligence.twin.form.distance', 'Route distance (canonical SI)')}
              hint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatDistance(draftValue(index, 'distance_m')),
              })}
              min={1}
              max={2000000}
              required
            />
            <Input
              {...numericProps(index, 'speed_mps', SI.speed)}
              id={`twin-speed-${index}`}
              label={t('advancedIntelligence.twin.form.speed', 'Average speed (canonical SI)')}
              hint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatSpeed(draftValue(index, 'speed_mps')),
              })}
              min={0.1}
              max={70}
              required
            />
            <Input
              {...numericProps(index, 'horizon_s', SI.duration)}
              id={`twin-horizon-${index}`}
              label={t('advancedIntelligence.twin.form.horizon', 'Scenario horizon (canonical SI)')}
              hint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatDuration(draftValue(index, 'horizon_s')),
              })}
              min={60}
              required
            />
            <Input
              {...numericProps(index, 'outside_temp_c', SI.temperature)}
              id={`twin-temperature-${index}`}
              label={t('advancedIntelligence.twin.form.temperature', 'Outside temperature (canonical SI)')}
              hint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatTemperature(draftValue(index, 'outside_temp_c')),
              })}
              min={-80}
              max={80}
            />
            <Input
              {...numericProps(index, 'auxiliary_load_w', SI.power)}
              id={`twin-auxiliary-${index}`}
              label={t('advancedIntelligence.twin.form.auxiliary', 'Auxiliary load (canonical SI)')}
              hint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatPower(draftValue(index, 'auxiliary_load_w')),
              })}
              min={0}
              max={50000}
              required
            />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          disabled={scenarios.length >= 12}
          onClick={() => {
            setDrafts((current) => [...current, {}]);
            onAdd();
          }}
        >
          {t('advancedIntelligence.twin.form.add', 'Add scenario')}
        </Button>
        <Button
          type="submit"
          loading={pending}
          disabled={disabled || pending}
          icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
        >
          {t('advancedIntelligence.twin.form.run', 'Run confirmed simulation')}
        </Button>
      </div>
    </form>
  );
}
