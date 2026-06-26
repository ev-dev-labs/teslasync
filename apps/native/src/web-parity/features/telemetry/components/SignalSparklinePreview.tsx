// Native parity port of web/src/features/telemetry/components/SignalSparklinePreview.tsx.
//
// Last-hour mini-trend for one signal. Owns its own `useSignalHistory` query so a
// parent (SignalCategoryTree) can drop it into a `renderLeafRight` slot without
// calling a hook inside a render-prop callback. The fetch is gated by `enabled`
// (the parent flips it on per-leaf as a category expands) so the tree doesn't fire
// 600+ requests on mount. Numeric-kind signals render the Sparkline; non-numeric
// kinds (string / unknown / time) show a compact `(kind)` chip instead, since
// bool / enum / string time-series have no meaningful trend line.
//
// The web file pulls in DOM / web-UI dependencies absent from the native parity
// manifest (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented here + in the sidecar:
//
//   - `@/components/charts` Sparkline (web L17) -> the ported native charts barrel
//     Sparkline (RN line/area segments, no Recharts/SVG; same data/color/width/
//     height props).
//   - `@/api/hooks/useSignals` useSignalHistory (web L18) -> the ported native hook
//     (same '/signals/{id}/{signal}/history?hours=&limit=' query, same
//     {hours, limit} range arg, same UseQueryResult.data.data envelope array).
//   - `@/api/types` SignalKind / SignalEnvelope (web L19) -> the structurally
//     identical types in the ported native api/types module.
//   - `@/lib/cn` cn (web L20) -> dropped: native has no Tailwind classNames. The
//     four Tailwind branch class strings become StyleSheet styles + theme tokens
//     (text-[10px]/uppercase/tracking-wide chip with --glass-border border, the
//     animate-pulse --surface-2 skeleton, the muted dash). `animate-pulse`
//     (web L103) becomes an Animated opacity loop (1 <-> 0.5, the Tailwind pulse
//     range) with stop() cleanup — the same approach the LiveStatusPill port uses.
//     The `className` prop is preserved on the public interface for call-site
//     parity but is inert (renamed `_className`), mirroring the sibling Sparkline
//     port.
//   - <span> elements (web L84-95, L100-108, L113-119) -> native View /
//     Animated.View / AppText. The web `title` tooltips become accessibilityLabel
//     and `aria-hidden` becomes the RN accessibility-hidden prop pair.
//
// Behaviour, state/derived names (SPARKLINE_LIMIT, SPARKLINE_HOURS, isNumeric,
// query, numericSeries, envelopesToNumbers, NON_NUMERIC), the API path + the
// {hours:1, limit:30} window, the `enabled` gate, the non-numeric chip, the
// isLoading skeleton, the <2-points dash, and the default color/width/height
// (#22d3ee / 80 / 18) are all preserved. No DOM modules, HTML elements, Recharts,
// Leaflet, or web @/ UI imports remain.

import {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useSignalHistory} from '../../../api/hooks/useSignals';
import type {SignalEnvelope, SignalKind} from '../../../api/types';
import {Sparkline} from '../../../components/charts';

const SPARKLINE_LIMIT = 30;
const SPARKLINE_HOURS = 1;

// Native equivalent of Tailwind `animate-pulse`: opacity loops 1 <-> 0.5.
const PULSE_MIN_OPACITY = 0.5;
const PULSE_HALF_DURATION_MS = 1000;

interface SignalSparklinePreviewProps {
  vehicleId: number;
  signal: string;
  valueKind: SignalKind;
  /** Gates the underlying fetch. Parent flips on per-leaf as a group expands. */
  enabled: boolean;
  /** Sparkline color (defaults to teal accent). */
  color?: string;
  /** Sparkline width (px). */
  width?: number;
  /** Sparkline height (px). */
  height?: number;
  /** Inert in native (no Tailwind classNames); kept for call-site parity. */
  className?: string;
}

function envelopesToNumbers(data: SignalEnvelope[]): number[] {
  const out: number[] = [];
  for (const e of data) {
    const v = e.value;
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  }
  return out;
}

const NON_NUMERIC: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'string',
  'unknown',
  'time',
]);

export function SignalSparklinePreview({
  vehicleId,
  signal,
  valueKind,
  enabled,
  color = '#22d3ee',
  width = 80,
  height = 18,
  className: _className,
}: SignalSparklinePreviewProps) {
  const isNumeric = !NON_NUMERIC.has(valueKind);
  const query = useSignalHistory(vehicleId, signal, {
    hours: SPARKLINE_HOURS,
    limit: SPARKLINE_LIMIT,
  });
  // The hook itself is unconditional (rules-of-hooks); we gate the
  // fetch by skipping the render until enabled+numeric and lean on
  // tanstack-query's caching. The hook's built-in `enabled` keys off
  // vehicleId+signal, so we add our own short-circuit here.
  const numericSeries = useMemo(
    () => (query.data?.data ? envelopesToNumbers(query.data.data) : []),
    [query.data],
  );

  // Run the pulse loop only while the loading skeleton is actually shown.
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const showSkeleton = enabled && isNumeric && query.isLoading;
  useEffect(() => {
    if (!showSkeleton) {
      pulseOpacity.setValue(1);
      return;
    }
    pulseOpacity.setValue(1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
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
  }, [showSkeleton, pulseOpacity]);

  if (!enabled) return null;

  if (!isNumeric) {
    return (
      <View
        accessibilityLabel={`Non-numeric signal (${valueKind})`}
        accessible
        style={styles.chip}>
        <AppText style={styles.chipText}>{valueKind}</AppText>
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.skeleton, {height, opacity: pulseOpacity, width}]}
      />
    );
  }

  if (numericSeries.length < 2) {
    return (
      <AppText accessibilityLabel="No samples in last hour" style={styles.dash}>
        —
      </AppText>
    );
  }

  return (
    <Sparkline
      color={color}
      data={numericSeries}
      height={height}
      width={width}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  dash: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  skeleton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
  },
});
