import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { Skeleton } from '@/components/feedback';
import { Activity } from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  chartGrid,
  axisTickSm,
  CHART_COLORS,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Bar,
  ComposedChart,
  Cell,
} from '@/components/charts';

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

interface CurvePoint {
  soc: number;
  power: number;
}

interface ChargerTypeStats {
  label: string;
  count: number;
  avgKw: number;
  avgKwh: number;
  avgDuration: number;
}

interface MonthlySpeed {
  month: string;
  dcAvgKw: number;
  acAvgKw: number;
}

interface TimeToChargeMetrics {
  avg10to80: number | null;
  avg20to80: number | null;
  fastest: { rate: number; id: number } | null;
  slowest: { rate: number; id: number } | null;
  yearlyTrend: { year: string; avg10to80: number; avg20to80: number; count: number }[];
}

interface SummaryStats {
  totalSessions: number;
  totalEnergy: number;
  avgRate: number;
  peakRate: number;
  avgDuration: number;
  totalCost: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function isDcSession(s: ChargingSession): boolean {
  return !!(s.fast_charger_type || (s.charger_power && s.charger_power > 20));
}

function getChargerLabel(s: ChargingSession): string {
  if (s.fast_charger_type === 'Tesla' || s.fast_charger_brand === 'Tesla')
    return 'Supercharger';
  if (s.fast_charger_type) return 'DC Fast';
  if (s.charger_power && s.charger_power > 20) return 'DC Fast';
  return 'Home / AC';
}

function sessionLabel(s: ChargingSession): string {
  const date = formatDateShort(s.start_date);
  const label = getChargerLabel(s);
  const energy = s.charge_energy_added?.toFixed(1) ?? '?';
  return `${date} — ${label} — ${energy} kWh`;
}

/** Simulate a power-vs-SOC curve based on session metadata. */
function generateChargingCurve(session: ChargingSession): CurvePoint[] {
  const points: CurvePoint[] = [];
  const startSoc = session.start_battery_level;
  const endSoc = session.end_battery_level ?? 100;
  const peakPower = session.charger_power ?? 11;
  const dc = isDcSession(session);

  for (let soc = startSoc; soc <= endSoc; soc += 1) {
    let power: number;
    if (dc) {
      if (soc <= 50) {
        // DC: flat peak until 50%
        power = peakPower;
      } else if (soc <= 80) {
        // DC: taper 50→80%
        const taper = 1 - ((soc - 50) / 30) * 0.5;
        power = peakPower * taper;
      } else {
        // DC: drop sharply after 80%
        const drop = 1 - ((soc - 80) / 20) * 0.7;
        power = peakPower * 0.5 * drop;
      }
    } else {
      // AC: flat power throughout
      power = peakPower;
    }
    points.push({ soc, power: Math.max(power, 0) });
  }
  return points;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sub-components
 * ──────────────────────────────────────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  unit,
  loading,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <GlassPanel className={cn('p-4', className)}>
      <p className="text-xs uppercase tracking-wider text-white/50">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : (
        <p className="mt-1 text-2xl font-semibold text-white">
          {value}
          {unit && <span className="ml-1 text-sm text-white/60">{unit}</span>}
        </p>
      )}
    </GlassPanel>
  );
}

function SessionDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm">
      <span className="text-white/60">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function TimeToChargeCard({
  label,
  value,
  unit,
  subtitle,
}: {
  label: string;
  value: string | null;
  unit?: string;
  subtitle?: string;
}) {
  return (
    <GlassPanel className="p-4">
      <p className="text-xs uppercase tracking-wider text-white/50">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">
        {value ?? '—'}
        {unit && value && <span className="ml-1 text-sm text-white/60">{unit}</span>}
      </p>
      {subtitle && <p className="mt-0.5 text-xs text-white/40">{subtitle}</p>}
    </GlassPanel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Skeleton Loading State
 * ──────────────────────────────────────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Vehicle + session selector skeleton */}
      <div className="flex gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-64" />
      </div>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-20" />
          </GlassPanel>
        ))}
      </div>

      {/* Chart skeleton */}
      <GlassPanel className="p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-64 w-full" />
      </GlassPanel>

      {/* Comparison chart skeleton */}
      <GlassPanel className="p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-4 h-52 w-full" />
      </GlassPanel>

      {/* Bottom charts skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassPanel className="p-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-48 w-full" />
        </GlassPanel>
        <GlassPanel className="p-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-48 w-full" />
        </GlassPanel>
      </div>

      {/* Time-to-charge skeleton */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Main Page Component
 * ──────────────────────────────────────────────────────────────────────────── */

export default function ChargingCurvePage() {
  const { t } = useTranslation();
  useSettings();
  usePageTitle(t('charging.curve.title', 'Charging Curve'));

  /* ── Vehicle & Session selection ─────────────────────────────────────── */

  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  // Auto-select first vehicle when loaded
  const activeVehicleId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data: sessions, isLoading } = useChargingSessionsPaginated(activeVehicleId, {
    limit: 200,
  });

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const sessionOptions = useMemo(
    () =>
      (sessions ?? []).map((s) => ({
        value: String(s.id),
        label: sessionLabel(s),
      })),
    [sessions],
  );

  const handleVehicleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    setVehicleId(id);
    setSelectedSessionId(null);
  };

  const handleSessionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(Number(e.target.value) || null);
  };

  /* ── Computed Data ───────────────────────────────────────────────────── */

  const stats = useMemo((): SummaryStats | null => {
    if (!sessions?.length) return null;
    const totalEnergy = sessions.reduce((sum, s) => sum + (s.charge_energy_added ?? 0), 0);
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const avgDuration = avg(sessions.map((s) => s.duration_min));
    const powers = sessions.map((s) => s.charger_power ?? 0);
    const avgRate = avg(powers);
    const peakRate = Math.max(...powers);
    return {
      totalSessions: sessions.length,
      totalEnergy,
      avgRate,
      peakRate,
      avgDuration,
      totalCost,
    };
  }, [sessions]);

  const selectedSession = useMemo(
    () => sessions?.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const curveData = useMemo(
    () => (selectedSession ? generateChargingCurve(selectedSession) : []),
    [selectedSession],
  );

  // Overlay curves from the last 10 sessions
  const comparisonSessions = useMemo(() => (sessions ?? []).slice(0, 10), [sessions]);

  const comparisonData = useMemo(() => {
    if (!comparisonSessions.length) return [];
    const curves = comparisonSessions.map((s, i) => ({
      curve: generateChargingCurve(s),
      key: `s${i}`,
    }));
    const allSocs = new Set<number>();
    curves.forEach((c) => c.curve.forEach((p) => allSocs.add(p.soc)));
    const socValues = Array.from(allSocs).sort((a, b) => a - b);

    return socValues.map((soc) => {
      const point: Record<string, number> = { soc };
      curves.forEach(({ curve, key }) => {
        const match = curve.find((p) => p.soc === soc);
        if (match) point[key] = Math.round(match.power * 10) / 10;
      });
      return point;
    });
  }, [comparisonSessions]);

  // Charge rate by charger type
  const chargerTypeStats = useMemo((): ChargerTypeStats[] => {
    if (!sessions?.length) return [];
    const groups = new Map<string, ChargingSession[]>();
    sessions.forEach((s) => {
      const label = getChargerLabel(s);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(s);
    });
    return Array.from(groups.entries()).map(
      ([label, items]): ChargerTypeStats => ({
        label,
        count: items.length,
        avgKw: avg(items.map((s) => s.charger_power ?? 0)),
        avgKwh: avg(items.map((s) => s.charge_energy_added ?? 0)),
        avgDuration: avg(items.map((s) => s.duration_min)),
      }),
    );
  }, [sessions]);

  // Monthly DC vs AC speed trend
  const monthlyTrend = useMemo((): MonthlySpeed[] => {
    if (!sessions?.length) return [];
    const byMonth = new Map<string, { dc: number[]; ac: number[] }>();
    sessions.forEach((s) => {
      const month = (s.start_date ?? '').slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, { dc: [], ac: [] });
      const group = byMonth.get(month)!;
      const power = s.charger_power ?? 0;
      if (isDcSession(s)) group.dc.push(power);
      else group.ac.push(power);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { dc, ac }]) => ({
        month,
        dcAvgKw: Math.round(avg(dc) * 10) / 10,
        acAvgKw: Math.round(avg(ac) * 10) / 10,
      }));
  }, [sessions]);

  // Time-to-charge analysis
  const timeToCharge = useMemo((): TimeToChargeMetrics => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };
    if (!sessions?.length) return empty;

    const dcSessions = sessions.filter(isDcSession);
    if (!dcSessions.length) return empty;

    const cross10to80 = dcSessions.filter(
      (s) => s.start_battery_level <= 10 && (s.end_battery_level ?? 0) >= 80,
    );
    const cross20to80 = dcSessions.filter(
      (s) => s.start_battery_level <= 20 && (s.end_battery_level ?? 0) >= 80,
    );

    const avg10to80 = cross10to80.length ? avg(cross10to80.map((s) => s.duration_min)) : null;
    const avg20to80 = cross20to80.length ? avg(cross20to80.map((s) => s.duration_min)) : null;

    const withRate = dcSessions
      .filter((s) => s.duration_min > 0 && s.charge_energy_added > 0)
      .map((s) => ({
        id: s.id,
        rate: (s.charge_energy_added / s.duration_min) * 60,
      }));

    const fastest = withRate.length
      ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b))
      : null;
    const slowest = withRate.length
      ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b))
      : null;

    // Group by year
    const byYear = new Map<string, { d10: number[]; d20: number[]; count: number }>();
    dcSessions.forEach((s) => {
      const year = (s.start_date ?? '').slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { d10: [], d20: [], count: 0 });
      const g = byYear.get(year)!;
      g.count++;
      if (s.start_battery_level <= 10 && (s.end_battery_level ?? 0) >= 80)
        g.d10.push(s.duration_min);
      if (s.start_battery_level <= 20 && (s.end_battery_level ?? 0) >= 80)
        g.d20.push(s.duration_min);
    });

    const yearlyTrend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, { d10, d20, count }]) => ({
        year,
        avg10to80: Math.round(avg(d10) * 10) / 10,
        avg20to80: Math.round(avg(d20) * 10) / 10,
        count,
      }));

    return { avg10to80, avg20to80, fastest, slowest, yearlyTrend };
  }, [sessions]);

  const currencySymbol = '$';

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <FadeIn>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
          <LoadingSkeleton />
        </div>
      </FadeIn>
    );
  }

  const isEmpty = !sessions || sessions.length === 0;

  if (isEmpty) {
    return (
      <FadeIn>
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-2xl font-bold text-white">
            {t('charging.curve.title', 'Charging Curve')}
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
          </p>

          {vehicleOptions.length > 1 && (
            <div className="mt-4">
              <Select
                value={String(activeVehicleId ?? '')}
                onChange={handleVehicleChange}
                options={vehicleOptions}
                placeholder={t('charging.selectVehicle', 'Select vehicle')}
                className="w-48"
              />
            </div>
          )}

          <GlassPanel className="mt-8 flex flex-col items-center justify-center py-16">
            <p className="text-lg font-medium text-white/70">
              {t('charging.curve.empty', 'No charging sessions to plot a curve.')}
            </p>
            <p className="mt-2 text-sm text-white/40">
              {t(
                'charging.curve.emptyHint',
                'Start a charging session and data will appear here.',
              )}
            </p>
          </GlassPanel>
        </div>
      </FadeIn>
    );
  }

  return (
    <PageContainer
      title={t('charging.curve.title', 'Charging Curve')}
      subtitle={t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            value={String(activeVehicleId ?? '')}
            onChange={handleVehicleChange}
            options={vehicleOptions}
            placeholder={t('charging.selectVehicle', 'Select vehicle')}
            className="w-48"
          />
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* ── Section 2: Session Selector ─────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={String(selectedSessionId ?? '')}
            onChange={handleSessionChange}
            options={sessionOptions}
            placeholder={t('charging.curve.selectSession', 'Select a session to inspect')}
            className="w-full sm:w-96"
          />
          {selectedSession && (
            <span className="text-xs text-white/50">
              {formatDateTime(selectedSession.start_date)}
              {selectedSession.location_name && ` · ${selectedSession.location_name}`}
            </span>
          )}
        </div>

        {/* ── Section 3: Summary Stats ────────────────────────────────────── */}
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <SummaryCard
              label={t('charging.curve.totalSessions', 'Total Sessions')}
              value={fmtInt(stats?.totalSessions ?? 0)}
            />
            <SummaryCard
              label={t('charging.curve.totalEnergy', 'Total Energy')}
              value={fmtNumber(stats?.totalEnergy ?? 0)}
              unit="kWh"
            />
            <SummaryCard
              label={t('charging.curve.avgChargeRate', 'Avg Charge Rate')}
              value={fmtNumber(stats?.avgRate ?? 0)}
              unit="kW"
            />
            <SummaryCard
              label={t('charging.curve.peakRate', 'Peak Rate')}
              value={fmtNumber(stats?.peakRate ?? 0)}
              unit="kW"
            />
            <SummaryCard
              label={t('charging.curve.avgDuration', 'Avg Duration')}
              value={fmtInt(stats?.avgDuration ?? 0)}
              unit="min"
            />
            <SummaryCard
              label={t('charging.curve.totalCost', 'Total Cost')}
              value={`${currencySymbol}${fmtNumber(stats?.totalCost ?? 0)}`}
            />
          </div>
        </FadeIn>

        {/* ── Section 4: Single Session Curve + Detail Sidebar ────────────── */}
        <FadeIn delay={0.1}>
          {selectedSession ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ChartContainer
                  title={t('charging.curve.powerVsSoc', 'Power vs SOC')}
                  subtitle={t(
                    'charging.curve.powerVsSocDesc',
                    'Charging power curve for selected session',
                  )}
                  height={320}
                >
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={curveData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <defs>
                        <ChartGradient id="curvePowerGrad" color={CHART_COLORS[0]} />
                      </defs>
                      <CartesianGrid {...chartGrid} />
                      <XAxis
                        dataKey="soc"
                        tick={axisTickSm}
                        label={{
                          value: t('charging.curve.socPercent', 'SOC (%)'),
                          position: 'insideBottomRight',
                          offset: -5,
                          style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                        }}
                      />
                      <YAxis
                        tick={axisTickSm}
                        label={{
                          value: t('charging.curve.powerKw', 'Power (kW)'),
                          angle: -90,
                          position: 'insideLeft',
                          style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                        }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="power"
                        name={t('charging.curve.power', 'Power')}
                        stroke={CHART_COLORS[0]}
                        fill="url(#curvePowerGrad)"
                        strokeWidth={2}
                        unit=" kW"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>

              {/* Session detail sidebar */}
              <GlassPanel className="space-y-1 p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
                  {t('charging.curve.sessionDetails', 'Session Details')}
                </h3>
                <SessionDetailRow
                  label={t('charging.curve.date', 'Date')}
                  value={formatDateTime(selectedSession.start_date)}
                />
                <SessionDetailRow
                  label={t('charging.curve.chargerType', 'Charger Type')}
                  value={getChargerLabel(selectedSession)}
                />
                <SessionDetailRow
                  label={t('charging.curve.socRange', 'SOC Range')}
                  value={`${selectedSession.start_battery_level}% → ${selectedSession.end_battery_level ?? '?'}%`}
                />
                <SessionDetailRow
                  label={t('charging.curve.energyAdded', 'Energy Added')}
                  value={fmtWithUnit(selectedSession.charge_energy_added, 'kWh')}
                />
                {selectedSession.charge_energy_used != null && (
                  <SessionDetailRow
                    label={t('charging.curve.energyUsed', 'Energy Used')}
                    value={fmtWithUnit(selectedSession.charge_energy_used, 'kWh')}
                  />
                )}
                <SessionDetailRow
                  label={t('charging.curve.peakPower', 'Peak Power')}
                  value={fmtWithUnit(selectedSession.charger_power ?? 0, 'kW')}
                />
                <SessionDetailRow
                  label={t('charging.curve.duration', 'Duration')}
                  value={fmtWithUnit(selectedSession.duration_min, 'min')}
                />
                {selectedSession.charger_voltage != null && (
                  <SessionDetailRow
                    label={t('charging.curve.voltage', 'Voltage')}
                    value={fmtWithUnit(selectedSession.charger_voltage, 'V')}
                  />
                )}
                {selectedSession.charger_actual_current != null && (
                  <SessionDetailRow
                    label={t('charging.curve.current', 'Current')}
                    value={fmtWithUnit(selectedSession.charger_actual_current, 'A')}
                  />
                )}
                {selectedSession.charger_phases != null && (
                  <SessionDetailRow
                    label={t('charging.curve.phases', 'Phases')}
                    value={String(selectedSession.charger_phases)}
                  />
                )}
                {selectedSession.cost != null && (
                  <SessionDetailRow
                    label={t('charging.curve.cost', 'Cost')}
                    value={`${currencySymbol}${fmtNumber(selectedSession.cost)}`}
                  />
                )}
                {selectedSession.location_name && (
                  <SessionDetailRow
                    label={t('charging.curve.location', 'Location')}
                    value={selectedSession.location_name}
                  />
                )}
                {selectedSession.conn_charge_cable && (
                  <SessionDetailRow
                    label={t('charging.curve.cable', 'Cable')}
                    value={selectedSession.conn_charge_cable}
                  />
                )}
              </GlassPanel>
            </div>
          ) : (
            <GlassPanel className="flex h-48 items-center justify-center">
              <p className="text-sm text-white/40">
                {t(
                  'charging.curve.selectSessionHint',
                  'Select a session above to view its charging curve',
                )}
              </p>
            </GlassPanel>
          )}
        </FadeIn>

        {/* ── Section 5: Session Comparison ───────────────────────────────── */}
        <FadeIn delay={0.15}>
          <ChartContainer
            title={t('charging.curve.sessionComparison', 'Session Comparison')}
            subtitle={t(
              'charging.curve.sessionComparisonDesc',
              'Power curves overlaid from last 10 sessions',
            )}
            empty={comparisonSessions.length === 0}
            height={300}
          >
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis
                  dataKey="soc"
                  tick={axisTickSm}
                  label={{
                    value: t('charging.curve.socPercent', 'SOC (%)'),
                    position: 'insideBottomRight',
                    offset: -5,
                    style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                  }}
                />
                <YAxis
                  tick={axisTickSm}
                  label={{
                    value: t('charging.curve.powerKw', 'Power (kW)'),
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                  }}
                />
                <Tooltip content={<ChartTooltip />} />
                {comparisonSessions.map((s, i) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={`s${i}`}
                    name={`${formatDateShort(s.start_date)} (${getChargerLabel(s)})`}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    unit=" kW"
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/* Custom legend for comparison */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2">
              {comparisonSessions.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1.5 text-xs text-white/60">
                  <span
                    className="inline-block h-2 w-3 rounded-sm"
                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  {formatDateShort(s.start_date)}
                </div>
              ))}
            </div>
          </ChartContainer>
        </FadeIn>

        {/* ── Sections 6 & 7: Charger Type + Speed Trend (side by side) ── */}
        <FadeIn delay={0.2}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Section 6: Charge Rate by Charger Type */}
            <ChartContainer
              title={t('charging.curve.chargerType', 'Charge Rate by Charger Type')}
              subtitle={t(
                'charging.curve.chargerTypeDesc',
                'Average kW and kWh per charger category',
              )}
              empty={chargerTypeStats.length === 0}
              height={280}
            >
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart
                  data={chargerTypeStats}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" tick={axisTickSm} />
                  <YAxis yAxisId="kw" tick={axisTickSm} orientation="left" />
                  <YAxis yAxisId="kwh" tick={axisTickSm} orientation="right" />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    yAxisId="kw"
                    dataKey="avgKw"
                    name={t('charging.curve.avgPower', 'Avg Power')}
                    unit=" kW"
                    radius={[4, 4, 0, 0]}
                  >
                    {chargerTypeStats.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={CHARGER_COLORS[entry.label] ?? CHART_COLORS[3]}
                      />
                    ))}
                  </Bar>
                  <Bar
                    yAxisId="kwh"
                    dataKey="avgKwh"
                    name={t('charging.curve.avgEnergy', 'Avg Energy')}
                    unit=" kWh"
                    radius={[4, 4, 0, 0]}
                    opacity={0.6}
                  >
                    {chargerTypeStats.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={CHARGER_COLORS[entry.label] ?? CHART_COLORS[4]}
                      />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
              {/* Charger type stats table */}
              <div className="mt-3 space-y-1 px-2">
                {chargerTypeStats.map((ct) => (
                  <div
                    key={ct.label}
                    className="flex items-center justify-between text-xs text-white/60"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: CHARGER_COLORS[ct.label] ?? CHART_COLORS[3] }}
                      />
                      <span>{ct.label}</span>
                    </div>
                    <span>
                      {fmtInt(ct.count)} {t('charging.curve.sessions', 'sessions')} ·{' '}
                      {fmtNumber(ct.avgDuration)} {t('charging.curve.minAvg', 'min avg')}
                    </span>
                  </div>
                ))}
              </div>
            </ChartContainer>

            {/* Section 7: Charging Speed Trend */}
            <ChartContainer
              title={t('charging.curve.speedTrend', 'Charging Speed Trend')}
              subtitle={t(
                'charging.curve.speedTrendDesc',
                'Monthly average DC vs AC charge rate',
              )}
              empty={monthlyTrend.length === 0}
              height={280}
            >
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={monthlyTrend}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="month" tick={axisTickSm} />
                  <YAxis
                    tick={axisTickSm}
                    label={{
                      value: t('charging.curve.avgKw', 'Avg kW'),
                      angle: -90,
                      position: 'insideLeft',
                      style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                    }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="dcAvgKw"
                    name={t('charging.curve.dcAvg', 'DC Avg')}
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS[0] }}
                    unit=" kW"
                  />
                  <Line
                    type="monotone"
                    dataKey="acAvgKw"
                    name={t('charging.curve.acAvg', 'AC Avg')}
                    stroke={CHART_COLORS[1]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS[1] }}
                    unit=" kW"
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-3 flex gap-4 px-2">
                <div className="flex items-center gap-1.5 text-xs text-white/60">
                  <span className="inline-block h-2 w-3 rounded-sm bg-[#00f0ff]" />
                  {t('charging.curve.dcFast', 'DC Fast')}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/60">
                  <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" />
                  {t('charging.curve.acHome', 'AC / Home')}
                </div>
              </div>
            </ChartContainer>
          </div>
        </FadeIn>

        {/* ── Section 8: Time-to-Charge Analysis ─────────────────────────── */}
        <FadeIn delay={0.25}>
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">
              {t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}
            </h2>
            <p className="text-sm text-white/50">
              {t(
                'charging.curve.timeToChargeDesc',
                'How long DC sessions take to reach key SOC thresholds',
              )}
            </p>

            {/* 4 metric cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <TimeToChargeCard
                label={t('charging.curve.avg10to80', '10% → 80%')}
                value={
                  timeToCharge.avg10to80 != null ? fmtNumber(timeToCharge.avg10to80) : null
                }
                unit="min"
                subtitle={t('charging.curve.avgDuration', 'Avg duration')}
              />
              <TimeToChargeCard
                label={t('charging.curve.avg20to80', '20% → 80%')}
                value={
                  timeToCharge.avg20to80 != null ? fmtNumber(timeToCharge.avg20to80) : null
                }
                unit="min"
                subtitle={t('charging.curve.avgDuration', 'Avg duration')}
              />
              <TimeToChargeCard
                label={t('charging.curve.fastest', 'Fastest Session')}
                value={
                  timeToCharge.fastest
                    ? fmtNumber(timeToCharge.fastest.rate)
                    : null
                }
                unit="kWh/h"
                subtitle={
                  timeToCharge.fastest
                    ? t('charging.curve.sessionId', 'Session #{{id}}', {
                        id: timeToCharge.fastest.id,
                      })
                    : undefined
                }
              />
              <TimeToChargeCard
                label={t('charging.curve.slowest', 'Slowest Session')}
                value={
                  timeToCharge.slowest
                    ? fmtNumber(timeToCharge.slowest.rate)
                    : null
                }
                unit="kWh/h"
                subtitle={
                  timeToCharge.slowest
                    ? t('charging.curve.sessionId', 'Session #{{id}}', {
                        id: timeToCharge.slowest.id,
                      })
                    : undefined
                }
              />
            </div>

            {/* Yearly trend chart */}
            <ChartContainer
              title={t('charging.curve.yearlyTrend', 'Yearly Charging Speed Trend')}
              subtitle={t(
                'charging.curve.yearlyTrendDesc',
                'Average time-to-charge and session count by year',
              )}
              height={280}
            >
              {timeToCharge.yearlyTrend.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart
                      data={timeToCharge.yearlyTrend}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid {...chartGrid} />
                      <XAxis dataKey="year" tick={axisTickSm} />
                      <YAxis
                        yAxisId="min"
                        tick={axisTickSm}
                        orientation="left"
                        label={{
                          value: t('charging.curve.minutes', 'Minutes'),
                          angle: -90,
                          position: 'insideLeft',
                          style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                        }}
                      />
                      <YAxis
                        yAxisId="count"
                        tick={axisTickSm}
                        orientation="right"
                        label={{
                          value: t('charging.curve.sessionCount', 'Sessions'),
                          angle: 90,
                          position: 'insideRight',
                          style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
                        }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        yAxisId="count"
                        dataKey="count"
                        name={t('charging.curve.dcSessions', 'DC Sessions')}
                        fill={CHART_COLORS[5]}
                        opacity={0.3}
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="min"
                        type="monotone"
                        dataKey="avg10to80"
                        name={t('charging.curve.avg10to80Line', '10→80% avg')}
                        stroke={CHART_COLORS[0]}
                        strokeWidth={2}
                        dot={{ r: 4, fill: CHART_COLORS[0] }}
                        unit=" min"
                      />
                      <Line
                        yAxisId="min"
                        type="monotone"
                        dataKey="avg20to80"
                        name={t('charging.curve.avg20to80Line', '20→80% avg')}
                        stroke={CHART_COLORS[2]}
                        strokeWidth={2}
                        dot={{ r: 4, fill: CHART_COLORS[2] }}
                        unit=" min"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="mt-3 flex flex-wrap gap-4 px-2">
                    <div className="flex items-center gap-1.5 text-xs text-white/60">
                      <span className="inline-block h-2 w-3 rounded-sm bg-[#00f0ff]" />
                      {t('charging.curve.avg10to80Line', '10→80% avg')}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-white/60">
                      <span className="inline-block h-2 w-3 rounded-sm bg-purple-500" />
                      {t('charging.curve.avg20to80Line', '20→80% avg')}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-white/60">
                      <span className="inline-block h-2 w-3 rounded-sm bg-red-500 opacity-30" />
                      {t('charging.curve.dcSessions', 'DC Sessions')}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </ChartContainer>
          </div>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
