// Native parity port of
// web/src/features/system/components/status/LiveStatusPill.tsx.
//
// The connection-state badge mounted next to the Refresh button on the
// system-status surface. It reflects the SSE pump state (live / reconnecting /
// offline) with a coloured dot, a state icon, a label, and an "Updated
// <relative>" stamp so operators can verify the stream hasn't silently stopped.
//
// Web -> native mapping (contract rules 3, 4 & 5); every browser-only
// dependency is replaced with a React Native-safe equivalent:
//   - `useMemo` from react (web L15) -> used directly (RN supports it); the
//     relative label is memoised on [now, lastUpdateAt] exactly like the web.
//   - lucide-react Wifi / WifiOff / Activity icons (web L16) -> small inline
//     AppText glyphs tinted to the pill text colour (the sibling LiveIndicator /
//     DataPipelineSection precedent of replacing small inline lucide icons with
//     monochrome glyphs rather than the heavier bordered SemanticIcon chip):
//     Activity -> 'U+25C9' (fisheye, a pulse-like mark), Wifi -> 'U+25CC'
//     (dotted circle, "searching"), WifiOff -> 'U+2298' (circled slash, "off").
//   - `cn` from '@/lib/cn' (web L17) -> dropped; native composes StyleSheet
//     objects + inline colour overrides via style arrays.
//   - `StatusLiveState` from '../../hooks/useStatusLiveSSE' (web L18) -> the
//     native useStatusLiveSSE hook is not yet ported, so the 'live' |
//     'reconnecting' | 'offline' union is declared + exported locally,
//     byte-identical to the web type, so callers share the same contract.
//
// The TONE table maps each Tailwind class to a literal colour matching the web
// palette exactly (green-400/300/500/amber-400/200/500/zinc-400/300/500), and
// the `animate-pulse` on the reconnecting dot becomes an Animated opacity loop
// (1 <-> 0.5, the Tailwind pulse range) with stop() cleanup so no handle leaks.
// The relative() helper, its hard-coded English strings, the props, and the
// accessibility intent (role="status" + aria-live="polite" + the composed
// aria-label, data-status-live-state) are all preserved. No DOM-only modules,
// HTML elements, lucide-react, Recharts, Leaflet, or web UI components are
// imported. CSS var --text-muted maps to the textMuted token.

import {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, View, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

export type StatusLiveState = 'live' | 'reconnecting' | 'offline';

interface LiveStatusPillProps {
  state: StatusLiveState;
  lastUpdateAt: number | null;
  /** "now" tick passed in so the relative label re-renders. */
  now: number;
}

function relative(now: number, lastUpdateAt: number | null): string {
  if (lastUpdateAt == null) return '—';
  const secs = Math.max(0, Math.floor((now - lastUpdateAt) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

interface ToneSpec {
  /** dot fill (web bg-*-400) */
  dot: string;
  /** whether the dot pulses (web animate-pulse) */
  pulse: boolean;
  /** label text (web Live / Reconnecting / Offline) */
  label: string;
  /** state glyph standing in for the lucide icon */
  glyph: string;
  /** pill text colour (web text-*-300/200) */
  text: string;
  /** pill surface (web bg-*-500/10) */
  bg: string;
  /** pill ring (web ring-*-400/30) */
  ring: string;
}

const TONE: Record<StatusLiveState, ToneSpec> = {
  live: {
    dot: '#4ade80',
    pulse: false,
    label: 'Live',
    glyph: '◉',
    text: '#86efac',
    bg: 'rgba(34, 197, 94, 0.1)',
    ring: 'rgba(74, 222, 128, 0.3)',
  },
  reconnecting: {
    dot: '#fbbf24',
    pulse: true,
    label: 'Reconnecting',
    glyph: '◌',
    text: '#fde68a',
    bg: 'rgba(245, 158, 11, 0.1)',
    ring: 'rgba(251, 191, 36, 0.3)',
  },
  offline: {
    dot: '#a1a1aa',
    pulse: false,
    label: 'Offline',
    glyph: '⊘',
    text: '#d4d4d8',
    bg: 'rgba(113, 113, 122, 0.1)',
    ring: 'rgba(161, 161, 170, 0.3)',
  },
};

const PULSE_MIN_OPACITY = 0.5;
const PULSE_HALF_DURATION_MS = 1000;

export function LiveStatusPill({state, lastUpdateAt, now}: LiveStatusPillProps) {
  const tone = TONE[state];
  const rel = useMemo(() => relative(now, lastUpdateAt), [now, lastUpdateAt]);

  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!tone.pulse) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [tone.pulse, opacity]);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Live status stream: ${tone.label}, updated ${rel}`}
      testID={`status-live-state-${state}`}
      style={[styles.pill, {backgroundColor: tone.bg, borderColor: tone.ring}]}>
      <Animated.View
        style={[styles.dot, {backgroundColor: tone.dot, opacity}]}
      />
      <AppText variant="caption" style={[styles.icon, {color: tone.text}]}>
        {tone.glyph}
      </AppText>
      <AppText variant="caption" style={[styles.label, {color: tone.text}]}>
        {tone.label}
      </AppText>
      <AppText variant="caption" style={styles.muted}>
        ·
      </AppText>
      <AppText variant="caption" style={[styles.muted, styles.rel]}>
        {rel}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  icon: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  label: {
    fontWeight: '500',
  },
  muted: {
    color: colors.textMuted,
  },
  rel: {
    fontVariant: ['tabular-nums'],
  } as TextStyle,
});

export default LiveStatusPill;
