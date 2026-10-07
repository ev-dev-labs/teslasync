import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Zap, BatteryCharging, Clock, Gauge, DollarSign,
  MapPin, Activity, Thermometer, Waves, TrendingUp, Share2,
} from 'lucide-react';

import type { ChargingSession, ChargeTelemetryReading } from '@/api/types';
import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI, convertDistanceFromSI, convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { formatDate, formatTime } from '@/lib/dateFormat';

import { chartTokens } from '@/lib/tokens';

import { PageLayout, CardGrid, LayoutCard, type CardGridItem } from '@/components/layout';
import {
  GlassPanel, Badge, HelpTooltip, PrintButton, Button,
  SectionTitle, Text,
} from '@/components/ui';
import {
  MetricBar, InlineMetric, AnimatedNumber, KVList,
  DateTime, DataProvenanceBadge,
} from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import {
  Skeleton, EmptyState, QueryError, LiveStaleDataBanner, StaleRefreshWarning,
  PageHeaderSkeleton, ChartBlockSkeleton,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { AIChargingDiagnosis } from '@/components/ai';
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
import { ChargePhysicsPanel } from '../components/ChargePhysicsPanel';
import { ChargeLedgerCompactPanel } from '../components/ChargeLedgerCompactPanel';
import { ChargeBillTruthPanel } from '../components/ChargeBillTruthPanel';
import { ShareSessionDialog } from '../components/ShareSessionDialog';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DetailPlacement, DetailSessionStats, DetailSourceOutline } from '../components/detail-modernization';

/* ─── helpers ──────────────────────────────────────────────────── */

function isDC(session: ChargingSession): boolean {
  const ft = session.charger_type?.toLowerCase() ?? '';
  return ft !== '' && ft !== '<invalid>' && ft !== 'unknown';
}

/**
 * Row cap for the screen-reader fallback `<table>` rendered by each chart
 * frame. A 48-100h home session returns hundreds of thousands of telemetry
 * rows; tabulating every row (4 charts × ~200k `<tr>`) builds hundreds of
 * megabytes of hidden DOM and kills the tab. Above the cap the table is
 * omitted (the documented `no-table` pattern for dense series — the visual
 * chart still draws every sample) and `ariaDescription` carries an honest
 * summary instead. At or under the cap the full table renders as before.
 */
const A11Y_TABLE_ROW_CAP = 2000;

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
 * Named source outlines use the same canonical placement owner while the
 * primary query loads. Shared skeleton primitives retain the header and
 * eight-reading band without guessing values or mounting specialist queries.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-6" data-testid="charging-detail-skeleton">
      <PageHeaderSkeleton />
      <DetailSourceOutline loading />
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
  const { fmtInt, fmtNumber, fmtPercent, fmtWithUnit } = useNumberFormatting();
  const { t } = useTranslation();
  const closedTelemetryDescription = t(
    'charging.detail.closedTelemetryDescription',
    'This closed session cannot recover missing samples; future sessions will populate when telemetry is available.',
  );
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  // Session odometer deltas and live charging distances are canonical meters.
  // Convert once, only at the display boundary.
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
    refetch: refetchSession,
  } = sessionQuery;
  /* Historical record: a failed refresh leaves the session on screen and only
   * downgrades the trust label. `!session` (below) is the sole gate that may
   * replace the page. */
  const sessionDataState = useDataState(sessionQuery, { provenance: 'historical' });
  const telemetryQuery = useChargeTelemetry(session?.id ?? null);
  const telemetryDataState = useDataState(telemetryQuery, { provenance: 'historical' });
  const {
    data: telemetry,
    isLoading: telemetryLoading,
    refetch: refetchTelemetry,
  } = telemetryQuery;
  const telemetryError = telemetryDataState.fatalError;
  const { data: vehicle } = useVehicle(String(session?.vehicle_id ?? ''));
  const liveQuery = useChargingTelemetryLatest(
    session?.vehicle_id ?? 0,
  );
  const { data: liveCharging, isLoading: liveLoading, refetch: refetchLive } = liveQuery;
  const liveDataState = useDataState(liveQuery, { provenance: 'cached', unavailable: liveCharging === null });

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
  const telemetryCount = telemetry?.length ?? 0;
  // Large datasets draw every sample but skip per-frame series animation:
  // interpolating ~200k-point paths at 60fps hangs the tab, while the
  // settled frame is pixel-identical with animation off. Small sessions
  // keep the exact props they always had.
  const isLargeDataset = telemetryCount > A11Y_TABLE_ROW_CAP;
  const seriesPerfProps = isLargeDataset ? { isAnimationActive: false as const } : null;
  const dc = session ? isDC(session) : false;
  const chargingState = liveCharging?.charging_state;

  /* derived chart data */
  const chargeCurve = useMemo(() => {
    if (!session) return [];
    if (hasTelemetry) {
      return telemetry
        .filter((r: ChargeTelemetryReading) => r.battery_level != null && r.power_w != null)
        .map((r: ChargeTelemetryReading) => ({
          soc: r.battery_level!,
          power: convertPowerFromSI(Math.abs(r.power_w!), 'kW'),
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
      power: r.power_w != null ? convertPowerFromSI(Math.abs(r.power_w), 'kW') : null,
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
      <PageLayout
        title={t('charging.detail.title', 'Charge Session')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <LoadingSkeleton />
      </PageLayout>
    );
  }

  if (!session) {
    return (
      <PageLayout
        title={t('charging.detail.title', 'Charge Session')}
        breadcrumbLabels={breadcrumbLabels}
      >
        <GlassPanel className="p-4 sm:p-5">
          <QueryError
            error={sessionDataState.fatalError}
            resourceName={t('charging.detail.resource', 'Charge session')}
            listHref="/charging"
            onRetry={() => refetchSession()}
          />
        </GlassPanel>
        <DetailSourceOutline />
      </PageLayout>
    );
  }

  /* ─── derived scalars (session is now guaranteed) ─── */

  const durationMin = durationMinutes(session.started_at, session.ended_at);
  const addedDistanceM = distanceAddedM(session);
  const billedEnergyWh = session.billed_energy_wh ?? null;
  const vehicleEnergyWh = session.total_energy_added_wh ?? 0;
  const displayEnergyWh = billedEnergyWh != null && billedEnergyWh > 0 ? billedEnergyWh : vehicleEnergyWh;
  const avgRate = durationMin > 0 ? (displayEnergyWh / 1000 / durationMin) * 60 : null;
  const billedCost = session.billed_cost_decimal ?? null;
  const displayCost = billedCost ?? session.cost_decimal ?? null;
  const perKwhRate =
    displayCost != null && displayEnergyWh > 0
      ? displayCost / (displayEnergyWh / 1000)
      : session.billed_rate_per_kwh ?? null;
  const displayPerKwhRate = perKwhRate ?? settingsCostPerKwh;

  const costValue =
    displayCost != null
      ? formatCurrency(displayCost)
      : displayEnergyWh > 0
        ? formatEnergyCost(displayEnergyWh / 1000)
        : '—';

  const chargerLabel = session.charger_type ?? (dc ? 'DC' : 'AC');
  // Spoken summary replacing the omitted fallback table on very long
  // sessions (see A11Y_TABLE_ROW_CAP). All samples remain in the API
  // response and every one is drawn in the chart.
  const fullDataAriaDescription = isLargeDataset
    ? t(
        'charging.detail.fullResolutionTableOmitted',
        'Full-resolution data: {{samples}} samples from {{start}} to {{end}}. The screen-reader data table is omitted for very long sessions; every sample is drawn in the chart.',
        {
          samples: fmtInt(telemetryCount),
          start: formatDate(session.started_at),
          end: session.ended_at ? formatDate(session.ended_at) : t('charging.detail.ongoing', 'now'),
        },
      )
    : undefined;
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
      value: convertEnergyFromSI(displayEnergyWh ?? 0, unitPrefs.energy),
      max: Math.max(convertEnergyFromSI(displayEnergyWh || 1, unitPrefs.energy), 80),
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
    <PageLayout
      title={`${t('charging.detail.title', 'Charge Session')} #${session.id}`}
      metadataActions={<Text variant="bodySm" className="max-w-full [overflow-wrap:anywhere]">{subtitle}</Text>}
      breadcrumbLabels={breadcrumbLabels}
      query={sessionQuery}
      overflowActions={
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
              icon={<Share2 className="h-4 w-4" aria-hidden="true" />}
            >
              {t('charging.detail.share', 'Share')}
            </Button>
          )}
          <PrintButton />
        </div>
      }
    >
      <LiveStaleDataBanner />
      <StaleRefreshWarning
        state={sessionDataState}
        label={t('charging.detail.resource', 'Charge session')}
      />
      <StaleRefreshWarning
        state={telemetryDataState}
        label={t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}
      />
      <ChartTimeRangeProvider syncId="charging.session" syncMethod="value">
      <CardGrid
        label={t('charging.detail.summary', 'Session summary')}
        items={[
          { id: 'summary', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17189">
      {/* ── Status chip row + back link ─────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('charging.detail.summary', 'Session summary')}
          className="flex flex-wrap items-center gap-2"
        >
          <Link
            to="/charging"
            aria-label={t('charging.detail.back', 'Back to charging')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <Badge variant={dc ? 'warning' : 'info'} dot>
            {dc ? t('charging.detail.dc', 'DC') : t('charging.detail.ac', 'AC')}
          </Badge>
          <DataProvenanceBadge
            provenance={sessionDataState.provenance}
            status={sessionDataState.status}
            updatedAt={sessionDataState.updatedAt}
          />
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
      </DetailPlacement>
          ) },
          { id: 'diagnosis', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17198">
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
      </DetailPlacement>
          ) },

          { id: 'metrics', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17200">
      <FadeIn delay={0.05}>
          <DetailSessionStats
            session={session}
            energy={displayEnergyWh}
            duration={durationMin}
            vehicleEnergy={vehicleEnergyWh}
            billedEnergy={billedEnergyWh}
            cost={displayCost}
            billedCost={billedCost}
            costText={costValue}
            configuredRate={settingsCostPerKwh}
            calculatedRate={perKwhRate}
            rateText={displayPerKwhRate != null ? `${formatCurrency(displayPerKwhRate)}/kWh` : '—'}
            currencySymbol={currencySymbol}
            distanceM={addedDistanceM}
            distanceText={addedDistanceM != null
              ? `${fmtNumber(toDistanceDisplay(addedDistanceM))} ${distanceUnit}` : '—'}
            averageRate={avgRate}
            retained={sessionDataState.refreshError != null || sessionDataState.isRefreshBlocked}
          />
      </FadeIn>
      </DetailPlacement>
          ) },
          { id: 'bill-truth', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17218">
      <FadeIn delay={0.06}>
        <ChargeBillTruthPanel session={session} />
      </FadeIn>
      </DetailPlacement>
          ) },
          { id: 'physics', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17220">
      <FadeIn delay={0.07}>
        <ChargePhysicsPanel sessionId={id} />
      </FadeIn>
      </DetailPlacement>
          ) },
          { id: 'ledger', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17221">
      <FadeIn delay={0.07}>
        <ChargeLedgerCompactPanel sessionId={id} />
      </FadeIn>
      </DetailPlacement>
          ) },
          { id: 'battery-heading', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17223">
          <SectionTitle id="charging-battery-power">
            {t('charging.detail.batteryPower', 'Battery & Power')}
          </SectionTitle>
      </DetailPlacement>
          ) },
          { id: 'gauges', size: 'half', content: (
            <LayoutCard title={t('charging.detail.liveGauges', 'Live Gauges')} actions={
                <BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            }>
              <StaggerContainer className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5">
                {gauges.map((g) => (
                  <StaggerItem key={g.key}>
                    <div className="flex flex-col items-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] py-4">
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
            </LayoutCard>
          ) },
          { id: 'battery-progress', size: 'half', content: (
            <LayoutCard title={t('charging.detail.batteryProgress', 'Battery Progress')} actions={
                <HelpTooltip
                  size="sm"
                  i18nKey="help.charging.socRange"
                  defaultValue="The starting and ending state-of-charge percentages for this session. Wider ranges generally mean longer sessions and more taper."
                  ariaLabel={t('help.charging.socRange.aria', { defaultValue: 'More info about state-of-charge range' })}
                />
            }>
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
              <div className="mt-4 grid grid-cols-1 gap-3 text-center @sm:grid-cols-3">
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
                      ? fmtWithUnit(toDistanceDisplay(addedDistanceM), distanceUnit)
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
            </LayoutCard>
          ) },
          { id: 'analysis-heading', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17251">
          <SectionTitle id="charging-analysis">
            {t('charging.detail.chargeAnalysis', 'Charge Analysis')}
          </SectionTitle>
      </DetailPlacement>
          ) },
          { id: 'charge-curve', size: 'full', content: (
            <DetailPlacement sourceId="jsx-17259">
            <section aria-label={t('charging.detail.chargeCurve', 'Charge Curve')} className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Text as="p" variant="body" weight="medium">{t('charging.detail.chargeCurve', 'Charge Curve')}</Text>
                <TrendingUp className="h-4 w-4 text-purple-300" aria-hidden="true" />
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
              </div>
              {chargeCurve.length > 0 ? (
                <EmbeddedChart
                  title={t('charging.detail.chargeCurve', 'Charge Curve')}
                  ariaLabel={t(
                    'charging.detail.chargeCurveAria',
                    'Charging power by battery state of charge',
                  )}
                  ariaDescription={fullDataAriaDescription}
                  // Dense series above the cap omit the SR table (no-table
                  // pattern) — the chart itself still draws every sample.
                  data={isLargeDataset ? undefined : chargeCurve}
                  exportData={chargeCurve}
                  exportable
                  fullscreen
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
                        {...seriesPerfProps}
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
                // no-action: data-quality edge case — telemetry rows exist but lack usable battery_level/power_w pairs; synthesizeCurve covers the no-telemetry case.
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
            </section>
            </DetailPlacement>
          ) },
          { id: 'charge-summary', size: 'full', content: (
            <LayoutCard title={t('charging.detail.chargeSummary', 'Charge Summary')}>
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @3xl:grid-cols-4">
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
                      ? fmtWithUnit(toDistanceDisplay(addedDistanceM), distanceUnit)
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
            </LayoutCard>
          ) },
          { id: 'session-timeline', size: 'full', content: (
              <DetailPlacement sourceId="jsx-17287">
              <section aria-label={t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')} className="min-w-0 space-y-3">
                <Text as="p" variant="body" weight="medium">{t('charging.detail.socOverTime', 'SoC, Energy & Range over Time')}</Text>
                {telemetryLoading && !telemetryDataState.hasData ? (
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
                        ariaDescription={fullDataAriaDescription}
                        // Dense series above the cap omit the SR table (no-table
                        // pattern) — the chart itself still draws every sample.
                        data={isLargeDataset ? undefined : timeSeriesData}
                        exportData={timeSeriesData}
                        exportable
                        fullscreen
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
                              {...seriesPerfProps}
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
                              {...seriesPerfProps}
                              yAxisId="right"
                              dataKey="energy"
                              stroke="#00f0ff"
                              name={t('charging.detail.energy', 'Energy')}
                              unit=" kWh"
                              hide={hiddenSeries?.isHidden('energy')}
                            />
                            <Line
                              {...AREA_DEFAULTS}
                              {...seriesPerfProps}
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
              </section>
              </DetailPlacement>
          ) },
          { id: 'temperature', size: 'half', content: (
                <DetailPlacement sourceId="jsx-17310">
                <section aria-label={t('charging.detail.temperature', 'Temperature')} className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="p" variant="body" weight="medium">{t('charging.detail.temperature', 'Temperature')}</Text>
                    <Thermometer className="h-4 w-4 text-rose-300" aria-hidden="true" />
                  </div>
                  {telemetryLoading && !telemetryDataState.hasData ? (
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
                          ariaDescription={fullDataAriaDescription}
                          // Dense series above the cap omit the SR table (no-table
                          // pattern) — the chart itself still draws every sample.
                          data={isLargeDataset ? undefined : tempData}
                          exportData={tempData}
                          exportable
                          fullscreen
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
                                {...seriesPerfProps}
                                dataKey="battery"
                                stroke="#ef4444"
                                name={t('charging.detail.batteryTemp', 'Battery')}
                                unit={` ${tempUnit}`}
                                hide={hiddenSeries?.isHidden('battery')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                {...seriesPerfProps}
                                dataKey="inside"
                                stroke="#f59e0b"
                                name={t('charging.detail.insideTemp', 'Inside')}
                                unit={` ${tempUnit}`}
                                hide={hiddenSeries?.isHidden('inside')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                {...seriesPerfProps}
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
                </section>
                </DetailPlacement>
          ) },
          { id: 'voltage-current', size: 'half', content: (
                <DetailPlacement sourceId="jsx-17330">
                <section aria-label={t('charging.detail.voltageCurrent', 'Voltage & Current')} className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="p" variant="body" weight="medium">{t('charging.detail.voltageCurrent', 'Voltage & Current')}</Text>
                    <Waves className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  </div>
                  {telemetryLoading && !telemetryDataState.hasData ? (
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
                          ariaDescription={fullDataAriaDescription}
                          // Dense series above the cap omit the SR table (no-table
                          // pattern) — the chart itself still draws every sample.
                          data={isLargeDataset ? undefined : voltCurrentData}
                          exportData={voltCurrentData}
                          exportable
                          fullscreen
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
                                {...seriesPerfProps}
                                yAxisId="v"
                                dataKey="voltage"
                                stroke="#f59e0b"
                                name={t('charging.detail.voltage', 'Voltage')}
                                unit=" V"
                                hide={hiddenSeries?.isHidden('voltage')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                {...seriesPerfProps}
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
                </section>
                </DetailPlacement>
          ) },
          { id: 'details-heading', size: 'full', content: (
      <DetailPlacement sourceId="jsx-17345">
          <SectionTitle id="charging-session-details">
            {t('charging.detail.sessionDetails', 'Session Details')}
          </SectionTitle>
      </DetailPlacement>
          ) },
          { id: 'advanced', size: 'half', content: (
            <LayoutCard title={t('charging.detail.advanced', 'Advanced Charging Parameters')}>
              <Text as="p" variant="caption" className="mb-4 block">
                {t('charging.detail.advancedHint', 'Latest reported values from the vehicle.')}
              </Text>
              {liveCharging != null && (
                <StaleRefreshWarning state={liveDataState} label={t('charging.detail.advanced', 'Advanced Charging Parameters')} />
              )}
              {liveLoading && !liveCharging ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                  <Skeleton className="h-6 rounded" />
                </div>
              ) : liveDataState.fatalError ? (
                <QueryError error={liveDataState.fatalError} onRetry={() => refetchLive()} />
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
                          ? fmtWithUnit(liveCharging.charger_voltage, 'V')
                          : '—',
                    },
                    {
                      label: t('charging.detail.chargerActualCurrent', 'Active Charge Current'),
                      value:
                        liveCharging.charger_actual_current != null
                          ? fmtWithUnit(liveCharging.charger_actual_current, 'A')
                          : '—',
                    },
                    {
                      label: t('charging.detail.chargerPilotCurrent', 'Pilot Current'),
                      value:
                        liveCharging.charger_pilot_current != null
                          ? fmtWithUnit(liveCharging.charger_pilot_current, 'A')
                          : '—',
                    },
                    {
                      label: t('charging.detail.chargerPowerKw', 'Charger Power'),
                      value:
                        liveCharging.charger_power_w != null
                          ? formatPower(liveCharging.charger_power_w)
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
                          ? fmtWithUnit(toDistanceDisplay(liveCharging.battery_range_mi), distanceUnit)
                          : '—',
                    },
                    {
                      label: t('charging.detail.chargeRate', 'Charge Rate'),
                      value:
                        liveCharging.range_added_meters_per_hour != null
                          ? fmtWithUnit(toDistanceDisplay(liveCharging.range_added_meters_per_hour), `${distanceUnit}/h`)
                          : '—',
                    },
                    {
                      label: t('charging.detail.chargeEnergyAdded', 'Energy Added'),
                      value:
                        liveCharging.charge_energy_added_wh != null
                          ? formatEnergy(liveCharging.charge_energy_added_wh)
                          : '—',
                    },
                    {
                      // Total range added this session — the SI meters field,
                      // converted once at the boundary. NOT range_added_meters_per_hour
                      // (that is the instantaneous rate shown as "Charge Rate" above).
                      label: t('charging.detail.chargeMilesAdded', 'Range Added'),
                      value:
                        liveCharging.range_added_meters != null
                          ? fmtWithUnit(toDistanceDisplay(liveCharging.range_added_meters), distanceUnit)
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
            </LayoutCard>
          ) },
          { id: 'session-info', size: 'half', content: (
            <LayoutCard title={t('charging.detail.sessionInfo', 'Session Info')}>
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
            </LayoutCard>
          ) },
          { id: 'location', size: 'half', content: (
            <LayoutCard title={t('charging.detail.location', 'Location')} actions={
                <MapPin className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            }>
              {session.start_place ? (
                <Text as="p" variant="body" className="max-w-prose break-words">{session.start_place}</Text>
              ) : (
                // no-action: start_place is geocoded once at session close; this historical session simply never resolved one.
                <EmptyState
                  icon={<MapPin className="h-8 w-8 opacity-20" aria-hidden="true" />}
                  message={t('charging.detail.noLocation', 'No location recorded for this session.')}
                  className="py-8"
                />
              )}
            </LayoutCard>
          ) },
          { id: 'timestamps', size: 'half', content: (
            <LayoutCard title={t('charging.detail.timestamps', 'Timestamps')} actions={
                <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            }>
              <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
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
            </LayoutCard>
          ) },
        ] satisfies readonly CardGridItem[]}
      />
      </ChartTimeRangeProvider>
      {id && (
        <ShareSessionDialog
          sessionId={id}
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
        />
      )}
    </PageLayout>
  );
}
