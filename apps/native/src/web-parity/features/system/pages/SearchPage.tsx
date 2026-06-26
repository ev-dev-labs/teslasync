// Native parity port of web/src/features/system/pages/SearchPage.tsx.
//
// Dedicated app-wide search page. The web page reads `?q=` and `?types=` from
// the URL so links from the command palette (and shared URLs) restore the same
// view; the per-type LIMIT is bumped to 25 so the page shows materially more
// results than the palette's 5-per-type preview. It renders the AI
// natural-language search affordance above a typed-filter panel (a search
// input + a facet chip rail for the nine entity types), then a results area
// that groups hits by type. Backed by GET /search via useGlobalSearch.
//
// Every web behavior + state name is preserved: the `query`/`setQuery` and
// `activeTypes`/`setActiveTypes` state, `usePageTitle`, `trimmed`, `tooShort`,
// the `typesFilter` and `groupedHits` useMemos, the `hits` alias,
// `toggleType`, `clearFilters`, the `ALL_TYPES` display-ordered constant, the
// `searchHitIconSm` + `searchSectionLabel` module-scope helpers, and the exact
// branch order of the results area (tooShort -> empty -> error -> loading ->
// no-results -> grouped). The web DOM/Tailwind stack is replaced with React
// Native primitives + the native parity component library:
//
//   - `@/components/layout` PageContainer (title) has no native parity
//     component, so a local ScrollView screen scaffold reproduces the title
//     header (DiskForecastPage / SlowQueriesPage / DBHealthPage precedent).
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel
//     (`padding="md"` = web `p-4`, `padding="lg"` = web `p-6`).
//   - `@/components/ui` Input (a DOM <input type="search"> with an `icon`
//     slot) becomes a search field: a SemanticIcon name="search" + a
//     TextInput (value=query, onChangeText=setQuery, autoFocus,
//     accessibilityLabel), preserving the placeholder + aria-label copy.
//   - `@/components/data-display` TimeStamp (a tooltip'd auto/relative
//     renderer) becomes an inlined formatRelative string (the DBHealthPage /
//     IngestXRay precedent); the hover tooltip + responsive `hidden sm:inline`
//     wrapper have no native analog so the relative time always renders when
//     `hit.when` is present.
//   - `@/components/feedback` EmptyState reuses the native parity component
//     (which takes title + message, no icon), with the web SearchIcon rendered
//     above it via SemanticIcon name="search" to keep the visual intent.
//   - `@/components/feedback` Skeleton becomes a local reduced-motion-aware
//     pulse block (the loading branch's h-4 + five h-12 rows).
//   - `@/components/ai/AINLSearch` reuses the already-ported native parity
//     component (returns null unless the nl-search AI feature is enabled).
//   - lucide-react icons map to the native SemanticIcon: Car->vehicle,
//     Route->drive, BatteryCharging->batteryCharging, BellRing->
//     notificationsActive, Bell->notifications, MapPinned->mapPinned,
//     Workflow->workflow, MapPin->location, Compass->trip, Search->search,
//     ArrowRight->forward.
//   - react-router-dom `useNavigate()` is browser-only; in-app navigation
//     becomes the `onNavigate(path)` callback precedent (InboxPage), wired to
//     each result row's onPress so the web `navigate(hit.url)` is preserved.
//   - `@/hooks/useUrlState` useUrlString/useUrlArray (which mirror state into
//     the URL query string) have no native URL; they degrade to local
//     `useState`-backed shims with the identical [value, setter] ergonomics so
//     the `query`/`activeTypes` state and every setter call read unchanged.
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the `t()` title call is preserved.
//   - `@/lib/cn` (clsx) is dropped — native uses StyleSheet arrays.
//   - react-i18next useTranslation becomes a local t(key, fallback, vars?) /
//     t(key, {defaultValue, ...vars}) shim that supports both the plain-string
//     and i18next options-object call forms the source uses, interpolating
//     `{{var}}` placeholders, preserving every key + English copy verbatim.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {AINLSearch} from '../../../components/ai/AINLSearch';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {
  SEARCH_MIN_QUERY_LENGTH,
  useGlobalSearch,
  type SearchHit,
  type SearchHitType,
} from '../../../api/hooks/useSearch';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;

interface TranslationOptions extends TranslationVars {
  defaultValue: string;
}

interface NativeTFunction {
  (key: string, fallback: string, vars?: TranslationVars): string;
  (key: string, options: TranslationOptions): string;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (
      _key: string,
      fallbackOrOptions: string | TranslationOptions,
      vars?: TranslationVars,
    ): string => {
      const fallback =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : fallbackOrOptions.defaultValue;
      const interpolation: TranslationVars | undefined =
        typeof fallbackOrOptions === 'string' ? vars : fallbackOrOptions;
      if (interpolation == null) {
        return fallback;
      }
      return fallback.replace(
        /\{\{\s*([^}\s]+)\s*\}\}/g,
        (match, name: string) =>
          Object.prototype.hasOwnProperty.call(interpolation, name)
            ? String(interpolation[name])
            : match,
      );
    },
    [],
  ) as NativeTFunction;
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── useUrlState shims (web mirrors state into the URL; native has none) ──── */

function useUrlString(
  _key: string,
  defaultValue = '',
): [string, React.Dispatch<React.SetStateAction<string>>] {
  return useState<string>(defaultValue);
}

function useUrlArray(
  _key: string,
  defaultValue: readonly string[] = [],
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  return useState<string[]>(() => [...defaultValue]);
}

/* ─── TimeStamp replacement (web `@/components/data-display` TimeStamp) ─────── */

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  const diff = Date.now() - d.getTime();
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─── reduced-motion + Skeleton (web `@/components/feedback` Skeleton) ──────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function useLoopingPulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;
  const reset = useCallback(() => pulse.setValue(0), [pulse]);

  useEffect(() => {
    if (reduceMotion) {
      reset();
      return;
    }
    reset();
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion, reset]);

  return pulse;
}

function Skeleton({
  height,
  width = '100%',
  style,
}: {
  height: number;
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 0.85],
        }),
      };

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skeleton, {height, width}, animatedStyle, style]}
    />
  );
}

Skeleton.displayName = 'Skeleton';

// All entity types the backend can return — kept in display order so the
// facet chip rail and grouped results render predictably.
const ALL_TYPES: SearchHitType[] = [
  'vehicle',
  'drive',
  'charging',
  'alert',
  'notification',
  'geofence',
  'automation',
  'location',
  'trip',
];

interface SearchPageProps {
  /**
   * Native-safe replacement for react-router-dom `useNavigate()`. Each result
   * row forwards `hit.url` here so the host shell can route, mirroring the web
   * `navigate(hit.url)`. Absent => rows are inert.
   */
  onNavigate?: (path: string) => void;
}

export default function SearchPage({onNavigate}: SearchPageProps = {}) {
  const t = useNativeTranslationFallback();
  const navigate = useCallback(
    (path: string) => {
      onNavigate?.(path);
    },
    [onNavigate],
  );
  const [query, setQuery] = useUrlString('q', '');
  const [activeTypes, setActiveTypes] = useUrlArray('types');

  usePageTitle(t('search.title', 'Search'));

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_MIN_QUERY_LENGTH;

  // Preserve the original requested types ordering across the round-trip.
  const typesFilter = useMemo<SearchHitType[]>(() => {
    return activeTypes.filter((type): type is SearchHitType =>
      (ALL_TYPES as string[]).includes(type),
    );
  }, [activeTypes]);

  const {data, isFetching, error} = useGlobalSearch(trimmed, {
    types: typesFilter.length > 0 ? typesFilter : undefined,
    limit: 25,
    disabled: tooShort,
  });

  const hits = useMemo(() => data?.hits ?? [], [data]);

  const groupedHits = useMemo(() => {
    const groups = new Map<SearchHitType, SearchHit[]>();
    for (const type of ALL_TYPES) {
      groups.set(type, []);
    }
    for (const hit of hits) {
      if (!groups.has(hit.type)) {
        continue;
      }
      groups.get(hit.type)!.push(hit);
    }
    return ALL_TYPES.map(type => ({type, hits: groups.get(type) ?? []})).filter(
      g => g.hits.length > 0,
    );
  }, [hits]);

  function toggleType(type: SearchHitType) {
    if (typesFilter.includes(type)) {
      setActiveTypes(typesFilter.filter(item => item !== type));
    } else {
      setActiveTypes([...typesFilter, type]);
    }
  }

  function clearFilters() {
    setActiveTypes([]);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      testID="search-page">
      <AppText style={styles.pageTitle} variant="title" weight="bold">
        {t('search.title', 'Search')}
      </AppText>

      {/*
        Natural-language search across drives, charges, and alerts. Rendered
        above the typed-filter panel so the AI affordance is discoverable but
        never replaces the canonical typed search baseline. Returns null when
        ai_mode is 'off' or the nl-search feature toggle is off, so users on the
        default install never see this surface.
      */}
      <AINLSearch />

      <GlassPanel padding="md" style={styles.panel}>
        <View style={styles.searchField}>
          <SemanticIcon decorative name="search" size="sm" style={styles.searchIcon} />
          <TextInput
            accessibilityLabel={t('search.input.label', 'Search query')}
            autoFocus
            onChangeText={setQuery}
            placeholder={t('search.placeholder', 'Search vehicles, drives, charging\u2026')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            value={query}
          />
        </View>

        <View style={styles.chipRail}>
          {ALL_TYPES.map(type => {
            const active = typesFilter.includes(type);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                key={type}
                onPress={() => toggleType(type)}
                style={({pressed}) => [
                  styles.chip,
                  active ? styles.chipActive : styles.chipIdle,
                  pressed && styles.pressed,
                ]}>
                {searchHitIconSm(type)}
                <AppText
                  style={active ? styles.chipTextActive : styles.chipText}
                  variant="caption">
                  {searchSectionLabel(type, t)}
                </AppText>
              </Pressable>
            );
          })}
          {typesFilter.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              style={({pressed}) => [styles.clearChip, pressed && styles.pressed]}>
              <AppText style={styles.clearChipText} variant="caption">
                {t('search.filters.clear', 'Clear filters')}
              </AppText>
            </Pressable>
          )}
        </View>
      </GlassPanel>

      <View style={styles.resultsArea}>
        {tooShort ? (
          <SearchInfoPanel
            message={t(
              'search.tooShort.message',
              'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.',
            )}
            title={t('search.tooShort.title', 'Type at least 2 characters')}
          />
        ) : trimmed.length === 0 ? (
          <SearchInfoPanel
            message={t(
              'search.empty.message',
              'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.',
            )}
            title={t('search.empty.title', 'Start typing to search')}
          />
        ) : error ? (
          <SearchInfoPanel
            message={t(
              'search.error.message',
              'The search service did not respond. Try again or refine your query.',
            )}
            title={t('search.error.title', 'Search failed')}
          />
        ) : isFetching && groupedHits.length === 0 ? (
          <GlassPanel padding="lg" style={styles.panel}>
            <Skeleton height={16} width="33%" />
            <View style={styles.skeletonStack}>
              {[0, 1, 2, 3, 4].map(i => (
                <Skeleton height={48} key={i} />
              ))}
            </View>
          </GlassPanel>
        ) : groupedHits.length === 0 ? (
          <SearchInfoPanel
            message={t('search.noResults.message', {
              query: trimmed,
              defaultValue: `No matches for "${trimmed}". Try fewer characters or open the command palette.`,
            })}
            title={t('search.noResults.title', 'No results')}
          />
        ) : (
          <View style={styles.groupList}>
            {groupedHits.map(group => (
              <GlassPanel key={group.type} padding="md" style={styles.groupPanel}>
                <View style={styles.groupHeader}>
                  {searchHitIconSm(group.type)}
                  <AppText
                    style={styles.groupHeaderText}
                    variant="caption"
                    weight="semibold">
                    {searchSectionLabel(group.type, t)}
                  </AppText>
                  <View style={styles.countPill}>
                    <AppText style={styles.countPillText}>{group.hits.length}</AppText>
                  </View>
                </View>
                <View>
                  {group.hits.map((hit, index) => (
                    <Pressable
                      accessibilityRole="button"
                      key={`${hit.type}-${hit.id}`}
                      onPress={() => navigate(hit.url)}
                      style={({pressed}) => [
                        styles.row,
                        index > 0 && styles.rowDivider,
                        pressed && styles.rowPressed,
                      ]}>
                      <SemanticIcon
                        decorative
                        name={iconNameForType(hit.type)}
                        size="sm"
                      />
                      <View style={styles.rowBody}>
                        <AppText numberOfLines={1} style={styles.rowTitle}>
                          {hit.title}
                        </AppText>
                        {hit.subtitle ? (
                          <AppText
                            numberOfLines={1}
                            style={styles.rowSubtitle}
                            variant="caption">
                            {hit.subtitle}
                          </AppText>
                        ) : null}
                      </View>
                      {hit.when ? (
                        <AppText
                          style={styles.rowWhen}
                          tone="muted"
                          variant="caption">
                          {formatRelative(hit.when)}
                        </AppText>
                      ) : null}
                      <SemanticIcon decorative name="forward" size="sm" />
                    </Pressable>
                  ))}
                </View>
              </GlassPanel>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/* ─── empty/info panel (web GlassPanel + EmptyState with a SearchIcon) ──────── */

function SearchInfoPanel({title, message}: {title: string; message: string}) {
  return (
    <GlassPanel padding="lg" style={styles.panel}>
      <View style={styles.infoWrap}>
        <SemanticIcon decorative name="search" size="lg" />
        <EmptyState message={message} title={title} />
      </View>
    </GlassPanel>
  );
}

// Compact icon variant used in chips and rows. Module-scope so the page
// component is not re-creating <SemanticIcon /> elements every render.
function searchHitIconSm(type: SearchHitType): ReactElement {
  return <SemanticIcon decorative name={iconNameForType(type)} size="sm" />;
}

function iconNameForType(type: SearchHitType): SemanticIconName {
  switch (type) {
    case 'vehicle':
      return 'vehicle';
    case 'drive':
      return 'drive';
    case 'charging':
      return 'batteryCharging';
    case 'alert':
      return 'notificationsActive';
    case 'notification':
      return 'notifications';
    case 'geofence':
      return 'mapPinned';
    case 'automation':
      return 'workflow';
    case 'location':
      return 'location';
    case 'trip':
      return 'trip';
    default:
      return 'search';
  }
}

function searchSectionLabel(type: SearchHitType, t: NativeTFunction): string {
  switch (type) {
    case 'vehicle':
      return t('search.section.vehicle', 'Vehicles');
    case 'drive':
      return t('search.section.drive', 'Drives');
    case 'charging':
      return t('search.section.charging', 'Charging');
    case 'alert':
      return t('search.section.alert', 'Alerts');
    case 'notification':
      return t('search.section.notification', 'Notifications');
    case 'geofence':
      return t('search.section.geofence', 'Geofences');
    case 'automation':
      return t('search.section.automation', 'Automations');
    case 'location':
      return t('search.section.location', 'Locations');
    case 'trip':
      return t('search.section.trip', 'Trips');
    default:
      return t('search.section.results', 'Results');
  }
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipRail: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chipText: {
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textPrimary,
  },
  clearChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  clearChipText: {
    color: colors.textMuted,
  },
  countPill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  countPillText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 16,
  },
  groupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  groupHeaderText: {
    color: colors.textSecondary,
    flexShrink: 1,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupList: {
    gap: spacing.md,
  },
  groupPanel: {
    gap: spacing.sm,
  },
  infoWrap: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  resultsArea: {
    gap: spacing.md,
  },
  row: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  rowSubtitle: {
    color: colors.textMuted,
  },
  rowTitle: {
    color: colors.textPrimary,
  },
  rowWhen: {
    flexShrink: 0,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 22,
    paddingVertical: spacing.sm,
  },
  skeleton: {
    backgroundColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: 6,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
});
