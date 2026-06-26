// Native parity port of
// web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx.
//
// The web widget is a dashboard "Charge Session Detail" tile. It resolves the
// active vehicle (vehicleId prop, else the first vehicle, else 0), fetches that
// vehicle's charging sessions (useChargingSessions), reduces them to the latest
// session by `startedAt`, and then loads that session's full detail
// (useChargingSessionDetail) plus its per-reading telemetry curve
// (useChargeTelemetry). From the telemetry it derives a power-over-time / SoC
// chart series, a peak-power figure, a human duration string, and a charger
// classification (Supercharger / DC Fast / AC-Home), and surfaces four summary
// stats (Energy Added kWh, Duration, Peak Power kW, Charger). It renders one of
// two layouts inside a <WidgetShell>:
//   1. Compact (size.cols <= 1): a single big kWh-added number over a "kWh added"
//      eyebrow plus a charger <Badge>, or a Zap EmptyState when there is no
//      session.
//   2. Standard / Wide (size.cols >= 2): a titled shell ("Charge Session
//      Detail" + emerald Zap) wrapping a <WidgetChartSummary> — a 2-up stat grid
//      over a dual-axis power(area)+SoC(line) chart; a Zap EmptyState replaces
//      the body when there is no session. The detail query's freshness
//      (loading / fetching / stale / error / dataUpdatedAt) and a manual refresh
//      feed the shell header; `isWide` (cols >= 3) selects the larger axis tick.
//
// This native port preserves that contract 1:1 — the same vid/latestSessionId
// derivations, the same useChargingSessions/useChargingSessionDetail/
// useChargeTelemetry calls, the same chartData/durationStr/peakPower/charger/
// stats memos (incl. `battery_level ?? soc` SoC fallback and the
// total_energy_added_wh -> kWh conversion), the same isCompact/isWide branches,
// the same i18n keys + English defaults, and the same visual intent — using
// React Native primitives, the existing native AppText + design tokens and the
// already-ported native charging hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default.
//   - lucide-react Zap (web L3): DOM SVG icon -> emoji/glyph stand-in (the Zap
//     glyph), tinted emerald for the title and muted for the empty state.
//   - @/components/charts ComposedChart/Area/Line/XAxis/YAxis/Tooltip/
//     ResponsiveContainer + chartGrid/axisTick/axisTickSm/chartAnimation/fmt/
//     areaGradient/ChartTooltip (web L4-8): Recharts depends on browser DOM/SVG
//     layout and is unavailable in React Native, so the composed power+SoC chart
//     is reproduced as a native dual-axis bar/line approximation (<ChargeCurveChart>)
//     drawn with View/AppText layers and the same #22c55e power / #22d3ee SoC
//     colours, the same power domain ([0, dataMax + 5]) and SoC domain ([0,100]),
//     the same preserve-start-end x labels, and the same `isWide ? axisTick :
//     axisTickSm` tick sizing. The inlined `fmt` mirrors the chart helper.
//   - @/components/ui Badge (web L9): reproduced as a native <Badge> chip
//     (warning -> amber token surface, neutral -> muted token surface), size sm.
//   - @/components/feedback EmptyState (web L10): reproduced as a native-safe
//     <EmptyState> (centered icon glyph + muted message).
//   - @/api/hooks/useCharging useChargingSessions / useChargingSessionDetail /
//     useChargeTelemetry (web L11) and @/api/hooks/useVehicles useVehicles
//     (web L12): the already-ported native web-parity hooks (same call shapes,
//     same query keys, same paths).
//   - @/lib/numberFormat fmtNumber (web L13): inline native fmtNumber (en-US
//     locale, min=max fraction digits) — the established native numberFormat port.
//   - @/lib/unitConversion convertEnergyFromSI (web L14): inlined verbatim
//     (SI watt-hours -> kWh).
//   - ./WidgetShell (web L15): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (dot-only `compact` when title-less).
//   - ./shared WidgetChartSummary + ChartSummaryStat (web L16): reproduced as a
//     native <WidgetChartSummary> (2-up stat grid + chart slot, EmptyState when
//     empty) and the same ChartSummaryStat { label, value, unit? } shape.
//   - ./types WidgetProps (web L17): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View, type DimensionValue} from 'react-native';

import {
  useChargeTelemetry,
  useChargingSessionDetail,
  useChargingSessions,
} from '../../../api/hooks/useCharging';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_ZAP = '\u26A1'; // ⚡ (Zap)

/* ------------------------------------------------------------------ */
/*  composed-chart series colours (web Area/Line stroke + fill)        */
/* ------------------------------------------------------------------ */

const POWER_COLOR = '#22c55e'; // web Area stroke + areaGradient('charge-power-grad')
const SOC_COLOR = '#22d3ee'; // web Line stroke (dashed SoC %)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback) => fallback ?? key,
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ported: ./shared ChartSummaryStat (web shared/WidgetChartSummary)  */
/* ------------------------------------------------------------------ */

export interface ChartSummaryStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatter (web @/lib/numberFormat fmtNumber)    */
/* ------------------------------------------------------------------ */

/** Port of web fmtNumber — locale-aware, min=max fraction digits. */
function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/** Port of the web charts `fmt` helper — like fmtNumber but defaulting to 1dp. */
function fmt(value: unknown, decimals = 1): string {
  return fmtNumber(value, decimals);
}

/* ------------------------------------------------------------------ */
/*  inlined SI converter (web @/lib/unitConversion convertEnergyFromSI)*/
/* ------------------------------------------------------------------ */

type EnergyUnitPref = 'Wh' | 'kWh';

/** Port of web convertEnergyFromSI — SI watt-hours -> display unit. */
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  ported chart datum + classifyCharger (web L19-31)                  */
/* ------------------------------------------------------------------ */

interface ChartDatum {
  time: string;
  power: number | null;
  soc: number | null;
}

function classifyCharger(
  chargerType: string | null,
): {label: string; variant: 'warning' | 'neutral'} {
  if (!chargerType) {
    return {label: 'AC / Home', variant: 'neutral'};
  }
  const ct = chargerType.toLowerCase();
  if (ct.includes('supercharger') || ct.includes('tesla')) {
    return {label: 'Supercharger', variant: 'warning'};
  }
  if (ct && ct !== '<invalid>' && ct !== '') {
    return {label: 'DC Fast', variant: 'warning'};
  }
  return {label: 'AC / Home', variant: 'neutral'};
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge — warning / neutral, sm)    */
/* ------------------------------------------------------------------ */

interface BadgeProps {
  variant: 'warning' | 'neutral';
  children: ReactNode;
}

function Badge({variant, children}: BadgeProps) {
  const palette =
    variant === 'warning'
      ? {
          bg: colors.warningSurface,
          border: colors.warningBorder,
          text: colors.warning,
        }
      : {
          bg: colors.surfaceRaised,
          border: colors.border,
          text: colors.textSecondary,
        };

  return (
    <View
      style={[styles.badge, {backgroundColor: palette.bg, borderColor: palette.border}]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.text}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native ChargeCurveChart (web Recharts ComposedChart, L123-190)     */
/* ------------------------------------------------------------------ */

const CHART_GRID_PERCENTS = [0, 50, 100] as const;

interface ChargeCurveChartProps {
  data: ChartDatum[];
  tickFontSize: number;
  height: number;
  powerLabel: string;
  socLabel: string;
}

function ChargeCurveChart({
  data,
  tickFontSize,
  height,
  powerLabel,
  socLabel,
}: ChargeCurveChartProps) {
  // web YAxis power domain={[0, 'dataMax + 5']}; SoC YAxis domain={[0, 100]}.
  const powerValues = data
    .map(d => d.power)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const powerMax = powerValues.length > 0 ? Math.max(...powerValues) : 0;
  const powerDomainMax = Math.max(powerMax + 5, 1);

  const tickStyle = [styles.chartTick, {fontSize: tickFontSize}];
  const firstTime = data[0]?.time ?? '';
  const lastTime = data[data.length - 1]?.time ?? '';

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${powerLabel} and ${socLabel} over ${data.length} readings; peak ${fmt(
        powerMax,
        1,
      )} kW`}
      style={styles.chartRoot}>
      <View style={[styles.chartFrame, {height}]}>
        <View style={styles.chartAxisLeft}>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(powerDomainMax, 0)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {fmt(powerDomainMax / 2, 0)}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            0
          </AppText>
        </View>

        <View style={styles.chartPlot}>
          {CHART_GRID_PERCENTS.map(percent => (
            <View
              key={`grid-${percent}`}
              pointerEvents="none"
              style={[styles.chartGridLine, {top: `${percent}%` as DimensionValue}]}
            />
          ))}

          <View style={styles.chartColumns}>
            {data.map((d, index) => {
              const powerPct =
                d.power != null
                  ? Math.max((d.power / powerDomainMax) * 100, d.power > 0 ? 3 : 0)
                  : 0;
              const socPct =
                d.soc != null ? Math.min(Math.max(d.soc, 0), 100) : null;

              return (
                <View key={`${index}-${d.time}`} style={styles.chartColumn}>
                  {d.power != null ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.chartPowerBar,
                        {
                          backgroundColor: withAlpha(POWER_COLOR, 0.3),
                          borderTopColor: POWER_COLOR,
                          height: `${powerPct}%` as DimensionValue,
                        },
                      ]}
                    />
                  ) : null}
                  {socPct != null ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.chartSocSegment,
                        {
                          backgroundColor: SOC_COLOR,
                          bottom: `${socPct}%` as DimensionValue,
                        },
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.chartAxisRight}>
          <AppText numberOfLines={1} style={tickStyle}>
            100%
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            50%
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            0%
          </AppText>
        </View>
      </View>

      {/* web XAxis interval="preserveStartEnd" -> first + last time labels. */}
      <View style={styles.chartXAxis}>
        <View style={styles.chartAxisSpacer} />
        <View style={styles.chartXLabels}>
          <AppText numberOfLines={1} style={tickStyle}>
            {firstTime}
          </AppText>
          <AppText numberOfLines={1} style={tickStyle}>
            {lastTime}
          </AppText>
        </View>
        <View style={styles.chartAxisSpacer} />
      </View>

      <View style={styles.chartLegend}>
        <View style={styles.chartLegendItem}>
          <View style={[styles.chartLegendSwatch, {backgroundColor: POWER_COLOR}]} />
          <AppText numberOfLines={1} style={styles.chartLegendLabel}>
            {powerLabel}
          </AppText>
        </View>
        <View style={styles.chartLegendItem}>
          <View style={[styles.chartLegendDash, {backgroundColor: SOC_COLOR}]} />
          <AppText numberOfLines={1} style={styles.chartLegendLabel}>
            {socLabel}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetChartSummary (web ./shared/WidgetChartSummary)        */
/* ------------------------------------------------------------------ */

interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

function WidgetChartSummary({
  stats,
  chart,
  compact,
  emptyMessage,
  emptyIcon,
  isEmpty,
}: WidgetChartSummaryProps) {
  if (isEmpty) {
    return (
      <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.statGrid}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statCell}>
              <AppText numberOfLines={1} style={styles.statLabel}>
                {stat.label}
              </AppText>
              <View style={styles.statValueRow}>
                <AppText numberOfLines={1} style={styles.statValue}>
                  {stat.value}
                </AppText>
                {stat.unit ? (
                  <AppText numberOfLines={1} style={styles.statUnit}>
                    {stat.unit}
                  </AppText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? <View style={styles.chartSlot}>{chart}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ChargingSessionDetailWidget (web L33-249)                          */
/* ------------------------------------------------------------------ */

export default function ChargingSessionDetailWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {data: sessions} = useChargingSessions(
    vid > 0 ? String(vid) : undefined,
  );

  const latestSessionId = useMemo(() => {
    const list = sessions ?? [];
    if (list.length === 0) {
      return null;
    }
    const latest = list.reduce((a, b) =>
      new Date(a.startedAt) > new Date(b.startedAt) ? a : b,
    );
    const id = Number(latest.id);
    return Number.isFinite(id) ? id : null;
  }, [sessions]);

  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useChargingSessionDetail(latestSessionId);

  const {data: telemetry, isLoading: telemetryLoading} =
    useChargeTelemetry(latestSessionId);

  const isLoading = detailLoading || telemetryLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const chartData = useMemo((): ChartDatum[] => {
    const points = telemetry ?? [];
    return points.map(p => {
      const ts = new Date(p.created_at);
      return {
        time: `${String(ts.getHours()).padStart(2, '0')}:${String(
          ts.getMinutes(),
        ).padStart(2, '0')}`,
        power: p.power_kw ?? null,
        soc: p.battery_level ?? p.soc ?? null,
      };
    });
  }, [telemetry]);

  const durationStr = useMemo(() => {
    if (!detail) {
      return '\u2014';
    }
    const mins = detail.duration_min ?? 0;
    if (mins < 60) {
      return `${mins}m`;
    }
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, [detail]);

  const peakPower = useMemo(() => {
    const points = telemetry ?? [];
    return points.reduce((max, p) => Math.max(max, p.power_kw ?? 0), 0);
  }, [telemetry]);

  const charger = useMemo(
    () => classifyCharger(detail?.charger_type ?? null),
    [detail],
  );

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!detail) {
      return [];
    }
    return [
      {
        label: t('widget.chargingSessionDetail.energy', 'Energy Added'),
        value: fmtNumber(
          convertEnergyFromSI(detail.total_energy_added_wh ?? 0, 'kWh'),
          1,
        ),
        unit: 'kWh',
      },
      {
        label: t('widget.chargingSessionDetail.duration', 'Duration'),
        value: durationStr,
      },
      {
        label: t('widget.chargingSessionDetail.peakPower', 'Peak Power'),
        value: fmtNumber(peakPower, 1),
        unit: 'kW',
      },
      {
        label: t('widget.chargingSessionDetail.charger', 'Charger'),
        value: charger.label,
      },
    ];
  }, [detail, durationStr, peakPower, charger, t]);

  // web: tick = isWide ? axisTick : axisTickSm (fontSize 11 vs 10).
  const tickFontSize = isWide ? 11 : 10;

  const chart = useMemo(() => {
    if (chartData.length === 0) {
      return null;
    }
    return (
      <ChargeCurveChart
        data={chartData}
        height={isWide ? 150 : 130}
        powerLabel={t('widget.chargingSessionDetail.powerKw', 'Power (kW)')}
        socLabel={t('widget.chargingSessionDetail.soc', 'SoC %')}
        tickFontSize={tickFontSize}
      />
    );
  }, [chartData, tickFontSize, isWide, t]);

  // ── Compact layout: large kWh number + charger badge ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={detailError ? String(detailError) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        {detail ? (
          <View style={styles.compactCenter}>
            <AppText style={styles.compactValue}>
              {fmtNumber(
                convertEnergyFromSI(detail.total_energy_added_wh ?? 0, 'kWh'),
                1,
              )}
            </AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.chargingSessionDetail.unitKwh', 'kWh added')}
            </AppText>
            <Badge variant={charger.variant}>{charger.label}</Badge>
          </View>
        ) : (
          <EmptyState
            icon={<AppText style={styles.emptyGlyph}>{ICON_ZAP}</AppText>}
            message={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.chargingSessionDetail.title', 'Charge Session Detail')}
      icon={<AppText style={styles.titleGlyph}>{ICON_ZAP}</AppText>}
      loading={isLoading}
      error={detailError ? String(detailError) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      <WidgetChartSummary
        stats={stats}
        chart={chart}
        isEmpty={!detail}
        emptyMessage={t('widget.chargingSessionDetail.empty', 'No charge sessions')}
        emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_ZAP}</AppText>}
      />
    </WidgetShell>
  );
}

ChargingSessionDetailWidget.displayName = 'ChargingSessionDetailWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  chartAxisLeft: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: 34,
  },
  chartAxisRight: {
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: 34,
  },
  chartAxisSpacer: {
    width: 34,
  },
  chartColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 1,
    position: 'relative',
  },
  chartColumns: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    columnGap: 1,
    flexDirection: 'row',
  },
  chartFrame: {
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  chartGridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.5,
    position: 'absolute',
    right: 0,
  },
  chartLegend: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
    rowGap: spacing.xs,
  },
  chartLegendDash: {
    borderRadius: 1,
    height: 2,
    width: 12,
  },
  chartLegendItem: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  chartLegendLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  chartLegendSwatch: {
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  chartPlot: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  chartPowerBar: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderTopWidth: 1.5,
    minHeight: 1,
    width: '100%',
  },
  chartRoot: {
    width: '100%',
  },
  chartSlot: {
    marginTop: spacing.sm,
  },
  chartSocSegment: {
    borderRadius: 1,
    height: 2,
    left: 1,
    position: 'absolute',
    right: 1,
  },
  chartTick: {
    color: colors.textMuted,
  },
  chartXAxis: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  chartXLabels: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  compactCenter: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    rowGap: spacing.xs,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: '#6ee7b7', // text-emerald-300
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  statCell: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 0,
  },
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  statValueRow: {
    alignItems: 'baseline',
    columnGap: 2,
    flexDirection: 'row',
  },
  summaryRoot: {
    width: '100%',
  },
  titleGlyph: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
});
