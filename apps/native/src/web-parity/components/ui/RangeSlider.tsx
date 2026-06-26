// Native parity port of web/src/components/ui/RangeSlider.tsx.
//
// The web `RangeSlider` is a dual-thumb range primitive built from two stacked
// native `<input type="range">` elements: it renders an optional label/value
// row (`label` on the left, a tabular `low – high` Caption on the right), a
// decorative track with a cyan fill spanning the selected range, and the two
// overlapping range inputs whose `[&::-webkit-slider-thumb]:pointer-events-auto`
// / z-index tricks keep both thumbs grabbable. Every change is normalised to a
// sorted `[low, high]` tuple (thumb-swap), and each thumb exposes its own
// `aria-label` + `aria-valuetext` for screen readers. It is reproduced here
// with React Native primitives:
//
//   - There is no `<input type="range">` (and no @react-native-community/slider
//     dependency) in core RN, so the two inputs become two draggable thumb
//     `View`s laid over a track. Each thumb owns a `PanResponder` (the RN
//     analog of the pointer/drag interaction) that converts horizontal drag
//     distance over the measured track width into a stepped value, and each is
//     marked `accessibilityRole="adjustable"` with `accessibilityActions`
//     increment/decrement (the RN analog of the WAI-ARIA APG Arrow-key stepping
//     that the native inputs provided) plus an `accessibilityValue`
//     {min, max, now, text} mirroring `aria-valuemin/max/now` + `aria-valuetext`.
//     PageUp/PageDown (~10%) and Home/End have no native gesture analog and are
//     dropped; the increment/decrement actions cover the primary step behaviour.
//   - The thumb-swap logic is preserved verbatim: `handleLowChange` /
//     `handleHighChange` still take a numeric `next`, guard `Number.isNaN`, and
//     emit `[high, next]` / `[next, low]` so the callback always receives a
//     sorted tuple. The web read `next` from `e.currentTarget.value`; on native
//     the drag/step math computes `next` directly and feeds the same functions.
//   - `useId()` is preserved for the base/low/high ids (surfaced as `nativeID`
//     so the thumbs keep stable identifiers, the native analog of the input
//     `id`s). `displayLow` / `displayHigh` (`formatValue` or `String`), `ariaLow`
//     / `ariaHigh` (the `slider.thumbMin` / `slider.thumbMax` i18n strings),
//     `range`, `lowPct`, `highPct` and `lowOnTop` are all preserved verbatim;
//     `lowOnTop` drives the thumb `zIndex` swap exactly as it drove the input
//     z-index so the thumb nearest the far end stays reachable.
//   - react-i18next `useTranslation` is unavailable in native parity; it is
//     replaced by a local `useNativeTranslationFallback()` t() shim that returns
//     the English fallback and resolves the `{{label}}` interpolation, keeping
//     the keys + copy verbatim (the same shim the DataTableBulkBar port used).
//   - `cn()` (clsx + tailwind-merge) and the Tailwind class strings are dropped;
//     styling becomes RN StyleSheet records. The web CSS-var/Tailwind colors are
//     preserved as literals: `--surface-2` (#151621) track, `cyan-500` (#06b6d4)
//     thumb + `cyan-500/60` (rgba(6,182,212,0.6)) fill, `accent-cyan-500` thumb
//     accent. `typography.role.label` (text-xs font-medium uppercase
//     tracking-wider text-[var(--text-muted)]) becomes `styles.label`; the
//     `tabular-nums` Caption becomes an `AppText variant="caption"` with
//     `fontVariant: ['tabular-nums']`. `focus-visible:outline-none`,
//     `forced-colors:hidden`, `backdrop`/pointer-events arbitrary variants and
//     `accent-*` are browser-only and have no native analog.
//   - `disabled` maps to a 0.5-opacity wrapper + `accessibilityState.disabled`
//     and short-circuits the PanResponder, matching `disabled:opacity-50` +
//     `disabled:cursor-not-allowed` and the web inputs' `disabled` attribute.
//   - The web `className` styling channel is retained on props for source
//     compatibility (ignored on native) and replaced by a native `style` prop
//     merged last onto the outer wrapper so callers win.

import React, {useCallback, useId, useMemo, useRef} from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export interface RangeSliderProps {
  /** Current `[low, high]` value. Always normalised so `low <= high`. */
  value: [number, number];
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Step increment used by Arrow keys and drag. Defaults to 1. */
  step?: number;
  /**
   * Fired with the new `[low, high]` tuple on every change. The component
   * automatically swaps the thumbs when the user drags the low thumb past
   * the high thumb (or vice versa) so the callback always receives a
   * sorted tuple.
   */
  onChange: (range: [number, number]) => void;
  /** Visible label *and* accessible name for the range. Required. */
  label: string;
  /** Format both displayed values and accessibility valuetext on each thumb. */
  formatValue?: (n: number) => string;
  /**
   * Override the auto-generated accessible name for the low thumb.
   * Defaults to the i18n string `slider.thumbMin` ("{{label}} minimum").
   */
  minThumbLabel?: string;
  /**
   * Override the auto-generated accessible name for the high thumb.
   * Defaults to the i18n string `slider.thumbMax` ("{{label}} maximum").
   */
  maxThumbLabel?: string;
  /**
   * When false, the visible label/value row is hidden. Defaults to true.
   */
  showLabel?: boolean;
  /** Disable interaction on both thumbs. */
  disabled?: boolean;
  /** Optional id prefix; auto-generated when omitted. */
  id?: string;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native replacement for the web `className`; merged last so callers win. */
  style?: StyleProp<ViewStyle>;
  /** Native test id for the outer wrapper. */
  testID?: string;
}

type TranslationValues = {label?: string};

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys and `{{label}}` intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name as keyof TranslationValues];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

const THUMB_SIZE = 18;

/**
 * Dual-thumb range slider primitive.
 *
 * Built from two draggable thumbs laid over a track so every interaction from
 * the WAI-ARIA APG slider pattern that survives on touch works on each thumb
 * (a screen reader's increment/decrement steps by `step`), and so assistive
 * tech announces each thumb individually via `accessibilityValue.text`.
 *
 * Thumb-swap: if the user drags the low thumb past the high thumb (or vice
 * versa), the callback receives a sorted `[low, high]` tuple. This matches the
 * APG-recommended behaviour for range sliders.
 */
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  formatValue,
  minThumbLabel,
  maxThumbLabel,
  showLabel = true,
  disabled,
  id,
  className: _className,
  style,
  testID,
}: RangeSliderProps) {
  const t = useNativeTranslationFallback();
  const reactId = useId();
  const baseId = id ?? `range-${reactId}`;
  const lowId = `${baseId}-low`;
  const highId = `${baseId}-high`;

  const [low, high] = value;

  const displayLow = useMemo(
    () => (formatValue ? formatValue(low) : String(low)),
    [formatValue, low],
  );
  const displayHigh = useMemo(
    () => (formatValue ? formatValue(high) : String(high)),
    [formatValue, high],
  );

  const ariaLow =
    minThumbLabel ?? t('slider.thumbMin', '{{label}} minimum', {label});
  const ariaHigh =
    maxThumbLabel ?? t('slider.thumbMax', '{{label}} maximum', {label});

  // Snap a raw value to the step grid (relative to min, like an <input
  // type="range">) and clamp it into [min, max].
  const clampToStep = useCallback(
    (raw: number) => {
      if (max <= min) {
        return min;
      }
      const stepped = step > 0 ? Math.round((raw - min) / step) * step + min : raw;
      return Math.max(min, Math.min(max, stepped));
    },
    [max, min, step],
  );

  /**
   * Thumb-swap is enforced by sorting the resulting tuple. When the user
   * drags the low thumb past the high thumb, the callback receives
   * `[high, newLow]` so the high thumb effectively becomes the new low
   * value. After a swap the *high* thumb is the one that continues to track
   * the gesture.
   */
  const handleLowChange = useCallback(
    (next: number) => {
      if (Number.isNaN(next)) return;
      if (next > high) onChange([high, next]);
      else onChange([next, high]);
    },
    [high, onChange],
  );

  const handleHighChange = useCallback(
    (next: number) => {
      if (Number.isNaN(next)) return;
      if (next < low) onChange([next, low]);
      else onChange([low, next]);
    },
    [low, onChange],
  );

  // Decorative fill positions — preserved verbatim from the web. The web kept
  // them hidden in forced-colors mode; that mode has no native analog.
  const range = max - min;
  const lowPct =
    range > 0 ? Math.max(0, Math.min(100, ((low - min) / range) * 100)) : 0;
  const highPct =
    range > 0 ? Math.max(0, Math.min(100, ((high - min) / range) * 100)) : 100;

  // When the low thumb is past the midpoint, render it on top so the user can
  // still grab it when the two thumbs collide near the far edge. Symmetrical
  // for the high thumb near the near edge.
  const lowOnTop = lowPct > 50;

  // Mutable handles so the once-created PanResponders read the latest props
  // without being recreated each render (mirrors the Lightbox port's panRef).
  const trackWidthRef = useRef(0);
  const dragStartRef = useRef(0);
  const stateRef = useRef({
    low,
    high,
    range,
    disabled: Boolean(disabled),
    clampToStep,
    handleLowChange,
    handleHighChange,
  });
  stateRef.current = {
    low,
    high,
    range,
    disabled: Boolean(disabled),
    clampToStep,
    handleLowChange,
    handleHighChange,
  };

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  }, []);

  const lowResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !stateRef.current.disabled,
      onMoveShouldSetPanResponder: () => !stateRef.current.disabled,
      onPanResponderGrant: () => {
        dragStartRef.current = stateRef.current.low;
      },
      onPanResponderMove: (_evt, gesture) => {
        const width = trackWidthRef.current;
        const span = stateRef.current.range;
        if (width <= 0 || span <= 0) return;
        const delta = (gesture.dx / width) * span;
        const next = stateRef.current.clampToStep(dragStartRef.current + delta);
        stateRef.current.handleLowChange(next);
      },
    }),
  ).current;

  const highResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !stateRef.current.disabled,
      onMoveShouldSetPanResponder: () => !stateRef.current.disabled,
      onPanResponderGrant: () => {
        dragStartRef.current = stateRef.current.high;
      },
      onPanResponderMove: (_evt, gesture) => {
        const width = trackWidthRef.current;
        const span = stateRef.current.range;
        if (width <= 0 || span <= 0) return;
        const delta = (gesture.dx / width) * span;
        const next = stateRef.current.clampToStep(dragStartRef.current + delta);
        stateRef.current.handleHighChange(next);
      },
    }),
  ).current;

  const onLowAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === 'increment') handleLowChange(clampToStep(low + step));
      else if (action === 'decrement') handleLowChange(clampToStep(low - step));
    },
    [clampToStep, handleLowChange, low, step],
  );

  const onHighAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === 'increment') handleHighChange(clampToStep(high + step));
      else if (action === 'decrement') handleHighChange(clampToStep(high - step));
    },
    [clampToStep, handleHighChange, high, step],
  );

  const fillStyle: ViewStyle = {
    left: `${Math.min(lowPct, highPct)}%`,
    right: `${100 - Math.max(lowPct, highPct)}%`,
  };

  return (
    <View style={[styles.root, style]} testID={testID}>
      {showLabel && (
        <View style={styles.labelRow}>
          <AppText style={styles.label}>{label}</AppText>
          <AppText style={styles.value} tone="secondary" variant="caption">
            {`${displayLow} \u2013 ${displayHigh}`}
          </AppText>
        </View>
      )}
      <View style={styles.trackArea}>
        <View onLayout={onTrackLayout} style={styles.track} />
        <View pointerEvents="none" style={[styles.fill, fillStyle]} />
        <View
          accessibilityActions={ACCESSIBILITY_ACTIONS}
          accessibilityLabel={ariaLow}
          accessibilityRole="adjustable"
          accessibilityState={{disabled: Boolean(disabled)}}
          accessibilityValue={{min, max, now: low, text: displayLow}}
          accessible={!disabled}
          hitSlop={THUMB_HIT_SLOP}
          nativeID={lowId}
          onAccessibilityAction={onLowAction}
          style={[
            styles.thumb,
            disabled && styles.thumbDisabled,
            {left: `${lowPct}%`, zIndex: lowOnTop ? 20 : 10},
          ]}
          testID={testID ? `${testID}-low` : undefined}
          {...lowResponder.panHandlers}
        />
        <View
          accessibilityActions={ACCESSIBILITY_ACTIONS}
          accessibilityLabel={ariaHigh}
          accessibilityRole="adjustable"
          accessibilityState={{disabled: Boolean(disabled)}}
          accessibilityValue={{min, max, now: high, text: displayHigh}}
          accessible={!disabled}
          hitSlop={THUMB_HIT_SLOP}
          nativeID={highId}
          onAccessibilityAction={onHighAction}
          style={[
            styles.thumb,
            disabled && styles.thumbDisabled,
            {left: `${highPct}%`, zIndex: lowOnTop ? 10 : 20},
          ]}
          testID={testID ? `${testID}-high` : undefined}
          {...highResponder.panHandlers}
        />
      </View>
    </View>
  );
}

RangeSlider.displayName = 'RangeSlider';

// WAI-ARIA APG Arrow-key stepping -> the RN adjustable increment/decrement
// actions (the analog assistive tech exposes for an adjustable element).
const ACCESSIBILITY_ACTIONS = [
  {name: 'increment'},
  {name: 'decrement'},
] as const;

const THUMB_HIT_SLOP = {top: 12, bottom: 12, left: 12, right: 12} as const;

// --surface-2 track + cyan-500 thumb / cyan-500/60 fill, preserved as literals.
const SURFACE_2 = '#151621';
const CYAN_500 = '#06b6d4';
const CYAN_500_FILL = 'rgba(6, 182, 212, 0.6)';

const styles = StyleSheet.create({
  fill: {
    backgroundColor: CYAN_500_FILL,
    borderRadius: 999,
    height: 4,
    marginTop: -2,
    position: 'absolute',
    top: '50%',
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  labelRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  root: {
    flexDirection: 'column',
    gap: 8,
  },
  thumb: {
    backgroundColor: CYAN_500,
    borderColor: colors.textPrimary,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    height: THUMB_SIZE,
    marginLeft: -THUMB_SIZE / 2,
    marginTop: -THUMB_SIZE / 2,
    position: 'absolute',
    top: '50%',
    width: THUMB_SIZE,
  },
  thumbDisabled: {
    opacity: 0.5,
  },
  track: {
    backgroundColor: SURFACE_2,
    borderRadius: 999,
    height: 4,
    left: 0,
    marginTop: -2,
    position: 'absolute',
    right: 0,
    top: '50%',
  },
  trackArea: {
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
});
