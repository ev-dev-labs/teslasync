// Native parity port of
// web/src/features/dashboard/widgets/OdometerCounterWidget.tsx.
//
// A dashboard widget that surfaces a vehicle's odometer. In the compact
// (1x1) layout it is a title-less shell with a centred big cyan odometer
// number over a small muted unit label. In the standard / wide layouts the
// shell gets the "Odometer" title + gauge icon and the body shows a centred
// "Total Odometer" caption over the big odometer reading (with the unit as a
// suffix); the wide (>=2 col) layout additionally renders a 2-column grid of
// two metric cards — "Total Driven" (green) and "Unit" (amber). When the API
// returns no odometer, both layouts fall back to an EmptyState inside the
// shell (the section is never hidden).
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established dashboard idiom (ChargingOptimizerWidget /
// BatteryHealthAnalyticsWidget / DriveEfficiencyChartWidget / EnergyFlowWidget)
// — every such dependency is reproduced inline with React Native primitives +
// the shared native building blocks and documented in the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block;
//     error -> a centred error box with a retry Pressable (mirrors the web
//     <QueryError>); otherwise either a titled header (icon + uppercase muted
//     title + freshness chip) over the children, or — when title-less (the
//     compact branch) — the children with the freshness chip overlaid
//     top-right, exactly like the web shell. Only the props this widget passes
//     (title, icon, loading, updatedAt, isFetching, isStale, isError,
//     onRefresh) are honoured; help/widgetId/PinButton/HelpTooltip/error extras
//     are out of scope (this widget never passes an `error`).
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip the shell renders — is reproduced inline as `WidgetFreshness`:
//     same isError>fetching>stale>fresh precedence, the same dot colour tiers,
//     the "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, a 30s re-render tick, and onRefresh wired to a Pressable.
//   - @/components/data-display AnimatedNumber -> inline `AnimatedNumber`. The
//     web component ease-out-quad count-ups display 0 -> value over 1s via
//     requestAnimationFrame; following the EnergyFlowWidget idiom (same widget
//     directory) the native chip renders the final rest-state value
//     immediately (fmtNumber(value, decimals) + prefix/suffix), which is
//     visually identical at rest and keeps the odometer value synchronously
//     assertable in the parity test. The tabular-nums + bold + cyan styling is
//     preserved.
//   - @/components/data-display MetricCard -> inline compact `MetricCard`
//     mirroring the web small card (label + bold value + a colour-tinted icon
//     box). The web neonColorMap green/amber tints are reproduced (green ->
//     emerald icon on a green-tinted box, amber -> amber icon on an
//     amber-tinted box); the lucide TrendingUp / Calendar icons become
//     representative glyphs.
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`; the web Gauge `icon` + `className` have no
//     native EmptyState slot and are dropped — the gauge signal is preserved by
//     the shell header glyph in the non-compact layouts).
//   - lucide-react Gauge / TrendingUp / Calendar have no native icon font; each
//     is reduced to a representative glyph while the meaningful signal — the
//     web colour — is preserved: Gauge -> '\u25F4' (neon cyan, colors.accent),
//     TrendingUp -> '\u2197' (emerald-300 #6ee7b7), Calendar -> '\u25A6'
//     (amber-300 #fcd34d).
//   - @/lib/numberFormat fmtNumber is inlined (safeNumber guard, en-US
//     grouping; web global precision defaults to 2 but every call here passes
//     an explicit precision, so the unconfigured default is irrelevant).
//   - @/hooks/useUnits -> inline `useUnits` deriving `unitPrefs.distance` from
//     the native useSettings exactly as web useUnits' deriveDistance does
//     (unit_of_length === 'mi' -> 'mi' else 'km'). This widget only reads
//     `unitPrefs.distance`, so the mirror exposes just that pref.
//   - @/lib/unitConversion convertDistanceFromSI -> inlined verbatim (km =
//     m/1000, mi = m/1609.344, ft = m/0.3048) with the NIST metre constants.
//   - './types' WidgetProps -> local `WidgetProps`/`WidgetSize` (vehicleId +
//     size.cols/size.rows read here).
//   - react-i18next useTranslation('dashboard') -> a module-level English-
//     default `t` that keeps every widget.odometer.* / freshness.* key + the
//     {{var}} interpolation intact.
//
// The data hooks are called unchanged: useVehicles(), useVehicleState(id), and
// useDrivingStats(idStr) via the native web-parity hooks, so the API paths
// (/vehicles, /vehicles/{id}/state, /drives/stats?vehicle_id=…), the
// snake_case fields (state.odometer, totalDistanceKm), and refetch semantics
// are preserved. State names (vehicles, id, idStr, stateData, stateLoading,
// isFetching, isStale, isError, dataUpdatedAt, refetch, stats, statsLoading,
// unitPrefs, toDistanceDisplay, distanceUnit, isCompact, isWide, odometer,
// totalDistanceKm, convertedOdometer, convertedTotalDriven, isLoading) are
// preserved. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useDrivingStats} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.odometer.* / freshness.* key verbatim and applying
// the same {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. Every call here passes an
// explicit precision (0), so the not-yet-wired global precision is irrelevant.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

interface UnitPrefs {
  distance: DistanceUnitPref;
}

// NIST metre constants (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// Mirrors web useUnits: derive the distance preference from useSettings exactly
// as web's deriveDistance does (unit_of_length === 'mi' -> 'mi' else 'km').
// This widget only reads `unitPrefs.distance`, so the mirror exposes just that.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({unitPrefs: {distance}}), [distance]);
}

/* ─── AnimatedNumber (web @/components/data-display, rest-state) ───────────── */

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

// web AnimatedNumber ease-out-quad count-ups 0 -> value over 1s via
// requestAnimationFrame. Following the EnergyFlowWidget idiom (same directory),
// the native chip renders the final rest-state value immediately (visually
// identical at rest) so the odometer value stays synchronously assertable.
function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
  style,
  testID,
}: AnimatedNumberProps): React.ReactElement {
  return (
    <AppText style={style} weight="bold" numberOfLines={1} testID={testID}>
      {prefix}
      {fmtNumber(value, decimals)}
      {suffix}
    </AppText>
  );
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="odometer-counter-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="odometer-counter-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

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
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="odometer-counter-loading" />;
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="odometer-counter-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="odometer-counter-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="odometer-counter-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="odometer-counter-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── Glyphs (web header/metric lucide Gauge / TrendingUp / Calendar) ──────── */

function GaugeGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.gaugeGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.gaugeGlyphText}>
        {'\u25F4'}
      </AppText>
    </View>
  );
}

/* ─── MetricCard (web @/components/data-display MetricCard, compact) ───────── */

type MetricColor = 'green' | 'amber';

// web neonColorMap green/amber tints (icon colour + tinted icon box).
const METRIC_TINTS: Record<MetricColor, {icon: string; box: string}> = {
  green: {icon: '#6ee7b7', box: 'rgba(16, 185, 129, 0.1)'},
  amber: {icon: '#fcd34d', box: 'rgba(245, 158, 11, 0.1)'},
};

function MetricCard({
  label,
  value,
  glyph,
  color,
  testID,
}: {
  label: string;
  value: string;
  glyph: string;
  color: MetricColor;
  testID?: string;
}) {
  const tint = METRIC_TINTS[color];
  return (
    <View style={styles.metricCard} testID={testID}>
      <View style={styles.metricBody}>
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.metricLabel}>
          {label}
        </AppText>
        <AppText weight="bold" numberOfLines={1} style={styles.metricValue}>
          {value}
        </AppText>
      </View>
      <View style={[styles.metricIconBox, {backgroundColor: tint.box}]}>
        <AppText
          variant="caption"
          weight="bold"
          accessibilityElementsHidden
          style={[styles.metricGlyph, {color: tint.icon}]}>
          {glyph}
        </AppText>
      </View>
    </View>
  );
}

/* ─── CompactView (web .../OdometerCounterWidget CompactView) ──────────────── */

function CompactView({odometer, unit}: {odometer: number; unit: string}) {
  return (
    <View style={styles.compactView} testID="odometer-counter-compact">
      <AnimatedNumber
        value={odometer}
        decimals={0}
        style={styles.compactValue}
        testID="odometer-counter-value"
      />
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.unitLabel}>
        {unit}
      </AppText>
    </View>
  );
}

/* ─── ExpandedView (web .../OdometerCounterWidget ExpandedView) ────────────── */

function ExpandedView({
  odometer,
  totalDriven,
  unit,
  isWide,
}: {
  odometer: number;
  totalDriven: number | null;
  unit: string;
  isWide: boolean;
}) {
  return (
    <View style={styles.expandedView} testID="odometer-counter-expanded">
      {/* Primary odometer reading */}
      <View style={styles.expandedPrimary}>
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.expandedCaption}>
          {t('widget.odometer.total', 'Total Odometer')}
        </AppText>
        <AnimatedNumber
          value={odometer}
          decimals={0}
          suffix={` ${unit}`}
          style={styles.expandedValue}
          testID="odometer-counter-value"
        />
      </View>

      {/* Breakdown metrics — only when wide */}
      {isWide && (
        <View style={styles.metricGrid}>
          <MetricCard
            label={t('widget.odometer.totalDriven', 'Total Driven')}
            value={
              totalDriven != null
                ? `${fmtNumber(totalDriven, 0)} ${unit}`
                : '\u2014'
            }
            glyph={'\u2197'}
            color="green"
            testID="odometer-counter-metric-total-driven"
          />
          <MetricCard
            label={t('widget.odometer.unit', 'Unit')}
            value={unit}
            glyph={'\u25A6'}
            color="amber"
            testID="odometer-counter-metric-unit"
          />
        </View>
      )}
    </View>
  );
}

/* ─── OdometerCounterWidget (web default export) ───────────────────────────── */

export default function OdometerCounterWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const idStr = id > 0 ? String(id) : undefined;

  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  const {data: stats, isLoading: statsLoading} = useDrivingStats(idStr);
  const {unitPrefs} = useUnits();
  // web defines `toDistanceDisplay` as a per-render closure; native wraps it in
  // useCallback (the react-hooks/exhaustive-deps-recommended fix) over the only
  // value it reads — unitPrefs.distance. The converted output is identical; the
  // only effect is reference stability, which makes the useMemos below recompute
  // exactly when the odometer/distance inputs change (same displayed value).
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isWide = size.cols >= 2;

  // web `stateData?.state?.odometer`. The native hook types `state` as
  // VehicleState|string|null, so it is narrowed to the object form before the
  // field read; on this path the API only ever yields a VehicleState object or
  // undefined, so the behaviour matches the web `any`-typed access.
  const rawState = stateData?.state;
  const odometer =
    rawState != null && typeof rawState === 'object'
      ? rawState.odometer ?? null
      : null;
  const totalDistanceKm = stats?.totalDistanceKm ?? null;

  const convertedOdometer = useMemo(
    () => (odometer != null ? toDistanceDisplay(odometer) : null),
    [odometer, toDistanceDisplay],
  );
  const convertedTotalDriven = useMemo(
    () => (totalDistanceKm != null ? toDistanceDisplay(totalDistanceKm) : null),
    [totalDistanceKm, toDistanceDisplay],
  );

  const isLoading = stateLoading || statsLoading;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.odometer.title', 'Odometer')}
      icon={isCompact ? undefined : <GaugeGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {convertedOdometer != null ? (
        isCompact ? (
          <CompactView odometer={convertedOdometer} unit={distanceUnit} />
        ) : (
          <ExpandedView
            odometer={convertedOdometer}
            totalDriven={convertedTotalDriven}
            unit={distanceUnit}
            isWide={isWide}
          />
        )
      ) : (
        <EmptyState
          title={t('widget.odometer.noData', 'No odometer data')}
          message=""
        />
      )}
    </WidgetShell>
  );
}

OdometerCounterWidget.displayName = 'OdometerCounterWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  gaugeGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeGlyphText: {
    color: colors.accent,
  },
  compactView: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 4,
  },
  compactValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: '#67e8f9',
    fontVariant: ['tabular-nums'],
  },
  unitLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  expandedView: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    rowGap: spacing.md,
  },
  expandedPrimary: {
    alignItems: 'center',
  },
  expandedCaption: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  expandedValue: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: '#67e8f9',
    fontVariant: ['tabular-nums'],
  },
  metricGrid: {
    flexDirection: 'row',
    columnGap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    padding: spacing.md,
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
    rowGap: 4,
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 20,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  metricIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    padding: 6,
  },
  metricGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
});
