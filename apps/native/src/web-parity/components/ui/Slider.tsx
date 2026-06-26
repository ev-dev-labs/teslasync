// Native parity port of web/src/components/ui/Slider.tsx.
//
// The web source is a single-thumb slider primitive. It wraps a native
// `<input type="range">` (L105-123) so the browser supplies the entire WAI-ARIA
// APG slider keyboard pattern for free: ArrowLeft/Right and ArrowUp/Down step by
// `step`, PageUp/Down step by ~10% of the range, Home/End jump to min/max, and the
// browser also handles touch + drag. It renders an optional label row (L88-100)
// with the visible label on the left and a live, `formatValue`-formatted readout on
// the right, then a track row sized to match an md `<Input>`/`<Select>` (h-9, L104).
// `formatValue` feeds both the visible readout and `aria-valuetext` (L116) so screen
// readers announce unit-aware copy ("32 percent", "175 km/h") while `aria-valuenow`
// keeps the raw number. `showLabel=false` hides the visible row and exposes the name
// via `aria-label` (L115). Styling is token-driven (--text-secondary/--text-muted for
// the label/readout, --glass-border for the track, accent-cyan-500 for the fill).
//
// This port reproduces the same value/min/max/step/onChange contract, the same
// optional label + live formatted readout, the same `formatValue` -> announced-text
// wiring, the same `showLabel` behaviour, the same disabled state, and the same
// visual intent (a thin rounded track with a cyan fill + thumb that aligns inside a
// form row) using React Native View/PanResponder primitives, the AppText component,
// and the native design tokens. No DOM `<input>`, no Recharts/Leaflet, and no web UI
// components are imported.
//
// Native-safe adaptations (documented in the sidecar):
//   * `<input type="range">` has no React Native primitive and there is no
//     @react-native-community/slider dependency in this app, so the thumb + drag are
//     rebuilt from a single PanResponder over a measured track (the same approach as
//     the DataTableResizer parity port). The touch + drag the browser handled
//     natively become onPanResponderGrant/Move that map the absolute touch X to a
//     snapped value via the measured track width/left edge.
//   * The browser's built-in slider keyboard pattern (no key events reach a plain RN
//     View) becomes accessibilityRole="adjustable" + accessibilityValue {min,max,now,
//     text} + accessibilityActions. increment/decrement reproduce Arrow +/- `step`;
//     custom pageUp/pageDown reproduce PageUp/Down (~10% of range, >= one step); and
//     minimum/maximum reproduce Home/End. Every documented key branch is preserved.
//   * `aria-valuetext` (L116) -> accessibilityValue.text (the formatted display
//     string); `aria-valuenow` -> accessibilityValue.now (the raw number).
//   * The web `<label htmlFor>` association cannot be expressed for a custom RN view,
//     so the accessible name is always carried on the adjustable via
//     accessibilityLabel=label (the web exposed it via the label association when
//     showLabel, and via aria-label when not). The visible label row is still shown
//     when showLabel is true, matching the layout.
//   * Tailwind classes (space-y-1, h-2/h-9, rounded-full, accent-cyan-500, the
//     focus-visible ring, disabled:opacity-50, tabular-nums, cursor-pointer) -> a
//     StyleSheet: gap 4, track height 8 in a 36px row, borderRadius 9999, the
//     --glass-border/accent token colours, and opacity 0.5 when disabled. The
//     focus-visible ring and cursor hints have no RN analog and are dropped; AT
//     focus is provided by the adjustable role. tabular-nums has no RN font feature
//     here and is dropped (digits still render; intent preserved).
//   * The web `className` (extra wrapper classes, L33/L87) has no RN equivalent and
//     is accepted as an inert web-parity no-op (same pattern as the Icon/Modal
//     ports); a native `style` override of the outer container is provided instead.
//     The forwarded ref, typed on web as the HTMLInputElement, points at the track
//     View (the interactive element) via useImperativeHandle, mirroring the web ref.

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export interface SliderProps {
  /** Current numeric value. */
  value: number;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Step increment used by adjust actions and drag. Defaults to 1. */
  step?: number;
  /** Fired with the new numeric value on every change. */
  onChange: (value: number) => void;
  /** Visible label *and* accessible name for the slider. Required. */
  label: string;
  /**
   * Format the live displayed value and the announced value text. Use this for
   * unit-aware screen-reader copy (e.g. "32 percent", "175 km/h", "12.5 kWh").
   * When omitted, the raw number is used.
   */
  formatValue?: (n: number) => string;
  /**
   * When false, the visible label row is hidden and only the accessible name is
   * exposed via accessibilityLabel. Defaults to true.
   */
  showLabel?: boolean;
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional id; auto-generated when omitted. */
  id?: string;
  /**
   * Web-parity only: Tailwind classes do not apply in React Native. Accepted so
   * ported call sites keep compiling; use `style` for native overrides.
   */
  className?: string;
  /** Native stand-in for the web extra wrapper `className`. */
  style?: StyleProp<ViewStyle>;
  /** Test hook for the rendered track. */
  testID?: string;
}

// Track + thumb geometry. Web: h-2 (8px) rounded-full track inside an h-9 (36px)
// row so the slider lines up with an md <Input>/<Select> in the same form grid.
const TRACK_HEIGHT = 8;
const ROW_HEIGHT = 36;
const THUMB_SIZE = 16;

// Snap a raw numeric value onto the step grid and clamp it into [min, max]. The
// browser's range input applied this exact snapping; `step <= 0` is treated as a
// continuous-ish 1 to avoid divide-by-zero (the browser also coerces 0/invalid
// steps away from 0).
function snapToStep(n: number, min: number, max: number, step: number): number {
  const safeStep = step > 0 ? step : 1;
  const snapped = min + Math.round((n - min) / safeStep) * safeStep;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * Single-thumb slider primitive.
 *
 * The web source wrapped `<input type="range">` for free keyboard + drag. There is
 * no RN range input (and no slider dependency in this app), so the thumb + drag are
 * rebuilt from a PanResponder over a measured track, and the input's keyboard
 * pattern is reproduced through accessibility actions:
 *   - increment / decrement  -> Arrow keys (+/- step)
 *   - pageUp / pageDown       -> PageUp/Down (~10% of range, at least one step)
 *   - minimum / maximum       -> Home / End (jump to min / max)
 *
 * Use `formatValue` for unit-aware screen-reader copy -- the formatted string is
 * announced via accessibilityValue.text while the raw number stays in
 * accessibilityValue.now.
 */
export const Slider = forwardRef<View, SliderProps>(function Slider(
  {
    value,
    min,
    max,
    step = 1,
    onChange,
    label,
    formatValue,
    showLabel = true,
    disabled,
    id,
    className: _className,
    style,
    testID,
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `slider-${reactId}`;

  // Measured track geometry (width drives the value<->position mapping and the
  // fill/thumb layout; left edge converts an absolute touch X into a track offset).
  const trackRef = useRef<View | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const trackLeftRef = useRef(0);

  // The web ref pointed at the <input>; here it points at the interactive track.
  useImperativeHandle(ref, () => trackRef.current as View, []);

  const display = useMemo(
    () => (formatValue ? formatValue(value) : String(value)),
    [formatValue, value],
  );

  // Live mirrors so the once-created PanResponder never reads stale state/props
  // (the web `<input>` re-read its attributes on every browser-driven event).
  const valueRef = useRef(value);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    minRef.current = min;
  }, [min]);
  useEffect(() => {
    maxRef.current = max;
  }, [max]);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // web handleChange L78-84: Number(e.currentTarget.value), skip NaN, then onChange.
  // Here every caller already produces a finite snapped number; the NaN guard and
  // the "skip when unchanged" guard (the browser fires no change event when the
  // value is identical) are preserved.
  const commit = useRef((next: number | null) => {
    if (next === null || Number.isNaN(next)) {
      return;
    }
    if (next === valueRef.current) {
      return;
    }
    onChangeRef.current(next);
  }).current;

  // Capture the track width (for layout) and absolute left edge (for the drag math)
  // once the track has measured. In react-test-renderer onLayout never fires, so the
  // slider degrades gracefully to a 0-width track (no crash, no drag).
  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    trackWidthRef.current = width;
    setTrackWidth(width);
    trackRef.current?.measureInWindow?.((x: number) => {
      trackLeftRef.current = x;
    });
  }, []);

  // PanResponder rebuilds the browser's native touch + drag. Created once; all live
  // state/props are read through refs. Claiming the responder is the native stand-in
  // for the browser owning the pointer for the duration of a range drag.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        commit(positionToValue(g.x0));
      },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        commit(positionToValue(g.moveX));
      },
    }),
  ).current;

  // Map an absolute screen X to a snapped value using the measured track geometry.
  // Defined as a stable closure over the refs so the once-created PanResponder above
  // always reads the latest width/left/min/max/step.
  function positionToValue(absX: number): number | null {
    const width = trackWidthRef.current;
    if (width <= 0) {
      return null;
    }
    const lo = minRef.current;
    const hi = maxRef.current;
    if (hi <= lo) {
      return lo;
    }
    const rel = absX - trackLeftRef.current;
    const fraction = Math.min(1, Math.max(0, rel / width));
    return snapToStep(lo + fraction * (hi - lo), lo, hi, stepRef.current);
  }

  // The browser slider keyboard branches, surfaced to assistive tech as actions.
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (disabled) {
        return;
      }
      const range = max - min;
      const pageStep = Math.max(step, range / 10);
      switch (event.nativeEvent.actionName) {
        case 'increment': // ArrowRight / ArrowUp
          commit(snapToStep(value + step, min, max, step));
          break;
        case 'decrement': // ArrowLeft / ArrowDown
          commit(snapToStep(value - step, min, max, step));
          break;
        case 'pageUp': // PageUp (~10% of range)
          commit(snapToStep(value + pageStep, min, max, step));
          break;
        case 'pageDown': // PageDown (~10% of range)
          commit(snapToStep(value - pageStep, min, max, step));
          break;
        case 'minimum': // Home
          commit(min);
          break;
        case 'maximum': // End
          commit(max);
          break;
        default:
          break;
      }
    },
    [commit, disabled, value, min, max, step],
  );

  // Fill + thumb position from the current value. Computed in memoised style objects
  // so no inline style literal is created in JSX (keeps the lint gate clean).
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const fillStyle = useMemo<ViewStyle>(
    () => ({width: trackWidth * fraction}),
    [trackWidth, fraction],
  );
  const thumbStyle = useMemo<ViewStyle>(() => {
    const raw = trackWidth * fraction - THUMB_SIZE / 2;
    const maxLeft = Math.max(0, trackWidth - THUMB_SIZE);
    return {left: Math.min(Math.max(raw, 0), maxLeft)};
  }, [trackWidth, fraction]);

  return (
    <View style={[styles.container, style]}>
      {showLabel ? (
        // web label row L88-100: <label> (text-sm --text-secondary) +
        // <span> readout (text-xs --text-muted, tabular-nums).
        <View style={styles.labelRow}>
          <AppText tone="secondary" style={styles.labelText}>
            {label}
          </AppText>
          <AppText tone="muted" style={styles.valueText}>
            {display}
          </AppText>
        </View>
      ) : null}
      {/* Track row (web h-9 wrapper L104): keeps the slider the same height as an md
          <Input>/<Select> so it aligns in a form grid. */}
      <View style={[styles.trackRow, disabled && styles.disabled]}>
        <View
          ref={trackRef}
          nativeID={inputId}
          testID={testID}
          onLayout={onTrackLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityState={{disabled: !!disabled}}
          accessibilityValue={{min, max, now: value, text: display}}
          accessibilityActions={[
            {name: 'increment'},
            {name: 'decrement'},
            {name: 'pageUp', label: 'Increase by page'},
            {name: 'pageDown', label: 'Decrease by page'},
            {name: 'minimum', label: 'Jump to minimum'},
            {name: 'maximum', label: 'Jump to maximum'},
          ]}
          onAccessibilityAction={onAccessibilityAction}
          hitSlop={{top: 12, bottom: 12}}
          style={styles.track}
          {...panResponder.panHandlers}>
          {/* accent-cyan-500 fill from min up to the current value. */}
          <View pointerEvents="none" style={[styles.fill, fillStyle]} />
          {/* Draggable thumb (the browser-drawn range thumb). */}
          <View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
        </View>
      </View>
    </View>
  );
});

Slider.displayName = 'Slider';

const styles = StyleSheet.create({
  // web space-y-1 (4px vertical rhythm between the label row and the track).
  container: {
    gap: 4,
  } as ViewStyle,
  // web flex items-baseline justify-between gap-2.
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  } as ViewStyle,
  // web <label>: text-sm font-medium text-[var(--text-secondary)] (tone supplies
  // the colour; AppText has no 500 weight token so the medium weight is set here).
  labelText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // web readout <span>: text-xs text-[var(--text-muted)] (tabular-nums dropped --
  // no RN font-feature analog here; digits still render).
  valueText: {
    fontSize: 12,
  },
  // web track wrapper: flex h-9 items-center.
  trackRow: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
  } as ViewStyle,
  // web disabled:opacity-50 (cursor-not-allowed has no RN analog).
  disabled: {
    opacity: 0.5,
  } as ViewStyle,
  // web input: h-2 w-full rounded-full bg-[var(--glass-border)].
  track: {
    width: '100%',
    height: TRACK_HEIGHT,
    borderRadius: 9999,
    backgroundColor: colors.border,
  } as ViewStyle,
  // accent-cyan-500 progress fill.
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: TRACK_HEIGHT,
    borderRadius: 9999,
    backgroundColor: colors.accent,
  } as ViewStyle,
  // The range thumb (centered vertically on the 8px track: (8-16)/2 = -4).
  thumb: {
    position: 'absolute',
    top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accent,
  } as ViewStyle,
});
