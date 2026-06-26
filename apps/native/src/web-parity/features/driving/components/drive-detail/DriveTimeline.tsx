// Native parity port of
// web/src/features/driving/components/drive-detail/DriveTimeline.tsx.
//
// The web component is the Drive Detail header timeline strip: a FadeIn-wrapped
// GlassPanel (p-4) containing a single justify-between row (text-xs) with three
// markers —
//   1. start  — a green-400 Flag icon + `formatTime(drive.startTs)`.
//   2. middle — a muted `formatDuration(drive.durationS / 60)` (seconds → minutes).
//   3. end    — a red-400 Flag icon + `formatTime(drive.endTs)`, or the
//               `driveDetail.inProgress` ("In progress") i18n label when endTs
//               is null —
// followed by a rounded-full track (h-3, bg surface-2) holding a full-width
// emerald-500 → cyan-400 gradient bar. This native port preserves that contract
// 1:1 using React Native primitives + the existing native GlassPanel / AppText /
// theme tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next `useTranslation` (web L1): no native i18next runtime, so an
//     inline `useNativeTranslation()` returns `t(key, fallback) = fallback ?? key`
//     — the lone `driveDetail.inProgress` key + English default is preserved.
//   - lucide-react `Flag` (web L2): DOM SVG icon → the text-presentation flag
//     glyph U+2691 (⚑), which — unlike a multicolor emoji — inherits its text
//     colour, so the web `text-green-400` / `text-red-400` currentColor on each
//     icon is kept (sized 12px to match the web `h-3 w-3`).
//   - `@/components/ui` GlassPanel (web L3): GlassPanel → native GlassPanel.
//   - `@/components/motion` FadeIn (web L4): framer-motion entrance → a native
//     Animated fade/translate entry honouring the reduce-motion preference (the
//     established SummaryHeroCards / ChargingSection convention).
//   - `@/lib/dateFormat` `formatTime` (web L5): ported here as the web default-
//     locale branch — '—' for nullish / invalid, else `toLocaleTimeString([],
//     {hour:'2-digit', minute:'2-digit'})` (the web call passes no FormatOptions,
//     so browser-default locale + timezone, mirrored by the `[]` locale arg).
//   - `./helpers` `formatDuration` (web L6): ported verbatim (h/m split).
//   - `@/types/driving` `DriveDetail` (web L7): the driving types module is not
//     yet ported, so the consumed subset (startTs / endTs / durationS) is mirrored
//     as a local interface; `durationS` stays SI seconds and is divided by 60 for
//     display minutes exactly like the web, so no unit drift is introduced.
//   - the Tailwind `bg-gradient-to-r from-emerald-500 to-cyan-400` (web L29): RN
//     has no gradient primitive without an extra dependency, so the full-width bar
//     is approximated by two equal-width segments (emerald-500 left, cyan-400
//     right) clipped by the rounded-full track — the established no-dependency
//     gradient approximation.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── ported: @/types/driving DriveDetail (consumed subset) ────────────────── */

interface DriveTimelineDrive {
  /** ISO 8601 UTC drive start timestamp. */
  startTs: string;
  /** ISO 8601 UTC drive end timestamp, or null while the drive is live. */
  endTs: string | null;
  /** Drive duration in seconds (SI canonical). */
  durationS: number;
}

interface DriveTimelineProps {
  drive: DriveTimelineDrive;
}

/* ── native-safe useTranslation (react-i18next has no native runtime) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return (_key, fallback) => fallback ?? _key;
}

/* ── formatTime (ported web/src/lib/dateFormat formatTime, default-locale) ── */

const FALLBACK = '\u2014';

function formatTime(value: string | Date | null | undefined): string {
  if (!value) {
    return FALLBACK;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/* ── formatDuration (ported verbatim from web ./helpers) ──────────────────── */

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ─────────── */

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

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ─── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delay * 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/* ── ported: DriveTimeline (web L13-34) ───────────────────────────────────── */

// lucide-react `Flag` → U+2691 text-presentation flag glyph (inherits text
// colour, sized to the web `h-3 w-3`).
const GLYPH_FLAG = '\u2691';
// text-green-400 / text-red-400 (the established native Tailwind mappings).
const GREEN_400 = '#4ade80';
const RED_400 = '#f87171';
// bg-gradient-to-r from-emerald-500 to-cyan-400 (two-segment approximation).
const EMERALD_500 = '#10b981';
const CYAN_400 = '#22d3ee';
// bg-[var(--surface-2)] dark-theme value (the established StatusPill mapping).
const SURFACE_2 = '#151621';

export function DriveTimeline({drive}: DriveTimelineProps) {
  const t = useNativeTranslation();

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.row}>
          <View style={styles.endpoint}>
            <AppText style={styles.startText}>{GLYPH_FLAG}</AppText>
            <AppText style={styles.startText}>
              {formatTime(drive.startTs)}
            </AppText>
          </View>
          <AppText style={styles.duration}>
            {formatDuration(drive.durationS / 60)}
          </AppText>
          <View style={styles.endpoint}>
            <AppText style={styles.endText}>{GLYPH_FLAG}</AppText>
            <AppText style={styles.endText}>
              {drive.endTs
                ? formatTime(drive.endTs)
                : t('driveDetail.inProgress', 'In progress')}
            </AppText>
          </View>
        </View>
        <View style={styles.track}>
          <View style={styles.fillStart} />
          <View style={styles.fillEnd} />
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

DriveTimeline.displayName = 'DriveTimeline';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.md + 4, // p-4 (16px)
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm, // mb-2 (8px)
  },
  endpoint: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1 (4px)
    flexDirection: 'row',
  },
  startText: {
    color: GREEN_400, // text-green-400
    fontSize: 12, // text-xs / h-3 w-3 glyph
  },
  endText: {
    color: RED_400, // text-red-400
    fontSize: 12, // text-xs / h-3 w-3 glyph
  },
  duration: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
  },
  track: {
    backgroundColor: SURFACE_2, // bg-[var(--surface-2)]
    borderRadius: 9999, // rounded-full
    flexDirection: 'row',
    height: 12, // h-3
    overflow: 'hidden', // overflow-hidden (clips the bar to the rounded track)
  },
  fillStart: {
    backgroundColor: EMERALD_500, // from-emerald-500
    flex: 1,
  },
  fillEnd: {
    backgroundColor: CYAN_400, // to-cyan-400
    flex: 1,
  },
});
