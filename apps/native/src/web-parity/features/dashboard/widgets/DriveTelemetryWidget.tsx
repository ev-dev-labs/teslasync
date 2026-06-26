// Native parity port of web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx.
//
// Dashboard widget that finds a vehicle's most-recent drive (the max startTs of
// useDrives), polls that drive's telemetry (useDriveTelemetry) and renders a
// multi-series time chart (cyan speed line + green/red power area + amber dashed
// battery line, plus a gray elevation area in the wide layout) with a header
// stat row (distance / duration / efficiency), an optional start-address badge
// and a colour legend. The compact (1-col) layout collapses to a stat summary
// only. The web file pulls in browser-only or web-UI dependencies that are
// absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L30) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.driveTelemetry.*','<English>') call keeps its English default +
//     translation-key intent (the established AlertFeed/ChargeHistory/
//     ChargingTelemetry port pattern).
//   - lucide-react Activity (web L3) -> the shared native SemanticIcon
//     name="activity" (lucide SVG has no native renderer; the 'activity' glyph
//     maps one-for-one). The web title icon's text-neon-cyan tint collapses to
//     the semantic icon's fixed accent tone, as in the sibling ports.
//   - `@/components/charts` ComposedChart/Line/Area/XAxis/YAxis/Tooltip/
//     ResponsiveContainer + chartGrid/axisTick/axisTickSm/chartAnimation/fmt/
//     useThemeChartPalette/areaGradient + ChartTooltip (web L4-9) -> the ported
//     native charts barrel (../../../components/charts). React Native has no
//     Recharts/SVG backend, so the chart primitives render documented
//     "native chart renderer unavailable" placeholders while preserving the
//     exact prop wiring (dataKey/yAxisId/stroke/areaGradient ids/tick/etc.) the
//     web chart used — the same approach as the DrivingTab port.
//   - `@/components/ui` Badge (web L10) -> inlined native Badge: the rounded-full
//     variant+size pill reproduced with RN primitives; the web truncate
//     max-w-[180px] start-address cap maps to numberOfLines={1} + maxWidth 180.
//   - `@/components/feedback` EmptyState (web L11) -> inlined EmptyState: a
//     centred icon + muted message (the shared native EmptyState requires a
//     title and takes no icon, so it is inlined like the ChargingTelemetry port).
//   - `@/api/hooks/useDriving` useDrives + useDriveTelemetry (web L12) and
//     `@/api/hooks/useVehicles` useVehicles (web L13) -> the ported native hooks
//     (same '/drives?vehicle_id=', '/drives/{id}/telemetry' and '/vehicles'
//     queries, same UseQueryResult fields).
//   - `@/hooks/useUnits` useUnits (web L14) -> inlined useUnits() shim over the
//     ported useFormatPrefs bridge, returning the same { unitPrefs: { distance,
//     speed } } shape so the unitPrefs.distance / unitPrefs.speed call sites are
//     preserved verbatim.
//   - `@/lib/unitConversion` convertDistanceFromSI + convertSpeedFromSI (web L15)
//     -> the ported _formatPrimitives converters (identical SI->display maths).
//   - `@/lib/numberFormat` fmtNumber + fmtInt (web L16) -> ported inline
//     (locale-aware toLocaleString + safeNumber guard; fmtInt = fmtNumber(_,0)),
//     matching web numberFormat's 'en-US' default. Every call passes an explicit
//     decimal count so the global precision is irrelevant.
//   - `./WidgetShell` WidgetShell (web L17) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     sibling widgets); the web `noPadding` is folded into the shell's single
//     content padding so the px-4 pb-3 spacing matches exactly.
//   - `./shared` WidgetChartSummary + ChartSummaryStat (web L18) -> inlined
//     native WidgetChartSummary: the stat row + empty-state contract reproduced
//     with RN primitives (the web @container grid relaxation collapses to a
//     2-col flex-wrap — RN has no container queries).
//   - `./types` WidgetProps (web L19) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// Behaviour, state/var names (vid, latestDrive, driveId, telemetry,
// isLoading/isCompact/isWide, palette, chartData, stats, tick, chart,
// efficiencyUnit, unitPrefs.distance/speed), the SI fields read verbatim
// (distanceM/durationS/energyUsedWh, speed m/s converted via convertSpeedFromSI,
// distance via convertDistanceFromSI), the latest-drive reduce, the i18n keys,
// the size.cols<=1 / >=3 breakpoints and the efficiency = energyUsedWh / display
// distance maths are all preserved. No DOM-only modules, HTML elements,
// react-i18next, lucide-react, Recharts, Leaflet, or web @/ UI imports remain —
// only react, react-native primitives, the shared native SemanticIcon / AppText /
// theme tokens, and the ported parity charts / useDriving / useVehicles /
// _formatPrimitives / DataFreshness / QueryError.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useDrives, useDriveTelemetry} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  Area,
  areaGradient,
  axisTick,
  axisTickSm,
  chartAnimation,
  chartGrid,
  ChartTooltip,
  ComposedChart,
  fmt,
  Line,
  ResponsiveContainer,
  Tooltip,
  useThemeChartPalette,
  XAxis,
  YAxis,
} from '../../../components/charts';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  useFormatPrefs,
  type DistanceUnit,
  type SpeedUnit,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtNumber + fmtInt (ported inline) ──
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ── @/hooks/useUnits replacement (native bridge over useFormatPrefs) ──
// Native has no useUnits hook; the distance/speed display preference is derived
// from the shared useFormatPrefs bridge (settings -> unit prefs) and exposed
// under the same { unitPrefs: { distance, speed } } shape the web useUnits
// returns so the unitPrefs.distance / unitPrefs.speed call sites are preserved.
interface UnitPrefs {
  distance: DistanceUnit;
  speed: SpeedUnit;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {distanceUnit, speedUnit} = useFormatPrefs();
  return {unitPrefs: {distance: distanceUnit, speed: speedUnit}};
}

// ── ./shared ChartSummaryStat (ported inline) ──
interface ChartSummaryStat {
  label: string;
  value: number | string;
  unit?: string;
}

// ── @/components/ui Badge (inlined native-safe subset) ──
type BadgeVariant = 'danger' | 'info' | 'neutral' | 'success' | 'warning';
type BadgeSize = 'lg' | 'md' | 'sm';

interface BadgeProps {
  children: ReactNode;
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
  variant?: BadgeVariant;
}

function Badge({children, size = 'md', style, variant = 'neutral'}: BadgeProps) {
  return (
    <View
      style={[styles.badge, badgeVariantStyles[variant], badgeSizeStyles[size], style]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, badgeTextColors[variant], badgeTextSizes[size]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (inlined icon + message variant) ──
function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches web EmptyState no-action comment).
  return (
    <View style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetChartSummary (inlined native-safe subset) ──
interface WidgetChartSummaryProps {
  stats: ChartSummaryStat[];
  chart: ReactNode;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
}

function WidgetChartSummary({
  chart,
  compact,
  emptyIcon,
  emptyMessage,
  isEmpty,
  stats,
}: WidgetChartSummaryProps) {
  if (isEmpty) {
    return (
      <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />
    );
  }

  return (
    <View style={styles.summaryRoot}>
      {stats.length > 0 ? (
        <View style={styles.summaryGrid}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.summaryStat}>
              <AppText numberOfLines={1} style={styles.summaryStatLabel}>
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.summaryStatValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.summaryStatUnit}>{` ${stat.unit}`}</AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      {!compact ? <View style={styles.summaryChart}>{chart}</View> : null}
    </View>
  );
}

// ── ./WidgetShell (inlined, native-safe subset) ──
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
  children,
  error,
  icon,
  isError,
  isFetching,
  isStale,
  loading,
  onRefresh,
  title,
  updatedAt,
}: WidgetShellProps) {
  // Pulse-on-data-change glow (web WidgetShell L59-80).
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
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
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
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── chart datum (web L21-27) ──
interface ChartDatum {
  time: string;
  speed: number | null;
  power: number | null;
  battery: number | null;
  elevation: number | null;
}

export default function DriveTelemetryWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {unitPrefs} = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const {data: drives, isLoading: drivesLoading} = useDrives(
    vid > 0 ? String(vid) : undefined,
  );

  const latestDrive = useMemo(() => {
    const list = drives ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) =>
      new Date(a.startTs) > new Date(b.startTs) ? a : b,
    );
  }, [drives]);

  const driveId = latestDrive ? String(latestDrive.id) : '';

  const {
    data: telemetry,
    isLoading: telemetryLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useDriveTelemetry(driveId);

  const isLoading = drivesLoading || telemetryLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Chart series colors derive from the active theme.
  const palette = useThemeChartPalette();

  const chartData = useMemo((): ChartDatum[] => {
    const points = telemetry ?? [];
    return points.map(p => {
      const ts = new Date(p.timestamp);
      return {
        battery: p.batteryLevel ?? p.soc ?? null,
        elevation: p.elevation ?? null,
        power: p.power ?? null,
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : null,
        time: `${String(ts.getHours()).padStart(2, '0')}:${String(
          ts.getMinutes(),
        ).padStart(2, '0')}`,
      };
    });
  }, [telemetry, unitPrefs.speed]);

  const stats = useMemo((): ChartSummaryStat[] => {
    if (!latestDrive) return [];
    const items: ChartSummaryStat[] = [
      {
        label: t('widget.driveTelemetry.distance', 'Distance'),
        unit: unitPrefs.distance,
        value: fmtNumber(
          convertDistanceFromSI(latestDrive.distanceM, unitPrefs.distance),
          1,
        ),
      },
      {
        label: t('widget.driveTelemetry.duration', 'Duration'),
        unit: t('widget.driveTelemetry.min', 'min'),
        value: fmtInt(latestDrive.durationS / 60),
      },
    ];
    if (latestDrive.energyUsedWh != null && latestDrive.distanceM > 0) {
      const distance = convertDistanceFromSI(
        latestDrive.distanceM,
        unitPrefs.distance,
      );
      const efficiency = distance > 0 ? latestDrive.energyUsedWh / distance : null;
      items.push({
        label: t('widget.driveTelemetry.efficiency', 'Efficiency'),
        unit: efficiencyUnit,
        value: efficiency != null ? fmtNumber(efficiency, 0) : '—',
      });
    }
    return items;
  }, [latestDrive, unitPrefs.distance, efficiencyUnit, t]);

  const tick = isWide ? axisTick : axisTickSm;

  const chart = useMemo(() => {
    if (chartData.length === 0) return null;
    return (
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart
          data={chartData}
          margin={{bottom: 0, left: isCompact ? -30 : -10, right: 4, top: 4}}
          {...chartAnimation}>
          {areaGradient('power-pos', '#22c55e')}
          {areaGradient('power-neg', '#ef4444')}
          {areaGradient('elevation-grad', '#9ca3af')}
          {chartGrid}

          <XAxis
            axisLine={false}
            dataKey="time"
            interval="preserveStartEnd"
            tick={isCompact ? false : tick}
            tickLine={false}
          />

          {/* Left axis: speed */}
          <YAxis
            axisLine={false}
            domain={[0, 'dataMax + 10']}
            tick={isCompact ? false : tick}
            tickFormatter={(v: number) => fmt(v, 0)}
            tickLine={false}
            width={isCompact ? 0 : 36}
            yAxisId="speed"
          />

          {/* Right axis: power */}
          <YAxis
            axisLine={false}
            orientation="right"
            tick={isCompact ? false : tick}
            tickFormatter={(v: number) => fmt(v, 0)}
            tickLine={false}
            width={isCompact ? 0 : 36}
            yAxisId="power"
          />

          <Tooltip content={<ChartTooltip />} />

          {/* Wide: elevation as gray area under speed */}
          {isWide ? (
            <Area
              connectNulls
              dataKey="elevation"
              fill="url(#elevation-grad)"
              fillOpacity={0.15}
              isAnimationActive={false}
              name={t('widget.driveTelemetry.elevation', 'Elevation')}
              stroke="none"
              yAxisId="speed"
            />
          ) : null}

          {/* Power as green/red area on right axis */}
          <Area
            connectNulls
            dataKey="power"
            fill="url(#power-pos)"
            fillOpacity={0.3}
            name={t('widget.driveTelemetry.power', 'Power (kW)')}
            stroke={palette.series[1]}
            strokeWidth={1.5}
            yAxisId="power"
          />

          {/* Speed as cyan line on left axis */}
          <Line
            connectNulls
            dataKey="speed"
            dot={false}
            name={`${t('widget.driveTelemetry.speed', 'Speed')} (${unitPrefs.speed})`}
            stroke={palette.series[0]}
            strokeWidth={2}
            yAxisId="speed"
          />

          {/* Battery % as amber dashed line on left axis (0-100 range fits well) */}
          <Line
            connectNulls
            dataKey="battery"
            dot={false}
            name={t('widget.driveTelemetry.battery', 'Battery %')}
            stroke="#f59e0b"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            yAxisId="speed"
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [chartData, isCompact, isWide, tick, unitPrefs.speed, t, palette]);

  // Compact layout
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        <WidgetChartSummary
          chart={null}
          compact
          emptyIcon={<SemanticIcon decorative name="activity" size="md" />}
          emptyMessage={t('widget.driveTelemetry.empty', 'No recent drives')}
          isEmpty={!latestDrive}
          stats={stats}
        />
      </WidgetShell>
    );
  }

  // Standard / Wide layout
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="activity" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.driveTelemetry.title', 'Drive Telemetry')}
      updatedAt={dataUpdatedAt}>
      {latestDrive ? (
        <View style={styles.driveBody}>
          {/* Header stats + badges */}
          <View style={styles.headerRow}>
            {stats.map(s => (
              <View key={s.label} style={styles.headerStat}>
                <AppText style={styles.headerStatLabel}>{s.label}</AppText>
                <AppText style={styles.headerStatValue}>
                  {s.value}
                  {s.unit ? (
                    <AppText style={styles.headerStatUnit}>{` ${s.unit}`}</AppText>
                  ) : null}
                </AppText>
              </View>
            ))}
            {isWide && latestDrive.startAddress ? (
              <Badge size="sm" style={styles.addressBadge} variant="neutral">
                {latestDrive.startAddress}
              </Badge>
            ) : null}
          </View>

          {/* Chart area */}
          <View style={styles.chartArea}>
            {chartData.length > 0 ? (
              chart
            ) : (
              <EmptyState
                icon={<SemanticIcon decorative name="activity" size="md" />}
                message={t(
                  'widget.driveTelemetry.noTelemetry',
                  'No telemetry for this drive',
                )}
              />
            )}
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: palette.series[0]}]} />
              <AppText style={styles.legendLabel}>
                {t('widget.driveTelemetry.speed', 'Speed')}
              </AppText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: palette.series[1]}]} />
              <AppText style={styles.legendLabel}>
                {t('widget.driveTelemetry.power', 'Power (kW)')}
              </AppText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#f59e0b'}]} />
              <AppText style={styles.legendLabel}>
                {t('widget.driveTelemetry.battery', 'Battery %')}
              </AppText>
            </View>
            {isWide ? (
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, {backgroundColor: '#9ca3af'}]}
                />
                <AppText style={styles.legendLabel}>
                  {t('widget.driveTelemetry.elevation', 'Elevation')}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <EmptyState
          icon={<SemanticIcon decorative name="activity" size="md" />}
          message={t('widget.driveTelemetry.empty', 'No recent drives')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  addressBadge: {
    maxWidth: 180,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
  },
  badgeText: {
    flexShrink: 1,
    fontWeight: '500',
  },
  chartArea: {
    flex: 1,
    minHeight: 120,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  driveBody: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerRow: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 8,
    rowGap: 8,
  },
  headerStat: {
    flexDirection: 'column',
  },
  headerStatLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  headerStatUnit: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
  },
  headerStatValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  legend: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingTop: 4,
    rowGap: 6,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    columnGap: 4,
    flexDirection: 'row',
  },
  legendLabel: {
    color: colors.textSecondary,
    fontSize: 10,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  summaryChart: {
    flex: 1,
    marginTop: 8,
    minHeight: 80,
  },
  summaryGrid: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  summaryRoot: {
    flex: 1,
  },
  summaryStat: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 0,
  },
  summaryStatLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  summaryStatUnit: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
  },
  summaryStatValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
});

const badgeVariantStyles = StyleSheet.create({
  danger: {
    backgroundColor: colors.dangerSurface,
  },
  info: {
    backgroundColor: colors.accentSoft,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
  },
  success: {
    backgroundColor: colors.successSurface,
  },
  warning: {
    backgroundColor: colors.warningSurface,
  },
});

const badgeTextColors = StyleSheet.create({
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

const badgeSizeStyles = StyleSheet.create({
  lg: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  md: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});

const badgeTextSizes = StyleSheet.create({
  lg: {
    fontSize: 14,
  },
  md: {
    fontSize: 12,
  },
  sm: {
    fontSize: 12,
  },
});
