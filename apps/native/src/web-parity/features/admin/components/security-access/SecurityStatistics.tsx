// Native parity port of
// web/src/features/admin/components/security-access/SecurityStatistics.tsx.
//
// The web source renders the "Security Statistics" panel for the admin
// security-access view: a FadeIn-wrapped GlassPanel with a heading and a
// responsive grid (2 columns by default, 3 at Tailwind `sm`, 4 at `lg`) of up to
// seven shared web MetricCards -- lock/unlock events, sentry uptime, door opens,
// window opens, HomeLink detections, guest-mode usage, and total events -- each
// with a lucide-react glyph in a coloured chip. While loading it shows seven
// pulsing Skeleton blocks in the same grid; when `securityStats` is null it shows
// a shared EmptyState (Activity glyph + "No data available"). It composes the
// shared web MetricCard, Skeleton, EmptyState, GlassPanel, and FadeIn components,
// the lucide-react Lock/Eye/DoorOpen/Car/Home/UserCheck/Activity glyphs, the
// `fmtInt` locale integer formatter, react-i18next, and the `SecurityStats` type
// imported from `./helpers`.
//
// None of those shared web components have a native parity port yet (and lucide,
// framer-motion, and the DOM grid are browser-only), so -- mirroring how the
// sibling StatusHeader port inlines its StatCard/AlertBanner/Grid -- this
// self-contained port rebuilds each piece with React Native primitives and the
// existing native tokens/components:
//   * MetricCard becomes a native `MetricCardView`: a plain translucent rounded
//     card (matching the web `bg-white/[0.02] border-white/[0.04] rounded-xl p-3`
//     sub-card, NOT a GlassPanel) with a truncated muted label, a large bold
//     value, and a coloured icon chip whose bg/ring use the web neon hue and
//     whose glyph uses the web `neonColorMap` toned-down `-300` text colour.
//   * The lucide Lock/Eye/DoorOpen/Car/Home/UserCheck/Activity glyphs map to the
//     nearest repo SemanticIcon names (locked / security / doorOpen / vehicle /
//     home / userCheck / activity); the 2-letter glyph string is read via
//     getSemanticIconDefinition so no lucide-react/DOM import is needed.
//   * The Tailwind `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3` is
//     reproduced with a flex-wrap row whose per-cell percentage width is driven
//     by `useWindowDimensions` against the Tailwind sm (640px) / lg (1024px)
//     breakpoints, using the negative-margin gutter trick for the gap-3 spacing.
//   * Skeleton (height 80, animate-pulse) becomes a reduced-motion-aware
//     Animated opacity pulse over dark `gray-700` blocks (mirroring
//     PageLoadSkeleton's pulse).
//   * EmptyState becomes an inline centred column: the Activity glyph rendered as
//     bare muted text at opacity 0.2 (matching the web bare `text-[var(--text-
//     muted)]` + `opacity-20` icon) above the muted message.
//   * FadeIn `delay={0.25}` becomes a reduced-motion-aware Animated opacity +
//     translateY(12->0) entry over 400ms after a 250ms delay (the web
//     useMotionPreference(400) duration), suppressed under reduce-motion.
//   * `fmtInt` (== fmtNumber(v, 0): locale-grouped, rounded to an integer) maps
//     to a local Intl-based `formatInt` using the web default global locale
//     ('en-US'); only the sentry-uptime value is formatted, exactly as the web
//     does -- the other six numeric values are rendered verbatim like the web
//     MetricCard's direct `{value}` render.
//   * react-i18next is replaced by a self-contained fallback that preserves every
//     i18n key and English fallback string.
//   * `SecurityStats` (imported from `./helpers` on the web) is mirrored as a
//     local interface because the native `./helpers` port does not exist yet in
//     this file-by-file loop; the field set matches the web shape exactly.
//
// No DOM, no lucide-react, no framer-motion, no Recharts/Leaflet, and no web UI
// components are imported.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for the panel title, every metric label, and the
// empty-state message.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the web `./helpers` `SecurityStats` export. The native helpers
// port does not exist yet in this file-by-file conversion loop, so the shape is
// reproduced here field-for-field (all six counts) to keep the port
// self-contained and type-checked.
interface SecurityStats {
  lockEvents: number;
  doorOpenCount: number;
  windowOpenCount: number;
  homelinkCount: number;
  guestCount: number;
  total: number;
}

// Parity for the web `fmtInt` (== fmtNumber(v, 0)): a locale-grouped integer,
// rounded to zero fraction digits, with non-finite inputs coerced to 0 (the web
// `safeNumber` behaviour). The web default global locale is 'en-US' (set by
// useSettings, which native has not wired), so 'en-US' is used here.
function formatInt(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}

type MetricColor = 'amber' | 'blue' | 'cyan' | 'green' | 'purple';

// Web `neonColorMap` (web/src/lib/tokens.ts) translated to RN colour literals.
// `text` is the toned-down `-300` glyph colour the web MetricCard applies via
// `c.text`; `bg`/`ring` are the neon hue at /10 and /20 alpha for the icon chip.
const METRIC_COLORS: Record<MetricColor, {bg: string; ring: string; text: string}> = {
  cyan: {text: '#67e8f9', bg: 'rgba(0, 240, 255, 0.1)', ring: 'rgba(0, 240, 255, 0.2)'},
  green: {text: '#6ee7b7', bg: 'rgba(16, 185, 129, 0.1)', ring: 'rgba(16, 185, 129, 0.2)'},
  amber: {text: '#fcd34d', bg: 'rgba(245, 158, 11, 0.1)', ring: 'rgba(245, 158, 11, 0.2)'},
  purple: {text: '#d8b4fe', bg: 'rgba(168, 85, 247, 0.1)', ring: 'rgba(168, 85, 247, 0.2)'},
  blue: {text: '#a5b4fc', bg: 'rgba(79, 70, 229, 0.1)', ring: 'rgba(79, 70, 229, 0.2)'},
};

// gap-3 == 0.75rem == 12px. Reproduced with the negative-margin gutter trick.
const GRID_GAP = 12;
const HALF_GAP = GRID_GAP / 2;

// Tailwind responsive grid breakpoints: grid-cols-2 (base) -> sm:grid-cols-3
// (640px) -> lg:grid-cols-4 (1024px).
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;

// text-gray-200.
const TITLE_COLOR = '#e5e7eb';
// bg-gray-700 (dark-theme Skeleton fill).
const SKELETON_COLOR = '#374151';

// FadeIn delay={0.25} (250ms) over the web useMotionPreference(400) duration,
// sliding up from y:12 to y:0 with opacity 0 -> 1.
const FADE_DELAY_MS = 250;
const FADE_DURATION_MS = 400;
const FADE_TRANSLATE_Y = 12;

// Tailwind animate-pulse: a 2s ease-in-out opacity keyframe (1 -> .5 -> 1).
const PULSE_DURATION_MS = 2000;
const PULSE_MIN_OPACITY = 0.5;

// Seven Skeleton blocks, height={80}, while loading.
const SKELETON_COUNT = 7;
const SKELETON_HEIGHT = 80;

// EmptyState Activity icon: h-8 w-8 (32px) at opacity-20.
const EMPTY_ICON_SIZE = 32;
const EMPTY_ICON_OPACITY = 0.2;

interface MetricCardData {
  color: MetricColor;
  icon: SemanticIconName;
  id: string;
  label: string;
  value: string;
}

// Builds the seven metric descriptors, preserving each web MetricCard's label
// key/fallback, value source, icon, and colour. Only the sentry-uptime value is
// run through formatInt (+'%'); the other six render the raw count exactly as the
// web MetricCard renders a numeric `value` via `{value}`.
function buildCards(
  t: NativeTFunction,
  stats: SecurityStats,
  sentryUptime: number,
): MetricCardData[] {
  return [
    {
      id: 'lockEvents',
      label: t('admin.security.stats.lockEvents', 'Lock/Unlock Events'),
      value: String(stats.lockEvents),
      icon: 'locked',
      color: 'green',
    },
    {
      id: 'sentryUptime',
      label: t('admin.security.stats.sentryUptime', 'Sentry Uptime'),
      value: `${formatInt(sentryUptime)}%`,
      icon: 'security',
      color: 'blue',
    },
    {
      id: 'doorOpens',
      label: t('admin.security.stats.doorOpens', 'Door Open Events'),
      value: String(stats.doorOpenCount),
      icon: 'doorOpen',
      color: 'amber',
    },
    {
      id: 'windowOpens',
      label: t('admin.security.stats.windowOpens', 'Window Open Events'),
      value: String(stats.windowOpenCount),
      icon: 'vehicle',
      color: 'amber',
    },
    {
      id: 'homelink',
      label: t('admin.security.stats.homelink', 'HomeLink Detections'),
      value: String(stats.homelinkCount),
      icon: 'home',
      color: 'purple',
    },
    {
      id: 'guestMode',
      label: t('admin.security.stats.guestMode', 'Guest Mode Usage'),
      value: String(stats.guestCount),
      icon: 'userCheck',
      color: 'amber',
    },
    {
      id: 'totalEvents',
      label: t('admin.security.stats.totalEvents', 'Total Events'),
      value: String(stats.total),
      icon: 'activity',
      color: 'cyan',
    },
  ];
}

// Mirror of PageLoadSkeleton's reduce-motion probe: resolves the OS "reduce
// motion" accessibility setting and keeps it live so the FadeIn entry and the
// skeleton pulse can be suppressed for motion-sensitive users (matching the web
// `prefers-reduced-motion` behaviour).
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

// Native recreation of the web FadeIn entry (framer-motion opacity 0 -> 1 +
// y 12 -> 0, easeOut, after `delayMs`). Under reduce-motion it renders in the
// final state with no animation, matching FadeIn's `initial={reduce ? false}`.
function useFadeIn(delayMs: number, reduceMotion: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      delay: delayMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [progress, delayMs, reduceMotion]);

  return progress;
}

// Native recreation of the Tailwind animate-pulse opacity keyframe applied to
// each loading Skeleton. Stays solid when disabled (not loading, or reduce
// motion is on).
function usePulse(enabled: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!enabled) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_DURATION_MS / 2,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_DURATION_MS / 2,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse, enabled]);

  return pulse;
}

// Reproduces grid-cols-2 / sm:grid-cols-3 / lg:grid-cols-4 against the live
// viewport width.
function useGridColumns(): number {
  const {width} = useWindowDimensions();
  if (width >= LG_BREAKPOINT) {
    return 4;
  }
  if (width >= SM_BREAKPOINT) {
    return 3;
  }
  return 2;
}

// Lays children out in a responsive flex-wrap grid with gap-3 gutters (via the
// negative-margin trick), wrapping each child in a percentage-width cell.
function StatGrid({children}: {children: React.ReactNode}) {
  const columns = useGridColumns();

  return (
    <View style={styles.grid}>
      {React.Children.map(children, child => (
        <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
          {child}
        </View>
      ))}
    </View>
  );
}

// Native parity for the web shared MetricCard (label + large value on the left,
// a coloured icon chip on the right) on a plain translucent rounded sub-card.
function MetricCardView({
  color,
  icon,
  label,
  value,
}: Omit<MetricCardData, 'id'>) {
  const palette = METRIC_COLORS[color];
  const glyph = getSemanticIconDefinition(icon).glyph;

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardTextCol}>
          <AppText numberOfLines={1} style={styles.cardLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.cardValue} weight="bold">
            {value}
          </AppText>
        </View>
        <View
          style={[
            styles.iconChip,
            {backgroundColor: palette.bg, borderColor: palette.ring},
          ]}>
          <AppText style={[styles.iconGlyph, {color: palette.text}]} weight="bold">
            {glyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

// Native parity for the web shared EmptyState (centred icon + message). The web
// Activity icon is a bare muted glyph at opacity-20, reproduced here as bare
// muted text rather than a bordered SemanticIcon chip.
function EmptyStateView({message}: {message: string}) {
  const glyph = getSemanticIconDefinition('activity').glyph;

  return (
    <View accessibilityRole="text" style={styles.empty}>
      <AppText style={styles.emptyIcon} tone="muted">
        {glyph}
      </AppText>
      <AppText style={styles.emptyMessage} tone="secondary">
        {message}
      </AppText>
    </View>
  );
}

export interface SecurityStatisticsProps {
  isLoading: boolean;
  securityStats: SecurityStats | null;
  sentryUptime: number;
}

export function SecurityStatistics({
  securityStats,
  sentryUptime,
  isLoading,
}: SecurityStatisticsProps) {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();
  const fade = useFadeIn(FADE_DELAY_MS, reduceMotion);
  const pulseEnabled = isLoading && !reduceMotion;
  const pulse = usePulse(pulseEnabled);

  const fadeStyle = {
    opacity: fade,
    transform: [
      {
        translateY: fade.interpolate({
          inputRange: [0, 1],
          outputRange: [FADE_TRANSLATE_Y, 0],
        }),
      },
    ],
  };

  const pulseStyle = pulseEnabled
    ? {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, PULSE_MIN_OPACITY],
        }),
      }
    : undefined;

  const cards = securityStats
    ? buildCards(t, securityStats, sentryUptime)
    : [];

  return (
    <Animated.View style={fadeStyle}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.title} weight="semibold">
          {t('admin.security.statsTitle', 'Security Statistics')}
        </AppText>
        {isLoading ? (
          <StatGrid>
            {Array.from({length: SKELETON_COUNT}).map((_, i) => (
              <Animated.View key={i} style={[styles.skeleton, pulseStyle]} />
            ))}
          </StatGrid>
        ) : securityStats ? (
          <StatGrid>
            {cards.map(card => (
              <MetricCardView
                key={card.id}
                color={card.color}
                icon={card.icon}
                label={card.label}
                value={card.value}
              />
            ))}
          </StatGrid>
        ) : (
          <EmptyStateView message={t('common.noData', 'No data available')} />
        )}
      </GlassPanel>
    </Animated.View>
  );
}

SecurityStatistics.displayName = 'SecurityStatistics';

const styles = StyleSheet.create({
  // GlassPanel p-4 mb-6.
  panel: {
    padding: 16,
    marginBottom: 24,
  },
  // text-lg font-semibold text-gray-200 mb-4.
  title: {
    fontSize: 18,
    lineHeight: 28,
    color: TITLE_COLOR,
    marginBottom: 16,
  },
  // grid ... gap-3, via the negative-margin gutter trick.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -HALF_GAP,
  },
  gridCell: {
    padding: HALF_GAP,
  },
  // bg-white/[0.02] border border-white/[0.04] rounded-xl p-3.
  card: {
    width: '100%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // flex items-start justify-between gap-2.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  // flex-1 min-w-0.
  cardTextCol: {
    flex: 1,
    minWidth: 0,
  },
  // metric-label mb-1 text-[10px] truncate.
  cardLabel: {
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 4,
  },
  // text-xl font-bold tracking-tight text-[var(--text-primary)].
  cardValue: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  // rounded-lg p-1.5 ring-1 chip around the glyph.
  iconChip: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  // Skeleton height={80}, rounded, animate-pulse fill.
  skeleton: {
    width: '100%',
    height: SKELETON_HEIGHT,
    borderRadius: 4,
    backgroundColor: SKELETON_COLOR,
  },
  // EmptyState flex flex-col items-center justify-center py-8 text-center.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  // The bare muted Activity glyph (mb-4, opacity-20, h-8 w-8).
  emptyIcon: {
    fontSize: EMPTY_ICON_SIZE,
    lineHeight: EMPTY_ICON_SIZE + 4,
    opacity: EMPTY_ICON_OPACITY,
    marginBottom: 16,
  },
  // Text variant="bodySm" max-w-md, centred.
  emptyMessage: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 448,
  },
});
