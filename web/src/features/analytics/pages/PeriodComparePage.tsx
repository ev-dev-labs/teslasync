import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car, Calendar, TrendingUp, Zap, Gauge, DollarSign, Leaf, Lightbulb,
  ArrowLeftRight, RefreshCw,
} from 'lucide-react';

import { PageLayout, Section, CardGrid, LayoutCard } from '@/components/layout';
import {
  Badge, Button, Select, Text,
  DataTable, type SelectOption, type Column,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner, QueryError } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePeriodStats } from '@/api/hooks/usePeriodStats';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useUrlEnum } from '@/hooks/useUrlState';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import {
  COMPARE_METRIC_SEMANTICS,
  DELTA_FILL,
  assessDelta,
  pctChange,
} from '../lib/periodCompare';
import { cn } from '@/lib/cn';
import { resolveSemantic } from '@/lib/metricSemantics';
import { AIPeriodCompareNarration } from '@/components/ai/AIPeriodCompareNarration';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';
import { deriveComparisonState } from '../components/period-compare-modernization/comparisonState';
import { PeriodSources } from '../components/period-compare-modernization/PeriodSources';
import { PeriodDeltaChart } from '../components/period-compare-modernization/PeriodDeltaChart';

/* ── Types ─────────────────────────────────────────────── */

interface ComparisonRow {
  metric: string;
  kind: 'count' | 'measurement';
  periodA: number;
  periodB: number;
  change: number;
  pctChange: string;
  positive: boolean;
  /** Null = no judgment (neutral metric, zero baseline, or zero movement). */
  favorable: boolean | null;
}

const PERIOD_DAYS: Record<string, number> = {
  '7': 7, '30': 30, '90': 90, '365': 365, '0': 0,
};

const PERIOD_VALUES = ['7', '30', '90', '365', '0'] as const;
type PeriodValue = (typeof PERIOD_VALUES)[number];

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;

// Disambiguation banner dismissal is persisted so users who already understand
// the difference between compare pages do not have to dismiss it on every visit.
// Separate keys let each compare page track its own banner.
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.period';

/* ── Component ─────────────────────────────────────────── */

export default function PeriodComparePage() {
  const { fmtNumber, fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const formatValue = useCallback(
    (value: number, kind: ComparisonRow['kind']) => kind === 'count' ? fmtInt(value) : fmtNumber(value),
    [fmtInt, fmtNumber],
  );
  const { t } = useTranslation();
  usePageTitle(t('compare.title', 'Period comparison'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const { vehicleId, setVehicleId } = useSelectedVehicle();
  const { pathname } = useLocation();
  // Shared route scope owns selection on the canonical route and its alias.
  // A local fallback is reachable only if the shared contract disables the
  // header picker; header-owned routes never render a duplicate selector.
  const headerOwnsVehicle = getWorkspaceRouteScope(pathname).vehicle;
  const [periodA, setPeriodA] = useUrlEnum<PeriodValue>('period_a', PERIOD_VALUES, '30');
  const [periodB, setPeriodB] = useUrlEnum<PeriodValue>('period_b', PERIOD_VALUES, '90');

  // Disambiguation banner — defaults to visible, persists dismissal.
  const [bannerVisible, setBannerVisible] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BANNER_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const dismissBanner = () => {
    setBannerVisible(false);
    try {
      window.localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // Storage failures are non-fatal — banner just reappears next mount.
    }
  };

  /* ── Queries ── */

  const { data: vehicles } = useVehicles();

  const activeVehicle = vehicleId == null ? '' : String(vehicleId);
  const daysA = PERIOD_DAYS[periodA] ?? 30;
  const daysB = PERIOD_DAYS[periodB] ?? 90;

  const statsA = usePeriodStats(activeVehicle, daysA);
  const statsB = usePeriodStats(activeVehicle, daysB);

  // Section-level state flags — every data section owns its own loading /
  // empty / error branch instead of gating the whole page behind one guard.
  const {
    stateA, stateB, a, b,
    comparisonLoading: bothLoading,
    comparisonError: loadError,
  } = deriveComparisonState(statsA, statsB);
  const refetchAll = () => {
    void statsA.refetch();
    void statsB.refetch();
  };

  // Hide the disambiguation banner for accounts with only one vehicle —
  // they can't usefully cross-navigate to fleet comparison anyway. Guard on
  // `vehiclesLoaded`: on the very first render `vehicles` is still `undefined`
  // (count 0), so without this guard the effect would hide the banner before
  // the list resolves and never re-show it — suppressing the banner for every
  // account, including the multi-vehicle ones it exists to serve.
  const vehiclesLoaded = vehicles !== undefined;
  const vehicleCount = (vehicles ?? []).length;
  useEffect(() => {
    if (vehiclesLoaded && vehicleCount < 2 && bannerVisible) {
      setBannerVisible(false);
    }
  }, [vehiclesLoaded, vehicleCount, bannerVisible]);

  /* ── Derived data ── */

  const periodOptions: SelectOption[] = useMemo(
    () => [
      { value: '7', label: t('compare.last7', 'Last 7 days') },
      { value: '30', label: t('compare.last30', 'Last 30 days') },
      { value: '90', label: t('compare.last90', 'Last 90 days') },
      { value: '365', label: t('compare.lastYear', 'Last year') },
      { value: '0', label: t('compare.allTime', 'All time') },
    ],
    [t],
  );

  const vehicleOptions: SelectOption[] = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const metrics = useMemo(() => {
    if (!a || !b) return [];
    // backend `total_distance` is SI km; `avg_efficiency` is SI Wh/km. Convert
    // both to the user's preferred display unit so chart / table values match
    // the unit label and don't silently mis-render for mi-unit users.
    const distA = convertDistanceFromSI((a.total_distance ?? 0) * METERS_PER_KM, distanceUnit);
    const distB = convertDistanceFromSI((b.total_distance ?? 0) * METERS_PER_KM, distanceUnit);
    const effA = distanceUnit === 'mi' ? (a.avg_efficiency ?? 0) * KM_PER_MILE : (a.avg_efficiency ?? 0);
    const effB = distanceUnit === 'mi' ? (b.avg_efficiency ?? 0) * KM_PER_MILE : (b.avg_efficiency ?? 0);
    return [
      { key: 'distance', label: t('compare.totalDistance', 'Total distance'), icon: <Car className="h-4 w-4" aria-hidden="true" />, a: distA, b: distB, unit: distanceUnit, color: 'cyan' as const, semantic: COMPARE_METRIC_SEMANTICS.distance },
      { key: 'drives', label: t('compare.totalDrives', 'Total drives'), icon: <TrendingUp className="h-4 w-4" aria-hidden="true" />, a: a.total_drives ?? 0, b: b.total_drives ?? 0, unit: '', color: 'green' as const, semantic: COMPARE_METRIC_SEMANTICS.drives },
      { key: 'energy', label: t('compare.energyUsed', 'Energy used'), icon: <Zap className="h-4 w-4" aria-hidden="true" />, a: a.energy_used ?? 0, b: b.energy_used ?? 0, unit: 'kWh', color: 'purple' as const, semantic: COMPARE_METRIC_SEMANTICS.energy },
      { key: 'efficiency', label: t('compare.avgEfficiency', 'Avg efficiency'), icon: <Gauge className="h-4 w-4" aria-hidden="true" />, a: effA, b: effB, unit: efficiencyUnit, color: 'cyan' as const, semantic: COMPARE_METRIC_SEMANTICS.efficiency },
      { key: 'cost', label: t('compare.totalCost', 'Total cost'), icon: <DollarSign className="h-4 w-4" aria-hidden="true" />, a: a.total_cost ?? 0, b: b.total_cost ?? 0, unit: '$', color: 'green' as const, semantic: COMPARE_METRIC_SEMANTICS.cost },
      { key: 'co2', label: t('compare.co2Saved', 'CO₂ saved'), icon: <Leaf className="h-4 w-4" aria-hidden="true" />, a: a.co2_saved ?? 0, b: b.co2_saved ?? 0, unit: 'kg', color: 'purple' as const, semantic: COMPARE_METRIC_SEMANTICS.co2 },
    ].map((metric) => ({
      ...metric,
      kind: resolveSemantic(metric.semantic).unit === 'count' ? 'count' as const : 'measurement' as const,
    }));
  }, [a, b, t, distanceUnit, efficiencyUnit]);

  // Hero chart plots per-metric % change vs Period B (unitless, so a shared
  // % axis is honest) instead of raw values with incompatible units.
  // (Rows stay string|number-only per the ChartDataRow contract; the tooltip
  // resolves baselines from `metrics` instead of carrying a boolean column.)
  const deltaChartData = useMemo(
    () =>
      metrics.filter((m) => m.b !== 0).map((m) => {
        const favorable = assessDelta(m.semantic, m.a, m.b).favorable;
        return {
          name: m.label,
          delta: ((m.a - m.b) / Math.abs(m.b)) * 100,
          fill:
            favorable == null
              ? DELTA_FILL.neutral
              : favorable
                ? DELTA_FILL.favorable
                : DELTA_FILL.unfavorable,
        };
      }),
    [metrics],
  );

  const tableRows: ComparisonRow[] = useMemo(
    () =>
      metrics.map((m) => {
        const delta = m.a - m.b;
        const pct = pctChange(m.a, m.b);
        return {
          metric: m.label,
          kind: m.kind,
          periodA: m.a,
          periodB: m.b,
          change: delta,
          pctChange: pct.value,
          positive: pct.positive,
          favorable: assessDelta(m.semantic, m.a, m.b).favorable,
        };
      }),
    [metrics, displayPrecision, displayLocale],
  );

  const columns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('compare.metric', 'Metric'),
        render: (r) => <Text variant="body" className="font-medium">{r.metric}</Text>,
      },
      {
        key: 'periodA',
        align: 'right',
        header: t('compare.periodA', 'Period A'),
        sortable: true,
        render: (r) => <Text variant="body" className="tabular-nums">{formatValue(r.periodA, r.kind)}</Text>,
      },
      {
        key: 'periodB',
        align: 'right',
        header: t('compare.periodB', 'Period B'),
        sortable: true,
        render: (r) => <Text variant="body" className="tabular-nums">{formatValue(r.periodB, r.kind)}</Text>,
      },
      {
        key: 'change',
        align: 'right',
        header: t('compare.change', 'Change'),
        sortable: true,
        render: (r) => {
          const arrow = r.change > 0 ? '↑' : r.change < 0 ? '↓' : '→';
          const spoken =
            r.change > 0
              ? t('compare.increasedBy', 'Increased by {{value}}', { value: formatValue(Math.abs(r.change), r.kind) })
              : r.change < 0
                ? t('compare.decreasedBy', 'Decreased by {{value}}', { value: formatValue(Math.abs(r.change), r.kind) })
                : t('compare.noChange', 'No change');
          return (
            <Text variant="body" className={cn('tabular-nums', r.favorable == null ? 'text-[var(--text-muted)]' : r.favorable ? 'text-emerald-300' : 'text-rose-300')}>
              <VisuallyHidden>{spoken}</VisuallyHidden>
              <span aria-hidden="true">{arrow} {formatValue(Math.abs(r.change), r.kind)}</span>
            </Text>
          );
        },
      },
      {
        key: 'pctChange',
        align: 'right',
        header: t('compare.pctChange', '% Change'),
        render: (r) => (
          <Badge variant={r.favorable == null ? 'neutral' : r.favorable ? 'success' : 'danger'} size="sm">
            {r.pctChange}
          </Badge>
        ),
      },
    ],
    [t, formatValue],
  );

  const insights = useMemo(() => {
    if (!a || !b) return [];
    const distPct = pctChange(a.total_distance ?? 0, b.total_distance ?? 0);
    const effA = a.avg_efficiency ?? 0;
    const effB = b.avg_efficiency ?? 0;
    const effPct = pctChange(effA, effB);
    // Efficiency is consumption (Wh/km): lower is better, so the verdict comes
    // from direction semantics, not the raw sign. Magnitude is unsigned so the
    // sentence reads naturally ("improved by 4.8%", never "improved by -4.8%").
    const effFav = assessDelta(COMPARE_METRIC_SEMANTICS.efficiency, effA, effB).favorable;
    const effNum = effB === 0 ? null : ((effA - effB) / Math.abs(effB)) * 100;
    const costPct = pctChange(a.total_cost ?? 0, b.total_cost ?? 0);
    return [
      distPct.neutral
        ? t('compare.distanceNoBaseline', 'Distance change is unavailable: period B has no baseline.')
        : t('compare.insightDistance', 'Distance traveled was {{pct}} {{dir}} in period A vs period B.', {
          pct: distPct.value,
          dir: distPct.positive ? t('compare.more', 'more') : t('compare.less', 'less'),
        }),
      effPct.neutral
        ? t('compare.efficiencyNoBaseline', 'Efficiency change is unavailable: period B has no baseline.')
        : t('compare.insightEfficiency', 'Efficiency {{dir}} by {{pct}} compared to period B.', {
          pct: effNum == null ? effPct.value : `${fmtNumber(Math.abs(effNum))}%`,
          dir: effA === effB
            ? t('compare.unchanged', 'unchanged')
            : effFav
              ? t('compare.improved', 'improved')
              : t('compare.declined', 'declined'),
        }),
      costPct.neutral
        ? t('compare.costNoBaseline', 'Cost change is unavailable: period B has no baseline.')
        : t('compare.insightCost', 'Costs were {{pct}} {{dir}} in period A.', {
          pct: costPct.value,
          dir: costPct.positive ? t('compare.higher', 'higher') : t('compare.lower', 'lower'),
        }),
    ];
  }, [a, b, t, fmtNumber, displayPrecision, displayLocale]);

  /* ── Toolbar (vehicle + both periods + refresh) ── */

  const comparisonControls = (
    <div className="flex flex-wrap items-center gap-2">
      {!headerOwnsVehicle && (
        <Select
          aria-label={t('compare.vehicle', 'Vehicle')}
          options={vehicleOptions}
          value={activeVehicle}
          onChange={(e) => {
            const next = Number(e.target.value);
            setVehicleId(Number.isInteger(next) && next > 0 ? next : null);
          }}
          placeholder={t('compare.selectVehicle', 'Select vehicle')}
          className="w-full sm:w-44"
        />
      )}
      <Select
        aria-label={t('compare.periodA', 'Period A')}
        options={periodOptions}
        value={periodA}
        onChange={(e) => setPeriodA(e.target.value as PeriodValue)}
        className="w-full sm:w-36"
      />
      <Text variant="caption" aria-hidden="true">{t('compare.vs', 'vs')}</Text>
      <Select
        aria-label={t('compare.periodB', 'Period B')}
        options={periodOptions}
        value={periodB}
        onChange={(e) => setPeriodB(e.target.value as PeriodValue)}
        className="w-full sm:w-36"
      />
    </div>
  );

  /* ── Render ── */

  return (
    <PageLayout
      title={t('compare.title', 'Period comparison')}
      subtitle={t('compare.subtitle', 'Compare key metrics across two time periods')}
      contextActions={comparisonControls}
      secondaryActions={
        <Button
          variant="ghost"
          onClick={refetchAll}
          aria-label={t('compare.refresh', 'Refresh')}
          title={t('compare.refresh', 'Refresh')}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
      query={[statsA, statsB]}
      dataSources={[
        { id: 'period-a', label: t('compare.periodA', 'Period A'), query: statsA, enabled: !!activeVehicle },
        { id: 'period-b', label: t('compare.periodB', 'Period B'), query: statsB, enabled: !!activeVehicle },
      ]}
    >
      {/* Disambiguation banner — points users who wanted the fleet view to the
          right page. Hidden for single-vehicle accounts and once dismissed. */}
      {bannerVisible && (
        <FadeIn>
          <AlertBanner
            variant="info"
            icon={<ArrowLeftRight className="h-4 w-4" aria-hidden="true" />}
            onClose={dismissBanner}
          >
            {t(
              'compare.banner.toFleetPrefix',
              'Looking to compare two vehicles instead?',
            )}{' '}
            <Link
              to="/vehicle-comparison"
              className="font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
            >
              {t('compare.banner.toFleetCta', 'Open fleet comparison →')}
            </Link>
          </AlertBanner>
        </FadeIn>
      )}

      {/* AI period-compare narration; opt-in and hidden when ai_mode='off'. */}
      <FadeIn delay={0.025}>
        <AIPeriodCompareNarration
          vehicleId={activeVehicle}
          daysA={daysA}
          daysB={daysB}
        />
      </FadeIn>

      {/* One shared measurement / row packer / placement provider owns every
          analysis card, in source order and at the full allocated page width. */}
      <FadeIn delay={0.05}>
        <Section id="period-compare-analysis" title={t('compare.kpis', 'Comparison metrics')}>
          <CardGrid
            label={t('compare.kpis', 'Comparison metrics')}
            items={[
              {
                id: 'period-compare-kpis',
                size: 'full',
                content: (
                  <LayoutCard title={t('compare.kpis', 'Comparison metrics')}>
                    {metrics.length > 0 ? (
                      <div className="grid min-w-0 grid-cols-2 gap-3 @[640px]:grid-cols-3 @[1280px]:grid-cols-6">
                        {metrics.map((m) => (
                          <MetricCard
                            key={m.key}
                            label={m.label}
                            value={`${formatValue(m.a, m.kind)} ${m.unit}`.trim()}
                            icon={m.icon}
                            color={m.color}
                            wrapLabel
                            subtitle={`${t('compare.periodB', 'Period B')}: ${formatValue(m.b, m.kind)} ${m.unit}`.trim()}
                            delta={{
                              metric: m.semantic,
                              current: m.a,
                              previous: m.b,
                              comparedTo: `${t('compare.vs', 'vs')} ${t('compare.periodB', 'Period B')}`,
                            }}
                          />
                        ))}
                      </div>
                    ) : activeVehicle ? (
                      <PeriodSources
                        stateA={stateA}
                        stateB={stateB}
                        retryA={() => { void statsA.refetch(); }}
                        retryB={() => { void statsB.refetch(); }}
                      />
                    ) : (
                      <EmptyState /* no-action: selection is owned by the workspace where enabled */
                        icon={<Calendar className="h-10 w-10" aria-hidden="true" />}
                        message={t('compare.empty', 'Select a vehicle and two periods to compare.')}
                      />
                    )}
                  </LayoutCard>
                ),
              },
              {
                id: 'period-compare-delta',
                size: 'half',
                content: (
                  <PeriodDeltaChart
                    data={deltaChartData}
                    metrics={metrics}
                    error={loadError}
                    loading={bothLoading}
                    onRetry={refetchAll}
                  />
                ),
              },
              {
                id: 'period-compare-insights',
                size: 'third',
                content: (
                  <LayoutCard title={t('compare.insights', 'Insights')}>
                    {loadError ? (
                      <QueryError error={loadError} onRetry={refetchAll} />
                    ) : bothLoading ? (
                      <Skeleton lines={3} />
                    ) : insights.length === 0 ? (
                      <EmptyState /* no-action: insights derive from both periods' stats */
                        icon={<Lightbulb className="h-8 w-8" aria-hidden="true" />}
                        message={t('compare.insightsEmpty', 'Insights appear once both periods have data.')}
                      />
                    ) : (
                      <ul className="space-y-2.5">
                        {insights.map((line, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span
                              aria-hidden="true"
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                            />
                            <Text as="span" variant="bodySm">{line}</Text>
                          </li>
                        ))}
                      </ul>
                    )}
                  </LayoutCard>
                ),
              },
              {
                id: 'period-compare-details',
                size: 'full',
                content: (
                  <LayoutCard title={t('compare.tableTitle', 'Comparison details')}>
                    {loadError ? (
                      <QueryError error={loadError} onRetry={refetchAll} />
                    ) : bothLoading ? (
                      <Skeleton height={220} />
                    ) : (
                      <DataTable
                        tableId="analytics:period-compare"
                        resizable={false}
                        columnReorder={false}
                        columnVisibility={false}
                        columns={columns}
                        data={tableRows}
                        keyExtractor={(r) => r.metric}
                        emptyMessage={t('compare.empty', 'Select a vehicle and two periods to compare.')}
                        mobileColumns={['metric', 'change', 'pctChange']}
                        compact
                        pagination
                      />
                    )}
                  </LayoutCard>
                ),
              },
            ]}
          />
        </Section>
      </FadeIn>
    </PageLayout>
  );
}
