import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Zap, Battery, BatteryCharging, Clock, Gauge, DollarSign,
  MapPin, Activity, Thermometer, Waves, TrendingUp,
} from 'lucide-react';

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
import {
  GlassPanel, Badge, HelpTooltip, PrintButton,
  SectionTitle, PanelTitle, Text,
} from '@/components/ui';
import {
  MetricBar, InlineMetric, AnimatedNumber, MetricCard, KVList,
  LiveIndicator, DateTime,
} from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import {
  Skeleton, EmptyState, QueryError, LiveStaleDataBanner,
  PageHeaderSkeleton, StatGridSkeleton, ChartBlockSkeleton,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { AIChargingDiagnosis } from '@/components/ai/AIChargingDiagnosis';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, ReferenceLine, ChartTooltip,
  chartGrid, axisTickSm, chartMargin,
  AREA_DEFAULTS, areaGradient,
  ChartBrush,
  ChartTimeRangeProvider, useSyncedCursor, useSyncedReferenceLineX,
  ChartLegend, EmbeddedChart,
} from '@/components/charts';
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

/** Synthesize a plausible charge curve when telemetry is absent. */
function synthesizeCurve(session: ChargingSession): { soc: number; power: number }[] {
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 50_000) / 1000;
  const points: { soc: number; power: number }[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    const soc = startSoc + (endSoc - startSoc) * pct;
    // DC tapers above 80 %; AC stays roughly flat.
    const taper = isDC(session) && soc > 80 ? 1 - (soc - 80) / 40 : 1;
    points.push({ soc: Math.round(soc), power: Math.round(peakPower * Math.max(taper, 0.15) * 10) / 10 });
  }
  return points;
}

/**
 * Semantic → shared-Badge variant for the live charging state chip. Colour is
 * always paired with the human-readable state text (never colour-alone) so the
 * status stays legible for colour-blind users.
 */
function chargingStateVariant(
  state: string | null | undefined,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (state) {
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
}

/* ─── loading skeleton ──────────────────────────────────────────── */

/**
 * Mirrors the ChargingDetailPage bento while the primary session query loads:
 * page header → KPI band → gauges + battery progress → hero curve → synced
 * telemetry charts. Built from the shared *Skeleton building blocks so the
 * loading rhythm matches the rest of the app.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-6" data-testid="charging-detail-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={8} className="sm:grid-cols-4 2xl:grid-cols-8" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartBlockSkeleton height={220} className="xl:col-span-2" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartBlockSkeleton height={288} className="xl:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <ChartBlockSkeleton height={288} />
    </div>
  );
}

/* ─── synced cursor render-prop helper ─────────────────────────── */

/**
 * Render-prop helper that subscribes the inner recharts chart to the surrounding
 * `<ChartTimeRangeProvider>` so the active cursor and persistent reference line
 * stay in lockstep across the three time-axis charts on this page (SoC/energy/
 * range, temperature, voltage & current). Each chart filters telemetry rows
 * differently so we sync by value rather than by index.
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
  const closedTelemetryDescription = t(
    'charging.detail.closedTelemetryDescription',
    'This closed session cannot recover missing samples; future sessions will populate when telemetry is available.',
  );
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);

  // ChargingSession distance delta comes through the repo adapter as miles.
  // Live charging telemetry is canonical SI and is converted only at the
  // display boundary.
  const { unitPrefs, formatEnergy, formatPower } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const {
    costPerKwh: settingsCostPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
  } = useFormatting();
  const tempUnit = unitPrefs.temperature;

  const sessionQuery = useChargingSessionDetail(sessionId || null);
  const {
    data: session,
    isLoading,
    error: sessionError,
    refetch: refetchSession,
  } = sessionQuery;
  const {
    data: telemetry,
    isLoading: telemetryLoading,
    error: telemetryError,
    refetch: refetchTelemetry,
  } = useChargeTelemetry(session?.id ?? null);
  const { data: vehicle } = useVehicle(String(session?.vehicle_id ?? ''));
  const { data: liveCharging, isLoading: liveLoading } = useChargingTelemetryLatest(
    session?.vehicle_id ?? 0,
  );

  usePageTitle(
    session
      ? `${t('charging.detail.title', 'Charge Session')} #${session.id}`
      : t('charging.detail.title', 'Charge Session'),
  );

  const breadcrumbLabels = {
    '/charging/:id': session
      ? `${formatDate(session.started_at)} — ${formatEnergy(session.total_energy_added_wh)}`
      : `${t('charging.detail.title', 'Charge Session')} #${id}`,
  };

  const hasTelemetry = !!telemetry && telemetry.length > 0;
  const dc = session ? isDC(session) : false;
  const chargingState = liveCharging?.charging_state;

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

  /* ─── primary-resource states (session drives the whole page) ─── */

  if (isLoading && !session) {
    return (
      <PageContainer
        title={t('charging.detail.title', 'Charge Session')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (!session) {
    return (
      <PageContainer
        title={t('charging.detail.title', 'Charge Session')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={sessionError}
            resourceName={t('charging.detail.resource', 'Charge session')}
            listHref="/charging"
            onRetry={() => refetchSession()}
          />
        </GlassPanel>
      </PageContainer>
    );
  }

  /* ─── derived scalars (session is now guaranteed) ─── */

  const avgRate = kwhPerHour(session);
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  const addedDistanceM = distanceAddedM(session);
  const perKwhRate =
    session.cost_decimal != null && session.total_energy_added_wh > 0
      ? session.cost_decimal / (session.total_energy_added_wh / 1000)
      : null;

  const costValue =
    session.cost_decimal != null
      ? formatCurrency(session.cost_decimal, 2)
      : session.total_energy_added_wh > 0
        ? formatEnergyCost(session.total_energy_added_wh / 1000)
        : '—';

  const chargerLabel = session.charger_type ?? (dc ? 'DC' : 'AC');
  const subtitle = [
    formatDate(session.started_at),
    vehicle?.display_name,
    chargerLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const gauges = [
    {
      key: 'energy',
      color: '#00f0ff',
      glow: 'cyan' as const,
      value: convertEnergyFromSI(session.total_energy_added_wh ?? 0, unitPrefs.energy),
      max: Math.max(convertEnergyFromSI(session.total_energy_added_wh ?? 1, unitPrefs.energy), 80),
      label: t('charging.detail.energyAdded', 'Energy Added'),
      unit: unitPrefs.energy,
    },
    {
      key: 'endSoc',
      color: '#10b981',
      glow: 'green' as const,
      value: session.end_soc_pct ?? 0,
      max: 100,
      label: t('charging.detail.endSoc', 'End SoC'),
      unit: '%',
    },
    {
      key: 'peakPower',
      color: '#a855f7',
      glow: 'purple' as const,
      value: convertPowerFromSI(session.peak_power_w ?? 0, 'kW'),
      max: dc ? 250 : 22,
      label: t('charging.detail.peakPower', 'Peak Power'),
      unit: 'kW',
    },
    {
      key: 'duration',
      color: '#f59e0b',
      glow: 'none' as const,
      value: durationMin,
      max: Math.max(durationMin || 1, 120),
      label: t('charging.detail.duration', 'Duration'),
      unit: 'min',
    },
    {
      key: 'avgPower',
      color: '#06b6d4',
      glow: 'none' as const,
      value: convertPowerFromSI(session.avg_power_w ?? 0, 'kW'),
      max: dc ? 250 : 22,
      label: t('charging.detail.avgPower', 'Avg Power'),
      unit: 'kW',
    },
  ];

  return (
    <PageContainer
      title={`${t('charging.detail.title', 'Charge Session')} #${session.id}`}
      subtitle={subtitle}
      breadcrumbLabels={breadcrumbLabels}
      query={sessionQuery}
      actions={
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <LiveIndicator variant="compact" />
          <PrintButton />
        </div>
      }
    >
      <LiveStaleDataBanner />

      {/* ── Status chip row + back link ─────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('charging.detail.summary', 'Session summary')}
          className="flex flex-wrap items-center gap-2"
        >
          <Link
            to="/charging"
            aria-label={t('charging.detail.back', 'Back to charging')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <Badge variant={dc ? 'warning' : 'info'} dot>
            {dc ? t('charging.detail.dc', 'DC') : t('charging.detail.ac', 'AC')}
          </Badge>
          {chargingState && (
            <Badge variant={chargingStateVariant(chargingState)} size="sm" dot>
              {t(`charging.detail.chargingState.${chargingState}`, chargingState)}
            </Badge>
          )}
          {session.charger_type && (
            <Badge variant="neutral" size="sm">{session.charger_type}</Badge>
          )}
          {session.start_place && (
            <Badge variant="neutral" size="sm">
              <MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {session.start_place}
            </Badge>
          )}
        </section>
      </FadeIn>

      {/*
        The withAiFeature HOC inside AIChargingDiagnosis renders this section
        ONLY when ai_mode='local'|'cloud' AND the charging-diagnosis toggle is
        on (ADR-015 §I5 + §I6). When AI is off the wrapper returns null — the
        surrounding gauges, curve, and downstream sections are unaffected,
        which is the invariant TestChargingDiagnosisAIOffShowsOnlyDeterministic-
        Flags verifies. Placement directly under the status row keeps the
        narrative alongside the same metrics the LLM reads from.
      */}
      <AIChargingDiagnosis sessionId={id} />

      {/* ── 1. KPI band ─────────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('charging.detail.kpis', 'Key metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-8"
        >
          <MetricCard
            label={t('charging.detail.energy', 'Energy')}
            value={`${fmtNumber(convertEnergyFromSI(session.total_energy_added_wh, unitPrefs.energy))} ${unitPrefs.energy}`}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('charging.detail.duration', 'Duration')}
            value={`${fmtNumber(durationMin, 0)} min`}
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('charging.detail.peakPower', 'Peak Power')}
            value={`${fmtNumber(convertPowerFromSI(session.peak_power_w ?? 0, 'kW'))} kW`}
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('charging.detail.socRange', 'SoC Range')}
            value={`${fmtNumber(session.start_soc_pct ?? 0, 0)}–${fmtNumber(session.end_soc_pct ?? 0, 0)}%`}
            icon={<Battery className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={session.cost_decimal != null
              ? t('charging.detail.totalCost', 'Total Cost')
              : t('charging.detail.estCost', 'Est. Cost')}
            value={costValue}
            icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
            color="amber"
            subtitle={session.cost_decimal == null && session.total_energy_added_wh > 0
              ? t('charging.detail.atRate', {
                  currencySymbol,
                  costPerKwh: settingsCostPerKwh,
                  defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh',
                })
              : undefined}
          />
          <MetricCard
            label={t('charging.detail.perKwh', 'Per kWh')}
            value={`${formatCurrency(perKwhRate ?? settingsCostPerKwh, 2)}/kWh`}
            icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
            color="amber"
            subtitle={perKwhRate == null ? t('charging.detail.fromSettings', 'from settings') : undefined}
          />
          <MetricCard
            label={t('charging.detail.milesAdded', 'Miles Added')}
            value={addedDistanceM != null
              ? `${fmtNumber(toDistanceDisplay((addedDistanceM ?? 0) / 1000), 0)} ${distanceUnit}`
              : '—'}
            icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('charging.detail.avgRate', 'kWh/h Avg')}
            value={avgRate != null ? `${fmtNumber(avgRate)} kWh/h` : '—'}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
        </section>
      </FadeIn>

      {/* ── 2. Battery & Power ──────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <section aria-labelledby="charging-battery-power" className="space-y-4">
          <SectionTitle id="charging-battery-power">
            {t('charging.detail.batteryPower', 'Battery & Power')}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Hero: live gauges */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.detail.liveGauges', 'Live Gauges')}
              </PanelTitle>
              <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
                {gauges.map((g) => (
                  <StaggerItem key={g.key}>
                    <div className="flex flex-col items-center rounded-xl border border-white/[0.05] bg-white/[0.02] py-4">
                      <LinearGauge
                        value={g.value}
                        max={g.max}
                        label={g.label}
                        unit={g.unit}
                        color={g.color}
                      />
                    </div>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </GlassPanel>

            {/* Side: battery progress */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4 flex items-center gap-1.5">
                {t('charging.detail.batteryProgress', 'Battery Progress')}
                <HelpTooltip
                  size="sm"
                  i18nKey="help.charging.socRange"
                  defaultValue="The starting and ending state-of-charge percentages for this session. Wider ranges generally mean longer sessions and more taper."
                  ariaLabel={t('help.charging.socRange.aria', { defaultValue: 'More info about state-of-charge range' })}
                />
              </PanelTitle>
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
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <Text as="p" variant="caption">{t('charging.detail.socGained', 'SoC Gained')}</Text>
                  <Text as="p" size="lg" weight="bold" color="primary" className="tabular-nums">
                    <AnimatedNumber value={(session.end_soc_pct ?? 0) - (session.start_soc_pct ?? 0)} />%
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="caption">{t('charging.detail.rangeGained', 'Range Gained')}</Text>
                  <Text as="p" size="lg" weight="bold" color="primary" className="tabular-nums">
                    {addedDistanceM != null
                      ? fmtWithUnit(toDistanceDisplay((addedDistanceM ?? 0) / 1000), distanceUnit, 0)
                      : '—'}
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="caption">{t('charging.detail.energyAdded', 'Energy Added')}</Text>
                  <Text as="p" size="lg" weight="bold" color="primary" className="tabular-nums">
                    {formatEnergy(session.total_energy_added_wh)}
                  </Text>
                </div>
              </div>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* ── 3. Charge Analysis ──────────────────────────────────── */}
      <FadeIn delay={0.15}>
        <section aria-labelledby="charging-analysis" className="space-y-4">
          <SectionTitle id="charging-analysis">
            {t('charging.detail.chargeAnalysis', 'Charge Analysis')}
          </SectionTitle>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Hero: charge curve */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-4 flex flex-wrap items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-purple-300" aria-hidden="true" />
                {t('charging.detail.chargeCurve', 'Charge Curve')}
                {!hasTelemetry && (
                  <Text as="span" variant="caption">
                    ({t('charging.detail.estimated', 'estimated')})
                  </Text>
                )}
                <HelpTooltip
                  size="sm"
                  i18nKey="help.charging.chargeCurve"
                  defaultValue="Power vs SoC curve for the session. Tapering — the gradual drop in power as the battery approaches full — is inherent to lithium chemistry and is not a fault. Sudden drops below the curve indicate derating: the charger or battery is throttling power because of cell or ambient temperature limits."
                  ariaLabel={t('help.charging.chargeCurve.aria', { defaultValue: 'More info about taper and derating' })}
                />
              </PanelTitle>
              {chargeCurve.length > 0 ? (
                <EmbeddedChart
                  title={t('charging.detail.chargeCurve', 'Charge Curve')}
                  ariaLabel={t(
                    'charging.detail.chargeCurveAria',
                    'Charging power by battery state of charge',
                  )}
                  data={chargeCurve}
                  dataColumns={[
                    { key: 'soc', label: t('charging.detail.soc', 'SoC') },
                    { key: 'power', label: t('charging.detail.power', 'Power') },
                  ]}
                  fluid={false}
                  mobileHeight={256}
                  height={320}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chargeCurve} margin={chartMargin}>
                      {areaGradient('powerGrad', '#a855f7')}
                      {chartGrid}
                      <XAxis
                        dataKey="soc"
                        tick={axisTickSm}
                        label={{ value: 'SoC %', position: 'insideBottom', offset: -2, ...axisTickSm }}
                      />
                      <YAxis
                        tick={axisTickSm}
                        label={{ value: 'kW', angle: -90, position: 'insideLeft', ...axisTickSm }}
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
                </EmbeddedChart>
              ) : (
                // no-action: data-quality edge case — telemetry rows exist but lack usable battery_level/power_kw pairs; synthesizeCurve covers the no-telemetry case.
                <EmptyState
                  icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                  message={t(
                    'charging.detail.noCurveData',
                    'A charge curve cannot be plotted because this session has no paired battery-level and power samples.',
                  )}
                  description={closedTelemetryDescription}
                  className="py-8"
                />
              )}
            </GlassPanel>

            {/* Side: charge summary metrics */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4">
                {t('charging.detail.chargeSummary', 'Charge Summary')}
              </PanelTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                <InlineMetric
                  icon={<Gauge className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                  label={t('charging.detail.avgPower', 'Avg Power')}
                  value={session.avg_power_w != null ? fmtWithUnit(convertPowerFromSI(session.avg_power_w, 'kW'), 'kW') : '—'}
                />
                <InlineMetric
                  icon={<MapPin className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
                  label={t('charging.detail.milesAdded', 'Miles Added')}
                  value={
                    addedDistanceM != null
                      ? fmtWithUnit(toDistanceDisplay((addedDistanceM ?? 0) / 1000), distanceUnit, 0)
                      : '—'
                  }
                />
                <InlineMetric
                  icon={<Zap className="h-4 w-4 text-indigo-300" aria-hidden="true" />}
                  label={t('charging.detail.status', 'Status')}
                  value={session.ended_status ?? '—'}
                />
                <InlineMetric
                  icon={<DollarSign className="h-4 w-4 text-amber-300" aria-hidden="true" />}
                  label={t('charging.detail.currency', 'Currency')}
                  value={session.cost_currency ?? '—'}
                />
              </div>
            </GlassPanel>
          </div>

          {/*
            The SoC/energy/range, temperature, and voltage/current panels all
            live on the same charge-session time axis but use different filtered
            telemetry rows. Wrapping them in a `<ChartTimeRangeProvider>` with
            `syncMethod="value"` makes recharts mirror the active hover cursor
            across all three, and each chart renders a persistent
            `<ReferenceLine>` at the last hovered timestamp via
            {@link useSyncedReferenceLineX}.
          */}
          <ChartTimeRangeProvider syncId="charging.session" syncMethod="value">
            <div className="space-y-4">
              {/* SoC / Energy / Range over time — full-width hero band */}
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-4">
                  {t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}
                </PanelTitle>
                {telemetryLoading ? (
                  <ChartBlockSkeleton height={288} />
                ) : telemetryError ? (
                  <QueryError error={telemetryError} onRetry={() => refetchTelemetry()} />
                ) : timeSeriesData.length > 0 ? (
                  <ChargingChartSync>
                    {({ sync, syncedX }) => (
                      <EmbeddedChart
                        title={t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}
                        ariaLabel={t(
                          'charging.detail.socOverTimeAria',
                          'Battery level, energy, and range throughout the charging session',
                        )}
                        data={timeSeriesData}
                        dataColumns={[
                          { key: 'time', label: t('charging.detail.time', 'Time') },
                          { key: 'soc', label: t('charging.detail.soc', 'SoC') },
                          { key: 'energy', label: t('charging.detail.energy', 'Energy') },
                          { key: 'range', label: t('charging.detail.range', 'Range') },
                        ]}
                        chartKey="charging-detail-session-timeline"
                        fluid={false}
                        mobileHeight={288}
                        height={320}
                      >
                        {({ hiddenSeries }) => (
                          <ResponsiveContainer width="100%" height="100%">
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
                            <ChartLegend />
                            <Area
                              {...AREA_DEFAULTS}
                              yAxisId="left"
                              dataKey="soc"
                              stroke="#10b981"
                              fill="url(#socGrad)"
                              name={t('charging.detail.soc', 'SoC')}
                              unit=" %"
                              hide={hiddenSeries?.isHidden('soc')}
                            />
                            <Line
                              {...AREA_DEFAULTS}
                              yAxisId="right"
                              dataKey="energy"
                              stroke="#00f0ff"
                              name={t('charging.detail.energy', 'Energy')}
                              unit=" kWh"
                              hide={hiddenSeries?.isHidden('energy')}
                            />
                            <Line
                              {...AREA_DEFAULTS}
                              yAxisId="right"
                              dataKey="range"
                              stroke="#f59e0b"
                              name={t('charging.detail.range', 'Range')}
                              unit={` ${distanceUnit}`}
                              hide={hiddenSeries?.isHidden('range')}
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
                            {/* Brush lets users zoom a portion of the timeline;
                                recharts propagates the visible window to every
                                other chart sharing this provider's syncId. */}
                            <ChartBrush dataKey="time" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </EmbeddedChart>
                    )}
                  </ChargingChartSync>
                ) : (
                  // no-action: historical telemetry for this closed session either recorded soc/energy/range rows or it never did — nothing to trigger now.
                  <EmptyState
                    icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                    message={t(
                      'charging.detail.noTimelineData',
                      'No battery level, energy, or range samples were recorded for this session.',
                    )}
                    description={closedTelemetryDescription}
                    className="py-8"
                  />
                )}
              </GlassPanel>

              {/* Temperature + Voltage/Current — side-by-side on wide screens */}
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-4 flex items-center gap-2">
                    <Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />
                    {t('charging.detail.temperature', 'Temperature')}
                  </PanelTitle>
                  {telemetryLoading ? (
                    <ChartBlockSkeleton height={240} />
                  ) : telemetryError ? (
                    <QueryError error={telemetryError} onRetry={() => refetchTelemetry()} />
                  ) : tempData.length > 0 ? (
                    <ChargingChartSync>
                      {({ sync, syncedX }) => (
                        <EmbeddedChart
                          title={t('charging.detail.temperature', 'Temperature')}
                          ariaLabel={t(
                            'charging.detail.temperatureAria',
                            'Battery, cabin, and ambient temperature throughout the charging session',
                          )}
                          data={tempData}
                          dataColumns={[
                            { key: 'time', label: t('charging.detail.time', 'Time') },
                            { key: 'battery', label: t('charging.detail.batteryTemp', 'Battery') },
                            { key: 'inside', label: t('charging.detail.insideTemp', 'Inside') },
                            { key: 'outside', label: t('charging.detail.outsideTemp', 'Outside') },
                          ]}
                          chartKey="charging-detail-temperature"
                          fluid={false}
                          mobileHeight={224}
                          height={256}
                        >
                          {({ hiddenSeries }) => (
                            <ResponsiveContainer width="100%" height="100%">
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
                              <ChartLegend />
                              <Line
                                {...AREA_DEFAULTS}
                                dataKey="battery"
                                stroke="#ef4444"
                                name={t('charging.detail.batteryTemp', 'Battery')}
                                unit={` ${tempUnit}`}
                                hide={hiddenSeries?.isHidden('battery')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                dataKey="inside"
                                stroke="#f59e0b"
                                name={t('charging.detail.insideTemp', 'Inside')}
                                unit={` ${tempUnit}`}
                                hide={hiddenSeries?.isHidden('inside')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                dataKey="outside"
                                stroke="#3b82f6"
                                name={t('charging.detail.outsideTemp', 'Outside')}
                                unit={` ${tempUnit}`}
                                hide={hiddenSeries?.isHidden('outside')}
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
                        </EmbeddedChart>
                      )}
                    </ChargingChartSync>
                  ) : (
                    // no-action: this closed session either logged battery/inside/outside temperature telemetry or it never did — nothing to trigger.
                    <EmptyState
                      icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                      message={t(
                        'charging.detail.noTemperatureData',
                        'No battery, cabin, or ambient temperature samples were recorded for this session.',
                      )}
                      description={closedTelemetryDescription}
                      className="py-8"
                    />
                  )}
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-4 flex items-center gap-2">
                    <Waves className="h-4 w-4 text-amber-300" aria-hidden="true" />
                    {t('charging.detail.voltageCurrent', 'Voltage & Current')}
                  </PanelTitle>
                  {telemetryLoading ? (
                    <ChartBlockSkeleton height={240} />
                  ) : telemetryError ? (
                    <QueryError error={telemetryError} onRetry={() => refetchTelemetry()} />
                  ) : voltCurrentData.length > 0 ? (
                    <ChargingChartSync>
                      {({ sync, syncedX }) => (
                        <EmbeddedChart
                          title={t('charging.detail.voltageCurrent', 'Voltage & Current')}
                          ariaLabel={t(
                            'charging.detail.voltageCurrentAria',
                            'Charging voltage and current throughout the session',
                          )}
                          data={voltCurrentData}
                          dataColumns={[
                            { key: 'time', label: t('charging.detail.time', 'Time') },
                            { key: 'voltage', label: t('charging.detail.voltage', 'Voltage') },
                            { key: 'current', label: t('charging.detail.current', 'Current') },
                          ]}
                          chartKey="charging-detail-voltage-current"
                          fluid={false}
                          mobileHeight={224}
                          height={256}
                        >
                          {({ hiddenSeries }) => (
                            <ResponsiveContainer width="100%" height="100%">
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
                              <ChartLegend />
                              <Line
                                {...AREA_DEFAULTS}
                                yAxisId="v"
                                dataKey="voltage"
                                stroke="#f59e0b"
                                name={t('charging.detail.voltage', 'Voltage')}
                                unit=" V"
                                hide={hiddenSeries?.isHidden('voltage')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                yAxisId="a"
                                dataKey="current"
                                stroke="#06b6d4"
                                name={t('charging.detail.current', 'Current')}
                                unit=" A"
                                hide={hiddenSeries?.isHidden('current')}
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
                        </EmbeddedChart>
                      )}
                    </ChargingChartSync>
                  ) : (
                    // no-action: this closed session either logged voltage/current telemetry or it never did — nothing left to trigger for a finished charge.
                    <EmptyState
                      icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                      message={t(
                        'charging.detail.noElectricalData',
                        'No voltage or current samples were recorded for this session.',
                      )}
                      description={closedTelemetryDescription}
                      className="py-8"
                    />
                  )}
                </GlassPanel>
              </div>
            </div>
          </ChartTimeRangeProvider>
        </section>
      </FadeIn>

      {/* ── 4. Session Details ──────────────────────────────────── */}
      <FadeIn delay={0.2}>
        <section aria-labelledby="charging-session-details" className="space-y-4">
          <SectionTitle id="charging-session-details">
            {t('charging.detail.sessionDetails', 'Session Details')}
          </SectionTitle>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Advanced live charging parameters */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-1">
                {t('charging.detail.advanced', 'Advanced Charging Parameters')}
              </PanelTitle>
              <Text as="p" variant="caption" className="mb-4 block">
                {t('charging.detail.advancedHint', 'Latest reported values from the vehicle.')}
              </Text>
              {liveLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                </div>
              ) : liveCharging ? (
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
                          ? formatPower(liveCharging.charger_power_w, { precision: 1 })
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
                          ? formatEnergy(liveCharging.charge_energy_added_wh, { precision: 2 })
                          : '—',
                    },
                    {
                      // Total range added this session — the SI meters field,
                      // converted once at the boundary. NOT range_added_meters_per_hour
                      // (that is the instantaneous rate shown as "Charge Rate" above).
                      label: t('charging.detail.chargeMilesAdded', 'Range Added'),
                      value:
                        liveCharging.range_added_meters != null
                          ? fmtWithUnit(toDistanceDisplay(liveCharging.range_added_meters), distanceUnit, 1)
                          : '—',
                    },
                  ]}
                />
              ) : (
                // no-action: liveCharging reflects the current vehicle telemetry, not this historical session — only populates mid-charge.
                <EmptyState
                  icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                  message={t('charging.detail.noLiveData', 'No live charging telemetry available.')}
                  description={t(
                    'charging.detail.noLiveDataDescription',
                    'Live electrical parameters appear only while the selected vehicle is actively charging.',
                  )}
                  className="py-8"
                />
              )}
            </GlassPanel>

            {/* Session info */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4">
                {t('charging.detail.sessionInfo', 'Session Info')}
              </PanelTitle>
              <KVList
                columns={1}
                items={[
                  {
                    label: t('charging.detail.chargerType', 'Charger Type'),
                    value: chargerLabel,
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
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Location */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                {t('charging.detail.location', 'Location')}
              </PanelTitle>
              {session.start_place ? (
                <Text as="p" variant="body">{session.start_place}</Text>
              ) : (
                // no-action: start_place is geocoded once at session close; this historical session simply never resolved one.
                <EmptyState
                  icon={<MapPin className="h-8 w-8 opacity-20" aria-hidden="true" />}
                  message={t('charging.detail.noLocation', 'No location recorded for this session.')}
                  className="py-8"
                />
              )}
            </GlassPanel>

            {/* Timestamps */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.detail.timestamps', 'Timestamps')}
              </PanelTitle>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Text as="p" variant="caption" className="mb-1 block">{t('charging.detail.started', 'Started')}</Text>
                  <Text as="p" variant="body" weight="medium">
                    <DateTime value={session.started_at} in="vehicle" showTz />
                  </Text>
                </div>
                <div>
                  <Text as="p" variant="caption" className="mb-1 block">{t('charging.detail.ended', 'Ended')}</Text>
                  <Text as="p" variant="body" weight="medium">
                    {session.ended_at ? <DateTime value={session.ended_at} in="vehicle" showTz /> : '—'}
                  </Text>
                </div>
              </div>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
