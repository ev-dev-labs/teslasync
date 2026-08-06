import { type FormEvent, useMemo, useState } from 'react';
import { CreditCard, Scale, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useCreateSubscription,
  useDeleteSubscription,
  useSubscriptionROI,
  useSubscriptions,
} from '@/api/hooks/useOwnership';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Badge, Button, DataTable, Input, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  BillingPeriod,
  Subscription,
  SubscriptionKind,
  SubscriptionROI,
  UsageMetric,
} from '@/types/ownership';
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

const WINDOW_OPTIONS = [30, 90, 180, 365];

const USAGE_METRICS: UsageMetric[] = [
  'supercharging_energy',
  'driving_distance',
  'connectivity_time',
  'charging_sessions',
  'drive_count',
  'none',
];

const SUBSCRIPTION_KINDS: SubscriptionKind[] = ['subscription', 'one_time'];

/** Mirrors the vehicle_subscriptions_billing_kind constraint pairing. */
const BILLING_PERIODS_BY_KIND: Record<SubscriptionKind, BillingPeriod[]> = {
  subscription: ['monthly', 'annual'],
  one_time: ['once'],
};

const BILLING_PERIOD_LABELS: Record<BillingPeriod, (t: TFunction) => string> = {
  monthly: (t) => t('ownership.subscription.billing.monthly', 'Monthly'),
  annual: (t) => t('ownership.subscription.billing.annual', 'Annual'),
  once: (t) => t('ownership.subscription.billing.once', 'One-time'),
};

const SUBSCRIPTION_KIND_LABELS: Record<SubscriptionKind, (t: TFunction) => string> = {
  subscription: (t) => t('ownership.subscription.kind.recurring', 'Recurring subscription'),
  one_time: (t) => t('ownership.subscription.kind.oneTime', 'One-time purchase'),
};

const VERDICT_FILL: Record<string, string> = {
  keep: 'rgba(52,211,153,0.7)',
  review: 'rgba(251,191,36,0.7)',
  cancel: 'rgba(251,113,133,0.7)',
  too_early: 'rgba(129,140,248,0.6)',
  unknown: 'rgba(148,163,184,0.5)',
};

export default function SubscriptionROIPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(180);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    kind: 'subscription' as SubscriptionKind,
    billing_period: 'monthly' as BillingPeriod,
    price_minor: 0,
    currency: 'USD',
    usage_metric: 'driving_distance' as UsageMetric,
    benchmark_minor_per_unit: 0,
    started_at: new Date().toISOString(),
    ended_at: null as string | null,
  });

  usePageTitle(t('ownership.subscription.navTitle', 'Subscription ROI'));

  const roiQuery = useSubscriptionROI(vehicleId, windowDays);
  const subsQuery = useSubscriptions(vehicleId);
  const create = useCreateSubscription();
  const remove = useDeleteSubscription();

  const report = roiQuery.data;
  const items = useMemo(() => report?.items ?? [], [report?.items]);
  const subscriptions = useMemo(() => subsQuery.data?.items ?? [], [subsQuery.data?.items]);
  const currency = report?.currency ?? draft.currency;
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const roiChartData = useMemo(
    () =>
      items
        .filter((item) => item.roi_pct != null)
        .map((item) => ({
          name: item.subscription.name,
          roi: Number((item.roi_pct ?? 0).toFixed(1)),
          verdict: item.verdict,
        })),
    [items],
  );

  const submitSubscription = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    create.mutate(
      { ...draft, vehicle_id: vehicleId },
      { onSuccess: () => setFormOpen(false) },
    );
  };

  const roiColumns: Column<SubscriptionROI>[] = [
    {
      key: 'name',
      header: t('ownership.subscription.row.name', 'Subscription'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.subscription.name}
          </Text>
          <Text as="p" variant="caption">
            {SUBSCRIPTION_KIND_LABELS[row.subscription.kind](t)} ·{' '}
                    {BILLING_PERIOD_LABELS[row.subscription.billing_period](t)}
          </Text>
        </div>
      ),
    },
    {
      key: 'verdict',
      header: t('ownership.subscription.row.verdict', 'Verdict'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <VerdictBadge value={row.verdict} />
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {formatPct(row.confidence * 100, 0)}
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'monthly',
      header: t('ownership.subscription.row.monthly', 'Monthly cost'),
      render: (row) => <span className="tabular-nums">{money(row.monthly_cost_minor)}</span>,
      sortable: true,
    },
    {
      key: 'spend',
      header: t('ownership.subscription.row.spend', 'Spent to date'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{money(row.spend_to_date_minor)}</span>
          <Text as="p" variant="caption">
            {t('ownership.subscription.row.activeDays', '{{count}} active days', {
              count: row.active_days,
            })}
          </Text>
        </div>
      ),
    },
    {
      key: 'usage',
      header: t('ownership.subscription.row.usage', 'Measured usage'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {row.usage_quantity != null ? fmtNumber(row.usage_quantity, 1) : '—'} {row.usage_unit}
          </span>
          <Text as="p" variant="caption">
            {row.usage_per_month != null
              ? t('ownership.subscription.row.perMonth', '{{value}} / month', {
                  value: fmtNumber(row.usage_per_month, 1),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'value',
      header: t('ownership.subscription.row.value', 'Realised value'),
      render: (row) => <span className="tabular-nums">{money(row.realised_value_minor)}</span>,
    },
    {
      key: 'net',
      header: t('ownership.subscription.row.net', 'Net'),
      render: (row) => (
        <span
          className={`tabular-nums ${(row.net_value_minor ?? 0) > 0 ? 'text-emerald-300' : (row.net_value_minor ?? 0) < 0 ? 'text-rose-300' : ''}`}
        >
          {money(row.net_value_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'roi',
      header: t('ownership.subscription.row.roi', 'ROI'),
      render: (row) =>
        row.roi_pct != null ? (
          <span
            className={`tabular-nums ${row.roi_pct > 0 ? 'text-emerald-300' : 'text-rose-300'}`}
          >
            {formatSignedPct(row.roi_pct)}
          </span>
        ) : (
          '—'
        ),
      sortable: true,
    },
    {
      key: 'breakEven',
      header: t('ownership.subscription.row.breakEven', 'Break-even usage'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {row.break_even_usage_per_month != null
              ? `${fmtNumber(row.break_even_usage_per_month, 1)} ${row.usage_unit}`
              : '—'}
          </span>
          <Text as="p" variant="caption">
            {row.utilisation_pct != null
              ? t('ownership.subscription.row.utilisation', '{{value}} of break-even', {
                  value: formatPct(row.utilisation_pct, 0),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'narrative',
      header: t('ownership.subscription.row.narrative', 'Reasoning'),
      render: (row) => (
        <Text as="span" variant="caption">
          {row.narrative}
        </Text>
      ),
    },
  ];

  const subscriptionColumns: Column<Subscription>[] = [
    {
      key: 'name',
      header: t('ownership.subscription.list.name', 'Subscription'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.name}
          </Text>
          <Text as="p" variant="caption">
            {SUBSCRIPTION_KIND_LABELS[row.kind](t)} · {BILLING_PERIOD_LABELS[row.billing_period](t)}
          </Text>
        </div>
      ),
    },
    {
      key: 'price',
      header: t('ownership.subscription.list.price', 'Price'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.price_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'metric',
      header: t('ownership.subscription.list.metric', 'Value metric'),
      render: (row) => (
        <Badge variant={row.usage_metric === 'none' ? 'neutral' : 'info'}>
          {row.usage_metric.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      key: 'benchmark',
      header: t('ownership.subscription.list.benchmark', 'Benchmark rate'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(
            Math.round(row.benchmark_minor_per_unit * 100) / 100,
            row.currency,
            units.unitPrefs.locale,
          )}
        </span>
      ),
    },
    {
      key: 'period',
      header: t('ownership.subscription.list.period', 'Active'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.started_at)} →{' '}
          {row.ended_at
            ? formatDateTime(row.ended_at)
            : t('ownership.subscription.list.ongoing', 'ongoing')}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => remove.mutate(row.id)}
        >
          {t('ownership.action.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      title={t('ownership.subscription.title', 'Subscription & Feature ROI')}
      subtitle={t(
        'ownership.subscription.subtitle',
        'Price every recurring charge against the usage it actually delivered, express the break-even in units you can act on, and see exactly how much cancelling the weak ones would return.',
      )}
      loading={roiQuery.isLoading}
      error={roiQuery.error as Error | null}
      actions={
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('ownership.window.label', 'Analysis window')}
            value={String(windowDays)}
            options={WINDOW_OPTIONS.map((days) => ({
              value: String(days),
              label: t('ownership.window.days', '{{count}} days', { count: days }),
            }))}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          />
          <VehicleSelect withIcon />
        </div>
      }
    >
      <AlertBanner
        variant="info"
        title={t('ownership.subscription.notice.title', 'Value is what you would otherwise pay')}
      >
        {t(
          'ownership.subscription.notice.body',
          'Realised value is measured usage multiplied by the benchmark rate you set — what the same usage would have cost without the subscription. A subscription active for under 30 days is reported as too early to judge, never as a loss.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.subscription.summary.title', 'Portfolio economics')}>
          <StatGrid
            stats={[
              {
                key: 'monthly',
                label: t('ownership.subscription.stat.monthly', 'Monthly commitment'),
                value: money(report?.total_monthly_cost_minor),
              },
              {
                key: 'spend',
                label: t('ownership.subscription.stat.spend', 'Spent to date'),
                value: money(report?.total_spend_to_date_minor),
              },
              {
                key: 'value',
                label: t('ownership.subscription.stat.value', 'Realised value'),
                value: money(report?.total_realised_value_minor),
                tone: 'positive',
              },
              {
                key: 'roi',
                label: t('ownership.subscription.stat.roi', 'Portfolio ROI'),
                value:
                  report?.portfolio_roi_pct != null
                    ? formatSignedPct(report.portfolio_roi_pct)
                    : '—',
                tone: (report?.portfolio_roi_pct ?? 0) >= 0 ? 'positive' : 'critical',
              },
              {
                key: 'saving',
                label: t('ownership.subscription.stat.saving', 'Cancel-candidate saving'),
                value: money(report?.cancel_candidate_saving_minor),
                tone: (report?.cancel_candidate_saving_minor ?? 0) > 0 ? 'warning' : 'default',
                hint: t('ownership.subscription.stat.savingHint', 'per month, if all cancelled'),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.subscription.chart.title', 'Return by subscription')}
          empty={roiChartData.length === 0}
          emptyMessage={t(
            'ownership.subscription.chart.empty',
            'No subscription has enough measured usage to compute a return yet.',
          )}
          actions={<Scale className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
        >
          <ChartContainer
            title={t('ownership.subscription.chart.inner', 'Return on spend, per subscription')}
            ariaLabel={t(
              'ownership.subscription.chart.aria',
              'Bar chart of return on spend percentage for each subscription, coloured by verdict',
            )}
            height={280}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roiChartData} margin={chartMargin}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis tick={axisTick} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="roi" radius={[4, 4, 0, 0]}>
                  {roiChartData.map((entry, index) => (
                    <Cell
                      key={`roi-${index}`}
                      fill={VERDICT_FILL[entry.verdict] ?? VERDICT_FILL.unknown}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.subscription.roi.title', 'Per-subscription verdict')}
          description={t(
            'ownership.subscription.roi.subtitle',
            'Confidence falls when the active period is short or the usage metric has sparse data — a low-confidence "cancel" is a prompt to look, not to act.',
          )}
          empty={items.length === 0}
          emptyMessage={t(
            'ownership.subscription.roi.empty',
            'Record a subscription below to start measuring its return.',
          )}
        >
          <DataTable
            columns={roiColumns}
            data={items}
            keyExtractor={(row) => row.subscription.id}
            tableId="ownership-subscription-roi"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.subscription.list.title', 'Subscription register')}
          empty={subscriptions.length === 0 && !formOpen}
          emptyMessage={t(
            'ownership.subscription.list.empty',
            'No subscriptions recorded for this vehicle.',
          )}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.subscription.list.add', 'Add subscription')}
            </Button>
          }
        >
          {formOpen ? (
            <form
              className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              onSubmit={submitSubscription}
            >
              <Input
                label={t('ownership.subscription.form.name', 'Name')}
                value={draft.name}
                required
                maxLength={160}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Select
                label={t('ownership.subscription.form.kind', 'Kind')}
                value={draft.kind}
                options={SUBSCRIPTION_KINDS.map((kind) => ({
                  value: kind,
                  label: SUBSCRIPTION_KIND_LABELS[kind](t),
                }))}
                onChange={(event) => {
                  const kind = event.target.value as SubscriptionKind;
                  setDraft((current) => ({
                    ...current,
                    kind,
                    billing_period: BILLING_PERIODS_BY_KIND[kind][0],
                  }));
                }}
              />
              <Select
                label={t('ownership.subscription.form.billing', 'Billing period')}
                value={draft.billing_period}
                options={BILLING_PERIODS_BY_KIND[draft.kind].map((period) => ({
                  value: period,
                  label: BILLING_PERIOD_LABELS[period](t),
                }))}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    billing_period: event.target.value as BillingPeriod,
                  }))
                }
              />
              <MoneyInput
                label={t('ownership.subscription.form.price', 'Price per period')}
                value={draft.price_minor}
                currency={draft.currency}
                locale={units.unitPrefs.locale}
                required
                onChange={(value) => setDraft((current) => ({ ...current, price_minor: value ?? 0 }))}
              />
              <Input
                label={t('ownership.form.currency', 'ISO currency code')}
                value={draft.currency}
                minLength={3}
                maxLength={3}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
              />
              <Select
                label={t('ownership.subscription.form.metric', 'Usage metric')}
                value={draft.usage_metric}
                options={USAGE_METRICS.map((metric) => ({
                  value: metric,
                  label: metric.replace(/_/g, ' '),
                }))}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    usage_metric: event.target.value as UsageMetric,
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.subscription.form.benchmark', 'Benchmark (minor / unit)')}
                value={draft.benchmark_minor_per_unit}
                step="any"
                min={0}
                hint={t(
                  'ownership.subscription.form.benchmarkHint',
                  'What one unit of this usage would cost without the subscription',
                )}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    benchmark_minor_per_unit: Number(event.target.value),
                  }))
                }
              />
              <Input
                type="date"
                label={t('ownership.subscription.form.started', 'Started')}
                value={toDateInput(draft.started_at)}
                required
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    started_at: fromDateInput(event.target.value),
                  }))
                }
              />
              <Input
                type="date"
                label={t('ownership.subscription.form.ended', 'Ended')}
                value={draft.ended_at ? toDateInput(draft.ended_at) : ''}
                hint={t('ownership.subscription.form.endedHint', 'Leave blank while active')}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    ended_at: event.target.value === '' ? null : fromDateInput(event.target.value),
                  }))
                }
              />
              <div className="md:col-span-2 xl:col-span-3">
                <Button type="submit" loading={create.isPending} disabled={vehicleId == null}>
                  {t('ownership.subscription.form.save', 'Save subscription')}
                </Button>
                <MutationError error={create.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={subscriptionColumns}
            data={subscriptions}
            keyExtractor={(row) => row.id}
            tableId="ownership-subscription-list"
            emptyMessage={t(
              'ownership.subscription.list.empty',
              'No subscriptions recorded for this vehicle.',
            )}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidencePanel
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.subscription.unsupported.cancel',
              'Cancelling a subscription with the provider — this measures, it does not transact',
            ),
            t(
              'ownership.subscription.unsupported.intangible',
              'Convenience and enjoyment, which have real value but no measurable unit here',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
