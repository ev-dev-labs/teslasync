import { type FormEvent, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunChargingSiteTwin } from '@/api/hooks/useAdvancedIntelligence';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Icon, Input, Select, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import { SI } from '@/lib/unitConversion';
import type { ChargingSiteTwinRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { AnalysisBrief } from '../components/operationalbrief-all/AnalysisBrief';
import { useRetainedMutation } from '@/hooks/useRetainedMutation';

type SiteForm = Omit<ChargingSiteTwinRequest, 'vehicle_id' | 'confirmed'>;
type SiteDraft = {
  [Field in keyof SiteForm]: SiteForm[Field] extends number ? number | null : SiteForm[Field];
};

export default function ChargingSiteTwinPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunChargingSiteTwin();
  const publication = useRetainedMutation(mutation, vehicleId, {
    data: (data) => data.vehicle_id, inputs: (inputs) => inputs.vehicle_id,
  });
  const [form, setForm] = useState<SiteDraft>({
    charger_count: 8,
    charger_power_w: 11500,
    panel_limit_w: 100000,
    arrival_rate_per_s: 0.0008,
    mean_service_s: 7200,
    arrival_distribution: 'poisson',
    service_distribution: 'exponential',
    solar_power_w: null,
    storage_energy_wh: null,
    fleet_growth_pct: 10,
  });
  usePageTitle(t('advancedIntelligence.site.title', 'Charging site twin'));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (vehicleId == null || publication.pending) return;
    const { charger_count, charger_power_w, panel_limit_w, arrival_rate_per_s,
      mean_service_s, fleet_growth_pct } = form;
    if (charger_count == null || charger_power_w == null || panel_limit_w == null
      || arrival_rate_per_s == null || mean_service_s == null || fleet_growth_pct == null
      || arrival_rate_per_s <= 0 || !event.currentTarget.reportValidity()) return;
    mutation.mutate({
      ...form, charger_count, charger_power_w, panel_limit_w, arrival_rate_per_s,
      mean_service_s, fleet_growth_pct, vehicle_id: vehicleId, confirmed: true,
    });
  };
  const result = publication.result;
  const mitigations = result?.mitigations ?? [];
  const assumptions = result?.assumptions ?? [];
  const paused = publication.source.fetchStatus === 'paused';
  const summaryMetrics: readonly StatMetric[] = [
    { occurrenceId: 'utilization', metricId: 'percent', rawValue: result?.utilization_pct,
      label: t('advancedIntelligence.site.utilization', 'Utilization'),
      description: t('advancedIntelligence.site.brief.utilization', 'Modeled utilization under the submitted arrival and service assumptions.') },
    { occurrenceId: 'queue-p50', metricId: 'duration', rawValue: result?.queue_wait_p50_s,
      label: t('advancedIntelligence.site.queueP50', 'Queue wait P50'),
      description: t('advancedIntelligence.site.brief.queueP50', 'Modeled median queue wait; unsupported is not zero wait.') },
    { occurrenceId: 'queue-p90', metricId: 'duration', rawValue: result?.queue_wait_p90_s,
      label: t('advancedIntelligence.site.queueP90', 'Queue wait P90'),
      description: t('advancedIntelligence.site.brief.queueP90', 'Modeled 90th-percentile queue wait; not a live site observation.') },
    { occurrenceId: 'peak', metricId: 'power', rawValue: result?.peak_demand_w,
      label: t('advancedIntelligence.site.peak', 'Peak demand'),
      description: t('advancedIntelligence.site.brief.peak', 'Projected electrical demand for the submitted site scenario.') },
    { occurrenceId: 'panel', metricId: 'percent', rawValue: result?.panel_constraint_pct,
      label: t('advancedIntelligence.site.panelConstraint', 'Panel constraint'),
      description: t('advancedIntelligence.site.brief.panel', 'Returned panel constraint percentage; no charger limits are changed.') },
    { occurrenceId: 'projection-status', metricId: 'status', rawValue: result?.projected_unstable != null
      ? result.projected_unstable
        ? t('advancedIntelligence.site.unstable', 'Unstable')
        : t('advancedIntelligence.site.stable', 'Stable')
      : null,
      label: t('advancedIntelligence.site.status', 'Projection status'),
      description: t('advancedIntelligence.site.brief.status', 'Stability is the returned queue projection, not a site-health assessment.') },
  ];

  return (
    <PageLayout
      title={t('advancedIntelligence.site.title', 'Charging site twin')}
      subtitle={t(
        'advancedIntelligence.site.subtitle',
        'Test queue, utilization, peak demand, and panel constraints before infrastructure changes.',
      )}
    >
      <AlertBanner
        variant="info"
        title={t('advancedIntelligence.site.notice.title', 'Design scenario, not site control')}
      >
        {t(
          'advancedIntelligence.site.notice.body',
          'Results are planning approximations and do not dispatch storage, change charger limits, or operate a site.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.site.form.title', 'Site scenario')}
          description={t(
            'advancedIntelligence.site.form.subtitle',
            'Model arrival and service assumptions alongside electrical constraints.',
          )}
        >
          <form className="space-y-5" onSubmit={submit}>
            <div className="grid min-w-0 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.chargers', 'Charger count')}
                value={form.charger_count ?? ''}
                min={1}
                max={1000}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, charger_count: event.target.value === '' ? null : Number(event.target.value),
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.chargerPower', 'Per-charger power (canonical SI)')}
                value={form.charger_power_w}
                onChange={(value) => setForm((current) => ({ ...current, charger_power_w: value }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.charger_power_w),
                })}
                min={500}
                max={2000000}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.panel', 'Panel limit (canonical SI)')}
                value={form.panel_limit_w}
                onChange={(value) => setForm((current) => ({ ...current, panel_limit_w: value }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.panel_limit_w),
                })}
                min={500}
                max={1000000000}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.arrivalRate', 'Arrival rate (vehicles/second)')}
                value={form.arrival_rate_per_s ?? ''}
                min={0}
                max={1}
                step="any"
                required
                onChange={(event) => {
                  const value = event.target.value === '' ? null : Number(event.target.value);
                  event.target.setCustomValidity(value != null && value <= 0
                    ? t('advancedIntelligence.error.body', 'Review the scenario inputs and try again.') : '');
                  setForm((current) => ({ ...current, arrival_rate_per_s: value }));
                }}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.service', 'Mean service time (canonical SI)')}
                value={form.mean_service_s}
                onChange={(value) => setForm((current) => ({ ...current, mean_service_s: value }))}
                siUnit={SI.duration}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDuration(form.mean_service_s),
                })}
                min={60}
                max={604800}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.growth', 'Fleet growth (%)')}
                value={form.fleet_growth_pct ?? ''}
                min={-90}
                max={1000}
                step="any"
                required
                onChange={(event) => setForm((current) => ({
                  ...current, fleet_growth_pct: event.target.value === '' ? null : Number(event.target.value),
                }))}
              />
              <Select
                label={t('advancedIntelligence.site.form.arrivalDistribution', 'Arrival distribution')}
                value={form.arrival_distribution}
                options={[
                  { value: 'poisson', label: t('advancedIntelligence.site.distribution.poisson', 'Poisson') },
                  { value: 'fixed', label: t('advancedIntelligence.site.distribution.fixed', 'Fixed') },
                ]}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  arrival_distribution: event.target.value as SiteForm['arrival_distribution'],
                }))}
              />
              <Select
                label={t('advancedIntelligence.site.form.serviceDistribution', 'Service distribution')}
                value={form.service_distribution}
                options={[
                  { value: 'exponential', label: t('advancedIntelligence.site.distribution.exponential', 'Exponential') },
                  { value: 'deterministic', label: t('advancedIntelligence.site.distribution.deterministic', 'Deterministic') },
                ]}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  service_distribution: event.target.value as SiteForm['service_distribution'],
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.solar', 'Solar power (canonical SI, optional)')}
                value={form.solar_power_w}
                onChange={(value) => setForm((current) => ({ ...current, solar_power_w: value }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.solar_power_w),
                })}
                min={0}
                max={1000000000}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.storage', 'Storage energy (canonical SI, optional)')}
                value={form.storage_energy_wh}
                onChange={(value) => setForm((current) => ({ ...current, storage_energy_wh: value }))}
                siUnit={SI.energy}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatEnergy(form.storage_energy_wh),
                })}
                min={0}
                max={10000000000}
              />
            </div>
            <Button
              type="submit"
              wrapLabel
              className="min-h-11 w-full sm:w-auto md:min-h-10"
              loading={publication.pending}
              disabled={vehicleId == null || publication.pending}
              icon={<Icon icon={Building2} size="md" />}
            >
              {t('advancedIntelligence.site.form.run', 'Run confirmed site simulation')}
            </Button>
          </form>
          <MutationError error={publication.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <AnalysisBrief
          id="advanced-intelligence-site-brief"
          title={t('advancedIntelligence.site.constraints.title', 'Utilization and constraints')}
          description={t('advancedIntelligence.site.brief.description', 'Planning outputs from the submitted site scenario, with unsupported queue estimates kept explicit.')}
          metrics={summaryMetrics}
          vehicleId={result?.vehicle_id ?? vehicleId}
          hasResult={result != null}
          pending={publication.pending}
          error={publication.error}
          query={result || publication.pending || publication.error ? publication.source : undefined}
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={[...(result?.limitations ?? []), ...(result?.assumptions ?? [])]}
          generatedAt={result?.generated_at}
          provenance={t('advancedIntelligence.site.brief.source', 'Charging site simulation')}
          emptyMessage={t('advancedIntelligence.site.constraints.empty', 'Submit a site scenario to see constraints.')}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <InsightPanel
          title={t('advancedIntelligence.site.mitigations.title', 'Ranked mitigations and assumptions')}
          sourceState={!result ? paused ? 'ready' : publication.pending ? 'loading'
            : publication.error ? 'error' : 'empty' : 'ready'}
          error={!result ? publication.error : undefined}
          empty={result != null && mitigations.length === 0 && assumptions.length === 0}
          emptyMessage={result
            ? t('advancedIntelligence.site.mitigations.empty', 'No supported mitigations were returned.')
            : t('advancedIntelligence.site.constraints.empty', 'Submit a site scenario to see constraints.')}
        >
          <div className="space-y-3">
            {!result && paused && <Text as="p" variant="bodySm" role="status">
              {t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')}
            </Text>}
            {mitigations.map((item) => (
              <article key={`${item.rank}-${item.mitigation}`} className="min-w-0 break-words rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <div className="flex items-center gap-3">
                  <Badge variant="neutral">#{item.rank}</Badge>
                  <Text as="h3" variant="label">{item.mitigation}</Text>
                </div>
                <Text as="p" variant="bodySm" className="mt-2">
                  {t('advancedIntelligence.site.mitigation.effect', 'Queue {{queue}}% · peak {{peak}}', {
                    queue: item.queue_delta_pct == null ? '—' : fmtNumber(item.queue_delta_pct),
                    peak: units.formatPower(item.peak_delta_w),
                  })}
                </Text>
                <Text as="p" variant="caption">{item.assumption}</Text>
              </article>
            ))}
            {assumptions.map((assumption) => (
              <Text as="p" variant="bodySm" key={assumption}>• {assumption}</Text>
            ))}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.site.unsupported.control', 'Charger, panel, solar, or storage control'),
            t('advancedIntelligence.site.unsupported.guarantee', 'Guaranteed real-world queue performance'),
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
