import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Car, Calendar, TrendingUp, Zap, Gauge, DollarSign, Leaf, Lightbulb, ArrowLeftRight,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select, type SelectOption, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
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

// Phase 40 / Prompt 39 — disambiguation banner dismissal is persisted so users
// who already understand the difference between the two compare pages don't
// have to dismiss it on every visit. Two separate keys (period|fleet) so each
// page tracks its own banner.
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

  // Phase-45/23 — reactive chart palette (CB-safe / neon per user pref).
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

  const isLoading = statsA.isLoading || statsB.isLoading;
  const error = statsA.error ?? statsB.error;
  const a = statsA.data;
  const b = statsB.data;

  // Hide the disambiguation banner for accounts with only one vehicle —
  // they can't usefully cross-navigate to fleet comparison anyway.
  const vehicleCount = (vehicles ?? []).length;
  useEffect(() => {
    if (vehicleCount < 2 && bannerVisible) {
      setBannerVisible(false);
    }
  }, [vehicleCount, bannerVisible]);

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
    const distA = convertDistanceFromSI(a.total_distance * METERS_PER_KM, distanceUnit);
    const distB = convertDistanceFromSI(b.total_distance * METERS_PER_KM, distanceUnit);
    const effA = distanceUnit === 'mi' ? a.avg_efficiency * KM_PER_MILE : a.avg_efficiency;
    const effB = distanceUnit === 'mi' ? b.avg_efficiency * KM_PER_MILE : b.avg_efficiency;
    return [
      { key: 'distance', label: t('compare.totalDistance', 'Total Distance'), icon: <Car className="h-4 w-4" />, a: distA, b: distB, unit: distanceUnit, color: 'cyan' as const },
      { key: 'drives', label: t('compare.totalDrives', 'Total Drives'), icon: <TrendingUp className="h-4 w-4" />, a: a.total_drives, b: b.total_drives, unit: '', color: 'green' as const },
      { key: 'energy', label: t('compare.energyUsed', 'Energy Used'), icon: <Zap className="h-4 w-4" />, a: a.energy_used, b: b.energy_used, unit: 'kWh', color: 'purple' as const },
      { key: 'efficiency', label: t('compare.avgEfficiency', 'Avg Efficiency'), icon: <Gauge className="h-4 w-4" />, a: effA, b: effB, unit: efficiencyUnit, color: 'cyan' as const },
      { key: 'cost', label: t('compare.totalCost', 'Total Cost'), icon: <DollarSign className="h-4 w-4" />, a: a.total_cost, b: b.total_cost, unit: '$', color: 'green' as const },
      { key: 'co2', label: t('compare.co2Saved', 'CO₂ Saved'), icon: <Leaf className="h-4 w-4" />, a: a.co2_saved, b: b.co2_saved, unit: 'kg', color: 'purple' as const },
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
        render: (r) => <span className="font-medium">{r.metric}</span>,
      },
      {
        key: 'periodA',
        header: t('compare.periodA', 'Period A'),
        sortable: true,
        render: (r) => fmtNumber(r.periodA),
      },
      {
        key: 'periodB',
        header: t('compare.periodB', 'Period B'),
        sortable: true,
        render: (r) => fmtNumber(r.periodB),
      },
      {
        key: 'change',
        header: t('compare.change', 'Change'),
        sortable: true,
        render: (r) => (
          <span className={cn(r.positive ? 'text-emerald-300' : 'text-rose-300')}>
            {r.positive ? '↑' : '↓'} {fmtNumber(Math.abs(r.change))}
          </span>
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
    const distPct = pctChange(a.total_distance, b.total_distance);
    const effPct = pctChange(a.avg_efficiency, b.avg_efficiency);
    const costPct = pctChange(a.total_cost, b.total_cost);
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

  /* ── Render ── */

  return (
    <PageContainer
      title={t('compare.title', 'Period Comparison')}
      subtitle={t('compare.subtitle', 'Compare key metrics across two time periods')}
      loading={isLoading}
      error={error as Error | null}
    >
      {/* Disambiguation banner — points users who wanted the fleet view to the
          right page. Hidden for single-vehicle accounts and once dismissed. */}
      {bannerVisible && (
        <FadeIn>
          <AlertBanner
            variant="info"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            onClose={dismissBanner}
            className="mb-4"
          >
            {t(
              'compare.banner.toFleetPrefix',
              'Looking to compare two vehicles instead?',
            )}{' '}
            <Link
              to="/vehicle-comparison"
              className="font-medium text-neon-cyan underline-offset-2 hover:underline"
            >
              {t('compare.banner.toFleetCta', 'Open Fleet comparison →')}
            </Link>
          </AlertBanner>
        </FadeIn>
      )}

      {/* Selectors */}
      <FadeIn>
        <GlassPanel className="mb-6 flex flex-wrap items-end gap-4 p-4">
          <Select
            label={t('compare.vehicle', 'Vehicle')}
            options={vehicleOptions}
            value={activeVehicle}
            onChange={(e) => setVehicleId(e.target.value)}
            className="w-48"
          />
          <Select
            label={t('compare.periodA', 'Period A')}
            options={periodOptions}
            value={periodA}
            onChange={(e) => setPeriodA(e.target.value as PeriodValue)}
            className="w-44"
          />
          <Select
            label={t('compare.periodB', 'Period B')}
            options={periodOptions}
            value={periodB}
            onChange={(e) => setPeriodB(e.target.value as PeriodValue)}
            className="w-44"
          />
        </GlassPanel>
      </FadeIn>

      {!a || !b ? (
        isLoading ? (
          <Skeleton lines={6} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Calendar className="h-10 w-10" />}
            message={t('compare.empty', 'Select a vehicle and two periods to compare.')}
          />
        )
      ) : (
        <>
          {/* Metric cards */}
          <FadeIn delay={0.05}>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((m) => {
                const pct = pctChange(m.a, m.b);
                return (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={`${fmtNumber(m.a)} ${m.unit}`}
                    icon={m.icon}
                    color={m.color}
                    subtitle={`${t('compare.periodB', 'Period B')}: ${fmtNumber(m.b)} ${m.unit}`}
                    change={pct}
                  />
                );
              })}
            </div>
          </FadeIn>

          {/* Bar chart */}
          <FadeIn delay={0.1}>
            <GlassPanel className="mb-6 p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t('compare.chartTitle', 'Side-by-Side Comparison')}
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={chartMarginLabeled}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis dataKey="name" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <Tooltip content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]} label={label as string} />} />
                  <Legend />
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
            </GlassPanel>
          </FadeIn>

          {/* Data table */}
          <FadeIn delay={0.15}>
            <GlassPanel className="mb-6 p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t('compare.tableTitle', 'Comparison Details')}
              </p>
              <DataTable
                tableId="analytics:period-compare"
                columns={columns}
                data={tableRows}
                keyExtractor={(r) => r.metric}
                compact
                pagination
              />
            </GlassPanel>
          </FadeIn>

          {/* Insights */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-neon-amber" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {t('compare.insights', 'Insights')}
                </p>
              </div>
              <ul className="space-y-1.5">
                {insights.map((line, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-[var(--text-secondary)]"
                  >
                    • {line}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
