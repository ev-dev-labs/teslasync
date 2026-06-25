// Native parity port of web/src/components/mobile/SwipeRow.tsx.
//
// The web original is a swipe-to-archive / swipe-to-delete row driven entirely
// by the browser DOM: imperative `touchstart`/`touchmove`/`touchend` listeners
// with `{ passive: false }`, `preventDefault()` to hold the scroll axis,
// `getBoundingClientRect()` width math, `navigator.vibrate(10)` haptics, and
// absolutely-positioned Tailwind `<button>` underlays with `lucide-react`
// `Archive`/`Trash2` icons. None of that exists in React Native, so the DOM
// swipe-gesture layer is genuinely unavailable here.
//
// As with the web component's inactive (non-touch) branch
// (`if (!active) return <>{children}</>`), this native port renders its
// children straight through inside an `overflow: hidden` `View` (the native
// analog of the web `<div className={cn('relative overflow-hidden', className)}>`),
// with no swipe handlers and no action underlays.
//
// Native screens that want real swipe actions use
// `react-native-gesture-handler`'s `Swipeable`, wiring the same
// `leftAction.onAction` / `rightAction.onAction` callbacks — see
// `nativeSwipeRowCapabilities`.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web `className` override becomes an optional `style` prop (matching
//     sibling web-parity ports).
//   - `SwipeAction` keeps its exact public field names (`label`, `onAction`,
//     `tone`, `icon`, `ariaLabel`) so existing action configs keep
//     type-checking; the action buttons that would render them are unavailable
//     until a native row adopts Swipeable.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

/**
 * Documents which web swipe-row capabilities survive in native. The DOM
 * TouchEvent gesture, the revealed action buttons, and the `navigator.vibrate`
 * haptic are browser-only; the native alternative is
 * `react-native-gesture-handler`'s `Swipeable`, wired to the same action
 * callbacks.
 */
export const nativeSwipeRowCapabilities = {
  domTouchGestureAvailable: false,
  swipeActionsRendered: false,
  navigatorVibrateAvailable: false,
  nativeAlternative: 'react-native-gesture-handler Swipeable',
} as const;

export interface SwipeAction {
  /** Localised label rendered inside the action button. */
  label: string;
  /** Fires when the user taps the action button or auto-completes. */
  onAction: () => void;
  /** Visual tone — `danger` paints rose, `default` paints cyan on the web. */
  tone?: 'danger' | 'default';
  /** Optional override icon; defaults to Archive / Trash2 by tone on the web. */
  icon?: ReactNode;
  /**
   * Optional accessibility label for the action button when `label` itself is
   * not screen-reader friendly. Defaults to `label`.
   */
  ariaLabel?: string;
}

export interface SwipeRowProps {
  children: ReactNode;
  /** Action revealed by a left swipe (i.e. dragging towards the start). */
  rightAction?: SwipeAction;
  /** Action revealed by a right swipe (i.e. dragging towards the end). */
  leftAction?: SwipeAction;
  /**
   * Touch-only opt-in on the web; the native swipe-gesture layer is unavailable,
   * so this is preserved for type parity only.
   */
  enabled?: boolean;
  /** Distance the user must drag before the action is "revealed". */
  revealThreshold?: number;
  /** Optional container style — the native analog of the web `className`. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Native-safe swipe-to-action row. Renders its children straight through inside
 * an `overflow: hidden` `View`, mirroring the web component's inactive branch.
 * The DOM swipe gesture and action underlays are unavailable in React Native —
 * see `nativeSwipeRowCapabilities`.
 */
export function SwipeRow({children, style}: SwipeRowProps) {
  return (
    <View style={[styles.row, style]} testID="swipe-row">
      {children}
    </View>
  );
}

SwipeRow.displayName = 'SwipeRow';

const styles = StyleSheet.create({
  row: {
    // Mirrors the web wrapper's `overflow-hidden`; harmless for the passthrough
    // and the correct base once a native row adopts an underlay action panel.
    overflow: 'hidden',
  },
});

export default SwipeRow;
