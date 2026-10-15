import { type FormEvent, useMemo, useState } from 'react';
import { BatteryCharging, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCreateResiliencePlan } from '@/api/hooks/useAdvancedIntelligence';
import {
  CartesianGrid, CHART_COLORS, ChartTooltip, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '@/components/charts';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AlertBanner, EmptyState } from '@/components/feedback';

import { ChartCard, PageLayout, SourceContent, type SourceState } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Icon, Input, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDurationFromSI, convertEnergyFromSI, SI,
} from '@/lib/unitConversion';
import type { ResiliencePlanRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput, StormGuardPanel } from '../components';
import { AnalysisBrief } from '../components/operationalbrief-all/AnalysisBrief';
import { useRetainedMutation } from '@/hooks/useRetainedMutation';

type ResilienceForm = Omit<ResiliencePlanRequest, 'vehicle_id' | 'confirmed'>;
type ResilienceDraft = { [Field in keyof ResilienceForm]: number | null };

export default function EmergencyResiliencePage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const mutation = useCreateResiliencePlan();
  const publication = useRetainedMutation(mutation, vehicleId, {
    data: (data) => data.vehicle_id, inputs: (inputs) => inputs.vehicle_id,
  });
  const [form, setForm] = useState<ResilienceDraft>({
    vehicle_energy_wh: 60000,
    stationary_storage_wh: 13500,
    expected_solar_wh: 12000,
    essential_load_w: 1200,
    outage_duration_s: 172800,
    evacuation_reserve_wh: 15000,
    restoration_uncertainty_pct: 25,
  });
  usePageTitle(t('advancedIntelligence.resilience.title', 'Emergency resilience'));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (vehicleId == null || publication.pending) return;
    const { vehicle_energy_wh, stationary_storage_wh, expected_solar_wh, essential_load_w,
      outage_duration_s, evacuation_reserve_wh, restoration_uncertainty_pct } = form;
    if (vehicle_energy_wh == null || stationary_storage_wh == null || expected_solar_wh == null
      || essential_load_w == null || outage_duration_s == null || evacuation_reserve_wh == null
      || restoration_uncertainty_pct == null || !Object.values(form).every(Number.isFinite)
      || !event.currentTarget.reportValidity()) return;
    mutation.mutate({ vehicle_energy_wh, stationary_storage_wh, expected_solar_wh, essential_load_w,
      outage_duration_s, evacuation_reserve_wh, restoration_uncertainty_pct,
      vehicle_id: vehicleId, confirmed: true });
  };

  const result = publication.result;
  const resultState = useDataState(publication.source);
  const sourceState: SourceState = resultState.fatalError ? 'error'
    : result ? resultState.status === 'stale' ? 'retained' : 'ready'
      : publication.pending && publication.source.fetchStatus !== 'paused' ? 'loading' : 'empty';
  const pendingMessage = publication.source.fetchStatus === 'paused'
    ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
    : t('advancedIntelligence.resilience.summary.empty', 'Submit an outage scenario to build a plan.');
  const priorities = result?.load_priorities ?? [];
  const recommendations = result?.recommendations ?? [];
  const summaryMetrics: readonly StatMetric[] = [
    { occurrenceId: 'survival-horizon', metricId: 'duration', rawValue: result?.survival_horizon_s,
      label: t('advancedIntelligence.resilience.horizon', 'Modeled survival horizon'),
      description: t('advancedIntelligence.resilience.brief.horizon', 'Energy survival duration from the submitted outage plan; not a weather forecast or guarantee.') },
    { occurrenceId: 'risk-checkpoints', metricId: 'count', rawValue: result?.risk_timeline?.length,
      label: t('advancedIntelligence.resilience.timelinePoints', 'Risk checkpoints'),
      description: t('advancedIntelligence.resilience.brief.checkpoints', 'Number of checkpoints returned in this modeled outage timeline, not a count of observed storms.') },
  ];
  const chartData = useMemo(() => (result?.risk_timeline ?? []).map((point) => ({
    time: convertDurationFromSI(point.time_s, units.unitPrefs.duration),
    energy: convertEnergyFromSI(point.remaining_energy_wh, units.unitPrefs.energy),
    risk: point.risk,
  })), [result, units.unitPrefs.duration, units.unitPrefs.energy]);

  return (
    <PageLayout
      title={t('advancedIntelligence.resilience.title', 'Emergency resilience')}
      subtitle={t(
        'advancedIntelligence.resilience.subtitle',
        'Plan energy survival, load priorities, and risk progression for a modeled outage.',
      )}
    >
      <AlertBanner
        variant="warning"
        icon={<Icon icon={TriangleAlert} size="lg" />}
        title={t('advancedIntelligence.resilience.notice.title', 'Advisory plan only')}
      >
        {t(
          'advancedIntelligence.resilience.notice.body',
          'TeslaSync does not shed loads, dispatch storage, export vehicle energy, or execute emergency commands.',
        )}
        <Text as="p" variant="bodySm" className="mt-2">
          {t('advancedIntelligence.resilience.brief.description', 'Modeled energy survival and timeline coverage remain separate from Storm guardian forecast and activity sources.')}
        </Text>
      </AlertBanner>

      <FadeIn>
        <StormGuardPanel vehicleId={vehicleId} />
      </FadeIn>

      <FadeIn>
        <InsightPanel title={t('advancedIntelligence.resilience.form.title', 'Outage plan scenario')}>
          <form className="@container space-y-5" onSubmit={submit}>
            <div className="grid min-w-0 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.resilience.form.vehicleEnergy', 'Vehicle energy (canonical SI)')}
                value={form.vehicle_energy_wh}
                onChange={(value) => setForm((current) => ({ ...current, vehicle_energy_wh: value }))}
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
                onChange={(value) => setForm((current) => ({ ...current, stationary_storage_wh: value }))}
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
                onChange={(value) => setForm((current) => ({ ...current, expected_solar_wh: value }))}
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
                onChange={(value) => setForm((current) => ({ ...current, essential_load_w: value }))}
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
                onChange={(value) => setForm((current) => ({ ...current, outage_duration_s: value }))}
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
                onChange={(value) => setForm((current) => ({ ...current, evacuation_reserve_wh: value }))}
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
                value={form.restoration_uncertainty_pct ?? ''}
                min={0}
                max={200}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, restoration_uncertainty_pct: event.target.value === ''
                    || !Number.isFinite(event.target.valueAsNumber) ? null : event.target.valueAsNumber,
                }))}
              />
            </div>
            <Button
              type="submit"
              wrapLabel
              className="min-h-11 max-w-full w-full sm:w-auto md:min-h-10"
              loading={publication.pending}
              disabled={vehicleId == null || publication.pending}
              icon={<Icon icon={BatteryCharging} size="md" />}
            >
              {t('advancedIntelligence.resilience.form.run', 'Create confirmed outage plan')}
            </Button>
          </form>
          <MutationError error={publication.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <AnalysisBrief
          id="advanced-intelligence-resilience-brief"
          title={t('advancedIntelligence.resilience.summary.title', 'Survival horizon')}
          description={t('advancedIntelligence.resilience.brief.description', 'Modeled energy survival and timeline coverage remain separate from Storm guardian forecast and activity sources.')}
          metrics={summaryMetrics}
          vehicleId={result?.vehicle_id ?? vehicleId}
          hasResult={result != null}
          pending={publication.pending}
          error={publication.error}
          query={result || publication.pending || publication.error ? publication.source : undefined}
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          generatedAt={result?.generated_at}
          provenance={t('advancedIntelligence.resilience.brief.source', 'Modeled outage plan')}
          emptyMessage={t('advancedIntelligence.resilience.summary.empty', 'Submit an outage scenario to build a plan.')}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <ChartCard
          size="standard"
          toolbar
          exportable
          title={t('advancedIntelligence.resilience.timeline.title', 'Outage risk timeline')}
          ariaLabel={t(
            'advancedIntelligence.resilience.timeline.aria',
            'Remaining supported energy over the modeled outage timeline',
          )}
          loading={sourceState === 'loading'}
          error={resultState.fatalError}
          empty={result != null && chartData.length < 2}
          data={chartData}
          dataColumns={[
            { key: 'time', label: `${t('advancedIntelligence.resilience.timeline.time', 'Time')} (${units.unitPrefs.duration})` },
            { key: 'energy', label: `${t('advancedIntelligence.resilience.timeline.energy', 'Remaining energy')} (${units.unitPrefs.energy})` },
            { key: 'risk', label: t('advancedIntelligence.resilience.timeline.risk', 'Risk') },
          ]}
        >
          <SourceContent state={sourceState}
            label={t('advancedIntelligence.resilience.timeline.title', 'Outage risk timeline')}
            emptyMessage={pendingMessage}
            errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
            error={resultState.fatalError}
            retainedMessage={t('advancedIntelligence.resilience.brief.description', 'Modeled energy survival and timeline coverage remain separate from Storm guardian forecast and activity sources.')}
            emptyContent={<Text as="p" variant="bodySm" role="status">{pendingMessage}</Text>}
          >
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" unit={` ${units.unitPrefs.duration}`} />
                <YAxis unit={` ${units.unitPrefs.energy}`} />
                <Tooltip content={<ChartTooltip labelFormatter={(value) =>
                  `${typeof value === 'number' ? fmtNumber(value) : value ?? '—'} ${units.unitPrefs.duration}`} />} />
                <Line type="monotone" dataKey="energy"
                  name={t('advancedIntelligence.resilience.timeline.energy', 'Remaining energy')}
                  unit={units.unitPrefs.energy} stroke={CHART_COLORS[0]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            // no-action: the scenario duration/input controls above this chart are the trigger surface; the timeline fills once the simulation returns at least two supported points.
            <EmptyState message={t(
              'advancedIntelligence.resilience.timeline.empty',
              'At least two supported timeline points are required.',
            )} />
          )}
          </SourceContent>
        </ChartCard>
      </FadeIn>

      <FadeIn delay={0.15}>
        <InsightPanel
          title={t('advancedIntelligence.resilience.actions.title', 'Load priorities and recommendations')}
          sourceState={sourceState}
          error={resultState.fatalError}
          emptyMessage={t('advancedIntelligence.resilience.actions.empty', 'No outage plan has been generated.')}
          query={result || publication.pending || publication.error ? publication.source : undefined}
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              {priorities.length === 0 ? <EmptyState variant="informational"
                message={t('advancedIntelligence.panel.empty', 'No supported data is available.')}
                description={t('advancedIntelligence.resilience.actions.prioritiesEmptyHelp', 'Priority actions appear after a supported outage plan is generated from current vehicle and energy data.')} /> : priorities.map((item) => (
                <article key={`${item.priority}-${item.load}`} className="min-w-0 break-words rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral">#{item.priority}</Badge>
                    <Text as="h3" variant="label">{item.load}</Text>
                  </div>
                  <Text as="p" variant="bodySm" className="mt-2">{item.action}</Text>
                </article>
              ))}
            </div>
            <div className="min-w-0 space-y-2 break-words">
              {recommendations.length === 0 ? <EmptyState variant="informational"
                message={t('advancedIntelligence.panel.empty', 'No supported data is available.')}
                description={t('advancedIntelligence.resilience.actions.recommendationsEmptyHelp', 'Recommendations appear when the supported outage plan includes actionable findings.')} /> : recommendations.map((item) => (
                <Text as="p" variant="bodySm" key={item}>• {item}</Text>
              ))}
            </div>
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <SourceContent state={result ? sourceState : 'ready'}
          label={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          emptyMessage={pendingMessage}
          errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
          retainedMessage={t('advancedIntelligence.resilience.brief.source', 'Modeled outage plan')}
        >
        {result ? <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.resilience.unsupported.dispatch', 'Automatic load shedding or energy dispatch'),
            t('advancedIntelligence.resilience.unsupported.v2h', 'Assumed vehicle-to-home capability or authorization'),
          ]}
        /> : <div className="min-w-0 space-y-3"><InsightPanel
          title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          sourceState={sourceState} error={resultState.fatalError} emptyMessage={pendingMessage}
          query={publication.pending || publication.error ? publication.source : undefined}
        ><Text as="p" variant="bodySm">{pendingMessage}</Text></InsightPanel>
          <Text as="p" variant="label">{t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}</Text>
          <Text as="p" variant="bodySm">{t('advancedIntelligence.resilience.unsupported.dispatch', 'Automatic load shedding or energy dispatch')}</Text>
          <Text as="p" variant="bodySm">{t('advancedIntelligence.resilience.unsupported.v2h', 'Assumed vehicle-to-home capability or authorization')}</Text>
        </div>}
        </SourceContent>
      </FadeIn>
    </PageLayout>
  );
}
