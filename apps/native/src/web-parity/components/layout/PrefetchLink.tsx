// Native parity port of web/src/components/layout/PrefetchLink.tsx.
//
// The web component is a route-prefetching navigation link. It wraps
// `GuardedLink` (so the unsaved-changes navigation guard is preserved) and,
// purely as a hover/focus side-effect, calls `prefetchRoute(path)` to eagerly
// download the lazy `import()` chunk for the destination route so the eventual
// click resolves to a cached chunk and renders instantly (web L37-58).
//
// Three of its building blocks are browser-only and have no React Native
// analog; each is handled as an explicit, documented native-safe adaptation:
//
//   - `react-router-dom` `LinkProps` / `LinkProps['to']` (web L2, L30): React
//     Native has no DOM router. The `to` destination is preserved as a native
//     `LinkTo` (a path string or a `{ pathname }` location object — the exact
//     subset `pathFromTo` reads), and the full anchor prop surface that
//     `LinkProps` carried becomes React Native's `PressableProps`, so callers
//     keep `onPress`, `children`, `style`, `disabled`, accessibility, and
//     `testID` just like the web link forwarded its `...rest`.
//
//   - `@/lib/routePrefetch`'s `prefetchRoute` (web L4, L49, L53): it eagerly
//     fetches a Vite-emitted code-split chunk. React Native has no Vite chunks
//     to prefetch and the destination screen is rendered by the in-process
//     navigator rather than a network-fetched bundle, so prefetch is a
//     deliberate no-op here — kept as a documented unavailable-state stub so
//     the hover/focus call-site shape stays identical to the web component.
//
//   - `GuardedLink` (web L3, L45) and the `<a>` element it renders: not a
//     native element, and the native `GuardedLink` parity port does not exist
//     yet, so this link renders a React Native `Pressable` with
//     `accessibilityRole="link"`. Actual navigation is the caller's `onPress`
//     responsibility (the native analog of GuardedLink's click -> router
//     navigate), exactly as the web component delegated the click to its
//     wrapped `GuardedLink` and never navigated itself.
//
// The web triggers prefetch on hover (`onMouseEnter`) and `onFocus`, not on
// click. That intent is preserved by wiring the no-op `prefetchRoute` to the
// Pressable's `onHoverIn` (the native hover event, macOS/Windows/RN-Web) and
// `onFocus`, while still forwarding any caller-supplied handlers — mirroring
// web L48-55 line for line.
//
// Like the web component (web L25-28), this is deliberately NOT a `forwardRef`
// component: the wrapped link does not forward refs, so accepting one here
// would silently drop it, and no call site needs the underlying ref.
//
// No DOM elements, react-router-dom, Recharts, Leaflet, or old web UI
// components are imported — only React Native primitives.

import React from 'react';
import {Pressable, type PressableProps} from 'react-native';

/**
 * Native analog of react-router-dom's `LinkProps['to']`: either a path string
 * or a location-like object exposing `pathname` (the only field `pathFromTo`
 * reads). Mirrors web L30's `PrefetchLinkProps = LinkProps` for the `to` shape.
 */
export type LinkTo = string | {pathname?: string};

/**
 * Full prop surface for the native prefetch link. The web `PrefetchLinkProps`
 * was `LinkProps` (the entire anchor surface); its native counterpart is
 * `PressableProps` plus the `to` destination.
 */
export interface PrefetchLinkProps extends PressableProps {
  to: LinkTo;
}

// web L32-35: resolve the destination to a comparable path string.
function pathFromTo(to: LinkTo): string {
  if (typeof to === 'string') {
    return to;
  }
  return to?.pathname ?? '';
}

// Native-safe stand-in for web `prefetchRoute` (`@/lib/routePrefetch`,
// web L4/L49/L53). Prefetching a code-split route chunk is a browser/Vite-only
// optimization with no React Native equivalent, so this is intentionally a
// no-op; `path` is referenced so the function is a faithful, lint-clean stub
// that keeps the hover/focus call-site shape identical to the web component.
function prefetchRoute(path: string): void {
  void path;
}

export function PrefetchLink({
  to,
  onHoverIn,
  onFocus,
  ...rest
}: PrefetchLinkProps) {
  const path = pathFromTo(to);
  return (
    <Pressable
      accessibilityRole="link"
      {...rest}
      onHoverIn={event => {
        prefetchRoute(path);
        onHoverIn?.(event);
      }}
      onFocus={event => {
        prefetchRoute(path);
        onFocus?.(event);
      }}
    />
  );
}

PrefetchLink.displayName = 'PrefetchLink';

export default PrefetchLink;
