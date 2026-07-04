import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Zap, Leaf, Fuel, Sun, Moon, ArrowRight, Activity, Gauge,
  DollarSign, Route, BatteryCharging, CalendarDays, TrendingUp,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import {
  GlassPanel, DataTable, Badge, PanelTitle, Text, Caption,
  MetricLabel, HelperText, type Column,
} from '@/components/ui';
import {
  RadialGauge, ChartContainer, ChartLegend, ChartTooltip, ChartGradient,
  chartGrid, axisTickSm, renderAnnotationLines,
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, ReferenceLine,
  PieChart, Pie, Cell, Brush, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
  ChartTimeRangeProvider, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, QueryError, EmptyState, ChartBlockSkeleton, StatGridSkeleton, PageHeaderSkeleton } from '@/components/feedback';
import { Currency, SavedViewMenu, MetricCard } from '@/components/data-display';
import { RangePicker, VehicleSelect } from '@/components/forms';

import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlString } from '@/hooks/useUrlState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtPercent } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { chartTokens, neonColorMap, type NeonColor } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import type { ChargingSession } from '@/api/types';
import { convertDistanceFromSI, convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';

/* ── Local: Cost Comparison Card ────────────────────────────────── */

function CostComparisonCard({
  label, evCost, gasCost, icon,
}: {
  label: string; evCost: number; gasCost: number; icon: ReactNode;
}) {
  const { t } = useTranslation();
  const savings = (gasCost ?? 0) - (evCost ?? 0);
  const savingsPct = gasCost > 0 ? (savings / gasCost) * 100 : 0;
  const green = neonColorMap.green;
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', green.bg, green.ring)}>
          <span className={green.text} aria-hidden="true">{icon}</span>
        </div>
        <Text variant="subhead">{label}</Text>
      </div>
      <div className="mb-3 flex items-center gap-4">
        <div className="min-w-0">
          <MetricLabel>{t('energy.cost_decimal.evCost', 'EV Cost')}</MetricLabel>
          <Text as="p" size="lg" weight="bold" className="mt-0.5 text-cyan-300">
            <Currency value={evCost ?? 0} />
          </Text>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <div className="min-w-0">
          <MetricLabel>{t('energy.cost_decimal.gasEquivalent', 'Gas Equivalent')}</MetricLabel>
          <Text as="p" size="lg" weight="bold" color="secondary" className="mt-0.5">
            <Currency value={gasCost ?? 0} />
          </Text>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Text size="sm" weight="bold" className="text-emerald-300">
          {t('energy.cost_decimal.saving', 'Saving')} <Currency value={savings ?? 0} />
        </Text>
        <Text as="span" size="2xs" weight="semibold" className={cn('rounded-full px-2 py-0.5 ring-1', green.bg, green.text, green.ring)}>
          {fmtPercent(savingsPct ?? 0)} {t('energy.cost_decimal.less', 'less')}
        </Text>
      </div>
    </GlassPanel>
  );
}

/* ── Local: Lifetime metric box ─────────────────────────────────── */

function LifetimeStat({
  label, value, unit, desc, accent,
}: {
  label: string; value: string; unit?: string; desc: string; accent?: string;
}) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <MetricLabel>{label}</MetricLabel>
      <p className="mt-1 flex items-baseline gap-1">
        <Text size="2xl" weight="bold" className={cn('tabular-nums tracking-tight', accent ?? 'text-[var(--text-primary)]')}>
          {value}
        </Text>
        {unit && <Caption>{unit}</Caption>}
      </p>
      <HelperText className="mt-1">{desc}</HelperText>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

/**
 * Render-prop helper that subscribes the inner recharts chart to the
 * surrounding `<ChartTimeRangeProvider>`. The two daily-energy
 * panels share the same `daily_breakdown` dataset (matching `date` axis), so
 * they sync hover cursors and a persistent reference line through this helper.
 */
function EnergyChartSync({
  children, }: {
  children: (state: {
    sync: ReturnType<typeof useSyncedCursor>;
    syncedX: ReturnType<typeof useSyncedReferenceLineX>;
  }) => ReactNode;
}) {
  const sync = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  return <>{children({ sync, syncedX })}</>;
}

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the EnergyPage bento while data loads:
 * page header → 6-card KPI band → hero-gauge + lifetime bento →
 * 2 cost-comparison cards → 2 daily charts → 2 pattern charts → sessions table.
 */
function EnergyPageSkeleton() {
  return (
    <div className="space-y-6" data-testid="energy-page-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={6} className="sm:grid-cols-3 lg:grid-cols-6" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <Skeleton className="h-56 rounded-xl xl:col-span-2" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartBlockSkeleton height={280} />
        <ChartBlockSkeleton height={280} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartBlockSkeleton height={280} />
        <ChartBlockSkeleton height={280} />
      </div>
      <ChartBlockSkeleton height={320} />
    </div>
  );
}

export default function EnergyPage() {
  const { t } = useTranslation();
  usePageTitle(t('energy.title', 'Energy'));
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const toEnergyDisplay = (wh: number) => convertEnergyFromSI(wh, unitPrefs.energy);

  const distanceUnit = unitPrefs.distance;
  const energyUnit = unitPrefs.energy;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerM: number) => unitPrefs.distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000;
  const savedView = useSavedViewUrl();

  /* ── Vehicle selector ─────────────────────────────────────────── */
  const { vehicleId } = useSelectedVehicle();

  /* ── Date range ───────────────────────────────────────────────── */
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  /* URL-persisted hidden-series state for the two-series
     energy/efficiency composed chart. */
  const energyCostHidden = useHiddenSeries('energy-cost-daily');

  /* ── Data fetching ────────────────────────────────────────────── */
  const {
    data: stats, isLoading, error: statsError, refetch,
  } = useEnergyStats(vehicleId != null ? String(vehicleId) : null, 30);

  const { data: sessions } = useChargingSessionsPaginated(vehicleId, {
    limit: 100, start: startDate, end: endDate,
  });

  const { data: liveCharging } = useChargingTelemetryLatest(vehicleId ?? 0);

  /* ── Derived metrics ──────────────────────────────────────────── */
  const totalEnergy = sessions?.reduce((s, c) => s + (c.total_energy_added_wh ?? 0), 0) ?? 0;
  const totalCost = sessions?.reduce((s, c) => s + (c.cost_decimal ?? 0), 0) ?? 0;
  const avgEfficiency = stats?.avg_efficiency_wh_per_m ?? 0;
  const totalDistance = stats?.total_distance_m ?? 0;
  const co2Saved = stats?.co2_saved_kg ?? totalEnergy * 0.42;

  // Guard against hand-edited / malformed `from`/`to` URL params: an invalid
  // Date yields NaN which `Math.max(1, NaN)` propagates (NaN), corrupting every
  // downstream projection and the "Last {days} Days" labels. Fall back to the
  // 30-day default window instead.
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const periodDays = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(1, Math.ceil((endMs - startMs) / 86400000))
    : 30;
  const costPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;
  const costPerKwh = totalEnergy > 0 ? totalCost / (totalEnergy / 1000) : 0;
  // `total_distance_m` is SI meters post phase-42; convert to the user's display
  // distance before applying the per-unit gas estimate, otherwise the gas
  // "equivalent" balloons ~1000× (e.g. $24k for a 200 km month).
  const gasEquivalent = toDistanceDisplay(totalDistance) * 0.12;
  const monthlyProjectedCost = costPerKm > 0 ? costPerKm * (totalDistance / periodDays) * 30 : 0;
  const yearlyProjectedCost = monthlyProjectedCost * 12;

  const dailyEnergy = stats?.daily_breakdown ?? [];

  /* The API daily breakdown is SI (Wh, Wh/m, m). Convert once to the user's
     display units so both synced daily charts plot values that match their
     axis + legend labels (kWh, Wh/mi|Wh/km, mi|km) instead of raw SI. */
  const dailyChartData = useMemo(
    () =>
      dailyEnergy.map((d) => ({
        date: d.date,
        energy: convertEnergyFromSI(d.energy_wh ?? 0, energyUnit),
        efficiency: (d.efficiency_wh_per_m ?? 0) * (distanceUnit === 'mi' ? 1609.344 : 1000),
        distance: convertDistanceFromSI(d.distance_m ?? 0, distanceUnit),
      })),
    [dailyEnergy, energyUnit, distanceUnit],
  );

  /* ── No-data banner gate ───────────────────────────────────────────
   * Replay vehicles + brand-new accounts have no charging sessions and
   * no computed energy stats. Showing 4 RadialGauges all at 0 looks
   * like a perfectly efficient car using zero energy. Render an
   * honest empty hero instead of misleading zeros.
   */
  const hasNoEnergyData = useMemo(() => {
    const noSessions = !sessions || sessions.length === 0;
    const noStats = !stats || (
      (stats.total_wh ?? 0) === 0 &&
      (stats.total_energy_used_wh ?? 0) === 0 &&
      (stats.total_distance_m ?? 0) === 0
    );
    return noSessions && noStats;
  }, [sessions, stats]);

  /* ── Time-of-day analysis ─────────────────────────────────────── */
  const timeOfDayData = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const labels = [
      t('energy.timeOfDay.night', 'Night (0-6)'),
      t('energy.timeOfDay.morning', 'Morning (6-12)'),
      t('energy.timeOfDay.afternoon', 'Afternoon (12-18)'),
      t('energy.timeOfDay.evening', 'Evening (18-24)'),
    ];
    const buckets: Record<string, { count: number; energy: number }> = {};
    labels.forEach((l) => { buckets[l] = { count: 0, energy: 0 }; });
    sessions.forEach((s) => {
      const hour = new Date(s.started_at).getHours();
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[labels[idx]].count++;
      buckets[labels[idx]].energy += s.total_energy_added_wh ?? 0;
    });
    // Buckets accumulate SI watt-hours; expose the display-unit energy so the
    // "Energy (kWh)" bar plots values that match its label.
    return labels.map((name) => ({
      name,
      count: buckets[name].count,
      energy: convertEnergyFromSI(buckets[name].energy, energyUnit),
    }));
  }, [sessions, t, energyUnit]);

  /* ── Charger-type breakdown ───────────────────────────────────── */
  const chargerBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const types: Record<string, { count: number; energy: number; cost: number }> = {};
    // Stable internal grouping keys (also used for CHARGER_COLORS lookup + React keys).
    sessions.forEach((s) => {
      const key = s.charger_type?.toLowerCase().includes('tesla')
        ? 'Supercharger'
        : s.charger_type ? 'DC Fast' : 'Home/AC';
      if (!types[key]) types[key] = { count: 0, energy: 0, cost: 0 };
      types[key].count++;
      types[key].energy += s.total_energy_added_wh ?? 0;
      types[key].cost += s.cost_decimal ?? 0;
    });
    const chargerLabels: Record<string, string> = {
      Supercharger: t('energy.chargerType.supercharger', 'Supercharger'),
      'DC Fast': t('energy.chargerType.dcFast', 'DC Fast'),
      'Home/AC': t('energy.chargerType.homeAc', 'Home/AC'),
    };
    return Object.entries(types).map(([name, data]) => ({
      name,
      label: chargerLabels[name] ?? name,
      ...data,
      fill: CHARGER_COLORS[name] ?? '#00f0ff',
    }));
  }, [sessions, t]);

  /* ── Table columns ────────────────────────────────────────────── */
  const sessionColumns: Column<ChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      header: t('energy.table.date', 'Date'),
      render: (s) => (
        <Link to={`/charging/${s.id}`} className="text-[var(--text-secondary)] transition-colors hover:text-cyan-300">
          {formatDateShort(s.started_at)}
        </Link>
      ),
    },
    {
      key: 'energy',
      header: t('energy.table.energy', 'Energy'),
      render: (s) => (
        <Text weight="medium" className="text-cyan-300">
          {formatEnergy(s.total_energy_added_wh ?? 0)}
        </Text>
      ),
    },
    {
      key: 'battery',
      header: t('energy.table.battery', 'Battery'),
      render: (s) => (
        <>
          <Text color="muted">{s.start_soc_pct}%</Text>
          <Text color="muted" className="mx-1">→</Text>
          <Text className="text-emerald-300">{s.end_soc_pct ?? '—'}%</Text>
        </>
      ),
    },
    {
      key: 'power',
      header: t('energy.table.power', 'Power'),
      render: (s) => <>{s.peak_power_w != null ? `${fmtNumber(convertPowerFromSI(s.peak_power_w, 'kW'))} kW` : '—'}</>,
    },
    {
      key: 'type',
      header: t('energy.table.type', 'Type'),
      render: (s) => {
        const isTesla = s.charger_type?.toLowerCase().includes('tesla');
        const variant = isTesla ? 'danger' : s.charger_type ? 'warning' : 'success';
        const label = isTesla
          ? t('energy.chargerType.supercharger', 'Supercharger')
          : s.charger_type || t('energy.chargerType.ac', 'AC');
        return <Badge variant={variant} size="sm">{label}</Badge>;
      },
    },
    {
      key: 'cost',
      header: t('energy.table.cost_decimal', 'Cost'),
      render: (s) => <>{typeof s.cost_decimal === 'number' ? formatCurrency(s.cost_decimal) : '—'}</>,
    },
    {
      key: 'perKwh',
      header: t('energy.table.perKwh', '$/kWh'),
      render: (s) => (
        <Text color="muted">
          {typeof s.cost_decimal === 'number' && s.total_energy_added_wh > 0
            ? formatCurrency(s.cost_decimal / convertEnergyFromSI(s.total_energy_added_wh, 'kWh'))
            : '—'}
        </Text>
      ),
    },
  ], [t, formatCurrency, formatEnergy]);

  /* ── KPI band definition ──────────────────────────────────────── */
  const kpis: { key: string; label: string; value: string; icon: ReactNode; color: NeonColor }[] = [
    {
      key: 'costPerDist',
      label: t('energy.metric.costPerDist', { unit: distanceUnit, defaultValue: 'Cost per {{unit}}' }),
      value: formatCurrency(totalDistance > 0 ? totalCost / toDistanceDisplay(totalDistance) : 0),
      icon: <DollarSign className="h-4 w-4" />, color: 'cyan',
    },
    {
      key: 'costPerKwh',
      label: t('energy.metric.costPerKwh', 'Cost per kWh'),
      value: formatCurrency(costPerKwh ?? 0),
      icon: <Zap className="h-4 w-4" />, color: 'green',
    },
    {
      key: 'totalDistance',
      label: t('energy.metric.totalDistance', 'Total Distance'),
      value: `${fmtInt(toDistanceDisplay(totalDistance ?? 0))} ${distanceUnit}`,
      icon: <Route className="h-4 w-4" />, color: 'blue',
    },
    {
      key: 'sessions',
      label: t('energy.metric.sessions', 'Sessions'),
      value: `${sessions?.length ?? 0}`,
      icon: <BatteryCharging className="h-4 w-4" />, color: 'purple',
    },
    {
      key: 'monthlyEst',
      label: t('energy.metric.monthlyEst', 'Monthly Est.'),
      value: formatCurrency(monthlyProjectedCost ?? 0),
      icon: <CalendarDays className="h-4 w-4" />, color: 'amber',
    },
    {
      key: 'yearlyEst',
      label: t('energy.metric.yearlyEst', 'Yearly Est.'),
      value: formatCurrency(yearlyProjectedCost ?? 0),
      icon: <TrendingUp className="h-4 w-4" />, color: 'red',
    },
  ];

  /* ── Loading short-circuit ────────────────────────────────────── */
  if (isLoading) {
    return <EnergyPageSkeleton />;
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('energy.pageTitle', 'Energy Intelligence')}
      subtitle={t('energy.pageSubtitle', 'Deep cost analytics, efficiency trends, savings projections, and consumption patterns')}
      actions={
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
            align="end"
            triggerTestId="energy-range"
          />
          <SavedViewMenu
            route="/energy"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      {statsError && <QueryError error={statsError} onRetry={refetch} />}

      {/* ── KPI band ────────────────────────────────────────────── */}
      <section aria-label={t('energy.kpis', 'Key energy metrics')}>
        <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          {kpis.map((m) => (
            <StaggerItem key={m.key}>
              <MetricCard label={m.label} value={m.value} icon={m.icon} color={m.color} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      {/* ── Hero bento: gauges (primary) + lifetime (context) ───── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('energy.overview', 'Energy overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('energy.hero.title', 'Efficiency & Cost Overview')}
            </PanelTitle>
            {hasNoEnergyData ? (
              <EmptyState /* no-action: surfaces when no energy data exists yet — user must drive/charge to populate */
                icon={<Zap className="h-10 w-10" />}
                message={t('energy.empty.hero', 'No energy data yet — connect your vehicle and complete a drive or charging session to see efficiency, cost, and CO₂ savings.')}
              />
            ) : (
              <div className="grid grid-cols-2 items-center gap-4 sm:grid-cols-4 sm:gap-6">
                <RadialGauge
                  value={toEnergyDisplay(totalEnergy)}
                  max={Math.max(toEnergyDisplay(totalEnergy) * 1.3, 100)}
                  label={t('energy.gauge.energyUsed', 'Energy Used')}
                  unit={energyUnit}
                  color="#00f0ff"
                />
                <RadialGauge
                  value={toEfficiencyDisplay(avgEfficiency || (totalDistance > 0 ? totalEnergy / totalDistance : 0))}
                  max={toEfficiencyDisplay(300)}
                  label={t('energy.gauge.efficiency', 'Efficiency')}
                  unit={efficiencyUnit}
                  color="#10b981"
                />
                <RadialGauge
                  value={co2Saved}
                  max={Math.max(co2Saved * 1.5, 50)}
                  label={t('energy.gauge.co2Saved', 'CO₂ Saved')}
                  unit="kg"
                  color="#a855f7"
                />
                <RadialGauge
                  value={totalCost}
                  max={Math.max(totalCost * 1.5, 50)}
                  label={t('energy.gauge.totalCost', 'Total Cost')}
                  unit="$"
                  color="#f59e0b"
                />
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('energy.lifetime.title', 'Lifetime Metrics')}
            </PanelTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <LifetimeStat
                label={t('energy.lifetime.energyUsed', 'Lifetime Energy Used')}
                value={liveCharging?.lifetime_energy_used != null ? fmtNumber(liveCharging.lifetime_energy_used) : '—'}
                unit={liveCharging?.lifetime_energy_used != null ? 'kWh' : undefined}
                desc={t('energy.lifetime.energyUsedDesc', 'Total energy consumed since vehicle delivery')}
                accent={liveCharging?.lifetime_energy_used != null ? 'text-cyan-300' : 'text-[var(--text-muted)]'}
              />
              <LifetimeStat
                label={t('energy.lifetime.periodEnergy', { days: periodDays, defaultValue: 'Last {{days}} Days' })}
                value={fmtNumber(toEnergyDisplay(totalEnergy))}
                unit={energyUnit}
                desc={t('energy.lifetime.periodEnergyDesc', 'Energy added during selected date range')}
                accent="text-emerald-300"
              />
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Cost vs Gas Savings ─────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('energy.savings', 'Cost savings versus gas')}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <CostComparisonCard
            label={t('energy.cost_decimal.periodTotal', { days: periodDays, defaultValue: '{{days}}-Day Total' })}
            evCost={totalCost}
            gasCost={gasEquivalent}
            icon={<Fuel className="h-4 w-4" />}
          />
          <CostComparisonCard
            label={t('energy.cost_decimal.projectedAnnual', 'Projected Annual')}
            evCost={yearlyProjectedCost}
            gasCost={(gasEquivalent / periodDays) * 365}
            icon={<Leaf className="h-4 w-4" />}
          />
        </section>
      </FadeIn>

      {/* ── Charts Row 1: Energy & Cost Daily + Efficiency ────
          Both panels share the same `daily_breakdown` dataset (matching
          `date` axis), so they're wrapped in a single `<ChartTimeRangeProvider>`
          to mirror hover cursors and draw a persistent reference line on both
          at the last hovered date. */}
      <FadeIn delay={0.15}>
        <ChartTimeRangeProvider syncId="energy.daily">
          <section
            aria-label={t('energy.dailyCharts', 'Daily energy trends')}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            {/* chart-a11y:no-table dual-axis composed chart with brush; SR users can use Download CSV via the chart export menu */}
            <ChartContainer
              title={t('energy.chart.energyCostDaily', 'Energy & Cost Daily')}
              ariaLabel={t('energy.chart.energyCostDaily.aria', 'Daily energy and efficiency composed chart with bars and a line')}
              exportable
              exportFilename="energy-cost-daily"
              chartKey="energy-cost-daily"
              annotations={{ vehicleId, scope: 'energy', chartId: 'energy-cost-daily' }}
            >
              {({ annotations: chartAnnotations }) => (
                <div className="h-56 sm:h-64">
                  {dailyChartData.length > 0 ? (
                    <EnergyChartSync>
                      {({ sync, syncedX }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={dailyChartData}
                            syncId={sync.syncId}
                            syncMethod={sync.syncMethod}
                            onMouseMove={sync.onMouseMove}
                          >
                            <defs>
                              <ChartGradient id="energyBarGrad" color="#00f0ff" opacity={0.8} />
                            </defs>
                            {chartGrid}
                            <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <Tooltip content={<ChartTooltip />} />
                            <ChartLegend state={energyCostHidden} />
                            {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                            <Bar
                              yAxisId="left"
                              dataKey="energy"
                              name={t('energy.chart.energy', 'Energy')}
                              fill="url(#energyBarGrad)"
                              fillOpacity={0.6}
                              radius={[3, 3, 0, 0]}
                              animationDuration={800}
                              hide={energyCostHidden.isHidden('energy')}
                            />
                            <Line
                              {...AREA_DEFAULTS}
                              yAxisId="right"
                              dataKey="efficiency"
                              name={efficiencyUnit}
                              stroke="#10b981"
                              animationDuration={800}
                              hide={energyCostHidden.isHidden('efficiency')}
                            />
                            {syncedX != null && (
                              <ReferenceLine
                                yAxisId="left"
                                x={syncedX}
                                stroke={chartTokens.cursor.stroke}
                                strokeWidth={chartTokens.cursor.strokeWidth}
                                strokeDasharray={chartTokens.cursor.strokeDasharray}
                                ifOverflow="hidden"
                                isFront
                              />
                            )}
                            {dailyChartData.length > 14 && (
                              <Brush
                                dataKey="date"
                                height={20}
                                stroke="#6b7280"
                                fill="rgba(255,255,255,0.02)"
                                travellerWidth={8}
                              />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </EnergyChartSync>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Zap className="h-8 w-8" />}
                      message={t('energy.chart.noEnergyData', 'Connect vehicle to see energy data')}
                      className="py-8"
                    />
                  )}
                </div>
              )}
            </ChartContainer>

            {/* chart-a11y:no-table efficiency + distance two-area trend; same daily breakdown is exportable as CSV via the chart menu */}
            <ChartContainer
              title={t('energy.chart.efficiencyTrend', 'Efficiency Trend')}
              ariaLabel={t('energy.chart.efficiencyTrend.aria', 'Daily efficiency and distance area chart')}
              exportable
              exportFilename="efficiency-trend"
            >
              <div className="h-56 sm:h-64">
                {dailyChartData.length > 0 ? (
                  <EnergyChartSync>
                    {({ sync, syncedX }) => (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={dailyChartData}
                          syncId={sync.syncId}
                          syncMethod={sync.syncMethod}
                          onMouseMove={sync.onMouseMove}
                        >
                          <defs>
                            <ChartGradient id="effGrad" color="#10b981" opacity={0.3} />
                            <ChartGradient id="distGrad2" color="#00f0ff" opacity={0.15} />
                          </defs>
                          {chartGrid}
                          <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                          <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area
                            {...AREA_DEFAULTS}
                            dataKey="efficiency"
                            name={efficiencyUnit}
                            stroke="#10b981"
                            fill="url(#effGrad)"
                            animationDuration={800}
                          />
                          <Area
                            {...AREA_DEFAULTS}
                            dataKey="distance"
                            name={t('energy.chart.distance', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' })}
                            stroke="#00f0ff"
                            fill="url(#distGrad2)"
                            strokeWidth={1}
                            strokeDasharray="4 4"
                            animationDuration={800}
                          />
                          {syncedX != null && (
                            <ReferenceLine
                              x={syncedX}
                              stroke={chartTokens.cursor.stroke}
                              strokeWidth={chartTokens.cursor.strokeWidth}
                              strokeDasharray={chartTokens.cursor.strokeDasharray}
                              ifOverflow="hidden"
                              isFront
                            />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </EnergyChartSync>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                    icon={<Activity className="h-8 w-8" />}
                    message={t('energy.chart.noEfficiencyData', 'No efficiency data yet')}
                    className="py-8"
                  />
                )}
              </div>
            </ChartContainer>
          </section>
        </ChartTimeRangeProvider>
      </FadeIn>

      {/* ── Charts Row 2: Time of Day + Charger Breakdown ──── */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('energy.patternCharts', 'Charging patterns')}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          {/* chart-a11y:no-table aggregated time-of-day buckets bar chart; CSV download available */}
          <ChartContainer
            title={t('energy.chart.chargingByTime', 'Charging by Time of Day')}
            ariaLabel={t('energy.chart.chargingByTime.aria', 'Charging energy and session count by time of day bar chart')}
            exportable
            exportFilename="charging-by-time"
          >
            {timeOfDayData.length > 0 ? (
              <>
                <div className="h-44 sm:h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeOfDayData}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="energy"
                        name={t('energy.chart.energyKwh', 'Energy (kWh)')}
                        fill="#f59e0b"
                        fillOpacity={0.7}
                        radius={[3, 3, 0, 0]}
                        animationDuration={800}
                      />
                      <Bar
                        dataKey="count"
                        name={t('energy.chart.sessions', 'Sessions')}
                        fill="#a855f7"
                        fillOpacity={0.5}
                        radius={[3, 3, 0, 0]}
                        animationDuration={800}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Caption className="flex items-center gap-1">
                    <Moon className="h-3 w-3" aria-hidden="true" /> {t('energy.tip.offPeak', 'Off-peak charging saves money')}
                  </Caption>
                  <Caption className="flex items-center gap-1">
                    <Sun className="h-3 w-3" aria-hidden="true" /> {t('energy.tip.solar', 'Solar-optimal: 10am–3pm')}
                  </Caption>
                </div>
              </>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </ChartContainer>

          {/* chart-a11y:no-table charger-type pie-chart aggregation; CSV download available */}
          <ChartContainer
            title={t('energy.chart.chargerBreakdown', 'Charger Type Breakdown')}
            ariaLabel={t('energy.chart.chargerBreakdown.aria', 'Charger type share pie chart')}
            exportable
            exportFilename="charger-breakdown"
          >
            {chargerBreakdown.length > 0 ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <div className="h-40 w-40 shrink-0 sm:h-48 sm:w-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chargerBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="energy"
                        nameKey="label"
                      >
                        {chargerBreakdown.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full flex-1 space-y-3">
                  {chargerBreakdown.map((b) => (
                    <div key={b.name}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.fill }} aria-hidden="true" />
                          <Text size="sm" color="secondary">{b.label}</Text>
                        </span>
                        <Caption>
                          {b.count} {t('energy.breakdown.sessions', 'sessions')}
                        </Caption>
                      </div>
                      <div className="flex items-center justify-between">
                        <Text size="xs" className="text-cyan-300">{fmtNumber(toEnergyDisplay(b.energy ?? 0))} {energyUnit}</Text>
                        <Text size="xs" className="text-emerald-300"><Currency value={b.cost ?? 0} /></Text>
                        <Caption>
                          <Currency value={b.energy > 0 ? b.cost / (b.energy / 1000) : 0} precision={3} />/kWh
                        </Caption>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </ChartContainer>
        </section>
      </FadeIn>

      {/* ── Recent Charging Sessions ─────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {t('energy.sessions.title', 'Recent Charging Sessions')}
          </PanelTitle>
          {sessions && sessions.length > 0 ? (
            <DataTable
              tableId="battery:energy-sessions"
              columns={sessionColumns}
              data={sessions.slice(0, 15)}
              keyExtractor={(s) => s.id}
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8" />}
              message={t('energy.sessions.empty', 'No charging sessions recorded')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
