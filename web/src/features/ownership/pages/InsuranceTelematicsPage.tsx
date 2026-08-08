import { type FormEvent, useMemo, useState } from 'react';
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
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, DataTable, Input, Select, Text, Toggle } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { RiskFactor, RiskLever, UpsertInsurancePolicyRequest } from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
  StatGrid,
  VerdictBadge,
} from '../components';
import {
  formatCurrencyMinor,
  formatPct,
  formatSignedPct,
  fromDateInput,
  toDateInput,
} from '../formatters';

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
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [formOpen, setFormOpen] = useState(false);

  usePageTitle(t('ownership.insurance.title', 'Insurance Telematics Studio'));

  const { data, isLoading, error } = useInsuranceRiskProfile(vehicleId, windowDays);
  const upsert = useUpsertInsurancePolicy();
  const remove = useDeleteInsurancePolicy();

  const policy = data?.policy ?? null;
  const currency = policy?.currency ?? data?.premium?.currency ?? 'USD';
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const factors = useMemo(() => data?.factors ?? [], [data?.factors]);
  const levers = useMemo(() => data?.levers ?? [], [data?.levers]);
  const trend = useMemo(
    () =>
      (data?.trend ?? []).map((point) => ({
        ...point,
        label: formatDate(point.bucket_start),
      })),
    [data?.trend],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    upsert.mutate(
      { ...form, vehicle_id: vehicleId },
      { onSuccess: () => setFormOpen(false) },
    );
  };

  const editPolicy = () => {
    if (policy) {
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
    }
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
      header: t('ownership.insurance.factor.observed', 'Observed'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.observed_rate, 3)}{' '}
          <span className="text-[var(--text-muted)]">{row.rate_unit}</span>
        </span>
      ),
    },
    {
      key: 'baseline',
      header: t('ownership.insurance.factor.baseline', 'Baseline'),
      render: (row) => <span className="tabular-nums">{fmtNumber(row.baseline_rate, 3)}</span>,
    },
    {
      key: 'score',
      header: t('ownership.insurance.factor.score', 'Score'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.score >= 60 ? 'text-rose-300' : row.score >= 35 ? 'text-amber-300' : 'text-emerald-300'}`}
        >
          {fmtNumber(row.score, 1)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'weight',
      header: t('ownership.insurance.factor.weight', 'Weight'),
      render: (row) => <span className="tabular-nums">{formatPct(row.weight * 100, 0)}</span>,
    },
    {
      key: 'contribution',
      header: t('ownership.insurance.factor.contribution', 'Contribution'),
      render: (row) => (
        <div className="min-w-[7rem]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-cyan-400/70"
              style={{ width: `${Math.min(100, Math.max(0, row.contribution_pct))}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {formatPct(row.contribution_pct)}
          </span>
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
      header: t('ownership.insurance.factor.samples', 'Samples'),
      render: (row) => <span className="tabular-nums">{fmtNumber(row.sample_count, 0)}</span>,
    },
  ];

  const leverColumns: Column<RiskLever>[] = [
    {
      key: 'rank',
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
      header: t('ownership.insurance.lever.target', 'Target reduction'),
      render: (row) => <span className="tabular-nums">{formatPct(row.target_reduction_pct)}</span>,
    },
    {
      key: 'delta',
      header: t('ownership.insurance.lever.delta', 'Risk score delta'),
      render: (row) => (
        <span className="tabular-nums text-emerald-300">
          {formatSignedPct(-Math.abs(row.projected_score_delta))}
        </span>
      ),
    },
    {
      key: 'save',
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
      header: t('ownership.insurance.lever.effort', 'Effort'),
      render: (row) =>
        row.effort_hours_per_week != null
          ? t('ownership.insurance.lever.hours', '{{value}} h/week', {
              value: fmtNumber(row.effort_hours_per_week, 1),
            })
          : '—',
    },
    {
      key: 'confidence',
      header: t('ownership.insurance.lever.confidence', 'Confidence'),
      render: (row) => <span className="tabular-nums">{formatPct(row.confidence)}</span>,
    },
  ];

  return (
    <PageContainer
      title={t('ownership.insurance.title', 'Insurance Telematics Studio')}
      subtitle={t(
        'ownership.insurance.subtitle',
        'Actuarial frequency × severity underwriting built from your own measured driving, with a premium simulation and ranked improvement levers.',
      )}
      loading={isLoading}
      error={error as Error | null}
      actions={
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
          <VehicleSelect withIcon />
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
          description={t(
            'ownership.insurance.summary.subtitle',
            'Exposure-normalised risk over the selected window.',
          )}
          empty={!data}
          emptyMessage={t(
            'ownership.insurance.summary.empty',
            'Select a vehicle to build an underwriting profile.',
          )}
          actions={data ? <VerdictBadge value={data.risk_grade} /> : undefined}
        >
          <StatGrid
            stats={[
              {
                key: 'score',
                label: t('ownership.insurance.stat.score', 'Risk score'),
                value: fmtNumber(data?.risk_score ?? 0, 1),
                hint: t('ownership.insurance.stat.scoreHint', '0 = best, 100 = worst'),
                tone:
                  (data?.risk_score ?? 0) >= 60
                    ? 'critical'
                    : (data?.risk_score ?? 0) >= 35
                      ? 'warning'
                      : 'positive',
              },
              {
                key: 'frequency',
                label: t('ownership.insurance.stat.frequency', 'Frequency index'),
                value: fmtNumber(data?.frequency_index ?? 0, 2),
                hint: t('ownership.insurance.stat.frequencyHint', 'Expected claim count driver'),
              },
              {
                key: 'severity',
                label: t('ownership.insurance.stat.severity', 'Severity index'),
                value: fmtNumber(data?.severity_index ?? 0, 2),
                hint: t('ownership.insurance.stat.severityHint', 'Expected claim size driver'),
              },
              {
                key: 'losscost',
                label: t('ownership.insurance.stat.lossCost', 'Loss cost index'),
                value: fmtNumber(data?.loss_cost_index ?? 0, 2),
                hint: t(
                  'ownership.insurance.stat.lossCostHint',
                  'Frequency × severity, 1.0 = baseline',
                ),
                tone: 'accent',
              },
            ]}
          />
          <div className="mt-3">
            <StatGrid
              columns={4}
              stats={[
                {
                  key: 'exposure',
                  label: t('ownership.insurance.stat.exposure', 'Exposure distance'),
                  value: units.formatDistance(data?.exposure_distance_m ?? 0),
                  hint: t('ownership.insurance.stat.drives', '{{count}} drives', {
                    count: data?.drive_count ?? 0,
                  }),
                },
                {
                  key: 'duration',
                  label: t('ownership.insurance.stat.duration', 'Time behind the wheel'),
                  value: units.formatDuration(data?.exposure_duration_s ?? 0),
                },
                {
                  key: 'night',
                  label: t('ownership.insurance.stat.night', 'Night distance'),
                  value: units.formatDistance(data?.night_distance_m ?? 0),
                  hint:
                    data && data.exposure_distance_m > 0
                      ? formatPct((data.night_distance_m / data.exposure_distance_m) * 100)
                      : undefined,
                },
                {
                  key: 'percentile',
                  label: t('ownership.insurance.stat.percentile', 'Peer percentile'),
                  value: formatPct(data?.peer_percentile),
                  hint: t(
                    'ownership.insurance.stat.percentileHint',
                    'Against your own history distribution',
                  ),
                },
              ]}
            />
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.insurance.premium.title', 'Premium simulation')}
          description={t(
            'ownership.insurance.premium.subtitle',
            'What the stored policy would cost if the telematics discount tracked the measured loss cost.',
          )}
          empty={!data?.premium}
          emptyMessage={t(
            'ownership.insurance.premium.empty',
            'Register a policy below to simulate a telematics-adjusted premium.',
          )}
          actions={
            <Button variant="secondary" size="sm" onClick={editPolicy}>
              {policy
                ? t('ownership.insurance.premium.edit', 'Edit policy')
                : t('ownership.insurance.premium.add', 'Add policy')}
            </Button>
          }
        >
          <StatGrid
            columns={4}
            stats={[
              {
                key: 'baseline',
                label: t('ownership.insurance.premium.baseline', 'Baseline annual premium'),
                value: money(data?.premium?.baseline_premium_minor),
              },
              {
                key: 'modelled',
                label: t('ownership.insurance.premium.modelled', 'Modelled annual premium'),
                value: money(data?.premium?.modelled_premium_minor),
                tone: (data?.premium?.delta_minor ?? 0) <= 0 ? 'positive' : 'critical',
              },
              {
                key: 'delta',
                label: t('ownership.insurance.premium.delta', 'Difference'),
                value: money(data?.premium?.delta_minor),
                hint: formatSignedPct(data?.premium?.delta_pct),
                tone: (data?.premium?.delta_minor ?? 0) <= 0 ? 'positive' : 'critical',
              },
              {
                key: 'discount',
                label: t('ownership.insurance.premium.discount', 'Applied discount'),
                value: formatPct(data?.premium?.applied_discount_pct),
                hint: t('ownership.insurance.premium.cap', 'Cap {{value}}', {
                  value: formatPct(data?.premium?.max_discount_pct),
                }),
                tone: 'accent',
              },
            ]}
          />
          <div className="mt-3">
            <StatGrid
              columns={3}
              stats={[
                {
                  key: 'expected',
                  label: t('ownership.insurance.premium.expectedLoss', 'Expected annual loss'),
                  value: money(data?.premium?.expected_loss_minor),
                },
                {
                  key: 'deductible',
                  label: t('ownership.insurance.premium.deductible', 'Deductible'),
                  value: money(data?.premium?.deductible_minor),
                },
                {
                  key: 'perDistance',
                  label: t('ownership.insurance.premium.perDistance', 'Cost per distance'),
                  value:
                    data?.premium?.cost_per_distance_minor_per_m != null
                      ? `${money(data.premium.cost_per_distance_minor_per_m * 1000)} / 1000 m`
                      : '—',
                },
              ]}
            />
          </div>
          {policy ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              <div>
                <Text as="p" variant="label">
                  {policy.insurer} · {policy.policy_ref}
                </Text>
                <Text as="p" variant="caption">
                  {t('ownership.insurance.policy.coverage', 'Coverage {{from}} → {{to}}', {
                    from: formatDate(policy.coverage_start),
                    to: policy.coverage_end
                      ? formatDate(policy.coverage_end)
                      : t('ownership.insurance.policy.openEnded', 'open-ended'),
                  })}
                </Text>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={remove.isPending}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => remove.mutate(policy.id)}
              >
                {t('ownership.action.remove', 'Remove')}
              </Button>
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
            <form className="space-y-5" onSubmit={submit}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Input
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
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={upsert.isPending}
                  disabled={vehicleId == null || upsert.isPending}
                  icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('ownership.insurance.form.save', 'Save policy baseline')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                  {t('ownership.action.cancel', 'Cancel')}
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
          description={t(
            'ownership.insurance.trend.subtitle',
            'Rolling risk score and loss cost across the window — a rising line means underwriting exposure is growing.',
          )}
          empty={trend.length === 0}
          emptyMessage={t(
            'ownership.insurance.trend.empty',
            'At least two buckets of driving are needed to plot a trajectory.',
          )}
        >
          <ChartContainer
            height={280}
            title={t('ownership.insurance.trend.chart', 'Rolling risk score')}
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
                format: (v) => fmtNumber(v as number, 1),
              },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={chartMargin}>
                <defs>
                  <linearGradient id="insuranceRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" tick={axisTick} />
                <YAxis tick={axisTick} domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="risk_score"
                  name={t('ownership.insurance.trend.score', 'Risk score')}
                  stroke="#22d3ee"
                  fill="url(#insuranceRisk)"
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
          description={t(
            'ownership.insurance.factors.subtitle',
            'Every weighted signal behind the score, with the baseline it was measured against.',
          )}
          empty={factors.length === 0}
          emptyMessage={t(
            'ownership.insurance.factors.empty',
            'No factor had enough samples to score in this window.',
          )}
          actions={<Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
        >
          <DataTable
            columns={factorColumns}
            data={factors}
            keyExtractor={(row) => row.code}
            tableId="ownership-insurance-factors"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.insurance.levers.title', 'Ranked improvement levers')}
          description={t(
            'ownership.insurance.levers.subtitle',
            'What each behavioural change is worth, ordered by payoff per unit of effort.',
          )}
          empty={levers.length === 0}
          emptyMessage={t(
            'ownership.insurance.levers.empty',
            'No lever produced a material saving at the current score.',
          )}
          actions={<TrendingDown className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
        >
          <DataTable
            columns={leverColumns}
            data={levers}
            keyExtractor={(row) => row.factor_code}
            tableId="ownership-insurance-levers"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel
          title={t('ownership.insurance.packet.title', 'Insurer evidence packet')}
          description={t(
            'ownership.insurance.packet.subtitle',
            'A stable content hash over the exposure, factors, and window. Quote it when disputing a rating so both sides know they are looking at the same dataset.',
          )}
          empty={!data?.evidence_packet_hash}
          emptyMessage={t(
            'ownership.insurance.packet.empty',
            'A packet hash is produced once a profile has been computed.',
          )}
        >
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <Text as="p" variant="caption">
              {t('ownership.insurance.packet.hash', 'SHA-256 content digest')}
            </Text>
            <p className="mt-1 break-all font-mono text-sm text-cyan-300">
              {data?.evidence_packet_hash}
            </p>
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
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
    </PageContainer>
  );
}
