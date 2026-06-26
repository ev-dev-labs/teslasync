// Native parity port of web/src/features/dashboard/components/RecentlyViewedWidget.tsx.
//
// The web module is the dashboard "Recently Viewed" widget: a GlassPanel whose
// header carries a small cyan Clock icon + title, and whose body renders the top
// {RECENT_PAGES_DISPLAY_LIMIT} entries from the client-side `recentPages` store
// as a list of clickable router <Link>s (icon + title + relative-time), updating
// live via `subscribeRecentPages`. When the list is empty it shows a plain,
// non-actionable hint paragraph rather than a CTA EmptyState (the web audit
// forbids cta-less EmptyState in feature pages).
//
// Native-safe substitutions (documented in the parity sidecar):
//   • @/lib/recentPages (L31-37) is browser-only — it reads `window.localStorage`
//     and listens on `window` 'storage'/local events. React Native ships no
//     `window`/`localStorage`, and recentPages.ts is not yet ported, so this file
//     hosts a self-contained, native-safe in-memory port of exactly the store API
//     the widget consumes: the `RecentPageKind`/`RecentEntry` types (verbatim),
//     `getRecentPages(limit)`, and `subscribeRecentPages(handler)`. A module-level
//     array + listener Set replaces localStorage + the window event bus. Until a
//     native page-view recorder is wired up the list is empty, so the widget shows
//     its empty-state hint — the explicit native "unavailable" state (rule 7). The
//     `setRecentPagesForParity` seam lets a future recorder (and the tests) seed +
//     notify, preserving the subscribe/refresh behaviour the web store provides.
//   • react-router-dom <Link to=...> (L18, L137-154) -> Pressable + an
//     `onNavigate(path)` callback (the established native nav idiom, see
//     VehicleHeroCard/BottomTabBar); each `to` path is carried verbatim and reused
//     as the row testID, and the title becomes the link accessibilityLabel.
//   • react-i18next useTranslation/TFunction (L19-20) -> a local English-fallback
//     useTranslation() whose t(key, fallback?, values?) returns the fallback and
//     interpolates {{token}} placeholders, preserving every key verbatim
//     ('recentPages.widgetTitle', 'recentPages.empty', 'recentPages.justNow',
//     'recentPages.shortMinute/Hour/Day'). Matches the sibling KioskOverlay port.
//   • lucide-react icons (L21-30, L44-56, L111) -> the app's own SemanticIcon glyph
//     vocabulary rendered inline (getSemanticIconDefinition(name).glyph): Clock->
//     'clock', Car->'vehicle', Route->'drive', BatteryCharging->'batteryCharging',
//     Compass->'trip', MapPinned->'mapPinned', CalendarDays->'calendar',
//     FileText->'fileText'. Rendered as bare accent-tinted AppText (no chip),
//     honouring both the web text-cyan-300 tint and the web design note that each
//     row "drops the icon-chip background" (L128-130).
//   • GlassPanel from @/components/ui/GlassPanel (L31) -> the native GlassPanel
//     parity component. The web default `className ?? 'p-4'` padding becomes a 16px
//     panel padding; a `style` passthrough replaces the className override.
//   • DOM <div>/<h3>/<p>/<ul>/<li>/<span> + Tailwind classes -> View/AppText +
//     StyleSheet. The responsive `grid-cols-1 sm:2 lg:3` (L132) has no RN media
//     queries; a native app is the phone-first target, so the default grid-cols-1
//     single-column list is the faithful rendering (documented).
//   • hover:bg-[var(--surface-2)] hover:text-primary (L139) -> a pressed-state
//     background bump (surfaceRaised, the dark-theme --surface-2 stand-in) and a
//     pressed title-color bump to textPrimary; truncate (L148) -> numberOfLines={1};
//     tabular-nums (L151) -> fontVariant ['tabular-nums'].
//
// No DOM elements, react-router-dom, lucide-react, Recharts, Leaflet, react-dom,
// or web UI-kit modules are imported into the native output.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ──────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site and interpolating {{token}} placeholders.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return {t};
}

/* ─── native-safe @/lib/recentPages port (in-memory) ─────────────────────── */

/**
 * Coarse category for a recorded page. Drives the icon shown in the widget and
 * gives consumers a stable grouping key. Ported verbatim from web
 * lib/recentPages.ts; unknown kinds are surfaced as the default `fileText` icon.
 */
export type RecentPageKind =
  | 'page'
  | 'vehicle'
  | 'drive'
  | 'trip'
  | 'charging'
  | 'geofence'
  | 'year-review';

export interface RecentEntry {
  /** Pathname (no search/hash). Used for both navigation and dedup. */
  path: string;
  /** Captured page title at recording time, suitable for display. */
  title: string;
  /** Coarse category for icon + grouping. */
  kind: RecentPageKind;
  /** Captured numeric/string id when path contains an `:id`-style param. */
  ref_id?: string;
  /** ms since epoch of the most recent visit. */
  visited_at: number;
}

/** Matches the web store cap (RECENT_PAGES_MAX). */
const MAX_ENTRIES = 50;

let recentEntries: RecentEntry[] = [];
const recentListeners = new Set<() => void>();

/** Snapshot of the recent-page list, newest first. Optionally truncated. */
export function getRecentPages(limit?: number): RecentEntry[] {
  if (typeof limit === 'number') {
    return recentEntries.slice(0, Math.max(0, limit));
  }
  return recentEntries.slice();
}

/**
 * Subscribe to recent-page list changes. Returns an unsubscribe function. The
 * web store fires for same-tab and cross-tab localStorage changes; the native
 * port fires for in-memory mutations via {@link setRecentPagesForParity}.
 */
export function subscribeRecentPages(handler: () => void): () => void {
  recentListeners.add(handler);
  return () => {
    recentListeners.delete(handler);
  };
}

/**
 * Native seam replacing the web localStorage recorder. Replaces the in-memory
 * list (capped to {@link MAX_ENTRIES}, newest first) and notifies subscribers,
 * exactly like the web store's save()->notify() path. Exposed so a future native
 * page-view recorder — and the parity tests — can drive the live-update flow.
 */
export function setRecentPagesForParity(entries: RecentEntry[]): void {
  recentEntries = entries.slice(0, MAX_ENTRIES);
  for (const handler of [...recentListeners]) {
    try {
      handler();
    } catch {
      // Never let a subscriber crash the bus (web subscribeRecentPages parity).
    }
  }
}

/* ─── widget ──────────────────────────────────────────────────────────────── */

const RECENT_PAGES_DISPLAY_LIMIT = 5;

/** web iconForKind: lucide icon per kind -> the app's SemanticIcon glyph name. */
function iconNameForKind(kind: RecentPageKind): SemanticIconName {
  switch (kind) {
    case 'vehicle':
      return 'vehicle';
    case 'drive':
      return 'drive';
    case 'charging':
      return 'batteryCharging';
    case 'trip':
      return 'trip';
    case 'geofence':
      return 'mapPinned';
    case 'year-review':
      return 'calendar';
    default:
      return 'fileText';
  }
}

function formatRelative(visitedAt: number, now: number, t: TFunc): string {
  const diffMs = Math.max(0, now - visitedAt);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) {
    return t('recentPages.justNow', 'Just now');
  }
  if (min < 60) {
    return `${min}${t('recentPages.shortMinute', 'm')}`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}${t('recentPages.shortHour', 'h')}`;
  }
  const day = Math.floor(hr / 24);
  return `${day}${t('recentPages.shortDay', 'd')}`;
}

/** Subscribes to the recent-pages store and re-renders on changes. */
function useRecentPages(limit: number): RecentEntry[] {
  const [entries, setEntries] = useState<RecentEntry[]>(() =>
    getRecentPages(limit),
  );
  useEffect(() => {
    setEntries(getRecentPages(limit));
    return subscribeRecentPages(() => setEntries(getRecentPages(limit)));
  }, [limit]);
  return entries;
}

function RecentRow({
  entry,
  now,
  t,
  onNavigate,
}: {
  entry: RecentEntry;
  now: number;
  t: TFunc;
  onNavigate?: (path: string) => void;
}) {
  const iconGlyph = getSemanticIconDefinition(iconNameForKind(entry.kind)).glyph;
  return (
    <Pressable
      accessibilityLabel={entry.title}
      accessibilityRole="link"
      onPress={() => onNavigate?.(entry.path)}
      style={({pressed}) => [styles.row, pressed ? styles.rowPressed : null]}
      testID={`recently-viewed-row-${entry.path}`}>
      {({pressed}) => (
        <>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.rowIcon}>
            {iconGlyph}
          </AppText>
          <AppText
            numberOfLines={1}
            style={[styles.rowTitle, pressed ? styles.rowTitlePressed : null]}>
            {entry.title}
          </AppText>
          <AppText style={styles.rowTime}>
            {formatRelative(entry.visited_at, now, t)}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export interface RecentlyViewedWidgetProps {
  /**
   * Optional override of the visit cap shown. Defaults to
   * {@link RECENT_PAGES_DISPLAY_LIMIT}. Useful for embedding this widget
   * elsewhere with a different visual budget.
   */
  limit?: number;
  /** Accepted for web parity; React Native has no CSS class names. */
  className?: string;
  /**
   * Native navigation hook replacing react-router-dom's <Link>. Receives the
   * destination path string verbatim when a row is pressed. No-op if unwired.
   */
  onNavigate?: (path: string) => void;
  /** Native composition hook replacing the web `className` panel override. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function RecentlyViewedWidget({
  limit = RECENT_PAGES_DISPLAY_LIMIT,
  className: _className,
  onNavigate,
  style,
  testID,
}: RecentlyViewedWidgetProps = {}) {
  const {t} = useTranslation();
  const entries = useRecentPages(limit);
  const now = Date.now();

  return (
    <GlassPanel style={[styles.panel, style]} testID={testID ?? 'recently-viewed-widget'}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.titleIcon}>
            {getSemanticIconDefinition('clock').glyph}
          </AppText>
          <AppText style={styles.title} weight="semibold">
            {t('recentPages.widgetTitle', 'Recently Viewed')}
          </AppText>
        </View>
      </View>
      {entries.length === 0 ? (
        <AppText
          style={styles.empty}
          testID="recently-viewed-empty"
          tone="muted"
          variant="caption">
          {t(
            'recentPages.empty',
            'Pages you visit will appear here for quick access.',
          )}
        </AppText>
      ) : (
        // Responsive grid on web (1 col, sm:2, lg:3). A native app is the
        // phone-first target with no media queries, so the grid-cols-1 default
        // single-column list is the faithful rendering.
        <View style={styles.list} testID="recently-viewed-list">
          {entries.map(entry => (
            <RecentRow
              entry={entry}
              key={entry.path}
              now={now}
              onNavigate={onNavigate}
              t={t}
            />
          ))}
        </View>
      )}
    </GlassPanel>
  );
}

export default RecentlyViewedWidget;

const styles = StyleSheet.create({
  panel: {
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  title: {
    color: colors.textPrimary,
  },
  empty: {
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  list: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  rowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  rowIcon: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  rowTitle: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  rowTitlePressed: {
    color: colors.textPrimary,
  },
  rowTime: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
  },
});
