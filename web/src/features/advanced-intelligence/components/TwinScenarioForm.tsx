import { type FormEvent } from 'react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { SI } from '@/lib/unitConversion';
import type { TwinScenarioInput } from '@/types/advancedIntelligence';
import { SiNumberInput } from './SiNumberInput';

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

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {scenarios.map((scenario, index) => (
        <div key={index} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
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
              onClick={() => onRemove(index)}
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
            <SiNumberInput
              id={`twin-distance-${index}`}
              label={t('advancedIntelligence.twin.form.distance', 'Route distance (canonical SI)')}
              value={scenario.distance_m}
              onChange={(value) => onUpdate(index, { distance_m: value ?? 0 })}
              siUnit={SI.distance}
              displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatDistance(scenario.distance_m),
              })}
              min={1}
              max={2000000}
              required
            />
            <SiNumberInput
              id={`twin-speed-${index}`}
              label={t('advancedIntelligence.twin.form.speed', 'Average speed (canonical SI)')}
              value={scenario.speed_mps}
              onChange={(value) => onUpdate(index, { speed_mps: value ?? 0 })}
              siUnit={SI.speed}
              displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatSpeed(scenario.speed_mps),
              })}
              min={0.1}
              max={70}
              step={0.1}
              required
            />
            <SiNumberInput
              id={`twin-horizon-${index}`}
              label={t('advancedIntelligence.twin.form.horizon', 'Scenario horizon (canonical SI)')}
              value={scenario.horizon_s}
              onChange={(value) => onUpdate(index, { horizon_s: value ?? 0 })}
              siUnit={SI.duration}
              displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatDuration(scenario.horizon_s),
              })}
              min={60}
              required
            />
            <SiNumberInput
              id={`twin-temperature-${index}`}
              label={t('advancedIntelligence.twin.form.temperature', 'Outside temperature (canonical SI)')}
              value={scenario.outside_temp_c}
              onChange={(value) => onUpdate(index, { outside_temp_c: value })}
              siUnit={SI.temperature}
              displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatTemperature(scenario.outside_temp_c),
              })}
              min={-80}
              max={80}
              step={0.1}
            />
            <SiNumberInput
              id={`twin-auxiliary-${index}`}
              label={t('advancedIntelligence.twin.form.auxiliary', 'Auxiliary load (canonical SI)')}
              value={scenario.auxiliary_load_w}
              onChange={(value) => onUpdate(index, { auxiliary_load_w: value ?? 0 })}
              siUnit={SI.power}
              displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                value: units.formatPower(scenario.auxiliary_load_w),
              })}
              min={0}
              max={50000}
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
          onClick={onAdd}
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
