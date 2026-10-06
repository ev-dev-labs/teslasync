import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Thermometer,
  Wind,
  Snowflake,
  Sun,
  Power,
  Flame,
  CircleGauge,
  Settings,
  ThermometerSun,
  RefreshCw,
  ShieldCheck,
  BatteryCharging,
  Zap,
  Activity,
  AlertTriangle,
  Monitor,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { PageLayout, LayoutCard } from '@/components/layout';
import { StatGroup, type StatPeriod } from '@/components/data-display';
import { deriveDataState } from '@/api/dataState';
import {
  ClimateRenderGrid,
  ClimateRenderGroup,
  ClimateMetric as MetricCard,
  ClimateMetricGroup,
  ClimateSourceBoundary,
} from '../components/climate-modernization';

import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  useSortToggle,
  Text,
  Caption,
  Label,
  type Column,
} from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import {
  LinearGauge,
  ambientTemperatureGaugeRange,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartLegend,
  ChartTooltip,
  chartMarginLabeled,
  axisTick,
  chartAnimation,
  AREA_DEFAULTS,
  areaGradient,
  EmbeddedChart,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI } from '@/lib/unitConversion';
import { formatDateTime, formatTime } from '@/lib/dateFormat';

import { CHART_COLORS } from '@/lib/colors';

import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { AIPreheatPrecoolRecommender } from '@/components/ai/AIPreheatPrecoolRecommender';
import { useClimate, useClimateHistory } from '@/api/hooks/useVehicleSystems';
import type { ClimateState } from '@/types/vehicle-systems';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ─── Types ─── */

interface HeatLevelStyle {
  color: string;
  bg: string;
  label: string;
  labelKey: string;
}

interface SeatDef {
  key: keyof Pick<
    ClimateState,
    | 'seatHeaterLeft'
    | 'seatHeaterRight'
    | 'seatHeaterRearLeft'
    | 'seatHeaterRearCenter'
    | 'seatHeaterRearRight'
  >;
  label: string;
  labelKey: string;
}

type Translate = (key: string, fallback: string) => string;
type ComfortTone = 'good' | 'warn' | 'bad' | 'neutral';

/* ─── Constants ─── */

const HEAT_LEVELS: HeatLevelStyle[] = [
  { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-2)]', label: 'Off', labelKey: 'common.off' },
  { color: 'text-cyan-400', bg: 'bg-[var(--surface-2)]', label: 'Low', labelKey: 'common.low' },
  { color: 'text-amber-400', bg: 'bg-[var(--surface-2)]', label: 'Medium', labelKey: 'commands.climate.copMedium' },
  { color: 'text-red-400', bg: 'bg-[var(--surface-2)]', label: 'High', labelKey: 'common.high' },
];

const COOL_LEVELS: HeatLevelStyle[] = [
  { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-2)]', label: 'Off', labelKey: 'common.off' },
  { color: 'text-sky-400', bg: 'bg-[var(--surface-2)]', label: 'Low', labelKey: 'common.low' },
  { color: 'text-cyan-300', bg: 'bg-[var(--surface-2)]', label: 'Medium', labelKey: 'commands.climate.copMedium' },
  { color: 'text-blue-400', bg: 'bg-[var(--surface-2)]', label: 'High', labelKey: 'common.high' },
];

const SEATS: SeatDef[] = [
  { key: 'seatHeaterLeft', label: 'Front left', labelKey: 'widget.doorWindow.fl' },
  { key: 'seatHeaterRight', label: 'Front right', labelKey: 'widget.doorWindow.fr' },
  { key: 'seatHeaterRearLeft', label: 'Rear left', labelKey: 'widget.doorWindow.rl' },
  { key: 'seatHeaterRearCenter', label: 'Rear center', labelKey: 'climate.page.rearCenter' },
  { key: 'seatHeaterRearRight', label: 'Rear right', labelKey: 'widget.doorWindow.rr' },
];

// Reused grid rhythms — shared between skeleton + content so the layout never
// jumps between loading and loaded states.
const SYSTEMS_GRID =
  'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 3xl:grid-cols-7';
const PROTECTION_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4';

const TONE_CIRCLE: Record<ComfortTone, string> = {
  good: 'bg-emerald-500/15',
  warn: 'bg-amber-500/15',
  bad: 'bg-rose-500/15',
  neutral: 'bg-[var(--surface-2)]',
};

/* ─── Helpers ─── */

// Clamp an arbitrary heat/cool signal to a valid 0–3 style index. Fleet
// Telemetry occasionally surfaces interpolated (fractional) levels, so we
// round; non-finite values fall back to "Off". Without this the lookup
// could return `undefined` and crash the card reading `.color`/`.label`.
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.round(level), 0), 3);
}

function heatStyle(level: number): HeatLevelStyle {
  return HEAT_LEVELS[clampLevel(level)];
}

function coolStyle(level: number): HeatLevelStyle {
  return COOL_LEVELS[clampLevel(level)];
}

function heatBadgeVariant(level: number): 'neutral' | 'info' | 'warning' | 'danger' {
  if (level <= 0) return 'neutral';
  if (level === 1) return 'info';
  if (level === 2) return 'warning';
  return 'danger';
}

function coolBadgeVariant(level: number): 'neutral' | 'info' {
  return level <= 0 ? 'neutral' : 'info';
}

function keeperVariant(mode: string): 'neutral' | 'info' | 'warning' | 'danger' {
  switch (mode) {
    case 'On':
      return 'info';
    case 'Dog Mode':
      return 'warning';
    case 'Camp Mode':
      return 'info';
    default:
      return 'neutral';
  }
}

function keeperLabel(mode: string, t: TFunction): string {
  switch (mode) {
    case 'On':
      return t('common.on', 'On');
    case 'Dog Mode':
      return t('commands.climate.dogMode', 'Dog mode');
    case 'Camp Mode':
      return t('commands.climate.campMode', 'Camp mode');
    default:
      return t('common.off', 'Off');
  }
}

function comfortBadge(
  inside: number,
  target: number,
): { variant: 'success' | 'warning' | 'danger'; label: string; labelKey: string } {
  const delta = Math.abs(inside - target);
  if (delta <= 1) return { variant: 'success', label: 'Comfortable', labelKey: 'climate.page.comfortable' };
  if (delta <= 3) return { variant: 'warning', label: 'Adjusting', labelKey: 'climate.page.adjusting' };
  return { variant: 'danger', label: 'Far from target', labelKey: 'climate.page.farFromTarget' };
}

function scoreTone(score: number | null): ComfortTone {
  if (score == null) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

function deltaTone(delta: number | null): ComfortTone {
  if (delta == null) return 'neutral';
  const abs = Math.abs(delta);
  if (abs <= 1) return 'good';
  if (abs <= 3) return 'warn';
  return 'bad';
}

function climateAccessor(row: ClimateState, key: string): number | string {
  switch (key) {
    case 'timestamp':
      return row.timestamp ? new Date(row.timestamp).getTime() : 0;
    case 'insideTemp':
      return row.insideTemp ?? 0;
    case 'outsideTemp':
      return row.outsideTemp ?? 0;
    case 'driverTempSetting':
      return row.driverTempSetting ?? 0;
    case 'fanSpeed':
      return row.fanSpeed ?? 0;
    default:
      return 0;
  }
}

/* ─── Presentational sub-components (co-located, page-scoped) ─── */

/** Placeholder cards keep the grid shape while `latest`/`history` loads. */
function CardSkeletons({ count, className }: { count: number; className: string }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={84} className="rounded-xl" />
      ))}
    </div>
  );
}

/** A single temperature gauge cell with its own loading + empty state. */
function GaugeCell({
  loading,
  value,
  min,
  max,
  label,
  unit,
  color,
  icon,
}: {
  loading: boolean;
  value: number | null;
  min: number;
  max: number;
  label: string;
  unit: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <GlassPanel className="flex min-h-[184px] flex-col items-center justify-center gap-2 p-5">
      {loading ? (
        <Skeleton rounded width="120px" height={120} />
      ) : value != null ? (
        <LinearGauge value={value} min={min} max={max} label={label} unit={unit} color={color} />
      ) : (
        <EmptyState /* no-action: transient — source signal missing */ icon={icon} message={label} />
      )}
    </GlassPanel>
  );
}

/** Canonical specialist numeric stats; retain the status glyph and badge. */
function ComfortStat({
  label,
  tone,
  value,
  period,
  children,
  footer,
}: {
  label: string;
  tone: ComfortTone;
  /** Specialist display: a score without /100, or a signed temperature difference. */
  value?: string;
  period?: StatPeriod;
  children?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <GlassPanel className="flex flex-col items-center gap-2 p-4">
      {value !== undefined && period ? (
        <StatGroup className="w-full" period={period} metrics={[{
          metricId: 'text',
          label,
          description: label,
          rawValue: value === '—' ? null : value,
          context: <div data-climate-comfort-tone={tone}>{footer}</div>,
        }]} />
      ) : (
        <>
          <Label className="text-center">{label}</Label>
          <div
            className={cn(
              'flex h-20 w-20 items-center justify-center rounded-full',
              TONE_CIRCLE[tone],
            )}
          >
            {children}
          </div>
          {footer}
        </>
      )}
    </GlassPanel>
  );
}

/** Auto seat-climate on/off chip. */
function AutoClimateChip({
  label,
  labelKey,
  value,
  t,
}: {
  label: string;
  labelKey: string;
  value: boolean | null | undefined;
  t: Translate;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2">
      <Text variant="bodySm">{t(labelKey, label)}</Text>
      {value != null ? (
        <Badge variant={value ? 'success' : 'neutral'} size="sm">
          {value ? t('climate.page.auto', 'Auto') : t('climate.page.manual', 'Manual')}
        </Badge>
      ) : (
        <Caption>—</Caption>
      )}
    </div>
  );
}

/** Seat heater level card. */
function SeatHeaterCard({ label, labelKey, level, t }: {
  label: string; labelKey: string; level: number | null | undefined; t: Translate;
}) {
  const style = heatStyle(level ?? 0);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Flame className={cn('h-6 w-6', style.color)} aria-hidden="true" />
      <Text variant="bodySm" className="text-center font-medium">
        {t(labelKey, label)}
      </Text>
      {level != null ? <Badge variant={heatBadgeVariant(level)} size="sm">
        {t(style.labelKey, style.label)} ({level}/3)
      </Badge> : <Caption>—</Caption>}
    </GlassPanel>
  );
}

/** Seat cooling level card. */
function SeatCoolingCard({
  label,
  labelKey,
  level,
  t,
}: {
  label: string;
  labelKey: string;
  level: number | null | undefined;
  t: Translate;
}) {
  const lvl = level ?? 0;
  const style = coolStyle(lvl);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Snowflake className={cn('h-6 w-6', style.color)} aria-hidden="true" />
      <Text variant="bodySm" className="text-center font-medium">
        {t(labelKey, label)}
      </Text>
      {level != null ? (
        <Badge variant={coolBadgeVariant(lvl)} size="sm">
          {t(style.labelKey, style.label)} ({Math.round(lvl)}/3)
        </Badge>
      ) : (
        <Caption>—</Caption>
      )}
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════
   Climate Control Page
   ═══════════════════════════════════════════════════════ */

export default function ClimateControlPage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('widget.climatePanel.title', 'Climate control'));

  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  // Backend ClimateState temperatures arrive in °C SI. `convertTempFromSI`
  // accepts the °C scalar directly and returns the user-pref display value.
  const toTemperatureDisplay = (celsius: number) => convertTempFromSI(celsius, tempUnit);
  /* Both gauge ends are converted together. A degree scale has a non-zero
   * origin, so converting only the ceiling makes the same temperature sweep a
   * different arc in °F; the floor also sits below freezing so a cold outside
   * reading renders instead of clamping to an empty ring. */
  const tempGaugeRange = ambientTemperatureGaugeRange(toTemperatureDisplay);

  /* ─── Vehicle selector: header VehiclePicker is the source of truth ─── */
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const activeIdNum = Number(activeId) || 0;

  /* ─── Climate data ─── */
  const climateQuery = useClimate(activeId);
  const { data: latest, isLoading, refetch } = climateQuery;
  const latestLoading = isLoading && !latest;
  const latestState = deriveDataState(climateQuery);

  const historyQuery = useClimateHistory(activeId);
  const { data: history } = historyQuery;
  const historyLoading = historyQuery.isLoading && !history;
  const historyState = deriveDataState(historyQuery, { provenance: 'historical' });
  const latestLabel = t('dataSources.labels.latestClimateState', 'Latest climate state');
  const historyLabel = t('dataSources.labels.climateHistory', 'Climate history');
  const latestPeriod = {
    kind: 'snapshot' as const,
    label: latestLabel,
    observedAt: latest?.timestamp ?? latest?.created_at ?? null,
    provenance: latest?.timestamp ? formatDateTime(latest.timestamp) : latestLabel,
  };
  const dataSources = useMemo(
    () => [
      {
        id: 'latest-climate-state',
        label: t('dataSources.labels.latestClimateState', 'Latest climate state'),
        query: climateQuery,
        enabled: activeId !== '',
      },
      {
        id: 'climate-history',
        label: t('dataSources.labels.climateHistory', 'Climate history'),
        query: historyQuery,
        enabled: activeId !== '',
      },
    ],
    [activeId, climateQuery, historyQuery, t],
  );

  /* ─── Charging telemetry (for NotEnoughPowerToHeat alert) ─── */
  const chargingQuery = useChargingTelemetryLatest(activeIdNum);
  const { data: chargingLatest } = chargingQuery;
  const chargingState = deriveDataState(chargingQuery);

  /* ─── AI preheat/precool default departure (8 hours from now, RFC3339) ─── */
  // Stable for the component instance so the AI panel's stream body identity
  // stays referentially stable.
  const defaultDepartBy = useMemo(
    () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    [],
  );

  /* ─── Comfort indicator ─── */
  const comfort = useMemo(
    () => comfortBadge(latest?.insideTemp ?? 0, latest?.driverTempSetting ?? 0),
    [latest?.insideTemp, latest?.driverTempSetting],
  );

  /* ─── Table sort ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('timestamp', 'desc');

  const sortedHistory = useMemo(() => {
    if (!history) return [];
    return sortFn(history, climateAccessor);
  }, [history, sortFn]);

  /* ─── Table columns ─── */
  const columns = useMemo<Column<ClimateState>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('widget.climateHistory.time', 'Time'),
        sortable: true,
        render: (row) => (
          <Text as="span" variant="body" className="whitespace-nowrap">
            {row.timestamp ? formatDateTime(row.timestamp) : '—'}
          </Text>
        ),
      },
      {
        key: 'insideTemp',
        align: 'right',
        filterValue: (row) => row.insideTemp ?? null,
        filterValueLabel: (_value, row) => row.insideTemp == null ? '—' : `${fmtNumber(toTemperatureDisplay(row.insideTemp))} ${tempUnit}`,
        header: `${t('common.inside', 'Inside')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.insideTemp != null ? fmtNumber(toTemperatureDisplay(row.insideTemp)) : '—',
      },
      {
        key: 'outsideTemp',
        align: 'right',
        filterValue: (row) => row.outsideTemp ?? null,
        filterValueLabel: (_value, row) => row.outsideTemp == null ? '—' : `${fmtNumber(toTemperatureDisplay(row.outsideTemp))} ${tempUnit}`,
        header: `${t('common.outside', 'Outside')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.outsideTemp != null ? fmtNumber(toTemperatureDisplay(row.outsideTemp)) : '—',
      },
      {
        key: 'driverTempSetting',
        align: 'right',
        filterValue: (row) => row.driverTempSetting ?? null,
        filterValueLabel: (_value, row) => row.driverTempSetting == null ? '—' : `${fmtNumber(toTemperatureDisplay(row.driverTempSetting))} ${tempUnit}`,
        header: `${t('climate.page.setTemp', 'Set temp')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.driverTempSetting != null
            ? fmtNumber(toTemperatureDisplay(row.driverTempSetting))
            : '—',
      },
      {
        key: 'fanSpeed',
        align: 'right',
        filterValue: (row) => row.fanSpeed ?? null,
        header: t('telemetry.fan', 'Fan'),
        sortable: true,
        render: (row) => (row.fanSpeed != null ? String(row.fanSpeed) : '—'),
      },
      {
        key: 'isAcOn',
        filterValue: (row) => row.isAcOn ?? null,
        filterValueLabel: (_value, row) => row.isAcOn == null ? '—' : row.isAcOn ? t('common.on', 'On') : t('common.off', 'Off'),
        header: t('widget.hvac', 'HVAC'),
        render: (row) => (
          <Badge variant={row.isAcOn ? 'success' : 'neutral'} size="sm">
            {row.isAcOn == null ? '—' : row.isAcOn ? t('common.on', 'On') : t('common.off', 'Off')}
          </Badge>
        ),
      },
      {
        key: 'climateKeeperMode',
        filterValue: (row) => row.climateKeeperMode ?? null,
        filterValueLabel: (_value, row) => row.climateKeeperMode == null ? '—' : keeperLabel(row.climateKeeperMode, t),
        header: t('commands.climate.climateKeeper', 'Climate keeper'),
        render: (row) => (
          <Badge variant={keeperVariant(row.climateKeeperMode ?? '')} size="sm">
            {row.climateKeeperMode == null ? '—' : keeperLabel(row.climateKeeperMode, t)}
          </Badge>
        ),
      },
    ],
    // tempUnit + toTemperatureDisplay are captured by the render closures; the
    // component re-renders (and rebuilds columns) whenever the unit changes.
    [t, tempUnit, fmtNumber],
  );

  /* ─── Chronological history (backend returns newest-first) ─── */
  const chronoHistory = useMemo(() => {
    if (!history || history.length === 0) return [];
    return [...history].sort(
      (a, b) =>
        new Date(a.timestamp ?? a.created_at ?? '').getTime() -
        new Date(b.timestamp ?? b.created_at ?? '').getTime(),
    );
  }, [history]);

  const convertedChartData = useMemo(
    () =>
      chronoHistory.map((h) => ({
        ...h,
        insideTemp: h.insideTemp != null ? toTemperatureDisplay(h.insideTemp) : null,
        outsideTemp: h.outsideTemp != null ? toTemperatureDisplay(h.outsideTemp) : null,
        driverTempSetting:
          h.driverTempSetting != null ? toTemperatureDisplay(h.driverTempSetting) : null,
        acActive: h.isAcOn ? 1 : 0,
      })),
    // Track the primitive `tempUnit` so non-temperature setting churn doesn't
    // invalidate the memo.
    [chronoHistory, tempUnit],
  );

  /* ─── Comfort score & temp delta ─── */
  const comfortScore = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) return null;
    const delta = Math.abs(latest.insideTemp - latest.driverTempSetting);
    return Math.max(0, 100 - delta * 10);
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  // Keep the source Celsius difference and all thresholds unchanged. At the
  // render boundary subtract the converted zero so °F deltas have no offset.
  const tempDelta = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) return null;
    return latest.insideTemp - latest.driverTempSetting;
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  /* ─── Climate efficiency stats ─── */
  // HvacPower is an enum signal (not kW), so numeric power stats are
  // unavailable. Fan-speed stats derive from the HvacFanSpeed float signal.
  const efficiencyStats = useMemo(() => {
    if (chronoHistory.length === 0) return null;
    const withFan = chronoHistory.filter((h) => h.fanSpeed != null && h.fanSpeed > 0);
    if (withFan.length === 0) return null;
    const speeds = withFan.map((h) => h.fanSpeed ?? 0);
    const avgFan = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    const peakFan = Math.max(...speeds);
    const acOnCount = chronoHistory.filter((h) => h.isAcOn).length;
    const acOnPct = (acOnCount / chronoHistory.length) * 100;
    return { avgFan, peakFan, acOnPct };
  }, [chronoHistory]);

  const hasTempHistory = convertedChartData.length > 0;

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <PageLayout
      title={t('widget.climatePanel.title', 'Climate control')}
      subtitle={t('climate.page.subtitle', 'HVAC status, temperatures, and seat heaters')}
      query={[climateQuery, historyQuery, chargingQuery]}
      dataSources={dataSources}
      secondaryActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void refetch()}
          >
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      }
    >
      <ClimateRenderGrid label={t('climate.page.overview', 'Climate overview')}>
      {/* ─── AI: Preheat / Precool recommender ─── */}
      {/* Hidden entirely when ai_mode='off' or the per-feature toggle is off via */}
      {/* the withAiFeature HOC; renders an opt-in propose-only section above the */}
      {/* deterministic HVAC banner when enabled. */}
      <ClimateRenderGroup id="climate-ai">
        <AIPreheatPrecoolRecommender
          vehicleId={activeIdNum > 0 ? activeIdNum : undefined}
          currentCabinTempC={latest?.insideTemp ?? null}
          outsideTempC={latest?.outsideTemp ?? null}
          targetCabinTempC={latest?.driverTempSetting ?? 21}
          departBy={defaultDepartBy}
        />
      </ClimateRenderGroup>

      {/* ─── Band A — HVAC status banner (full-width strip) ─── */}
      <ClimateRenderGroup id="climate-status">
        <LayoutCard title={t('climate.page.hvacSystem', 'HVAC system')}>
          <ClimateSourceBoundary state={latestState} label={latestLabel}>
          {latestLoading ? <Skeleton height={44} /> : (
          <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Power
              className={cn('h-6 w-6', latest?.isAcOn ? 'text-cyan-400' : 'text-[var(--text-muted)]')}
              aria-hidden="true"
            />
            <Text variant="body" className="font-medium">
              {t('climate.page.hvacSystem', 'HVAC system')}
            </Text>
            <Badge variant={latest?.isAcOn ? 'success' : 'neutral'}>
              {latest?.isAcOn == null ? '—' : latest.isAcOn ? t('common.active', 'Active') : t('common.off', 'Off')}
            </Badge>
            <Badge variant={comfortScore == null ? 'neutral' : comfort.variant} size="sm">
              {comfortScore == null ? '—' : t(comfort.labelKey, comfort.label)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {latest?.climateKeeperMode && latest.climateKeeperMode !== 'Off' && (
              <Badge variant={keeperVariant(latest.climateKeeperMode)} dot>
                {keeperLabel(latest.climateKeeperMode, t)}
              </Badge>
            )}
            {latest?.defrostMode && latest.defrostMode !== 'Off' && (
              <Badge variant="info" dot>
                <Snowflake className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('widget.climatePanel.defrost', 'Defrost')}
                {latest.defrostMode !== 'Normal' ? ` (${latest.defrostMode})` : ''}
              </Badge>
            )}
            {latest?.batteryHeater && (
              <Badge variant="warning" dot>
                <BatteryCharging className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('climate.page.batteryHeater', 'Battery heater')}
              </Badge>
            )}
          </div>
          </div>
          )}
          </ClimateSourceBoundary>
          <ClimateSourceBoundary state={chargingState}
            label={t('climate.page.insufficientPowerToHeat', 'Insufficient power to heat')}>
            {chargingQuery.isLoading && !chargingLatest ? <Skeleton height={24} /> :
            chargingLatest?.not_enough_power_to_heat ? (
              <Badge variant="danger" dot>
                <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('climate.page.insufficientPowerToHeat', 'Insufficient power to heat')}
              </Badge>
            ) : chargingLatest?.not_enough_power_to_heat == null ? <Caption>
              {t('climate.page.insufficientPowerToHeat', 'Insufficient power to heat')}: —
            </Caption> : null}
          </ClimateSourceBoundary>
        </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band B — Hero: temperature gauges + thermal comfort ─── */}
      <ClimateRenderGroup id="climate-temperature" size="half" delay={0.05}
        label={t('climate.page.overview', 'Climate overview')}>
          {/* Temperature gauges (hero, spans 2 cols on wide screens) */}
          <LayoutCard title={t('climate.page.temperature', 'Temperature')}>
            <ClimateSourceBoundary state={latestState} label={latestLabel}>
            <div className="grid grid-cols-1 gap-4 @lg:grid-cols-3">
              <GaugeCell
                loading={latestLoading}
                value={latest?.insideTemp != null ? toTemperatureDisplay(latest.insideTemp) : null}
                {...tempGaugeRange}
                label={t('climate.page.insideTemp', 'Inside temp')}
                unit={tempUnit}
                color={CHART_COLORS[0]}
                icon={<Thermometer className="h-6 w-6" aria-hidden="true" />}
              />
              <GaugeCell
                loading={latestLoading}
                value={
                  latest?.outsideTemp != null ? toTemperatureDisplay(latest.outsideTemp) : null
                }
                {...tempGaugeRange}
                label={t('climate.page.outsideTemp', 'Outside temp')}
                unit={tempUnit}
                color={CHART_COLORS[1]}
                icon={<Thermometer className="h-6 w-6" aria-hidden="true" />}
              />
              <GaugeCell
                loading={latestLoading}
                value={
                  latest?.driverTempSetting != null
                    ? toTemperatureDisplay(latest.driverTempSetting)
                    : null
                }
                {...tempGaugeRange}
                label={t('climate.page.driverSetTemp', 'Driver set temp')}
                unit={tempUnit}
                color={CHART_COLORS[2]}
                icon={<ThermometerSun className="h-6 w-6" aria-hidden="true" />}
              />
            </div>
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>
      <ClimateRenderGroup id="climate-comfort" size="half" delay={0.05}>
          {/* Thermal comfort (context column) */}
          <LayoutCard title={t('climate.page.thermalComfort', 'Thermal comfort')}>
            <ClimateSourceBoundary state={latestState} label={latestLabel}>
            {latestLoading ? (
              <div className="grid grid-cols-3 gap-3">
                <Skeleton height={132} className="rounded-xl" />
                <Skeleton height={132} className="rounded-xl" />
                <Skeleton height={132} className="rounded-xl" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <ComfortStat
                  label={t('climate.page.comfortScore', 'Comfort score')}
                  tone={scoreTone(comfortScore)}
                  value={comfortScore != null ? fmtNumber(comfortScore) : '—'}
                  period={latestPeriod}
                  footer={
                    <Badge
                      variant={
                        comfortScore == null ? 'neutral' : comfortScore >= 80
                          ? 'success'
                          : comfortScore != null && comfortScore >= 50
                            ? 'warning'
                            : 'danger'
                      }
                      size="sm"
                    >
                      {comfortScore == null ? t('climate.page.notAvailable', 'N/A') : comfortScore >= 80
                        ? t('climate.page.comfortExcellent', 'Excellent')
                        : comfortScore != null && comfortScore >= 50
                          ? t('climate.page.comfortModerate', 'Moderate')
                          : t('climate.page.comfortPoor', 'Poor')}
                    </Badge>
                  }
                />

                <ComfortStat
                  label={t('climate.page.tempDelta', 'Temp delta')}
                  tone={deltaTone(tempDelta)}
                  value={tempDelta != null
                    ? `${tempDelta > 0 ? '+' : ''}${fmtNumber(toTemperatureDisplay(tempDelta) - toTemperatureDisplay(0))}${tempUnit}`
                    : '—'}
                  period={latestPeriod}
                  footer={
                    <Caption className="rounded-full bg-[var(--surface-2)] px-3 py-1 font-medium">
                      {tempDelta != null
                        ? Math.abs(tempDelta) <= 1
                          ? t('climate.page.nearTarget', 'Near target')
                          : tempDelta > 0
                            ? t('climate.page.aboveTarget', 'Above target')
                            : t('climate.page.belowTarget', 'Below target')
                        : t('climate.page.notAvailable', 'N/A')}
                    </Caption>
                  }
                />

                <ComfortStat
                  label={t('common.status', 'Status')}
                  tone={scoreTone(comfortScore)}
                  footer={
                    <Badge variant={tempDelta == null ? 'neutral' : comfort.variant} size="sm">
                      {tempDelta == null ? t('climate.page.notAvailable', 'N/A') : tempDelta > 2
                        ? t('climate.page.tooWarm', 'Too warm')
                        : tempDelta != null && tempDelta < -2
                          ? t('climate.page.tooCold', 'Too cold')
                          : t('climate.page.comfortable', 'Comfortable')}
                    </Badge>
                  }
                >
                  {tempDelta == null ? <Caption>—</Caption> : tempDelta > 2 ? (
                    <Sun className="h-8 w-8 text-amber-400" aria-hidden="true" />
                  ) : tempDelta != null && tempDelta < -2 ? (
                    <Snowflake className="h-8 w-8 text-cyan-400" aria-hidden="true" />
                  ) : (
                    <Wind className="h-8 w-8 text-emerald-400" aria-hidden="true" />
                  )}
                </ComfortStat>
              </div>
            )}
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band C — Climate systems metric grid ─── */}
      <ClimateRenderGroup id="climate-systems" delay={0.1}>
        <LayoutCard title={t('climate.page.climateSystems', 'Climate systems')}>
          <ClimateSourceBoundary state={latestState} label={latestLabel}>
          {latestLoading ? (
            <CardSkeletons count={13} className={SYSTEMS_GRID} />
          ) : (
            <ClimateMetricGroup id="climate-systems-stats" period={latestPeriod}>
              <MetricCard
                label={t('telemetry.hvac', 'HVAC power')}
                value={latest?.isAcOn == null ? '—' : latest.isAcOn ? t('common.on', 'On') : t('common.off', 'Off')}
                color={latest?.isAcOn ? 'cyan' : 'blue'}
                icon={
                  <Power
                    className={cn(
                      'h-5 w-5',
                      latest?.isAcOn ? 'text-cyan-400' : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={latest?.hvacPower != null
                  ? `${t('common.state', 'State')}: ${latest.hvacPower ? t('common.on', 'On') : t('common.off', 'Off')}`
                  : undefined}
              />

              <MetricCard
                label={t('climate.page.autoConditioning', 'Auto conditioning')}
                value={
                  latest?.hvacAutoMode == null ? '—' : latest.hvacAutoMode !== 'Off' ? t('common.on', 'On') : t('common.off', 'Off')
                }
                color="blue"
                icon={<Settings className="h-5 w-5 text-blue-400" />}
              />

              <MetricCard
                label={t('commands.climate.climateKeeper', 'Climate keeper')}
                value={latest?.climateKeeperMode == null ? '—' : keeperLabel(latest.climateKeeperMode, t)}
                color="amber"
                icon={<ThermometerSun className="h-5 w-5 text-amber-400" />}
                subtitle={
                  latest?.climateKeeperMode && latest.climateKeeperMode !== 'Off'
                    ? t('common.active', 'Active')
                    : undefined
                }
              />

              <MetricCard
                label={t('widget.climatePanel.fanSpeed', 'Fan speed')}
                value={latest?.fanSpeed != null ? String(latest.fanSpeed) : '—'}
                color="cyan"
                icon={<Wind className="h-5 w-5 text-teal-400" />}
                subtitle={`${t('common.level', 'Level')} 0–10`}
              />

              <MetricCard
                label={t('climate.page.fanStatus', 'Fan status')}
                value={
                  latest?.hvacFanStatus != null
                    ? latest.hvacFanStatus > 0
                      ? t('climate.page.running', 'Running')
                      : t('climate.page.idle', 'Idle')
                    : '—'
                }
                color="cyan"
                icon={
                  <Wind
                    className={cn(
                      'h-5 w-5',
                      latest?.hvacFanStatus != null && latest.hvacFanStatus > 0
                        ? 'text-teal-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={
                  latest?.hvacFanStatus != null ? `${t('climate.page.code', 'Code')} ${latest.hvacFanStatus}` : undefined
                }
              />

              <MetricCard
                label={t('climate.page.steeringWheelHeater', 'Steering wheel heater')}
                value={
                  latest?.hvacSteeringWheelHeatLevel == null ? '—' :
                  latest.hvacSteeringWheelHeatLevel > 0
                    ? t('common.on', 'On')
                    : t('common.off', 'Off')
                }
                color="amber"
                icon={
                  <CircleGauge
                    className={cn(
                      'h-5 w-5',
                      latest?.hvacSteeringWheelHeatLevel != null &&
                        latest.hvacSteeringWheelHeatLevel > 0
                        ? 'text-amber-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
              />

              <MetricCard
                label={t('climate.page.steeringWheelHeatLevel', 'Steering wheel heat level')}
                value={
                  latest?.hvacSteeringWheelHeatLevel == null
                    ? '—'
                    : t(heatStyle(latest.hvacSteeringWheelHeatLevel).labelKey, heatStyle(latest.hvacSteeringWheelHeatLevel).label)
                }
                color="amber"
                icon={
                  <Flame
                    className={cn(
                      'h-5 w-5',
                      latest?.hvacSteeringWheelHeatLevel != null
                        ? heatStyle(latest.hvacSteeringWheelHeatLevel).color
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={
                  latest?.hvacSteeringWheelHeatLevel != null
                    ? `${t('common.level', 'Level')} ${fmtInt(latest.hvacSteeringWheelHeatLevel)}`
                    : undefined
                }
              />

              <MetricCard
                label={t('climate.page.steeringWheelHeatAuto', 'Steering wheel heat auto')}
                value={
                  latest?.hvacSteeringWheelHeatAuto == null
                    ? '—'
                    : latest.hvacSteeringWheelHeatAuto
                      ? t('climate.page.auto', 'Auto')
                      : t('climate.page.manual', 'Manual')
                }
                color="amber"
                icon={
                  <Activity
                    className={cn(
                      'h-5 w-5',
                      latest?.hvacSteeringWheelHeatAuto
                        ? 'text-amber-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
              />

              <MetricCard
                label={t('climate.page.defrostMode', 'Defrost mode')}
                value={
                  latest?.defrostMode == null ? '—' : latest.defrostMode !== 'Off' ? latest.defrostMode : t('common.off', 'Off')
                }
                color="blue"
                icon={
                  <Snowflake
                    className={cn(
                      'h-5 w-5',
                      latest?.defrostMode && latest.defrostMode !== 'Off'
                        ? 'text-blue-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
              />

              <MetricCard
                label={t('climate.page.defrostForPreconditioning', 'Defrost for preconditioning')}
                value={
                  latest?.defrostForPreconditioning == null
                    ? '—'
                    : latest.defrostForPreconditioning
                      ? t('common.active', 'Active')
                      : t('common.inactive', 'Inactive')
                }
                color="cyan"
                icon={
                  <Snowflake
                    className={cn(
                      'h-5 w-5',
                      latest?.defrostForPreconditioning
                        ? 'text-cyan-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={
                  latest?.defrostForPreconditioning
                    ? t('climate.page.clearingWindshield', 'Clearing windshield before drive')
                    : undefined
                }
              />

              <MetricCard
                label={t('climate.page.rearDefrost', 'Rear defrost')}
                value={
                  latest?.rearDefrostEnabled == null
                    ? '—'
                    : latest.rearDefrostEnabled
                      ? t('common.on', 'On')
                      : t('common.off', 'Off')
                }
                color="blue"
                icon={
                  <Snowflake
                    className={cn(
                      'h-5 w-5',
                      latest?.rearDefrostEnabled ? 'text-blue-400' : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={latest?.rearDefrostEnabled ? t('climate.page.clearingRearWindow', 'Clearing rear window') : undefined}
              />

              <MetricCard
                label={t('climate.page.wiperHeater', 'Wiper heater')}
                value={
                  latest?.wiperHeatEnabled == null
                    ? '—'
                    : latest.wiperHeatEnabled
                      ? t('common.on', 'On')
                      : t('common.off', 'Off')
                }
                color="amber"
                icon={
                  <Flame
                    className={cn(
                      'h-5 w-5',
                      latest?.wiperHeatEnabled ? 'text-orange-400' : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={
                  latest?.wiperHeatEnabled
                    ? t('climate.page.heatingWipers', 'Heating windshield wipers')
                    : undefined
                }
              />

              <MetricCard
                label={t('climate.page.rearDisplayHvac', 'Rear display HVAC')}
                value={
                  latest?.rearDisplayHvacEnabled == null
                    ? '—'
                    : latest.rearDisplayHvacEnabled
                      ? t('common.enabled', 'Enabled')
                      : t('common.disabled', 'Disabled')
                }
                color="cyan"
                icon={
                  <Monitor
                    className={cn(
                      'h-5 w-5',
                      latest?.rearDisplayHvacEnabled
                        ? 'text-cyan-400'
                        : 'text-[var(--text-muted)]',
                    )}
                  />
                }
                subtitle={
                  latest?.rearDisplayHvacEnabled
                    ? t('climate.page.rearPassengersControl', 'Rear passengers can control HVAC')
                    : undefined
                }
              />
            </ClimateMetricGroup>
          )}
          </ClimateSourceBoundary>
        </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band D — Protection & safety ─── */}
      <ClimateRenderGroup id="climate-protection" delay={0.15}>
        <LayoutCard title={t('climate.page.protectionSafety', 'Protection & safety')}>
          <ClimateSourceBoundary state={latestState} label={latestLabel}>
          {latestLoading ? (
            <CardSkeletons count={4} className={PROTECTION_GRID} />
          ) : (
            <ClimateMetricGroup id="climate-protection-stats" period={latestPeriod}>
              <MetricCard
                label={t('climate.page.overheatProtection', 'Overheat protection')}
                value={latest?.overheatProtection ?? t('common.unknown', 'Unknown')}
                color="green"
                icon={<ShieldCheck className="h-5 w-5 text-green-400" />}
              />
              <MetricCard
                label={t('climate.page.overheatTempLimit', 'Overheat temp limit')}
                value={latest?.cabinOverheatProtectionTempLimit ?? '—'}
                color="amber"
                icon={<ThermometerSun className="h-5 w-5 text-orange-400" />}
              />
              <MetricCard
                label={t('climate.page.batteryHeater', 'Battery heater')}
                value={latest?.batteryHeater == null ? '—' : latest.batteryHeater ? t('common.on', 'On') : t('common.off', 'Off')}
                color="amber"
                icon={
                  <BatteryCharging
                    className={cn(
                      'h-5 w-5',
                      latest?.batteryHeater ? 'text-amber-400' : 'text-[var(--text-muted)]',
                    )}
                  />
                }
              />
              <MetricCard
                label={t('climate.page.passengerSetting', 'Passenger setting')}
                value={
                  latest?.passengerTempSetting != null
                    ? `${fmtNumber(toTemperatureDisplay(latest.passengerTempSetting))}${tempUnit}`
                    : '—'
                }
                color="purple"
                icon={<Thermometer className="h-5 w-5 text-purple-400" />}
              />
            </ClimateMetricGroup>
          )}
          </ClimateSourceBoundary>
        </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band E — Seat heaters (span 2) + climate efficiency ─── */}
      <ClimateRenderGroup id="climate-seats" size="half" delay={0.2}
        label={t('climate.page.comfortEfficiency', 'Comfort & efficiency')}>
          {/* Seat heaters + cooling */}
          <LayoutCard title={t('climate.page.seatHeaters', 'Seat heaters')}>

            <ClimateSourceBoundary state={latestState} label={latestLabel}>
            {latestLoading ? (
              <CardSkeletons
                count={5}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
              />
            ) : (
              <div className="space-y-4">
                {/* Heated seats — all five positions */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {SEATS.map((seat) => (
                    <SeatHeaterCard
                      key={seat.key}
                      label={seat.label}
                      labelKey={seat.labelKey}
                      level={latest?.[seat.key]}
                      t={t}
                    />
                  ))}
                </div>

                {/* Auto seat climate */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <AutoClimateChip
                    label="Auto climate (left)"
                    labelKey="climate.page.autoClimateLeft"
                    value={latest?.autoSeatClimateLeft}
                    t={t}
                  />
                  <AutoClimateChip
                    label="Auto climate (right)"
                    labelKey="climate.page.autoClimateRight"
                    value={latest?.autoSeatClimateRight}
                    t={t}
                  />
                </div>

                {/* Seat cooling */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Snowflake className="h-4 w-4 text-sky-400" aria-hidden="true" />
                      <Text variant="body" className="font-semibold">
                        {t('climate.page.seatCooling', 'Seat cooling')}
                      </Text>
                    </div>
                    <Badge
                      variant={latest?.seatVentEnabled ? 'success' : 'neutral'}
                      size="sm"
                    >
                      {t('climate.page.ventilation', 'Ventilation')}:{' '}
                      {latest?.seatVentEnabled == null
                        ? '—'
                        : latest.seatVentEnabled
                          ? t('common.on', 'On')
                          : t('common.off', 'Off')}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <SeatCoolingCard
                      label="Front left"
                      labelKey="widget.doorWindow.fl"
                      level={latest?.climateSeatCoolingFrontLeft}
                      t={t}
                    />
                    <SeatCoolingCard
                      label="Front right"
                      labelKey="widget.doorWindow.fr"
                      level={latest?.climateSeatCoolingFrontRight}
                      t={t}
                    />
                  </div>
                </div>

                {/* Level legend */}
                <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border-default)] pt-3">
                  {HEAT_LEVELS.map((lvl, idx) => (
                    <div key={lvl.label} className="flex items-center gap-1.5">
                      <Flame className={cn('h-3.5 w-3.5', lvl.color)} aria-hidden="true" />
                      <Caption>
                        {idx} — {t(lvl.labelKey, lvl.label)}
                      </Caption>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>
      <ClimateRenderGroup id="climate-efficiency" size="half" delay={0.2}>
          {/* Climate efficiency */}
          <LayoutCard title={t('climate.page.climateEfficiency', 'Climate efficiency')}>
            <ClimateSourceBoundary state={historyState} label={historyLabel}>
            {historyLoading ? (
              <CardSkeletons count={4} className="grid grid-cols-2 gap-3 sm:gap-4" />
            ) : (
              <ClimateMetricGroup id="climate-efficiency-stats" period={{
                kind: 'unknown',
                label: historyLabel,
              }}>
                <MetricCard
                  label={t('climate.page.avgFanSpeed', 'Avg fan speed')}
                  value={efficiencyStats ? fmtNumber(efficiencyStats.avgFan) : '—'}
                  subtitle={t('climate.page.levelRange', 'Level 0–10')}
                  icon={<Wind className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('climate.page.peakFanSpeed', 'Peak fan speed')}
                  value={efficiencyStats ? fmtNumber(efficiencyStats.peakFan) : '—'}
                  subtitle={t('climate.page.levelRange', 'Level 0–10')}
                  icon={<Wind className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('climate.page.acOnTime', 'AC on time')}
                  value={efficiencyStats ? `${fmtNumber(efficiencyStats.acOnPct)}%` : '—'}
                  subtitle={t('climate.page.ofSamples', 'of samples')}
                  icon={<Zap className="h-4 w-4" />}
                  color="amber"
                />
              </ClimateMetricGroup>
            )}
            </ClimateSourceBoundary>
            <ClimateSourceBoundary state={latestState} label={latestLabel}>
              {latestLoading ? <Skeleton height={84} /> :
              <ClimateMetricGroup id="climate-efficiency-comfort" period={latestPeriod}>
                <MetricCard
                  label={t('climate.page.comfortScore', 'Comfort score')}
                  value={comfortScore != null ? `${fmtNumber(comfortScore)}%` : '—'}
                  icon={<Thermometer className="h-4 w-4" />}
                  color={comfortScore != null && comfortScore >= 80 ? 'green' : 'amber'}
                />
              </ClimateMetricGroup>}
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band F — History charts (side-by-side on wide screens) ─── */}
      <ClimateRenderGroup id="climate-temperature-history" size="half" delay={0.25}
        label={t('widget.climateHistory.title', 'Climate history')}>
          {/* Temperature history */}
          <LayoutCard title={t('climate.history.title', 'Temperature history')}>
            <ClimateSourceBoundary state={historyState} label={historyLabel}>
            {historyLoading ? (
              <Skeleton height={300} />
            ) : !hasTempHistory ? (
              // no-action: temperature history accumulates automatically from climate telemetry.
              <EmptyState
                icon={<Thermometer className="h-10 w-10" aria-hidden="true" />}
                message={t(
                  'climate.history.temperatureEmpty',
                  'No temperature history has been recorded.',
                )}
                description={t(
                  'climate.history.temperatureEmptyDescription',
                  'Cabin, ambient, and set-point trends appear after the vehicle reports climate samples.',
                )}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
                {/* chart-a11y:no-table continuous temperature time-series with many data points — not tabular */}
                <EmbeddedChart
                  chartKey="climate-temp-history"
                  title={t('climate.history.title', 'Temperature history')}
                  ariaLabel={t('climate.history.temperatureAria', 'Cabin, ambient, and driver set-point temperature over time')}
                  fluid
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={convertedChartData} margin={chartMarginLabeled}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="var(--glass-border)"
                          strokeOpacity={0.4}
                        />
                        <XAxis
                          dataKey="timestamp"
                          tick={axisTick}
                          tickFormatter={(v: string) => formatTime(v)}
                        />
                        <YAxis tick={axisTick} unit={tempUnit} />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="insideTemp"
                          name={t('climate.page.insideTemp', 'Inside temp')}
                          stroke={CHART_COLORS[0]}
                          {...chartAnimation}
                          hide={hiddenSeries?.isHidden('insideTemp') ?? false}
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="outsideTemp"
                          name={t('climate.page.outsideTemp', 'Outside temp')}
                          stroke={CHART_COLORS[1]}
                          {...chartAnimation}
                          hide={hiddenSeries?.isHidden('outsideTemp') ?? false}
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          dataKey="driverTempSetting"
                          name={t('climate.page.driverSetTemp', 'Driver set temp')}
                          stroke={CHART_COLORS[2]}
                          strokeDasharray="5 5"
                          {...chartAnimation}
                          hide={hiddenSeries?.isHidden('driverTempSetting') ?? false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              </div>
            )}
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>
      <ClimateRenderGroup id="climate-hvac-history" size="half" delay={0.25}>
          {/* AC state & fan speed history */}
          <LayoutCard title={t('climate.page.acStateFanSpeed', 'AC state & fan speed')}>
            <ClimateSourceBoundary state={historyState} label={historyLabel}>
            {historyLoading ? (
              <Skeleton height={300} />
            ) : !hasTempHistory ? (
              // no-action: HVAC history accumulates automatically from climate telemetry.
              <EmptyState
                icon={<Wind className="h-10 w-10" aria-hidden="true" />}
                message={t(
                  'climate.history.hvacEmpty',
                  'No HVAC operating history has been recorded.',
                )}
                description={t(
                  'climate.history.hvacEmptyDescription',
                  'AC state and fan-speed trends appear after the vehicle reports active climate samples.',
                )}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
                {/* chart-a11y:no-table continuous HVAC time-series (AC on/off + fan speed) — dense, not tabular */}
                <EmbeddedChart
                  chartKey="climate-hvac-history"
                  title={t('climate.page.acStateFanSpeed', 'AC state & fan speed')}
                  ariaLabel={t('climate.history.hvacAria', 'AC on/off state and fan speed over time')}
                  fluid
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={convertedChartData} margin={chartMarginLabeled}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="var(--glass-border)"
                          strokeOpacity={0.4}
                        />
                        <XAxis
                          dataKey="timestamp"
                          tick={axisTick}
                          tickFormatter={(v: string) => formatTime(v)}
                        />
                        <YAxis yAxisId="ac" domain={[0, 1]} tick={axisTick} width={36} />
                        <YAxis
                          yAxisId="fan"
                          orientation="right"
                          domain={[0, 10]}
                          tick={axisTick}
                          width={36}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend />
                        {areaGradient('climateAcGrad', CHART_COLORS[0])}
                        <Area
                          {...AREA_DEFAULTS}
                          yAxisId="ac"
                          type="stepAfter"
                          dataKey="acActive"
                          name={t('climate.page.acOnOff', 'AC on/off')}
                          stroke={CHART_COLORS[0]}
                          fill="url(#climateAcGrad)"
                          {...chartAnimation}
                          hide={hiddenSeries?.isHidden('acActive') ?? false}
                        />
                        <Line
                          {...AREA_DEFAULTS}
                          yAxisId="fan"
                          type="stepAfter"
                          dataKey="fanSpeed"
                          name={t('widget.climatePanel.fanSpeed', 'Fan speed')}
                          stroke={CHART_COLORS[3]}
                          {...chartAnimation}
                          hide={hiddenSeries?.isHidden('fanSpeed') ?? false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              </div>
            )}
            </ClimateSourceBoundary>
          </LayoutCard>
      </ClimateRenderGroup>

      {/* ─── Band G — Climate history table (full-width detail band) ─── */}
      <ClimateRenderGroup id="climate-history-table" delay={0.3}>
        <LayoutCard title={t('widget.climateHistory.title', 'Climate history')}>
          <ClimateSourceBoundary state={historyState} label={historyLabel}>
          {historyLoading ? (
            <Skeleton lines={8} />
          ) : sortedHistory.length === 0 ? (
            // no-action: climate snapshots appear automatically as telemetry arrives.
            <EmptyState
              icon={<CircleGauge className="h-10 w-10" aria-hidden="true" />}
              message={t('climate.history.emptyMessage', 'No climate history has been recorded.')}
              description={t(
                'climate.history.emptyDescription',
                'Climate snapshots accumulate after the vehicle reports cabin, ambient, or HVAC telemetry.',
              )}
            />
          ) : (
            <DataTable
              tableId="vehicle-systems:climate-history"
              enableValueFilters
              filterData={history ?? []}
              columns={columns}
              mobileColumns={['timestamp', 'insideTemp', 'outsideTemp']}
              data={sortedHistory}
              keyExtractor={(row) => String(row.id ?? 0)}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
          </ClimateSourceBoundary>
        </LayoutCard>
      </ClimateRenderGroup>
      </ClimateRenderGrid>
    </PageLayout>
  );
}
