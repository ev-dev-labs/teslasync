// Native parity port of web/src/hooks/useInView.ts.
//
// `useInView` is the web's "is this element currently in the viewport?" hook,
// built on the browser `IntersectionObserver`. It returns a ref to attach to a
// target element plus a boolean, and is used to lazy-mount expensive subtrees
// (charts, maps, iframes) and to fire scroll-in animations the first time a node
// enters the viewport. By default `inView` latches `true` once the element has
// been seen (`freezeOnceVisible`); set `freezeOnceVisible: false` on the web to
// flip back to `false` when it scrolls out. Critically, the web hook is already
// SSR-safe: when `IntersectionObserver` is undefined (SSR / jsdom without the
// polyfill) it reports `true` immediately so callers still render their content.
//
// React Native has NO `IntersectionObserver` and no DOM viewport-intersection
// API (contract rules 4 & 7): there is no `IntersectionObserver` constructor and
// no per-element intersection callback to subscribe to. Viewport intersection is
// therefore permanently UNAVAILABLE on native, and the native-safe mapping is
// exactly the web hook's own documented fallback branch — `inView` is seeded
// `true` and never transitions, so every lazy-mounted subtree and scroll-in
// animation renders immediately. "Visible by default" is the safe degrade for a
// "lazy-mount once visible" contract (never hide content), and is the explicit
// unavailable state required by rule 7.
//
// API parity is preserved:
//   - `UseInViewOptions` keeps all four fields with their JSDoc + default values
//     intact. `rootMargin`, `threshold`, and `freezeOnceVisible` are unchanged;
//     the DOM `root?: Element | null` is retyped to its native host-node analog
//     `React.ComponentRef<typeof View> | null`. All four are accepted for source
//     compatibility but are inert without an observer to configure (documented),
//     so the parameter is named `_options` to mark it intentionally unused here.
//   - The generic default changes from the DOM `HTMLDivElement` to its native
//     analog `React.ComponentRef<typeof View>`; the `{ ref, inView }` return
//     shape is unchanged. The ref type reads `RefObject<T | null>` only because
//     React 19's `useRef<T>(null)` yields `RefObject<T | null>` — the same
//     `{ current: T | null }` the web's React 18 `RefObject<T>` denoted.
//   - The web `useState(() => typeof IntersectionObserver === 'undefined')`
//     SSR-detection initializer is preserved as
//     `useState(() => !intersectionObserverAvailable)`, probing the global the
//     same way without dragging in the DOM lib types. The IntersectionObserver
//     `useEffect`/observer and the `seenRef` freeze-once-visible latch have no
//     native event source to drive them, so — since the probe is always false —
//     `inView` simply stays at its `true` seed and they are omitted.
//
// No DOM modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only `react` and the `react-native` `View` host type.

import React, { useRef, useState, type RefObject } from 'react';
import { type View } from 'react-native';

// Mirror of the web hook's `typeof IntersectionObserver === 'undefined'` probe,
// written against `globalThis` so it needs no DOM lib types (matching the
// existing native `(globalThis as { localStorage?: ... }).localStorage` style).
// Always `false` under React Native; kept as a runtime probe so a host that ever
// polyfills the API is detected identically to the web.
const intersectionObserverAvailable =
  typeof (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver !== 'undefined';

export interface UseInViewOptions {
  /** IntersectionObserver `rootMargin`. Default `'200px'` (pre-mount slightly before scroll-in). */
  rootMargin?: string;
  /** IntersectionObserver `threshold`. Default `0`. */
  threshold?: number | number[];
  /** Optional scroll root. Defaults to the viewport. */
  root?: React.ComponentRef<typeof View> | null;
  /** Once visible, stay `true` even if the element scrolls back out. Default `true`. */
  freezeOnceVisible?: boolean;
}

export function useInView<T = React.ComponentRef<typeof View>>(
  _options: UseInViewOptions = {},
): { ref: RefObject<T | null>; inView: boolean } {
  const ref = useRef<T>(null);
  const [inView] = useState<boolean>(() => !intersectionObserverAvailable);

  return { ref, inView };
}
