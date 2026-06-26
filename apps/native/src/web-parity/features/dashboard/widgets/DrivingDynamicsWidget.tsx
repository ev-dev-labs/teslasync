// Native parity port of web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx.
//
// The web widget is the dashboard "Driving Dynamics" tile. It resolves a
// vehicle id (`vehicleId` prop, else the first vehicle from `useVehicles()`),
// reads g-force dynamics from `useDrivingDynamics(idStr)` (GET
// /api/v1/drives/dynamics?vehicle_id=… — preserved verbatim by the already-
// ported native useDriving hook) plus the acceleration histogram from
// `useAccelerationDistribution(idStr)` (GET
// /api/v1/drives/acceleration-distribution?vehicle_id=…) and renders, inside a
// `WidgetShell`, one of two layouts driven by `size.cols`:
//   - Compact (cols <= 1): a big `Max g` number (max of the three peak g's) +
//     uppercase caption + a Smooth/Aggressive `Badge` (success when maxG < 0.4),
//     else a `Gauge`-iconed empty state.
//   - Standard / Wide (cols >= 3): three `RadialGauge`s (avg accel, avg brake,
//     max cornering) each capped at G_MAX (1.2) and coloured by `gaugeColor`,
//     a centred severity `Badge` (calm/normal -> success, sporty/aggressive ->
//     warning, with the per-severity colour applied to the chip text) and —
//     only when `isWide` AND the histogram has data — an acceleration-
//     distribution bar chart, else the same empty state.
//
// Every state name (`vehicles`, `vid`, `vehicleIdStr`, `dynamics`, `dynLoading`,
// `dynError`, `dynFetching`, `dynStale`, `dynIsError`, `dynUpdatedAt`,
// `dynRefetch`, `distData`, `distLoading`, `distFetching`, `distUpdatedAt`,
// `isLoading`, `updatedAt`, `isFetching`, `isCompact`, `isWide`, `maxG`,
// `smooth`, `severity`, `histogramData`), the `vehicleId ?? vehicles?.[0]?.id`
// resolution, the `vid != null ? String(vid) : undefined` coercion, the full
// `useDrivingDynamics` / `useAccelerationDistribution` destructures, the
// `dynLoading || distLoading` / `Math.max(dynUpdatedAt ?? 0, distUpdatedAt ?? 0)`
// / `dynFetching || distFetching` aggregations, the `size.cols <= 1` / `>= 3`
// thresholds, the `Math.max(maxAccelerationG, maxBrakingG, maxCorneringG)` peak,
// `isSmooth(maxG)` (< 0.4), `deriveSeverity` (calm/normal/sporty/aggressive
// cut-points 0.15/0.3/0.5), `SEVERITY_COLORS`, `gaugeColor` (0.2/0.4/0.6
// cut-points), G_MAX (1.2), both `useMemo`s with their exact dependency arrays,
// the `G_MAX / values.length` histogram step + `fmtNumber(i*step, 2)` range
// labels + `count ?? 0` null-safety, and every `widget.drivingDynamics.*` i18n
// key with its English fallback (including the dynamic severity key) are
// preserved. Browser-only pieces are mapped to native-safe equivalents
// (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     BatteryDegradationTrendWidget ports), so every key + copy is preserved.
//   - lucide-react `Gauge` has no native icon dependency; per the APIUsageWidget
//     glyph precedent it becomes a decorative Unicode dial glyph (◔ U+25D4) in
//     an `AppText` with `importantForAccessibility="no"` (the shell title /
//     empty message carries the accessible meaning). `h-3.5 w-3.5` (14px) ->
//     fontSize 14 in the title accent (web `text-neon-cyan` -> the accent token
//     so the cyan tint actually applies); `h-5 w-5` (20px) -> fontSize 20 muted
//     in the empty state.
//   - `@/components/charts` `RadialGauge` reuses the already-ported native
//     parity RadialGauge (value in the centre + the formatted-value `label`
//     caption below, identical to the web component); the separate web caption
//     span ("Accel"/"Brake"/"Lateral") is kept below each gauge.
//   - The recharts acceleration histogram (`BarChart`, `Bar`, `XAxis`, `YAxis`,
//     `ResponsiveContainer`, `Tooltip`, `axisTick`, `axisTickSm`, `chartGrid`)
//     is DOM/SVG-only. It is reimplemented as a native `AccelerationHistogram`
//     of scaled Views — per-range vertical columns (the established native chart
//     idiom, see components/charts MiniBarChart), `XAxis dataKey="range"` ->
//     centred axis ticks, the `<Bar fill={palette.series[0]}>` series colour ->
//     the native accent token (mirroring `useThemeChartPalette().series[0]`,
//     same mapping as the BatteryDegradationTrendWidget port), and the
//     `<Tooltip labelFormatter={v => `${v}g`}>` hover affordance (no native
//     pointer) -> an accessible "…g" summary label. YAxis `allowDecimals={false}`
//     -> integer-formatted count summary.
//   - `@/components/ui` `Badge` (variant success/warning rounded chip) is inlined
//     as a native `WidgetBadge` pill (tinted bg + border from the success/warning
//     tokens, optional `textColor` override for the per-severity colour), with
//     the web `min-h-[44px] min-w-[44px]` a11y tap target preserved.
//   - `@/lib/numberFormat` `fmtNumber` is inlined as a native-safe formatter
//     mirroring the web module (locale-aware `toLocaleString`, the out-of-box
//     precision-2 / en-US defaults — same approach as the sibling widget ports).
//   - `WidgetShell` (web: a transparent flex container with `Skeleton` loading +
//     `QueryError` error + a `DataFreshness` header affordance) is inlined on a
//     `GlassPanel`: loading -> a centred `Spinner`, error -> centred danger text,
//     otherwise an optional uppercase title row + a compact freshness control
//     (status dot coloured by isError/isStale/isFetching + a refresh Pressable
//     wired to `dynRefetch`) over the children — identical to the sibling ports.
//   - `@/components/feedback` `EmptyState` (icon + message, web role="status") is
//     inlined as a small centred View with the glyph icon + muted message; the
//     web `py-2` (compact) / `py-4` (standard) padding intent is preserved via a
//     `dense` flag.

import React, {useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAccelerationDistribution,
  useDrivingDynamics,
} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatter (mirror web @/lib/numberFormat) ──────────── */

// The web `fmtNumber` reads a module-level global precision (default 2) + locale
// (default en-US) set by useSettings; the native parity layer has no settings
// store wired in here, so we mirror the web module's out-of-box defaults.
const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── decorative glyph (lucide-react Gauge stand-in) ────────────────────────── */

const ICON_GAUGE = '\u25D4'; // ◔ dial-like quadrant glyph (monochrome so the tint applies)
const GLYPH_REFRESH = '\u21BB';

function GaugeGlyph({accent, size}: {accent?: boolean; size: number}) {
  return (
    <AppText
      importantForAccessibility="no"
      style={[
        styles.glyph,
        {fontSize: size},
        accent ? styles.glyphAccent : styles.glyphMuted,
      ]}>
      {ICON_GAUGE}
    </AppText>
  );
}

/* ─── widget domain helpers (verbatim from the web module) ──────────────────── */

const G_MAX = 1.2;

type Severity = 'calm' | 'normal' | 'sporty' | 'aggressive';

function deriveSeverity(avgAccel: number, avgBrake: number): Severity {
  const avg = (avgAccel + avgBrake) / 2;
  if (avg < 0.15) {
    return 'calm';
  }
  if (avg < 0.3) {
    return 'normal';
  }
  if (avg < 0.5) {
    return 'sporty';
  }
  return 'aggressive';
}

const SEVERITY_COLORS: Record<Severity, string> = {
  calm: '#10b981',
  normal: '#22d3ee',
  sporty: '#f59e0b',
  aggressive: '#ef4444',
};

function isSmooth(maxG: number): boolean {
  return maxG < 0.4;
}

function gaugeColor(g: number): string {
  if (g < 0.2) {
    return '#10b981';
  }
  if (g < 0.4) {
    return '#22d3ee';
  }
  if (g < 0.6) {
    return '#f59e0b';
  }
  return '#ef4444';
}

// web: `<Bar fill={useThemeChartPalette().series[0]} />` — the native parity
// layer has no theme palette hook wired in here, so we mirror series[0] with
// the accent token (same mapping as the BatteryDegradationTrendWidget port).
const CHART_SERIES_PRIMARY = colors.accent;

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

interface HistogramBar {
  range: string;
  count: number;
}

/* ─── inlined Badge (web @/components/ui Badge) ─────────────────────────────── */

type BadgeVariant = 'success' | 'warning';

function WidgetBadge({
  children,
  textColor,
  variant,
}: {
  children: ReactNode;
  textColor?: string;
  variant: BadgeVariant;
}) {
  const tint =
    variant === 'success'
      ? {
          background: colors.successSurface,
          border: colors.successBorder,
          text: colors.success,
        }
      : {
          background: colors.warningSurface,
          border: colors.warningBorder,
          text: colors.warning,
        };

  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tint.background, borderColor: tint.border},
      ]}>
      <AppText
        style={[styles.badgeText, {color: textColor ?? tint.text}]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = (
    <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
  );

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── inlined WidgetEmptyState (web @/components/feedback EmptyState) ────────── */

function WidgetEmptyState({
  dense,
  icon,
  message,
}: {
  dense?: boolean;
  icon?: ReactNode;
  message: string;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.emptyState, dense ? styles.emptyStateDense : null]}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined acceleration histogram (web recharts BarChart) ────────────────── */

function AccelerationHistogram({
  bars,
  seriesColor,
  title,
}: {
  bars: HistogramBar[];
  seriesColor: string;
  title: string;
}) {
  const maxCount = Math.max(...bars.map(bar => bar.count), 1);
  // web <Tooltip labelFormatter={(v) => `${v}g`}> + YAxis allowDecimals={false}
  const summary = `${title}: ${bars
    .map(bar => `${bar.range}g ${fmtNumber(bar.count, 0)}`)
    .join(', ')}`;

  return (
    <View style={styles.histogram}>
      <AppText style={styles.histogramTitle} tone="muted" variant="caption">
        {title}
      </AppText>
      <View
        accessibilityLabel={summary}
        accessibilityRole="image"
        accessible
        style={styles.histogramBody}>
        {bars.map(bar => (
          <View key={bar.range} style={styles.histogramColumn}>
            <View style={styles.histogramTrack}>
              <View
                style={[
                  styles.histogramFill,
                  {
                    backgroundColor: seriesColor,
                    height: `${Math.max(clamp01(bar.count / maxCount) * 100, 4)}%`,
                  },
                ]}
              />
            </View>
            <AppText
              numberOfLines={1}
              style={styles.histogramTick}
              tone="muted"
              variant="caption">
              {bar.range}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function DrivingDynamicsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: dynamics,
    isLoading: dynLoading,
    error: dynError,
    isFetching: dynFetching,
    isStale: dynStale,
    isError: dynIsError,
    dataUpdatedAt: dynUpdatedAt,
    refetch: dynRefetch,
  } = useDrivingDynamics(vehicleIdStr);

  const {
    data: distData,
    isLoading: distLoading,
    isFetching: distFetching,
    dataUpdatedAt: distUpdatedAt,
  } = useAccelerationDistribution(vehicleIdStr);

  const isLoading = dynLoading || distLoading;
  const updatedAt = Math.max(dynUpdatedAt ?? 0, distUpdatedAt ?? 0);
  const isFetching = dynFetching || distFetching;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const maxG = Math.max(
    dynamics?.maxAccelerationG ?? 0,
    dynamics?.maxBrakingG ?? 0,
    dynamics?.maxCorneringG ?? 0,
  );
  const smooth = isSmooth(maxG);

  const severity = useMemo(
    () =>
      deriveSeverity(
        dynamics?.avgAccelerationG ?? 0,
        dynamics?.avgBrakingG ?? 0,
      ),
    [dynamics?.avgAccelerationG, dynamics?.avgBrakingG],
  );

  const histogramData = useMemo<HistogramBar[]>(() => {
    const values = distData?.values ?? [];
    if (values.length === 0) {
      return [];
    }
    const step = G_MAX / values.length;
    return values.map((count, i) => ({
      range: `${fmtNumber(i * step, 2)}`,
      count: count ?? 0,
    }));
  }, [distData]);

  // Compact layout: large number + badge
  if (isCompact) {
    return (
      <WidgetShell
        error={dynError ? String(dynError) : null}
        isError={dynIsError}
        isFetching={isFetching}
        isStale={dynStale}
        loading={isLoading}
        onRefresh={() => dynRefetch()}
        updatedAt={updatedAt}>
        {dynamics ? (
          <View style={styles.compact}>
            <AppText style={styles.compactValue}>{fmtNumber(maxG, 2)}</AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.drivingDynamics.maxG', 'Max g')}
            </AppText>
            <WidgetBadge variant={smooth ? 'success' : 'warning'}>
              {smooth
                ? t('widget.drivingDynamics.smooth', 'Smooth')
                : t('widget.drivingDynamics.aggressive', 'Aggressive')}
            </WidgetBadge>
          </View>
        ) : (
          <WidgetEmptyState
            dense
            icon={<GaugeGlyph size={20} />}
            message={t('widget.drivingDynamics.noData', 'No dynamics data')}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard + Wide layout
  return (
    <WidgetShell
      error={dynError ? String(dynError) : null}
      icon={<GaugeGlyph accent size={14} />}
      isError={dynIsError}
      isFetching={isFetching}
      isStale={dynStale}
      loading={isLoading}
      onRefresh={() => dynRefetch()}
      title={t('widget.drivingDynamics.title', 'Driving Dynamics')}
      updatedAt={updatedAt}>
      {dynamics ? (
        <View style={styles.content}>
          {/* 3 RadialGauges */}
          <View style={styles.gaugeRow}>
            <View style={styles.gaugeItem}>
              <RadialGauge
                color={gaugeColor(dynamics.avgAccelerationG ?? 0)}
                label={fmtNumber(dynamics.avgAccelerationG ?? 0, 2)}
                max={G_MAX}
                size={80}
                value={dynamics.avgAccelerationG ?? 0}
              />
              <AppText style={styles.gaugeCaption}>
                {t('widget.drivingDynamics.accel', 'Accel')}
              </AppText>
            </View>
            <View style={styles.gaugeItem}>
              <RadialGauge
                color={gaugeColor(dynamics.avgBrakingG ?? 0)}
                label={fmtNumber(dynamics.avgBrakingG ?? 0, 2)}
                max={G_MAX}
                size={80}
                value={dynamics.avgBrakingG ?? 0}
              />
              <AppText style={styles.gaugeCaption}>
                {t('widget.drivingDynamics.brake', 'Brake')}
              </AppText>
            </View>
            <View style={styles.gaugeItem}>
              <RadialGauge
                color={gaugeColor(dynamics.maxCorneringG ?? 0)}
                label={fmtNumber(dynamics.maxCorneringG ?? 0, 2)}
                max={G_MAX}
                size={80}
                value={dynamics.maxCorneringG ?? 0}
              />
              <AppText style={styles.gaugeCaption}>
                {t('widget.drivingDynamics.lateral', 'Lateral')}
              </AppText>
            </View>
          </View>

          {/* Severity label */}
          <View style={styles.badgeRow}>
            <WidgetBadge
              textColor={SEVERITY_COLORS[severity]}
              variant={
                severity === 'calm' || severity === 'normal'
                  ? 'success'
                  : 'warning'
              }>
              {t(
                `widget.drivingDynamics.severity.${severity}`,
                severity.charAt(0).toUpperCase() + severity.slice(1),
              )}
            </WidgetBadge>
          </View>

          {/* Wide: acceleration distribution histogram */}
          {isWide && histogramData.length > 0 ? (
            <AccelerationHistogram
              bars={histogramData}
              seriesColor={CHART_SERIES_PRIMARY}
              title={t(
                'widget.drivingDynamics.distribution',
                'G-Force Distribution',
              )}
            />
          ) : null}
        </View>
      ) : (
        <WidgetEmptyState
          icon={<GaugeGlyph size={20} />}
          message={t('widget.drivingDynamics.noData', 'No dynamics data')}
        />
      )}
    </WidgetShell>
  );
}

DrivingDynamicsWidget.displayName = 'DrivingDynamicsWidget';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    textAlign: 'center',
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compact: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
  content: {
    gap: spacing.md,
  },
  emptyMessage: {
    fontSize: 14,
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  emptyStateDense: {
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  gaugeCaption: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
  },
  gaugeItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  gaugeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-around',
  },
  glyph: {
    lineHeight: 20,
  },
  glyphAccent: {
    color: colors.accent,
  },
  glyphMuted: {
    color: colors.textMuted,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  histogram: {
    gap: spacing.xs,
  },
  histogramBody: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.xs,
    height: 120,
  },
  histogramColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'flex-end',
  },
  histogramFill: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    width: '100%',
  },
  histogramTick: {
    fontSize: 9,
    textAlign: 'center',
  },
  histogramTitle: {
    fontSize: 10,
  },
  histogramTrack: {
    flex: 1,
    justifyContent: 'flex-end',
    width: '100%',
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
