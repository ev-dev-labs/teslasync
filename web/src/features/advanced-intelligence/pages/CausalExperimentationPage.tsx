import { type FormEvent, useRef, useState } from 'react';
import { Beaker, GitCommitHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCausalExperiments,
  useCreateCausalExperiment,
} from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { KVList, StatGroup, type StatMetric } from '@/components/data-display';
import { PageLayout, SourceContent } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, ConfirmDialog, Icon, Input, Pagination, Select, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { toLocalDatetimeStr } from '@/lib/dateFormat';
import { typography } from '@/lib/tokens';

import type {
  CausalExperiment,
  CausalMetric,
  CreateCausalExperimentRequest,
} from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError } from '../components';
import { formatEfficiencyFromSI } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const PAGE_SIZE = 10;
type ExperimentForm = Omit<CreateCausalExperimentRequest, 'vehicle_id' | 'confirmed'>;
const windowFields = ['baseline_start', 'baseline_end', 'treatment_start', 'treatment_end'] as const;
const windowLabels = ['baselineStart', 'baselineEnd', 'treatmentStart', 'treatmentEnd'] as const;
const windowDefaults = ['Baseline start', 'Baseline end', 'Treatment start', 'Treatment end'] as const;

function isoLocal(daysAgo: number): string {
  // datetime-local values are local wall-clock: build the default from local
  // fields, not a UTC slice (SmartCharge defaultDepartBy precedent).
  return toLocalDatetimeStr(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)).slice(0, 16);
}

export default function CausalExperimentationPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const { formatDateTime, tz } = useDateFormat();
  const units = useUnits();
  const [pagination, setPagination] = useState({ vehicleId, page: 1 });
  const page = pagination.vehicleId === vehicleId ? pagination.page : 1;
  if (pagination.vehicleId !== vehicleId) setPagination({ vehicleId, page: 1 });
  const setPage = (next: number) => setPagination({ vehicleId, page: next });
  const [review, setReview] = useState<CreateCausalExperimentRequest | null>(null);
  const [invalidWindows, setInvalidWindows] = useState(false);
  const submitting = useRef(false);
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
  const experiments = query.isPlaceholderData ? [] : (query.data?.items ?? []).filter((item) => item.vehicle_id === vehicleId);
  const latest = experiments[0] ?? (mutation.data?.vehicle_id === vehicleId ? mutation.data : null);
  const historyState = useDataState(query.isPlaceholderData ? { ...query, data: undefined } : query);
  const unsupported = [
    t('advancedIntelligence.causal.unsupported.randomized', 'Randomized assignment or proof of causality'),
    t('advancedIntelligence.causal.unsupported.commands', 'Execution of the selected intervention'),
  ];
  if (query.isSuccess && !query.isPlaceholderData && query.data?.offset === (page - 1) * PAGE_SIZE) {
    const lastPage = Math.max(1, Math.ceil(query.data.total / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }
  usePageTitle(t('advancedIntelligence.causal.title', 'Causal experimentation'));

  const formatEfficiency = (value: number | null) => {
    return formatEfficiencyFromSI(value, units.unitPrefs);
  };

  const interventions = [
    { value: 'charging_schedule', label: t('advancedIntelligence.causal.intervention.charging', 'Charging schedule') },
    { value: 'tire_service', label: t('advancedIntelligence.causal.intervention.tires', 'Tire service') },
    { value: 'software_update', label: t('advancedIntelligence.causal.intervention.software', 'Software update') },
    { value: 'climate_preconditioning', label: t('advancedIntelligence.causal.intervention.climate', 'Climate preconditioning') },
    { value: 'driving_policy', label: t('advancedIntelligence.causal.intervention.driving', 'Driving policy') },
  ];
  const metrics = [
    { value: 'drive_energy_wh_per_m', label: t('advancedIntelligence.causal.metric.energy', 'Drive energy efficiency') },
    { value: 'charging_success_pct', label: t('advancedIntelligence.causal.metric.charging', 'Charging success') },
    { value: 'average_speed_mps', label: t('advancedIntelligence.causal.metric.speed', 'Average speed') },
  ];
  const labelFor = (options: typeof interventions, value: string) => options.find((option) => option.value === value)?.label ?? value;
  const historyMetrics = (item: CausalExperiment): StatMetric[] => {
    const metricId = item.metric === 'drive_energy_wh_per_m' ? 'efficiency' : item.metric === 'average_speed_mps' ? 'speed' : 'percent';
    return [
      ...(['baseline', 'treatment', 'effect'] as const).map((phase): StatMetric => ({
        metricId, occurrenceId: phase,
        rawValue: metricId === 'efficiency' ? item[`${phase}_energy_wh_per_m`]
          : metricId === 'speed' ? item[`${phase}_speed_mps`] : item[`${phase}_success_pct`],
        label: t(`advancedIntelligence.causal.${phase}`, phase === 'baseline' ? 'Baseline' : phase === 'treatment' ? 'Treatment' : 'Estimated effect'),
        description: labelFor(metrics, item.metric),
        context: phase !== 'effect' ? t('advancedIntelligence.causal.samples', '{{count}} samples', {
          count: item[`${phase}_sample_count`],
        }) : undefined,
        display: { formatter: (value) => ({
          value: metricId === 'efficiency' ? formatEfficiency(value) : metricId === 'speed' ? units.formatSpeed(value)
            : phase === 'effect' ? `${fmtNumber(value)} ${t('drives.grid.percentagePoints', 'percentage points')}` : fmtNumber(value),
          unit: metricId === 'percent' && phase !== 'effect' ? '%' : '',
        }) },
      })),
      { metricId: 'percent', rawValue: item.confounder_coverage_pct,
        label: t('advancedIntelligence.causal.confounders', 'Confounder coverage'),
        description: t('advancedIntelligence.causal.confounders', 'Confounder coverage') },
    ];
  };

  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null || mutation.isPending || submitting.current) return;
    const instants = windowFields.map((field) => new Date(form[field]).getTime());
    const [baselineStart, baselineEnd, treatmentStart, treatmentEnd] = instants;
    const day = 24 * 60 * 60 * 1000;
    const invalid = instants.some((instant) => !Number.isFinite(instant))
      || baselineEnd - baselineStart < day || baselineEnd - baselineStart > 365 * day
      || treatmentEnd - treatmentStart < day || treatmentEnd - treatmentStart > 365 * day
      || treatmentStart < baselineEnd || treatmentEnd > Date.now() + 60 * 1000;
    setInvalidWindows(invalid);
    if (invalid) {
      event.currentTarget.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.focus();
      return;
    }
    mutation.reset();
    setReview({ ...form, vehicle_id: vehicleId, confirmed: true,
      baseline_start: new Date(baselineStart).toISOString(), baseline_end: new Date(baselineEnd).toISOString(),
      treatment_start: new Date(treatmentStart).toISOString(), treatment_end: new Date(treatmentEnd).toISOString() });
  };

  const confirmExperiment = () => {
    if (!review || review.vehicle_id !== vehicleId || mutation.isPending || submitting.current) return;
    submitting.current = true;
    mutation.mutate(review, {
      onSuccess: () => setReview(null),
      onSettled: () => { submitting.current = false; },
    });
  };

  return (
    <PageLayout
      title={t('advancedIntelligence.causal.title', 'Causal experimentation')}
      subtitle={t(
        'advancedIntelligence.causal.subtitle',
        'Compare explicit baseline and treatment windows with confounder coverage disclosure.',
      )}
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
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.causal.history.title', 'Experiment history')}
          empty={experiments.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.causal.history.empty', 'No causal experiments have been recorded.')}
        >
          <div className="space-y-4">
            {experiments.map((item) => (
              <article key={item.id} className="min-w-0 rounded-panel border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Icon icon={GitCommitHorizontal} size="lg" className={typography.color.secondary} aria-hidden={true} />
                    <div className="min-w-0 break-words">
                      <Text as="h3" variant="subhead">{labelFor(interventions, item.intervention_kind)}</Text>
                      <Text as="p" variant="caption">{labelFor(metrics, item.metric)} · {formatDateTime(item.updated_at)}</Text>
                    </div>
                  </div>
                  <Badge variant={item.state === 'estimated' ? 'info' : item.state === 'insufficient' || item.state === 'non_causal' ? 'warning' : 'neutral'}>{item.state}</Badge>
                </div>
                <StatGroup metrics={historyMetrics(item)} className="mt-4"
                  period={{ kind: 'unknown', label: formatDateTime(item.updated_at) }}
                />
              </article>
            ))}
          </div>
        </InsightPanel>
        {(query.data?.total ?? 0) > PAGE_SIZE ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onPageChange={setPage} />
        ) : null}
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
                id="causal-intervention"
                className="min-h-11 md:min-h-10"
                label={t('advancedIntelligence.causal.form.intervention', 'Intervention')}
                value={form.intervention_kind}
                options={interventions}
                onChange={(event) => setForm((current) => ({
                  ...current, intervention_kind: event.target.value,
                }))}
              />
              <Select
                id="causal-metric"
                className="min-h-11 md:min-h-10"
                label={t('advancedIntelligence.causal.form.metric', 'Metric')}
                value={form.metric}
                options={metrics}
                onChange={(event) => setForm((current) => ({
                  ...current, metric: event.target.value as CausalMetric,
                }))}
              />
              {windowFields.map((field, index) => <Input key={field} id={`causal-${field}`}
                className="min-h-11 md:min-h-10" type="datetime-local"
                label={t(`advancedIntelligence.causal.form.${windowLabels[index]}`, windowDefaults[index])}
                value={form[field]} required
                hint={t('advancedIntelligence.causal.form.subtitle', 'Windows must be ordered, non-overlapping, at least 24 hours, and already observed.')}
                error={invalidWindows ? t('advancedIntelligence.causal.form.subtitle', 'Windows must be ordered, non-overlapping, at least 24 hours, and already observed.') : undefined}
                onChange={(event) => { setInvalidWindows(false); setForm((current) => ({ ...current, [field]: event.target.value })); }}
              />)}
            </div>
            <Button
              type="submit"
              className="min-h-11 md:min-h-10"
              disabled={vehicleId == null || mutation.isPending}
              icon={<Icon icon={Beaker} aria-hidden={true} />}
            >
              {t('advancedIntelligence.causal.form.review', 'Review experiment')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        {latest && <Text as="p" variant="caption" className="break-words">
          {t('common.vehicle', 'Vehicle')} {fmtNumber(latest.vehicle_id, 0)} · #{latest.id} · {labelFor(interventions, latest.intervention_kind)} · {formatDateTime(latest.updated_at)}
        </Text>}
        {latest ? <>
          {experiments.length > 0 && historyState.status === 'stale' && <StaleRefreshWarning state={historyState}
            label={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')} />}
          <EvidencePanel
          quality={latest?.data_quality}
          evidence={latest?.evidence}
          limitations={latest?.limitations}
          unsupported={unsupported}
        />
        </> : <InsightPanel title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          description={t('advancedIntelligence.evidence.subtitle', 'Supported observations are separated from assumptions and unsupported fields.')}>
          <div className="grid min-w-0 gap-5 break-words lg:grid-cols-3">
            {[
              t('advancedIntelligence.quality.title', 'Data quality'),
              t('advancedIntelligence.evidence.sources', 'Evidence sources'),
              t('advancedIntelligence.limitations.title', 'Limitations'),
            ].map((label, index) => <section key={index} aria-label={label} className="min-w-0 space-y-3">
              <Text as="h3" variant="label">{label}</Text>
              <SourceContent label={label}
                emptyMessage={t('advancedIntelligence.causal.history.empty', 'No causal experiments have been recorded.')}
                state={vehicleId == null ? 'empty' : historyState.fatalError ? 'error'
                  : query.isLoading || query.fetchStatus === 'fetching' ? 'loading' : 'empty'}
                error={historyState.fatalError} errorRecovery={{ onRetry: historyState.retry ?? undefined }}
                errorMessage={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
                emptyContent={<Text as="p" variant="bodySm">{vehicleId == null
                  ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
                  : query.isSuccess && !query.isPlaceholderData
                    ? t('advancedIntelligence.causal.history.empty', 'No causal experiments have been recorded.')
                    : query.fetchStatus === 'paused'
                      ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
                      : t('advancedIntelligence.panel.unresolved', 'Evidence availability has not resolved yet.')}</Text>}>
                {null}
              </SourceContent>
              {index === 2 && <div className="space-y-2">
                <Text as="p" variant="label">{t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}</Text>
                {unsupported.map((item) => <Text as="p" variant="caption" key={item}>{item}</Text>)}
              </div>}
            </section>)}
          </div>
        </InsightPanel>}
      </FadeIn>

      <ConfirmDialog
        open={review !== null}
        variant="warning"
        loading={mutation.isPending}
        confirmDisabled={review?.vehicle_id !== vehicleId}
        title={t('advancedIntelligence.causal.confirm.title', 'Confirm experiment estimate')}
        message={t(
          'advancedIntelligence.causal.confirm.body',
          'This creates an observational estimate from the selected windows. It does not execute the intervention or prove causality.',
        )}
        confirmLabel={t('advancedIntelligence.causal.confirm.action', 'Create estimate')}
        cancelLabel={t('common.cancel', 'Cancel')}
        details={<div className="min-w-0 space-y-4">
          {review && <KVList wrap layout="vertical" items={[
            { label: t('common.vehicle', 'Vehicle'), value: fmtNumber(review.vehicle_id, 0) },
            { label: t('advancedIntelligence.causal.form.intervention', 'Intervention'), value: labelFor(interventions, review.intervention_kind) },
            { label: t('advancedIntelligence.causal.form.metric', 'Metric'), value: labelFor(metrics, review.metric) },
            ...windowFields.map((field, index) => ({
              label: t(`advancedIntelligence.causal.form.${windowLabels[index]}`, windowDefaults[index]),
              value: `${formatDateTime(review[field])} · ${tz}`,
            })),
          ]} />}
          <MutationError error={mutation.error} />
        </div>}
        onConfirm={confirmExperiment}
        onCancel={() => { if (!mutation.isPending && !submitting.current) setReview(null); }}
      />
    </PageLayout>
  );
}
