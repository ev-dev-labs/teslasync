// Native parity port of web/src/features/dashboard/widgets/LiveSignalSparklinesWidget.tsx.
//
// Dashboard widget that resolves a vehicle's configured signal list (config
// override ∩ available signals, falling back to DEFAULT_SIGNALS, capped at 6),
// polls the live signal snapshot (/signals/{id}/live) for current values, and
// renders one row per signal inside a widget shell. Each row pulls a 1-hour
// history (/signals/{id}/{signal}/history?hours=1), draws a trend sparkline of
// the numeric points, shows the live value, and computes an up/down/flat trend
// by comparing the first-quarter average to the last-quarter average. When a
// signal has <2 numeric points a "no data" placeholder replaces the sparkline.
// Wide layouts (cols>=3) use a fatter sparkline and a 2-column grid once more
// than 3 signals are configured.
//
// The web file pulls in browser-only or web-UI dependencies that are absent
// from the native parity manifest (contract rules 4, 5 & 7); each is replaced
// with a React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L56, L120) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.*','<English>') call keeps its English default + translation-key
//     intent (the established AlertFeed/ChargeHistory/ChargingTelemetry port
//     pattern). The 'dashboard' namespace is irrelevant to the shim.
//   - lucide-react Activity / TrendingUp / TrendingDown / Minus (web L3) -> SVG
//     glyphs have no native renderer. Activity (title + empty-state icon) maps to
//     the shared native SemanticIcon name 'activity'; its web text-neon-cyan tint
//     collapses to that icon's intrinsic accent tone (same tint->semantic-tone
//     collapse used by sibling ports). The trend icons are dynamically coloured
//     (#10b981 up / #ef4444 down / #6b7280 flat) which SemanticIcon's fixed
//     intrinsic tones cannot express, so the up/down/flat trend renders as a
//     colour-exact AppText arrow glyph (↑ / ↓ / —) — the same dynamic-colour
//     trend-indicator approach the ChargingTelemetry port uses for its stat
//     trends, preserving both the direction and the exact web colours.
//   - `@/components/charts` Sparkline + NEON_COLORS (web L4, L9) -> the ported
//     native charts barrel Sparkline (RN line/area segments, no Recharts/SVG;
//     same data/color/width/height props) and the same NEON_COLORS palette
//     (both web and native re-export CHART_COLORS_NEON from lib/colors, so the
//     cyan/purple/amber indices are identical).
//   - `@/components/feedback` EmptyState (web L5, L161-165) -> inlined
//     NoSignalsEmpty: a centred icon + muted message (the shared native
//     EmptyState requires a title and takes no icon, so it is inlined like the
//     ChargingTelemetry port). The web no-action comment is preserved.
//   - `@/api/hooks/useVehicles` useVehicles (web L6) and
//     `@/api/hooks/useTelemetry` useSignals / useSignalGaps / useSignalHistory
//     (web L7) -> the ported native hooks (same '/vehicles', '/signals/{id}/
//     available', '/signals/{id}/live' and '/signals/{id}/{signal}/history?hours='
//     queries, same UseQueryResult fields, same encodeURIComponent(signal) +
//     hours=1 call). useSignalGaps returns Record<string,{value,timestamp}> so
//     liveData?.[signal]?.value is read verbatim.
//   - `@/lib/numberFormat` fmtNumber (web L8) -> ported inline (locale-aware
//     toLocaleString with a safeNumber guard, en-US default — matching web
//     numberFormat's pre-settings default; the one call passes an explicit
//     decimal count so the global precision is irrelevant).
//   - `./WidgetShell` WidgetShell (web L10) -> inlined native WidgetShell (the
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     AlertFeed/BackupMonitor/ChargeHistory/ChargingTelemetry widgets); the
//     unused query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size/config subset this widget reads).
//
// Behaviour, state/derived names (DEFAULT_SIGNALS, SIGNAL_COLORS,
// formatSignalName, extractNumericValue, numericPoints, currentValue,
// hasSparkline, trend, TrendIcon->trend glyph, configuredSignals, isWide,
// useTwoColumns, id), the API paths, the >=2-points sparkline gate, the
// quarter-average trend heuristic + 1%/0.1 threshold, the size.cols breakpoints,
// the 6-signal cap, and the i18n keys are all preserved. No DOM-only modules,
// HTML elements, react-i18next, lucide-react, Recharts, Leaflet, or web @/ UI
// imports remain — only react, react-native primitives, the shared native
// SemanticIcon / AppText / theme tokens, and the ported parity Sparkline /
// NEON_COLORS / useVehicles / useTelemetry / DataFreshness / QueryError.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  useSignalGaps,
  useSignalHistory,
  useSignals,
} from '../../../api/hooks/useTelemetry';
import {NEON_COLORS, Sparkline} from '../../../components/charts';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {QueryError} from '../../../components/feedback/QueryError';

const DEFAULT_SIGNALS = [
  'BatteryLevel',
  'VehicleSpeed',
  'OutsideTemp',
  'InsideTemp',
  'Odometer',
  'PackCurrent',
];

const SIGNAL_COLORS = [
  NEON_COLORS[0], // cyan
  NEON_COLORS[1], // purple
  NEON_COLORS[2], // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f43f5e', // rose
];

// Dynamic trend colours (web L82) — SemanticIcon's fixed tones cannot express
// these, so the trend glyph is coloured with the exact web hex values.
const TREND_UP_COLOR = '#10b981';
const TREND_DOWN_COLOR = '#ef4444';
const TREND_FLAT_COLOR = '#6b7280';

/** Pretty-print a PascalCase signal name as spaced words */
function formatSignalName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** Extract numeric value from a live signal entry */
function extractNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (isFinite(n)) return n;
  }
  return null;
}

// ── @/lib/numberFormat fmtNumber (ported inline) ──
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

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/components/feedback EmptyState (inlined no-signals variant) ──
function NoSignalsEmpty({message}: {message: string}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available (matches web EmptyState no-action note).
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <SemanticIcon decorative name="activity" size="md" />
      </View>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
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

interface SignalRowProps {
  vehicleId: number;
  signal: string;
  liveValue: unknown;
  color: string;
  isWide: boolean;
  isLast: boolean;
}

function SignalSparklineRow({
  vehicleId,
  signal,
  liveValue,
  color,
  isWide,
  isLast,
}: SignalRowProps) {
  const {data: history} = useSignalHistory(
    vehicleId,
    encodeURIComponent(signal),
    1,
  );
  const t = useNativeTranslation();

  const numericPoints = useMemo(() => {
    const points = history?.data ?? [];
    return points
      .map(p => p.valueNum)
      .filter((v): v is number => v != null && isFinite(v));
  }, [history]);

  const currentValue = extractNumericValue(liveValue);
  const hasSparkline = numericPoints.length >= 2;

  // Trend: compare first quarter average to last quarter average
  const trend = useMemo(() => {
    if (numericPoints.length < 4) return 'flat' as const;
    const quarter = Math.max(1, Math.floor(numericPoints.length / 4));
    const earlyAvg =
      numericPoints.slice(0, quarter).reduce((a, b) => a + b, 0) / quarter;
    const lateAvg =
      numericPoints.slice(-quarter).reduce((a, b) => a + b, 0) / quarter;
    const delta = lateAvg - earlyAvg;
    const threshold = Math.abs(earlyAvg) * 0.01 || 0.1;
    if (delta > threshold) return 'up' as const;
    if (delta < -threshold) return 'down' as const;
    return 'flat' as const;
  }, [numericPoints]);

  const trendGlyph = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';
  const trendColor =
    trend === 'up'
      ? TREND_UP_COLOR
      : trend === 'down'
        ? TREND_DOWN_COLOR
        : TREND_FLAT_COLOR;

  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      {/* Color indicator */}
      <View style={[styles.colorIndicator, {backgroundColor: color}]} />

      {/* Label + value */}
      <View style={styles.labelCol}>
        <AppText numberOfLines={1} style={styles.signalLabel}>
          {formatSignalName(signal)}
        </AppText>
        <AppText numberOfLines={1} style={styles.signalValue} weight="bold">
          {currentValue != null ? fmtNumber(currentValue, 1) : '—'}
        </AppText>
      </View>

      {/* Sparkline */}
      {hasSparkline ? (
        <Sparkline
          color={color}
          data={numericPoints}
          height={20}
          width={isWide ? 80 : 56}
        />
      ) : (
        <AppText style={styles.noHistory} tone="muted">
          {t('widget.noHistory', 'no data')}
        </AppText>
      )}

      {/* Trend indicator */}
      <AppText style={[styles.trend, {color: trendColor}]} weight="bold">
        {trendGlyph}
      </AppText>
    </View>
  );
}

export default function LiveSignalSparklinesWidget({
  vehicleId,
  config,
  size,
}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {data: availableSignals, isLoading: signalsLoading} = useSignals(id);
  const {
    data: liveData,
    isLoading: liveLoading,
    isFetching: liveFetching,
    isStale: liveStale,
    isError: liveError,
    dataUpdatedAt: liveUpdatedAt,
    refetch: refetchLive,
  } = useSignalGaps(id);

  const isLoading = signalsLoading || liveLoading;

  // Safely extract configured signals, intersect with available
  const configuredSignals = useMemo(() => {
    const raw = Array.isArray(config?.signals)
      ? (config.signals as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        )
      : DEFAULT_SIGNALS;

    const available = new Set(availableSignals ?? []);
    if (available.size === 0) return raw.slice(0, 6);

    const filtered = raw.filter(s => available.has(s));
    // If none of the configured signals are available, pick the first 6 available
    if (filtered.length === 0) {
      return Array.from(available).slice(0, 6);
    }
    return filtered.slice(0, 6);
  }, [config?.signals, availableSignals]);

  const isWide = size.cols >= 3;
  const useTwoColumns = size.cols >= 3 && configuredSignals.length > 3;

  return (
    <WidgetShell
      icon={<SemanticIcon decorative name="activity" size="sm" />}
      isError={liveError}
      isFetching={liveFetching}
      isStale={liveStale}
      loading={isLoading}
      onRefresh={() => refetchLive()}
      title={t('widget.liveSparklines', 'Live Signal Sparklines')}
      updatedAt={liveUpdatedAt}>
      {configuredSignals.length === 0 ? (
        <NoSignalsEmpty
          message={t('widget.noSignalsAvailable', 'No signals available')}
        />
      ) : (
        <View style={useTwoColumns ? styles.gridTwoCol : undefined}>
          {configuredSignals.map((signal, i) =>
            useTwoColumns ? (
              <View key={signal} style={styles.gridCell}>
                <SignalSparklineRow
                  color={SIGNAL_COLORS[i % SIGNAL_COLORS.length]}
                  isLast={i === configuredSignals.length - 1}
                  isWide={isWide}
                  liveValue={liveData?.[signal]?.value}
                  signal={signal}
                  vehicleId={id}
                />
              </View>
            ) : (
              <SignalSparklineRow
                key={signal}
                color={SIGNAL_COLORS[i % SIGNAL_COLORS.length]}
                isLast={i === configuredSignals.length - 1}
                isWide={isWide}
                liveValue={liveData?.[signal]?.value}
                signal={signal}
                vehicleId={id}
              />
            ),
          )}
        </View>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  colorIndicator: {
    borderRadius: 999,
    flexShrink: 0,
    height: 24,
    width: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
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
  gridCell: {
    width: '48%',
  },
  gridTwoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  labelCol: {
    flex: 1,
    minWidth: 0,
  },
  noHistory: {
    fontSize: 9,
    textAlign: 'center',
    width: 56,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
  },
  rowLast: {
    borderBottomWidth: 0,
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
  signalLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 13,
  },
  signalValue: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 15,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
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
  trend: {
    flexShrink: 0,
    fontSize: 12,
    textAlign: 'center',
    width: 14,
  },
});
