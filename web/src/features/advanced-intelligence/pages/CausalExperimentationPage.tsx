import { type FormEvent, useState } from 'react';
import { Beaker, GitCommitHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCausalExperiments,
  useCreateCausalExperiment,
} from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, ConfirmDialog, Input, Pagination, Select, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  CausalExperiment,
  CausalMetric,
  CreateCausalExperimentRequest,
} from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError } from '../components';
import { formatEfficiencyFromSI } from '../formatters';

const PAGE_SIZE = 10;
type ExperimentForm = Omit<CreateCausalExperimentRequest, 'vehicle_id' | 'confirmed'>;

function isoLocal(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default function CausalExperimentationPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<ExperimentForm>({
    intervention_kind: 'charging_schedule',
    metric: 'charging_success_pct',
    baseline_start: isoLocal(8),
    baseline_end: isoLocal(6),
    treatment_start: isoLocal(5),
    treatment_end: isoLocal(2),
  });
  const query = useCausalExperiments(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const mutation = useCreateCausalExperiment();
  const experiments = query.data?.items ?? [];
  const latest = experiments[0] ?? mutation.data ?? null;
  usePageTitle(t('advancedIntelligence.causal.title', 'Causal Experimentation'));

  const formatEfficiency = (value: number | null) => {
    return formatEfficiencyFromSI(value, units.unitPrefs);
  };

  const metricValue = (item: CausalExperiment, phase: 'baseline' | 'treatment' | 'effect') => {
    if (item.metric === 'drive_energy_wh_per_m') {
      return formatEfficiency(item[`${phase}_energy_wh_per_m`]);
    }
    if (item.metric === 'average_speed_mps') {
      return units.formatSpeed(item[`${phase}_speed_mps`]);
    }
    const value = item[`${phase}_success_pct`];
    return value != null ? `${fmtNumber(value, 2)}%` : '—';
  };

  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId != null) setConfirmOpen(true);
  };

  const confirmExperiment = () => {
    if (vehicleId == null || mutation.isPending) return;
    mutation.mutate({
      ...form,
      vehicle_id: vehicleId,
      baseline_start: new Date(form.baseline_start).toISOString(),
      baseline_end: new Date(form.baseline_end).toISOString(),
      treatment_start: new Date(form.treatment_start).toISOString(),
      treatment_end: new Date(form.treatment_end).toISOString(),
      confirmed: true,
    }, { onSuccess: () => setConfirmOpen(false) });
  };

  return (
    <PageContainer
      title={t('advancedIntelligence.causal.title', 'Causal Experimentation')}
      subtitle={t(
        'advancedIntelligence.causal.subtitle',
        'Compare explicit baseline and treatment windows with confounder coverage disclosure.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
    >
      <AlertBanner
        variant="warning"
        title={t('advancedIntelligence.causal.notice.title', 'Association is not proof of causality')}
      >
        {t(
          'advancedIntelligence.causal.notice.body',
          'Estimates may remain non-causal or insufficient when samples or confounder coverage are limited.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.causal.history.title', 'Experiment history')}
          empty={experiments.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.causal.history.empty', 'No causal experiments have been recorded.')}
        >
          <div className="space-y-4">
            {experiments.map((item) => (
              <article key={item.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <GitCommitHorizontal className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                    <div>
                      <Text as="h3" variant="subhead">{item.intervention_kind}</Text>
                      <Text as="p" variant="caption">{item.metric} · {formatDateTime(item.updated_at)}</Text>
                    </div>
                  </div>
                  <Badge variant={item.state === 'estimated' ? 'success' : 'warning'}>{item.state}</Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-white/[0.06] p-3">
                    <Text as="p" variant="caption">{t('advancedIntelligence.causal.baseline', 'Baseline')}</Text>
                    <Text as="p" variant="metricValue">{metricValue(item, 'baseline')}</Text>
                    <Text as="p" variant="caption">
                      {t('advancedIntelligence.causal.samples', '{{count}} samples', { count: item.baseline_sample_count })}
                    </Text>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] p-3">
                    <Text as="p" variant="caption">{t('advancedIntelligence.causal.treatment', 'Treatment')}</Text>
                    <Text as="p" variant="metricValue">{metricValue(item, 'treatment')}</Text>
                    <Text as="p" variant="caption">
                      {t('advancedIntelligence.causal.samples', '{{count}} samples', { count: item.treatment_sample_count })}
                    </Text>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] p-3">
                    <Text as="p" variant="caption">{t('advancedIntelligence.causal.effect', 'Estimated effect')}</Text>
                    <Text as="p" variant="metricValue">{metricValue(item, 'effect')}</Text>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] p-3">
                    <Text as="p" variant="caption">{t('advancedIntelligence.causal.confounders', 'Confounder coverage')}</Text>
                    <Text as="p" variant="metricValue">
                      {item.confounder_coverage_pct != null
                        ? `${fmtNumber(item.confounder_coverage_pct, 1)}%` : '—'}
                    </Text>
                  </div>
                </div>
              </article>
            ))}
            {(query.data?.total ?? 0) > PAGE_SIZE ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onPageChange={setPage} />
            ) : null}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.causal.form.title', 'Create windowed experiment')}
          description={t(
            'advancedIntelligence.causal.form.subtitle',
            'Windows must be ordered, non-overlapping, at least 24 hours, and already observed.',
          )}
        >
          <form className="space-y-4" onSubmit={requestConfirmation}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Select
                label={t('advancedIntelligence.causal.form.intervention', 'Intervention')}
                value={form.intervention_kind}
                options={[
                  ['charging_schedule', t('advancedIntelligence.causal.intervention.charging', 'Charging schedule')],
                  ['tire_service', t('advancedIntelligence.causal.intervention.tires', 'Tire service')],
                  ['software_update', t('advancedIntelligence.causal.intervention.software', 'Software update')],
                  ['climate_preconditioning', t('advancedIntelligence.causal.intervention.climate', 'Climate preconditioning')],
                  ['driving_policy', t('advancedIntelligence.causal.intervention.driving', 'Driving policy')],
                ].map(([value, label]) => ({ value, label }))}
                onChange={(event) => setForm((current) => ({
                  ...current, intervention_kind: event.target.value,
                }))}
              />
              <Select
                label={t('advancedIntelligence.causal.form.metric', 'Metric')}
                value={form.metric}
                options={[
                  { value: 'drive_energy_wh_per_m', label: t('advancedIntelligence.causal.metric.energy', 'Drive energy efficiency') },
                  { value: 'charging_success_pct', label: t('advancedIntelligence.causal.metric.charging', 'Charging success') },
                  { value: 'average_speed_mps', label: t('advancedIntelligence.causal.metric.speed', 'Average speed') },
                ]}
                onChange={(event) => setForm((current) => ({
                  ...current, metric: event.target.value as CausalMetric,
                }))}
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.causal.form.baselineStart', 'Baseline start')}
                value={form.baseline_start}
                required
                onChange={(event) => setForm((current) => ({ ...current, baseline_start: event.target.value }))}
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.causal.form.baselineEnd', 'Baseline end')}
                value={form.baseline_end}
                required
                onChange={(event) => setForm((current) => ({ ...current, baseline_end: event.target.value }))}
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.causal.form.treatmentStart', 'Treatment start')}
                value={form.treatment_start}
                required
                onChange={(event) => setForm((current) => ({ ...current, treatment_start: event.target.value }))}
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.causal.form.treatmentEnd', 'Treatment end')}
                value={form.treatment_end}
                required
                onChange={(event) => setForm((current) => ({ ...current, treatment_end: event.target.value }))}
              />
            </div>
            <Button
              type="submit"
              disabled={vehicleId == null || mutation.isPending}
              icon={<Beaker className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.causal.form.review', 'Review experiment')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <EvidencePanel
          quality={latest?.data_quality}
          evidence={latest?.evidence}
          limitations={latest?.limitations}
          unsupported={[
            t('advancedIntelligence.causal.unsupported.randomized', 'Randomized assignment or proof of causality'),
            t('advancedIntelligence.causal.unsupported.commands', 'Execution of the selected intervention'),
          ]}
        />
      </FadeIn>

      <ConfirmDialog
        open={confirmOpen}
        variant="warning"
        loading={mutation.isPending}
        title={t('advancedIntelligence.causal.confirm.title', 'Confirm experiment estimate')}
        message={t(
          'advancedIntelligence.causal.confirm.body',
          'This creates an observational estimate from the selected windows. It does not execute the intervention or prove causality.',
        )}
        confirmLabel={t('advancedIntelligence.causal.confirm.action', 'Create estimate')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={confirmExperiment}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageContainer>
  );
}
