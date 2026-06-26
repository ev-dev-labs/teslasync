// Native parity port of web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx.
//
// `LocationFavoritesWidget` is a dashboard widget that surfaces the active
// vehicle's favourite/visited locations plus a "where is it right now" badge.
// It has two layouts driven by `size.cols`:
//   - compact (cols <= 1): a big location emoji (🏠/🏢/⭐/📍) + a location Badge,
//     whose freshness chip reflects ONLY the locations query.
//   - full: a titled shell whose header shows the location emoji + Badge +
//     (optional) "→ {destination}" route hint, and whose body is a ranked list
//     of favourite locations (visit count × · last-visited relative time), or an
//     empty state when there are none.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `vid = vehicleId ?? vehicles?.[0]?.id` / `vehicleIdStr = vid != null ?
// String(vid) : undefined` vehicle resolution (L28-29), the two destructured
// query results — `useLocations(vehicleIdStr)` (L31-40) and
// `useLocationSnapshotLatest(vid ?? 0)` (L42-51) — and the combined
// `isLoading`/`error`/`isFetching`/`isStale`/`isError`/`updatedAt` derivation
// (L53-58, updatedAt = Math.max of the two dataUpdatedAt). `isCompact =
// size.cols <= 1` (L60). The module-level `locationBadge` helper (L15-23) is
// ported verbatim (the 🏠/🏢/⭐/📍 emoji + i18n label + success/neutral/neutral/
// warning variant precedence). The memoized `items: RankedItem[]` (L64-73) maps
// each location to {id, label: addressName ?? '—', value: visitCount ?? 0,
// formattedValue `${fmtInt(visitCount ?? 0)}× · ${lastVisited ?
// formatRelative(lastVisited) : '—'}`, barColor 'bg-blue-400'}. The `shellProps`
// bag (L75-83) and the compact branch's redundant loc-only freshness re-spread
// (L87-92) are kept exactly. Every i18n key + English default
// (widget.locationFavorites.title/home/work/favorite/other/noData) and every API
// field (located_at_home/work/favorite, destination_name, addressName,
// visitCount, lastVisited) is kept verbatim.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (interpolating `{{name}}`
//     placeholders from the options arg, the same shim shape used by the
//     AnomalyDetector / TemplateGallery ports; this widget passes no
//     placeholders). The namespace arg is accepted + ignored.
//   - lucide-react `MapPin` (L3) -> there is no `react-native-svg` dependency in
//     the native app, so it renders a decorative glyph stand-in via `<GlyphIcon>`
//     (the AnomalyDetector / AutomationCard glyph precedent): MapPin -> "📍". The
//     Tailwind icon colour is preserved as hex for the title icon (text-blue-400
//     #60a5fa); the colourless empty-state icons inherit the muted token,
//     matching the web `EmptyState` icon styling.
//   - `@/components/ui` `Badge` (L4) -> the converted web-parity `Badge` port
//     (variant success/warning/neutral, size="sm").
//   - `@/components/feedback` `EmptyState` (L5) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>`
//     (centred glyph + muted message, paddingVertical honoured). The web
//     "no-action transient empty state" intent is preserved.
//   - `@/lib/numberFormat` `fmtInt` (L9) -> inlined native-safe equivalent (+ its
//     `safeNumber` dep): nullish/non-finite -> 0, en-US locale, 0 fraction
//     digits (fmtInt === fmtNumber(v, 0)).
//   - `@/lib/dateFormat` `formatRelative` (L10) -> inlined native-safe
//     equivalent (+ its `formatDate` >7d fallback): nullish/Invalid Date -> '—',
//     'just now' / `${m}m ago` / `${h}h ago` / `${d}d ago`, then an absolute
//     `toLocaleDateString` (year/month/day, device locale to mirror the web's
//     browser-locale default).
//   - `./WidgetShell` `WidgetShell` (L11) -> reproduced locally as a native
//     `<WidgetShell>` (sibling module not yet ported, same self-contained
//     approach as the AnomalyDetector port): loading -> skeleton block, error ->
//     centred danger text (surfaced, never hidden), title+icon header, the
//     freshness chip via the converted web-parity `DataFreshness` port, and the
//     children body. The web pulse-on-data-change box-shadow glow is a CSS
//     affordance with no native analog and is intentionally omitted (documented
//     in the sidecar); the help-tooltip / pin-button / actions header slots are
//     unused by this widget and are not modeled.
//   - `./shared` `WidgetRankedList` + `RankedItem` (L12) -> reproduced locally as
//     a native `<WidgetRankedList>` (sibling not yet ported): the maxItems/
//     compact/showBars slice + descending value sort, the maxValue-relative
//     background bar (barColor Tailwind class -> hex, opacity 15%, percentage
//     DimensionValue width), the rank number + truncated label + optional Badge +
//     tabular-nums formattedValue row, falling back to `<LocalEmptyState>`.
//   - `./types` `WidgetProps` (L13) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary. The `truncate` ellipsis
// and `hover:bg-[var(--surface-2)]` row hover are web-only affordances mapped to
// `numberOfLines={1}` / omitted (no pointer hover on touch) and documented.

import React, { useMemo, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useLocations } from '../../../api/hooks/useLocations';
import {
  useLocationSnapshotLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg so any future interpolated key keeps working. The hook shape
// mirrors the web `const { t } = useTranslation('dashboard')` so the component
// body is unchanged.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtInt) ───────────────────────
// Locale-aware integer formatting matching the web helper: nullish/non-finite
// input coerces to 0, en-US locale, 0 fraction digits (fmtInt === fmtNumber(v,0)).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ── Inlined `@/lib/dateFormat` (formatRelative + formatDate fallback) ─────────
// Nullish / Invalid Date -> '—'. Buckets: <60s 'just now', <60m `${m}m ago`,
// <24h `${h}h ago`, <7d `${d}d ago`, else an absolute year/month/day date.
// The web fallback uses the browser locale (undefined -> device locale here).
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// ── Type reproduction (web ./shared `RankedItem`) ────────────────────────────
export interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  barColor?: string;
}

// ── lucide glyph stand-in ────────────────────────────────────────────────────
const BLUE_400 = '#60a5fa'; // text-blue-400

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
  paddingVertical = spacing.sm,
}: {
  icon?: ReactNode;
  message: string;
  paddingVertical?: number;
}) {
  // no-action: transient empty state — surfaces when source data is missing;
  // no specific recovery action available.
  return (
    <View style={[styles.emptyState, { paddingVertical }]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `WidgetRankedList` (web ./shared) ──────────────────────────────────
// Tailwind background-bar colour classes -> hex (only 'bg-blue-400' is used by
// this widget; default keeps the same blue).
const DEFAULT_BAR = BLUE_400;
const BAR_COLOR_HEX: Record<string, string> = {
  'bg-blue-400': BLUE_400,
};

const rankedBadgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
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
      <LocalEmptyState
        icon={emptyIcon}
        message={emptyMessage}
        paddingVertical={32}
      />
    );
  }

  return (
    <ScrollView
      style={styles.rankedScroll}
      contentContainerStyle={styles.rankedContent}
    >
      {visible.map((item, index) => {
        const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const barColor = BAR_COLOR_HEX[item.barColor ?? 'bg-blue-400'] ?? DEFAULT_BAR;

        return (
          <View key={item.id} style={styles.rankRow}>
            {!hideBars ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.rankBar,
                  {
                    width: `${barPct}%` as DimensionValue,
                    backgroundColor: barColor,
                  },
                ]}
              />
            ) : null}

            <View style={styles.rankRowContent}>
              <AppText tone="muted" style={styles.rankNumber}>
                {index + 1}
              </AppText>

              <AppText numberOfLines={1} style={styles.rankLabel}>
                {item.label}
              </AppText>

              {item.badge ? (
                <Badge
                  variant={rankedBadgeVariantMap[item.badge.variant] ?? 'neutral'}
                  size="sm"
                >
                  {item.badge.text}
                </Badge>
              ) : null}

              <AppText style={styles.rankValue}>{item.formattedValue}</AppText>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
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
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
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
      <View style={styles.body}>{children}</View>
    </View>
  );
}

// ── locationBadge (web module helper, ported verbatim) ───────────────────────
function locationBadge(
  snapshot:
    | { located_at_home?: boolean; located_at_work?: boolean; located_at_favorite?: boolean }
    | null
    | undefined,
  t: (key: string, fallback: string) => string,
): { emoji: string; label: string; variant: 'success' | 'warning' | 'error' | 'neutral' } {
  if (snapshot?.located_at_home) {
    return { emoji: '🏠', label: t('widget.locationFavorites.home', 'Home'), variant: 'success' };
  }
  if (snapshot?.located_at_work) {
    return { emoji: '🏢', label: t('widget.locationFavorites.work', 'Work'), variant: 'neutral' };
  }
  if (snapshot?.located_at_favorite) {
    return { emoji: '⭐', label: t('widget.locationFavorites.favorite', 'Favorite'), variant: 'neutral' };
  }
  return { emoji: '📍', label: t('widget.locationFavorites.other', 'Other'), variant: 'warning' };
}

export default function LocationFavoritesWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: locations,
    isLoading: locLoading,
    error: locError,
    isFetching: locFetching,
    isStale: locStale,
    isError: locIsError,
    dataUpdatedAt: locUpdatedAt,
    refetch: locRefetch,
  } = useLocations(vehicleIdStr);

  const {
    data: snapshot,
    isLoading: snapLoading,
    error: snapError,
    isFetching: snapFetching,
    isStale: snapStale,
    isError: snapIsError,
    dataUpdatedAt: snapUpdatedAt,
    refetch: snapRefetch,
  } = useLocationSnapshotLatest(vid ?? 0);

  const isLoading = locLoading || snapLoading;
  const error = locError ?? snapError;
  const isFetching = locFetching || snapFetching;
  const isStale = locStale || snapStale;
  const isError = locIsError || snapIsError;
  const updatedAt = Math.max(locUpdatedAt ?? 0, snapUpdatedAt ?? 0);

  const isCompact = size.cols <= 1;

  const locBadge = locationBadge(snapshot, t);
  const locBadgeVariant: BadgeVariant =
    locBadge.variant === 'success'
      ? 'success'
      : locBadge.variant === 'warning'
        ? 'warning'
        : 'neutral';

  const items: RankedItem[] = useMemo(() => {
    const locs = locations ?? [];
    return locs.map((loc) => ({
      id: loc.id,
      label: loc.addressName ?? '—',
      value: loc.visitCount ?? 0,
      formattedValue: `${fmtInt(loc.visitCount ?? 0)}× · ${loc.lastVisited ? formatRelative(loc.lastVisited) : '—'}`,
      barColor: 'bg-blue-400',
    }));
  }, [locations]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => {
      locRefetch();
      snapRefetch();
    },
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={locUpdatedAt}
        isFetching={locFetching}
        isStale={locStale}
        isError={locIsError}
        onRefresh={() => locRefetch()}
      >
        <View style={styles.compactBody}>
          <AppText
            accessibilityRole="image"
            accessibilityLabel={locBadge.label}
            style={styles.compactEmoji}
          >
            {locBadge.emoji}
          </AppText>
          <Badge variant={locBadgeVariant} size="sm">
            {locBadge.label}
          </Badge>
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.locationFavorites.title', 'Favorite Locations')}
      icon={<GlyphIcon glyph="📍" color={BLUE_400} size={14} />}
      {...shellProps}
    >
      <View style={styles.fullHeader}>
        <AppText
          accessibilityRole="image"
          accessibilityLabel={locBadge.label}
          style={styles.fullEmoji}
        >
          {locBadge.emoji}
        </AppText>
        <Badge variant={locBadgeVariant} size="sm">
          {locBadge.label}
        </Badge>
        {snapshot?.destination_name ? (
          <AppText
            numberOfLines={1}
            style={styles.destinationText}
          >{`→ ${snapshot.destination_name}`}</AppText>
        ) : null}
      </View>

      {(locations ?? []).length > 0 ? (
        <WidgetRankedList
          items={items}
          emptyMessage={t('widget.locationFavorites.noData', 'No favorite locations')}
          emptyIcon={<GlyphIcon glyph="📍" color={colors.textMuted} size={20} />}
        />
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph="📍" color={colors.textMuted} size={20} />}
          message={t('widget.locationFavorites.noData', 'No favorite locations')}
          paddingVertical={16}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 4, // gap-1
    justifyContent: 'center',
    minHeight: 44, // min-h-[44px]
  },
  compactEmoji: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    lineHeight: 32,
  },
  destinationText: {
    color: colors.textSecondary,
    flexShrink: 1, // allow truncation
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  fullEmoji: {
    color: colors.textPrimary,
    fontSize: 18, // text-lg
    lineHeight: 24,
  },
  fullHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
    marginBottom: 12, // mb-3
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  rankBar: {
    borderRadius: 8, // rounded-lg
    bottom: 0, // inset-y-0
    left: 0, // left-0
    opacity: 0.15, // opacity-15
    position: 'absolute',
    top: 0, // inset-y-0
  },
  rankLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14, // text-sm
  },
  rankNumber: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    textAlign: 'right',
    width: 20, // w-5
  },
  rankRow: {
    borderRadius: 8, // rounded-lg
    minHeight: 44, // min-h-[44px]
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
    position: 'relative',
  },
  rankRowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12, // gap-3
    position: 'relative',
  },
  rankValue: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontVariant: ['tabular-nums'], // tabular-nums
    fontWeight: '600', // font-semibold
  },
  rankedContent: {
    rowGap: 4, // gap-1
  },
  rankedScroll: {
    flex: 1,
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
});
