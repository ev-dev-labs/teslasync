import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ChargingSession, ChargeTelemetryReading } from '@/api/types';
import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatDate, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtWithUnit, fmtPercent } from '@/lib/numberFormat';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { MetricBar, InlineMetric, AnimatedNumber, StatCard, KVList } from '@/components/data-display';
import { RadialGauge } from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, ChartTooltip,
  chartGrid, axisTickSm, chartMargin,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';

import {
  ArrowLeft, Zap, Battery, Clock, Gauge, DollarSign,
  MapPin, Activity,
} from 'lucide-react';

/* ─── helpers ──────────────────────────────────────────────────── */

function isDC(session: ChargingSession): boolean {
  const ft = session.charger_type?.toLowerCase() ?? '';
  return ft !== '' && ft !== '<invalid>' && ft !== 'unknown';
}

function kwhPerHour(session: ChargingSession): number | null {
  if (!session.duration_min || session.duration_min <= 0) return null;
  return (session.energy_added_kwh / session.duration_min) * 60;
}

/** Synthesize a plausible charge curve when telemetry is absent */
function synthesizeCurve(session: ChargingSession): { soc: number; power: number }[] {
  const startSoc = session.start_battery_pct ?? 0;
  const endSoc = session.end_battery_pct ?? 100;
  const peakPower = session.charger_power_kw_max ?? 50;
  const points: { soc: number; power: number }[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    const soc = startSoc + (endSoc - startSoc) * pct;
    // DC tapers above 80 %; AC stays roughly flat
    const taper = isDC(session) && soc > 80 ? 1 - (soc - 80) / 40 : 1;
    points.push({ soc: Math.round(soc), power: Math.round(peakPower * Math.max(taper, 0.15) * 10) / 10 });
  }
  return points;
}

/* ─── loading skeleton ─────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

/* ─── main page ────────────────────────────────────────────────── */

export default function ChargingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);

  const {
    convertDistance, convertTemp, distanceUnit, tempUnit,
    costPerKwh: settingsCostPerKwh, currencySymbol, formatEnergyCost,
  } = useSettings();

  const { data: session, isLoading } = useChargingSessionDetail(sessionId || null);
  const { data: telemetry } = useChargeTelemetry(session?.id ?? null);
  const { data: vehicle } = useVehicle(String(session?.vehicle_id ?? ''));
  const { data: liveCharging } = useChargingTelemetryLatest(session?.vehicle_id ?? 0);

  usePageTitle(
    session
      ? `${t('charging.detail.title', 'Charge Session')} #${session.id}`
      : t('charging.detail.title', 'Charge Session'),
  );

  const breadcrumbs = useBreadcrumbs({
    '/charging/:id': session
      ? `${formatDate(session.start_ts)} — ${fmtNumber(session.energy_added_kwh)} kWh`
      : `Session #${id}`,
  });

  const hasTelemetry = !!telemetry && telemetry.length > 0;
  const dc = session ? isDC(session) : false;

  const chargingState = liveCharging?.charging_state;
  const chargingStateVariant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' = (() => {
    switch (chargingState) {
      case 'Charging':
      case 'Starting':
        return 'success';
      case 'Complete':
        return 'info';
      case 'Stopped':
      case 'NoPower':
        return 'warning';
      case 'Error':
        return 'danger';
      default:
        return 'neutral';
    }
  })();

  /* derived chart data */
  const chargeCurve = useMemo(() => {
    if (!session) return [];
    if (hasTelemetry) {
      return telemetry
        .filter((r: ChargeTelemetryReading) => r.battery_level != null && r.power_kw != null)
        .map((r: ChargeTelemetryReading) => ({
          soc: r.battery_level!,
          power: Math.abs(r.power_kw!),
        }));
    }
    return synthesizeCurve(session);
  }, [session, telemetry, hasTelemetry]);

  const timeSeriesData = useMemo(() => {
    if (!hasTelemetry) return [];
    return telemetry.map((r: ChargeTelemetryReading) => ({
      time: formatTime(r.created_at),
      soc: r.battery_level ?? r.soc,
      energy: r.energy_added,
      range: r.rated_range != null ? convertDistance(r.rated_range) : null,
      power: r.power_kw != null ? Math.abs(r.power_kw) : null,
    }));
  }, [telemetry, hasTelemetry, convertDistance]);

  const tempData = useMemo(() => {
    if (!hasTelemetry) return [];
    return telemetry.map((r: ChargeTelemetryReading) => ({
      time: formatTime(r.created_at),
      battery: r.battery_temp != null ? convertTemp(r.battery_temp) : null,
      inside: r.inside_temp != null ? convertTemp(r.inside_temp) : null,
      outside: r.outside_temp != null ? convertTemp(r.outside_temp) : null,
    }));
  }, [telemetry, hasTelemetry, convertTemp]);

  const voltCurrentData = useMemo(() => {
    if (!hasTelemetry) return [];
    return telemetry
      .filter((r: ChargeTelemetryReading) => r.voltage != null || r.current_amps != null)
      .map((r: ChargeTelemetryReading) => ({
        time: formatTime(r.created_at),
        voltage: r.voltage,
        current: r.current_amps != null ? Math.abs(r.current_amps) : null,
      }));
  }, [telemetry, hasTelemetry]);

  /* ─── render ───────────────────────────────────────────── */

  if (isLoading || !session) {
    return (
      <PageContainer title={t('charging.detail.title', 'Charge Session')} breadcrumbs={breadcrumbs}>
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  const avgRate = kwhPerHour(session);
  const costPerKwh =
    session.cost != null && session.energy_added_kwh > 0
      ? session.cost / session.energy_added_kwh
      : null;

  return (
    <PageContainer title={t('charging.detail.title', 'Charge Session')} className="space-y-8" breadcrumbs={breadcrumbs}>
      <FadeIn>
        {/* ── 1. Header ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link to="/charging" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {formatDate(session.start_ts)}
          </h1>
          {vehicle && (
            <span className="text-muted text-sm">{vehicle.display_name}</span>
          )}
          <Badge variant={dc ? 'warning' : 'info'} dot>
            {dc ? 'DC' : 'AC'}
          </Badge>
          {chargingState && (
            <Badge variant={chargingStateVariant} size="sm" dot>
              {t(
                `charging.detail.chargingState.${chargingState}`,
                chargingState,
              )}
            </Badge>
          )}
          {session.charger_type && (
            <Badge variant="neutral" size="sm">{session.charger_type}</Badge>
          )}
          {session.charger_location && (
            <Badge variant="neutral" size="sm">
              <MapPin className="h-3 w-3 mr-1 inline" />
              {session.charger_location}
            </Badge>
          )}
        </div>

        {/* ── 2. Hero gauges ─────────────────────────────────── */}
        <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 mb-8">
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="cyan">
              <RadialGauge
                value={session.energy_added_kwh ?? 0}
                max={Math.max(session.energy_added_kwh ?? 1, 80)}
                label={t('charging.detail.energyAdded', 'Energy Added')}
                unit="kWh"
                color="#00f0ff"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="green">
              <RadialGauge
                value={session.end_battery_pct ?? 0}
                max={100}
                label={t('charging.detail.endSoc', 'End SoC')}
                unit="%"
                color="#10b981"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="purple">
              <RadialGauge
                value={session.charger_power_kw_max ?? 0}
                max={dc ? 250 : 22}
                label={t('charging.detail.peakPower', 'Peak Power')}
                unit="kW"
                color="#a855f7"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="none">
              <RadialGauge
                value={session.duration_min ?? 0}
                max={Math.max(session.duration_min ?? 1, 120)}
                label={t('charging.detail.duration', 'Duration')}
                unit="min"
                color="#f59e0b"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="none">
              <RadialGauge
                value={session.charger_power_kw_avg ?? 0}
                max={dc ? 250 : 22}
                label={t('charging.detail.avgPower', 'Avg Power')}
                unit="kW"
                color="#06b6d4"
              />
            </GlassPanel>
          </StaggerItem>
        </StaggerContainer>

        {/* ── 3. Battery fill meter ──────────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.batteryProgress', 'Battery Progress')}
          </h2>
          <div className="space-y-4">
            <MetricBar
              value={session.start_battery_pct ?? 0}
              max={100}
              color="#f59e0b"
              label={t('charging.detail.startSoc', 'Start SoC')}
              sublabel={fmtPercent(session.start_battery_pct)}
            />
            <MetricBar
              value={session.end_battery_pct ?? 0}
              max={100}
              color="#10b981"
              label={t('charging.detail.endSoc', 'End SoC')}
              sublabel={fmtPercent(session.end_battery_pct)}
            />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
            <div>
              <p className="text-muted">{t('charging.detail.socGained', 'SoC Gained')}</p>
              <p className="text-lg font-bold">
                <AnimatedNumber
                  value={(session.end_battery_pct ?? 0) - (session.start_battery_pct ?? 0)}
                />
                %
              </p>
            </div>
            <div>
              <p className="text-muted">{t('charging.detail.rangeGained', 'Range Gained')}</p>
              <p className="text-lg font-bold">
                {session.miles_added != null
                  ? fmtWithUnit(convertDistance(session.miles_added), distanceUnit, 0)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted">{t('charging.detail.energyAdded', 'Energy Added')}</p>
              <p className="text-lg font-bold">
                {fmtWithUnit(session.energy_added_kwh, 'kWh')}
              </p>
            </div>
          </div>
        </GlassPanel>

        {/* ── 4. Eight stat cards ────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label={t('charging.detail.energy', 'Energy')}
            value={fmtNumber(session.energy_added_kwh)}
            unit="kWh"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label={t('charging.detail.duration', 'Duration')}
            value={fmtNumber(session.duration_min, 0)}
            unit="min"
          />
          <StatCard
            icon={<Gauge className="h-4 w-4" />}
            label={t('charging.detail.peakPower', 'Peak Power')}
            value={fmtNumber(session.charger_power_kw_max)}
            unit="kW"
          />
          <StatCard
            icon={<Battery className="h-4 w-4" />}
            label={t('charging.detail.socRange', 'SoC Range')}
            value={`${session.start_battery_pct ?? 0}–${session.end_battery_pct ?? 0}`}
            unit="%"
          />
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label={session.cost != null
              ? t('charging.detail.totalCost', 'Total Cost')
              : t('charging.detail.estCost', 'Est. Cost')}
            value={session.cost != null
              ? fmtNumber(session.cost, 2)
              : session.energy_added_kwh > 0
                ? formatEnergyCost(session.energy_added_kwh)
                : '—'}
            unit={session.cost != null ? '$' : ''}
            sublabel={session.cost == null && session.energy_added_kwh > 0
              ? t('charging.detail.atRate', `at ${currencySymbol}${settingsCostPerKwh}/kWh`)
              : undefined}
          />
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label={t('charging.detail.perKwh', 'Per kWh')}
            value={costPerKwh != null
              ? fmtNumber(costPerKwh, 2)
              : fmtNumber(settingsCostPerKwh, 2)}
            unit="$/kWh"
            sublabel={costPerKwh == null ? t('charging.detail.fromSettings', 'from settings') : undefined}
          />
          <StatCard
            icon={<MapPin className="h-4 w-4" />}
            label={t('charging.detail.milesAdded', 'Miles Added')}
            value={
              session.miles_added != null
                ? fmtNumber(convertDistance(session.miles_added), 0)
                : '—'
            }
            unit={session.miles_added != null ? distanceUnit : ''}
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label={t('charging.detail.avgRate', 'kWh/h Avg')}
            value={avgRate != null ? fmtNumber(avgRate) : '—'}
            unit={avgRate != null ? 'kWh/h' : ''}
          />
        </div>

        {/* ── 5. More details section ────────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.moreDetails', 'More Details')}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            <InlineMetric
              icon={<Gauge className="h-4 w-4 text-purple-400" />}
              label={t('charging.detail.avgPower', 'Avg Power')}
              value={session.charger_power_kw_avg != null ? fmtWithUnit(session.charger_power_kw_avg, 'kW') : '—'}
            />
            <InlineMetric
              icon={<MapPin className="h-4 w-4 text-green-400" />}
              label={t('charging.detail.milesAdded', 'Miles Added')}
              value={
                session.miles_added != null
                  ? fmtWithUnit(convertDistance(session.miles_added), distanceUnit, 0)
                  : '—'
              }
            />
            <InlineMetric
              icon={<Zap className="h-4 w-4 text-blue-400" />}
              label={t('charging.detail.status', 'Status')}
              value={session.ended_status ?? '—'}
            />
            <InlineMetric
              icon={<DollarSign className="h-4 w-4 text-orange-400" />}
              label={t('charging.detail.currency', 'Currency')}
              value={session.cost_currency ?? '—'}
            />
          </div>
          <KVList
            columns={2}
            items={[
              {
                label: t('charging.detail.chargerType', 'Charger Type'),
                value: session.charger_type ?? (dc ? 'DC' : 'AC'),
              },
              {
                label: t('charging.detail.location', 'Location'),
                value: session.charger_location ?? '—',
              },
              {
                label: t('charging.detail.vehicle', 'Vehicle'),
                value: vehicle?.display_name ?? `ID ${session.vehicle_id}`,
              },
            ]}
          />
        </GlassPanel>

        {/* ── 6. Location info ────────────────────────────────── */}
        {session.charger_location && (
          <GlassPanel className="p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">
              {t('charging.detail.location', 'Location')}
            </h2>
            <p className="text-sm text-white/80">{session.charger_location}</p>
          </GlassPanel>
        )}

        {/* ── 7. Charge curve chart ──────────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.chargeCurve', 'Charge Curve')}
            {!hasTelemetry && (
              <span className="text-xs text-muted ml-2">
                ({t('charging.detail.estimated', 'estimated')})
              </span>
            )}
          </h2>
          {chargeCurve.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chargeCurve} margin={chartMargin}>
                {areaGradient('powerGrad', '#a855f7')}
                {chartGrid}
                <XAxis
                  dataKey="soc"
                  tick={axisTickSm}
                  label={{ value: 'SoC %', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <YAxis
                  tick={axisTickSm}
                  label={{ value: 'kW', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="power"
                  stroke="#a855f7"
                  fill="url(#powerGrad)"
                  name={t('charging.detail.power', 'Power')}
                  unit=" kW"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>

        {/* ── 8. SoC / Energy / Range over time ──────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}
          </h2>
          {timeSeriesData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={timeSeriesData} margin={chartMargin}>
                {areaGradient('socGrad', '#10b981')}
                {chartGrid}
                <XAxis dataKey="time" tick={axisTickSm} />
                <YAxis yAxisId="left" tick={axisTickSm} domain={[0, 100]} />
                <YAxis yAxisId="right" orientation="right" tick={axisTickSm} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  {...AREA_DEFAULTS}
                  yAxisId="left"
                  dataKey="soc"
                  stroke="#10b981"
                  fill="url(#socGrad)"
                  name={t('charging.detail.soc', 'SoC')}
                  unit=" %"
                />
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="right"
                  dataKey="energy"
                  stroke="#00f0ff"
                  name={t('charging.detail.energy', 'Energy')}
                  unit=" kWh"
                />
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="right"
                  dataKey="range"
                  stroke="#f59e0b"
                  name={t('charging.detail.range', 'Range')}
                  unit={` ${distanceUnit}`}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>

        {/* ── 9. Temperature chart ───────────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.temperature', 'Temperature')}
          </h2>
          {tempData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={tempData} margin={chartMargin}>
                {chartGrid}
                <XAxis dataKey="time" tick={axisTickSm} />
                <YAxis tick={axisTickSm} unit={` ${tempUnit}`} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="battery"
                  stroke="#ef4444"
                  name={t('charging.detail.batteryTemp', 'Battery')}
                  unit={` ${tempUnit}`}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="inside"
                  stroke="#f59e0b"
                  name={t('charging.detail.insideTemp', 'Inside')}
                  unit={` ${tempUnit}`}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="outside"
                  stroke="#3b82f6"
                  name={t('charging.detail.outsideTemp', 'Outside')}
                  unit={` ${tempUnit}`}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>

        {/* ── 10. Voltage & Current chart ────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
            {t('charging.detail.voltageCurrent', 'Voltage & Current')}
          </h2>
          {voltCurrentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={voltCurrentData} margin={chartMargin}>
                {chartGrid}
                <XAxis dataKey="time" tick={axisTickSm} />
                <YAxis yAxisId="v" tick={axisTickSm} unit=" V" />
                <YAxis yAxisId="a" orientation="right" tick={axisTickSm} unit=" A" />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="v"
                  dataKey="voltage"
                  stroke="#f59e0b"
                  name={t('charging.detail.voltage', 'Voltage')}
                  unit=" V"
                />
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="a"
                  dataKey="current"
                  stroke="#06b6d4"
                  name={t('charging.detail.current', 'Current')}
                  unit=" A"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>

        {/* ── 11. Temperature summary fallback — removed: inside_temp_avg/outside_temp_avg no longer in session */}

        {/* ── 11b. Advanced charging parameters (live state) ─── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="text-lg font-semibold mb-1">
            {t('charging.detail.advanced', 'Advanced Charging Parameters')}
          </h2>
          <p className="text-xs text-muted mb-4">
            {t('charging.detail.advancedHint', 'Latest reported values from the vehicle.')}
          </p>
          {liveCharging ? (
            <KVList
              columns={2}
              items={[
                {
                  label: t('charging.detail.chargingState', 'Charging State'),
                  value:
                    liveCharging.charging_state != null && liveCharging.charging_state !== ''
                      ? liveCharging.charging_state
                      : '—',
                },
                {
                  label: t('charging.detail.chargerVoltage', 'Charger Voltage'),
                  value:
                    liveCharging.charger_voltage != null
                      ? fmtWithUnit(liveCharging.charger_voltage, 'V', 0)
                      : '—',
                },
                {
                  label: t('charging.detail.chargerActualCurrent', 'Active Charge Current'),
                  value:
                    liveCharging.charger_actual_current != null
                      ? fmtWithUnit(liveCharging.charger_actual_current, 'A', 1)
                      : '—',
                },
                {
                  label: t('charging.detail.chargerPilotCurrent', 'Pilot Current'),
                  value:
                    liveCharging.charger_pilot_current != null
                      ? fmtWithUnit(liveCharging.charger_pilot_current, 'A', 1)
                      : '—',
                },
                {
                  label: t('charging.detail.chargerPowerKw', 'Charger Power'),
                  value:
                    liveCharging.charger_power_kw != null
                      ? fmtWithUnit(liveCharging.charger_power_kw, 'kW', 1)
                      : '—',
                },
                {
                  label: t('charging.detail.chargerPhases', 'Phases'),
                  value:
                    liveCharging.charger_phases != null
                      ? String(liveCharging.charger_phases)
                      : '—',
                },
                {
                  label: t('charging.detail.batteryRange', 'Battery Range'),
                  value:
                    liveCharging.battery_range_mi != null
                      ? fmtWithUnit(convertDistance(liveCharging.battery_range_mi), distanceUnit, 0)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeRate', 'Charge Rate'),
                  value:
                    liveCharging.charge_rate_mph != null
                      ? fmtWithUnit(convertDistance(liveCharging.charge_rate_mph), `${distanceUnit}/h`, 1)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeEnergyAdded', 'Energy Added'),
                  value:
                    liveCharging.charge_energy_added_kwh != null
                      ? fmtWithUnit(liveCharging.charge_energy_added_kwh, 'kWh', 2)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeMilesAdded', 'Range Added'),
                  value:
                    liveCharging.charge_miles_added != null
                      ? fmtWithUnit(convertDistance(liveCharging.charge_miles_added), distanceUnit, 1)
                      : '—',
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">
              {t('charging.detail.noLiveData', 'No live charging telemetry available.')}
            </p>
          )}
        </GlassPanel>
        {/* ── 12. Timestamps footer ──────────────────────────── */}
        <GlassPanel className="p-6">
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-muted mb-1">{t('charging.detail.started', 'Started')}</p>
              <p className="font-medium">{formatDateTime(session.start_ts)}</p>
            </div>
            <div>
              <p className="text-muted mb-1">{t('charging.detail.ended', 'Ended')}</p>
              <p className="font-medium">
                {session.end_ts ? formatDateTime(session.end_ts) : '—'}
              </p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
