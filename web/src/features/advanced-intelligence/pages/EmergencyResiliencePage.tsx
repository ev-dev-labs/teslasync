import { type FormEvent, useMemo, useState } from 'react';
import { BatteryCharging, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCreateResiliencePlan } from '@/api/hooks/useAdvancedIntelligence';
import {
  CartesianGrid, ChartContainer, CHART_COLORS, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Input, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDurationFromSI, convertEnergyFromSI, SI,
} from '@/lib/unitConversion';
import type { ResiliencePlanRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';

type ResilienceForm = Omit<ResiliencePlanRequest, 'vehicle_id' | 'confirmed'>;

export default function EmergencyResiliencePage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useCreateResiliencePlan();
  const [form, setForm] = useState<ResilienceForm>({
    vehicle_energy_wh: 60000,
    stationary_storage_wh: 13500,
    expected_solar_wh: 12000,
    essential_load_w: 1200,
    outage_duration_s: 172800,
    evacuation_reserve_wh: 15000,
    restoration_uncertainty_pct: 25,
  });
  usePageTitle(t('advancedIntelligence.resilience.title', 'Emergency Resilience'));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    mutation.mutate({ ...form, vehicle_id: vehicleId, confirmed: true });
  };

  const result = mutation.data;
  const chartData = useMemo(() => (result?.risk_timeline ?? []).map((point) => ({
    time: convertDurationFromSI(point.time_s, units.unitPrefs.duration),
    energy: convertEnergyFromSI(point.remaining_energy_wh, units.unitPrefs.energy),
    risk: point.risk,
  })), [result, units.unitPrefs.duration, units.unitPrefs.energy]);

  return (
    <PageContainer
      title={t('advancedIntelligence.resilience.title', 'Emergency Resilience')}
      subtitle={t(
        'advancedIntelligence.resilience.subtitle',
        'Plan energy survival, load priorities, and risk progression for a modeled outage.',
      )}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="warning"
        icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.resilience.notice.title', 'Advisory plan only')}
      >
        {t(
          'advancedIntelligence.resilience.notice.body',
          'TeslaSync does not shed loads, dispatch storage, export vehicle energy, or execute emergency commands.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel title={t('advancedIntelligence.resilience.form.title', 'Outage plan scenario')}>
          <form className="space-y-5" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.vehicleEnergy', 'Vehicle energy (canonical SI)')}
                value={form.vehicle_energy_wh}
                onChange={(value) => setForm((current) => ({ ...current, vehicle_energy_wh: value ?? 0 }))}
                siUnit={SI.energy}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatEnergy(form.vehicle_energy_wh),
                })}
                min={0}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.storage', 'Stationary storage (canonical SI)')}
                value={form.stationary_storage_wh}
                onChange={(value) => setForm((current) => ({ ...current, stationary_storage_wh: value ?? 0 }))}
                siUnit={SI.energy}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatEnergy(form.stationary_storage_wh),
                })}
                min={0}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.solar', 'Expected solar energy (canonical SI)')}
                value={form.expected_solar_wh}
                onChange={(value) => setForm((current) => ({ ...current, expected_solar_wh: value ?? 0 }))}
                siUnit={SI.energy}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatEnergy(form.expected_solar_wh),
                })}
                min={0}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.load', 'Essential load (canonical SI)')}
                value={form.essential_load_w}
                onChange={(value) => setForm((current) => ({ ...current, essential_load_w: value ?? 0 }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.essential_load_w),
                })}
                min={1}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.duration', 'Outage duration (canonical SI)')}
                value={form.outage_duration_s}
                onChange={(value) => setForm((current) => ({ ...current, outage_duration_s: value ?? 0 }))}
                siUnit={SI.duration}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDuration(form.outage_duration_s),
                })}
                min={60}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.reserve', 'Evacuation reserve (canonical SI)')}
                value={form.evacuation_reserve_wh}
                onChange={(value) => setForm((current) => ({ ...current, evacuation_reserve_wh: value ?? 0 }))}
                siUnit={SI.energy}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatEnergy(form.evacuation_reserve_wh),
                })}
                min={0}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.resilience.form.uncertainty', 'Restoration uncertainty (%)')}
                value={form.restoration_uncertainty_pct}
                min={0}
                max={200}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, restoration_uncertainty_pct: Number(event.target.value),
                }))}
              />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={vehicleId == null || mutation.isPending}
              icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.resilience.form.run', 'Create confirmed outage plan')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.resilience.summary.title', 'Survival horizon')}
          empty={!result}
          emptyMessage={t('advancedIntelligence.resilience.summary.empty', 'Submit an outage scenario to build a plan.')}
        >
          <Grid cols={{ default: 1, sm: 2 }} gap={4}>
            <StatCard
              label={t('advancedIntelligence.resilience.horizon', 'Modeled survival horizon')}
              value={units.formatDuration(result?.survival_horizon_s)}
            />
            <StatCard
              label={t('advancedIntelligence.resilience.timelinePoints', 'Risk checkpoints')}
              value={result ? result.risk_timeline.length : null}
            />
          </Grid>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('advancedIntelligence.resilience.timeline.title', 'Outage risk timeline')}
          ariaLabel={t(
            'advancedIntelligence.resilience.timeline.aria',
            'Remaining supported energy over the modeled outage timeline',
          )}
          empty={chartData.length < 2}
          data={chartData}
          dataColumns={[
            { key: 'time', label: t('advancedIntelligence.resilience.timeline.time', 'Time') },
            { key: 'energy', label: t('advancedIntelligence.resilience.timeline.energy', 'Remaining energy') },
            { key: 'risk', label: t('advancedIntelligence.resilience.timeline.risk', 'Risk') },
          ]}
        >
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" unit={` ${units.unitPrefs.duration}`} />
                <YAxis unit={` ${units.unitPrefs.energy}`} />
                <Tooltip />
                <Line type="monotone" dataKey="energy" stroke={CHART_COLORS[0]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t(
              'advancedIntelligence.resilience.timeline.empty',
              'At least two supported timeline points are required.',
            )} />
          )}
        </ChartContainer>
      </FadeIn>

      <FadeIn delay={0.15}>
        <InsightPanel
          title={t('advancedIntelligence.resilience.actions.title', 'Load priorities and recommendations')}
          empty={!result}
          emptyMessage={t('advancedIntelligence.resilience.actions.empty', 'No outage plan has been generated.')}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              {(result?.load_priorities ?? []).map((item) => (
                <article key={`${item.priority}-${item.load}`} className="rounded-lg border border-white/[0.07] p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="info">#{item.priority}</Badge>
                    <Text as="h3" variant="label">{item.load}</Text>
                  </div>
                  <Text as="p" variant="bodySm" className="mt-2">{item.action}</Text>
                </article>
              ))}
            </div>
            <div className="space-y-2">
              {(result?.recommendations ?? []).map((item) => (
                <Text as="p" variant="bodySm" key={item}>• {item}</Text>
              ))}
            </div>
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.resilience.unsupported.dispatch', 'Automatic load shedding or energy dispatch'),
            t('advancedIntelligence.resilience.unsupported.v2h', 'Assumed vehicle-to-home capability or authorization'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
