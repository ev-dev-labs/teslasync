import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Battery, Thermometer, Lock, Shield, Wifi, Car,
  Gauge, Zap, TrendingUp, DollarSign, Leaf, Route,
  ArrowLeftRight, Info, Calendar,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Select, type SelectOption, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState, Skeleton, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip, AREA_DEFAULTS,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar,
  chartMarginLabeled, axisTick, chartAnimation,
} from '@/components/charts';

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useCostBreakdown, useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { useChartPalette } from '@/hooks/useChartPalette';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '@/api/types';

/* ── Types ─────────────────────────────────────────────── */

type WinnerSemantic = 'higher' | 'lower' | 'neutral';

interface ComparisonRow {
  metric: string;
  valueA: string;
  valueB: string;
  rawA: number;
  rawB: number;
  winner: WinnerSemantic;
}

/* ── Helpers ───────────────────────────────────────────── */

function getWinner(a: number, b: number, semantic: WinnerSemantic): 'a' | 'b' | 'tie' {
  if (semantic === 'neutral' || a === b) return 'tie';
  if (semantic === 'higher') return a > b ? 'a' : 'b';
  return a < b ? 'a' : 'b';
}

function winnerCell(value: string, side: 'a' | 'b', row: ComparisonRow) {
  const winner = getWinner(row.rawA, row.rawB, row.winner);
  const isWinner = winner === side;
  return (
    <span className={cn(
      'font-medium',
      isWinner ? 'text-emerald-300' : 'text-[var(--text-primary)]',
    )}>
      {value}
      {isWinner && ' ✓'}
    </span>
  );
}

// Phase 40 / Prompt 39 — disambiguation banner dismissal is persisted so users
// who already understand the difference between the two compare pages don't
// have to dismiss it on every visit.
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.fleet';

/* ── Status Card Sub-component ─────────────────────────── */

function VehicleStatusCard({
  vehicle,
  state,
  isLoading,
  formatDistance,
  formatTemperature,
}: {
  vehicle: Vehicle | undefined;
  state: VehicleState | undefined;
  isLoading: boolean;
  formatDistance: (mi: number, d?: number) => string;
  formatTemperature: (c: number, d?: number) => string;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <GlassPanel className="p-5">
        <Skeleton lines={5} />
      </GlassPanel>
    );
  }

  if (!vehicle) {
    return (
      <GlassPanel className="p-5">
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Car className="h-8 w-8" />} message={t('comparison.selectVehicle', 'Select a vehicle')} />
      </GlassPanel>
    );
  }

  const batteryLevel = state?.battery_level ?? null;
  const range = state?.rated_range ?? null;
  const insideTemp = state?.inside_temp ?? null;
  const outsideTemp = state?.outside_temp ?? null;
  const isOnline = vehicle.state === 'online';

  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl', isOnline ? 'bg-neon-green/10 ring-1 ring-neon-green/20' : 'bg-white/[0.04] ring-1 ring-white/[0.06]', )}>
          <Car className={cn('h-5 w-5', isOnline ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">
            {vehicle.display_name || vehicle.vin}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            {vehicle.model} {vehicle.trim_badging ? `· ${vehicle.trim_badging}` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Battery */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Battery className="h-4 w-4 text-neon-green" />
            {t('comparison.battery', 'Battery')}
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {batteryLevel != null ? `${batteryLevel}%` : '—'}
          </span>
        </div>
        {batteryLevel != null && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn(
                'h-full rounded-full transition-all', batteryLevel > 50 ? 'bg-neon-green' : batteryLevel > 20 ? 'bg-neon-amber' : 'bg-neon-red', )}
              style={{ width: `${Math.min(batteryLevel, 100)}%` }}
            />
          </div>
        )}

        {/* Range */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Gauge className="h-4 w-4 text-neon-cyan" />
            {t('comparison.range', 'Range')}
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {range != null ? formatDistance(range) : '—'}
          </span>
        </div>

        {/* Temperature */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Thermometer className="h-4 w-4 text-neon-amber" />
            {t('comparison.temp', 'Temperature')}
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {insideTemp != null ? formatTemperature(insideTemp) : '—'}
            {outsideTemp != null ? ` / ${formatTemperature(outsideTemp)}` : ''}
          </span>
        </div>

        {/* Lock & Sentry */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Lock className="h-4 w-4 text-violet-400" />
            {t('comparison.security', 'Security')}
          </div>
          <div className="flex items-center gap-2">
            {state ? (
              <>
                <span className={cn('text-xs', state.is_locked ? 'text-emerald-300' : 'text-rose-300')}>
                  {state.is_locked ? t('comparison.locked', 'Locked') : t('comparison.unlocked', 'Unlocked')}
                </span>
                {state.sentry_mode && (
                  <span className="text-xs text-cyan-300">
                    <Shield className="inline h-3 w-3" /> {t('comparison.sentry', 'Sentry')}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">—</span>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Wifi className="h-4 w-4 text-sky-400" />
            {t('comparison.status', 'Status')}
          </div>
          <span className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium', isOnline ? 'bg-neon-green/10 text-neon-green' : 'bg-white/[0.04] text-[var(--text-muted)]', )}>
            {vehicle.state ?? t('comparison.unknown', 'Unknown')}
          </span>
        </div>
      </div>
    </GlassPanel>
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function FleetComparePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('comparison.title', 'Fleet Comparison'));

  const { unitPrefs, formatDistance: formatDistanceUnit, formatEnergy } = useUnits();
  const formatDistance = (value: number | null | undefined, precision?: number) => formatDistanceUnit(value, { precision });
  const { formatTemperature: formatTemperatureUnit } = useUnits();
  const formatTemperature = (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision });
  const { currencySymbol, formatCurrency } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `useDrivingStats` returns explicit-SI fields:
  //   totalDistanceKm (km), avgSpeedKmh / topSpeedKmh (km/h), avgEfficiencyWhKm (Wh/km)
  // Legacy toDistanceDisplay/toSpeedDisplay/toEfficiencyDisplay expect mi/mph/Wh-per-mi
  // input so calling them on these km values silently mis-renders for both pref
  // unit choices. Migrate to SI boundary helpers.
  const KM_PER_MILE = 1.609344;
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * 1000) / 3600, speedUnit);
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // Phase-45/23 — reactive chart palette (CB-safe / neon per user pref).
  const palette = useChartPalette();

  // Phase 40 / Prompt 39 — accept ?leftId= and ?rightId= query params so other
  // pages (e.g. VehicleListPage's "Compare vehicles" button) can deep-link
  // straight into a pre-populated comparison.
  const [searchParams] = useSearchParams();
  const initialLeftId = searchParams.get('leftId') ?? '';
  const initialRightId = searchParams.get('rightId') ?? '';

  const [vehicleIdA, setVehicleIdA] = useState<string>(initialLeftId);
  const [vehicleIdB, setVehicleIdB] = useState<string>(initialRightId);

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

  /* ── Vehicle list ── */
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicleList = vehicles ?? [];

  // Auto-select first two vehicles if not provided via query params.
  useEffect(() => {
    if (vehicleList.length >= 2) {
      if (!vehicleIdA) setVehicleIdA(String(vehicleList[0].id));
      if (!vehicleIdB) setVehicleIdB(String(vehicleList[1].id));
    } else if (vehicleList.length === 1 && !vehicleIdA) {
      setVehicleIdA(String(vehicleList[0].id));
    }
  }, [vehicleList, vehicleIdA, vehicleIdB]);

  const vehicleA = vehicleList.find(v => String(v.id) === vehicleIdA);
  const vehicleB = vehicleList.find(v => String(v.id) === vehicleIdB);
  const numIdA = vehicleA?.id ?? 0;
  const numIdB = vehicleB?.id ?? 0;

  /* ── Vehicle state (live) ── */
  const { data: stateDataA, isLoading: stateLoadingA } = useVehicleState(numIdA);
  const { data: stateDataB, isLoading: stateLoadingB } = useVehicleState(numIdB);
  const stateA = stateDataA?.state;
  const stateB = stateDataB?.state;

  /* ── Driving stats (lifetime) ── */
  const { data: drivingStatsA, isLoading: dStatsLoadA } = useDrivingStats(vehicleIdA || undefined);
  const { data: drivingStatsB, isLoading: dStatsLoadB } = useDrivingStats(vehicleIdB || undefined);

  /* ── Cost breakdown (lifetime) ── */
  const { data: costA } = useCostBreakdown(vehicleIdA || '');
  const { data: costB } = useCostBreakdown(vehicleIdB || '');

  /* ── Monthly mileage (for chart) ── */
  const { data: monthlyA } = useMonthlyMileage(vehicleIdA || '');
  const { data: monthlyB } = useMonthlyMileage(vehicleIdB || '');

  const isLoading = vehiclesLoading;
  const statsLoading = dStatsLoadA || dStatsLoadB;

  /* ── Select options with cross-disable ── */
  const optionsA: SelectOption[] = useMemo(
    () => vehicleList.map(v => ({
      value: String(v.id),
      label: v.display_name || v.vin,
      disabled: String(v.id) === vehicleIdB,
    })),
    [vehicleList, vehicleIdB],
  );

  const optionsB: SelectOption[] = useMemo(
    () => vehicleList.map(v => ({
      value: String(v.id),
      label: v.display_name || v.vin,
      disabled: String(v.id) === vehicleIdA,
    })),
    [vehicleList, vehicleIdA],
  );

  /* ── Monthly mileage chart data (merged & aligned) ── */
  const monthlyChartData = useMemo(() => {
    const arrA = monthlyA ?? [];
    const arrB = monthlyB ?? [];
    const monthMap = new Map<string, { month: string; distA: number; distB: number; drivesA: number; drivesB: number }>();

    for (const m of arrA) {
      monthMap.set(m.month, {
        month: m.month,
        distA: m.distance,
        distB: 0,
        drivesA: m.drives,
        drivesB: 0,
      });
    }
    for (const m of arrB) {
      const existing = monthMap.get(m.month);
      if (existing) {
        existing.distB = m.distance;
        existing.drivesB = m.drives;
      } else {
        monthMap.set(m.month, {
          month: m.month,
          distA: 0,
          distB: m.distance,
          drivesA: 0,
          drivesB: m.drives,
        });
      }
    }

    return Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyA, monthlyB]);

  /* ── Charging sessions chart (drives per month as bar chart) ── */
  const drivesChartData = useMemo(
    () => monthlyChartData.map(m => ({
      month: m.month,
      drivesA: m.drivesA,
      drivesB: m.drivesB,
    })),
    [monthlyChartData],
  );

  /* ── Comparison table rows ── */
  const nameA = vehicleA?.display_name ?? t('comparison.vehicleA', 'Vehicle A');
  const nameB = vehicleB?.display_name ?? t('comparison.vehicleB', 'Vehicle B');

  const comparisonRows: ComparisonRow[] = useMemo(() => {
    const dsA = drivingStatsA;
    const dsB = drivingStatsB;
    const cA = costA;
    const cB = costB;

    return [
      {
        metric: t('comparison.totalDrives', 'Total Drives'),
        valueA: fmtNumber(dsA?.totalDrives ?? 0),
        valueB: fmtNumber(dsB?.totalDrives ?? 0),
        rawA: dsA?.totalDrives ?? 0,
        rawB: dsB?.totalDrives ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.totalDistance', 'Total Distance'),
        valueA: `${fmtNumber(fromKm(dsA?.totalDistanceKm ?? 0))} ${distanceUnit}`,
        valueB: `${fmtNumber(fromKm(dsB?.totalDistanceKm ?? 0))} ${distanceUnit}`,
        rawA: dsA?.totalDistanceKm ?? 0,
        rawB: dsB?.totalDistanceKm ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.avgEfficiency', 'Avg Efficiency'),
        valueA: `${fmtNumber(whPerKmToDisplay(dsA?.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`,
        valueB: `${fmtNumber(whPerKmToDisplay(dsB?.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`,
        rawA: dsA?.avgEfficiencyWhKm ?? 0,
        rawB: dsB?.avgEfficiencyWhKm ?? 0,
        winner: 'lower' as WinnerSemantic,
      },
      {
        metric: t('comparison.avgSpeed', 'Avg Speed'),
        valueA: `${fmtNumber(fromKmh(dsA?.avgSpeedKmh ?? 0))} ${speedUnit}`,
        valueB: `${fmtNumber(fromKmh(dsB?.avgSpeedKmh ?? 0))} ${speedUnit}`,
        rawA: dsA?.avgSpeedKmh ?? 0,
        rawB: dsB?.avgSpeedKmh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.topSpeed', 'Top Speed'),
        valueA: `${fmtNumber(fromKmh(dsA?.topSpeedKmh ?? 0))} ${speedUnit}`,
        valueB: `${fmtNumber(fromKmh(dsB?.topSpeedKmh ?? 0))} ${speedUnit}`,
        rawA: dsA?.topSpeedKmh ?? 0,
        rawB: dsB?.topSpeedKmh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.regenRatio', 'Regen Ratio'),
        valueA: `${fmtNumber((dsA?.regenRatio ?? 0) * 100, 1)}%`,
        valueB: `${fmtNumber((dsB?.regenRatio ?? 0) * 100, 1)}%`,
        rawA: dsA?.regenRatio ?? 0,
        rawB: dsB?.regenRatio ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.co2Saved', 'CO₂ Saved'),
        valueA: `${fmtNumber(dsA?.co2SavedKg ?? 0)} kg`,
        valueB: `${fmtNumber(dsB?.co2SavedKg ?? 0)} kg`,
        rawA: dsA?.co2SavedKg ?? 0,
        rawB: dsB?.co2SavedKg ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.chargingCost', 'Charging Cost'),
        valueA: formatCurrency(cA?.total_charging_cost ?? 0, 0),
        valueB: formatCurrency(cB?.total_charging_cost ?? 0, 0),
        rawA: cA?.total_charging_cost ?? 0,
        rawB: cB?.total_charging_cost ?? 0,
        winner: 'lower' as WinnerSemantic,
      },
      {
        metric: t('comparison.totalEnergy', 'Total Energy'),
        valueA: formatEnergy(cA?.total_wh ?? 0),
        valueB: formatEnergy(cB?.total_wh ?? 0),
        rawA: cA?.total_wh ?? 0,
        rawB: cB?.total_wh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.chargeSessions', 'Charge Sessions'),
        valueA: fmtNumber(cA?.total_sessions ?? 0),
        valueB: fmtNumber(cB?.total_sessions ?? 0),
        rawA: cA?.total_sessions ?? 0,
        rawB: cB?.total_sessions ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
    ];
  }, [
    drivingStatsA, drivingStatsB, costA, costB,
    t, fromKm, fromKmh, whPerKmToDisplay,
    distanceUnit, speedUnit, efficiencyUnit, currencySymbol,
  ]);

  const tableColumns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('comparison.metric', 'Metric'),
        render: (r) => <span className="font-medium text-[var(--text-primary)]">{r.metric}</span>,
      },
      {
        key: 'valueA',
        header: nameA,
        render: (r) => winnerCell(r.valueA, 'a', r),
      },
      {
        key: 'valueB',
        header: nameB,
        render: (r) => winnerCell(r.valueB, 'b', r),
      },
    ],
    [t, nameA, nameB],
  );

  /* ── Render ── */

  // Phase 40 / Prompt 39 — single-vehicle accounts can't usefully use Fleet
  // Comparison. Show a focused EmptyState that explains *why* and offers a
  // path forward (manage vehicles), instead of empty selectors with no data.
  if (!vehiclesLoading && vehicleList.length < 2) {
    return (
      <PageContainer
        title={t('comparison.title', 'Fleet Comparison')}
        subtitle={t('comparison.subtitle', 'Compare two vehicles side by side')}
      >
        <FadeIn>
          <GlassPanel className="p-8">
            <EmptyState
              icon={<Car className="h-10 w-10" />}
              title={t('fleetCompare.singleVehicle.title', 'Add a second vehicle to compare')}
              message={t(
                'fleetCompare.singleVehicle.body',
                'Fleet comparison shows two vehicles side-by-side. You currently have one vehicle in TeslaSync.',
              )}
              action={{
                label: t('fleetCompare.singleVehicle.cta', 'Manage vehicles'),
                onClick: () => navigate('/vehicles'),
              }}
            />
          </GlassPanel>
        </FadeIn>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={t('comparison.title', 'Fleet Comparison')}
      subtitle={t('comparison.subtitle', 'Compare two vehicles side by side')}
      loading={isLoading}
    >
      {/* Disambiguation banner — points users who wanted the period view to
          the right page. Persists dismissal in localStorage. */}
      {bannerVisible && (
        <FadeIn>
          <AlertBanner
            variant="info"
            icon={<Calendar className="h-4 w-4" />}
            onClose={dismissBanner}
            className="mb-4"
          >
            {t(
              'comparison.banner.toPeriodPrefix',
              'Looking to compare time periods instead?',
            )}{' '}
            <Link
              to="/period-compare"
              className="font-medium text-neon-cyan underline-offset-2 hover:underline"
            >
              {t('comparison.banner.toPeriodCta', 'Open Period comparison →')}
            </Link>
          </AlertBanner>
        </FadeIn>
      )}

      {/* ── Vehicle Selectors ── */}
      <FadeIn>
        <GlassPanel className="mb-6 flex flex-wrap items-end gap-4 p-4">
          <Select
            label={t('comparison.vehicleA', 'Vehicle A')}
            options={optionsA}
            value={vehicleIdA}
            onChange={(e) => setVehicleIdA(e.target.value)}
            className="w-52"
          />
          <div className="flex items-center pb-2">
            <ArrowLeftRight className="h-5 w-5 text-[var(--text-muted)]" />
          </div>
          <Select
            label={t('comparison.vehicleB', 'Vehicle B')}
            options={optionsB}
            value={vehicleIdB}
            onChange={(e) => setVehicleIdB(e.target.value)}
            className="w-52"
          />
        </GlassPanel>
      </FadeIn>

      {/* ── Side-by-Side Status Cards ── */}
      <FadeIn delay={0.05}>
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t('comparison.currentStatus', 'Current Status')}
          </h2>
          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <VehicleStatusCard
              vehicle={vehicleA}
              state={stateA}
              isLoading={stateLoadingA && !!vehicleIdA}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            />
            <VehicleStatusCard
              vehicle={vehicleB}
              state={stateB}
              isLoading={stateLoadingB && !!vehicleIdB}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            />
          </Grid>
        </div>
      </FadeIn>

      {/* ── Monthly Distance Chart (overlaid) ── */}
      <FadeIn delay={0.1}>
        {/* chart-a11y:no-table multi-vehicle overlay — caller can compare via the underlying tables on each vehicle's page */}
        <ChartContainer
          title={t('comparison.monthlyDistance', 'Monthly Distance')}
          ariaLabel={t('comparison.monthlyDistance.aria', 'Monthly distance comparison line chart between two vehicles')}
          height={300}
        >
          {monthlyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyChartData} margin={chartMarginLabeled}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]}
                      label={label as string}
                    />
                  )}
                />
                <Legend />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="distA"
                  name={nameA}
                  stroke={palette[0]}
                  {...chartAnimation}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="distB"
                  name={nameB}
                  stroke={palette[1]}
                  {...chartAnimation}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<TrendingUp className="h-8 w-8" />} message={t('comparison.noMonthlyData', 'No monthly data available yet')} />
          )}
        </ChartContainer>
      </FadeIn>

      {/* ── Drives per Month (bar chart) ── */}
      <FadeIn delay={0.15}>
        <div className="mt-6">
          {/* chart-a11y:no-table multi-vehicle overlay — fleet rollup; SR users compare via per-vehicle pages */}
          <ChartContainer
            title={t('comparison.drivesPerMonth', 'Drives per Month')}
            ariaLabel={t('comparison.drivesPerMonth.aria', 'Drives per month bar chart comparing two vehicles')}
            height={280}
          >
            {drivesChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={drivesChartData} margin={chartMarginLabeled}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="month" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <Tooltip
                    content={({ active, payload, label }) => (
                      <ChartTooltip
                        active={active}
                        payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]}
                        label={label as string}
                      />
                    )}
                  />
                  <Legend />
                  <Bar dataKey="drivesA" name={nameA} fill={palette[0]} radius={[4, 4, 0, 0]} {...chartAnimation} />
                  <Bar dataKey="drivesB" name={nameB} fill={palette[1]} radius={[4, 4, 0, 0]} {...chartAnimation} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Route className="h-8 w-8" />} message={t('comparison.noDrivesData', 'No drive data available yet')} />
            )}
          </ChartContainer>
        </div>
      </FadeIn>

      {/* ── Lifetime Stats Comparison Table ── */}
      <FadeIn delay={0.2}>
        <div className="mt-6">
          <GlassPanel className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-muted)]" />
              <p className="text-xs text-[var(--text-muted)]">
                {t('comparison.lifetimeNote', 'Statistics shown are lifetime totals across all tracked data.')}
              </p>
            </div>
            {statsLoading ? (
              <Skeleton lines={8} />
            ) : (
              <DataTable
                tableId="analytics:fleet-compare"
                columns={tableColumns}
                data={comparisonRows}
                keyExtractor={(r) => r.metric}
                compact
              />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Quick Stat Cards (key differences) ── */}
      <FadeIn delay={0.25}>
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t('comparison.highlights', 'Key Highlights')}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('comparison.batteryDiff', 'Battery Level')}
              value={`${stateA?.battery_level ?? '—'}% vs ${stateB?.battery_level ?? '—'}%`}
              icon={<Battery className="h-4 w-4" />}
              loading={stateLoadingA || stateLoadingB}
            />
            <StatCard
              label={t('comparison.efficiencyDiff', 'Avg Efficiency')}
              value={`${fmtNumber(whPerKmToDisplay(drivingStatsA?.avgEfficiencyWhKm ?? 0))} vs ${fmtNumber(whPerKmToDisplay(drivingStatsB?.avgEfficiencyWhKm ?? 0))}`}
              unit={efficiencyUnit}
              icon={<Zap className="h-4 w-4" />}
              loading={statsLoading}
            />
            <StatCard
              label={t('comparison.costDiff', 'Charging Cost')}
              value={`${formatCurrency(costA?.total_charging_cost ?? 0, 0)} vs ${formatCurrency(costB?.total_charging_cost ?? 0, 0)}`}
              icon={<DollarSign className="h-4 w-4" />}
            />
            <StatCard
              label={t('comparison.co2Diff', 'CO₂ Saved')}
              value={`${fmtNumber(drivingStatsA?.co2SavedKg ?? 0)} vs ${fmtNumber(drivingStatsB?.co2SavedKg ?? 0)}`}
              unit="kg"
              icon={<Leaf className="h-4 w-4" />}
              loading={statsLoading}
            />
          </div>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
