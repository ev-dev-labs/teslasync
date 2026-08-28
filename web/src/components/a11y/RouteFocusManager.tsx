/**
 * Route-focus manager (A11Y-03).
 *
 * Mount once next to `<RouteAnnouncer />`. On every client-side
 * navigation it moves keyboard focus to the new page's `<h1>` (marked
 * with {@link ROUTE_FOCUS_TARGET_ATTR} by `PageContainer`), falling
 * back to the `<main>` landmark for routes that render no page header.
 *
 * WCAG 2.4.3 (Focus Order) requires that a change of context preserves
 * a meaningful focus position. In an SPA the element that was focused
 * (a sidebar link) survives the navigation, so the next Tab continues
 * from the CHROME rather than the content the user just requested —
 * screen-reader and switch users have to re-traverse the entire shell
 * on every navigation.
 *
 * Every reason we might NOT move focus lives in
 * `@/lib/routeFocus` as a pure decision function, so the policy is
 * unit-tested without a router. This component only supplies the DOM
 * facts and performs the move.
 *
 * Timing
 * ------
 * The target `<h1>` lives inside a lazily-loaded route chunk. At the
 * instant `useLocation()` fires, that chunk may still be downloading,
 * so the heading does not exist yet. We poll on
 * `requestAnimationFrame` for up to {@link FOCUS_TIMEOUT_MS} and take
 * the first frame where the HEADING is present.
 *
 * The `<main>` landmark is deliberately excluded from that poll. It is
 * rendered by `<Layout>` and therefore exists on every frame, so
 * including it in the search would make the retry loop unreachable —
 * frame one would always find `<main>`, focus it, and stop, and a
 * heading that arrived two frames later would never be used. `<main>`
 * receives focus after {@link FOCUS_FALLBACK_DELAY_MS}, but the manager
 * continues watching for the heading. If it arrives later and the user has
 * not moved away from `<main>`, focus advances to the heading. This keeps
 * headerless routes responsive without losing the correct target on a cold
 * or CPU-constrained lazy load.
 *
 * Why a separate component from `<RouteAnnouncer>`
 * -----------------------------------------------
 * Announcing and focusing are different WCAG obligations with
 * different suppression rules: the announcement is correct even when
 * the user is mid-typing (it never disturbs the caret), while the focus
 * move is not. Keeping them apart means neither policy has to carry the
 * other's exceptions.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import {
  decideRouteFocus,
  ROUTE_FOCUS_FALLBACK_SELECTOR,
  ROUTE_FOCUS_SCOPE_ATTR,
  ROUTE_FOCUS_TARGET_SELECTOR,
  type RouteNavigationKind,
} from '@/lib/routeFocus';

/**
 * How long to keep looking for the route-focus target before giving up.
 * A cold route chunk can take materially longer than one animation frame on
 * constrained devices, so the hard ceiling is intentionally generous.
 */
export const FOCUS_TIMEOUT_MS = 5_000;

/** When to give the stable `<main>` landmark provisional focus. */
export const FOCUS_FALLBACK_DELAY_MS = 350;

export interface RouteFocusManagerProps {
  /**
   * Override the hard heading search budget. Tests drive this with fake timers;
   * production should leave the default.
   */
  timeoutMs?: number;
  /** Override the provisional `<main>` fallback delay. */
  fallbackDelayMs?: number;
}

/**
 * The page heading for the route that just mounted, if it exists yet.
 *
 * Deliberately does NOT fall back to `<main>`: the fallback landmark is
 * rendered by `<Layout>` and is therefore present on *every* frame,
 * including the ones where the lazily-loaded route chunk has not yet
 * produced its heading. Folding the fallback in here made the retry
 * loop dead code — the very first frame always found `<main>`, focused
 * it, and returned, so a page heading that arrived two frames later was
 * never used. The fallback is resolved only once the search budget has
 * genuinely expired (see {@link resolveFallbackTarget}).
 */
function findHeadingTarget(pathname: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(ROUTE_FOCUS_TARGET_SELECTOR),
  );
  const scoped = candidates.find(
    (candidate) =>
      candidate
        .closest<HTMLElement>(`[${ROUTE_FOCUS_SCOPE_ATTR}]`)
        ?.getAttribute(ROUTE_FOCUS_SCOPE_ATTR) === pathname,
  );
  if (scoped) return scoped;

  // Routes outside the standard application layout (for example public share
  // views) have no RouteTransition scope. They remain valid only when the
  // heading itself is unscoped; a retained heading from another scoped route
  // must never win this fallback.
  return candidates.find(
    (candidate) => !candidate.closest(`[${ROUTE_FOCUS_SCOPE_ATTR}]`),
  ) ?? null;
}

/** The `<main>` landmark, used only after the heading search times out. */
function resolveFallbackTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(ROUTE_FOCUS_FALLBACK_SELECTOR);
}

export function RouteFocusManager({
  timeoutMs = FOCUS_TIMEOUT_MS,
  fallbackDelayMs = FOCUS_FALLBACK_DELAY_MS,
}: RouteFocusManagerProps = {}) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType() as RouteNavigationKind;
  const firstRender = useRef(true);
  const previousPath = useRef(pathname);

  useEffect(() => {
    const isFirstRender = firstRender.current;
    firstRender.current = false;
    const isSamePath = previousPath.current === pathname;
    previousPath.current = pathname;

    // Cheap, DOM-independent refusals are evaluated before we schedule
    // any work at all, so a query-only navigation costs nothing.
    const upfront = decideRouteFocus({
      navigationKind: navigationType,
      isFirstRender,
      isSamePath,
      // These four only matter at fire time; supply neutral values so
      // the up-front pass can only refuse for navigation-shaped
      // reasons.
      documentHasFocus: true,
      activeElement: null,
      scheduledFromElement: null,
    });
    if (!upfront.shouldFocus) return;

    const scheduledFrom = document.activeElement;
    const startedAt = Date.now();
    const fallbackAt = startedAt + Math.min(fallbackDelayMs, timeoutMs);
    const deadline = startedAt + timeoutMs;
    let frame = 0;
    let cancelled = false;
    let provisionalTarget: HTMLElement | null = null;

    const attempt = () => {
      if (cancelled) return;
      const heading = findHeadingTarget(pathname);
      const now = Date.now();
      const expired = Date.now() >= deadline;

      if (heading) {
        const decision = decideRouteFocus({
          navigationKind: navigationType,
          isFirstRender: false,
          isSamePath: false,
          documentHasFocus:
            typeof document.hasFocus === 'function' ? document.hasFocus() : true,
          activeElement: document.activeElement,
          scheduledFromElement: provisionalTarget ?? scheduledFrom,
        });
        if (!decision.shouldFocus) return;

        // `preventScroll` keeps ScrollRestoration authoritative: focusing
        // the heading must not scroll the container out from under a
        // restored position or an anchor jump.
        heading.focus({ preventScroll: true });
        return;
      }

      if (!provisionalTarget && (now >= fallbackAt || expired)) {
        const fallback = resolveFallbackTarget();
        if (fallback) {
          const decision = decideRouteFocus({
            navigationKind: navigationType,
            isFirstRender: false,
            isSamePath: false,
            documentHasFocus:
              typeof document.hasFocus === 'function' ? document.hasFocus() : true,
            activeElement: document.activeElement,
            scheduledFromElement: scheduledFrom,
          });
          if (!decision.shouldFocus) return;
          fallback.focus({ preventScroll: true });
          provisionalTarget = fallback;
        }
      }

      if (expired) return;
      frame = requestAnimationFrame(attempt);
    };

    frame = requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [pathname, navigationType, timeoutMs, fallbackDelayMs]);

  return null;
}
