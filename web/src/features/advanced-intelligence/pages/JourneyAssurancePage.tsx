import { type FormEvent, useState } from 'react';
import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunJourneyAssurance } from '@/api/hooks/useAdvancedIntelligence';
import { KVList, type StatMetric } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';

import { PageLayout, SourceContent, type SourceState } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Icon, Input, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { toLocalDatetimeStr } from '@/lib/dateFormat';

import { glassCardClasses } from '@/lib/tokens';
import { SI } from '@/lib/unitConversion';
import type { JourneyAssuranceRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { AnalysisBrief } from '../components/operationalbrief-all/AnalysisBrief';
import { useRetainedMutation } from '@/hooks/useRetainedMutation';

type JourneyForm = Omit<JourneyAssuranceRequest,
  'vehicle_id' | 'confirmed' | 'departure_at' | 'route_distance_m' | 'reserve_target_pct'> & {
  departure_at: string;
  route_distance_m: number | null;
  reserve_target_pct: number | null;
};

function defaultDeparture(): string {
  // datetime-local values are local wall-clock: build the default from local
  // fields, not a UTC slice (SmartCharge defaultDepartBy precedent).
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return toLocalDatetimeStr(date).slice(0, 16);
}

export default function JourneyAssurancePage() {
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const { t } = useTranslation();
  // The entry parser uses browser-local time even when Intl cannot name it.
  // Do not label that unknown zone UTC via the display helper's fallback.
  let departureTimeZone: string;
  try {
    departureTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || t('common.unknown', 'Unknown');
  } catch {
    departureTimeZone = t('common.unknown', 'Unknown');
  }
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunJourneyAssurance();
  const publication = useRetainedMutation(mutation, vehicleId, {
    data: (data) => data.vehicle_id, inputs: (inputs) => inputs.vehicle_id,
  });
  const [form, setForm] = useState<JourneyForm>({
    route_distance_m: 250000,
    departure_at: defaultDeparture(),
    reserve_target_pct: 15,
    outside_temp_c: null,
    average_speed_mps: null,
    auxiliary_load_w: null,
  });
  usePageTitle(t('advancedIntelligence.journey.title', 'Journey assurance'));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { route_distance_m, reserve_target_pct } = form;
    if (vehicleId == null || publication.pending || route_distance_m == null || reserve_target_pct == null
      || !event.currentTarget.reportValidity()) return;
    const departure = new Date(form.departure_at);
    if (!Number.isFinite(departure.getTime())) return;
    mutation.mutate({
      ...form,
      route_distance_m,
      reserve_target_pct,
      vehicle_id: vehicleId,
      departure_at: departure.toISOString(),
      confirmed: true,
    });
  };
  const result = publication.result;
  const factors = result?.factors ?? [];
  const submitted = publication.published?.inputs;
  const resultState = useDataState(publication.source);
  const sourceState: SourceState = resultState.fatalError ? 'error'
    : result ? resultState.status === 'stale' ? 'retained' : 'ready'
      : publication.pending && publication.source.fetchStatus !== 'paused' ? 'loading' : 'empty';
  const query = result || publication.pending || publication.error ? publication.source : undefined;
  const pendingMessage = publication.source.fetchStatus === 'paused'
    ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
    : t('advancedIntelligence.journey.summary.empty', 'Submit a journey scenario to calculate readiness.');
  const summaryMetrics: readonly StatMetric[] = [
    { occurrenceId: 'readiness', metricId: 'percent', rawValue: result?.readiness_score_pct,
      label: t('advancedIntelligence.journey.readiness', 'Readiness score'),
      description: t('advancedIntelligence.journey.brief.readiness', 'Returned readiness percentage from supported factors; not a vehicle health assessment or confidence estimate.') },
    { occurrenceId: 'arrival-low', metricId: 'percent', rawValue: result?.arrival_soc_low_pct,
      label: t('advancedIntelligence.journey.arrivalLow', 'Arrival SoC low'),
      description: t('advancedIntelligence.journey.brief.arrivalLow', 'Lower modeled arrival state-of-charge bound for the submitted journey.') },
    { occurrenceId: 'arrival-high', metricId: 'percent', rawValue: result?.arrival_soc_high_pct,
      label: t('advancedIntelligence.journey.arrivalHigh', 'Arrival SoC high'),
      description: t('advancedIntelligence.journey.brief.arrivalHigh', 'Upper modeled arrival state-of-charge bound; unsupported is not zero reserve.') },
    { occurrenceId: 'energy-required', metricId: 'energy', rawValue: result?.energy_required_wh,
      label: t('advancedIntelligence.journey.energy', 'Energy required'),
      description: t('advancedIntelligence.journey.brief.energy', 'Estimated energy requirement for the submitted route, not measured journey consumption.') },
  ];

  return (
    <PageLayout
      title={t('advancedIntelligence.journey.title', 'Journey assurance')}
      subtitle={t(
        'advancedIntelligence.journey.subtitle',
        'Assess departure readiness and arrival reserve from supported vehicle evidence.',
      )}
    >
      <AlertBanner
        variant="info"
        title={t('advancedIntelligence.journey.notice.title', 'Planning estimate')}
      >
        {t(
          'advancedIntelligence.journey.notice.body',
          'This assessment does not reserve chargers, navigate, precondition, or command the vehicle.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.journey.form.title', 'Journey scenario')}
          description={t(
            'advancedIntelligence.journey.form.subtitle',
            'Optional weather, speed, and auxiliary load sharpen the estimate when known.',
          )}
        >
          <form className="@container space-y-5" onSubmit={submit}>
            <div className="grid min-w-0 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.distance', 'Route distance (canonical SI)')}
                value={form.route_distance_m}
                onChange={(value) => setForm((current) => ({ ...current, route_distance_m: value }))}
                siUnit={SI.distance}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDistance(form.route_distance_m),
                })}
                min={100}
                max={5000000}
                required
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.journey.form.departure', 'Departure')}
                hint={t('advancedIntelligence.journey.form.departureZone',
                  'Enter departure in your browser time zone ({{timeZone}}). Display time zone preferences do not change this entry.',
                  { timeZone: departureTimeZone })}
                value={form.departure_at}
                required
                onChange={(event) => setForm((current) => ({ ...current, departure_at: event.target.value }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.journey.form.reserve', 'Reserve target (%)')}
                value={form.reserve_target_pct ?? ''}
                min={0}
                max={80}
                step={1}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, reserve_target_pct: event.target.value === '' ? null : event.target.valueAsNumber,
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.temperature', 'Outside temperature (canonical SI, optional)')}
                value={form.outside_temp_c}
                onChange={(value) => setForm((current) => ({ ...current, outside_temp_c: value }))}
                siUnit={SI.temperature}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatTemperature(form.outside_temp_c),
                })}
                min={-80}
                max={80}
                step={0.1}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.speed', 'Average speed (canonical SI, optional)')}
                value={form.average_speed_mps}
                onChange={(value) => setForm((current) => ({ ...current, average_speed_mps: value }))}
                siUnit={SI.speed}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatSpeed(form.average_speed_mps),
                })}
                min={0.1}
                max={70}
                step={0.1}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.auxiliary', 'Auxiliary load (canonical SI, optional)')}
                value={form.auxiliary_load_w}
                onChange={(value) => setForm((current) => ({ ...current, auxiliary_load_w: value }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.auxiliary_load_w),
                })}
                min={0}
                max={50000}
              />
            </div>
            <Button
              type="submit"
              wrapLabel
              className="min-h-11 w-full max-w-full sm:w-auto md:min-h-10"
              loading={publication.pending}
              disabled={vehicleId == null || publication.pending}
              icon={<Icon icon={Route} size="md" />}
            >
              {t('advancedIntelligence.journey.form.run', 'Run confirmed readiness assessment')}
            </Button>
          </form>
          <MutationError error={publication.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <AnalysisBrief
          id="advanced-intelligence-journey-brief"
          title={t('advancedIntelligence.journey.summary.title', 'Readiness and arrival range')}
          description={t('advancedIntelligence.journey.brief.description', 'Returned readiness and arrival bounds for the submitted journey; factors and unsupported planning capabilities remain explicit.')}
          metrics={summaryMetrics}
          vehicleId={result?.vehicle_id ?? vehicleId}
          hasResult={result != null}
          pending={publication.pending}
          error={publication.error}
          query={query}
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          generatedAt={result?.generated_at}
          provenance={t('advancedIntelligence.journey.brief.source', 'Journey readiness assessment')}
          emptyMessage={t(
            'advancedIntelligence.journey.summary.empty',
            'Submit a journey scenario to calculate readiness.',
          )}
        />
        {submitted && <section className="min-w-0 space-y-3" aria-label={t('advancedIntelligence.journey.brief.source', 'Journey readiness assessment')}>
          <Text as="p" variant="bodySm" color="secondary">
            {t('advancedIntelligence.journey.brief.description', 'Returned readiness and arrival bounds for the submitted journey; factors and unsupported planning capabilities remain explicit.')}
          </Text>
          <KVList layout="responsive" wrap items={[
            { id: 'distance', label: t('advancedIntelligence.journey.form.distance', 'Route distance (canonical SI)'), value: `${fmtNumber(submitted.route_distance_m)} ${SI.distance}` },
            { id: 'departure', label: t('advancedIntelligence.journey.form.departure', 'Departure'), value: formatDateTime(submitted.departure_at) },
            { id: 'reserve', label: t('advancedIntelligence.journey.form.reserve', 'Reserve target (%)'), value: `${fmtNumber(submitted.reserve_target_pct)}%` },
            { id: 'temperature', label: t('advancedIntelligence.journey.form.temperature', 'Outside temperature (canonical SI, optional)'), value: submitted.outside_temp_c == null ? '—' : `${fmtNumber(submitted.outside_temp_c)} ${SI.temperature}` },
            { id: 'speed', label: t('advancedIntelligence.journey.form.speed', 'Average speed (canonical SI, optional)'), value: submitted.average_speed_mps == null ? '—' : `${fmtNumber(submitted.average_speed_mps)} ${SI.speed}` },
            { id: 'auxiliary', label: t('advancedIntelligence.journey.form.auxiliary', 'Auxiliary load (canonical SI, optional)'), value: submitted.auxiliary_load_w == null ? '—' : `${fmtNumber(submitted.auxiliary_load_w)} ${SI.power}` },
          ]} />
        </section>}
      </FadeIn>

      <FadeIn delay={0.1}>
        <InsightPanel
          title={t('advancedIntelligence.journey.factors.title', 'Readiness factors')}
          sourceState={sourceState}
          query={query}
          error={resultState.fatalError}
          emptyMessage={pendingMessage}
        >
          <div className="@container grid min-w-0 gap-4 @2xl:grid-cols-2">
            {factors.length === 0 ? <EmptyState variant="informational"
              message={t('advancedIntelligence.journey.factors.empty', 'No supported readiness factors are available.')}
              description={t('advancedIntelligence.journey.factors.emptyHelp', 'Factors appear when the selected vehicle has supported readiness data for this journey.')} /> : factors.map((factor) => (
              <article key={factor.factor} className={`min-w-0 break-words ${glassCardClasses.md}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Text as="h3" variant="label" className="min-w-0 break-words">{factor.factor}</Text>
                  <Badge variant={factor.status === 'supported' ? 'info' : factor.status === 'unsupported' ? 'warning' : 'neutral'}>
                    {factor.status === 'unsupported'
                      ? t('advancedIntelligence.unsupported.short', 'Unsupported') : factor.status || t('common.unknown', 'Unknown')}
                  </Badge>
                </div>
                <Text as="p" variant="bodySm" className="mt-2">{factor.explanation}</Text>
                <Text as="p" variant="metricValue" className="mt-3">
                  {factor.score_pct != null ? `${fmtNumber(factor.score_pct)}%` : '—'}
                </Text>
              </article>
            ))}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <SourceContent state={result ? sourceState : 'ready'}
          label={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          emptyMessage={pendingMessage}
          errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
          retainedMessage={t('advancedIntelligence.brief.retainedNotice', 'Previously loaded data remains visible while affected sources recover.')}
        >
        {result ? <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.journey.unsupported.traffic', 'Live traffic and charger availability'),
            t('advancedIntelligence.journey.unsupported.commands', 'Navigation, charging, or climate commands'),
          ]}
        /> : <InsightPanel
          title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          description={t('advancedIntelligence.evidence.subtitle', 'Supported observations are separated from assumptions and unsupported fields.')}
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-3">
            {[
              { id: 'quality', label: t('advancedIntelligence.quality.title', 'Data quality') },
              { id: 'evidence', label: t('advancedIntelligence.evidence.sources', 'Evidence sources') },
              { id: 'limitations', label: t('advancedIntelligence.limitations.title', 'Limitations') },
            ].map(({ id, label }) => <section key={id} aria-label={label} className="min-w-0 space-y-3">
              <Text as="h3" variant="label">{label}</Text>
              <SourceContent state={sourceState} label={label} emptyMessage={pendingMessage}
                error={resultState.fatalError}
                errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
                emptyContent={<Text as="p" variant="bodySm" role="status">{pendingMessage}</Text>}
              ><Text as="p" variant="bodySm">{pendingMessage}</Text></SourceContent>
              {id === 'limitations' && <>
                <Text as="p" variant="label">{t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}</Text>
                <Text as="p" variant="bodySm">{t('advancedIntelligence.journey.unsupported.traffic', 'Live traffic and charger availability')}</Text>
                <Text as="p" variant="bodySm">{t('advancedIntelligence.journey.unsupported.commands', 'Navigation, charging, or climate commands')}</Text>
              </>}
            </section>)}
          </div>
        </InsightPanel>}
        </SourceContent>
      </FadeIn>
    </PageLayout>
  );
}
