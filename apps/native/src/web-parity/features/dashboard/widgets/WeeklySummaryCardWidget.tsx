// WeeklySummaryCardWidget — native parity port of
// web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx.
//
// The dashboard "Weekly Summary" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// that vehicle's weekly digest (`GET /vehicles/{id}/weekly-digest` via
// useWeeklyDigest, keyed on String(id)). It derives a `metrics` bag (distance,
// energy, cost, efficiency + their previous-period peers, plus drives/prevDrives)
// and renders one of three size-driven layouts, preserved verbatim from the web
// source:
//   1. isCompact (cols <= 1 && rows <= 1) -> a centered big distance number over a
//      "{unit} this week" caption, or an EmptyState when there is no digest.
//   2. otherwise -> a titled shell over a 2-col (or 4-col when isWide) grid of
//      StatCards: Distance + Energy always; Cost + Efficiency when (isWide ||
//      isTall). When neither wide nor tall, a footer row of two InlineMetrics
//      (Cost, Efficiency) is appended.
//   3. no metrics -> an EmptyState (TrendingUp glyph + "No weekly data").
// Every state name (vehicles, id, data/isLoading/error/isFetching/isStale/isError/
// dataUpdatedAt/refetch, unitPrefs, toDistanceDisplay, distanceUnit,
// efficiencyUnit, toEfficiencyDisplay, formatCurrency, metrics, isCompact, isWide,
// isTall), the /weekly-digest API path, the km->mi / Wh/km->Wh/mi pre-scaling, the
// SI->display distance conversion, the trendOf percentage helper, the i18n key +
// English fallback for every label, and each render branch is preserved; all 166
// source lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react useMemo (web L1) -> react useMemo (unchanged); the `metrics` memo keeps
//     the identical [data, toDistanceDisplay, toEfficiencyDisplay] dependency array
//     (the two converters are recreated each render exactly like the web source, so
//     the memo recomputes per render — behaviour preserved verbatim).
//   - react-i18next useTranslation('dashboard') (web L2) -> the native
//     t(key, fallback) shim used across the parity tree (the 'dashboard' namespace
//     is accepted-and-ignored — there is no i18n runtime in RN); t keeps the exact
//     (key, fallback) => string signature.
//   - lucide-react TrendingUp/Route/Zap/DollarSign/Gauge (web L3) -> the native
//     SemanticIcon glyphs 'trendUp'/'signpost'/'bolt'/'dollarSign'/'efficiency' via
//     getSemanticIconDefinition/glyphNode (lucide is browser-only). The title +
//     compact TrendingUp is tinted with the accent token (web text-cyan-400); the
//     StatCard/InlineMetric icons + the empty-state glyph use the muted token.
//   - @/components/data-display StatCard/InlineMetric (web L4) -> inline native
//     StatCard (card chrome: label+icon header over a value+unit row over an
//     optional up/down/flat trend line) and InlineMetric (icon + value row); the
//     data-display barrel is a DOM tree and is not in the native parity manifest,
//     so they are reproduced self-contained per the ChargeStatusWidget precedent.
//   - @/components/feedback EmptyState (web L5) -> an inline native EmptyState
//     (icon chip + muted centered message).
//   - @/api/hooks useWeeklyDigest/useVehicles (web L6-7) -> imported from their
//     canonical converted native hook files (../../../api/hooks/useAnalytics,
//     ../../../api/hooks/useVehicles) — same query keys, same /weekly-digest +
//     /vehicles paths, same WeeklyDigestData camelCase fields.
//   - @/hooks/useFormatting useFormatting (web L8) -> an inline native useFormatting
//     that reads the native useSettings (../../../api/hooks/useSettings) and exposes
//     only the consumed `formatCurrency` (currency_symbol -> '$' fallback, amount
//     formatted at decimal_precision); the unused costPerKwh/formatEnergyCost/
//     costPerDistanceUnit/estimateGasCost surface is not ported (SRP-scoping the
//     consumed surface, per the ChargeStatusWidget useUnits precedent).
//   - @/hooks/useUnits useUnits (web L9) -> an inline native useUnits reading the
//     native useSettings: unit_of_length 'mi' -> 'mi' display, else 'km'
//     (deriveDistance never yields 'ft', matching the web hook). Only
//     unitPrefs.distance is consumed, exactly like the web source.
//   - @/lib/numberFormat fmtNumber/fmtPercent (web L10) -> ported inline (en-US
//     toLocaleString, default 2 fraction digits = the web global-precision default;
//     fmtPercent === `${fmtNumber(v, d)}%`; safeNumber guard). Every call here
//     passes an explicit decimals so the default never bites.
//   - @/lib/cn cn (web L11) -> dropped: RN composes layout via StyleSheet/array
//     props, so the grid-cols class toggle becomes a gridCellWide/gridCellNarrow
//     style selection.
//   - @/lib/constants UNITS (web L12) -> ported inline (KM_TO_MI 0.621371,
//     MI_TO_KM 1.60934) verbatim.
//   - ./WidgetShell (web L13) -> reproduced self-contained here: the browser-only
//     DataFreshness / PinButton / HelpTooltip / Skeleton / QueryError chrome becomes
//     a native-safe freshness pill (relative "updated" time + a refresh Pressable
//     wired to onRefresh, with stale/error/fetching markers), a dimmed skeleton box,
//     and a centered error message; the title-aware header matches the web shell's
//     title vs. title-less branches.
//   - ./types WidgetProps (web L14) -> reproduced inline (WidgetSize + WidgetProps);
//     `config` stays in the contract but, like the web source, is unread.
//   - @/lib/unitConversion convertDistanceFromSI (web L15) -> ported inline verbatim
//     (metres / 1000 km, metres / 1609.344 mi, metres / 0.3048 ft).
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports reach
// the native output — only react, react-native primitives, the canonical AppText +
// GlassPanel + SemanticIcon, the converted parity hooks, and theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useWeeklyDigest} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, is unread. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported unit conversion (web @/lib/unitConversion convertDistanceFromSI) ───

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

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

// ── Ported constants (web @/lib/constants UNITS) ──────────────────────────────

const UNITS = {
  MI_TO_KM: 1.60934,
  KM_TO_MI: 0.621371,
} as const;

// ── Ported number format (web @/lib/numberFormat fmtNumber/fmtPercent) ────────

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtPercent(v: unknown, decimals = 2): string {
  return `${fmtNumber(v, decimals)}%`;
}

// ── Inline native useUnits (web @/hooks/useUnits) — reads native useSettings ──

interface UnitPrefsLite {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const unitPrefs = React.useMemo<UnitPrefsLite>(
    () => ({distance}),
    [distance],
  );
  return {unitPrefs};
}

// ── Inline native useFormatting (web @/hooks/useFormatting) — formatCurrency ──

function useFormatting(): {
  formatCurrency: (amount: number, decimals?: number) => string;
} {
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  const formatCurrency = React.useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d)}`;
    },
    [currencySymbol, userPrecision],
  );

  return {formatCurrency};
}

// ── Trend helper (web L17-28 trendOf) ─────────────────────────────────────────

interface Trend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive?: boolean;
}

function trendOf(
  current: number,
  previous: number,
  lowerIsPositive = false,
): Trend {
  if (previous === 0) return {direction: 'flat', value: '—'};
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 1) return {direction: 'flat', value: '~0%'};
  const direction = pct > 0 ? 'up' : 'down';
  const positive = lowerIsPositive ? pct < 0 : pct > 0;
  return {direction, value: fmtPercent(Math.abs(pct), 0), positive};
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native StatCard (web @/components/data-display StatCard) ───────────

function StatCard({
  label,
  value,
  unit,
  icon,
  trend,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: Trend;
}) {
  let trendStyle: StyleProp<TextStyle> = styles.trendFlat;
  if (trend) {
    if (trend.positive) trendStyle = styles.trendPositive;
    else if (trend.direction === 'flat') trendStyle = styles.trendFlat;
    else trendStyle = styles.trendNegative;
  }
  const arrow =
    trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '—';

  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText style={styles.statLabel}>{label}</AppText>
        {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      </View>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? <AppText style={styles.statUnit}>{unit}</AppText> : null}
      </View>
      {trend ? (
        <View style={styles.trendRow}>
          <AppText style={[styles.trendText, trendStyle]}>{arrow}</AppText>
          <AppText style={[styles.trendText, trendStyle]}>{trend.value}</AppText>
        </View>
      ) : null}
    </View>
  );
}

// ── Inline native InlineMetric (web @/components/data-display InlineMetric) ────

function InlineMetric({icon, value}: {icon: ReactNode; value: string | number}) {
  return (
    <View style={styles.inlineMetric}>
      <View style={styles.inlineIcon}>{icon}</View>
      <AppText style={styles.inlineValue}>{value}</AppText>
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
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
}: {
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
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function WeeklySummaryCardWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useWeeklyDigest(String(id));
  const {unitPrefs} = useUnits();
  // Web defines these inline (recreated each render). Wrapping them in
  // useCallback keyed on unitPrefs.distance yields identical output — the
  // metrics memo below is a pure function of (data, unitPrefs.distance) — while
  // satisfying react-hooks/exhaustive-deps in the native lint config.
  const toDistanceDisplay = React.useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = React.useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );
  const {formatCurrency} = useFormatting();

  const metrics = useMemo(() => {
    if (!data) return null;

    // WeeklyDigestData stores distance in km; convert to miles for toDistanceDisplay
    const distMi = (data.distanceKm ?? 0) * UNITS.KM_TO_MI;
    const prevDistMi = (data.prevDistanceKm ?? 0) * UNITS.KM_TO_MI;

    // Efficiency in Wh/km; convert to Wh/mi for toEfficiencyDisplay
    const effWhMi = (data.efficiency ?? 0) * UNITS.MI_TO_KM;
    const prevEffWhMi = (data.prevEfficiency ?? 0) * UNITS.MI_TO_KM;

    return {
      distance: toDistanceDisplay(distMi),
      prevDistance: toDistanceDisplay(prevDistMi),
      energy: data.energyKwh ?? 0,
      prevEnergy: data.prevEnergyKwh ?? 0,
      cost: data.cost ?? 0,
      prevCost: data.prevCost ?? 0,
      efficiency: toEfficiencyDisplay(effWhMi),
      prevEfficiency: toEfficiencyDisplay(prevEffWhMi),
      drives: data.drives ?? 0,
      prevDrives: data.prevDrives ?? 0,
    };
  }, [data, toDistanceDisplay, toEfficiencyDisplay]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        {metrics ? (
          <View style={styles.compactBody}>
            <AppText style={styles.compactValue}>
              {fmtNumber(metrics.distance, 0)}
            </AppText>
            <AppText style={styles.compactLabel}>
              {`${distanceUnit} ${t(
                'widget.weeklySummary.thisWeek',
                'this week',
              )}`}
            </AppText>
          </View>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <EmptyState
            icon={glyphNode('trendUp', colors.textMuted, styles.glyphEmpty)}
            message={t('widget.weeklySummary.noData', 'No weekly data')}
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.weeklySummary.title', 'Weekly Summary')}
      icon={glyphNode('trendUp', colors.accent, styles.glyphTitle)}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {metrics ? (
        <View style={styles.contentStack}>
          <View style={styles.grid}>
            <View style={isWide ? styles.gridCellWide : styles.gridCellNarrow}>
              <StatCard
                label={t('widget.weeklySummary.distance', 'Distance')}
                value={fmtNumber(metrics.distance, 1)}
                unit={distanceUnit}
                icon={glyphNode('signpost', colors.textMuted, styles.glyphStat)}
                trend={trendOf(metrics.distance, metrics.prevDistance)}
              />
            </View>
            <View style={isWide ? styles.gridCellWide : styles.gridCellNarrow}>
              <StatCard
                label={t('widget.weeklySummary.energy', 'Energy')}
                value={fmtNumber(metrics.energy, 1)}
                unit="kWh"
                icon={glyphNode('bolt', colors.textMuted, styles.glyphStat)}
                trend={trendOf(metrics.energy, metrics.prevEnergy)}
              />
            </View>
            {isWide || isTall ? (
              <>
                <View
                  style={isWide ? styles.gridCellWide : styles.gridCellNarrow}>
                  <StatCard
                    label={t('widget.weeklySummary.cost', 'Cost')}
                    value={formatCurrency(metrics.cost)}
                    icon={glyphNode(
                      'dollarSign',
                      colors.textMuted,
                      styles.glyphStat,
                    )}
                    trend={trendOf(metrics.cost, metrics.prevCost, true)}
                  />
                </View>
                <View
                  style={isWide ? styles.gridCellWide : styles.gridCellNarrow}>
                  <StatCard
                    label={t('widget.weeklySummary.efficiency', 'Efficiency')}
                    value={fmtNumber(metrics.efficiency, 0)}
                    unit={efficiencyUnit}
                    icon={glyphNode(
                      'efficiency',
                      colors.textMuted,
                      styles.glyphStat,
                    )}
                    trend={trendOf(
                      metrics.efficiency,
                      metrics.prevEfficiency,
                      true,
                    )}
                  />
                </View>
              </>
            ) : null}
          </View>

          {!isWide && !isTall ? (
            <View style={styles.inlineRow}>
              <InlineMetric
                icon={glyphNode(
                  'dollarSign',
                  colors.textMuted,
                  styles.glyphInline,
                )}
                value={formatCurrency(metrics.cost)}
              />
              <InlineMetric
                icon={glyphNode(
                  'efficiency',
                  colors.textMuted,
                  styles.glyphInline,
                )}
                value={`${fmtNumber(metrics.efficiency, 0)} ${efficiencyUnit}`}
              />
            </View>
          ) : null}
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('trendUp', colors.textMuted, styles.glyphEmpty)}
          message={t('widget.weeklySummary.noData', 'No weekly data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  contentStack: {
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorText: {
    textAlign: 'center',
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  glyphEmpty: {
    fontSize: 16,
    letterSpacing: 0.2,
    lineHeight: 20,
    textAlign: 'center',
  },
  glyphInline: {
    fontSize: 11,
    lineHeight: 14,
  },
  glyphStat: {
    fontSize: 12,
    lineHeight: 16,
  },
  glyphTitle: {
    fontSize: 13,
    lineHeight: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  gridCellNarrow: {
    width: '48.5%',
  },
  gridCellWide: {
    width: '23.5%',
  },
  inlineIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineMetric: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  inlineValue: {
    color: colors.textMuted,
    fontSize: 12,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 13,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  statValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
  trendFlat: {
    color: colors.textMuted,
  },
  trendNegative: {
    color: colors.danger,
  },
  trendPositive: {
    color: colors.success,
  },
  trendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  trendText: {
    fontSize: 12,
  },
});
