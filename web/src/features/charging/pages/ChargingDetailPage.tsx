import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ChargingSession, ChargeTelemetryReading } from '@/api/types';
import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI, convertDistanceFromSI, convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtWithUnit, fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, HelpTooltip, PrintButton } from '@/components/ui';
import { MetricBar, InlineMetric, AnimatedNumber, StatCard, KVList, LiveIndicator, DateTime } from '@/components/data-display';
import { RadialGauge } from '@/components/charts';
import { Skeleton, EmptyState, LiveStaleDataBanner, PageHeaderSkeleton, StatGridSkeleton, ChartBlockSkeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { AIChargingDiagnosis } from '@/components/ai/AIChargingDiagnosis';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, ReferenceLine, ChartTooltip,
  chartGrid, axisTickSm, chartMargin,
  AREA_DEFAULTS, areaGradient,
  ChartBrush,
  ChartTimeRangeProvider, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';

import {
  ArrowLeft, Zap, Battery, Clock, Gauge, DollarSign,
  MapPin, Activity,
} from 'lucide-react';
import { distanceAddedM, durationMinutes } from '../components/charging-curve/helpers';

/* ─── helpers ──────────────────────────────────────────────────── */

function isDC(session: ChargingSession): boolean {
  const ft = session.charger_type?.toLowerCase() ?? '';
  return ft !== '' && ft !== '<invalid>' && ft !== 'unknown';
}

function kwhPerHour(session: ChargingSession): number | null {
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  if (durationMin <= 0) return null;
  return (session.total_energy_added_wh / 1000 / durationMin) * 60;
}

/** Synthesize a plausible charge curve when telemetry is absent */
function synthesizeCurve(session: ChargingSession): { soc: number; power: number }[] {
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 50_000) / 1000;
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

/* ─── loading skeleton ──────────────────────────────────────────── */

/**
 * Mirrors the ChargingDetailPage layout while session telemetry loads:
 * page header → 5 hero stat cards → cost ribbon → 8 secondary stats →
 * 2 charts (charge curve + power profile). Migrated to the shared
 * *Skeleton building blocks for consistency.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-8" data-testid="charging-detail-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={5} className="sm:grid-cols-2 md:grid-cols-5" />
      <Skeleton className="h-24 rounded-xl" />
      <StatGridSkeleton cards={8} className="sm:grid-cols-2 lg:grid-cols-4" />
      <ChartBlockSkeleton height={256} />
      <ChartBlockSkeleton height={288} />
    </div>
  );
}

/* ─── synced cursor render-prop helper ─────────────────────────── */

/**
 * Render-prop helper that subscribes the inner recharts chart to the surrounding
 * `<ChartTimeRangeProvider>` so the active
 * cursor and persistent reference line stay in lockstep across the three
 * time-axis charts on this page (SoC/energy/range, temperature, voltage &
 * current). Each chart filters telemetry rows differently so we sync by value
 * rather than by index.
 */
function ChargingChartSync({
  children,
}: {
  children: (state: {
    sync: ReturnType<typeof useSyncedCursor>;
    syncedX: ReturnType<typeof useSyncedReferenceLineX>;
  }) => ReactNode;
}) {
  const sync = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  return <>{children({ sync, syncedX })}</>;
}

/* ─── main page ────────────────────────────────────────────────── */

export default function ChargingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);

  // ChargingSession distance delta comes through the repo adapter as miles. Live
  // ChargingTelemetry fields with misleading suffixes are SI values. Keep these
  // conversions at the display boundary until the backend fields are renamed.
  const { unitPrefs, formatEnergy } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const { costPerKwh: settingsCostPerKwh, currencySymbol, formatEnergyCost } = useFormatting();
  // Battery / inside / outside temperatures from chargeTelemetryFieldMappings
  // (InsideTemp/OutsideTemp/ModuleTempMax) are °C SI — migrate to the SI-aware
  // useUnits surface. unitPrefs.temperature replaces the old tempUnit string;
  // chart values use convertTempFromSI so YAxis ticks remain raw numbers.

  const tempUnit = unitPrefs.temperature;

  const { data: session, isLoading } = useChargingSessionDetail(sessionId || null);
  const { data: telemetry } = useChargeTelemetry(session?.id ?? null);
  const { data: vehicle } = useVehicle(String(session?.vehicle_id ?? ''));
  const { data: liveCharging } = useChargingTelemetryLatest(session?.vehicle_id ?? 0);

  usePageTitle(
    session
      ? `${t('charging.detail.title', 'Charge Session')} #${session.id}`
      : t('charging.detail.title', 'Charge Session'),
  );

  const breadcrumbLabels = {
    '/charging/:id': session
      ? `${formatDate(session.started_at)} — ${formatEnergy(session.total_energy_added_wh)}`
      : `Session #${id}`,
  };

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
      range: r.rated_range != null ? toDistanceDisplay(r.rated_range) : null,
      power: r.power_kw != null ? Math.abs(r.power_kw) : null,
    }));
  }, [telemetry, hasTelemetry, toDistanceDisplay]);

  const tempData = useMemo(() => {
    if (!hasTelemetry) return [];
    return telemetry.map((r: ChargeTelemetryReading) => ({
      time: formatTime(r.created_at),
      battery: r.battery_temp != null ? convertTempFromSI(r.battery_temp, unitPrefs.temperature) : null,
      inside: r.inside_temp != null ? convertTempFromSI(r.inside_temp, unitPrefs.temperature) : null,
      outside: r.outside_temp != null ? convertTempFromSI(r.outside_temp, unitPrefs.temperature) : null,
    }));
  }, [telemetry, hasTelemetry, unitPrefs.temperature]);

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
      <PageContainer title={t('charging.detail.title', 'Charge Session')} breadcrumbLabels={breadcrumbLabels}>
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  const avgRate = kwhPerHour(session);
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  const addedDistanceM = distanceAddedM(session);
  const costPerKwh =
    session.cost_decimal != null && session.total_energy_added_wh > 0
      ? session.cost_decimal / (session.total_energy_added_wh / 1000)
      : null;

  return (
    <PageContainer
      title={t('charging.detail.title', 'Charge Session')}
      className="space-y-8"
      breadcrumbLabels={breadcrumbLabels}
      actions={
        <div data-print-hide className="flex items-center gap-2">
          <LiveIndicator variant="compact" />
          <PrintButton />
        </div>
      }
    >
      <LiveStaleDataBanner />
      <FadeIn>
        {/* ── 1. Header ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link to="/charging" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {formatDate(session.started_at)}
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
          {session.start_place && (
            <Badge variant="neutral" size="sm">
              <MapPin className="h-3 w-3 mr-1 inline" />
              {session.start_place}
            </Badge>
          )}
        </div>

        {/*
          The withAiFeature HOC inside AIChargingDiagnosis renders
          this section ONLY when ai_mode='local'|'cloud' AND the
          charging-diagnosis toggle is on (ADR-015 §I5 + §I6). When
          AI is off the wrapper returns null — the surrounding hero
          gauges, charge curve, and downstream sections are
          unaffected, which is the invariant
          TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags
          verifies.

          Placement: directly between the header and the hero
          gauges so the diagnosis narrative appears alongside the
          same metrics the LLM is reading from (header above ↔
          narrative below ↔ hero gauges and deep dives further
          down the page).
        */}
        <div className="mb-6">
          <AIChargingDiagnosis sessionId={id} />
        </div>

        {/* ── 2. Hero gauges ─────────────────────────────────── */}
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="cyan">
              <RadialGauge
                value={convertEnergyFromSI(session.total_energy_added_wh ?? 0, unitPrefs.energy)}
                max={Math.max(convertEnergyFromSI(session.total_energy_added_wh ?? 1, unitPrefs.energy), 80)}
                label={t('charging.detail.energyAdded', 'Energy Added')}
                unit={unitPrefs.energy}
                color="#00f0ff"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="green">
              <RadialGauge
                value={session.end_soc_pct ?? 0}
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
                value={convertPowerFromSI(session.peak_power_w ?? 0, 'kW')}
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
                value={durationMin}
                max={Math.max(durationMin || 1, 120)}
                label={t('charging.detail.duration', 'Duration')}
                unit="min"
                color="#f59e0b"
              />
            </GlassPanel>
          </StaggerItem>
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-4" glow="none">
              <RadialGauge
                value={convertPowerFromSI(session.avg_power_w ?? 0, 'kW')}
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
          <h2 className="flex items-center gap-1.5 text-lg font-semibold mb-4">
            {t('charging.detail.batteryProgress', 'Battery Progress')}
            <HelpTooltip
              size="sm"
              i18nKey="help.charging.socRange"
              defaultValue="The starting and ending state-of-charge percentages for this session. Wider ranges generally mean longer sessions and more taper."
              ariaLabel={t('help.charging.socRange.aria', { defaultValue: 'More info about state-of-charge range' })}
            />
          </h2>
          <div className="space-y-4">
            <MetricBar
              value={session.start_soc_pct ?? 0}
              max={100}
              color="#f59e0b"
              label={t('charging.detail.startSoc', 'Start SoC')}
              sublabel={fmtPercent(session.start_soc_pct)}
            />
            <MetricBar
              value={session.end_soc_pct ?? 0}
              max={100}
              color="#10b981"
              label={t('charging.detail.endSoc', 'End SoC')}
              sublabel={fmtPercent(session.end_soc_pct)}
            />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
            <div>
              <p className="text-muted">{t('charging.detail.socGained', 'SoC Gained')}</p>
              <p className="text-lg font-bold">
                <AnimatedNumber
                  value={(session.end_soc_pct ?? 0) - (session.start_soc_pct ?? 0)}
                />
                %
              </p>
            </div>
            <div>
              <p className="text-muted">{t('charging.detail.rangeGained', 'Range Gained')}</p>
              <p className="text-lg font-bold">
                {addedDistanceM != null
                  ? fmtWithUnit(toDistanceDisplay((addedDistanceM ?? 0) / 1000), distanceUnit, 0)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted">{t('charging.detail.energyAdded', 'Energy Added')}</p>
              <p className="text-lg font-bold">
                {formatEnergy(session.total_energy_added_wh)}
              </p>
            </div>
          </div>
        </GlassPanel>

        {/* ── 4. Eight stat cards ────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label={t('charging.detail.energy', 'Energy')}
            value={fmtNumber(convertEnergyFromSI(session.total_energy_added_wh, unitPrefs.energy))}
            unit={unitPrefs.energy}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label={t('charging.detail.duration', 'Duration')}
            value={fmtNumber(durationMin, 0)}
            unit="min"
          />
          <StatCard
            icon={<Gauge className="h-4 w-4" />}
            label={t('charging.detail.peakPower', 'Peak Power')}
            value={fmtNumber(convertPowerFromSI(session.peak_power_w ?? 0, 'kW'))}
            unit="kW"
          />
          <StatCard
            icon={<Battery className="h-4 w-4" />}
            label={t('charging.detail.socRange', 'SoC Range')}
            value={`${fmtNumber(session.start_soc_pct ?? 0, 0)}–${fmtNumber(session.end_soc_pct ?? 0, 0)}`}
            unit="%"
          />
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label={session.cost_decimal != null
              ? t('charging.detail.totalCost', 'Total Cost')
              : t('charging.detail.estCost', 'Est. Cost')}
            value={session.cost_decimal != null
              ? fmtNumber(session.cost_decimal, 2)
              : session.total_energy_added_wh > 0
                ? formatEnergyCost(session.total_energy_added_wh / 1000)
                : '—'}
            unit={session.cost_decimal != null ? '$' : ''}
            sublabel={session.cost_decimal == null && session.total_energy_added_wh > 0
              ? t('charging.detail.atRate', { currencySymbol, costPerKwh: settingsCostPerKwh, defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh' })
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
              addedDistanceM != null
                ? fmtNumber(toDistanceDisplay((addedDistanceM ?? 0) / 1000), 0)
                : '—'
            }
            unit={addedDistanceM != null ? distanceUnit : ''}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            <InlineMetric
              icon={<Gauge className="h-4 w-4 text-purple-400" />}
              label={t('charging.detail.avgPower', 'Avg Power')}
              value={session.avg_power_w != null ? fmtWithUnit(convertPowerFromSI(session.avg_power_w, 'kW'), 'kW') : '—'}
            />
            <InlineMetric
              icon={<MapPin className="h-4 w-4 text-green-400" />}
              label={t('charging.detail.milesAdded', 'Miles Added')}
              value={
                addedDistanceM != null
                  ? fmtWithUnit(toDistanceDisplay((addedDistanceM ?? 0) / 1000), distanceUnit, 0)
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
                value: session.start_place ?? '—',
              },
              {
                label: t('charging.detail.vehicle', 'Vehicle'),
                value: vehicle?.display_name ?? `ID ${session.vehicle_id}`,
              },
            ]}
          />
        </GlassPanel>

        {/* ── 6. Location info ────────────────────────────────── */}
        {session.start_place && (
          <GlassPanel className="p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">
              {t('charging.detail.location', 'Location')}
            </h2>
            <p className="text-sm text-[var(--text-primary)]">{session.start_place}</p>
          </GlassPanel>
        )}

        {/* ── 7. Charge curve chart ──────────────────────────── */}
        <GlassPanel className="p-6 mb-8">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold mb-4">
            {t('charging.detail.chargeCurve', 'Charge Curve')}
            {!hasTelemetry && (
              <span className="text-xs text-muted ml-2">
                ({t('charging.detail.estimated', 'estimated')})
              </span>
            )}
            <HelpTooltip
              size="sm"
              i18nKey="help.charging.chargeCurve"
              defaultValue="Power vs SoC curve for the session. Tapering — the gradual drop in power as the battery approaches full — is inherent to lithium chemistry and is not a fault. Sudden drops below the curve indicate derating: the charger or battery is throttling power because of cell or ambient temperature limits."
              ariaLabel={t('help.charging.chargeCurve.aria', { defaultValue: 'More info about taper and derating' })}
            />
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
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8 opacity-20" />}
              message={t('common.noData', 'No data available')}
              className="py-8"
            />
          )}
        </GlassPanel>

        {/* ── 8/9/10. Synced time-axis charts ─────────────────────
              The SoC/energy/range, temperature, and voltage/current panels all
              live on the same charge-session time
              axis but use different filtered telemetry rows. Wrapping them in
              a `<ChartTimeRangeProvider>` with `syncMethod="value"` makes
              recharts mirror the active hover cursor across all three, and
              each chart renders a persistent `<ReferenceLine>` at the last
              hovered timestamp via {@link useSyncedReferenceLineX}. */}
        <ChartTimeRangeProvider syncId="charging.session" syncMethod="value">
          {/* ── 8. SoC / Energy / Range over time ──────────────── */}
          <GlassPanel className="p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">
              {t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}
            </h2>
            {timeSeriesData.length > 0 ? (
              <ChargingChartSync>
                {({ sync, syncedX }) => (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart
                      data={timeSeriesData}
                      margin={chartMargin}
                      syncId={sync.syncId}
                      syncMethod={sync.syncMethod}
                      onMouseMove={sync.onMouseMove}
                    >
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
                      {/* Brush lets users zoom into a portion of the charge
                          timeline; recharts propagates the visible window to
                          every other chart sharing this provider's syncId. */}
                      <ChartBrush dataKey="time" />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </ChargingChartSync>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8 opacity-20" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </GlassPanel>

          {/* ── 9. Temperature chart ───────────────────────────── */}
          <GlassPanel className="p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">
              {t('charging.detail.temperature', 'Temperature')}
            </h2>
            {tempData.length > 0 ? (
              <ChargingChartSync>
                {({ sync, syncedX }) => (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={tempData}
                      margin={chartMargin}
                      syncId={sync.syncId}
                      syncMethod={sync.syncMethod}
                      onMouseMove={sync.onMouseMove}
                    >
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
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </ChargingChartSync>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8 opacity-20" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </GlassPanel>

          {/* ── 10. Voltage & Current chart ────────────────────── */}
          <GlassPanel className="p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">
              {t('charging.detail.voltageCurrent', 'Voltage & Current')}
            </h2>
            {voltCurrentData.length > 0 ? (
              <ChargingChartSync>
                {({ sync, syncedX }) => (
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart
                      data={voltCurrentData}
                      margin={chartMargin}
                      syncId={sync.syncId}
                      syncMethod={sync.syncMethod}
                      onMouseMove={sync.onMouseMove}
                    >
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
                      {syncedX != null && (
                        <ReferenceLine
                          yAxisId="v"
                          x={syncedX}
                          stroke={chartTokens.cursor.stroke}
                          strokeWidth={chartTokens.cursor.strokeWidth}
                          strokeDasharray={chartTokens.cursor.strokeDasharray}
                          ifOverflow="hidden"
                          isFront
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </ChargingChartSync>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8 opacity-20" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </GlassPanel>
        </ChartTimeRangeProvider>

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
                    liveCharging.charger_power_w != null
                      ? fmtWithUnit(liveCharging.charger_power_w, 'kW', 1)
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
                      ? fmtWithUnit(toDistanceDisplay(liveCharging.battery_range_mi), distanceUnit, 0)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeRate', 'Charge Rate'),
                  value:
                    liveCharging.range_added_meters_per_hour != null
                      ? fmtWithUnit(toDistanceDisplay(liveCharging.range_added_meters_per_hour), `${distanceUnit}/h`, 1)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeEnergyAdded', 'Energy Added'),
                  value:
                    liveCharging.charge_energy_added_wh != null
                      ? fmtWithUnit(liveCharging.charge_energy_added_wh, 'kWh', 2)
                      : '—',
                },
                {
                  label: t('charging.detail.chargeMilesAdded', 'Range Added'),
                  value:
                    liveCharging.range_added_meters_per_hour != null
                      ? fmtWithUnit(toDistanceDisplay((liveCharging.range_added_meters_per_hour ?? 0) / 1000), distanceUnit, 1)
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-muted mb-1">{t('charging.detail.started', 'Started')}</p>
              <p className="font-medium"><DateTime value={session.started_at} in="vehicle" showTz /></p>
            </div>
            <div>
              <p className="text-muted mb-1">{t('charging.detail.ended', 'Ended')}</p>
              <p className="font-medium">
                {session.ended_at ? <DateTime value={session.ended_at} in="vehicle" showTz /> : '—'}
              </p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
