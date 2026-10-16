import { type FormEvent, type MouseEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Gauge, ShieldCheck, Trash2, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useDeleteInsurancePolicy,
  useInsuranceRiskProfile,
  useUpsertInsurancePolicy,
} from '@/api/hooks/useOwnership';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  chartMargin,
} from '@/components/charts';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, Code, ConfirmDialog, DataTable, Icon, Input, Select, Text, Toggle, useSortToggle, IconButton } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { glassCardClasses, neonColorMap, typography } from '@/lib/tokens';

import type { InsurancePolicy, RiskFactor, RiskLever, UpsertInsurancePolicyRequest } from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
  VerdictBadge,
} from '../components';
import { OwnershipBrief } from '../components/operationalbrief-all/OwnershipBrief';
import { specialistDisplay } from '../components/operationalbrief-all/specialistDisplay';
import {
  formatCurrencyMinor,
  formatPct,
  formatSignedPct,
  fromDateInput,
  toDateInput,
} from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type PolicyForm = Omit<UpsertInsurancePolicyRequest, 'vehicle_id'>;

const EMPTY_POLICY: PolicyForm = {
  insurer: '',
  policy_ref: '',
  currency: 'USD',
  annual_premium_minor: 120000,
  deductible_minor: 50000,
  coverage_start: new Date().toISOString(),
  coverage_end: null,
  telematics_program: true,
  max_discount_pct: 30,
};

const WINDOW_OPTIONS = [30, 90, 180, 365];

export default function InsuranceTelematicsPage() {
  const { fmtScientificNumber, fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDate, formatDateTime, tz } = useDateFormat();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [formOpen, setFormOpen] = useState(false);
  const [formVehicleId, setFormVehicleId] = useState<number | null>(null);
  const [formSaved, setFormSaved] = useState(false);
  const editorInput = useRef<HTMLInputElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const editorGeneration = useRef(0);
  const submitting = useRef(false);
  const factorSort = useSortToggle();
  const leverSort = useSortToggle();
  const palette = useChartPalette();
  const gradientId = useId();

  usePageTitle(t('ownership.insurance.title', 'Insurance telematics studio'));

  const riskQuery = useInsuranceRiskProfile(vehicleId, windowDays);
  const { data } = riskQuery;
  const currentScope = useRef({ vehicleId, policyId: data?.policy?.id, revision: 0 });
  if (currentScope.current.vehicleId !== vehicleId) currentScope.current.revision += 1;
  currentScope.current.vehicleId = vehicleId;
  currentScope.current.policyId = data?.policy?.id;
  const upsert = useUpsertInsurancePolicy();
  const remove = useDeleteInsurancePolicy();
  const { confirm, dialogProps } = useConfirm();
  useEffect(() => {
    if (formOpen) editorInput.current?.focus();
  }, [formOpen]);
  useEffect(() => () => { editorGeneration.current += 1; }, []);

  const handleRemove = async (policy: InsurancePolicy) => {
    if (policy.vehicle_id !== vehicleId || remove.isPending) return;
    const revision = currentScope.current.revision;
    const ok = await confirm({
      title: t('ownership.insurance.delete.title', 'Delete this policy?'),
      message: t(
        'ownership.insurance.delete.message',
        'Policy “{{name}}” and its telematics program enrolment will be removed permanently. This cannot be undone.',
        { name: policy.policy_ref },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
    });
    if (ok && currentScope.current.revision === revision
      && currentScope.current.vehicleId === policy.vehicle_id
      && currentScope.current.policyId === policy.id) remove.mutate(policy.id);
  };

  const policy = data?.policy ?? null;
  const modelUnavailable = data?.quality?.status === 'insufficient';
  const modelReason = modelUnavailable
    ? [t('ownership.brief.notComputed', 'Not computed'),
        ...(data?.quality?.reasons?.length ? data.quality.reasons : [
          t('ownership.insurance.factors.empty', 'No factor had enough samples to score in this window.'),
        ])].join(' · ')
    : undefined;
  const modelValue = (rawValue: number | null | undefined) => ({
    rawValue: modelUnavailable ? null : rawValue,
    missingReason: modelReason,
  });
  const currency = policy?.currency ?? data?.premium?.currency ?? 'USD';
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const factors = useMemo(() => data?.factors ?? [], [data?.factors]);
  const levers = useMemo(() => data?.levers ?? [], [data?.levers]);
  const sortedFactors = useMemo(() => factorSort.sortFn(factors, (row, key) =>
    key === 'contribution' ? row.contribution_pct : row.score),
  [factors, factorSort.sortFn]);
  const sortedLevers = useMemo(() => {
    if (!leverSort.sortKey) return levers;
    return [...levers].sort((a, b) => {
      const av = a.projected_premium_save_minor;
      const bv = b.projected_premium_save_minor;
      if (av == null || !Number.isFinite(av)) return bv == null || !Number.isFinite(bv) ? 0 : 1;
      if (bv == null || !Number.isFinite(bv)) return -1;
      return leverSort.sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [levers, leverSort.sortKey, leverSort.sortDir]);
  const trend = useMemo(
    () =>
      (data?.trend ?? []).map((point) => ({
        ...point,
        label: formatDate(point.bucket_start),
      })),
    [data?.trend, formatDate],
  );

  const closeEditor = () => {
    editorGeneration.current += 1;
    setFormOpen(false);
    setForm({ ...EMPTY_POLICY });
    setFormSaved(false);
    setFormVehicleId(null);
    if (vehicleId === formVehicleId && !formSaved && editorTrigger.current?.isConnected) {
      editorTrigger.current.focus();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (formVehicleId == null || formVehicleId <= 0 || vehicleId !== formVehicleId
      || formSaved || upsert.isPending || submitting.current) return;
    submitting.current = true;
    const generation = editorGeneration.current;
    const revision = currentScope.current.revision;
    upsert.mutate(
      { ...form, vehicle_id: formVehicleId },
      {
        onSuccess: () => {
          if (editorGeneration.current !== generation) return;
          if (currentScope.current.revision === revision) closeEditor();
          else setFormSaved(true);
        },
        onSettled: () => {
          if (editorGeneration.current === generation) submitting.current = false;
        },
      },
    );
  };

  const editPolicy = (event: MouseEvent<HTMLButtonElement>) => {
    if (vehicleId == null || vehicleId <= 0 || formOpen || upsert.isPending) return;
    editorGeneration.current += 1;
    submitting.current = false;
    editorTrigger.current = event.currentTarget;
    setFormVehicleId(vehicleId);
    setFormSaved(false);
    if (policy && policy.vehicle_id === vehicleId) {
      setForm({
        insurer: policy.insurer,
        policy_ref: policy.policy_ref,
        currency: policy.currency,
        annual_premium_minor: policy.annual_premium_minor,
        deductible_minor: policy.deductible_minor,
        coverage_start: policy.coverage_start,
        coverage_end: policy.coverage_end,
        telematics_program: policy.telematics_program,
        max_discount_pct: policy.max_discount_pct,
      });
    } else setForm({ ...EMPTY_POLICY });
    setFormOpen(true);
  };

  const factorColumns: Column<RiskFactor>[] = [
    {
      key: 'label',
      header: t('ownership.insurance.factor.name', 'Underwriting factor'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.narrative}
          </Text>
        </div>
      ),
    },
    {
      key: 'observed',
      exportValue: (row) => row.observed_rate,
      align: 'right',
      header: t('ownership.insurance.factor.observed', 'Observed'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtScientificNumber(row.observed_rate, 3)}{' '}
          <span className="text-[var(--text-muted)]">{row.rate_unit}</span>
        </span>
      ),
    },
    {
      key: 'baseline',
      exportValue: (row) => row.baseline_rate,
      align: 'right',
      header: t('ownership.insurance.factor.baseline', 'Baseline'),
      render: (row) => <span className="tabular-nums">{fmtScientificNumber(row.baseline_rate, 3)}</span>,
    },
    {
      key: 'score',
      align: 'right',
      header: t('ownership.insurance.factor.score', 'Score'),
      render: (row) => (
        <span
          className={cn('tabular-nums',
            typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score === 0
              ? neonColorMap.neutral.text
              : row.score > 0 ? neonColorMap.amber.text : neonColorMap.green.text)}
        >
          {fmtScientificNumber(row.score, 3)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'weight',
      align: 'right',
      header: t('ownership.insurance.factor.weight', 'Weight'),
      render: (row) => <span className="tabular-nums">{formatPct(row.weight * 100)}</span>,
    },
    {
      key: 'contribution',
      exportValue: (row) => row.contribution_pct,
      align: 'right',
      header: t('ownership.insurance.factor.contribution', 'Contribution'),
      render: (row) => (
        <div className="min-w-28">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--text-secondary)]"
              style={{ width: `${Math.min(100, Math.max(0, row.contribution_pct))}%` }}
            />
          </div>
          <Text as="span" variant="caption" className="tabular-nums">
            {formatPct(row.contribution_pct)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'direction',
      header: t('ownership.insurance.factor.direction', 'Direction'),
      render: (row) => (
        <Text as="span" variant="caption">
          {row.direction === 'higher_is_worse'
            ? t('ownership.insurance.factor.worse', 'Higher is worse')
            : t('ownership.insurance.factor.better', 'Higher is better')}
        </Text>
      ),
    },
    {
      key: 'samples',
      exportValue: (row) => row.sample_count,
      align: 'right',
      header: t('ownership.insurance.factor.samples', 'Samples'),
      render: (row) => <span className="tabular-nums">{fmtInt(row.sample_count)}</span>,
    },
  ];

  const leverColumns: Column<RiskLever>[] = [
    {
      key: 'rank',
      exportValue: (row) => row.payoff_rank,
      align: 'right',
      header: t('ownership.insurance.lever.rank', 'Rank'),
      render: (row) => <span className="tabular-nums">#{row.payoff_rank}</span>,
    },
    {
      key: 'label',
      header: t('ownership.insurance.lever.label', 'Improvement lever'),
      render: (row) => <Text as="span" variant="label">{row.label}</Text>,
    },
    {
      key: 'target',
      exportValue: (row) => row.target_reduction_pct,
      align: 'right',
      header: t('ownership.insurance.lever.target', 'Target reduction'),
      render: (row) => <span className="tabular-nums">{formatPct(row.target_reduction_pct)}</span>,
    },
    {
      key: 'delta',
      exportValue: (row) => row.projected_score_delta,
      align: 'right',
      header: t('ownership.insurance.lever.delta', 'Risk score delta'),
      render: (row) => (
        <span className={cn('tabular-nums', neonColorMap.green.text)}>
          {formatSignedPct(-Math.abs(row.projected_score_delta))}
        </span>
      ),
    },
    {
      key: 'save',
      exportValue: (row) => row.projected_premium_save_minor,
      align: 'right',
      header: t('ownership.insurance.lever.save', 'Projected saving'),
      render: (row) => (
        <span className="tabular-nums">{money(row.projected_premium_save_minor)}</span>
      ),
      sortable: true,
    },
    {
      key: 'difficulty',
      header: t('ownership.insurance.lever.difficulty', 'Difficulty'),
      render: (row) => <VerdictBadge value={row.difficulty} dot={false} />,
    },
    {
      key: 'effort',
      exportValue: (row) => row.effort_hours_per_week,
      align: 'right',
      header: t('ownership.insurance.lever.effort', 'Effort'),
      render: (row) =>
        row.effort_hours_per_week != null
          ? t('ownership.insurance.lever.hours', '{{value}} h/week', {
              value: fmtNumber(row.effort_hours_per_week),
            })
          : '—',
    },
    {
      key: 'confidence',
      exportValue: (row) => row.confidence,
      align: 'right',
      header: t('ownership.insurance.lever.confidence', 'Confidence'),
      render: (row) => <span className="tabular-nums">{formatPct(row.confidence * 100)}</span>,
    },
  ];

  return (
    <PageLayout
      title={t('ownership.insurance.title', 'Insurance telematics studio')}
      subtitle={t(
        'ownership.insurance.subtitle',
        'Actuarial frequency × severity underwriting built from your own measured driving, with a premium simulation and ranked improvement levers.',
      )}
      query={riskQuery}
      contextActions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('ownership.window.label', 'Analysis window')}
            options={WINDOW_OPTIONS.map((days) => ({
              value: String(days),
              label: t('ownership.window.days', '{{count}} days', { count: days }),
            }))}
            value={String(windowDays)}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          />
        </div>
      }
    >
      <AlertBanner
        variant="info"
        title={t('ownership.insurance.notice.title', 'Modelled, not quoted')}
      >
        {t(
          'ownership.insurance.notice.body',
          'The premium simulation applies your policy’s own stated maximum telematics discount to a loss-cost index derived from measured exposure. It is an internal negotiation aid, never an insurer quote.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel
          title={t('ownership.insurance.summary.title', 'Underwriting position')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.summary.subtitle',
            'Exposure-normalised risk over the selected window.',
          )}
          empty={!data}
          preserveSummary
          emptyMessage={t(
            'ownership.insurance.summary.empty',
            'Select a vehicle to build an underwriting profile.',
          )}
          actions={modelUnavailable
            ? <Text variant="caption">{t('ownership.brief.notComputed', 'Not computed')}</Text>
            : data ? <VerdictBadge value={data.risk_grade} /> : undefined}
        >
          <OwnershipBrief
            title={t('ownership.insurance.brief.title', 'Modelled underwriting indices')}
            description={t('ownership.insurance.summary.subtitle', 'Exposure-normalised risk over the selected window.')}
            scope={<>{t('ownership.brief.window', 'Selected vehicle · {{count}}-day analysis window; coverage is described below', { count: windowDays })}{' · '}{tz}</>}
            source={riskQuery} enabled={vehicleId != null}
            window={data?.window}
            metrics={[
              {
                occurrenceId: 'score', metricId: 'score',
                label: t('ownership.insurance.stat.score', 'Risk score'),
                ...modelValue(data?.risk_score),
                display: specialistDisplay(fmtNumber),
                context: t('ownership.insurance.stat.scoreHint', '0 = best, 100 = worst'),
                tone:
                  (data?.risk_score ?? 0) >= 60
                    ? 'critical'
                    : (data?.risk_score ?? 0) >= 35
                      ? 'warning'
                      : 'positive',
              },
              {
                occurrenceId: 'frequency', metricId: 'ratio',
                label: t('ownership.insurance.stat.frequency', 'Frequency index'),
                ...modelValue(data?.frequency_index),
                display: specialistDisplay(fmtNumber),
                context: t('ownership.insurance.stat.frequencyHint', 'Expected claim count driver'),
              },
              {
                occurrenceId: 'severity', metricId: 'ratio',
                label: t('ownership.insurance.stat.severity', 'Severity index'),
                ...modelValue(data?.severity_index),
                display: specialistDisplay(fmtNumber),
                context: t('ownership.insurance.stat.severityHint', 'Expected claim size driver'),
              },
              {
                occurrenceId: 'losscost', metricId: 'ratio',
                label: t('ownership.insurance.stat.lossCost', 'Loss cost index'),
                ...modelValue(data?.loss_cost_index),
                display: specialistDisplay(fmtNumber),
                context: t(
                  'ownership.insurance.stat.lossCostHint',
                  'Frequency × severity, 1.0 = baseline',
                ),
                tone: 'accent',
              },
            ]}
          />
          <div className="mt-3">
            <OwnershipBrief
              title={t('ownership.insurance.exposureBrief.title', 'Recorded driving exposure')}
              description={t('ownership.insurance.summary.subtitle', 'Exposure-normalised risk over the selected window.')}
              scope={<>{t('ownership.brief.window', 'Selected vehicle · {{count}}-day analysis window; coverage is described below', { count: windowDays })}{' · '}{tz}</>}
              source={riskQuery} enabled={vehicleId != null}
              window={data?.window}
              metrics={[
                {
                  occurrenceId: 'exposure', metricId: 'distance',
                  label: t('ownership.insurance.stat.exposure', 'Exposure distance'),
                  rawValue: data?.exposure_distance_m,
                  display: specialistDisplay(units.formatDistance),
                  context: data?.drive_count == null ? '—' : t('ownership.insurance.stat.drives', '{{count}} drives', {
                    count: data.drive_count,
                  }),
                },
                {
                  occurrenceId: 'duration', metricId: 'duration',
                  label: t('ownership.insurance.stat.duration', 'Time behind the wheel'),
                  rawValue: data?.exposure_duration_s,
                  display: specialistDisplay(units.formatDuration),
                },
                {
                  occurrenceId: 'night', metricId: 'distance',
                  label: t('ownership.insurance.stat.overnightTripDistance', 'Distance of trips starting overnight (UTC)'),
                  rawValue: data?.night_distance_m,
                  display: specialistDisplay(units.formatDistance),
                  context: (
                    <>
                      {t('ownership.insurance.stat.overnightTripDistanceHint',
                        'Trip-start proxy: full distance of completed trips starting at or after 22:00 or before 05:00 UTC. Includes distance outside the band on qualifying trips and excludes distance inside the band on other trips; neither an upper nor a lower bound on actual night distance. Actual night-distance measurement requires owned model support for distance within time bands.')}
                      {data && data.exposure_distance_m > 0
                        ? <> · {formatPct((data.night_distance_m / data.exposure_distance_m) * 100)}</>
                        : null}
                    </>
                  ),
                },
                {
                  occurrenceId: 'percentile', metricId: 'percent',
                  label: t('ownership.insurance.stat.percentile', 'Peer percentile'),
                  rawValue: null,
                  missingReason: modelReason ?? t('ownership.brief.notComputed', 'Not computed'),
                  display: specialistDisplay(formatPct),
                },
              ]}
            />
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.insurance.premium.title', 'Premium simulation')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.premium.subtitle',
            'What the stored policy would cost if the telematics discount tracked the measured loss cost.',
          )}
          empty={!data?.premium}
          preserveSummary
          emptyMessage={t(
            'ownership.insurance.premium.empty',
            'Register a policy below to simulate a telematics-adjusted premium.',
          )}
          actions={
            <Button variant="secondary" size="sm" className="min-h-11 md:min-h-9" wrapLabel
              disabled={vehicleId == null || vehicleId <= 0 || formOpen || upsert.isPending} onClick={editPolicy}>
              {policy
                ? t('ownership.insurance.premium.edit', 'Edit policy')
                : t('ownership.insurance.premium.add', 'Add policy')}
            </Button>
          }
        >
          <OwnershipBrief
            title={t('ownership.insurance.premiumBrief.title', 'Policy-based premium model')}
            description={t('ownership.insurance.notice.body', 'The premium simulation applies your policy’s own stated maximum telematics discount to a loss-cost index derived from measured exposure. It is an internal negotiation aid, never an insurer quote.')}
            scope={<>{t('ownership.insurance.premiumBrief.scope', 'Stored policy and selected risk window; annual amounts retain the recorded currency')}{' · '}{tz}</>}
            source={riskQuery} enabled={vehicleId != null}
            window={data?.window}
            metrics={[
              {
                occurrenceId: 'baseline', metricId: 'currency',
                label: t('ownership.insurance.premium.baseline', 'Baseline annual premium'),
                rawValue: data?.premium?.baseline_premium_minor ?? policy?.annual_premium_minor,
                display: specialistDisplay(money),
              },
              {
                occurrenceId: 'modelled', metricId: 'currency',
                label: t('ownership.insurance.premium.modelled', 'Modelled annual premium'),
                ...modelValue(data?.premium?.modelled_premium_minor),
                display: specialistDisplay(money),
                tone: (data?.premium?.delta_minor ?? 0) <= 0 ? 'positive' : 'critical',
              },
              {
                occurrenceId: 'delta', metricId: 'currency',
                label: t('ownership.insurance.premium.delta', 'Difference'),
                ...modelValue(data?.premium?.delta_minor),
                display: specialistDisplay(money),
                context: modelUnavailable ? modelReason : formatSignedPct(data?.premium?.delta_pct),
                tone: (data?.premium?.delta_minor ?? 0) <= 0 ? 'positive' : 'critical',
              },
              {
                occurrenceId: 'discount', metricId: 'percent',
                label: t('ownership.insurance.premium.discount', 'Applied discount'),
                ...modelValue(data?.premium?.applied_discount_pct),
                display: specialistDisplay(formatPct),
                context: t('ownership.insurance.premium.cap', 'Cap {{value}}', {
                  value: formatPct(data?.premium?.max_discount_pct ?? policy?.max_discount_pct),
                }),
                tone: 'accent',
              },
            ]}
          />
          <div className="mt-3">
            <OwnershipBrief
              title={t('ownership.insurance.costBrief.title', 'Policy loss and distance costs')}
              description={t('ownership.insurance.costBrief.description', 'Expected loss is modelled; deductible and cost per 1000 m retain the policy denomination and fixed distance basis.')}
              scope={<>{t('ownership.insurance.premiumBrief.scope', 'Stored policy and selected risk window; annual amounts retain the recorded currency')}{' · '}{tz}</>}
              source={riskQuery} enabled={vehicleId != null}
              window={data?.window}
              metrics={[
                {
                  occurrenceId: 'expected', metricId: 'currency',
                  label: t('ownership.insurance.premium.expectedLoss', 'Expected annual loss'),
                  ...modelValue(data?.premium?.expected_loss_minor),
                  display: specialistDisplay(money),
                },
                {
                  occurrenceId: 'deductible', metricId: 'currency',
                  label: t('ownership.insurance.premium.deductible', 'Deductible'),
                  rawValue: data?.premium?.deductible_minor ?? policy?.deductible_minor,
                  display: specialistDisplay(money),
                },
                {
                  occurrenceId: 'perDistance', metricId: 'rate',
                  label: t('ownership.insurance.premium.perDistance', 'Cost per distance'),
                  ...modelValue(data?.premium?.cost_per_distance_minor_per_m),
                  display: specialistDisplay((raw) => `${money(raw * 1000)} / 1000 m`),
                },
              ]}
            />
          </div>
          {policy ? (
            <div className={cn(glassCardClasses.md, 'mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3')}>
              <div className="min-w-0">
                <Text as="p" variant="label" className="break-words">
                  {policy.insurer} · {policy.policy_ref}
                </Text>
                <Text as="p" variant="caption">
                  {t('ownership.insurance.policy.coverage', 'Coverage {{from}} → {{to}}', {
                    from: formatDate(policy.coverage_start),
                    to: policy.coverage_end
                      ? formatDate(policy.coverage_end)
                      : t('ownership.insurance.policy.openEnded', 'open-ended'),
                  })}{' · '}{tz}
                </Text>
              </div>
              {/* confirm-step: handleRemove asks in the shared ConfirmDialog before removing */}
              <IconButton icon={<Icon icon={Trash2} size="md" />} label={t('ownership.action.remove', 'Remove')} onClick={() => void handleRemove(policy)} busy={remove.isPending && remove.variables === policy.id} />
            </div>
          ) : null}
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      {formOpen ? (
        <FadeIn delay={0.05}>
          <OwnershipPanel
            title={t('ownership.insurance.form.title', 'Policy baseline')}
            description={t(
              'ownership.insurance.form.subtitle',
              'Money is entered in ISO-4217 minor units so no cent is lost to floating point.',
            )}
          >
            <Text as="p" variant="caption" className="mb-3">
              {t('vehiclePicker.fallbackName', 'Vehicle {{id}}', { id: formVehicleId })}
            </Text>
            {formSaved ? (
              <AlertBanner variant="info">{t('statusBar.background.saved', 'Changes saved')}</AlertBanner>
            ) : vehicleId !== formVehicleId ? (
              <AlertBanner variant="warning">
                {t('annotation.contextChanged', 'This form belongs to {{target}}. Return to that context to save, or cancel and open a new form.', {
                  target: t('vehiclePicker.fallbackName', 'Vehicle {{id}}', { id: formVehicleId }),
                })}
              </AlertBanner>
            ) : null}
            <form className="space-y-5" onSubmit={submit}>
              <fieldset disabled={upsert.isPending || formSaved} className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Input
                  ref={editorInput}
                  label={t('ownership.insurance.form.insurer', 'Insurer')}
                  value={form.insurer}
                  required
                  maxLength={160}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, insurer: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.insurance.form.ref', 'Policy reference')}
                  value={form.policy_ref}
                  required
                  maxLength={160}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, policy_ref: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.form.currency', 'ISO currency code')}
                  value={form.currency}
                  minLength={3}
                  maxLength={3}
                  required
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <MoneyInput
                  label={t('ownership.insurance.form.premium', 'Annual premium')}
                  value={form.annual_premium_minor}
                  currency={form.currency}
                  locale={units.unitPrefs.locale}
                  required
                  onChange={(value) =>
                    setForm((current) => ({ ...current, annual_premium_minor: value ?? 0 }))
                  }
                />
                <MoneyInput
                  label={t('ownership.insurance.form.deductible', 'Deductible')}
                  value={form.deductible_minor}
                  currency={form.currency}
                  locale={units.unitPrefs.locale}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, deductible_minor: value ?? 0 }))
                  }
                />
                <Input
                  type="number"
                  label={t('ownership.insurance.form.maxDiscount', 'Maximum telematics discount (%)')}
                  value={form.max_discount_pct}
                  min={0}
                  max={100}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      max_discount_pct: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="date"
                  label={t('ownership.insurance.form.start', 'Coverage start')}
                  value={toDateInput(form.coverage_start)}
                  required
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      coverage_start: fromDateInput(event.target.value),
                    }))
                  }
                />
                <Input
                  type="date"
                  label={t('ownership.insurance.form.end', 'Coverage end (optional)')}
                  value={toDateInput(form.coverage_end)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      coverage_end: event.target.value
                        ? fromDateInput(event.target.value)
                        : null,
                    }))
                  }
                />
                <div className="flex items-end">
                  <Toggle
                    label={t('ownership.insurance.form.telematics', 'Telematics programme enrolled')}
                    checked={form.telematics_program}
                    onChange={(checked) =>
                      setForm((current) => ({ ...current, telematics_program: checked }))
                    }
                  />
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={upsert.isPending}
                  disabled={vehicleId !== formVehicleId || formVehicleId == null || formSaved || upsert.isPending}
                  className="min-h-11 md:min-h-9"
                  wrapLabel
                  icon={<Icon icon={ShieldCheck} size="md" />}
                >
                  {t('ownership.insurance.form.save', 'Save policy baseline')}
                </Button>
                <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" wrapLabel
                  disabled={upsert.isPending} onClick={closeEditor}>
                  {formSaved ? t('common.close', 'Close') : t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
            </form>
            <MutationError error={upsert.error} />
          </OwnershipPanel>
        </FadeIn>
      ) : null}

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.insurance.trend.title', 'Risk trajectory')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.trend.subtitle',
            'Rolling risk score and loss cost across the window — a rising line means underwriting exposure is growing.',
          )}
          empty={modelUnavailable || trend.length === 0}
          emptyMessage={modelReason ?? t(
            'ownership.insurance.trend.empty',
            'At least two buckets of driving are needed to plot a trajectory.',
          )}
        >
          <ChartContainer
            height={280}
            title={t('ownership.insurance.trend.chart', 'Rolling risk score')}
            metadata={{
              rangeLabel: data?.window
                ? `${formatDateTime(data.window.from)} → ${formatDateTime(data.window.to)} · ${tz}`
                : tz,
            }}
            ariaLabel={t(
              'ownership.insurance.trend.chartAria',
              'Area chart of rolling insurance risk score over the analysis window',
            )}
            data={trend}
            dataColumns={[
              { key: 'label', label: t('ownership.insurance.trend.col.bucket', 'Period') },
              {
                key: 'risk_score',
                label: t('ownership.insurance.trend.score', 'Risk score'),
                format: (v) => fmtNumber(v as number),
              },
              { key: 'loss_cost_index', label: t('ownership.insurance.stat.lossCost', 'Loss cost index') },
              {
                key: 'distance_m',
                label: t('ownership.insurance.stat.exposure', 'Exposure distance'),
                format: (value) => typeof value === 'number' ? units.formatDistance(value) : '—',
              },
              { key: 'drive_count', label: t('milestones.chart.driveCount', 'Drive count') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={chartMargin}>
                <defs>
                  <ChartGradient id={gradientId} color={palette[0]} opacity={0.08} />
                </defs>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" tick={axisTick} />
                <YAxis tick={axisTick} domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="risk_score"
                  name={t('ownership.insurance.trend.score', 'Risk score')}
                  stroke={palette[0]}
                  fill={`url(#${gradientId})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.insurance.factors.title', 'Factor decomposition')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.factors.subtitle',
            'Every weighted signal behind the score, with the baseline it was measured against.',
          )}
          empty={modelUnavailable || factors.length === 0}
          emptyMessage={modelReason ?? t(
            'ownership.insurance.factors.empty',
            'No factor had enough samples to score in this window.',
          )}
          actions={<Icon icon={Gauge} size="md" className={typography.color.muted} />}
        >
          <DataTable
            columns={factorColumns}
            variant="embedded"
            data={sortedFactors}
            sortKey={factorSort.sortKey}
            sortDir={factorSort.sortDir}
            onSort={factorSort.onSort}
            keyExtractor={(row) => row.code}
            tableId="ownership-insurance-factors"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.insurance.levers.title', 'Ranked improvement levers')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.levers.subtitle',
            'What each behavioural change is worth, ordered by payoff per unit of effort.',
          )}
          empty={modelUnavailable || levers.length === 0}
          emptyMessage={modelReason ?? t(
            'ownership.insurance.levers.empty',
            'No lever produced a material saving at the current score.',
          )}
          actions={<Icon icon={TrendingDown} size="md" className={typography.color.muted} />}
        >
          <DataTable
            columns={leverColumns}
            variant="embedded"
            data={sortedLevers}
            sortKey={leverSort.sortKey}
            sortDir={leverSort.sortDir}
            onSort={leverSort.onSort}
            keyExtractor={(row) => row.factor_code}
            tableId="ownership-insurance-levers"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel
          title={t('ownership.insurance.checksum.title', 'Risk-summary checksum')}
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.insurance.checksum.subtitle',
            'A limited SHA-256 checksum of the vehicle ID, window bounds, risk score, frequency, severity and loss-cost indices, and ordered factor codes and observed rates at fixed precision. It does not verify identity or hash the complete evidence packet: raw exposure, other factor details, policy, premium, trend and evidence are not included. Matching checksums do not establish that the complete datasets are identical.',
          )}
          empty={!data?.evidence_packet_hash}
          emptyMessage={t(
            'ownership.insurance.checksum.empty',
            'A risk-summary checksum is produced once a profile has been computed.',
          )}
        >
          <div className={glassCardClasses.md}>
            <Text as="p" variant="caption">
              {t('ownership.insurance.checksum.hash', 'Limited risk-summary checksum (SHA-256)')}
            </Text>
            <Code as="p" className="mt-1 break-all">
              {data?.evidence_packet_hash}
            </Code>
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          source={riskQuery}
          sourceEnabled={vehicleId != null}
          quality={data?.quality}
          evidence={data?.evidence}
          unsupported={[
            t(
              'ownership.insurance.unsupported.quote',
              'Binding quotes, carrier acceptance, or regulatory rate approval',
            ),
            t(
              'ownership.insurance.unsupported.claims',
              'Actual claim history — the model uses driving exposure only',
            ),
          ]}
        />
      </FadeIn>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
