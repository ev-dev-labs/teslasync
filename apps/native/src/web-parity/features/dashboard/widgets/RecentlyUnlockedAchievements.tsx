// Native parity port of
// web/src/features/dashboard/widgets/RecentlyUnlockedAchievements.tsx.
//
// The web widget surfaces the user's most recently unlocked achievements on the
// dashboard. It resolves the active vehicle (vehicleId prop, else the first
// vehicle, else 0), reads the same `/analytics/lifetime` payload as the Lifetime
// Stats page (useLifetimeStats), filters to achievements that are `unlocked`
// AND have an `unlocked_at`, sorts them `unlocked_at desc` (Date.parse), and
// slices to a limit that widens with the tile (5 when size.cols >= 3, else 3).
// Each surviving achievement renders as a clickable <AchievementBadge size="sm">
// that deep-links into `/lifetime?achievement={id}`. The widget honours
// useAchievementCelebrationPrefs().showOnDashboard: when off it renders an
// opt-out EmptyState (so the dashboard grid slot never disappears); when on but
// with no unlocks it renders an encouragement EmptyState. All of this lives
// inside a <WidgetShell> fed query freshness (loading / fetching / stale / error
// / dataUpdatedAt) + a manual refresh.
//
// This native port preserves that contract 1:1 — the same id resolution, the
// same useLifetimeStats('/analytics/lifetime') call + destructure, the same
// isWide/limit and `recent` filter+sort+slice memo (deps [data?.achievements,
// limit]), the same title/icon, the same showOnDashboard opt-out branch, and
// the same badge-strip / empty-state branches with identical i18n keys + English
// defaults (incl. the achievements.viewNamed {{name}} interpolation) — using
// React Native primitives, the existing native AppText + design tokens, and the
// already-ported web-parity useLifetimeStats / useVehicles hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-router-dom useNavigate (web L2): React Native has no DOM history
//     router, so navigation is delegated to an optional onNavigate(to) bridge
//     prop (the established native QuickNav / HistoryListRow precedent). The
//     `/lifetime?achievement=${encodeURIComponent(id)}` path is preserved
//     verbatim; without a bridge a press is an explicit no-op.
//   - react-i18next useTranslation('dashboard') (web L3): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?, vars?)
//     = (fallback ?? key) with i18next-style {{var}} interpolation, preserving
//     every key + English default (incl. achievements.viewNamed's {{name}}).
//     The namespace is irrelevant to the fallback resolver.
//   - lucide-react Trophy (web L4): DOM SVG icon -> the 🏆 emoji/glyph stand-in
//     (the established native inline-icon approach), tinted amber-400 in the
//     header and muted in the empty states.
//   - @/components/feedback EmptyState (web L5): reproduced as a native-safe
//     <EmptyState> (centered glyph + muted message, py-4 spacing).
//   - @/api/hooks/useAnalytics useLifetimeStats + LifetimeAchievement (web L6):
//     the already-ported web-parity hook (same /analytics/lifetime path).
//   - @/api/hooks/useVehicles useVehicles (web L7): the already-ported web-parity
//     hook (same /vehicles path, Vehicle.id is a number).
//   - @/hooks/useAchievementCelebrationPrefs (web L8): the localStorage +
//     window 'storage' useSyncExternalStore prefs store is reproduced with an
//     in-memory shim (UNAVAILABLE on native: cold-launch persistence + cross-tab
//     sync — single-process, so the storage-event seam is inert by design); the
//     prefs interface, defaults, cached-snapshot pattern, and setter are kept.
//   - @/features/analytics/components/AchievementBadge (web L9): inlined as a
//     native-safe <AchievementBadge> (the sm/md/lg size config, the
//     unlocked/locked styling, the i18n unlocked label). Its web ProgressRing
//     (only rendered for LOCKED achievements — never reached here since the
//     widget pre-filters to unlocked) is reduced to a native-safe segment ring
//     (react-native-svg unavailable; the established RadialGauge technique).
//     The CSS animate-pulse / grayscale have no native equivalent and are
//     dropped.
//   - ./WidgetShell (web L10): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms pulse-on-update glow, and the
//     inline DataFreshness chip (its web Skeleton / QueryError / DataFreshness /
//     HelpTooltip / PinButton internals reduced to native equivalents).
//   - ./types WidgetProps (web L11): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {useLifetimeStats} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L4 + L59/L65/L105)                */
/* ------------------------------------------------------------------ */

const ICON_TROPHY = '\uD83C\uDFC6'; // 🏆 (Trophy)

const PULSE_GLOW = '#22c55e';

// amber-400 (web L59 text-amber-400) + yellow palette (AchievementBadge).
const AMBER_400 = '#fbbf24';
const YELLOW_400 = '#facc15';
const YELLOW_500_08 = 'rgba(234, 179, 8, 0.08)';
const YELLOW_500_30 = 'rgba(234, 179, 8, 0.3)';
const YELLOW_500_70 = 'rgba(234, 179, 8, 0.7)';
const RING_NEAR_COMPLETE = '#eab308';
const RING_LOCKED = '#6b7280';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L3)     */
/* ------------------------------------------------------------------ */

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, params) => interpolate(fallback ?? key, params),
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
/*  native-safe useAchievementCelebrationPrefs                         */
/*  (web @/hooks/useAchievementCelebrationPrefs)                       */
/* ------------------------------------------------------------------ */

export interface AchievementCelebrationPrefs {
  showToasts: boolean;
  playSound: boolean;
  showOnDashboard: boolean;
  pushOnUnlock: boolean;
}

const CELEBRATION_PREFS_STORAGE_KEY = 'teslasync:achievement-celebration:v1';

const defaultCelebrationPrefs: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
};

// In-memory shim replacing the web `localStorage`. The synchronous read/write
// surface is preserved so the snapshot logic is verbatim. UNAVAILABLE on native:
// persistence across cold app launches (no durable backing store here).
const celebrationPrefsStore = new Map<string, string>();

function readCelebrationPrefs(): AchievementCelebrationPrefs {
  try {
    const raw = celebrationPrefsStore.get(CELEBRATION_PREFS_STORAGE_KEY);
    if (!raw) {
      return defaultCelebrationPrefs;
    }
    const parsed = JSON.parse(raw) as Partial<AchievementCelebrationPrefs>;
    return {
      showToasts:
        typeof parsed.showToasts === 'boolean'
          ? parsed.showToasts
          : defaultCelebrationPrefs.showToasts,
      playSound:
        typeof parsed.playSound === 'boolean'
          ? parsed.playSound
          : defaultCelebrationPrefs.playSound,
      showOnDashboard:
        typeof parsed.showOnDashboard === 'boolean'
          ? parsed.showOnDashboard
          : defaultCelebrationPrefs.showOnDashboard,
      pushOnUnlock:
        typeof parsed.pushOnUnlock === 'boolean'
          ? parsed.pushOnUnlock
          : defaultCelebrationPrefs.pushOnUnlock,
    };
  } catch {
    return defaultCelebrationPrefs;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React raises an infinite-render).
let cachedCelebrationPrefs: AchievementCelebrationPrefs = readCelebrationPrefs();
let cachedCelebrationSerialized = JSON.stringify(cachedCelebrationPrefs);

function getCelebrationSnapshot(): AchievementCelebrationPrefs {
  return cachedCelebrationPrefs;
}

const celebrationListeners = new Set<() => void>();

function subscribeCelebrationPrefs(cb: () => void): () => void {
  celebrationListeners.add(cb);
  // Web also registered a window 'storage' listener for cross-tab sync;
  // single-process native has no second tab, so that seam is inert by design.
  return () => {
    celebrationListeners.delete(cb);
  };
}

export function useAchievementCelebrationPrefs(): AchievementCelebrationPrefs {
  return useSyncExternalStore(
    subscribeCelebrationPrefs,
    getCelebrationSnapshot,
    getCelebrationSnapshot,
  );
}

/**
 * Imperatively patch the celebration prefs. Triggers a re-render in every
 * mounted useAchievementCelebrationPrefs(). Pass partial updates — unspecified
 * keys retain their current value. (Web parity setter; the cross-tab fan-out is
 * inert on single-process native.)
 */
export function setAchievementCelebrationPrefs(
  patch: Partial<AchievementCelebrationPrefs>,
): void {
  const next: AchievementCelebrationPrefs = {...cachedCelebrationPrefs, ...patch};
  const serialized = JSON.stringify(next);
  if (serialized === cachedCelebrationSerialized) {
    return;
  }
  try {
    celebrationPrefsStore.set(CELEBRATION_PREFS_STORAGE_KEY, serialized);
  } catch {
    // The in-memory shim never throws; the guard mirrors the web localStorage
    // try/catch so the current snapshot still updates if a backing store fails.
  }
  cachedCelebrationPrefs = next;
  cachedCelebrationSerialized = serialized;
  for (const cb of celebrationListeners) {
    cb();
  }
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
/*  native-safe ProgressRing (web @/components/data-display)           */
/*  react-native-svg unavailable -> positioned View segments arc       */
/* ------------------------------------------------------------------ */

const RING_SEGMENT_COUNT = 48;
const RING_START_ANGLE_DEGREES = -90;
const RING_FULL_TURN_DEGREES = 360;

interface RingSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

function buildRingSegments(
  radius: number,
  center: number,
  strokeWidth: number,
): RingSegment[] {
  const circumference = 2 * Math.PI * radius;
  const segmentWidth = Math.max(2, (circumference / RING_SEGMENT_COUNT) * 0.62);

  return Array.from({length: RING_SEGMENT_COUNT}, (_value, index) => {
    const angle =
      RING_START_ANGLE_DEGREES +
      (index / RING_SEGMENT_COUNT) * RING_FULL_TURN_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - segmentWidth / 2;
    const top = center + radius * Math.sin(radians) - strokeWidth / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `${index}-${left}-${top}`,
      left,
      top,
      width: segmentWidth,
    };
  });
}

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

function ProgressRing({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  color = '#3b82f6',
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const clamped = Math.max(0, Math.min(value, max));
  const progress = max > 0 ? clamped / max : 0;
  const activeCount = Math.round(progress * RING_SEGMENT_COUNT);
  const segments = useMemo(
    () => buildRingSegments(radius, center, strokeWidth),
    [radius, center, strokeWidth],
  );

  return (
    <View pointerEvents="none" style={{height: size, width: size}}>
      {segments.map((segment, index) => (
        <View
          key={segment.key}
          style={[
            styles.ringSegment,
            {
              backgroundColor: index < activeCount ? color : colors.border,
              height: strokeWidth,
              left: segment.left,
              top: segment.top,
              transform: [{rotateZ: segment.angle}],
              width: segment.width,
            },
          ]}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native AchievementBadge                                            */
/*  (web @/features/analytics/components/AchievementBadge)             */
/* ------------------------------------------------------------------ */

export interface AchievementData {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
  current: number;
}

type AchievementBadgeSize = 'sm' | 'md' | 'lg';

interface AchievementBadgeSizeConfig {
  ring: number;
  stroke: number;
  iconSize: number;
  gap: number;
  textSize: number;
}

// Web sizeConfig (AchievementBadge L22-26): ring/stroke kept verbatim; the
// Tailwind iconSize/gap/textSize classes mapped to native pixel equivalents
// (text-xl/3xl/4xl -> 20/30/36; gap-1/2/3 -> spacing.xs/sm/md; text-xs/sm/base
// -> 12/14/16).
const achievementBadgeSizeConfig: Record<
  AchievementBadgeSize,
  AchievementBadgeSizeConfig
> = {
  sm: {ring: 56, stroke: 3, iconSize: 20, gap: spacing.xs, textSize: 12},
  md: {ring: 72, stroke: 4, iconSize: 30, gap: spacing.sm, textSize: 14},
  lg: {ring: 96, stroke: 5, iconSize: 36, gap: spacing.md, textSize: 16},
};

interface AchievementBadgeProps {
  achievement: AchievementData;
  size?: AchievementBadgeSize;
}

function AchievementBadge({achievement, size = 'md'}: AchievementBadgeProps) {
  const t = useNativeTranslation();
  const cfg = achievementBadgeSizeConfig[size];
  const isNearComplete = !achievement.unlocked && achievement.progress >= 0.8;
  const pct = Math.round(achievement.progress * 100);

  return (
    <View
      style={[
        styles.badge,
        {gap: cfg.gap},
        achievement.unlocked ? styles.badgeUnlocked : styles.badgeLocked,
      ]}>
      {/* Badge circle (web L46-67) */}
      <View
        style={[
          styles.badgeCircle,
          {height: cfg.ring, width: cfg.ring},
        ]}>
        {!achievement.unlocked ? (
          <ProgressRing
            color={isNearComplete ? RING_NEAR_COMPLETE : RING_LOCKED}
            max={100}
            size={cfg.ring}
            strokeWidth={cfg.stroke}
            value={pct}
          />
        ) : null}
        <AppText
          accessibilityLabel={achievement.name}
          accessibilityRole="image"
          style={[
            styles.badgeIcon,
            {fontSize: cfg.iconSize, lineHeight: cfg.iconSize + 4},
            achievement.unlocked ? null : styles.badgeIconLocked,
          ]}>
          {achievement.icon}
        </AppText>
      </View>

      {/* Name (web L70-78) */}
      <AppText
        numberOfLines={2}
        style={[
          styles.badgeName,
          {fontSize: cfg.textSize},
          achievement.unlocked
            ? styles.badgeNameUnlocked
            : styles.badgeNameLocked,
        ]}
        weight="semibold">
        {achievement.name}
      </AppText>

      {/* Description (web L80-83) */}
      <AppText numberOfLines={2} style={styles.badgeDesc}>
        {achievement.description}
      </AppText>

      {/* Progress or unlocked status (web L85-94) */}
      {achievement.unlocked ? (
        <AppText style={styles.badgeUnlockedLabel}>
          {t('lifetime.unlocked', '✓ Unlocked')}
        </AppText>
      ) : (
        <AppText style={styles.badgePct}>{pct}%</AppText>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  RecentlyUnlockedAchievementsWidget (web L31-115)                   */
/* ------------------------------------------------------------------ */

interface RecentlyUnlockedAchievementsWidgetProps extends WidgetProps {
  /**
   * Native bridge for the web react-router useNavigate(). Invoked with the
   * `/lifetime?achievement=...` deep-link path when a badge is pressed. The web
   * file takes only WidgetProps; this is the sole native-navigation addition.
   * Without it a press is an explicit no-op.
   */
  onNavigate?: (to: string) => void;
}

export default function RecentlyUnlockedAchievementsWidget({
  vehicleId,
  size,
  onNavigate,
}: RecentlyUnlockedAchievementsWidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const prefs = useAchievementCelebrationPrefs();

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useLifetimeStats(id > 0 ? String(id) : undefined);

  const isWide = size.cols >= 3;
  const limit = isWide ? 5 : 3;

  const recent = useMemo(() => {
    const all = data?.achievements ?? [];
    return all
      .filter(a => a.unlocked && a.unlocked_at)
      .sort((a, b) => {
        const ta = a.unlocked_at ? Date.parse(a.unlocked_at) : 0;
        const tb = b.unlocked_at ? Date.parse(b.unlocked_at) : 0;
        return tb - ta;
      })
      .slice(0, limit);
  }, [data?.achievements, limit]);

  const title = t('widget.recentlyUnlocked.title', 'Recently Unlocked');
  const icon = <AppText style={styles.titleIcon}>{ICON_TROPHY}</AppText>;

  if (!prefs.showOnDashboard) {
    return (
      <WidgetShell icon={icon} title={title} updatedAt={dataUpdatedAt}>
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_TROPHY}</AppText>}
          message={t(
            'widget.recentlyUnlocked.disabled',
            'Recently unlocked achievements are hidden in your settings.',
          )}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={icon}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={title}
      updatedAt={dataUpdatedAt}>
      {recent.length > 0 ? (
        <View style={styles.list} testID="recently-unlocked-list">
          {recent.map(a => (
            <Pressable
              key={a.id}
              accessibilityLabel={t(
                'achievements.viewNamed',
                'View achievement: {{name}}',
                {name: a.name},
              )}
              accessibilityRole="button"
              onPress={() =>
                onNavigate?.(
                  `/lifetime?achievement=${encodeURIComponent(a.id)}`,
                )
              }
              style={({pressed}) => [
                styles.listItemButton,
                pressed ? styles.listItemButtonPressed : null,
              ]}>
              <AchievementBadge achievement={a} size="sm" />
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_TROPHY}</AppText>}
          message={t(
            'achievements.noneYet',
            'Drive, charge, and explore — achievements will appear here as you unlock them',
          )}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'column',
    padding: spacing.md,
    position: 'relative',
  },
  badgeCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeDesc: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  badgeIcon: {
    textAlign: 'center',
  },
  badgeIconLocked: {
    opacity: 0.5,
    position: 'absolute',
  },
  badgeLocked: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  badgeName: {
    textAlign: 'center',
  },
  badgeNameLocked: {
    color: colors.textSecondary,
  },
  badgeNameUnlocked: {
    color: YELLOW_400,
  },
  badgePct: {
    color: colors.textMuted,
    fontSize: 12,
  },
  badgeUnlocked: {
    backgroundColor: YELLOW_500_08,
    borderColor: YELLOW_500_30,
  },
  badgeUnlockedLabel: {
    color: YELLOW_500_70,
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
  list: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  listItemButton: {
    borderRadius: 8,
    padding: spacing.xs,
  },
  listItemButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  ringSegment: {
    borderRadius: 2,
    opacity: 1,
    position: 'absolute',
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
  titleIcon: {
    color: AMBER_400,
    fontSize: 13,
    lineHeight: 16,
  },
});
