import { type FormEvent, useId, useMemo, useState } from 'react';
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

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, ConfirmDialog, DataTable, Icon, Input, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { gaugeTone, neonColorMap, typography } from '@/lib/tokens';

import type {
  BillingPeriod,
  Subscription,
  SubscriptionKind,
  SubscriptionROI,
  SubscriptionVerdict,
  UsageMetric,
} from '@/types/ownership';
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

const VERDICT_FILL: Record<SubscriptionVerdict, string> = {
  keep: gaugeTone.success,
  review: gaugeTone.warning,
  cancel: gaugeTone.danger,
  too_early: gaugeTone.info,
  unknown: gaugeTone.neutral,
};

export default function SubscriptionROIPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(180);
  const [formOpen, setFormOpen] = useState(false);
  const editorId = useId();
  const [draftVehicleId, setDraftVehicleId] = useState<number | null>(null);
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
  const { confirm, dialogProps } = useConfirm();

  const handleRemove = async (row: Subscription) => {
    const ok = await confirm({
      title: t('ownership.subscription.delete.title', 'Delete this subscription?'),
      message: t(
        'ownership.subscription.delete.message',
        '“{{name}}” and its ROI history will be removed permanently. This cannot be undone.',
        { name: row.name },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
    });
    if (ok) remove.mutate(row.id);
  };

  const report = roiQuery.data;
  const items = useMemo(() => report?.items ?? [], [report?.items]);
  const subscriptions = useMemo(() => subsQuery.data?.items ?? [], [subsQuery.data?.items]);
  const currency = report?.currency ?? draft.currency;
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);
  const usage = (quantity: number | null | undefined, unit: string) => {
    if (quantity == null || !Number.isFinite(quantity)) return '—';
    if (unit === 'm') return units.formatDistance(quantity);
    if (unit === 'Wh') return units.formatEnergy(quantity);
    if (unit === 's') return units.formatDuration(quantity);
    return `${fmtNumber(quantity)} ${unit}`.trim();
  };
  const benchmark = (row: Subscription) => formatCurrencyMinor(
    Math.round(row.benchmark_minor_per_unit * 100) / 100,
    row.currency,
    units.unitPrefs.locale,
  );
  const verdictLabel = (verdict: SubscriptionVerdict) => {
    switch (verdict) {
      case 'keep': return t('ownership.verdict.keep', 'keep');
      case 'review': return t('ownership.verdict.review', 'review');
      case 'cancel': return t('ownership.verdict.cancel', 'cancel');
      case 'too_early': return t('ownership.verdict.too_early', 'too early');
      case 'unknown': return t('ownership.verdict.unknown', 'unknown');
      default: return String(verdict).replace(/_/g, ' ');
    }
  };

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
    if (draftVehicleId == null || vehicleId !== draftVehicleId) return;
    create.mutate(
      { ...draft, vehicle_id: draftVehicleId },
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
          <Text as="span" variant="caption" className="tabular-nums">
            {formatPct(row.confidence * 100)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'monthly',
      align: 'right',
      header: t('ownership.subscription.row.monthly', 'Monthly cost'),
      render: (row) => <span className="tabular-nums">{money(row.monthly_cost_minor)}</span>,
      sortable: true,
    },
    {
      key: 'spend',
      align: 'right',
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
      align: 'right',
      header: t('ownership.subscription.row.usage', 'Measured usage'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {row.usage_quantity == null ? `— ${row.usage_unit}`.trim() : usage(row.usage_quantity, row.usage_unit)}
          </span>
          <Text as="p" variant="caption">
            {row.usage_per_month != null
              ? t('ownership.subscription.row.perMonth', '{{value}} / month', {
                  value: row.usage_unit === 'm' || row.usage_unit === 'Wh' || row.usage_unit === 's'
                    ? usage(row.usage_per_month, row.usage_unit)
                    : fmtNumber(row.usage_per_month),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'value',
      align: 'right',
      header: t('ownership.subscription.row.value', 'Realised value'),
      render: (row) => <span className="tabular-nums">{money(row.realised_value_minor)}</span>,
    },
    {
      key: 'net',
      align: 'right',
      header: t('ownership.subscription.row.net', 'Net'),
      render: (row) => (
        <span
          className={cn('tabular-nums', (row.net_value_minor ?? 0) > 0
            ? neonColorMap.green.text : (row.net_value_minor ?? 0) < 0
              ? neonColorMap.red.text : typography.color.primary)}
        >
          {money(row.net_value_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'roi',
      align: 'right',
      header: t('ownership.subscription.row.roi', 'ROI'),
      render: (row) =>
        row.roi_pct != null ? (
          <span
            className={cn('tabular-nums', row.roi_pct > 0 ? neonColorMap.green.text
              : row.roi_pct < 0 ? neonColorMap.red.text : typography.color.primary)}
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
      align: 'right',
      header: t('ownership.subscription.row.breakEven', 'Break-even usage'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {row.break_even_usage_per_month != null
              ? usage(row.break_even_usage_per_month, row.usage_unit)
              : '—'}
          </span>
          <Text as="p" variant="caption">
            {row.utilisation_pct != null
              ? t('ownership.subscription.row.utilisation', '{{value}} of break-even', {
                  value: formatPct(row.utilisation_pct),
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
      filterValue: (row) => row.id,
      filterValueLabel: (_value, row) => row.name,
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
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.price_minor}`,
      filterValueLabel: (_value, row) => formatCurrencyMinor(row.price_minor, row.currency, units.unitPrefs.locale),
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
      filterValue: (row) => row.usage_metric,
      filterValueLabel: (_value, row) => row.usage_metric.replace(/_/g, ' '),
      header: t('ownership.subscription.list.metric', 'Value metric'),
      render: (row) => (
        <Badge variant={row.usage_metric === 'none' ? 'neutral' : 'info'}>
          {row.usage_metric.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      key: 'benchmark',
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.benchmark_minor_per_unit}`,
      filterValueLabel: (_value, row) => benchmark(row),
      header: t('ownership.subscription.list.benchmark', 'Benchmark rate'),
      render: (row) => (
        <span className="tabular-nums">
          {benchmark(row)}
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
          icon={<Icon icon={Trash2} size="md" />}
          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
          loading={remove.isPending && remove.variables === row.id}
          onClick={() => void handleRemove(row)}
        >
          {t('ownership.action.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('ownership.subscription.title', 'Subscription & feature ROI')}
      subtitle={t(
        'ownership.subscription.subtitle',
        'Price every recurring charge against the usage it actually delivered, express the break-even in units you can act on, and see exactly how much cancelling the weak ones would return.',
      )}
      query={[roiQuery, subsQuery]}
      contextActions={
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
        <OwnershipPanel title={t('ownership.subscription.summary.title', 'Portfolio economics')}
          source={roiQuery} sourceEnabled={vehicleId != null} empty={!report} preserveSummary>
          <OwnershipBrief
            title={t('ownership.subscription.brief.title', 'Subscription commitment and realised value')}
            description={t('ownership.subscription.notice.body', 'Realised value is measured usage multiplied by the benchmark rate you set — what the same usage would have cost without the subscription. A subscription active for under 30 days is reported as too early to judge, never as a loss.')}
            scope={t('ownership.brief.window', 'Selected vehicle · {{count}}-day analysis window; coverage is described below', { count: windowDays })}
            source={roiQuery} enabled={vehicleId != null}
            window={report?.window}
            metrics={[
              {
                occurrenceId: 'monthly', metricId: 'currency',
                label: t('ownership.subscription.stat.monthly', 'Monthly commitment'),
                rawValue: report?.total_monthly_cost_minor,
                display: specialistDisplay(money),
              },
              {
                occurrenceId: 'spend', metricId: 'currency',
                label: t('ownership.subscription.stat.spend', 'Spent to date'),
                rawValue: report?.total_spend_to_date_minor,
                display: specialistDisplay(money),
              },
              {
                occurrenceId: 'value', metricId: 'currency',
                label: t('ownership.subscription.stat.value', 'Realised value'),
                rawValue: report?.total_realised_value_minor,
                display: specialistDisplay(money),
                tone: 'positive',
              },
              {
                occurrenceId: 'roi', metricId: 'percent',
                label: t('ownership.subscription.stat.roi', 'Portfolio ROI'),
                rawValue: report?.portfolio_roi_pct,
                display: specialistDisplay(formatSignedPct),
                tone: (report?.portfolio_roi_pct ?? 0) >= 0 ? 'positive' : 'critical',
              },
              {
                occurrenceId: 'saving', metricId: 'currency',
                label: t('ownership.subscription.stat.saving', 'Cancel-candidate saving'),
                rawValue: report?.cancel_candidate_saving_minor,
                display: specialistDisplay(money),
                tone: (report?.cancel_candidate_saving_minor ?? 0) > 0 ? 'warning' : 'default',
                context: t('ownership.subscription.stat.savingHint', 'per month, if all cancelled'),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.subscription.chart.title', 'Return by subscription')}
          source={roiQuery}
          sourceEnabled={vehicleId != null}
          empty={roiChartData.length === 0}
          emptyMessage={t(
            'ownership.subscription.chart.empty',
            'No subscription has enough measured usage to compute a return yet.',
          )}
          actions={<Icon icon={Scale} size="md" className={typography.color.muted} />}
        >
          <ChartContainer
            title={t('ownership.subscription.chart.inner', 'Return on spend, per subscription')}
            ariaLabel={t(
              'ownership.subscription.chart.aria',
              'Bar chart of return on spend percentage for each subscription, coloured by verdict',
            )}
            data={roiChartData}
            dataColumns={[
              { key: 'name', label: t('ownership.subscription.chart.col.name', 'Subscription') },
              {
                key: 'roi',
                label: t('ownership.subscription.chart.col.roi', 'Return on spend'),
                format: (v) => formatPct(v as number),
              },
              { key: 'verdict', label: t('ownership.subscription.chart.col.verdict', 'Verdict') },
            ]}
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
          source={roiQuery}
          sourceEnabled={vehicleId != null}
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
            mobilePresentation={{
              roles: { name: 'title', verdict: 'badge', roi: 'primary' },
              displayValue: (row, key) => {
                if (key === 'name') return row.subscription.name;
                if (key === 'verdict') return verdictLabel(row.verdict);
                if (key === 'roi') return formatSignedPct(row.roi_pct);
                return undefined;
              },
            }}
            rowLabel={(row) => row.subscription.name}
            data={items}
            keyExtractor={(row) => row.subscription.id}
            tableId="ownership-subscription-roi"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.subscription.list.title', 'Subscription register')}
          source={subsQuery}
          sourceEnabled={vehicleId != null}
          editing={formOpen}
          empty={subscriptions.length === 0 && !formOpen}
          emptyMessage={t(
            'ownership.subscription.list.empty',
            'No subscriptions recorded for this vehicle.',
          )}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={CreditCard} size="md" />}
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              aria-expanded={formOpen}
              aria-controls={editorId}
              onClick={() => {
                if (draftVehicleId == null) setDraftVehicleId(vehicleId);
                setFormOpen((open) => !open);
              }}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.subscription.list.add', 'Add subscription')}
            </Button>
          }
        >
          {formOpen ? (
            <form
              id={editorId}
              aria-label={t('ownership.subscription.list.add', 'Add subscription')}
              className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
              onSubmit={submitSubscription}
            >
              <Text as="p" variant="caption" className="md:col-span-2 xl:col-span-3">
                {t('common.vehicle', 'Vehicle')} {draftVehicleId ?? '—'}
              </Text>
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
                <Button type="submit" loading={create.isPending}
                  className="min-h-11 min-w-11 md:min-h-10"
                  disabled={draftVehicleId == null || vehicleId !== draftVehicleId}>
                  {t('ownership.subscription.form.save', 'Save subscription')}
                </Button>
                <MutationError error={create.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={subscriptionColumns}
            enableValueFilters
            mobilePresentation={{
              roles: { name: 'title', price: 'primary', period: 'meta' },
              displayValue: (row, key) => {
                if (key === 'name') return row.name;
                if (key === 'price') return formatCurrencyMinor(row.price_minor, row.currency, units.unitPrefs.locale);
                if (key === 'period') return `${formatDateTime(row.started_at)} → ${
                  row.ended_at ? formatDateTime(row.ended_at)
                    : t('ownership.subscription.list.ongoing', 'ongoing')}`;
                return undefined;
              },
            }}
            rowLabel={(row) => row.name}
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
          source={roiQuery}
          sourceEnabled={vehicleId != null}
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
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
