// Native parity port of
// web/src/features/analytics/components/AchievementBadge.tsx.
//
// `AchievementBadge` renders a single gamification badge: a circular icon area
// (a progress ring behind a greyed emoji while locked, or the full-colour emoji
// once unlocked) stacked above the achievement name, its description, and either
// an "✓ Unlocked" line or the percent-complete. Three `size` presets (sm/md/lg)
// scale the ring, stroke, icon, gap, and name type. Behaviour is preserved
// verbatim: `isNearComplete` (locked AND progress >= 0.8) drives both the pulse
// and the ring colour, and `pct = round(progress * 100)` feeds the ring value
// and the percent label.
//
// The web source pulls three modules; native-safe mapping (contract rules 4-7):
//   - `cn` from `@/lib/cn` (L1) only merged Tailwind class strings; React Native
//     has no className, so every `cn(...)` call is dropped and its static +
//     conditional classes become StyleSheet styles / inline style arrays (same
//     approach as the sibling data-display / admin ports).
//   - `ProgressRing` from `@/components/data-display` (L2) has no native parity
//     surface yet and is implemented with an SVG <circle> stroke-dash arc, which
//     React Native cannot render (there is no `react-native-svg` dependency — see
//     the RadialGauge port). It is therefore inlined here as a native-safe
//     `AchievementProgressRing` that approximates the ring with positioned View
//     segments (track + coloured progress arc), the exact same technique the
//     existing `components/charts/RadialGauge` native port uses. Only the props
//     this call site passes (value/max/size/strokeWidth/color) are modelled.
//   - react-i18next `useTranslation` (L3) is absent from the native deps, so it
//     is the standard local shim returning the inline English fallback; the
//     `lifetime.unlocked` key is still referenced so i18n intent is preserved.
//
// DOM -> native element mapping:
//   - outer `<div class="relative flex flex-col items-center rounded-xl p-3
//     transition-all ... {gap} {locked/unlocked surface} {animate-pulse}">` ->
//     an `Animated.View` column (alignItems center, borderRadius 12, padding 12,
//     gap per-size, locked/unlocked surface+border). CSS `transition-all
//     duration-normal` has no RN analog and is dropped. `animate-pulse` (only
//     when `isNearComplete`) is reproduced with an `Animated.loop` oscillating
//     the container opacity 1 -> 0.5 -> 1; like CSS opacity it compounds with the
//     locked icon's 0.5, matching the web.
//   - badge-circle `<div class="relative">` -> a View; when locked it is sized to
//     the ring and overlays the centred icon on top of `AchievementProgressRing`,
//     when unlocked it simply wraps the full-colour emoji (no ring), mirroring the
//     web where the ring is omitted and the icon sits in normal flow.
//   - icon `<span class="{iconSize} select-none {absolute inset-0 flex
//     items-center justify-center opacity-50 grayscale when locked}" role="img"
//     aria-label={name}>` -> an `AppText` glyph (fontSize/lineHeight per-size,
//     accessibilityRole="image", accessibilityLabel={name}). `select-none` is a
//     no-op on native. `opacity-50` -> opacity 0.5 while locked. The CSS
//     `grayscale` filter has no React Native equivalent for colour emoji, so the
//     locked icon is dimmed (opacity) but NOT desaturated — documented as
//     UNAVAILABLE in the sidecar.
//   - name `<span class="font-semibold text-center leading-tight {textSize}
//     {yellow-400 | --text-secondary}">` -> AppText (weight 600, centred,
//     leading-tight lineHeight, per-size font, gold when unlocked else secondary).
//   - description `<span class="text-xs text-[var(--text-muted)] text-center
//     leading-tight">` -> AppText (12/15, muted, centred).
//   - status `<span class="text-xs text-yellow-500/70 font-medium">{t(
//     'lifetime.unlocked','✓ Unlocked')}</span>` (unlocked) ->
//     AppText (12/16, weight 500, gold/70). percent `<span class="text-xs
//     text-[var(--text-muted)] tabular-nums">{pct}%</span>` (locked) ->
//     AppText (12/16, muted, fontVariant tabular-nums).
//
// Colour mapping: the achievement gold theme has no semantic token, so the exact
// Tailwind values are kept as literals (yellow-500 #eab308, yellow-400 #facc15)
// alongside the source classes; the dynamic ring colour `isNearComplete ?
// '#eab308' : '#6b7280'` is preserved verbatim (a computed ternary, the allowed
// inline-style exception). `--text-secondary`/`--text-muted` map to the native
// `colors.textSecondary`/`colors.textMuted` tokens, and the ring track uses
// `colors.border` (same as the RadialGauge port's inactive segments). No DOM-only
// modules, browser HTML elements, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

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

interface AchievementBadgeProps {
  achievement: AchievementData;
  size?: 'sm' | 'md' | 'lg';
}

// Web `sizeConfig` Tailwind classes resolved to native numerics:
//   ring/stroke unchanged; iconSize text-xl/3xl/4xl -> font 20/30/36 with their
//   Tailwind line-heights 28/36/40; gap gap-1/2/3 -> 4/8/12; textSize
//   text-xs/sm/base -> name font 12/14/16 with leading-tight (round(font*1.25))
//   line-heights 15/18/20.
const sizeConfig = {
  sm: {
    ring: 56,
    stroke: 3,
    iconFontSize: 20,
    iconLineHeight: 28,
    gap: 4,
    nameFontSize: 12,
    nameLineHeight: 15,
  },
  md: {
    ring: 72,
    stroke: 4,
    iconFontSize: 30,
    iconLineHeight: 36,
    gap: 8,
    nameFontSize: 14,
    nameLineHeight: 18,
  },
  lg: {
    ring: 96,
    stroke: 5,
    iconFontSize: 36,
    iconLineHeight: 40,
    gap: 12,
    nameFontSize: 16,
    nameLineHeight: 20,
  },
} as const;

// ── Native-safe ProgressRing (inlined from @/components/data-display) ────────
// The web ProgressRing draws an SVG <circle> with strokeDasharray/strokeDashoffset;
// React Native has no SVG, so the ring is approximated with positioned View
// segments — index < activeSegments take the progress `color`, the rest take the
// `colors.border` track — exactly like the existing RadialGauge native port. Only
// the props this call site uses are modelled.
const RING_SEGMENT_COUNT = 72;
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
  size: number,
  radius: number,
  center: number,
  circumference: number,
  strokeWidth: number,
): RingSegment[] {
  const segmentWidth = Math.max(2, (circumference / RING_SEGMENT_COUNT) * 0.62);

  return Array.from({length: RING_SEGMENT_COUNT}, (_, index) => {
    const angle =
      RING_START_ANGLE_DEGREES + (index / RING_SEGMENT_COUNT) * RING_FULL_TURN_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - segmentWidth / 2;
    const top = center + radius * Math.sin(radians) - strokeWidth / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `${size}-${index}`,
      left,
      top,
      width: segmentWidth,
    };
  });
}

interface AchievementProgressRingProps {
  value: number;
  max: number;
  size: number;
  strokeWidth: number;
  color: string;
}

function AchievementProgressRing({
  value,
  max,
  size,
  strokeWidth,
  color,
}: AchievementProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(value, max));
  const progress = max > 0 ? clamped / max : 0;
  const activeSegments = Math.round(progress * RING_SEGMENT_COUNT);
  const segments = useMemo(
    () => buildRingSegments(size, radius, center, circumference, strokeWidth),
    [center, circumference, radius, size, strokeWidth],
  );

  return (
    <View pointerEvents="none" style={{height: size, width: size}}>
      {segments.map((segment, index) => (
        <View
          key={segment.key}
          style={[
            styles.ringSegment,
            {
              backgroundColor: index < activeSegments ? color : colors.border,
              borderRadius: strokeWidth / 2,
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

export function AchievementBadge({achievement, size = 'md'}: AchievementBadgeProps) {
  const {t} = useTranslation();
  const cfg = sizeConfig[size];
  const isNearComplete = !achievement.unlocked && achievement.progress >= 0.8;
  const pct = Math.round(achievement.progress * 100);

  // `animate-pulse` (web) — only while near-complete. Reproduced by oscillating
  // the container opacity 1 -> 0.5 -> 1; stays static at 1 otherwise.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isNearComplete) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isNearComplete, pulse]);

  const iconSizeStyle: TextStyle = {
    fontSize: cfg.iconFontSize,
    lineHeight: cfg.iconLineHeight,
  };

  return (
    <Animated.View
      style={[
        styles.container,
        achievement.unlocked ? styles.containerUnlocked : styles.containerLocked,
        {gap: cfg.gap, opacity: pulse},
      ]}>
      {/* Badge circle */}
      <View style={styles.badgeCircle}>
        {achievement.unlocked ? (
          <AppText
            accessibilityLabel={achievement.name}
            accessibilityRole="image"
            style={[styles.icon, iconSizeStyle]}>
            {achievement.icon}
          </AppText>
        ) : (
          <View style={{height: cfg.ring, width: cfg.ring}}>
            <AchievementProgressRing
              value={pct}
              max={100}
              size={cfg.ring}
              strokeWidth={cfg.stroke}
              color={isNearComplete ? '#eab308' : '#6b7280'}
            />
            <View style={[StyleSheet.absoluteFill, styles.iconOverlay]}>
              <AppText
                accessibilityLabel={achievement.name}
                accessibilityRole="image"
                style={[styles.icon, styles.iconLocked, iconSizeStyle]}>
                {achievement.icon}
              </AppText>
            </View>
          </View>
        )}
      </View>

      {/* Name */}
      <AppText
        style={[
          styles.name,
          achievement.unlocked ? styles.nameUnlocked : styles.nameLocked,
          {fontSize: cfg.nameFontSize, lineHeight: cfg.nameLineHeight},
        ]}>
        {achievement.name}
      </AppText>

      {/* Description */}
      <AppText style={styles.description}>{achievement.description}</AppText>

      {/* Progress or unlocked status */}
      {achievement.unlocked ? (
        <AppText style={styles.statusUnlocked}>
          {t('lifetime.unlocked', '✓ Unlocked')}
        </AppText>
      ) : (
        <AppText style={styles.percent}>{pct}%</AppText>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center', // items-center
    borderRadius: 12, // rounded-xl
    borderWidth: 1, // border
    flexDirection: 'column', // flex flex-col
    padding: 12, // p-3
    position: 'relative', // relative
  },
  containerUnlocked: {
    backgroundColor: 'rgba(234, 179, 8, 0.08)', // bg-yellow-500/[0.08]
    borderColor: 'rgba(234, 179, 8, 0.3)', // border-yellow-500/30
  },
  containerLocked: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // bg-white/[0.03]
    borderColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
  },
  badgeCircle: {
    alignItems: 'center', // flex items-center justify-center
    justifyContent: 'center',
    position: 'relative', // relative
  },
  ringSegment: {
    position: 'absolute',
  },
  iconOverlay: {
    // span: absolute inset-0 flex items-center justify-center
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    textAlign: 'center',
  },
  iconLocked: {
    opacity: 0.5, // opacity-50 (grayscale has no RN equivalent for emoji)
  },
  name: {
    fontWeight: '600', // font-semibold
    textAlign: 'center', // text-center
  },
  nameUnlocked: {
    color: '#facc15', // text-yellow-400
  },
  nameLocked: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
  },
  description: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 15, // leading-tight
    textAlign: 'center', // text-center
  },
  statusUnlocked: {
    color: 'rgba(234, 179, 8, 0.7)', // text-yellow-500/70
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  percent: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'], // tabular-nums
    lineHeight: 16,
  },
});
