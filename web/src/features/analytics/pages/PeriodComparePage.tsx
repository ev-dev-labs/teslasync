import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Car, Calendar, TrendingUp, Zap, Gauge, DollarSign, Leaf, Lightbulb,
  ArrowLeftRight, RefreshCw, BarChart3,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, Button, Select, PanelTitle, Text,
  DataTable, type SelectOption, type Column,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, chartMarginLabeled, axisTick, chartAnimation,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useUnits } from '@/hooks/useUnits';
import { useUrlEnum, useUrlString } from '@/hooks/useUrlState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { AIPeriodCompareNarration } from '@/components/ai/AIPeriodCompareNarration';

/* ── Types ─────────────────────────────────────────────── */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

interface ComparisonRow {
  metric: string;
  periodA: number;
  periodB: number;
  change: number;
  pctChange: string;
  positive: boolean;
}

/* ── Helpers ───────────────────────────────────────────── */

function pctChange(a: number, b: number): { value: string; positive: boolean } {
  if (b === 0) return { value: '—', positive: true };
  const pct = ((a - b) / b) * 100;
  return { value: `${pct > 0 ? '+' : ''}${fmtNumber(pct, 1)}%`, positive: pct >= 0 };
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
  const { t } = useTranslation();
  usePageTitle(t('compare.title', 'Period Comparison'));
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const [vehicleId, setVehicleId] = useUrlString('vehicle_id', '');
  const [periodA, setPeriodA] = useUrlEnum<PeriodValue>('period_a', PERIOD_VALUES, '30');
  const [periodB, setPeriodB] = useUrlEnum<PeriodValue>('period_b', PERIOD_VALUES, '90');

  // Reactive chart palette (color-blind-safe or neon, per user preference).
  const palette = useChartPalette();

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

  const activeVehicle = vehicleId || String(vehicles?.[0]?.id ?? '');
  const daysA = PERIOD_DAYS[periodA] ?? 30;
  const daysB = PERIOD_DAYS[periodB] ?? 90;

  const statsA = useQuery({
    queryKey: ['period-stats', activeVehicle, daysA],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysA}`,
      ),
    enabled: !!activeVehicle,
  });

  const statsB = useQuery({
    queryKey: ['period-stats', activeVehicle, daysB],
    queryFn: () =>
      request<PeriodStats>(
        `/analytics/period-stats?vehicle_id=${activeVehicle}&days=${daysB}`,
      ),
    enabled: !!activeVehicle,
  });

  // Section-level state flags — every data section owns its own loading /
  // empty / error branch instead of gating the whole page behind one guard.
  const bothLoading = statsA.isLoading || statsB.isLoading;
  const loadError = statsA.error ?? statsB.error;
  const a = statsA.data;
  const b = statsB.data;
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
      { key: 'distance', label: t('compare.totalDistance', 'Total Distance'), icon: <Car className="h-4 w-4" aria-hidden="true" />, a: distA, b: distB, unit: distanceUnit, color: 'cyan' as const },
      { key: 'drives', label: t('compare.totalDrives', 'Total Drives'), icon: <TrendingUp className="h-4 w-4" aria-hidden="true" />, a: a.total_drives ?? 0, b: b.total_drives ?? 0, unit: '', color: 'green' as const },
      { key: 'energy', label: t('compare.energyUsed', 'Energy Used'), icon: <Zap className="h-4 w-4" aria-hidden="true" />, a: a.energy_used ?? 0, b: b.energy_used ?? 0, unit: 'kWh', color: 'purple' as const },
      { key: 'efficiency', label: t('compare.avgEfficiency', 'Avg Efficiency'), icon: <Gauge className="h-4 w-4" aria-hidden="true" />, a: effA, b: effB, unit: efficiencyUnit, color: 'cyan' as const },
      { key: 'cost', label: t('compare.totalCost', 'Total Cost'), icon: <DollarSign className="h-4 w-4" aria-hidden="true" />, a: a.total_cost ?? 0, b: b.total_cost ?? 0, unit: '$', color: 'green' as const },
      { key: 'co2', label: t('compare.co2Saved', 'CO₂ Saved'), icon: <Leaf className="h-4 w-4" aria-hidden="true" />, a: a.co2_saved ?? 0, b: b.co2_saved ?? 0, unit: 'kg', color: 'purple' as const },
    ];
  }, [a, b, t, distanceUnit, efficiencyUnit]);

  const chartData = useMemo(
    () => metrics.map((m) => ({ name: m.label, A: m.a, B: m.b })),
    [metrics],
  );

  const tableRows: ComparisonRow[] = useMemo(
    () =>
      metrics.map((m) => {
        const delta = m.a - m.b;
        const pct = pctChange(m.a, m.b);
        return {
          metric: m.label,
          periodA: m.a,
          periodB: m.b,
          change: delta,
          pctChange: pct.value,
          positive: pct.positive,
        };
      }),
    [metrics],
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
        header: t('compare.periodA', 'Period A'),
        sortable: true,
        render: (r) => <Text variant="body" className="tabular-nums">{fmtNumber(r.periodA)}</Text>,
      },
      {
        key: 'periodB',
        header: t('compare.periodB', 'Period B'),
        sortable: true,
        render: (r) => <Text variant="body" className="tabular-nums">{fmtNumber(r.periodB)}</Text>,
      },
      {
        key: 'change',
        header: t('compare.change', 'Change'),
        sortable: true,
        render: (r) => (
          <Text variant="body" className={cn('tabular-nums', r.positive ? 'text-emerald-300' : 'text-rose-300')}>
            {r.positive ? '↑' : '↓'} {fmtNumber(Math.abs(r.change))}
          </Text>
        ),
      },
      {
        key: 'pctChange',
        header: t('compare.pctChange', '% Change'),
        render: (r) => (
          <Badge variant={r.positive ? 'success' : 'danger'} size="sm">
            {r.pctChange}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const insights = useMemo(() => {
    if (!a || !b) return [];
    const distPct = pctChange(a.total_distance ?? 0, b.total_distance ?? 0);
    const effPct = pctChange(a.avg_efficiency ?? 0, b.avg_efficiency ?? 0);
    const costPct = pctChange(a.total_cost ?? 0, b.total_cost ?? 0);
    return [
      t('compare.insightDistance', 'Distance traveled was {{pct}} {{dir}} in Period A vs Period B.', {
        pct: distPct.value,
        dir: distPct.positive ? t('compare.more', 'more') : t('compare.less', 'less'),
      }),
      t('compare.insightEfficiency', 'Efficiency {{dir}} by {{pct}} compared to Period B.', {
        pct: effPct.value,
        dir: effPct.positive ? t('compare.improved', 'improved') : t('compare.declined', 'declined'),
      }),
      t('compare.insightCost', 'Costs were {{pct}} {{dir}} in Period A.', {
        pct: costPct.value,
        dir: costPct.positive ? t('compare.higher', 'higher') : t('compare.lower', 'lower'),
      }),
    ];
  }, [a, b, t]);

  /* ── Toolbar (vehicle + both periods + refresh) ── */

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t('compare.vehicle', 'Vehicle')}
        options={vehicleOptions}
        value={activeVehicle}
        onChange={(e) => setVehicleId(e.target.value)}
        placeholder={t('compare.selectVehicle', 'Select vehicle')}
        className="w-full sm:w-44"
      />
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
      <Button
        variant="ghost"
        onClick={refetchAll}
        aria-label={t('compare.refresh', 'Refresh')}
        title={t('compare.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  /* ── Render ── */

  return (
    <PageContainer
      title={t('compare.title', 'Period Comparison')}
      subtitle={t('compare.subtitle', 'Compare key metrics across two time periods')}
      actions={actions}
      query={[statsA, statsB]}
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
              className="font-medium text-cyan-300 underline-offset-2 hover:underline"
            >
              {t('compare.banner.toFleetCta', 'Open Fleet comparison →')}
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

      {/* 1 — KPI band: full-width responsive metric grid (2 → 3 → 6 cols). */}
      <FadeIn delay={0.05}>
        <section aria-label={t('compare.kpis', 'Comparison metrics')}>
          {loadError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={loadError} onRetry={refetchAll} />
            </GlassPanel>
          ) : bothLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={92} />
              ))}
            </div>
          ) : metrics.length === 0 ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: transient empty state — surfaces when a vehicle/period pair has no source data */
                icon={<Calendar className="h-10 w-10" aria-hidden="true" />}
                message={t('compare.empty', 'Select a vehicle and two periods to compare.')}
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
              {metrics.map((m) => {
                const pct = pctChange(m.a, m.b);
                return (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={`${fmtNumber(m.a)} ${m.unit}`.trim()}
                    icon={m.icon}
                    color={m.color}
                    subtitle={`${t('compare.periodB', 'Period B')}: ${fmtNumber(m.b)} ${m.unit}`.trim()}
                    change={pct}
                  />
                );
              })}
            </div>
          )}
        </section>
      </FadeIn>

      {/* 2 — Primary bento: side-by-side chart (hero) + insights column. */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Side-by-side comparison — the hero, spans two of three columns. */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('compare.chartTitle', 'Side-by-Side Comparison')}
            </PanelTitle>
            {loadError ? (
              <QueryError error={loadError} onRetry={refetchAll} />
            ) : bothLoading ? (
              <Skeleton height={288} />
            ) : chartData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no comparable metrics until both periods load */
                icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
                message={t('compare.empty', 'Select a vehicle and two periods to compare.')}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={chartMarginLabeled}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.4}
                    />
                    <XAxis dataKey="name" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]} label={label as string} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="A"
                      name={t('compare.periodA', 'Period A')}
                      fill={palette[0]}
                      radius={[4, 4, 0, 0]}
                      {...chartAnimation}
                    />
                    <Bar
                      dataKey="B"
                      name={t('compare.periodB', 'Period B')}
                      fill={palette[1]}
                      radius={[4, 4, 0, 0]}
                      {...chartAnimation}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* Insights — plain-language deltas beside the chart on wide screens. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('compare.insights', 'Insights')}
            </PanelTitle>
            {loadError ? (
              <QueryError error={loadError} onRetry={refetchAll} />
            ) : bothLoading ? (
              <Skeleton lines={3} />
            ) : insights.length === 0 ? (
              <EmptyState /* no-action: transient empty state — insights derive from both periods' stats */
                icon={<Lightbulb className="h-8 w-8" aria-hidden="true" />}
                message={t('compare.insightsEmpty', 'Insights appear once both periods have data.')}
              />
            ) : (
              <ul className="space-y-2.5">
                {insights.map((line, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70"
                    />
                    <Text as="span" variant="bodySm">{line}</Text>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width comparison table. */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">
            {t('compare.tableTitle', 'Comparison Details')}
          </PanelTitle>
          {loadError ? (
            <QueryError error={loadError} onRetry={refetchAll} />
          ) : bothLoading ? (
            <Skeleton height={220} />
          ) : (
            <DataTable
              tableId="analytics:period-compare"
              columns={columns}
              data={tableRows}
              keyExtractor={(r) => r.metric}
              emptyMessage={t('compare.empty', 'Select a vehicle and two periods to compare.')}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
