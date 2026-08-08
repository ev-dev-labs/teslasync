import { type FormEvent, useState } from 'react';
import { Building2, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunChargingSiteTwin } from '@/api/hooks/useAdvancedIntelligence';
import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Input, Select, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { SI } from '@/lib/unitConversion';
import type { ChargingSiteTwinRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';

type SiteForm = Omit<ChargingSiteTwinRequest, 'vehicle_id' | 'confirmed'>;

export default function ChargingSiteTwinPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunChargingSiteTwin();
  const [form, setForm] = useState<SiteForm>({
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
  usePageTitle(t('advancedIntelligence.site.title', 'Charging Site Twin'));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    mutation.mutate({ ...form, vehicle_id: vehicleId, confirmed: true });
  };
  const result = mutation.data;

  return (
    <PageContainer
      title={t('advancedIntelligence.site.title', 'Charging Site Twin')}
      subtitle={t(
        'advancedIntelligence.site.subtitle',
        'Test queue, utilization, peak demand, and panel constraints before infrastructure changes.',
      )}
      actions={<VehicleSelect withIcon />}
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.chargers', 'Charger count')}
                value={form.charger_count}
                min={1}
                max={1000}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, charger_count: Number(event.target.value),
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.chargerPower', 'Per-charger power (canonical SI)')}
                value={form.charger_power_w}
                onChange={(value) => setForm((current) => ({ ...current, charger_power_w: value ?? 0 }))}
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
                onChange={(value) => setForm((current) => ({ ...current, panel_limit_w: value ?? 0 }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.panel_limit_w),
                })}
                min={500}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.arrivalRate', 'Arrival rate (vehicles/second)')}
                value={form.arrival_rate_per_s}
                min={0.000001}
                max={1}
                step={0.0001}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, arrival_rate_per_s: Number(event.target.value),
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.site.form.service', 'Mean service time (canonical SI)')}
                value={form.mean_service_s}
                onChange={(value) => setForm((current) => ({ ...current, mean_service_s: value ?? 0 }))}
                siUnit={SI.duration}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDuration(form.mean_service_s),
                })}
                min={60}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.site.form.growth', 'Fleet growth (%)')}
                value={form.fleet_growth_pct}
                min={-90}
                max={1000}
                step={1}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, fleet_growth_pct: Number(event.target.value),
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
              />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={vehicleId == null || mutation.isPending}
              icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.site.form.run', 'Run confirmed site simulation')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.site.constraints.title', 'Utilization and constraints')}
          empty={!result}
          emptyMessage={t('advancedIntelligence.site.constraints.empty', 'Submit a site scenario to see constraints.')}
        >
          <Grid cols={{ default: 1, sm: 2, lg: 3 }} gap={4}>
            <StatCard
              label={t('advancedIntelligence.site.utilization', 'Utilization')}
              value={result ? `${fmtNumber(result.utilization_pct, 1)}%` : null}
              icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard label={t('advancedIntelligence.site.queueP50', 'Queue wait P50')} value={units.formatDuration(result?.queue_wait_p50_s)} />
            <StatCard label={t('advancedIntelligence.site.queueP90', 'Queue wait P90')} value={units.formatDuration(result?.queue_wait_p90_s)} />
            <StatCard label={t('advancedIntelligence.site.peak', 'Peak demand')} value={units.formatPower(result?.peak_demand_w)} />
            <StatCard
              label={t('advancedIntelligence.site.panelConstraint', 'Panel constraint')}
              value={result ? `${fmtNumber(result.panel_constraint_pct, 1)}%` : null}
            />
            <StatCard
              label={t('advancedIntelligence.site.status', 'Projection status')}
              value={result
                ? (result.projected_unstable
                  ? t('advancedIntelligence.site.unstable', 'Unstable')
                  : t('advancedIntelligence.site.stable', 'Stable'))
                : null}
            />
          </Grid>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <InsightPanel
          title={t('advancedIntelligence.site.mitigations.title', 'Ranked mitigations and assumptions')}
          empty={!result || result.mitigations.length === 0}
          emptyMessage={t('advancedIntelligence.site.mitigations.empty', 'No supported mitigations were returned.')}
        >
          <div className="space-y-3">
            {(result?.mitigations ?? []).map((item) => (
              <article key={`${item.rank}-${item.mitigation}`} className="rounded-lg border border-white/[0.07] p-4">
                <div className="flex items-center gap-3">
                  <Badge variant="info">#{item.rank}</Badge>
                  <Text as="h3" variant="label">{item.mitigation}</Text>
                </div>
                <Text as="p" variant="bodySm" className="mt-2">
                  {t('advancedIntelligence.site.mitigation.effect', 'Queue {{queue}}% · Peak {{peak}}', {
                    queue: fmtNumber(item.queue_delta_pct, 1),
                    peak: units.formatPower(item.peak_delta_w),
                  })}
                </Text>
                <Text as="p" variant="caption">{item.assumption}</Text>
              </article>
            ))}
            {(result?.assumptions ?? []).map((assumption) => (
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
    </PageContainer>
  );
}
