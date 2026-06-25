// Native parity port of web/src/components/mobile/PullToRefresh.tsx.
//
// The web original is a pull-to-refresh wrapper driven entirely by the browser
// DOM: it attaches imperative `touchstart`/`touchmove`/`touchend` listeners
// with `{ passive: false }`, calls `preventDefault()` to stop the page
// scrolling mid-pull, walks the DOM with `getComputedStyle` to find the
// scrolling ancestor (`isAtScrollTop`), reads `document`/`window` scroll
// offsets, and renders a `lucide-react` `Loader2` arc inside Tailwind-styled
// `<div>`s. None of that — TouchEvent, passive listeners, getComputedStyle,
// document/window scroll, the SVG spinner, `prefers-reduced-motion` — exists in
// React Native, so the DOM pull-gesture layer is genuinely unavailable here.
//
// The web component already ships a first-class "inactive" path: on non-touch
// (coarse-pointer false) devices it attaches zero handlers and renders its
// children straight through (`if (!active) return <>{children}</>`). This
// native port is exactly that path — a transparent `View` wrapper (the native
// analog of the web wrapper `<div className={cn('relative', className)}>`) that
// renders children unchanged, with no layout or styling of its own beyond the
// optional container `style`.
//
// Native screens that want real pull-to-refresh use React Native core's
// `RefreshControl` on a `ScrollView`/`FlatList`, wiring the same `onRefresh`
// promise — see `nativePullToRefreshCapabilities` for the documented contract.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web `className` container override (merged via `@/lib/cn`) has no
//     native analog, so it becomes an optional `style` prop, matching the
//     sibling web-parity ports (RequiresAuth, GeofenceDrawer).
//   - `onRefresh` / `threshold` / `enabled` are preserved on the props type so
//     call sites keep type-checking, but the pull gesture that would invoke
//     them is unavailable; they are inert until a native list adopts
//     RefreshControl.

import React, {type ReactNode} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';

/**
 * Documents which web pull-to-refresh capabilities survive in native. The DOM
 * TouchEvent gesture, the growing pull indicator, and the `navigator.vibrate`
 * haptic are browser-only; the native alternative is React Native's
 * `RefreshControl`, which screens wire to the same `onRefresh` promise.
 */
export const nativePullToRefreshCapabilities = {
  domTouchGestureAvailable: false,
  pullIndicatorRendered: false,
  navigatorVibrateAvailable: false,
  nativeAlternative: 'RefreshControl',
} as const;

export interface PullToRefreshProps {
  /**
   * Callback fired when the user releases past the pull threshold. Preserved
   * from the web contract: the indicator would stay visible until the returned
   * promise settled. Native lists invoke this via `RefreshControl.onRefresh`.
   */
  onRefresh: () => Promise<unknown>;
  /** Pixels the user must pull before a release fires `onRefresh`. */
  threshold?: number;
  children: ReactNode;
  /**
   * Override the touch-only default. On the web this opts in automatically on
   * coarse-pointer (touch / pen) devices; the native pull-gesture layer is
   * unavailable regardless, so this is preserved for type parity only.
   */
  enabled?: boolean;
  /**
   * Optional container style — the native analog of the web `className`
   * override (the web wrapper used `cn('relative', className)`).
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Native-safe pull-to-refresh wrapper. Renders its children straight through
 * inside a transparent `View`, mirroring the web component's inactive
 * (non-touch) branch. The DOM touch-gesture pull indicator is unavailable in
 * React Native — see `nativePullToRefreshCapabilities`.
 */
export function PullToRefresh({children, style}: PullToRefreshProps) {
  return (
    <View style={style} testID="pull-to-refresh">
      {children}
    </View>
  );
}

PullToRefresh.displayName = 'PullToRefresh';

export default PullToRefresh;
