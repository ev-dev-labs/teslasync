import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Battery, Thermometer, Lock, Shield, Wifi, Car,
  Gauge, Zap, TrendingUp, DollarSign, Leaf, Route,
  ArrowLeftRight, Info, Calendar, BarChart3,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Select, Button, DataTable,
  SectionTitle, PanelTitle, Text, Caption,
  type SelectOption, type Column,
} from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState, Skeleton, AlertBanner, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, ChartLegend, EmbeddedChart, AREA_DEFAULTS,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
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
    <Text
      as="span"
      weight="medium"
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        isWinner ? 'text-emerald-300' : 'text-[var(--text-primary)]',
      )}
    >
      {value}
      {/* ✓ pairs the winner color with a non-color signal (a11y). */}
      {isWinner && <span aria-hidden="true">✓</span>}
    </Text>
  );
}

// disambiguation banner dismissal is persisted so users
// who already understand the difference between the two compare pages don't
// have to dismiss it on every visit.
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.fleet';

/* ── Status Row (label + value line inside a status card) ── */

function StatusRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">{icon}</span>
        <Text as="span" size="sm" color="secondary" className="truncate">{label}</Text>
      </div>
      <div className="shrink-0 text-right">{children}</div>
    </div>
  );
}

/* ── Status Card Sub-component ─────────────────────────── */

function VehicleStatusCard({
  vehicle,
  state,
  isLoading,
  isError,
  error,
  onRetry,
  formatDistance,
  formatTemperature,
}: {
  vehicle: Vehicle | undefined;
  state: VehicleState | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  formatDistance: (value: number | null | undefined, precision?: number) => string;
  formatTemperature: (value: number | null | undefined, precision?: number) => string;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <Skeleton lines={5} />
      </GlassPanel>
    );
  }

  if (!vehicle) {
    return (
      <GlassPanel className="flex min-h-[16rem] items-center justify-center p-4 sm:p-5">
        <EmptyState
          /* no-action: transient empty state — surfaces before a vehicle is chosen */
          icon={<Car className="h-8 w-8" aria-hidden="true" />}
          message={t('comparison.selectVehicle', 'Select a vehicle')}
        />
      </GlassPanel>
    );
  }

  if (isError) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 truncate">{vehicle.display_name || vehicle.vin}</PanelTitle>
        <QueryError error={error} onRetry={onRetry} resourceName={t('comparison.vehicleState', 'Vehicle state')} />
      </GlassPanel>
    );
  }

  const batteryLevel = state?.battery_level ?? null;
  const range = state?.rated_range ?? null;
  const insideTemp = state?.inside_temp ?? null;
  const outsideTemp = state?.outside_temp ?? null;
  const isOnline = vehicle.state === 'online';

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
          isOnline ? 'bg-neon-green/10 ring-neon-green/20' : 'bg-white/[0.04] ring-white/[0.06]',
        )}>
          <Car className={cn('h-5 w-5', isOnline ? 'text-emerald-300' : 'text-[var(--text-muted)]')} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <PanelTitle className="truncate">{vehicle.display_name || vehicle.vin}</PanelTitle>
          <Caption className="block truncate">
            {vehicle.model}{vehicle.trim_badging ? ` · ${vehicle.trim_badging}` : ''}
          </Caption>
        </div>
      </div>

      <div className="space-y-3">
        {/* Battery */}
        <StatusRow icon={<Battery className="h-4 w-4" />} label={t('comparison.battery', 'Battery')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {batteryLevel != null ? `${batteryLevel}%` : '—'}
          </Text>
        </StatusRow>
        {batteryLevel != null && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-valuenow={Math.round(batteryLevel)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('comparison.batteryLevel', 'Battery level')}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                batteryLevel > 50 ? 'bg-emerald-500' : batteryLevel > 20 ? 'bg-amber-500' : 'bg-rose-500',
              )}
              /* dynamic computed width — allowed inline style */
              style={{ width: `${Math.min(Math.max(batteryLevel, 0), 100)}%` }}
            />
          </div>
        )}

        {/* Range */}
        <StatusRow icon={<Gauge className="h-4 w-4" />} label={t('comparison.range', 'Range')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {range != null ? formatDistance(range) : '—'}
          </Text>
        </StatusRow>

        {/* Temperature */}
        <StatusRow icon={<Thermometer className="h-4 w-4" />} label={t('comparison.temp', 'Temperature')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {insideTemp != null ? formatTemperature(insideTemp) : '—'}
            {outsideTemp != null ? ` / ${formatTemperature(outsideTemp)}` : ''}
          </Text>
        </StatusRow>

        {/* Lock & Sentry */}
        <StatusRow icon={<Lock className="h-4 w-4" />} label={t('comparison.security', 'Security')}>
          {state ? (
            <div className="flex items-center justify-end gap-2">
              <Text as="span" size="xs" weight="medium" className={state.is_locked ? 'text-emerald-300' : 'text-rose-300'}>
                {state.is_locked ? t('comparison.locked', 'Locked') : t('comparison.unlocked', 'Unlocked')}
              </Text>
              {state.sentry_mode && (
                <span className="inline-flex items-center gap-1 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-1.5 py-0.5 text-cyan-300">
                  <Shield className="h-3 w-3" aria-hidden="true" />
                  <Text as="span" size="2xs" weight="medium">{t('comparison.sentry', 'Sentry')}</Text>
                </span>
              )}
            </div>
          ) : (
            <Text as="span" size="xs" color="muted">—</Text>
          )}
        </StatusRow>

        {/* Status */}
        <StatusRow icon={<Wifi className="h-4 w-4" />} label={t('comparison.status', 'Status')}>
          <span className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5',
            isOnline
              ? 'border-neon-green/20 bg-neon-green/10 text-emerald-300'
              : 'border-white/[0.06] bg-white/[0.04] text-[var(--text-muted)]',
          )}>
            <Text as="span" size="xs" weight="medium" className="capitalize">
              {vehicle.state ?? t('comparison.unknown', 'Unknown')}
            </Text>
          </span>
        </StatusRow>
      </div>
    </GlassPanel>
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function FleetComparePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('comparison.title', 'Fleet Comparison'));

  const {
    unitPrefs,
    formatDistance: formatDistanceUnit,
    formatEnergy,
    formatTemperature: formatTemperatureUnit,
  } = useUnits();
  const formatDistance = useCallback(
    (value: number | null | undefined, precision?: number) => formatDistanceUnit(value, { precision }),
    [formatDistanceUnit],
  );
  const formatTemperature = useCallback(
    (value: number | null | undefined, precision?: number) => formatTemperatureUnit(value, { precision }),
    [formatTemperatureUnit],
  );
  const { currencySymbol, formatCurrency } = useFormatting();

  // i18n-safe "A vs B" comparison string for the KPI highlight cards — keeps the
  // connector word translatable rather than hardcoding " vs ".
  const vs = (a: string, b: string) =>
    t('comparison.versus', '{{valueA}} vs {{valueB}}', { valueA: a, valueB: b });

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `useDrivingStats` returns explicit-SI fields:
  // totalDistanceKm (km), avgSpeedKmh / topSpeedKmh (km/h), avgEfficiencyWhKm (Wh/km).
  // Convert through the SI boundary helpers so both preference unit choices render
  // correctly (never call the legacy mi/mph/Wh-per-mi converters).
  const KM_PER_MILE = 1.609344;
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * 1000) / 3600, speedUnit);
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // reactive chart palette (CB-safe / neon per user pref).
  const palette = useChartPalette();

  // accept "leftId" / "rightId" router query params so other
  // pages (e.g. VehicleListPage's "Compare vehicles" button) can deep-link
  // straight into a pre-populated comparison.
  const [searchParams] = useSearchParams();
  const initialLeftId = searchParams.get('leftId') ?? '';
  const initialRightId = searchParams.get('rightId') ?? '';

  const [vehicleIdA, setVehicleIdA] = useState<string>(initialLeftId);
  const [vehicleIdB, setVehicleIdB] = useState<string>(initialRightId);

  // Swap the two selected vehicles in place — keeps the comparison meaningful
  // when the user wants A and B reversed without re-picking both selectors.
  const swapVehicles = () => {
    setVehicleIdA(vehicleIdB);
    setVehicleIdB(vehicleIdA);
  };

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
  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data;
  const vehiclesLoading = vehiclesQuery.isLoading;
  // Stable reference: `vehicles ?? []` would allocate a new array every render,
  // re-running the auto-select effect and defeating the optionsA/optionsB memos.
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);

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
  const stateQueryA = useVehicleState(numIdA);
  const stateQueryB = useVehicleState(numIdB);
  const stateA = stateQueryA.data?.state;
  const stateB = stateQueryB.data?.state;

  /* ── Driving stats (lifetime) ── */
  const statsQueryA = useDrivingStats(vehicleIdA || undefined);
  const statsQueryB = useDrivingStats(vehicleIdB || undefined);
  const drivingStatsA = statsQueryA.data;
  const drivingStatsB = statsQueryB.data;

  /* ── Cost breakdown (lifetime) ── */
  const costQueryA = useCostBreakdown(vehicleIdA || '');
  const costQueryB = useCostBreakdown(vehicleIdB || '');
  const costA = costQueryA.data;
  const costB = costQueryB.data;

  /* ── Monthly mileage (for charts) ── */
  const monthlyQueryA = useMonthlyMileage(vehicleIdA || '');
  const monthlyQueryB = useMonthlyMileage(vehicleIdB || '');
  const monthlyA = monthlyQueryA.data;
  const monthlyB = monthlyQueryB.data;

  const isLoading = vehiclesLoading;
  const statsLoading = statsQueryA.isLoading || statsQueryB.isLoading;
  const monthlyLoading = monthlyQueryA.isLoading || monthlyQueryB.isLoading;
  const monthlyError = monthlyQueryA.error ?? monthlyQueryB.error;
  const retryMonthly = () => { monthlyQueryA.refetch(); monthlyQueryB.refetch(); };

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

  /* ── Monthly mileage chart data (merged & aligned) ──
     Backend `/mileage/monthly` returns
     `MonthlyMileageBucket{year_month, total_km, drive_count, …}`.
     Distances stay in km here — the chart axis already reads in km. */
  const monthlyChartData = useMemo(() => {
    const arrA = monthlyA ?? [];
    const arrB = monthlyB ?? [];
    const monthMap = new Map<string, { month: string; distA: number; distB: number; drivesA: number; drivesB: number }>();

    for (const m of arrA) {
      const ym = m.year_month ?? '';
      monthMap.set(ym, {
        month: ym,
        distA: m.total_km ?? 0,
        distB: 0,
        drivesA: m.drive_count ?? 0,
        drivesB: 0,
      });
    }
    for (const m of arrB) {
      const ym = m.year_month ?? '';
      const existing = monthMap.get(ym);
      if (existing) {
        existing.distB = m.total_km ?? 0;
        existing.drivesB = m.drive_count ?? 0;
      } else {
        monthMap.set(ym, {
          month: ym,
          distA: 0,
          distB: m.total_km ?? 0,
          drivesA: 0,
          drivesB: m.drive_count ?? 0,
        });
      }
    }

    return Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyA, monthlyB]);

  /* ── Drives per month (bar chart) ── */
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
    t, fromKm, fromKmh, whPerKmToDisplay, formatCurrency, formatEnergy,
    distanceUnit, speedUnit, efficiencyUnit, currencySymbol,
  ]);

  const tableColumns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('comparison.metric', 'Metric'),
        render: (r) => <Text as="span" weight="medium" color="primary">{r.metric}</Text>,
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

  // single-vehicle accounts can't usefully use Fleet Comparison. Show a
  // focused EmptyState that explains *why* and offers a path forward
  // (manage vehicles), instead of empty selectors with no data.
  if (!vehiclesLoading && vehicleList.length < 2) {
    return (
      <PageContainer
        title={t('comparison.title', 'Fleet Comparison')}
        subtitle={t('comparison.subtitle', 'Compare two vehicles side by side')}
      >
        <FadeIn>
          <GlassPanel className="p-6 sm:p-8">
            <EmptyState
              icon={<Car className="h-10 w-10" aria-hidden="true" />}
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
      query={[statsQueryA, statsQueryB]}
    >
      {/* Disambiguation banner — points users who wanted the period view to the
          right page. Persists dismissal in localStorage. */}
      {bannerVisible && (
        <FadeIn>
          <AlertBanner
            variant="info"
            icon={<Calendar className="h-4 w-4" aria-hidden="true" />}
            onClose={dismissBanner}
          >
            {t('comparison.banner.toPeriodPrefix', 'Looking to compare time periods instead?')}{' '}
            <Link
              to="/period-compare"
              className="font-medium text-cyan-300 underline-offset-2 hover:underline"
            >
              {t('comparison.banner.toPeriodCta', 'Open Period comparison →')}
            </Link>
          </AlertBanner>
        </FadeIn>
      )}

      {/* ── Vehicle selector toolbar ── */}
      <FadeIn>
        <section aria-label={t('comparison.selectVehicles', 'Select vehicles to compare')}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div className="min-w-0 flex-1">
                <Select
                  label={t('comparison.vehicleA', 'Vehicle A')}
                  options={optionsA}
                  value={vehicleIdA}
                  onChange={(e) => setVehicleIdA(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="flex justify-center sm:pb-1">
                <Button
                  variant="ghost"
                  aria-label={t('comparison.swap', 'Swap vehicles')}
                  onClick={swapVehicles}
                  disabled={!vehicleIdA || !vehicleIdB}
                  icon={<ArrowLeftRight className="h-4 w-4" aria-hidden="true" />}
                  className="h-11 w-11 shrink-0 px-0 text-[var(--text-secondary)]"
                />
              </div>
              <div className="min-w-0 flex-1">
                <Select
                  label={t('comparison.vehicleB', 'Vehicle B')}
                  options={optionsB}
                  value={vehicleIdB}
                  onChange={(e) => setVehicleIdB(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Key highlights (KPI band) ── */}
      <FadeIn delay={0.05}>
        <section aria-label={t('comparison.highlights', 'Key Highlights')} className="space-y-3">
          <SectionTitle>{t('comparison.highlights', 'Key Highlights')}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label={t('comparison.batteryDiff', 'Battery Level')}
              value={vs(`${stateA?.battery_level ?? '—'}%`, `${stateB?.battery_level ?? '—'}%`)}
              icon={<Battery className="h-4 w-4" aria-hidden="true" />}
              loading={(stateQueryA.isLoading && !!vehicleIdA) || (stateQueryB.isLoading && !!vehicleIdB)}
            />
            <StatCard
              label={t('comparison.efficiencyDiff', 'Avg Efficiency')}
              value={vs(
                fmtNumber(whPerKmToDisplay(drivingStatsA?.avgEfficiencyWhKm ?? 0)),
                fmtNumber(whPerKmToDisplay(drivingStatsB?.avgEfficiencyWhKm ?? 0)),
              )}
              unit={efficiencyUnit}
              icon={<Zap className="h-4 w-4" aria-hidden="true" />}
              loading={statsLoading}
            />
            <StatCard
              label={t('comparison.costDiff', 'Charging Cost')}
              value={vs(
                formatCurrency(costA?.total_charging_cost ?? 0, 0),
                formatCurrency(costB?.total_charging_cost ?? 0, 0),
              )}
              icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
              loading={costQueryA.isLoading || costQueryB.isLoading}
            />
            <StatCard
              label={t('comparison.co2Diff', 'CO₂ Saved')}
              value={vs(
                fmtNumber(drivingStatsA?.co2SavedKg ?? 0),
                fmtNumber(drivingStatsB?.co2SavedKg ?? 0),
              )}
              unit="kg"
              icon={<Leaf className="h-4 w-4" aria-hidden="true" />}
              loading={statsLoading}
            />
          </div>
        </section>
      </FadeIn>

      {/* ── Current status (side-by-side hero) ── */}
      <FadeIn delay={0.1}>
        <section aria-label={t('comparison.currentStatus', 'Current Status')} className="space-y-3">
          <SectionTitle>{t('comparison.currentStatus', 'Current Status')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5">
            <VehicleStatusCard
              vehicle={vehicleA}
              state={stateA}
              isLoading={stateQueryA.isLoading && !!vehicleIdA}
              isError={stateQueryA.isError && !!vehicleIdA}
              error={stateQueryA.error}
              onRetry={() => stateQueryA.refetch()}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            />
            <VehicleStatusCard
              vehicle={vehicleB}
              state={stateB}
              isLoading={stateQueryB.isLoading && !!vehicleIdB}
              isError={stateQueryB.isError && !!vehicleIdB}
              error={stateQueryB.error}
              onRetry={() => stateQueryB.refetch()}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            />
          </div>
        </section>
      </FadeIn>

      {/* ── Trends (charts bento) ── */}
      <FadeIn delay={0.15}>
        <section aria-label={t('comparison.trends', 'Trends over time')} className="space-y-3">
          <SectionTitle>{t('comparison.trends', 'Trends over time')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5">
            {/* Monthly distance overlay */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('comparison.monthlyDistance', 'Monthly Distance')}
              </PanelTitle>
              {monthlyLoading ? (
                <Skeleton height={260} />
              ) : monthlyError ? (
                <QueryError error={monthlyError} onRetry={retryMonthly} />
              ) : monthlyChartData.length === 0 ? (
                <EmptyState
                  /* no-action: transient empty state — no monthly rollups yet */
                  icon={<TrendingUp className="h-8 w-8" aria-hidden="true" />}
                  message={t('comparison.noMonthlyData', 'No monthly data available yet')}
                />
              ) : (
                <EmbeddedChart
                  title={t('comparison.monthlyDistance', 'Monthly Distance')}
                  ariaLabel={t('comparison.monthlyDistance.aria', 'Monthly distance comparison line chart between two vehicles')}
                  data={monthlyChartData}
                  dataColumns={[
                    { key: 'month', label: t('comparison.month', 'Month') },
                    { key: 'distA', label: nameA, format: (value) => fmtNumber(Number(value ?? 0)) },
                    { key: 'distB', label: nameB, format: (value) => fmtNumber(Number(value ?? 0)) },
                  ]}
                  height={288}
                  mobileHeight={256}
                  chartKey="fleet-compare-monthly-distance"
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
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
                        <ChartLegend />
                        <Line {...AREA_DEFAULTS} dataKey="distA" name={nameA} stroke={palette[0]} hide={hiddenSeries?.isHidden('distA')} {...chartAnimation} />
                        <Line {...AREA_DEFAULTS} dataKey="distB" name={nameB} stroke={palette[1]} hide={hiddenSeries?.isHidden('distB')} {...chartAnimation} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              )}
            </GlassPanel>

            {/* Drives per month */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('comparison.drivesPerMonth', 'Drives per Month')}
              </PanelTitle>
              {monthlyLoading ? (
                <Skeleton height={260} />
              ) : monthlyError ? (
                <QueryError error={monthlyError} onRetry={retryMonthly} />
              ) : drivesChartData.length === 0 ? (
                <EmptyState
                  /* no-action: transient empty state — no drive rollups yet */
                  icon={<Route className="h-8 w-8" aria-hidden="true" />}
                  message={t('comparison.noDrivesData', 'No drive data available yet')}
                />
              ) : (
                <EmbeddedChart
                  title={t('comparison.drivesPerMonth', 'Drives per Month')}
                  ariaLabel={t('comparison.drivesPerMonth.aria', 'Drives per month bar chart comparing two vehicles')}
                  data={drivesChartData}
                  dataColumns={[
                    { key: 'month', label: t('comparison.month', 'Month') },
                    { key: 'drivesA', label: nameA, format: (value) => fmtNumber(Number(value ?? 0)) },
                    { key: 'drivesB', label: nameB, format: (value) => fmtNumber(Number(value ?? 0)) },
                  ]}
                  height={288}
                  mobileHeight={256}
                  chartKey="fleet-compare-drives-per-month"
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={drivesChartData} margin={chartMarginLabeled}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="month" tick={axisTick} />
                        <YAxis tick={axisTick} allowDecimals={false} />
                        <Tooltip
                          content={({ active, payload, label }) => (
                            <ChartTooltip
                              active={active}
                              payload={payload as { name: string; value: unknown; color?: string; fill?: string; unit?: string }[]}
                              label={label as string}
                            />
                          )}
                        />
                        <ChartLegend />
                        <Bar dataKey="drivesA" name={nameA} fill={palette[0]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drivesA')} {...chartAnimation} />
                        <Bar dataKey="drivesB" name={nameB} fill={palette[1]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drivesB')} {...chartAnimation} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              )}
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* ── Lifetime statistics (detail band) ── */}
      <FadeIn delay={0.2}>
        <section aria-label={t('comparison.lifetimeStats', 'Lifetime statistics')} className="space-y-3">
          <SectionTitle>{t('comparison.lifetimeStats', 'Lifetime statistics')}</SectionTitle>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              <Caption>
                {t('comparison.lifetimeNote', 'Statistics shown are lifetime totals across all tracked data.')}
              </Caption>
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
        </section>
      </FadeIn>
    </PageContainer>
  );
}
