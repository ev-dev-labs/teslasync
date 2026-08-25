import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRunTwinLab } from '@/api/hooks/useAdvancedIntelligence';
import {
  Bar, BarChart, CartesianGrid, ChartContainer, CHART_COLORS,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { TwinScenarioInput } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, TwinScenarioForm } from '../components';
import { formatEfficiencyFromSI } from '../formatters';

const createScenario = (index: number, name: string): TwinScenarioInput => ({
  name,
  horizon_s: 3600,
  distance_m: index === 0 ? 50000 : 60000,
  speed_mps: index === 0 ? 22 : 27,
  outside_temp_c: 20,
  auxiliary_load_w: 1000,
});

export default function TwinLabPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunTwinLab();
  const [scenarios, setScenarios] = useState<TwinScenarioInput[]>(() => [
    createScenario(0, t('advancedIntelligence.twin.form.scenario', 'Scenario {{number}}', { number: 1 })),
    createScenario(1, t('advancedIntelligence.twin.form.scenario', 'Scenario {{number}}', { number: 2 })),
  ]);
  usePageTitle(t('advancedIntelligence.twin.title', 'Twin Lab'));

  const updateScenario = (index: number, patch: Partial<TwinScenarioInput>) => {
    setScenarios((current) => current.map((scenario, itemIndex) =>
      itemIndex === index ? { ...scenario, ...patch } : scenario));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    mutation.mutate({ vehicle_id: vehicleId, scenarios, confirmed: true });
  };

  const result = mutation.data;
  const chartData = useMemo(() => (result?.scenarios ?? []).map((scenario) => ({
    name: scenario.name,
    low: scenario.range_low_m == null
      ? null : convertDistanceFromSI(scenario.range_low_m, units.unitPrefs.distance),
    estimate: scenario.range_delta_m == null
      ? null : convertDistanceFromSI(scenario.range_delta_m, units.unitPrefs.distance),
    high: scenario.range_high_m == null
      ? null : convertDistanceFromSI(scenario.range_high_m, units.unitPrefs.distance),
  })), [result, units.unitPrefs.distance]);

  return (
    <PageContainer
      title={t('advancedIntelligence.twin.title', 'Twin Lab')}
      subtitle={t(
        'advancedIntelligence.twin.subtitle',
        'Compare calibrated, vehicle-specific counterfactuals with explicit uncertainty.',
      )}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="info"
        title={t('advancedIntelligence.twin.notice.title', 'Simulation only')}
      >
        {t(
          'advancedIntelligence.twin.notice.body',
          'Scenarios estimate outcomes from observed calibration data. They do not alter the vehicle.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.twin.form.title', 'Calibrated scenarios')}
          description={t(
            'advancedIntelligence.twin.form.subtitle',
            'Enter canonical SI values; preferred-unit equivalents are shown below each measurement.',
          )}
        >
          <TwinScenarioForm
            scenarios={scenarios}
            pending={mutation.isPending}
            disabled={vehicleId == null}
            onUpdate={updateScenario}
            onRemove={(index) => setScenarios((current) => current.filter((_, i) => i !== index))}
            onAdd={() => setScenarios((current) => [
              ...current,
              createScenario(
                current.length,
                t('advancedIntelligence.twin.form.scenario', 'Scenario {{number}}', {
                  number: current.length + 1,
                }),
              ),
            ])}
            onSubmit={submit}
          />
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.twin.baseline.title', 'Calibrated baseline')}
          empty={!result}
          emptyMessage={t(
            'advancedIntelligence.twin.baseline.empty',
            'Run scenarios to view the calibrated baseline.',
          )}
        >
          <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
            <StatCard
              label={t('advancedIntelligence.twin.baseline.model', 'Model')}
              value={result?.model_name ?? null}
            />
            <StatCard
              label={t('advancedIntelligence.twin.baseline.efficiency', 'Efficiency')}
              value={result
                ? formatEfficiencyFromSI(result.baseline.efficiency_wh_per_m, units.unitPrefs)
                : null}
            />
            <StatCard
              label={t('advancedIntelligence.twin.baseline.capacity', 'Usable battery')}
              value={units.formatEnergy(result?.baseline.usable_battery_wh)}
            />
            <StatCard
              label={t('advancedIntelligence.twin.baseline.samples', 'Calibration samples')}
              value={result ? fmtNumber(result.baseline.calibration_sample_count, 0) : null}
            />
          </Grid>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        {/* chart-legend-audit:skip uncertainty bounds and estimate form one modeled interval and must remain visible together */}
        <ChartContainer
          title={t('advancedIntelligence.twin.uncertainty.title', 'Range-effect uncertainty comparison')}
          subtitle={t(
            'advancedIntelligence.twin.uncertainty.subtitle',
            'Low, estimated, and high modeled range deltas by scenario.',
          )}
          ariaLabel={t(
            'advancedIntelligence.twin.uncertainty.aria',
            'Comparison of modeled range uncertainty across twin scenarios',
          )}
          empty={chartData.length < 2}
          data={chartData}
          dataColumns={[
            { key: 'name', label: t('advancedIntelligence.twin.form.name', 'Scenario name') },
            { key: 'low', label: t('advancedIntelligence.twin.uncertainty.low', 'Low') },
            { key: 'estimate', label: t('advancedIntelligence.twin.uncertainty.estimate', 'Estimate') },
            { key: 'high', label: t('advancedIntelligence.twin.uncertainty.high', 'High') },
          ]}
        >
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis unit={` ${units.unitPrefs.distance}`} />
                <Tooltip />
                <Bar dataKey="low" fill={CHART_COLORS[2]} />
                <Bar dataKey="estimate" fill={CHART_COLORS[0]} />
                <Bar dataKey="high" fill={CHART_COLORS[1]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState /* no-action: the scenario add/remove controls above this chart are the trigger surface; uncertainty bars appear once at least two scenarios have supported results. */ message={t('advancedIntelligence.twin.uncertainty.empty', 'At least two supported scenario results are required.')} />}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.15}>
        <InsightPanel
          title={t('advancedIntelligence.twin.sensitivity.title', 'Sensitivity drivers')}
          empty={!result || result.scenarios.length === 0}
          emptyMessage={t(
            'advancedIntelligence.twin.sensitivity.empty',
            'Sensitivity drivers appear after a supported simulation.',
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {(result?.scenarios ?? []).map((scenario) => (
              <div key={scenario.name} className="rounded-lg border border-white/[0.07] p-4">
                <Text as="h3" variant="label">{scenario.name}</Text>
                {(scenario.sensitivity_drivers ?? []).map((driver) => (
                  <div key={driver.driver} className="mt-2 flex justify-between gap-3 text-sm">
                    <span className="text-[var(--text-muted)]">{driver.driver}</span>
                    <span>{fmtNumber(driver.effect_pct, 1)}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.twin.unsupported.commands', 'Vehicle commands and physical actuation'),
            t('advancedIntelligence.twin.unsupported.guarantee', 'Guaranteed real-world outcomes'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
