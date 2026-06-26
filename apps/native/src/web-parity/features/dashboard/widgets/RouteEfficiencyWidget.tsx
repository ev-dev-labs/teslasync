// Native parity port of web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx.
//
// The web widget is the dashboard "Route Efficiency" tile. It resolves a vehicle
// id (`vehicleId` prop, else the first vehicle from `useVehicles()`), reads route
// aggregates via `useRouteEfficiency(vehicleIdStr)` (GET
// /api/v1/analytics/route-efficiency — preserved verbatim by the already-ported
// native useDriving hook), and renders, inside a `WidgetShell`, a `WidgetRankedList`
// of the most efficient routes (or a `Route`-iconed empty state). It has two
// layouts driven by `size.cols`:
//   - Compact (cols <= 1): a title-less shell wrapping a min-h-44 column; the
//     ranked list renders in `compact` mode (top 3, no bars) and the empty state
//     uses py-2.
//   - Standard / Wide (cols >= 3): a titled "Route Efficiency" shell; the ranked
//     list renders the top 5 with bars, the empty state uses py-4, and in the wide
//     case each row label is appended with "best X / worst Y {unit}".
//
// Every state name (`vehicles`, `vid`, `vehicleIdStr`, `data`, `isLoading`,
// `error`, `isFetching`, `isStale`, `isError`, `dataUpdatedAt`, `refetch`,
// `unitPrefs`, `toEfficiencyDisplay`, `efficiencyUnit`, `isCompact`, `isWide`,
// `routes`, `items`, `shellProps`), the `vehicleId ?? vehicles?.[0]?.id`
// resolution, the `size.cols <= 1` / `>= 3` thresholds, the `efficiencyBadge`
// thresholds (<=250 Excellent, <=325 Good, <=400 Fair, else Poor — note the web's
// `rawWhPerMi` parameter name is preserved verbatim even though it is fed Wh/km),
// the `items` useMemo + its exact dependency array, the `bestRaw = Math.min(...)`
// floor, the `isBest` / barColor (`bg-emerald-400` vs `bg-blue-400`) logic, the
// inverted `value: 10000 / eff` ranking, the `formattedValue` template, the
// SI->display efficiency conversion at the render boundary, and the
// `widget.routeEfficiency.*` i18n keys with their English fallbacks are preserved.
// Browser-only pieces are mapped to native-safe equivalents (documented in the
// parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as APIUsageWidget / RangeBarWidget),
//     so every key + copy is preserved.
//   - lucide-react `Route` has no native icon dependency; per the RangeBarWidget /
//     MQTTStatusWidget glyph precedent it becomes a decorative Unicode arrow glyph
//     ('\u279C') in an `AppText` with importantForAccessibility='no' (the shell
//     title / empty-state message carries the accessible meaning). The title
//     icon's `h-3.5 w-3.5` (14px) text-emerald-400 maps to fontSize 14 + the
//     success token (#34d399 === emerald-400); the empty/list `h-5 w-5` (20px)
//     maps to fontSize 20 muted.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` -> an inlined `useUnits()` shim
//     returning the out-of-box `{distance: 'km'}` preference (the API already
//     returns SI; conversion happens at the display boundary). `toEfficiencyDisplay`
//     mirrors the web's `whPerKm * 1.609344` (Wh/km -> Wh/mi) branch.
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` are inlined as native-safe
//     formatters mirroring the web module (locale-aware toLocaleString,
//     precision-2 / en-US out-of-box defaults).
//   - `./WidgetShell` (web: a transparent flex container whose card chrome comes
//     from the dashboard grid cell, with Skeleton loading + QueryError error + a
//     DataFreshness header affordance) is inlined on a `GlassPanel` (so the tile is
//     styled standalone): loading -> centered Spinner, error -> centered danger
//     text, otherwise an optional uppercase title row + a compact freshness control
//     (status dot + refresh Pressable) over children.
//   - `./shared` `WidgetRankedList` (web: a sorted/sliced <ul> of rows with a rank
//     number, truncating label, `Badge`, formatted value, and an absolute opacity
//     background bar) is inlined here: the sort/slice/maxValue useMemos, the
//     compact -> top-3-no-bars policy, and the bar-percentage math are preserved;
//     the web `overflow-y-auto` collapses to a non-scrolling View (<=5 short rows),
//     `truncate` -> numberOfLines={1}, and the `Badge` becomes an inlined chip.
//   - `@/components/ui` `Badge` (variant success/warning/danger/neutral, size sm)
//     -> an inlined `RankedBadge` chip; the web badgeVariantMap (error -> danger)
//     and the dark-theme variant palette map to the success/warning/danger/neutral
//     theme surface+text tokens.
//   - `@/components/feedback` `EmptyState` (icon + message, web role="status") is
//     inlined as `WidgetEmptyState` (centered View + glyph icon + muted message,
//     accessibilityLiveRegion='polite'); the className="py-2"/"py-4"/"py-8"
//     paddings map to the `paddingVertical` override (8 / 16 / 32).
//   - `./types` `WidgetProps` -> a local interface mirroring it (WidgetSize
//     {cols, rows}); `./types` is not yet ported.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View, type DimensionValue} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useRouteEfficiency} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

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

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi';

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
}

// The native parity layer has no settings store wired in here, so the hook
// mirrors the web out-of-box default: distance 'km'. The API already returns SI;
// conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance: 'km'}}), []);
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

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

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_ROUTE = '\u279C'; // lucide Route -> heavy round-tipped rightwards arrow
const GLYPH_REFRESH = '\u21BB';

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

/* ─── inlined WidgetShell (web ./WidgetShell.tsx) ───────────────────────────── */

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
  icon,
  message,
  paddingVertical,
}: {
  icon?: ReactNode;
  message: string;
  paddingVertical?: number;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.emptyState,
        paddingVertical != null ? {paddingVertical} : null,
      ]}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined RankedItem + WidgetRankedList (web ./shared) ──────────────────── */

type RankedBadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

export interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: {text: string; variant: RankedBadgeVariant};
  barColor?: string;
}

interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

// Web Badge dark-theme variants mapped to theme surface+text tokens. The web
// badgeVariantMap routes `error` -> the Badge `danger` variant; that hop is
// folded into this lookup.
const BADGE_STYLE: Record<RankedBadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  error: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textSecondary},
};

// RankedItem.barColor is set by the widget as a Tailwind class string; resolve
// it to a literal hex for the native fill (web emerald-400 / blue-400).
const BAR_COLOR: Record<string, string> = {
  'bg-emerald-400': '#34d399',
  'bg-blue-400': '#60a5fa',
};
const BAR_COLOR_DEFAULT = '#60a5fa'; // web default bg-blue-400

function RankedBadge({
  text,
  variant,
}: {
  text: string;
  variant: RankedBadgeVariant;
}) {
  const palette = BADGE_STYLE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      <AppText style={[styles.badgeText, {color: palette.fg}]}>{text}</AppText>
    </View>
  );
}

function WidgetRankedList({
  items,
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
}: WidgetRankedListProps) {
  const limit = maxItems ?? (compact ? 3 : 5);
  const hideBars = compact || !showBars;

  const visible = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.slice(0, limit);
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return (
      <WidgetEmptyState
        icon={emptyIcon}
        message={emptyMessage}
        paddingVertical={32}
      />
    );
  }

  return (
    <View style={styles.list}>
      {visible.map((item, index) => {
        const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const barColor =
          (item.barColor && BAR_COLOR[item.barColor]) ?? BAR_COLOR_DEFAULT;

        return (
          <View key={item.id} style={styles.row}>
            {!hideBars ? (
              <View
                style={[
                  styles.rowBar,
                  {
                    backgroundColor: barColor,
                    width: `${barPct}%` as DimensionValue,
                  },
                ]}
              />
            ) : null}

            <View style={styles.rowContent}>
              <AppText style={styles.rank} tone="muted">
                {index + 1}
              </AppText>

              <AppText numberOfLines={1} style={styles.label}>
                {item.label}
              </AppText>

              {item.badge ? (
                <RankedBadge
                  text={item.badge.text}
                  variant={item.badge.variant}
                />
              ) : null}

              <AppText style={styles.value}>{item.formattedValue}</AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ─── efficiency badge (web efficiencyBadge) ───────────────────────────────── */

function efficiencyBadge(
  rawWhPerMi: number,
  t: NativeTFunction,
): RankedItem['badge'] {
  if (rawWhPerMi <= 250) {
    return {
      text: t('widget.routeEfficiency.excellent', 'Excellent'),
      variant: 'success',
    };
  }
  if (rawWhPerMi <= 325) {
    return {
      text: t('widget.routeEfficiency.good', 'Good'),
      variant: 'success',
    };
  }
  if (rawWhPerMi <= 400) {
    return {
      text: t('widget.routeEfficiency.fair', 'Fair'),
      variant: 'warning',
    };
  }
  return {
    text: t('widget.routeEfficiency.poor', 'Poor'),
    variant: 'error',
  };
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function RouteEfficiencyWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useRouteEfficiency(vehicleIdStr);

  const {unitPrefs} = useUnits();
  // Web defines `toEfficiencyDisplay` inline (recreated each render); native
  // react-hooks/exhaustive-deps requires a stable reference for the `items`
  // useMemo dep array, so it is wrapped in useCallback — same Wh/km->display math.
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs],
  );

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Web reads `data?.routes ?? []` inline; native exhaustive-deps requires the
  // array initialization to be memoized so the `items` useMemo dep stays stable.
  const routes = useMemo(() => data?.routes ?? [], [data?.routes]);

  const items: RankedItem[] = useMemo(() => {
    const bestRaw =
      routes.length > 0
        ? Math.min(...routes.map(r => r.avgEfficiency ?? Infinity))
        : Infinity;

    return routes.map((r, i) => {
      const rawEff = r.avgEfficiency ?? 0;
      const eff = toEfficiencyDisplay(rawEff);
      const trips = r.tripCount ?? 0;
      const isBest = rawEff === bestRaw && rawEff > 0;

      let label = `${r.startLocation ?? '—'} → ${r.endLocation ?? '—'}`;
      if (isWide) {
        const bestEff = fmtNumber(toEfficiencyDisplay(r.bestEfficiency ?? 0), 0);
        const worstEff = fmtNumber(
          toEfficiencyDisplay(r.worstEfficiency ?? 0),
          0,
        );
        label += `  ·  ${t('widget.routeEfficiency.best', 'best')} ${bestEff} / ${t('widget.routeEfficiency.worst', 'worst')} ${worstEff} ${efficiencyUnit}`;
      }

      return {
        id: i,
        label,
        // Invert: lower Wh/unit (better) → higher value → ranks first
        value: eff > 0 ? 10000 / eff : 0,
        formattedValue: `${fmtNumber(eff, 0)} ${efficiencyUnit} · ${fmtInt(trips)}×`,
        badge: efficiencyBadge(rawEff, t),
        barColor: isBest ? 'bg-emerald-400' : 'bg-blue-400',
      };
    });
  }, [routes, toEfficiencyDisplay, efficiencyUnit, isWide, t]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <View style={styles.compactWrap}>
          {routes.length > 0 ? (
            <WidgetRankedList
              compact
              emptyIcon={
                <AppText
                  importantForAccessibility="no"
                  style={styles.emptyIconGlyph}>
                  {ICON_ROUTE}
                </AppText>
              }
              emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
              items={items}
            />
          ) : (
            <WidgetEmptyState
              icon={
                <AppText
                  importantForAccessibility="no"
                  style={styles.emptyIconGlyph}>
                  {ICON_ROUTE}
                </AppText>
              }
              message={t('widget.routeEfficiency.noData', 'No route data')}
              paddingVertical={8}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.routeEfficiency.title', 'Route Efficiency')}
      icon={
        <AppText importantForAccessibility="no" style={styles.titleIconGlyph}>
          {ICON_ROUTE}
        </AppText>
      }
      {...shellProps}>
      {routes.length > 0 ? (
        <WidgetRankedList
          emptyIcon={
            <AppText
              importantForAccessibility="no"
              style={styles.emptyIconGlyph}>
              {ICON_ROUTE}
            </AppText>
          }
          emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
          items={items}
        />
      ) : (
        <WidgetEmptyState
          icon={
            <AppText
              importantForAccessibility="no"
              style={styles.emptyIconGlyph}>
              {ICON_ROUTE}
            </AppText>
          }
          message={t('widget.routeEfficiency.noData', 'No route data')}
          paddingVertical={16}
        />
      )}
    </WidgetShell>
  );
}

RouteEfficiencyWidget.displayName = 'RouteEfficiencyWidget';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compactWrap: {
    flexDirection: 'column',
    minHeight: 44,
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    marginBottom: spacing.sm,
    textAlign: 'center',
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
  label: {
    flex: 1,
    fontSize: 14,
  },
  list: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  rank: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    width: 20,
  },
  row: {
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  rowBar: {
    borderRadius: 8,
    bottom: 0,
    left: 0,
    opacity: 0.15,
    position: 'absolute',
    top: 0,
  },
  rowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    position: 'relative',
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  titleIconGlyph: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
