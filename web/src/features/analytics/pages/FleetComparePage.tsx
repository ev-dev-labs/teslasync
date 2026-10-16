import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from '@/components/a11y';
import {
  Battery, Thermometer, Lock, Shield, Wifi, Car,
  Gauge, ArrowLeftRight, Info, Calendar,
} from 'lucide-react';

import { PageLayout, Section, CardGrid, LayoutCard } from '@/components/layout';
import {
  GlassPanel, Select, Button, DataTable,
  Text, Caption,
  type SelectOption, type Column,
} from '@/components/ui';
import { EmptyState, Skeleton, AlertBanner, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, ChartLegend, AREA_DEFAULTS,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
  chartMarginLabeled, axisTick, chartAnimation,
} from '@/components/charts';

import { useVehicles, useVehicleState, isVehicleStateFieldCurrent, resolveVehicleStateFreshness } from '@/api/hooks/useVehicles';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useCostBreakdown, useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI, formatEnergyPerDistance } from '@/lib/unitConversion';
import { useChartPalette } from '@/hooks/useChartPalette';

import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleStateReadings } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import {
  FleetTrendCard, formatKnown, getWinner,
  type ComparisonRow,
} from '../components/fleet-compare-modernization';
import { FleetComparisonBrief as FleetHighlights } from '../components/operationalbrief-a-m/FleetComparisonBrief';

/* ── Helpers ───────────────────────────────────────────── */

function winnerCell(value: string, side: 'a' | 'b', row: ComparisonRow, winnerLabel: string) {
  const winner = getWinner(row.rawA, row.rawB, row.winner);
  const isWinner = winner === side;
  return (
    <Text
      as="span"
      weight="medium"
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        isWinner ? severityTokens.success.fg : 'text-[var(--text-primary)]',
      )}
    >
      {value}
      {isWinner && <>
        <span aria-hidden="true">✓</span>
        <VisuallyHidden>{winnerLabel}</VisuallyHidden>
      </>}
    </Text>
  );
}

// disambiguation banner dismissal is persisted so users
// who already understand the difference between the two compare pages don't
// have to dismiss it on every visit.
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.fleet';

function comparisonState(state: VehicleStateReadings | undefined): VehicleStateReadings | undefined {
  if (!state) return undefined;
  const numeric = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? value : null;
  // Presence comes from the readings, not verifiedFields (which only attests freshness).
  return {
    ...state,
    battery_level: numeric(state.battery_level),
    rated_range: numeric(state.rated_range),
    inside_temp: numeric(state.inside_temp),
    outside_temp: numeric(state.outside_temp),
    is_locked: state.is_locked ?? null,
    sentry_mode: state.sentry_mode ?? null,
  };
}

/* ── Status Row (label + value line inside a status card) ── */

function StatusRow({
  icon,
  label,
  evidence,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  evidence?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <Text as="span" size="sm" color="secondary" className="break-words">{label}</Text>
          {evidence && <Caption className="block">{evidence}</Caption>}
        </div>
      </div>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

/* ── Status Card Sub-component ─────────────────────────── */

function VehicleStatusCard({
  vehicle,
  state,
  trust,
  isLoading,
  isError,
  error,
  onRetry,
  formatDistance,
  formatTemperature,
}: {
  vehicle: Vehicle | undefined;
  state: VehicleStateReadings | undefined;
  trust: ReturnType<typeof useVehicleState>['data'];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  formatDistance: (value: number | null | undefined, precision?: number) => string;
  formatTemperature: (value: number | null | undefined, precision?: number) => string;
}) {
  const { t } = useTranslation();
  const { formatRelativeTime } = useDateFormat();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const title = vehicle?.display_name || vehicle?.vin || t('comparison.selectVehicle', 'Select a vehicle');
  const unverified = t('dashboard.fleetPosture.category.unverified', 'Unverified');
  const fieldEvidence = (field: Parameters<typeof isVehicleStateFieldCurrent>[1]) =>
    trust?.live && isVehicleStateFieldCurrent(trust, field, now) ? undefined : unverified;
  const freshness = resolveVehicleStateFreshness(trust?.freshness, trust?.observedAt ?? null, now);

  if (isLoading && !state) {
    return (
      <LayoutCard title={title}>
        <Skeleton lines={5} />
      </LayoutCard>
    );
  }

  if (!vehicle) {
    return (
      <LayoutCard title={title}>
        <EmptyState
          /* no-action: transient empty state — surfaces before a vehicle is chosen */
          icon={<Car className="h-8 w-8" aria-hidden="true" />}
          message={t('comparison.selectVehicle', 'Select a vehicle')}
        />
      </LayoutCard>
    );
  }

  if (isError && !state) {
    return (
      <LayoutCard title={title}>
        <QueryError error={error} onRetry={onRetry} resourceName={t('comparison.vehicleState', 'Vehicle state')} />
      </LayoutCard>
    );
  }

  const batteryLevel = state?.battery_level ?? null;
  const range = state?.rated_range ?? null;
  const insideTemp = state?.inside_temp ?? null;
  const outsideTemp = state?.outside_temp ?? null;
  const isOnline = vehicle.state === 'online';

  return (
    <LayoutCard title={title}>
      <Caption className="block break-words">
        {vehicle.model}{vehicle.trim_badging ? ` · ${vehicle.trim_badging}` : ''}
      </Caption>
      <Caption className="block">
        {t('statusBar.connectionDiagnostics.telemetry', 'Telemetry stream')}{' · '}
        {trust?.observedAt != null
          ? t('dashboard.fleetPosture.scope.observed', 'Last real observation {{age}}', {
            age: formatRelativeTime(new Date(trust.observedAt)),
          })
          : t('dashboard.fleetPosture.scope.noObservation', 'No verified observation time for this vehicle')}
        {freshness === 'stale' ? ` · ${t('freshness.stale', 'Stale')}` : ''}
      </Caption>
      <Caption className="block">
        {t('vehicleHero.observationLimitation', 'Telemetry stream observation does not verify individual reading timestamps or completeness.')}
      </Caption>
      {isError && <QueryError error={error} onRetry={onRetry} resourceName={t('comparison.vehicleState', 'Vehicle state')} />}

      <div className="space-y-3">
        {/* Battery */}
        <StatusRow icon={<Battery className="h-4 w-4" />} label={t('comparison.battery', 'Battery')} evidence={fieldEvidence('battery_level')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {formatKnown(batteryLevel, value => `${value}%`)}
          </Text>
        </StatusRow>
        {batteryLevel != null && Number.isFinite(batteryLevel) && (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
            role="progressbar"
            aria-valuenow={Math.round(Math.min(Math.max(batteryLevel, 0), 100))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('comparison.batteryLevel', 'Battery level')}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all motion-reduce:transition-none',
                batteryLevel > 50 ? severityTokens.success.dot : batteryLevel > 20 ? severityTokens.warn.dot : severityTokens.critical.dot,
              )}
              /* dynamic computed width — allowed inline style */
              style={{ width: `${Math.min(Math.max(batteryLevel, 0), 100)}%` }}
            />
          </div>
        )}

        {/* Range */}
        <StatusRow icon={<Gauge className="h-4 w-4" />} label={t('comparison.range', 'Range')} evidence={fieldEvidence('rated_range')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {formatKnown(range, formatDistance)}
          </Text>
        </StatusRow>

        {/* Temperature */}
        <StatusRow icon={<Thermometer className="h-4 w-4" />} label={t('comparison.temp', 'Temperature')}
          evidence={fieldEvidence('inside_temp') ?? fieldEvidence('outside_temp')}>
          <Text as="span" size="sm" weight="medium" color="primary" className="tabular-nums">
            {formatKnown(insideTemp, formatTemperature)}
            {outsideTemp != null ? ` / ${formatKnown(outsideTemp, formatTemperature)}` : ''}
          </Text>
        </StatusRow>

        {/* Lock & Sentry */}
        <StatusRow icon={<Lock className="h-4 w-4" />} label={t('comparison.security', 'Security')}
          evidence={fieldEvidence('is_locked') ?? fieldEvidence('sentry_mode')}>
          <div className="flex items-center justify-end gap-2">
            <Text as="span" size="xs" weight="medium" className={cn(
              state?.is_locked == null ? 'text-[var(--text-muted)]' : state.is_locked ? severityTokens.success.fg : severityTokens.critical.fg,
            )}>
              {state?.is_locked == null ? '—' : state.is_locked ? t('comparison.locked', 'Locked') : t('comparison.unlocked', 'Unlocked')}
            </Text>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-primary)]">
              <Shield className="h-3 w-3" aria-hidden="true" />
              <Text as="span" size="xs" weight="medium">
                {state?.sentry_mode === true ? t('comparison.sentryOn', 'Sentry ON')
                  : state?.sentry_mode === false ? t('comparison.sentryOff', 'Sentry OFF')
                    : t('comparison.sentryUnknown', 'Sentry unknown')}
              </Text>
            </span>
          </div>
        </StatusRow>

        {/* Status */}
        <StatusRow icon={<Wifi className="h-4 w-4" />} label={t('comparison.status', 'Status')} evidence={unverified}>
          <span className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5',
            isOnline
              ? cn('border-[var(--border-default)] bg-[var(--surface-2)]', severityTokens.success.fg)
              : 'border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-muted)]',
          )}>
            <Text as="span" size="xs" weight="medium">
              {vehicle.state ?? t('comparison.unknown', 'Unknown')}
            </Text>
          </span>
        </StatusRow>
      </div>
    </LayoutCard>
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function FleetComparePage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('comparison.title', 'Fleet comparison'));

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
  // backend `useDrivingStats` returns explicit-SI fields:
  // totalDistanceKm (km), avgSpeedKmh / topSpeedKmh (km/h), avgEfficiencyWhKm (Wh/km).
  // Convert through the SI boundary helpers so both preference unit choices render
  // correctly (never call the legacy mi/mph/Wh-per-mi converters).
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * 1000) / 3600, speedUnit);
  const formatEfficiency = useCallback(
    (whPerKm: number) => formatEnergyPerDistance(whPerKm / 1000, unitPrefs),
    [unitPrefs],
  );

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
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

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

  useEffect(() => {
    if (!vehiclesQuery.isSuccess) return;
    const ids = vehicleList.map(vehicle => String(vehicle.id));
    const missing = [vehicleIdA, vehicleIdB].filter(id => id && !ids.includes(id));
    if (missing.length) {
      setUnavailableIds(previous => [...new Set([...previous, ...missing])]);
    }
    const validA = ids.includes(vehicleIdA) ? vehicleIdA : '';
    const validB = ids.includes(vehicleIdB) && vehicleIdB !== validA ? vehicleIdB : '';
    const nextA = validA || ids.find(id => id !== validB) || '';
    const nextB = validB || ids.find(id => id !== nextA) || '';
    if (nextA !== vehicleIdA) setVehicleIdA(nextA);
    if (nextB !== vehicleIdB) setVehicleIdB(nextB);
  }, [vehicleList, vehicleIdA, vehicleIdB, vehiclesQuery.isSuccess]);

  const vehicleA = vehicleList.find(v => String(v.id) === vehicleIdA);
  const vehicleB = vehicleList.find(v => String(v.id) === vehicleIdB);
  const numIdA = vehicleA?.id ?? 0;
  const numIdB = vehicleB?.id ?? 0;
  const resolvedIdA = vehicleA ? String(vehicleA.id) : '';
  const resolvedIdB = vehicleB && vehicleIdB !== vehicleIdA ? String(vehicleB.id) : '';

  /* ── Vehicle state (live) ── */
  const stateQueryA = useVehicleState(numIdA);
  const stateQueryB = useVehicleState(numIdB);
  const stateA = comparisonState(stateQueryA.data?.state);
  const stateB = comparisonState(stateQueryB.data?.state);

  /* ── Driving stats (lifetime) ── */
  const statsQueryA = useDrivingStats(resolvedIdA || undefined);
  const statsQueryB = useDrivingStats(resolvedIdB || undefined);
  const drivingStatsA = statsQueryA.data;
  const drivingStatsB = statsQueryB.data;

  /* ── Cost breakdown (lifetime) ── */
  const costQueryA = useCostBreakdown(resolvedIdA);
  const costQueryB = useCostBreakdown(resolvedIdB);
  const costA = costQueryA.data;
  const costB = costQueryB.data;

  /* ── Monthly mileage (for charts) ── */
  const monthlyQueryA = useMonthlyMileage(resolvedIdA);
  const monthlyQueryB = useMonthlyMileage(resolvedIdB);
  const monthlyA = monthlyQueryA.data;
  const monthlyB = monthlyQueryB.data;

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
     Convert only the derived chart values; query data stays in source km. */
  const monthlyChartData = useMemo(() => {
    const arrA = monthlyA ?? [];
    const arrB = monthlyB ?? [];
    const monthMap = new Map<string, { month: string; distA: number | null; distB: number | null; drivesA: number | null; drivesB: number | null }>();
    const known = (value: number | null | undefined) =>
      value != null && Number.isFinite(value) ? value : null;
    const displayDistance = (km: number | null | undefined) =>
      km != null && Number.isFinite(km) ? convertDistanceFromSI(km * 1000, distanceUnit) : null;

    for (const m of arrA) {
      const ym = m.year_month ?? '';
      monthMap.set(ym, {
        month: ym,
        distA: displayDistance(m.total_km),
        distB: null,
        drivesA: known(m.drive_count),
        drivesB: null,
      });
    }
    for (const m of arrB) {
      const ym = m.year_month ?? '';
      const existing = monthMap.get(ym);
      if (existing) {
        existing.distB = displayDistance(m.total_km);
        existing.drivesB = known(m.drive_count);
      } else {
        monthMap.set(ym, {
          month: ym,
          distA: null,
          distB: displayDistance(m.total_km),
          drivesA: null,
          drivesB: known(m.drive_count),
        });
      }
    }

    return Array.from(monthMap.values())
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyA, monthlyB, distanceUnit]);

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

  const comparisonRows = useMemo<ComparisonRow[]>(() => {
    const dsA = drivingStatsA;
    const dsB = drivingStatsB;
    const cA = costA;
    const cB = costB;

    // Lifetime responses do not establish comparable windows, exposure, or coverage.
    // Keep every reading, but do not turn quantity differences into winner verdicts.
    return [
      {
        metric: t('comparison.totalDrives', 'Total drives'),
        valueA: formatKnown(dsA?.totalDrives, fmtInt),
        valueB: formatKnown(dsB?.totalDrives, fmtInt),
        rawA: dsA?.totalDrives ?? null,
        rawB: dsB?.totalDrives ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.totalDistance', 'Total distance'),
        valueA: formatKnown(dsA?.totalDistanceKm, value => `${fmtNumber(fromKm(value))} ${distanceUnit}`),
        valueB: formatKnown(dsB?.totalDistanceKm, value => `${fmtNumber(fromKm(value))} ${distanceUnit}`),
        rawA: dsA?.totalDistanceKm ?? null,
        rawB: dsB?.totalDistanceKm ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.avgEfficiency', 'Avg efficiency'),
        valueA: formatKnown(dsA?.avgEfficiencyWhKm, formatEfficiency),
        valueB: formatKnown(dsB?.avgEfficiencyWhKm, formatEfficiency),
        rawA: dsA?.avgEfficiencyWhKm ?? null,
        rawB: dsB?.avgEfficiencyWhKm ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.avgSpeed', 'Avg speed'),
        valueA: formatKnown(dsA?.avgSpeedKmh, value => `${fmtNumber(fromKmh(value))} ${speedUnit}`),
        valueB: formatKnown(dsB?.avgSpeedKmh, value => `${fmtNumber(fromKmh(value))} ${speedUnit}`),
        rawA: dsA?.avgSpeedKmh ?? null,
        rawB: dsB?.avgSpeedKmh ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.topSpeed', 'Top speed'),
        valueA: formatKnown(dsA?.topSpeedKmh, value => `${fmtNumber(fromKmh(value))} ${speedUnit}`),
        valueB: formatKnown(dsB?.topSpeedKmh, value => `${fmtNumber(fromKmh(value))} ${speedUnit}`),
        rawA: dsA?.topSpeedKmh ?? null,
        rawB: dsB?.topSpeedKmh ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.regenRatio', 'Regen ratio'),
        valueA: formatKnown(dsA?.regenRatio, value => `${fmtNumber(value * 100)}%`),
        valueB: formatKnown(dsB?.regenRatio, value => `${fmtNumber(value * 100)}%`),
        rawA: dsA?.regenRatio ?? null,
        rawB: dsB?.regenRatio ?? null,
        winner: 'neutral',
      },
      {
        metric: t('comparison.co2Saved', 'Estimated CO₂ saved'),
        valueA: formatKnown(dsA?.co2SavedKg, value => `${fmtNumber(value)} kg`),
        valueB: formatKnown(dsB?.co2SavedKg, value => `${fmtNumber(value)} kg`),
        rawA: dsA?.co2SavedKg ?? null,
        rawB: dsB?.co2SavedKg ?? null,
        winner: 'neutral',
      },
      {
        metric: t('tco.kpis.recordedSpend', 'Recorded-cost spend'),
        valueA: formatKnown(cA?.total_charging_cost, formatCurrency),
        valueB: formatKnown(cB?.total_charging_cost, formatCurrency),
        rawA: cA?.total_charging_cost ?? null,
        rawB: cB?.total_charging_cost ?? null,
        winner: 'neutral',
      },
      {
        metric: t('tco.kpis.recordedEnergy', 'Recorded-cost energy'),
        valueA: formatKnown(cA?.total_wh, formatEnergy),
        valueB: formatKnown(cB?.total_wh, formatEnergy),
        rawA: cA?.total_wh ?? null,
        rawB: cB?.total_wh ?? null,
        winner: 'neutral',
      },
      {
        metric: t('tco.kpis.costedSessions', 'Costed sessions'),
        valueA: formatKnown(cA?.total_sessions, fmtInt),
        valueB: formatKnown(cB?.total_sessions, fmtInt),
        rawA: cA?.total_sessions ?? null,
        rawB: cB?.total_sessions ?? null,
        winner: 'neutral',
      },
    ];
  }, [
    drivingStatsA, drivingStatsB, costA, costB,
    t, fromKm, fromKmh, formatEfficiency, formatCurrency, formatEnergy,
    distanceUnit, speedUnit, currencySymbol, fmtNumber, fmtInt,
  ]);

  const tableColumns: Column<ComparisonRow>[] = useMemo(
    () => [
      {
        key: 'metric',
        header: t('comparison.metric', 'Metric'),
        exportValue: r => r.metric,
        render: (r) => <Text as="span" weight="medium" color="primary">{r.metric}</Text>,
      },
      {
        key: 'valueA',
        align: 'right',
        header: nameA,
        exportValue: r => r.valueA,
        render: (r) => winnerCell(r.valueA, 'a', r, t('driveCompare.winner', 'Winner')),
      },
      {
        key: 'valueB',
        align: 'right',
        header: nameB,
        exportValue: r => r.valueB,
        render: (r) => winnerCell(r.valueB, 'b', r, t('driveCompare.winner', 'Winner')),
      },
    ],
    [t, nameA, nameB],
  );

  /* ── Render ── */

  return (
    <PageLayout
      title={t('comparison.title', 'Fleet comparison')}
      subtitle={t('comparison.subtitle', 'Compare two vehicles side by side')}
      busy={vehiclesLoading}
      query={[vehiclesQuery, stateQueryA, stateQueryB, statsQueryA, statsQueryB, costQueryA, costQueryB, monthlyQueryA, monthlyQueryB]}
      dataSources={[
        { id: 'vehicles', label: t('comparison.selectVehicles', 'Select vehicles to compare'), query: vehiclesQuery },
        { id: 'state-a', label: `${nameA} · ${t('comparison.vehicleState', 'Vehicle state')}`, query: stateQueryA, enabled: numIdA > 0 },
        { id: 'state-b', label: `${nameB} · ${t('comparison.vehicleState', 'Vehicle state')}`, query: stateQueryB, enabled: numIdB > 0 },
        { id: 'stats-a', label: `${nameA} · ${t('comparison.lifetimeStats', 'Lifetime statistics')}`, query: statsQueryA, enabled: !!vehicleIdA },
        { id: 'stats-b', label: `${nameB} · ${t('comparison.lifetimeStats', 'Lifetime statistics')}`, query: statsQueryB, enabled: !!vehicleIdB },
        { id: 'cost-a', label: `${nameA} · ${t('tco.kpis.recordedSpend', 'Recorded-cost spend')}`, query: costQueryA, enabled: !!vehicleIdA },
        { id: 'cost-b', label: `${nameB} · ${t('tco.kpis.recordedSpend', 'Recorded-cost spend')}`, query: costQueryB, enabled: !!vehicleIdB },
        { id: 'monthly-a', label: `${nameA} · ${t('comparison.monthlyDistance', 'Monthly distance')}`, query: monthlyQueryA, enabled: !!vehicleIdA },
        { id: 'monthly-b', label: `${nameB} · ${t('comparison.monthlyDistance', 'Monthly distance')}`, query: monthlyQueryB, enabled: !!vehicleIdB },
      ]}
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
              className="font-medium text-[var(--text-primary)] underline underline-offset-2"
            >
              <span className="whitespace-nowrap">{t('comparison.banner.toPeriodCta', 'Open period comparison →')}</span>
            </Link>
          </AlertBanner>
        </FadeIn>
      )}

      {/* ── Vehicle selector toolbar ── */}
      <FadeIn>
        <Section id="fleet-compare-select" title={t('comparison.selectVehicles', 'Select vehicles to compare')}>
          <GlassPanel className="p-3 @[640px]:p-4">
            {unavailableIds.length > 0 && (
              <AlertBanner variant="warning" role="status" className="mb-3">
                {unavailableIds.map(id => (
                  <Text key={id} as="p">
                    {t('productPreferences.defaultVehicle.unavailable', 'Unavailable vehicle {{id}}', { id })}
                  </Text>
                ))}
              </AlertBanner>
            )}
            {vehiclesLoading && <Skeleton lines={2} />}
            {vehiclesQuery.isError && <QueryError error={vehiclesQuery.error} onRetry={() => vehiclesQuery.refetch()} />}
            {vehiclesQuery.isSuccess && vehicleList.length < 2 && (
              <EmptyState
                icon={<Car className="h-10 w-10" aria-hidden="true" />}
                title={t('fleetCompare.singleVehicle.title', 'Add a second vehicle to compare')}
                message={vehicleList.length === 1
                  ? t('fleetCompare.singleVehicle.body', 'Fleet comparison shows two vehicles side-by-side. You currently have one vehicle in TeslaSync.')
                  : t('comparison.noVehicles', 'Add vehicles to start a fleet comparison.')}
                action={{
                  label: t('fleetCompare.singleVehicle.cta', 'Manage vehicles'),
                  onClick: () => navigate('/vehicles'),
                }}
              />
            )}
            {vehicleList.length >= 2 && (
            <div className="flex flex-col gap-3 @[640px]:flex-row @[640px]:items-end @[640px]:gap-4">
              <div className="min-w-0 flex-1">
                <Select
                  label={t('comparison.vehicleA', 'Vehicle A')}
                  options={optionsA}
                  value={vehicleIdA}
                  onChange={(e) => setVehicleIdA(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="flex justify-center @[640px]:pb-1">
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
            )}
          </GlassPanel>
        </Section>
      </FadeIn>

      {/* ── Key highlights (KPI band) ── */}
      <FadeIn delay={0.05}>
        <Section
          id="fleet-compare-highlights-section"
          title={t('comparison.highlights', 'Key highlights')}
          description={t('tco.methodology.costedOnly', 'Charging totals include only sessions whose recorded cost is greater than zero; excluded free or missing-cost sessions cannot be counted from this response.')}
        >
          <FleetHighlights nameA={nameA} nameB={nameB} items={[
            {
              id: 'battery-pair',
              label: t('comparison.batteryDiff', 'Battery level'),
              metricId: 'percent', rawA: stateA?.battery_level, rawB: stateB?.battery_level,
              format: value => `${value}%`,
              retained: (stateA != null && (stateQueryA.isError || stateQueryA.fetchStatus === 'paused'))
                || (stateB != null && (stateQueryB.isError || stateQueryB.fetchStatus === 'paused'))
                || (stateA != null && (!stateQueryA.data?.live || !isVehicleStateFieldCurrent(stateQueryA.data, 'battery_level')))
                || (stateB != null && (!stateQueryB.data?.live || !isVehicleStateFieldCurrent(stateQueryB.data, 'battery_level'))),
              value: vs(formatKnown(stateA?.battery_level, value => `${value}%`), formatKnown(stateB?.battery_level, value => `${value}%`)),
              loading: (stateQueryA.isLoading || stateQueryB.isLoading) && !stateA && !stateB,
            },
            {
              id: 'efficiency-pair',
              label: t('comparison.efficiencyDiff', 'Avg efficiency'),
              metricId: 'efficiency',
              rawA: drivingStatsA?.avgEfficiencyWhKm != null ? drivingStatsA.avgEfficiencyWhKm / 1000 : null,
              rawB: drivingStatsB?.avgEfficiencyWhKm != null ? drivingStatsB.avgEfficiencyWhKm / 1000 : null,
              format: value => formatEnergyPerDistance(value, unitPrefs),
              retained: (drivingStatsA != null && (statsQueryA.isError || statsQueryA.fetchStatus === 'paused'))
                || (drivingStatsB != null && (statsQueryB.isError || statsQueryB.fetchStatus === 'paused')),
              value: vs(
                formatKnown(drivingStatsA?.avgEfficiencyWhKm, formatEfficiency),
                formatKnown(drivingStatsB?.avgEfficiencyWhKm, formatEfficiency),
              ),
              loading: statsLoading && !drivingStatsA && !drivingStatsB,
            },
            {
              id: 'cost-pair',
              label: t('tco.kpis.recordedSpend', 'Recorded-cost spend'),
              metricId: 'currency', rawA: costA?.total_charging_cost, rawB: costB?.total_charging_cost,
              format: formatCurrency,
              retained: (costA != null && (costQueryA.isError || costQueryA.fetchStatus === 'paused'))
                || (costB != null && (costQueryB.isError || costQueryB.fetchStatus === 'paused')),
              value: vs(formatKnown(costA?.total_charging_cost, formatCurrency), formatKnown(costB?.total_charging_cost, formatCurrency)),
              loading: (costQueryA.isLoading || costQueryB.isLoading) && !costA && !costB,
            },
            {
              id: 'co2-pair',
              label: t('comparison.co2Diff', 'Estimated CO₂ saved'),
              metricId: 'mass', rawA: drivingStatsA?.co2SavedKg, rawB: drivingStatsB?.co2SavedKg,
              format: value => `${fmtNumber(value)} kg`,
              retained: (drivingStatsA != null && (statsQueryA.isError || statsQueryA.fetchStatus === 'paused'))
                || (drivingStatsB != null && (statsQueryB.isError || statsQueryB.fetchStatus === 'paused')),
              value: `${vs(formatKnown(drivingStatsA?.co2SavedKg, fmtNumber), formatKnown(drivingStatsB?.co2SavedKg, fmtNumber))} kg`,
              loading: statsLoading && !drivingStatsA && !drivingStatsB,
            },
          ]} />
          <Caption className="block">
            {t('comparison.co2Context', 'CO₂ savings are a distance-based estimate using 0.07 kg per kilometre of recorded driving, not measured emissions. Values cover lifetime tracked drives; exact observation bounds and recording completeness are not supplied.')}
          </Caption>
        </Section>
      </FadeIn>

      {/* ── Current status (side-by-side hero) ── */}
      <FadeIn delay={0.1}>
        <Section id="fleet-compare-status" title={t('comparison.currentStatus', 'Current status')}>
          <CardGrid label={t('comparison.currentStatus', 'Current status')} items={[
            { id: 'vehicle-a', size: 'half', content: <VehicleStatusCard
              vehicle={vehicleA}
              state={stateA}
              trust={stateQueryA.data}
              isLoading={stateQueryA.isLoading && !!vehicleIdA}
              isError={stateQueryA.isError && !!vehicleIdA}
              error={stateQueryA.error}
              onRetry={() => stateQueryA.refetch()}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            /> },
            { id: 'vehicle-b', size: 'half', content: <VehicleStatusCard
              vehicle={vehicleB}
              state={stateB}
              trust={stateQueryB.data}
              isLoading={stateQueryB.isLoading && !!vehicleIdB}
              isError={stateQueryB.isError && !!vehicleIdB}
              error={stateQueryB.error}
              onRetry={() => stateQueryB.refetch()}
              formatDistance={formatDistance}
              formatTemperature={formatTemperature}
            /> },
          ]} />
        </Section>
      </FadeIn>

      {/* ── Trends (charts bento) ── */}
      <FadeIn delay={0.15}>
        <Section
          id="fleet-compare-trends"
          title={t('comparison.trends', 'Trends over time')}
          description={t(
            'comparison.trendContext.scope',
            'Monthly charts use the server’s default window starting 24 months ago, rounded to the start of that month. Distances are in km; lifetime statistics are not limited to this window.',
          ).replace(/\bkm\b/g, distanceUnit)}
        >
          <CardGrid label={t('comparison.trends', 'Trends over time')} items={[
            { id: 'monthly-distance', size: 'half', content: (
                <FleetTrendCard
                  hasData={monthlyChartData.length > 0}
                  loading={monthlyLoading}
                  error={monthlyError}
                  onRetry={retryMonthly}
                  emptyMessage={t('comparison.noMonthlyData', 'No monthly data available yet')}
                  title={t('comparison.monthlyDistance', 'Monthly distance')}
                  ariaLabel={t('comparison.monthlyDistanceAria', 'Monthly distance comparison line chart between two vehicles')}
                  data={monthlyChartData}
                  dataColumns={[
                    { key: 'month', label: t('comparison.month', 'Month') },
                    { key: 'distA', label: `${nameA} (${distanceUnit})`, format: (value) => formatKnown(typeof value === 'number' ? value : null, value => `${fmtNumber(value)} ${distanceUnit}`) },
                    { key: 'distB', label: `${nameB} (${distanceUnit})`, format: (value) => formatKnown(typeof value === 'number' ? value : null, value => `${fmtNumber(value)} ${distanceUnit}`) },
                  ]}
                  chartKey="fleet-compare-monthly-distance"
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyChartData} margin={chartMarginLabeled}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="month" tick={axisTick} />
                        <YAxis tick={axisTick} unit={` ${distanceUnit}`} />
                        <Tooltip
                          content={({ active, payload, label }) => (
                            <ChartTooltip
                              active={active}
                              payload={payload?.map(entry => ({
                                name: entry.name,
                                value: entry.value,
                                color: entry.color,
                                fill: entry.fill,
                                unit: typeof entry.unit === 'string' ? entry.unit : undefined,
                                dataKey: entry.dataKey,
                              }))}
                              label={typeof label === 'string' || typeof label === 'number' ? label : undefined}
                            />
                          )}
                        />
                        <ChartLegend />
                        <Line {...AREA_DEFAULTS} dataKey="distA" name={nameA} unit={` ${distanceUnit}`} stroke={palette[0]} connectNulls={false} hide={hiddenSeries?.isHidden('distA')} {...chartAnimation} />
                        <Line {...AREA_DEFAULTS} dataKey="distB" name={nameB} unit={` ${distanceUnit}`} stroke={palette[1]} connectNulls={false} hide={hiddenSeries?.isHidden('distB')} {...chartAnimation} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </FleetTrendCard>
            ) },
            { id: 'monthly-drives', size: 'half', content: (
                <FleetTrendCard
                  hasData={drivesChartData.length > 0}
                  loading={monthlyLoading}
                  error={monthlyError}
                  onRetry={retryMonthly}
                  emptyMessage={t('comparison.noDrivesData', 'No drive data available yet')}
                  title={t('comparison.drivesPerMonth', 'Drives per month')}
                  ariaLabel={t('comparison.drivesPerMonthAria', 'Drives per month bar chart comparing two vehicles')}
                  data={drivesChartData}
                  dataColumns={[
                    { key: 'month', label: t('comparison.month', 'Month') },
                    { key: 'drivesA', label: nameA, format: (value) => formatKnown(typeof value === 'number' ? value : null, fmtInt) },
                    { key: 'drivesB', label: nameB, format: (value) => formatKnown(typeof value === 'number' ? value : null, fmtInt) },
                  ]}
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
                              payload={payload?.map(entry => ({
                                name: entry.name,
                                value: entry.value,
                                color: entry.color,
                                fill: entry.fill,
                                unit: typeof entry.unit === 'string' ? entry.unit : undefined,
                                dataKey: entry.dataKey,
                              }))}
                              label={typeof label === 'string' || typeof label === 'number' ? label : undefined}
                              valueFormatter={(value) => formatKnown(typeof value === 'number' ? value : null, fmtInt)}
                            />
                          )}
                        />
                        <ChartLegend />
                        <Bar dataKey="drivesA" name={nameA} fill={palette[0]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drivesA')} {...chartAnimation} />
                        <Bar dataKey="drivesB" name={nameB} fill={palette[1]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drivesB')} {...chartAnimation} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </FleetTrendCard>
            ) },
          ]} />
        </Section>
      </FadeIn>

      {/* ── Lifetime statistics (detail band) ── */}
      <FadeIn delay={0.2}>
        <Section id="fleet-compare-lifetime" title={t('comparison.lifetimeStats', 'Lifetime statistics')}>
          <GlassPanel className="min-w-0 p-3 @[640px]:p-4">
            <div className="mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              <div className="min-w-0">
                <Caption className="block">
                  {t('comparison.co2Context', 'CO₂ savings are a distance-based estimate using 0.07 kg per kilometre of recorded driving, not measured emissions. Values cover lifetime tracked drives; exact observation bounds and recording completeness are not supplied.')}
                </Caption>
                <Caption className="block">
                  {t('tco.methodology.costedOnly', 'Charging totals include only sessions whose recorded cost is greater than zero; excluded free or missing-cost sessions cannot be counted from this response.')}
                </Caption>
                <Caption className="block">
                  {t('tco.methodology.scopeMismatch', 'Charging spend and energy use a different filter and temporal scope from positive-drive distance and dates.')}
                </Caption>
              </div>
            </div>
            {vehiclesLoading || (statsLoading && !drivingStatsA && !drivingStatsB && !costA && !costB) ? (
              <Skeleton lines={8} />
            ) : !vehicleA || !vehicleB ? (
              <EmptyState
                /* no-action: choose the comparison vehicles in the existing controls above */
                message={t('comparison.selectVehicle', 'Select a vehicle')}
              />
            ) : (
              <DataTable
                tableId="analytics:fleet-compare"
                variant="embedded"
                resizable={false}
                columnReorder={false}
                columnVisibility={false}
                columns={tableColumns}
                mobileColumns={['metric', 'valueA', 'valueB']}
                mobilePresentation={{
                  variant: 'keyValue',
                  roles: { metric: 'title', valueA: 'primary', valueB: 'meta' },
                  displayValue: (row, key) => key === 'metric' ? row.metric : key === 'valueA' ? row.valueA : key === 'valueB' ? row.valueB : null,
                  allDetails: row => [
                    { key: 'metric', label: t('comparison.metric', 'Metric'), value: row.metric },
                    { key: 'valueA', label: nameA, value: winnerCell(row.valueA, 'a', row, t('driveCompare.winner', 'Winner')) },
                    { key: 'valueB', label: nameB, value: winnerCell(row.valueB, 'b', row, t('driveCompare.winner', 'Winner')) },
                  ],
                }}
                data={comparisonRows}
                keyExtractor={(r) => r.metric}
                compact
              />
            )}
          </GlassPanel>
        </Section>
      </FadeIn>
    </PageLayout>
  );
}
