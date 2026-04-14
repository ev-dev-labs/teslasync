import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar, ChevronLeft, ChevronRight, Car, Zap, Battery,
  AlertTriangle, TrendingUp, TrendingDown, Fuel, Leaf,
  MapPin, Clock, Activity, BarChart3, Info, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, CHART_COLORS,
  chartGrid, axisTickSm, chartMarginLabeled, chartAnimation,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { STATUS_COLORS } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ─── Types ───────────────────────────────────────────────────────── */

interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

interface ChargingSession {
  id: number;
  start_date: string;
  charge_energy_added: number;
  cost: number;
  duration_min: number;
  start_battery_level: number;
  end_battery_level: number;
}

interface Alert {
  id: number;
  severity: string;
  created_at: string;
}

/* ─── Constants ───────────────────────────────────────────────────── */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const CITY_PAIRS = [
  { from: 'New York', to: 'Boston', km: 350 },
  { from: 'LA', to: 'San Francisco', km: 615 },
  { from: 'London', to: 'Paris', km: 460 },
  { from: 'Berlin', to: 'Munich', km: 585 },
  { from: 'Sydney', to: 'Melbourne', km: 880 },
  { from: 'Tokyo', to: 'Osaka', km: 515 },
] as const;

const ALERT_SEVERITY_COLORS: Record<string, string> = {
  info: CHART_COLORS[0],
  warning: STATUS_COLORS.warning,
  critical: STATUS_COLORS.critical,
};

const CO2_PER_KWH_GASOLINE_KG = 0.21;

/* ─── Helpers ─────────────────────────────────────────────────────── */

function getWeekRange(offset: number): [Date, Date] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

function isInRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr);
  return d >= start && d <= end;
}

function dayOfWeekIndex(dateStr: string): number {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): { direction: 'up' | 'down' | 'flat'; value: string; positive: boolean } {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return { direction: 'flat', value: '0%', positive: true };
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

function findCityPair(distanceKm: number): (typeof CITY_PAIRS)[number] | undefined {
  let best: (typeof CITY_PAIRS)[number] | undefined;
  let bestDiff = Infinity;
  for (const pair of CITY_PAIRS) {
    const diff = Math.abs(pair.km - distanceKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pair;
    }
  }
  return best;
}

/* ─── Sub-components ──────────────────────────────────────────────── */

interface HighlightCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: { value: string; positive: boolean };
  subtitle?: string;
  color?: 'cyan' | 'green' | 'purple' | 'amber' | 'red';
  className?: string;
}

function HighlightCard({
  icon,
  label,
  value,
  change,
  subtitle,
  color = 'cyan',
  className,
}: HighlightCardProps) {
  const glowMap: Record<string, string> = {
    cyan: 'cyan',
    green: 'green',
    purple: 'purple',
    amber: 'none',
    red: 'none',
  } as const;

  return (
    <GlassPanel
      glow={glowMap[color] as 'cyan' | 'green' | 'purple' | 'none'}
      className={cn('flex flex-col gap-2 p-5', className)}
    >
      <span className="flex items-center gap-2 text-sm text-white/60">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-bold tracking-tight text-white">
        {value}
      </span>
      {change && (
        <span
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            change.positive ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {change.positive ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {change.value}
        </span>
      )}
      {subtitle && (
        <span className="text-xs text-white/40">{subtitle}</span>
      )}
    </GlassPanel>
  );
}

interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
}

function MiniStat({ label, value, icon, className }: MiniStatProps) {
  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      {icon && <span className="text-white/40">{icon}</span>}
      <span className="flex flex-col">
        <span className="text-xs text-white/50">{label}</span>
        <span className="text-sm font-semibold text-white">{String(value)}</span>
      </span>
    </GlassPanel>
  );
}

interface BatteryPillProps {
  level: number;
  label: string;
  className?: string;
}

function BatteryPill({ level, label, className }: BatteryPillProps) {
  const color =
    level >= 60
      ? STATUS_COLORS.good
      : level >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <Battery className="h-5 w-5" style={{ color }} />
      <span className="flex flex-col">
        <span className="text-xs text-white/50">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>
          {fmtInt(level)}%
        </span>
      </span>
      <span className="ml-auto h-2 w-16 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full transition-all"
          style={{ width: `${Math.min(level, 100)}%`, backgroundColor: color }}
        />
      </span>
    </GlassPanel>
  );
}

/* ─── Skeleton loaders ────────────────────────────────────────────── */

function DigestSkeleton() {
  return (
    <FadeIn className="space-y-6">
      <GlassPanel className="p-6">
        <Skeleton lines={2} />
      </GlassPanel>
      <GlassPanel className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={80} />
        ))}
      </GlassPanel>
      <GlassPanel className="p-6">
        <Skeleton height={260} />
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── Main Component ──────────────────────────────────────────────── */

export default function WeeklyDigestPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.weeklyDigest.title', 'Weekly Digest'));

  const [weekOffset, setWeekOffset] = useState(0);
  const [vehicleId, setVehicleId] = useState<string>('');

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const [prevStart, prevEnd] = useMemo(() => getWeekRange(weekOffset - 1), [weekOffset]);

  const weekLabel = useMemo(
    () => `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
    [weekStart, weekEnd],
  );

  const isCurrentWeek = weekOffset === 0;

  /* ── Vehicle query ── */
  const { data: vehicles } = useVehicles();

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const selectedVehicleId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ── Data queries ── */
  const {
    data: drives,
    isLoading: drivesLoading,
    error: drivesError,
  } = useQuery({
    queryKey: ['drives', selectedVehicleId],
    queryFn: () => request<Drive[]>('/drives'),
    enabled: !!selectedVehicleId,
  });

  const {
    data: chargingSessions,
    isLoading: chargingLoading,
    error: chargingError,
  } = useQuery({
    queryKey: ['charging', selectedVehicleId],
    queryFn: () => request<ChargingSession[]>('/charging'),
    enabled: !!selectedVehicleId,
  });

  const {
    data: alerts,
    isLoading: alertsLoading,
    error: alertsError,
  } = useQuery({
    queryKey: ['alerts', selectedVehicleId],
    queryFn: () => request<Alert[]>('/alerts'),
    enabled: !!selectedVehicleId,
  });

  const isLoading = drivesLoading || chargingLoading || alertsLoading;
  const error = drivesError || chargingError || alertsError;

  /* ── Filter data by week ── */
  const weekDrives = useMemo(
    () => (drives ?? []).filter((d) => isInRange(d.start_date, weekStart, weekEnd)),
    [drives, weekStart, weekEnd],
  );

  const prevWeekDrives = useMemo(
    () => (drives ?? []).filter((d) => isInRange(d.start_date, prevStart, prevEnd)),
    [drives, prevStart, prevEnd],
  );

  const weekCharging = useMemo(
    () => (chargingSessions ?? []).filter((c) => isInRange(c.start_date, weekStart, weekEnd)),
    [chargingSessions, weekStart, weekEnd],
  );

  const prevWeekCharging = useMemo(
    () => (chargingSessions ?? []).filter((c) => isInRange(c.start_date, prevStart, prevEnd)),
    [chargingSessions, prevStart, prevEnd],
  );

  const weekAlerts = useMemo(
    () => (alerts ?? []).filter((a) => isInRange(a.created_at, weekStart, weekEnd)),
    [alerts, weekStart, weekEnd],
  );

  /* ── Aggregated metrics ── */
  const metrics = useMemo(() => {
    const totalDistance = weekDrives.reduce((s, d) => s + d.distance, 0);
    const prevDistance = prevWeekDrives.reduce((s, d) => s + d.distance, 0);
    const totalDrives = weekDrives.length;
    const prevDriveCount = prevWeekDrives.length;
    const energyUsed = weekDrives.reduce((s, d) => s + d.energy_used, 0);
    const prevEnergy = prevWeekDrives.reduce((s, d) => s + d.energy_used, 0);
    const chargingCost = weekCharging.reduce((s, c) => s + c.cost, 0);
    const prevChargingCost = prevWeekCharging.reduce((s, c) => s + c.cost, 0);
    const co2Saved = energyUsed * CO2_PER_KWH_GASOLINE_KG;
    const prevCo2 = prevEnergy * CO2_PER_KWH_GASOLINE_KG;
    const avgEfficiency =
      totalDrives > 0
        ? weekDrives.reduce((s, d) => s + d.efficiency_wh_km, 0) / totalDrives
        : 0;
    const prevAvgEfficiency =
      prevDriveCount > 0
        ? prevWeekDrives.reduce((s, d) => s + d.efficiency_wh_km, 0) / prevDriveCount
        : 0;
    const totalDuration = weekDrives.reduce((s, d) => s + d.duration_min, 0);
    const topDrive =
      weekDrives.length > 0
        ? weekDrives.reduce((best, d) => (d.distance > best.distance ? d : best))
        : undefined;
    const chargeEnergyAdded = weekCharging.reduce((s, c) => s + c.charge_energy_added, 0);
    const prevChargeEnergy = prevWeekCharging.reduce((s, c) => s + c.charge_energy_added, 0);
    const avgChargeRate =
      weekCharging.length > 0
        ? weekCharging.reduce(
            (s, c) => s + (c.duration_min > 0 ? (c.charge_energy_added / c.duration_min) * 60 : 0),
            0,
          ) / weekCharging.length
        : 0;
    const batteryStart =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.start_battery_level, 0) / weekCharging.length
        : 0;
    const batteryEnd =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + c.end_battery_level, 0) / weekCharging.length
        : 0;

    const alertsByType: Record<string, number> = {};
    for (const a of weekAlerts) {
      alertsByType[a.severity] = (alertsByType[a.severity] ?? 0) + 1;
    }

    return {
      totalDistance,
      prevDistance,
      totalDrives,
      prevDriveCount,
      energyUsed,
      prevEnergy,
      chargingCost,
      prevChargingCost,
      co2Saved,
      prevCo2,
      avgEfficiency,
      prevAvgEfficiency,
      totalDuration,
      topDrive,
      chargeEnergyAdded,
      prevChargeEnergy,
      avgChargeRate,
      chargingSessionCount: weekCharging.length,
      batteryStart,
      batteryEnd,
      alertsByType,
      alertTotal: weekAlerts.length,
    };
  }, [weekDrives, prevWeekDrives, weekCharging, prevWeekCharging, weekAlerts]);

  /* ── Daily distance chart data ── */
  const dailyDistanceData = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, distance: 0 }));
    for (const d of weekDrives) {
      const idx = dayOfWeekIndex(d.start_date);
      bins[idx].distance += d.distance;
    }
    return bins;
  }, [weekDrives]);

  /* ── Daily energy added chart data ── */
  const dailyEnergyData = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, energy: 0 }));
    for (const c of weekCharging) {
      const idx = dayOfWeekIndex(c.start_date);
      bins[idx].energy += c.charge_energy_added;
    }
    return bins;
  }, [weekCharging]);

  /* ── Alert pie data ── */
  const alertPieData = useMemo(() => {
    return Object.entries(metrics.alertsByType).map(([severity, count]) => ({
      name: severity.charAt(0).toUpperCase() + severity.slice(1),
      value: count,
      color: ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4],
    }));
  }, [metrics.alertsByType]);

  /* ── Fun fact ── */
  const funFact = useMemo(() => {
    if (metrics.totalDistance < 10) return undefined;
    const pair = findCityPair(metrics.totalDistance);
    if (!pair) return undefined;
    const times = metrics.totalDistance / pair.km;
    if (times >= 0.8) {
      return { from: pair.from, to: pair.to, times: Math.round(times * 10) / 10 };
    }
    return { from: pair.from, to: pair.to, times: Math.round(times * 10) / 10 };
  }, [metrics.totalDistance]);

  /* ── Navigation callbacks ── */
  const goToPrevWeek = useCallback(() => setWeekOffset((o) => o - 1), []);
  const goToNextWeek = useCallback(() => {
    if (!isCurrentWeek) setWeekOffset((o) => o + 1);
  }, [isCurrentWeek]);

  const hasData = weekDrives.length > 0 || weekCharging.length > 0;

  /* ── Actions ── */
  const actions = (
    <Select
      options={vehicleOptions}
      value={selectedVehicleId}
      onChange={(e) => setVehicleId(e.target.value)}
      placeholder={t('analytics.weeklyDigest.selectVehicle', 'Select vehicle')}
      className="w-48"
    />
  );

  return (
    <PageContainer
      title={t('analytics.weeklyDigest.title', 'Weekly Digest')}
      subtitle={t('analytics.weeklyDigest.subtitle', 'Your driving and charging summary for the week')}
      actions={actions}
      loading={isLoading}
      error={error as Error | null}
    >
      {isLoading ? (
        <DigestSkeleton />
      ) : !hasData ? (
        <EmptyState
          icon={<Calendar className="h-10 w-10" />}
          title={t('analytics.weeklyDigest.noData', 'No Data')}
          message={t(
            'analytics.weeklyDigest.noDataMessage',
            'No driving or charging data found for this week.',
          )}
        />
      ) : (
        <FadeIn className="space-y-8">
          {/* ═══════ Week Selector ═══════ */}
          <GlassPanel className="flex items-center justify-between px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronLeft className="h-4 w-4" />}
              onClick={goToPrevWeek}
            >
              {t('analytics.weeklyDigest.prevWeek', 'Previous')}
            </Button>
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Calendar className="h-4 w-4 text-white/50" />
              {weekLabel}
              {isCurrentWeek && (
                <Badge variant="info" size="sm">
                  {t('analytics.weeklyDigest.current', 'Current')}
                </Badge>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronRight className="h-4 w-4" />}
              onClick={goToNextWeek}
              disabled={isCurrentWeek}
            >
              {t('analytics.weeklyDigest.nextWeek', 'Next')}
            </Button>
          </GlassPanel>

          {/* ═══════ Summary Hero Cards ═══════ */}
          <FadeIn delay={0.05}>
            <GlassPanel className="space-y-4 p-6">
              <span className="text-lg font-bold text-white">
                {t('analytics.weeklyDigest.weekSummary', 'Week Summary')}
              </span>
              <span className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <HighlightCard
                  icon={<Car className="h-5 w-5" />}
                  label={t('analytics.weeklyDigest.totalDistance', 'Total Distance')}
                  value={`${fmtNumber(metrics.totalDistance, 1)} km`}
                  change={trendFor(metrics.totalDistance, metrics.prevDistance)}
                  color="cyan"
                />
                <HighlightCard
                  icon={<Activity className="h-5 w-5" />}
                  label={t('analytics.weeklyDigest.totalDrives', 'Total Drives')}
                  value={fmtInt(metrics.totalDrives)}
                  change={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
                  color="green"
                />
                <HighlightCard
                  icon={<Zap className="h-5 w-5" />}
                  label={t('analytics.weeklyDigest.energyUsed', 'Energy Used')}
                  value={`${fmtNumber(metrics.energyUsed, 1)} kWh`}
                  change={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
                  color="purple"
                />
                <HighlightCard
                  icon={<Fuel className="h-5 w-5" />}
                  label={t('analytics.weeklyDigest.chargingCost', 'Charging Cost')}
                  value={`$${fmtNumber(metrics.chargingCost, 2)}`}
                  change={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
                  color="amber"
                />
                <HighlightCard
                  icon={<Leaf className="h-5 w-5" />}
                  label={t('analytics.weeklyDigest.co2Saved', 'CO₂ Saved')}
                  value={`${fmtNumber(metrics.co2Saved, 1)} kg`}
                  change={trendFor(metrics.co2Saved, metrics.prevCo2)}
                  color="green"
                />
                {funFact && (
                  <HighlightCard
                    icon={<MapPin className="h-5 w-5" />}
                    label={t('analytics.weeklyDigest.funFact', 'Fun Fact')}
                    value={`${funFact.times}×`}
                    subtitle={t(
                      'analytics.weeklyDigest.funFactDesc',
                      '≈ {{times}}× {{from}} → {{to}}',
                      { times: funFact.times, from: funFact.from, to: funFact.to },
                    )}
                    color="cyan"
                  />
                )}
              </span>
            </GlassPanel>
          </FadeIn>

          {/* ═══════ Driving Section ═══════ */}
          <FadeIn delay={0.1}>
            <GlassPanel className="space-y-6 p-6">
              <span className="flex items-center gap-2 text-lg font-bold text-white">
                <Car className="h-5 w-5 text-neon-cyan" />
                {t('analytics.weeklyDigest.drivingSection', 'Driving')}
              </span>

              {/* Daily Distance BarChart */}
              <GlassPanel className="p-4">
                <span className="mb-3 block text-sm font-medium text-white/70">
                  {t('analytics.weeklyDigest.dailyDistance', 'Daily Distance (km)')}
                </span>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyDistanceData} margin={chartMarginLabeled}>
                    {chartGrid}
                    <XAxis dataKey="day" {...axisTickSm} />
                    <YAxis
                      {...axisTickSm}
                      tickFormatter={(v: number) => fmtInt(v)}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="distance"
                      name={t('analytics.weeklyDigest.distance', 'Distance')}
                      fill={CHART_COLORS[0]}
                      radius={[4, 4, 0, 0]}
                      {...chartAnimation}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </GlassPanel>

              {/* Driving efficiency stats */}
              <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniStat
                  label={t('analytics.weeklyDigest.avgEfficiency', 'Avg Efficiency')}
                  value={`${fmtNumber(metrics.avgEfficiency, 1)} Wh/km`}
                  icon={<BarChart3 className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.totalDrivingTime', 'Total Driving Time')}
                  value={`${fmtInt(Math.floor(metrics.totalDuration / 60))}h ${fmtInt(metrics.totalDuration % 60)}m`}
                  icon={<Clock className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.efficiencyChange', 'Efficiency Change')}
                  value={
                    metrics.prevAvgEfficiency > 0
                      ? `${fmtNumber(pctChange(metrics.avgEfficiency, metrics.prevAvgEfficiency), 1)}%`
                      : '—'
                  }
                  icon={
                    metrics.avgEfficiency <= metrics.prevAvgEfficiency ? (
                      <TrendingDown className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <TrendingUp className="h-4 w-4 text-red-400" />
                    )
                  }
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.drivesCount', 'Drives')}
                  value={fmtInt(metrics.totalDrives)}
                  icon={<Activity className="h-4 w-4" />}
                />
              </span>

              {/* Top drive card */}
              {metrics.topDrive && (
                <GlassPanel className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-6">
                  <Badge variant="success" size="sm">
                    {t('analytics.weeklyDigest.topDrive', 'Top Drive')}
                  </Badge>
                  <span className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <span className="flex flex-col">
                      <span className="text-xs text-white/50">
                        {t('analytics.weeklyDigest.date', 'Date')}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {formatDate(metrics.topDrive.start_date)}
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <span className="text-xs text-white/50">
                        {t('analytics.weeklyDigest.distance', 'Distance')}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {fmtNumber(metrics.topDrive.distance, 1)} km
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <span className="text-xs text-white/50">
                        {t('analytics.weeklyDigest.duration', 'Duration')}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {fmtInt(metrics.topDrive.duration_min)} min
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <span className="text-xs text-white/50">
                        {t('analytics.weeklyDigest.efficiency', 'Efficiency')}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {fmtNumber(metrics.topDrive.efficiency_wh_km, 1)} Wh/km
                      </span>
                    </span>
                  </span>
                </GlassPanel>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ═══════ Charging Section ═══════ */}
          <FadeIn delay={0.15}>
            <GlassPanel className="space-y-6 p-6">
              <span className="flex items-center gap-2 text-lg font-bold text-white">
                <Zap className="h-5 w-5 text-neon-green" />
                {t('analytics.weeklyDigest.chargingSection', 'Charging')}
              </span>

              {/* Daily Energy Added BarChart */}
              <GlassPanel className="p-4">
                <span className="mb-3 block text-sm font-medium text-white/70">
                  {t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily Energy Added (kWh)')}
                </span>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyEnergyData} margin={chartMarginLabeled}>
                    {chartGrid}
                    <XAxis dataKey="day" {...axisTickSm} />
                    <YAxis
                      {...axisTickSm}
                      tickFormatter={(v: number) => fmtNumber(v, 1)}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="energy"
                      name={t('analytics.weeklyDigest.energyAdded', 'Energy Added')}
                      fill={CHART_COLORS[1]}
                      radius={[4, 4, 0, 0]}
                      {...chartAnimation}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </GlassPanel>

              {/* Charging stats row */}
              <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniStat
                  label={t('analytics.weeklyDigest.sessions', 'Sessions')}
                  value={fmtInt(metrics.chargingSessionCount)}
                  icon={<Zap className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.totalEnergyAdded', 'Total Energy Added')}
                  value={`${fmtNumber(metrics.chargeEnergyAdded, 1)} kWh`}
                  icon={<Zap className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.avgChargeRate', 'Avg Charge Rate')}
                  value={`${fmtNumber(metrics.avgChargeRate, 1)} kW`}
                  icon={<Activity className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.totalCost', 'Total Cost')}
                  value={`$${fmtNumber(metrics.chargingCost, 2)}`}
                  icon={<Fuel className="h-4 w-4" />}
                />
              </span>

              {/* Charge energy week-over-week */}
              <GlassPanel className="flex items-center gap-4 px-4 py-3">
                <span className="text-xs text-white/50">
                  {t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. Last Week')}
                </span>
                <Badge
                  variant={
                    metrics.chargeEnergyAdded >= metrics.prevChargeEnergy ? 'success' : 'warning'
                  }
                  size="sm"
                >
                  {metrics.prevChargeEnergy > 0
                    ? `${fmtNumber(pctChange(metrics.chargeEnergyAdded, metrics.prevChargeEnergy), 1)}%`
                    : '—'}
                </Badge>
              </GlassPanel>
            </GlassPanel>
          </FadeIn>

          {/* ═══════ Battery Health Section ═══════ */}
          <FadeIn delay={0.2}>
            <GlassPanel className="space-y-6 p-6">
              <span className="flex items-center gap-2 text-lg font-bold text-white">
                <Battery className="h-5 w-5 text-neon-purple" />
                {t('analytics.weeklyDigest.batteryHealth', 'Battery Health')}
              </span>

              <span className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <BatteryPill
                  level={Math.round(metrics.batteryStart)}
                  label={t('analytics.weeklyDigest.avgBatteryStart', 'Avg Battery at Charge Start')}
                />
                <BatteryPill
                  level={Math.round(metrics.batteryEnd)}
                  label={t('analytics.weeklyDigest.avgBatteryEnd', 'Avg Battery at Charge End')}
                />
              </span>

              {/* Range stats */}
              <span className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MiniStat
                  label={t('analytics.weeklyDigest.avgChargeGain', 'Avg Charge Gain')}
                  value={`${fmtNumber(metrics.batteryEnd - metrics.batteryStart, 1)}%`}
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.chargeSessions', 'Charge Sessions')}
                  value={fmtInt(metrics.chargingSessionCount)}
                  icon={<Zap className="h-4 w-4" />}
                />
                <MiniStat
                  label={t('analytics.weeklyDigest.estRangeAdded', 'Est. Range Added')}
                  value={`${fmtNumber(metrics.chargeEnergyAdded * 5.5, 0)} km`}
                  icon={<MapPin className="h-4 w-4" />}
                />
              </span>
            </GlassPanel>
          </FadeIn>

          {/* ═══════ Alerts Section ═══════ */}
          <FadeIn delay={0.25}>
            <GlassPanel className="space-y-6 p-6">
              <span className="flex items-center gap-2 text-lg font-bold text-white">
                <AlertTriangle className="h-5 w-5 text-neon-amber" />
                {t('analytics.weeklyDigest.alertsSection', 'Alerts')}
                {metrics.alertTotal > 0 && (
                  <Badge variant="warning" size="sm">
                    {fmtInt(metrics.alertTotal)}
                  </Badge>
                )}
              </span>

              {metrics.alertTotal === 0 ? (
                <EmptyState
                  icon={<AlertTriangle className="h-8 w-8" />}
                  message={t(
                    'analytics.weeklyDigest.noAlerts',
                    'No alerts this week — everything looks great!',
                  )}
                  className="py-8"
                />
              ) : (
                <span className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* Alert count by severity */}
                  <span className="space-y-3">
                    <span className="text-sm font-medium text-white/70">
                      {t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by Severity')}
                    </span>
                    <span className="grid gap-3">
                      {Object.entries(metrics.alertsByType).map(([severity, count]) => (
                        <GlassPanel
                          key={severity}
                          className="flex items-center justify-between px-4 py-3"
                        >
                          <span className="flex items-center gap-2">
                            {severity === 'critical' && (
                              <AlertCircle
                                className="h-4 w-4"
                                style={{ color: STATUS_COLORS.critical }}
                              />
                            )}
                            {severity === 'warning' && (
                              <AlertTriangle
                                className="h-4 w-4"
                                style={{ color: STATUS_COLORS.warning }}
                              />
                            )}
                            {severity === 'info' && (
                              <Info
                                className="h-4 w-4"
                                style={{ color: CHART_COLORS[0] }}
                              />
                            )}
                            <span className="text-sm capitalize text-white/80">{severity}</span>
                          </span>
                          <Badge
                            variant={
                              severity === 'critical'
                                ? 'danger'
                                : severity === 'warning'
                                  ? 'warning'
                                  : 'info'
                            }
                            size="sm"
                          >
                            {fmtInt(count)}
                          </Badge>
                        </GlassPanel>
                      ))}
                    </span>
                  </span>

                  {/* Alert distribution PieChart */}
                  <span className="flex flex-col items-center">
                    <span className="mb-3 text-sm font-medium text-white/70">
                      {t('analytics.weeklyDigest.alertDistribution', 'Alert Distribution')}
                    </span>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={alertPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {alertPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          verticalAlign="bottom"
                          iconType="circle"
                          wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </span>
                </span>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ═══════ Week-over-Week Summary ═══════ */}
          <FadeIn delay={0.3}>
            <GlassPanel className="space-y-4 p-6">
              <span className="text-lg font-bold text-white">
                {t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
              </span>
              <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  label={t('analytics.weeklyDigest.distance', 'Distance')}
                  value={fmtNumber(metrics.totalDistance, 1)}
                  unit="km"
                  icon={<Car className="h-4 w-4" />}
                  trend={trendFor(metrics.totalDistance, metrics.prevDistance)}
                />
                <StatCard
                  label={t('analytics.weeklyDigest.drives', 'Drives')}
                  value={fmtInt(metrics.totalDrives)}
                  icon={<Activity className="h-4 w-4" />}
                  trend={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
                />
                <StatCard
                  label={t('analytics.weeklyDigest.energy', 'Energy')}
                  value={fmtNumber(metrics.energyUsed, 1)}
                  unit="kWh"
                  icon={<Zap className="h-4 w-4" />}
                  trend={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
                />
                <StatCard
                  label={t('analytics.weeklyDigest.cost', 'Cost')}
                  value={`$${fmtNumber(metrics.chargingCost, 2)}`}
                  icon={<Fuel className="h-4 w-4" />}
                  trend={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
                />
                <StatCard
                  label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
                  value={fmtNumber(metrics.avgEfficiency, 1)}
                  unit="Wh/km"
                  icon={<BarChart3 className="h-4 w-4" />}
                  trend={trendFor(metrics.avgEfficiency, metrics.prevAvgEfficiency, true)}
                />
                <StatCard
                  label={t('analytics.weeklyDigest.co2', 'CO₂ Saved')}
                  value={fmtNumber(metrics.co2Saved, 1)}
                  unit="kg"
                  icon={<Leaf className="h-4 w-4" />}
                  trend={trendFor(metrics.co2Saved, metrics.prevCo2)}
                />
              </span>
            </GlassPanel>
          </FadeIn>
        </FadeIn>
      )}
    </PageContainer>
  );
}
