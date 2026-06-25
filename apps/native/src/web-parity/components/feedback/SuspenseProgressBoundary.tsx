// Native parity port of web/src/components/feedback/SuspenseProgressBoundary.tsx.
//
// Suspense -> globalProgress bridge. Wraps React `<Suspense>` so that whenever
// the fallback mounts (because a lazy boundary is resolving) a shared global
// "app is busy" progress channel activates, and whenever the real children
// finally render the fallback unmounts and the channel deactivates. This gives
// every Suspense boundary a single, shared progress affordance without each
// screen wiring its own loader. Wire it as a 1:1 replacement for `<Suspense>`
// at every lazy boundary:
//
//     <SuspenseProgressBoundary fallback={<PageLoader />}>
//       <LazyScreen />
//     </SuspenseProgressBoundary>
//
// React's `Suspense`, `useEffect`, and `Fragment` are core React (not DOM), so
// they run unchanged on React Native — the component tree and its
// mount/unmount bridging behaviour are preserved exactly. The source file
// contains no DOM elements at all, so nothing browser-only crosses over.
//
// Native-safe adaptation (documented in the sidecar):
//   - The web component imports the shared `@/lib/globalProgress` singleton,
//     whose only visible output is the web `<TopProgress>` 2px strip rendered
//     at the very top of the DOM viewport. That bar consumer is not ported:
//     per web-parity/App.tsx, lazy-route chunk progress is represented by the
//     typed native route manifest, not a DOM Suspense/progress bar. To keep
//     this file self-contained — matching the inline-the-lib-dependency
//     pattern used by the other native feedback ports (CookieConsentBanner,
//     RequiresAuth) — the start/stop bridge this component actually depends on
//     is reproduced below by a native-safe, DOM-free controller. It preserves
//     the documented concurrency contract verbatim: starts stack
//     (`activeCount`), the returned stop is idempotent via a closure-local
//     guard so React StrictMode's double-invoked dev effects can never
//     underflow the counter, and the count clamps at zero. The web module's
//     setInterval trickle animation and the `subscribe()` channel that feed
//     the `<TopProgress>` bar belong to the separate globalProgress module and
//     have no native consumer, so they are intentionally not reproduced here.

import React, {
  Suspense,
  useEffect,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

// ── Native-safe globalProgress bridge ───────────────────────────────────────
// In-process "app is busy" counter. The only surface this component uses is
// `start()`, which returns an idempotent `stop()`. Mirrors the web
// `@/lib/globalProgress` start/stop concurrency contract exactly.
let activeCount = 0;

function startGlobalProgress(): () => void {
  activeCount += 1;

  // Closure-local guard so the same stop function can be safely called twice
  // (StrictMode double-invocation, defensive try/finally chains). Without this
  // guard activeCount would underflow when the same stop fires twice and
  // another consumer is also active.
  let stopped = false;
  return function stopGlobalProgress(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    activeCount = Math.max(0, activeCount - 1);
  };
}

const globalProgress = {start: startGlobalProgress} as const;

export function SuspenseProgressBoundary({
  children,
  fallback,
}: PropsWithChildren<{fallback: ReactNode}>) {
  return (
    <Suspense
      fallback={
        <ProgressTrackingFallback>{fallback}</ProgressTrackingFallback>
      }>
      {children}
    </Suspense>
  );
}

SuspenseProgressBoundary.displayName = 'SuspenseProgressBoundary';

/**
 * Internal fallback wrapper — the only point at which `start()` / `stop()`
 * fire. Mounting this component (because Suspense suspended) activates the
 * channel; unmounting it (because the lazy import resolved) deactivates it.
 *
 * Implementation note: the `start()` call lives inside `useEffect`, not at
 * render time, because under React StrictMode render bodies may run twice in
 * dev without the matching cleanup. `useEffect` guarantees the start/stop pair
 * fires exactly once per real mount, and the closure-local idempotency guard
 * inside `start()`'s returned stop function defends against StrictMode's effect
 * double-invocation in dev.
 */
function ProgressTrackingFallback({children}: PropsWithChildren) {
  useEffect(() => {
    const stop = globalProgress.start();
    return stop;
  }, []);
  return <>{children}</>;
}

export default SuspenseProgressBoundary;
