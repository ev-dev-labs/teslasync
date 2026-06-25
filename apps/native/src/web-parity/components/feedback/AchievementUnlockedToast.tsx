// Native parity port of web/src/components/feedback/AchievementUnlockedToast.tsx.
//
// The web component is a wider-than-normal celebratory toast that announces a
// locked -> unlocked transition. It composes framer-motion (spring entry +
// confetti burst), react-router-dom (programmatic navigate), react-i18next, the
// lucide `Trophy`/`X` glyphs, and the `AchievementBadge` feature component, all
// inside a Tailwind `<div>` stack. This native version reproduces the same public
// contract (event / onDismiss / durationMs for the toast; events / onDismiss for
// the stack) and the same visual + behavioural intent using React Native
// primitives, the existing AppText + design tokens, and the native Animated API.
//
// Browser-only dependencies are reduced explicitly and documented in the sidecar:
//   - framer-motion `motion`/`AnimatePresence`: the spring entry (opacity + y +
//     scale) and the ~2.5s confetti burst are reproduced with React Native
//     `Animated` + `Easing.bezier`, honouring reduced motion (no confetti, no
//     scale tween, immediate visible state). RN has no AnimatePresence, so the
//     exit choreography is not ported -- the stack drops the event and the toast
//     unmounts immediately (the auto-dismiss + manual dismiss behaviour is kept).
//   - react-router-dom `useNavigate`: replaced by an optional `onNavigate(path)`
//     bridge prop (the established native pattern) so a native navigator can wire
//     `/lifetime?achievement=<id>`. Without it, "View" still dismisses (no-op nav,
//     explicit unavailable state).
//   - react-i18next `useTranslation`: replaced by a native-safe `t(key, default)`
//     fallback that returns the English default string.
//   - lucide `Trophy`/`X`: rendered as decorative AppText glyphs.
//   - `AchievementBadge` (+ its `ProgressRing`): no native parity port exists yet,
//     so both are reproduced inline as native-safe local components preserving the
//     size config, locked/unlocked styling, progress percentage, and "Unlocked"
//     status. The web CSS `grayscale` filter on a locked icon has no RN equivalent,
//     so it is approximated with reduced opacity. RN has no `backdrop-blur`, so the
//     glass surface is a translucent fill.

import React, {useEffect, useMemo, useRef} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import type {
  AchievementUnlockedEvent,
  LifetimeAchievement,
} from '../../api/hooks/useAchievementUnlocks';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTFunction = (key: string, defaultValue: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue) => defaultValue).current;
}

// ── reduced-motion preference (native-safe port of useMotionPreference) ──
// Web reads framer-motion's prefers-reduced-motion; native reads the OS flag via
// AccessibilityInfo and coalesces the initial tri-state to `false`.
function useReduceMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduce;
}

// ── palette (ported from the web Tailwind yellow ramp + text CSS vars) ──
const YELLOW_500 = '#eab308';
const YELLOW_400 = '#facc15';
const YELLOW_300 = '#fde047';
const GRAY_500 = '#6b7280';

const YELLOW_300_90 = 'rgba(253, 224, 71, 0.9)';
const YELLOW_500_70 = 'rgba(234, 179, 8, 0.7)';
const YELLOW_500_40 = 'rgba(234, 179, 8, 0.4)';
const YELLOW_500_30 = 'rgba(234, 179, 8, 0.3)';
const YELLOW_500_08 = 'rgba(234, 179, 8, 0.08)';
const WHITE_03 = 'rgba(255, 255, 255, 0.03)';
const WHITE_06 = 'rgba(255, 255, 255, 0.06)';

// ───────────────────────────── ProgressRing ─────────────────────────────
// Native-safe port of the web `ProgressRing` slice consumed by AchievementBadge.
// RN has no SVG stroke-dash arc, so the ring is approximated with positioned
// View segments (same technique as the native RadialGauge port).
const RING_SEGMENT_COUNT = 48;
const RING_START_ANGLE = -90;
const RING_FULL_TURN = 360;

interface ProgressRingProps {
  value: number;
  max: number;
  size: number;
  strokeWidth: number;
  color: string;
}

interface RingSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
}

function buildRingSegments(size: number, strokeWidth: number): RingSegment[] {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;

  return Array.from({length: RING_SEGMENT_COUNT}, (_, index) => {
    const angle =
      RING_START_ANGLE + (index / RING_SEGMENT_COUNT) * RING_FULL_TURN;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - strokeWidth / 2;
    const top = center + radius * Math.sin(radians) - strokeWidth / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `${index}-${left}-${top}`,
      left,
      top,
    };
  });
}

function ProgressRing({value, max, size, strokeWidth, color}: ProgressRingProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const clamped = Math.max(
    0,
    Math.min(Number.isFinite(value) ? value : 0, safeMax),
  );
  const progress = safeMax > 0 ? clamped / safeMax : 0;
  const segments = useMemo(
    () => buildRingSegments(size, strokeWidth),
    [size, strokeWidth],
  );
  const activeSegmentCount = Math.round(progress * RING_SEGMENT_COUNT);

  return (
    <View pointerEvents="none" style={{height: size, width: size}}>
      {segments.map((segment, index) => (
        <View
          key={segment.key}
          style={[
            styles.ringSegment,
            {
              backgroundColor:
                index < activeSegmentCount ? color : colors.border,
              borderRadius: strokeWidth / 2,
              height: strokeWidth,
              left: segment.left,
              top: segment.top,
              transform: [{rotateZ: segment.angle}],
              width: strokeWidth,
            },
          ]}
        />
      ))}
    </View>
  );
}

// ──────────────────────────── AchievementBadge ───────────────────────────
// Native-safe port of web/src/features/analytics/components/AchievementBadge.tsx.
export interface AchievementBadgeProps {
  achievement: LifetimeAchievement;
  size?: 'sm' | 'md' | 'lg';
}

interface BadgeSizeConfig {
  ring: number;
  stroke: number;
  iconSize: number;
  gap: number;
  textSize: number;
}

// Web sizeConfig mapped to px: text-xl=20, text-3xl=30, text-4xl=36;
// gap-1=4, gap-2=8, gap-3=12; text-xs=12, text-sm=14, text-base=16.
const BADGE_SIZE_CONFIG: Record<
  NonNullable<AchievementBadgeProps['size']>,
  BadgeSizeConfig
> = {
  sm: {ring: 56, stroke: 3, iconSize: 20, gap: 4, textSize: 12},
  md: {ring: 72, stroke: 4, iconSize: 30, gap: 8, textSize: 14},
  lg: {ring: 96, stroke: 5, iconSize: 36, gap: 12, textSize: 16},
};

export function AchievementBadge({
  achievement,
  size = 'md',
}: AchievementBadgeProps) {
  const t = useNativeTranslationFallback();
  const cfg = BADGE_SIZE_CONFIG[size];
  const isNearComplete = !achievement.unlocked && achievement.progress >= 0.8;
  const pct = Math.round(achievement.progress * 100);

  // Web uses `animate-pulse` on the near-complete locked badge; reproduce a
  // looping opacity pulse with Animated.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isNearComplete) {
      pulse.setValue(1);
      return;
    }

    pulse.setValue(1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.5,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [isNearComplete, pulse]);

  return (
    <Animated.View
      style={[
        styles.badge,
        {gap: cfg.gap},
        achievement.unlocked ? styles.badgeUnlocked : styles.badgeLocked,
        isNearComplete ? {opacity: pulse} : null,
      ]}>
      <View
        style={[
          styles.badgeCircle,
          {height: cfg.ring, width: cfg.ring},
        ]}>
        {!achievement.unlocked ? (
          <ProgressRing
            color={isNearComplete ? YELLOW_500 : GRAY_500}
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

      <AppText
        numberOfLines={2}
        style={[
          styles.badgeName,
          {fontSize: cfg.textSize},
          achievement.unlocked ? styles.badgeNameUnlocked : styles.badgeNameLocked,
        ]}>
        {achievement.name}
      </AppText>

      <AppText numberOfLines={2} style={styles.badgeDescription}>
        {achievement.description}
      </AppText>

      {achievement.unlocked ? (
        <AppText style={styles.badgeUnlockedLabel}>
          {t('lifetime.unlocked', '✓ Unlocked')}
        </AppText>
      ) : (
        <AppText style={styles.badgeProgress}>{`${pct}%`}</AppText>
      )}
    </Animated.View>
  );
}

AchievementBadge.displayName = 'AchievementBadge';

// ───────────────────────────────── Confetti ──────────────────────────────
interface ConfettiParticle {
  id: number;
  // final translate offsets in px (initial position is the badge centre).
  vx: number;
  vy: number;
  rotate: number;
  delaySec: number;
}

const CONFETTI_COUNT = 24;
const CONFETTI_DURATION_SEC = 2.5;

function buildConfettiParticles(): ConfettiParticle[] {
  // Deterministic PRNG would be overkill — confetti spread is purely visual.
  return Array.from({length: CONFETTI_COUNT}, (_, i) => ({
    id: i,
    vx: (Math.random() - 0.5) * 280,
    vy: -(Math.random() * 160 + 60),
    rotate: (Math.random() - 0.5) * 720,
    delaySec: Math.random() * 0.25,
  }));
}

function ConfettiBurst({
  particles,
  icon,
}: {
  particles: ConfettiParticle[];
  icon: string;
}) {
  // One progress value per particle; final identity is stable for this mount.
  const progress = useMemo(
    () => particles.map(() => new Animated.Value(0)),
    [particles],
  );

  useEffect(() => {
    const animations = particles.map((p, i) =>
      Animated.timing(progress[i], {
        delay: p.delaySec * 1000,
        duration: CONFETTI_DURATION_SEC * 1000,
        easing: Easing.bezier(0.16, 0.84, 0.44, 1),
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const group = Animated.parallel(animations);
    group.start();
    return () => group.stop();
  }, [particles, progress]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.confettiLayer}>
      {particles.map((p, i) => {
        const driver = progress[i];
        return (
          <Animated.Text
            key={p.id}
            style={[
              styles.confettiParticle,
              {
                opacity: driver.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0],
                }),
                transform: [
                  {
                    translateX: driver.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, p.vx],
                    }),
                  },
                  {
                    translateY: driver.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, p.vy],
                    }),
                  },
                  {
                    rotate: driver.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', `${p.rotate}deg`],
                    }),
                  },
                ],
              },
            ]}>
            {icon || '🎉'}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// ───────────────────────── AchievementUnlockedToast ──────────────────────
export interface AchievementUnlockedToastProps {
  event: AchievementUnlockedEvent;
  /** Called when the user dismisses the toast or auto-dismiss elapses. */
  onDismiss: () => void;
  /** Auto-dismiss delay in milliseconds. Defaults to 6000. */
  durationMs?: number;
  /**
   * Native bridge for the web react-router navigate. Invoked with
   * `/lifetime?achievement=<id>` when "View" is pressed. Without it, "View"
   * still dismisses the toast (no-op navigation).
   */
  onNavigate?: (path: string) => void;
}

/**
 * AchievementUnlockedToast — a wider-than-normal toast that celebrates a
 * locked → unlocked transition.
 *
 * Layout: [ AchievementBadge size="md" ] [ name + description + View ] [ × ].
 *
 * Motion: spring entry, confetti burst of the achievement emoji, reduced-motion
 * fallback (fade only, no confetti). Accessibility: role=status / aria-live
 * polite → accessibilityRole + accessibilityLiveRegion so the unlock is
 * announced without interrupting the user.
 */
export function AchievementUnlockedToast({
  event,
  onDismiss,
  durationMs = 6000,
  onNavigate,
}: AchievementUnlockedToastProps) {
  const t = useNativeTranslationFallback();
  const reduce = useReduceMotion();
  const {width} = useWindowDimensions();

  // One stable particle set per mount; new toasts get a fresh set.
  const particles = useMemo<ConfettiParticle[]>(
    () => (reduce ? [] : buildConfettiParticles()),
    [reduce],
  );

  // Spring entry (opacity + y + scale). Reduced motion renders the final state
  // immediately, matching framer-motion's `initial={false}`.
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      return;
    }

    enter.setValue(0);
    const animation = Animated.spring(enter, {
      bounciness: 8,
      speed: 12,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter, reduce]);

  // Auto-dismiss timer.
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, durationMs);
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, [durationMs, onDismiss]);

  function handleView() {
    onDismiss();
    onNavigate?.(
      `/lifetime?achievement=${encodeURIComponent(event.achievement.id)}`,
    );
  }

  const toastWidth = Math.min(360, width - 2 * spacing.lg);
  const animatedStyle: StyleProp<ViewStyle> = reduce
    ? {opacity: enter}
    : {
        opacity: enter,
        transform: [
          {translateY: enter.interpolate({inputRange: [0, 1], outputRange: [20, 0]})},
          {scale: enter.interpolate({inputRange: [0, 1], outputRange: [0.95, 1]})},
        ],
      };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      accessible
      style={[styles.toast, {width: toastWidth}, animatedStyle]}
      testID="achievement-unlocked-toast">
      {particles.length > 0 ? (
        <ConfettiBurst icon={event.achievement.icon} particles={particles} />
      ) : null}

      <View style={styles.toastRow}>
        <View style={styles.badgeSlot}>
          <AchievementBadge achievement={event.achievement} size="md" />
        </View>

        <View style={styles.body}>
          <View style={styles.eyebrowRow}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.trophyGlyph}>
              🏆
            </AppText>
            <AppText style={styles.eyebrow}>
              {t('achievements.toastEyebrow', 'Achievement Unlocked')}
            </AppText>
          </View>

          <AppText style={styles.name}>{event.achievement.name}</AppText>

          <AppText numberOfLines={2} style={styles.description}>
            {event.achievement.description}
          </AppText>

          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleView}
            style={({pressed}) => (pressed ? styles.viewPressed : undefined)}>
            <AppText style={styles.viewLabel}>
              {`${t('achievements.view', 'View')} \u2192`}
            </AppText>
          </Pressable>
        </View>

        <Pressable
          accessibilityLabel={t(
            'achievements.dismiss',
            'Dismiss achievement notification',
          )}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDismiss}
          style={({pressed}) => [
            styles.dismiss,
            pressed ? styles.dismissPressed : null,
          ]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.dismissGlyph}>
            {'\u2715'}
          </AppText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

AchievementUnlockedToast.displayName = 'AchievementUnlockedToast';

// ─────────────────────── AchievementUnlockedToastStack ───────────────────
/**
 * AchievementUnlockedToastStack — fixed-position container that renders one
 * `AchievementUnlockedToast` per pending event, stacked vertically. Sits in the
 * top-right corner (its own area, away from the standard mutation toasts).
 *
 * RN has no AnimatePresence, so removal is immediate when an event leaves the
 * list (entry animation is preserved per-toast); the per-event dismiss contract
 * is unchanged.
 */
export interface AchievementUnlockedToastStackProps {
  events: AchievementUnlockedEvent[];
  onDismiss: (achievementId: string) => void;
  /** Threaded through to each toast's "View" affordance. */
  onNavigate?: (path: string) => void;
}

export function AchievementUnlockedToastStack({
  events,
  onDismiss,
  onNavigate,
}: AchievementUnlockedToastStackProps) {
  return (
    <View
      pointerEvents="box-none"
      style={styles.stack}
      testID="achievement-unlocked-toast-stack">
      {events.map(e => (
        <AchievementUnlockedToast
          key={e.achievement.id}
          event={e}
          onDismiss={() => onDismiss(e.achievement.id)}
          onNavigate={onNavigate}
        />
      ))}
    </View>
  );
}

AchievementUnlockedToastStack.displayName = 'AchievementUnlockedToastStack';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'column',
    padding: spacing.md,
  },
  badgeCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badgeDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
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
    backgroundColor: WHITE_03,
    borderColor: WHITE_06,
  },
  badgeName: {
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  badgeNameLocked: {
    color: colors.textSecondary,
  },
  badgeNameUnlocked: {
    color: YELLOW_400,
  },
  badgeProgress: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  badgeSlot: {
    flexShrink: 0,
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
    flex: 1,
    minWidth: 0,
  },
  confettiLayer: {
    left: 48,
    position: 'absolute',
    top: 48,
    zIndex: 10,
  },
  confettiParticle: {
    fontSize: 16,
    position: 'absolute',
  },
  description: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  dismiss: {
    borderRadius: 8,
    flexShrink: 0,
    padding: 6,
  },
  dismissGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  dismissPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  eyebrow: {
    color: YELLOW_300_90,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  eyebrowRow: {
    alignItems: 'center',
    columnGap: 6,
    flexDirection: 'row',
  },
  name: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  ringSegment: {
    position: 'absolute',
  },
  stack: {
    gap: spacing.md,
    position: 'absolute',
    right: spacing.lg,
    top: spacing.lg,
    zIndex: 110,
  },
  toast: {
    backgroundColor: WHITE_03,
    borderColor: YELLOW_500_40,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'visible',
    padding: 16,
    position: 'relative',
    shadowColor: YELLOW_500,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  toastRow: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  trophyGlyph: {
    color: YELLOW_300,
    fontSize: 12,
    lineHeight: 14,
  },
  viewLabel: {
    color: YELLOW_300,
    fontSize: 12,
    fontWeight: '500',
    marginTop: spacing.sm,
  },
  viewPressed: {
    opacity: 0.7,
  },
});
