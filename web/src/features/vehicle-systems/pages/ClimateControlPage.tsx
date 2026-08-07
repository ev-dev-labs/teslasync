import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  useSortToggle,
  Heading,
  Text,
  Caption,
  Label,
  type Column,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
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
  Legend,
  ChartTooltip,
  chartMarginLabeled,
  axisTick,
  chartAnimation,
  AREA_DEFAULTS,
  areaGradient,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI } from '@/lib/unitConversion';
import { formatDateTime, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { getErrorMessage } from '@/lib/errorMessage';

import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { AIPreheatPrecoolRecommender } from '@/components/ai/AIPreheatPrecoolRecommender';
import { useClimate, useClimateHistory } from '@/api/hooks/useVehicleSystems';
import type { ClimateState } from '@/types/vehicle-systems';

/* ─── Types ─── */

interface HeatLevelStyle {
  color: string;
  bg: string;
  label: string;
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
}

type Translate = (key: string) => string;
type ComfortTone = 'good' | 'warn' | 'bad' | 'neutral';

/* ─── Constants ─── */

const HEAT_LEVELS: HeatLevelStyle[] = [
  { color: 'text-[var(--text-muted)]', bg: 'bg-gray-500/10', label: 'Off' },
  { color: 'text-cyan-400', bg: 'bg-cyan-400/10', label: 'Low' },
  { color: 'text-amber-400', bg: 'bg-amber-400/10', label: 'Medium' },
  { color: 'text-red-400', bg: 'bg-red-400/10', label: 'High' },
];

const COOL_LEVELS: HeatLevelStyle[] = [
  { color: 'text-[var(--text-muted)]', bg: 'bg-gray-500/10', label: 'Off' },
  { color: 'text-sky-400', bg: 'bg-sky-400/10', label: 'Low' },
  { color: 'text-cyan-300', bg: 'bg-cyan-300/10', label: 'Medium' },
  { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'High' },
];

const SEATS: SeatDef[] = [
  { key: 'seatHeaterLeft', label: 'Front Left' },
  { key: 'seatHeaterRight', label: 'Front Right' },
  { key: 'seatHeaterRearLeft', label: 'Rear Left' },
  { key: 'seatHeaterRearCenter', label: 'Rear Center' },
  { key: 'seatHeaterRearRight', label: 'Rear Right' },
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

const TONE_TEXT: Record<ComfortTone, string> = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  neutral: 'text-[var(--text-muted)]',
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

function keeperLabel(mode: string): string {
  switch (mode) {
    case 'On':
      return 'On';
    case 'Dog Mode':
      return 'Dog Mode';
    case 'Camp Mode':
      return 'Camp Mode';
    default:
      return 'Off';
  }
}

function comfortBadge(
  inside: number,
  target: number,
): { variant: 'success' | 'warning' | 'danger'; label: string } {
  const delta = Math.abs(inside - target);
  if (delta <= 1) return { variant: 'success', label: 'Comfortable' };
  if (delta <= 3) return { variant: 'warning', label: 'Adjusting' };
  return { variant: 'danger', label: 'Far from target' };
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

/** Band heading — h2 with a leading decorative icon; matches the reference rhythm. */
function BandHeading({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Heading level="panel" as="h2" className={cn('flex items-center gap-2', className)}>
      {icon}
      <span>{children}</span>
    </Heading>
  );
}

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

/** Comfort stat cell (score / delta / status) sharing one circular frame. */
function ComfortStat({
  label,
  tone,
  children,
  footer,
}: {
  label: string;
  tone: ComfortTone;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <GlassPanel className="flex flex-col items-center gap-2 p-4">
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
    </GlassPanel>
  );
}

/** Auto seat-climate on/off chip. */
function AutoClimateChip({
  label,
  value,
  t,
}: {
  label: string;
  value: boolean | null | undefined;
  t: Translate;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
      <Text variant="bodySm">{t(label)}</Text>
      {value != null ? (
        <Badge variant={value ? 'success' : 'neutral'} size="sm">
          {value ? t('Auto') : t('Manual')}
        </Badge>
      ) : (
        <Caption>—</Caption>
      )}
    </div>
  );
}

/** Seat heater level card. */
function SeatHeaterCard({ label, level, t }: { label: string; level: number; t: Translate }) {
  const style = heatStyle(level);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Flame className={cn('h-6 w-6', style.color)} aria-hidden="true" />
      <Text variant="bodySm" className="text-center font-medium">
        {t(label)}
      </Text>
      <Badge variant={heatBadgeVariant(level)} size="sm">
        {t(style.label)} ({level}/3)
      </Badge>
    </GlassPanel>
  );
}

/** Seat cooling level card. */
function SeatCoolingCard({
  label,
  level,
  t,
}: {
  label: string;
  level: number | null | undefined;
  t: Translate;
}) {
  const lvl = level ?? 0;
  const style = coolStyle(lvl);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Snowflake className={cn('h-6 w-6', style.color)} aria-hidden="true" />
      <Text variant="bodySm" className="text-center font-medium">
        {t(label)}
      </Text>
      {level != null ? (
        <Badge variant={coolBadgeVariant(lvl)} size="sm">
          {t(style.label)} ({Math.round(lvl)}/3)
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
  const { t } = useTranslation();
  usePageTitle(t('Climate Control'));

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
  const { data: latest, isLoading, error, refetch } = climateQuery;
  const latestLoading = isLoading && !latest;

  const historyQuery = useClimateHistory(activeId);
  const { data: history, isLoading: historyLoading } = historyQuery;

  /* ─── Charging telemetry (for NotEnoughPowerToHeat alert) ─── */
  const { data: chargingLatest } = useChargingTelemetryLatest(activeIdNum);

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
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <Text as="span" variant="body" className="whitespace-nowrap">
            {row.timestamp ? formatDateTime(row.timestamp) : '—'}
          </Text>
        ),
      },
      {
        key: 'insideTemp',
        header: `${t('Inside')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.insideTemp != null ? fmtNumber(toTemperatureDisplay(row.insideTemp), 1) : '—',
      },
      {
        key: 'outsideTemp',
        header: `${t('Outside')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.outsideTemp != null ? fmtNumber(toTemperatureDisplay(row.outsideTemp), 1) : '—',
      },
      {
        key: 'driverTempSetting',
        header: `${t('Set Temp')} ${tempUnit}`,
        sortable: true,
        render: (row) =>
          row.driverTempSetting != null
            ? fmtNumber(toTemperatureDisplay(row.driverTempSetting), 1)
            : '—',
      },
      {
        key: 'fanSpeed',
        header: t('Fan'),
        sortable: true,
        render: (row) => (row.fanSpeed != null ? String(row.fanSpeed) : '—'),
      },
      {
        key: 'isAcOn',
        header: t('HVAC'),
        render: (row) => (
          <Badge variant={row.isAcOn ? 'success' : 'neutral'} size="sm">
            {row.isAcOn ? t('On') : t('Off')}
          </Badge>
        ),
      },
      {
        key: 'climateKeeperMode',
        header: t('Climate Keeper'),
        render: (row) => (
          <Badge variant={keeperVariant(row.climateKeeperMode ?? '')} size="sm">
            {t(keeperLabel(row.climateKeeperMode ?? ''))}
          </Badge>
        ),
      },
    ],
    // tempUnit + toTemperatureDisplay are captured by the render closures; the
    // component re-renders (and rebuilds columns) whenever the unit changes.
    [t, tempUnit],
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

  const tempDelta = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) return null;
    return +fmtNumber(latest.insideTemp - latest.driverTempSetting, 1);
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
    <PageContainer
      title={t('Climate Control')}
      subtitle={t('HVAC status, temperatures, and seat heaters')}
      query={[climateQuery, historyQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VehicleSelect />
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
      }
    >
      {/* ─── Query error (announced, never gates the page) ─── */}
      {error && (
        <AlertBanner variant="danger" icon={<AlertTriangle className="h-5 w-5" />}>
          {t('Failed to load climate data')}: {getErrorMessage(error)}
        </AlertBanner>
      )}

      {/* ─── AI: Preheat / Precool recommender ─── */}
      {/* Hidden entirely when ai_mode='off' or the per-feature toggle is off via */}
      {/* the withAiFeature HOC; renders an opt-in propose-only section above the */}
      {/* deterministic HVAC banner when enabled. */}
      <FadeIn>
        <AIPreheatPrecoolRecommender
          vehicleId={activeIdNum > 0 ? activeIdNum : undefined}
          currentCabinTempC={latest?.insideTemp ?? null}
          outsideTempC={latest?.outsideTemp ?? null}
          targetCabinTempC={latest?.driverTempSetting ?? 21}
          departBy={defaultDepartBy}
        />
      </FadeIn>

      {/* ─── Band A — HVAC status banner (full-width strip) ─── */}
      <FadeIn>
        <GlassPanel
          className={cn(
            'flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5',
            latest?.isAcOn ? 'border-cyan-500/30' : 'border-gray-600/30',
          )}
          glow={latest?.isAcOn ? 'cyan' : 'none'}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Power
              className={cn('h-6 w-6', latest?.isAcOn ? 'text-cyan-400' : 'text-[var(--text-muted)]')}
              aria-hidden="true"
            />
            <Text variant="body" className="font-medium">
              {t('HVAC System')}
            </Text>
            <Badge variant={latest?.isAcOn ? 'success' : 'neutral'}>
              {latest?.isAcOn ? t('Active') : t('Off')}
            </Badge>
            <Badge variant={comfort.variant} size="sm">
              {t(comfort.label)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {latest?.climateKeeperMode && latest.climateKeeperMode !== 'Off' && (
              <Badge variant={keeperVariant(latest.climateKeeperMode)} dot>
                {t(keeperLabel(latest.climateKeeperMode))}
              </Badge>
            )}
            {latest?.defrostMode && latest.defrostMode !== 'Off' && (
              <Badge variant="info" dot>
                <Snowflake className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('Defrost')}
                {latest.defrostMode !== 'Normal' ? ` (${latest.defrostMode})` : ''}
              </Badge>
            )}
            {latest?.batteryHeater && (
              <Badge variant="warning" dot>
                <BatteryCharging className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('Battery Heater')}
              </Badge>
            )}
            {chargingLatest?.not_enough_power_to_heat && (
              <Badge variant="danger" dot>
                <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('Insufficient Power to Heat')}
              </Badge>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Band B — Hero: temperature gauges + thermal comfort ─── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('Climate Overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          {/* Temperature gauges (hero, spans 2 cols on wide screens) */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <BandHeading
              icon={<Thermometer className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('Temperature')}
            </BandHeading>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <GaugeCell
                loading={latestLoading}
                value={latest?.insideTemp != null ? toTemperatureDisplay(latest.insideTemp) : null}
                {...tempGaugeRange}
                label={t('Inside Temp')}
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
                label={t('Outside Temp')}
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
                label={t('Driver Set Temp')}
                unit={tempUnit}
                color={CHART_COLORS[2]}
                icon={<ThermometerSun className="h-6 w-6" aria-hidden="true" />}
              />
            </div>
          </GlassPanel>

          {/* Thermal comfort (context column) */}
          <GlassPanel className="p-4 sm:p-5">
            <BandHeading
              icon={<Thermometer className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('Thermal Comfort')}
            </BandHeading>
            {latestLoading ? (
              <div className="grid grid-cols-3 gap-3">
                <Skeleton height={132} className="rounded-xl" />
                <Skeleton height={132} className="rounded-xl" />
                <Skeleton height={132} className="rounded-xl" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <ComfortStat
                  label={t('Comfort Score')}
                  tone={scoreTone(comfortScore)}
                  footer={
                    <Badge
                      variant={
                        comfortScore != null && comfortScore >= 80
                          ? 'success'
                          : comfortScore != null && comfortScore >= 50
                            ? 'warning'
                            : 'danger'
                      }
                      size="sm"
                    >
                      {comfortScore != null && comfortScore >= 80
                        ? t('Excellent')
                        : comfortScore != null && comfortScore >= 50
                          ? t('Moderate')
                          : t('Poor')}
                    </Badge>
                  }
                >
                  <Text
                    as="span"
                    size="2xl"
                    weight="bold"
                    className={cn('tabular-nums', TONE_TEXT[scoreTone(comfortScore)])}
                  >
                    {comfortScore != null ? fmtInt(comfortScore) : '—'}
                  </Text>
                </ComfortStat>

                <ComfortStat
                  label={t('Temp Delta')}
                  tone={deltaTone(tempDelta)}
                  footer={
                    <Caption className="rounded-full bg-[var(--surface-2)] px-3 py-1 font-medium">
                      {tempDelta != null
                        ? Math.abs(tempDelta) <= 1
                          ? t('Near Target')
                          : tempDelta > 0
                            ? t('Above Target')
                            : t('Below Target')
                        : t('N/A')}
                    </Caption>
                  }
                >
                  <Text
                    as="span"
                    size="2xl"
                    weight="bold"
                    className={cn('tabular-nums', TONE_TEXT[deltaTone(tempDelta)])}
                  >
                    {tempDelta != null ? `${tempDelta > 0 ? '+' : ''}${tempDelta}` : '—'}
                  </Text>
                </ComfortStat>

                <ComfortStat
                  label={t('Status')}
                  tone={scoreTone(comfortScore)}
                  footer={
                    <Badge variant={comfort.variant} size="sm">
                      {tempDelta != null && tempDelta > 2
                        ? t('Too Warm')
                        : tempDelta != null && tempDelta < -2
                          ? t('Too Cold')
                          : t('Comfortable')}
                    </Badge>
                  }
                >
                  {tempDelta != null && tempDelta > 2 ? (
                    <Sun className="h-8 w-8 text-amber-400" aria-hidden="true" />
                  ) : tempDelta != null && tempDelta < -2 ? (
                    <Snowflake className="h-8 w-8 text-cyan-400" aria-hidden="true" />
                  ) : (
                    <Wind className="h-8 w-8 text-emerald-400" aria-hidden="true" />
                  )}
                </ComfortStat>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ─── Band C — Climate systems metric grid ─── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <BandHeading
            icon={<Settings className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            className="mb-4"
          >
            {t('Climate Systems')}
          </BandHeading>
          {latestLoading ? (
            <CardSkeletons count={13} className={SYSTEMS_GRID} />
          ) : (
            <div className={SYSTEMS_GRID}>
              <MetricCard
                label={t('HVAC Power')}
                value={latest?.isAcOn ? t('On') : t('Off')}
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
                  ? `${t('State')}: ${latest.hvacPower ? t('On') : t('Off')}`
                  : undefined}
              />

              <MetricCard
                label={t('Auto Conditioning')}
                value={
                  latest?.hvacAutoMode != null && latest.hvacAutoMode !== 'Off' ? t('On') : t('Off')
                }
                color="blue"
                icon={<Settings className="h-5 w-5 text-blue-400" />}
              />

              <MetricCard
                label={t('Climate Keeper')}
                value={t(keeperLabel(latest?.climateKeeperMode ?? 'off'))}
                color="amber"
                icon={<ThermometerSun className="h-5 w-5 text-amber-400" />}
                subtitle={
                  latest?.climateKeeperMode && latest.climateKeeperMode !== 'Off'
                    ? t('Active')
                    : undefined
                }
              />

              <MetricCard
                label={t('Fan Speed')}
                value={String(latest?.fanSpeed ?? 0)}
                color="cyan"
                icon={<Wind className="h-5 w-5 text-teal-400" />}
                subtitle={`${t('Level')} 0–10`}
              />

              <MetricCard
                label={t('Fan Status')}
                value={
                  latest?.hvacFanStatus != null
                    ? latest.hvacFanStatus > 0
                      ? t('Running')
                      : t('Idle')
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
                  latest?.hvacFanStatus != null ? `${t('Code')} ${latest.hvacFanStatus}` : undefined
                }
              />

              <MetricCard
                label={t('Steering Wheel Heater')}
                value={
                  latest?.hvacSteeringWheelHeatLevel != null &&
                  latest.hvacSteeringWheelHeatLevel > 0
                    ? t('On')
                    : t('Off')
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
                label={t('Steering Wheel Heat Level')}
                value={
                  latest?.hvacSteeringWheelHeatLevel == null
                    ? '—'
                    : t(heatStyle(latest.hvacSteeringWheelHeatLevel).label)
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
                    ? `${t('Level')} ${fmtInt(latest.hvacSteeringWheelHeatLevel)}`
                    : undefined
                }
              />

              <MetricCard
                label={t('Steering Wheel Heat Auto')}
                value={
                  latest?.hvacSteeringWheelHeatAuto == null
                    ? '—'
                    : latest.hvacSteeringWheelHeatAuto
                      ? t('Auto')
                      : t('Manual')
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
                label={t('Defrost Mode')}
                value={
                  latest?.defrostMode && latest.defrostMode !== 'Off' ? latest.defrostMode : t('Off')
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
                label={t('Defrost for Preconditioning')}
                value={
                  latest?.defrostForPreconditioning == null
                    ? '—'
                    : latest.defrostForPreconditioning
                      ? t('Active')
                      : t('Inactive')
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
                    ? t('Clearing windshield before drive')
                    : undefined
                }
              />

              <MetricCard
                label={t('Rear Defrost')}
                value={
                  latest?.rearDefrostEnabled == null
                    ? '—'
                    : latest.rearDefrostEnabled
                      ? t('On')
                      : t('Off')
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
                subtitle={latest?.rearDefrostEnabled ? t('Clearing rear window') : undefined}
              />

              <MetricCard
                label={t('Wiper Heater', 'Wiper Heater')}
                value={
                  latest?.wiperHeatEnabled == null
                    ? '—'
                    : latest.wiperHeatEnabled
                      ? t('On')
                      : t('Off')
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
                    ? t('Heating windshield wipers', 'Heating windshield wipers')
                    : undefined
                }
              />

              <MetricCard
                label={t('Rear Display HVAC', 'Rear Display HVAC')}
                value={
                  latest?.rearDisplayHvacEnabled == null
                    ? '—'
                    : latest.rearDisplayHvacEnabled
                      ? t('Enabled')
                      : t('Disabled')
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
                    ? t('Rear passengers can control HVAC', 'Rear passengers can control HVAC')
                    : undefined
                }
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── Band D — Protection & safety ─── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <BandHeading
            icon={<ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            className="mb-4"
          >
            {t('Protection & Safety')}
          </BandHeading>
          {latestLoading ? (
            <CardSkeletons count={4} className={PROTECTION_GRID} />
          ) : (
            <div className={PROTECTION_GRID}>
              <MetricCard
                label={t('Overheat Protection')}
                value={latest?.overheatProtection ?? t('Unknown')}
                color="green"
                icon={<ShieldCheck className="h-5 w-5 text-green-400" />}
              />
              <MetricCard
                label={t('Overheat Temp Limit', 'Overheat Temp Limit')}
                value={latest?.cabinOverheatProtectionTempLimit ?? '—'}
                color="amber"
                icon={<ThermometerSun className="h-5 w-5 text-orange-400" />}
              />
              <MetricCard
                label={t('Battery Heater')}
                value={latest?.batteryHeater ? t('On') : t('Off')}
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
                label={t('Passenger Setting')}
                value={
                  latest?.passengerTempSetting != null
                    ? `${fmtNumber(toTemperatureDisplay(latest.passengerTempSetting), 1)}${tempUnit}`
                    : '—'
                }
                color="purple"
                icon={<Thermometer className="h-5 w-5 text-purple-400" />}
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── Band E — Seat heaters (span 2) + climate efficiency ─── */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('Comfort & Efficiency')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          {/* Seat heaters + cooling */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <BandHeading
              icon={<Flame className="h-4 w-4 text-amber-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('Seat Heaters')}
            </BandHeading>

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
                      level={latest?.[seat.key] ?? 0}
                      t={t}
                    />
                  ))}
                </div>

                {/* Auto seat climate */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <AutoClimateChip
                    label="Auto Climate (Left)"
                    value={latest?.autoSeatClimateLeft}
                    t={t}
                  />
                  <AutoClimateChip
                    label="Auto Climate (Right)"
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
                        {t('Seat Cooling')}
                      </Text>
                    </div>
                    <Badge
                      variant={latest?.seatVentEnabled ? 'success' : 'neutral'}
                      size="sm"
                    >
                      {t('Ventilation')}:{' '}
                      {latest?.seatVentEnabled == null
                        ? '—'
                        : latest.seatVentEnabled
                          ? t('On')
                          : t('Off')}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <SeatCoolingCard
                      label="Front Left"
                      level={latest?.climateSeatCoolingFrontLeft}
                      t={t}
                    />
                    <SeatCoolingCard
                      label="Front Right"
                      level={latest?.climateSeatCoolingFrontRight}
                      t={t}
                    />
                  </div>
                </div>

                {/* Level legend */}
                <div className="flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-3">
                  {HEAT_LEVELS.map((lvl, idx) => (
                    <div key={lvl.label} className="flex items-center gap-1.5">
                      <Flame className={cn('h-3.5 w-3.5', lvl.color)} aria-hidden="true" />
                      <Caption>
                        {idx} — {t(lvl.label)}
                      </Caption>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassPanel>

          {/* Climate efficiency */}
          <GlassPanel className="p-4 sm:p-5">
            <BandHeading
              icon={<Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('Climate Efficiency')}
            </BandHeading>
            {historyLoading ? (
              <CardSkeletons count={4} className="grid grid-cols-2 gap-3 sm:gap-4" />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <MetricCard
                  label={t('Avg Fan Speed')}
                  value={efficiencyStats ? fmtNumber(efficiencyStats.avgFan, 1) : '—'}
                  subtitle={t('Level 0–10')}
                  icon={<Wind className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Peak Fan Speed')}
                  value={efficiencyStats ? fmtNumber(efficiencyStats.peakFan, 1) : '—'}
                  subtitle={t('Level 0–10')}
                  icon={<Wind className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('AC On Time')}
                  value={efficiencyStats ? `${fmtInt(efficiencyStats.acOnPct)}%` : '—'}
                  subtitle={t('of samples')}
                  icon={<Zap className="h-4 w-4" />}
                  color="amber"
                />
                <MetricCard
                  label={t('Comfort Score')}
                  value={comfortScore != null ? `${fmtInt(comfortScore)}%` : '—'}
                  icon={<Thermometer className="h-4 w-4" />}
                  color={comfortScore != null && comfortScore >= 80 ? 'green' : 'amber'}
                />
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ─── Band F — History charts (side-by-side on wide screens) ─── */}
      <FadeIn delay={0.25}>
        <section
          aria-label={t('Climate History')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 2xl:gap-5"
        >
          {/* Temperature history */}
          <GlassPanel className="p-4 sm:p-5">
            <BandHeading
              icon={<Thermometer className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('Temperature History')}
            </BandHeading>
            {historyLoading ? (
              <Skeleton height={300} />
            ) : !hasTempHistory ? (
              <EmptyState /* no-action: transient — no history samples yet */
                icon={<Thermometer className="h-10 w-10" aria-hidden="true" />}
                message={t('No temperature history available.')}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
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
                    <Legend />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="insideTemp"
                      name={t('Inside Temp')}
                      stroke={CHART_COLORS[0]}
                      {...chartAnimation}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="outsideTemp"
                      name={t('Outside Temp')}
                      stroke={CHART_COLORS[1]}
                      {...chartAnimation}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="driverTempSetting"
                      name={t('Driver Set Temp')}
                      stroke={CHART_COLORS[2]}
                      strokeDasharray="5 5"
                      {...chartAnimation}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* AC state & fan speed history */}
          <GlassPanel className="p-4 sm:p-5">
            <BandHeading
              icon={<Wind className="h-4 w-4 text-purple-300" aria-hidden="true" />}
              className="mb-4"
            >
              {t('AC State & Fan Speed')}
            </BandHeading>
            {historyLoading ? (
              <Skeleton height={300} />
            ) : !hasTempHistory ? (
              <EmptyState /* no-action: transient — no HVAC history samples yet */
                icon={<Wind className="h-10 w-10" aria-hidden="true" />}
                message={t('No HVAC history available.')}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
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
                    <Legend />
                    {areaGradient('climateAcGrad', CHART_COLORS[0])}
                    <Area
                      {...AREA_DEFAULTS}
                      yAxisId="ac"
                      type="stepAfter"
                      dataKey="acActive"
                      name={t('AC On/Off')}
                      stroke={CHART_COLORS[0]}
                      fill="url(#climateAcGrad)"
                      {...chartAnimation}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      yAxisId="fan"
                      type="stepAfter"
                      dataKey="fanSpeed"
                      name={t('Fan Speed')}
                      stroke={CHART_COLORS[3]}
                      {...chartAnimation}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ─── Band G — Climate history table (full-width detail band) ─── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <BandHeading
            icon={<CircleGauge className="h-4 w-4 text-purple-300" aria-hidden="true" />}
            className="mb-4"
          >
            {t('Climate History')}
          </BandHeading>
          {historyLoading ? (
            <Skeleton lines={8} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState /* no-action: transient — no history records yet */
              icon={<CircleGauge className="h-10 w-10" aria-hidden="true" />}
              message={t('No history records found.')}
            />
          ) : (
            <DataTable
              tableId="vehicle-systems:climate-history"
              columns={columns}
              data={sortedHistory}
              keyExtractor={(row) => String(row.id ?? 0)}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
