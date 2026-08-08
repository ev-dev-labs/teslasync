import { useTranslation } from 'react-i18next';
import { RotateCcw, RefreshCw, Bookmark } from 'lucide-react';
import { GlassPanel, PanelTitle, Slider, Toggle, Select, Button, Caption } from '@/components/ui';
import { Grid } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { updateScenario, resetScenario, type OrchestrationScenario } from '../hooks/useOrchestrationScenario';
import type { ObjectiveWeights } from '../lib/types';

interface ScenarioControlsProps {
  scenario: OrchestrationScenario;
  onRefreshNow: () => void;
  onCommitBaseline: () => void;
}

/** Named starting points for the objective weights. Selecting one patches `scenario.weights` in one step. */
const WEIGHT_PRESETS: Record<string, Partial<ObjectiveWeights>> = {
  balanced: { readiness: 3, cost: 2, selfConsumption: 2, peakShaving: 1.5, reserve: 1.5, stability: 1 },
  costFirst: { readiness: 2, cost: 4, selfConsumption: 1.5, peakShaving: 1, reserve: 1, stability: 0.5 },
  greenFirst: { readiness: 2, cost: 1, selfConsumption: 4, peakShaving: 1.5, reserve: 1.5, stability: 0.5 },
  peakShavingFirst: { readiness: 2, cost: 1.5, selfConsumption: 1.5, peakShaving: 4, reserve: 1.5, stability: 0.5 },
};

/** Scenario/assumption controls: horizon, tariff shape, grid limits, Powerwall spec, and objective weight preset. */
export function ScenarioControls({ scenario, onRefreshNow, onCommitBaseline }: ScenarioControlsProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const { formatCurrency } = useFormatting();

  const presetOptions = [
    { value: 'balanced', label: t('homeEnergy.scenario.presetBalanced', 'Balanced') },
    { value: 'costFirst', label: t('homeEnergy.scenario.presetCost', 'Cost-first') },
    { value: 'greenFirst', label: t('homeEnergy.scenario.presetGreen', 'Self-consumption-first') },
    { value: 'peakShavingFirst', label: t('homeEnergy.scenario.presetPeak', 'Peak-shaving-first') },
    { value: 'custom', label: t('homeEnergy.scenario.presetCustom', 'Custom (saved)') },
  ];

  const activePreset =
    Object.entries(WEIGHT_PRESETS).find(([, preset]) => JSON.stringify(preset) === JSON.stringify(scenario.weights))?.[0] ??
    'custom';

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle>{t('homeEnergy.scenario.title', 'Scenario & Assumptions')}</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefreshNow}>
            {t('homeEnergy.scenario.refreshNow', 'Recompute from now')}
          </Button>
          <Button size="sm" variant="secondary" icon={<Bookmark className="h-3.5 w-3.5" />} onClick={onCommitBaseline}>
            {t('homeEnergy.scenario.commitBaseline', 'Save as stability baseline')}
          </Button>
          <Button size="sm" variant="outline" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => resetScenario()}>
            {t('homeEnergy.scenario.reset', 'Reset to defaults')}
          </Button>
        </div>
      </div>

      <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={5}>
        <div className="space-y-4">
          <Caption>{t('homeEnergy.scenario.horizonGroup', 'Planning Horizon')}</Caption>
          <Slider
            label={t('homeEnergy.scenario.horizonHours', 'Horizon')}
            min={6}
            max={72}
            step={6}
            value={scenario.horizonHours}
            formatValue={(n) => t('homeEnergy.scenario.hoursValue', '{{n}}h', { n })}
            onChange={(n) => updateScenario({ horizonHours: n })}
          />
          <Select
            label={t('homeEnergy.scenario.weightPreset', 'Optimization priority')}
            value={activePreset}
            options={presetOptions.filter((o) => o.value !== 'custom' || activePreset === 'custom')}
            onChange={(e) => {
              const preset = WEIGHT_PRESETS[e.target.value];
              if (preset) updateScenario({ weights: preset });
            }}
          />
        </div>

        <div className="space-y-4">
          <Caption>{t('homeEnergy.scenario.tariffGroup', 'Tariff (editable assumption)')}</Caption>
          <Slider
            label={t('homeEnergy.scenario.importPeak', 'Peak import price')}
            min={0}
            max={1}
            step={0.01}
            value={scenario.tariff.importPeakPerKwh}
            formatValue={(n) => `${formatCurrency(n, 2)}/kWh`}
            onChange={(n) => updateScenario({ tariff: { ...scenario.tariff, importPeakPerKwh: n } })}
          />
          <Slider
            label={t('homeEnergy.scenario.importOffPeak', 'Off-peak import price')}
            min={0}
            max={1}
            step={0.01}
            value={scenario.tariff.importOffPeakPerKwh}
            formatValue={(n) => `${formatCurrency(n, 2)}/kWh`}
            onChange={(n) => updateScenario({ tariff: { ...scenario.tariff, importOffPeakPerKwh: n } })}
          />
          <Slider
            label={t('homeEnergy.scenario.exportPrice', 'Export price')}
            min={0}
            max={1}
            step={0.01}
            value={scenario.tariff.exportPerKwh}
            formatValue={(n) => `${formatCurrency(n, 2)}/kWh`}
            onChange={(n) => updateScenario({ tariff: { ...scenario.tariff, exportPerKwh: n } })}
          />
          <Slider
            label={t('homeEnergy.scenario.peakStart', 'Peak window start (UTC hour)')}
            min={0}
            max={23}
            step={1}
            value={scenario.tariff.peakStartHour}
            formatValue={(n) => t('homeEnergy.scenario.hourValue', '{{n}}:00', { n })}
            onChange={(n) => updateScenario({ tariff: { ...scenario.tariff, peakStartHour: n } })}
          />
          <Slider
            label={t('homeEnergy.scenario.peakEnd', 'Peak window end (UTC hour)')}
            min={0}
            max={23}
            step={1}
            value={scenario.tariff.peakEndHour}
            formatValue={(n) => t('homeEnergy.scenario.hourValue', '{{n}}:00', { n })}
            onChange={(n) => updateScenario({ tariff: { ...scenario.tariff, peakEndHour: n } })}
          />
        </div>

        <div className="space-y-4">
          <Caption>{t('homeEnergy.scenario.gridGroup', 'Grid / Panel Limits (editable assumption)')}</Caption>
          <Slider
            label={t('homeEnergy.scenario.maxImport', 'Max grid import')}
            min={1_000}
            max={20_000}
            step={500}
            value={scenario.grid.maxImportW}
            formatValue={(n) => formatPower(n)}
            onChange={(n) => updateScenario({ grid: { ...scenario.grid, maxImportW: n } })}
          />
          <Slider
            label={t('homeEnergy.scenario.maxExport', 'Max grid export')}
            min={0}
            max={15_000}
            step={500}
            value={scenario.grid.maxExportW}
            formatValue={(n) => formatPower(n)}
            onChange={(n) => updateScenario({ grid: { ...scenario.grid, maxExportW: n } })}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Caption>{t('homeEnergy.scenario.powerwallGroup', 'Home Battery (editable assumption)')}</Caption>
            <Toggle
              label={t('homeEnergy.scenario.powerwallEnabled', 'Present')}
              size="sm"
              checked={scenario.powerwall.enabled}
              onChange={(checked) => updateScenario({ powerwall: { ...scenario.powerwall, enabled: checked } })}
            />
          </div>
          {scenario.powerwall.enabled && (
            <>
              <Slider
                label={t('homeEnergy.scenario.pwCapacity', 'Usable capacity')}
                min={1_000}
                max={40_000}
                step={500}
                value={scenario.powerwall.capacityWh}
                formatValue={(n) => `${(n / 1000).toFixed(1)} kWh`}
                onChange={(n) => updateScenario({ powerwall: { ...scenario.powerwall, capacityWh: n } })}
              />
              <Slider
                label={t('homeEnergy.scenario.pwReserve', 'Backup reserve floor')}
                min={0}
                max={100}
                step={1}
                value={scenario.powerwall.reservePct}
                formatValue={(n) => `${n}%`}
                onChange={(n) => updateScenario({ powerwall: { ...scenario.powerwall, reservePct: n } })}
              />
              <Slider
                label={t('homeEnergy.scenario.pwChargePower', 'Max charge power')}
                min={0}
                max={15_000}
                step={250}
                value={scenario.powerwall.maxChargePowerW}
                formatValue={(n) => formatPower(n)}
                onChange={(n) => updateScenario({ powerwall: { ...scenario.powerwall, maxChargePowerW: n } })}
              />
              <Slider
                label={t('homeEnergy.scenario.pwDischargePower', 'Max discharge power')}
                min={0}
                max={15_000}
                step={250}
                value={scenario.powerwall.maxDischargePowerW}
                formatValue={(n) => formatPower(n)}
                onChange={(n) => updateScenario({ powerwall: { ...scenario.powerwall, maxDischargePowerW: n } })}
              />
            </>
          )}
        </div>
      </Grid>
    </GlassPanel>
  );
}
