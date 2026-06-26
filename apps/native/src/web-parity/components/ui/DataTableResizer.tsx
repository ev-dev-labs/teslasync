// Native parity port of web/src/components/ui/DataTableResizer.tsx.
//
// The web source is a drag handle that resizes a `<th>`. It rendered a single
// `<div role="separator">` that followed the WAI-ARIA "Window Splitter Pattern"
// (aria-orientation/valuenow/valuemin/valuemax + tabIndex={0}), drove the drag
// with DOM Pointer Events (onPointerDown/Move/Up/Cancel) plus
// element.setPointerCapture/releasePointerCapture so the gesture survived the
// pointer leaving the column, supported keyboard resize
// (ArrowLeft/ArrowRight = -/+8px, Home = 80px, End = maxWidth), stopped click
// propagation so the handle never triggered the column sort, and styled itself
// from the shared `tableTokens.resizer` Tailwind token (with `cn`).
//
// This port reproduces the same clamp math, the same drag state machine, the
// same keyboard increments, the same "call onResizeEnd once on release" timing,
// and the same visual intent (a thin cyan handle pinned to the right edge of the
// header cell that lights up while active) with React Native primitives. No DOM,
// no pointer-capture API, no Recharts/Leaflet, and no web UI components are
// imported.
//
// Native-safe adaptations (documented in the sidecar):
//   * DOM Pointer Events + setPointerCapture/releasePointerCapture -> a single
//     PanResponder. RN already retains the active touch for the granting view
//     for the whole gesture, so the explicit capture/release calls are implicit.
//     onStart/MoveShouldSetPanResponderCapture claim the gesture before the
//     parent header, which is the native equivalent of the web
//     stopPropagation()/onClick stopPropagation that kept the handle from
//     triggering the column sort.
//   * The WAI-ARIA separator/splitter keyboard pattern (no key events reach a
//     plain RN View) -> accessibilityRole="adjustable" + accessibilityValue
//     {min,max,now} and accessibilityActions. increment/decrement reproduce the
//     ArrowRight/ArrowLeft +/-8px nudges; custom "reset"/"maximize" actions
//     reproduce Home (80px) and End (maxWidth). All four web key branches are
//     preserved verbatim, including their `onResizeEnd?.(next)` timing.
//   * The `cursor-col-resize` / `select-none` CSS hints have no RN equivalent and
//     are dropped. The web idle state was `opacity-0` (handle only appears on
//     hover/focus); touch has no hover, so the native idle uses a faint divider
//     fill so the handle stays discoverable, and `hitSlop` widens the 6px bar
//     into a comfortable touch target. The active fill matches the web
//     `bg-cyan-400/60`.

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

interface DataTableResizerProps {
  /** Column key for aria/labels. */
  columnKey: string;
  /** Current width in px. */
  width: number;
  /** Minimum allowed width when resizing. */
  minWidth?: number;
  /** Maximum allowed width when resizing. */
  maxWidth?: number;
  /** Called continuously while the user drags. */
  onResize: (next: number) => void;
  /** Called once when the user releases the pointer (use for persistence). */
  onResizeEnd?: (final: number) => void;
  /** Optional accessible label override. */
  label?: string;
  /** Test hook for the rendered handle. */
  testID?: string;
}

// tableTokens.resizer mirrored from web/src/lib/tokens.ts:
//   absolute top-0 right-0 h-full w-1.5 -> position:absolute, top/bottom:0,
//   right:0, width:6.
//   bg-cyan-400/60 (drag/focus active fill) -> rgba(34, 211, 238, 0.6).
// The web idle was opacity-0 (revealed on hover/focus only); native has no hover
// so a faint divider keeps the handle discoverable to touch.
const RESIZER_IDLE_BG = 'rgba(255, 255, 255, 0.12)';
const RESIZER_ACTIVE_BG = 'rgba(34, 211, 238, 0.6)';

/**
 * Drag handle that resizes a column header. Uses a PanResponder so it works on
 * touch, pen, and mouse, retaining the active gesture for its whole duration so
 * the user can move outside the column boundary without losing it (the native
 * equivalent of the web pointer-capture).
 *
 * Keyboard/AT support: the accessibility increment/decrement actions shrink/grow
 * by 8px increments, a "reset" action returns to 80px, and a "maximize" action
 * maxes out at maxWidth (or 800px fallback) -- mirroring the web Left/Right/Home/
 * End keys.
 */
export function DataTableResizer({
  columnKey,
  width,
  minWidth = 60,
  maxWidth = 800,
  onResize,
  onResizeEnd,
  label,
  testID,
}: DataTableResizerProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (n: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(n))),
    [minWidth, maxWidth],
  );

  // Live mirrors so the once-created PanResponder never reads stale state/props
  // (the web handlers were re-created via useCallback deps each render instead).
  const draggingRef = useRef(dragging);
  const widthRef = useRef(width);
  const clampRef = useRef(clamp);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  useEffect(() => {
    clampRef.current = clamp;
  }, [clamp]);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    onResizeEndRef.current = onResizeEnd;
  }, [onResizeEnd]);

  // Cleanup safety: if the component unmounts mid-drag, release the drag flag.
  useEffect(() => () => setDragging(false), []);

  // Shared by onPanResponderRelease/Terminate (web finishDrag). Reads the latest
  // committed width through the ref so onResizeEnd fires with the same value the
  // web read off its `width` prop after the drag's onResize calls flowed back.
  const finishDrag = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setDragging(false);
    onResizeEndRef.current?.(widthRef.current);
  }, []);

  // PanResponder replaces the DOM pointer events + setPointerCapture. Created
  // once; all live state/props are read through refs. Claiming the responder on
  // capture is the native stand-in for the web preventDefault/stopPropagation +
  // onClick stopPropagation that kept the handle from triggering the sort.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        startX.current = g.x0;
        startWidth.current = widthRef.current;
        draggingRef.current = true;
        setDragging(true);
      },
      onPanResponderMove: (
        _e: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (!draggingRef.current) {
          return;
        }
        const delta = g.moveX - startX.current;
        onResizeRef.current(clampRef.current(startWidth.current + delta));
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
    }),
  ).current;

  // Web keyboard branches (ArrowLeft/ArrowRight/Home/End): each clamps, calls
  // onResize, then onResizeEnd?(next). Exposed to AT via accessibility actions.
  const commit = useCallback(
    (next: number) => {
      onResize(next);
      onResizeEnd?.(next);
    },
    [onResize, onResizeEnd],
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case 'increment': // ArrowRight
          commit(clamp(width + 8));
          break;
        case 'decrement': // ArrowLeft
          commit(clamp(width - 8));
          break;
        case 'reset': // Home
          commit(clamp(80));
          break;
        case 'maximize': // End
          commit(clamp(maxWidth));
          break;
        default:
          break;
      }
    },
    [commit, clamp, width, maxWidth],
  );

  return (
    // role="separator" + aria-valuenow/min/max from the web Window Splitter
    // Pattern maps to RN's "adjustable" role (a slider-equivalent that announces
    // its value and exposes increment/decrement). The keyboard nudges live in
    // the accessibility actions above so the pattern stays genuinely operable.
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label ?? `Resize column ${columnKey}`}
      accessibilityValue={{min: minWidth, max: maxWidth, now: width}}
      accessibilityActions={[
        {name: 'increment'},
        {name: 'decrement'},
        {name: 'reset', label: 'Reset width'},
        {name: 'maximize', label: 'Maximize width'},
      ]}
      onAccessibilityAction={onAccessibilityAction}
      hitSlop={{left: 8, right: 8}}
      style={[styles.resizer, dragging && styles.resizerActive]}
      testID={testID}
      {...panResponder.panHandlers}
    />
  );
}

const styles = StyleSheet.create({
  // absolute top-0 right-0 h-full w-1.5 + faint idle divider (web opacity-0,
  // revealed on hover/focus -- native has no hover so it stays faintly visible).
  resizer: {
    backgroundColor: RESIZER_IDLE_BG,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 6,
  },
  // bg-cyan-400/60 active fill while dragging.
  resizerActive: {
    backgroundColor: RESIZER_ACTIVE_BG,
  },
});
