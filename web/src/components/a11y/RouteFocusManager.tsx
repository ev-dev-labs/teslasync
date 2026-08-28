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
 * is resolved only once the budget has genuinely expired, which is the
 * case it exists for: routes that render no page header at all, or a
 * chunk so slow that landing the user *somewhere* beats leaving focus
 * stranded on a removed nav link.
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
  ROUTE_FOCUS_TARGET_SELECTOR,
  type RouteNavigationKind,
} from '@/lib/routeFocus';

/**
 * How long to keep looking for the route-focus target before giving up
 * and using the `<main>` fallback. Roughly 20 frames at 60 Hz — long
 * enough for a lazy chunk that is already in the HTTP cache, short
 * enough that the user is not still waiting when focus finally lands.
 */
export const FOCUS_TIMEOUT_MS = 350;

export interface RouteFocusManagerProps {
  /**
   * Override the search budget. Tests drive this with fake timers;
   * production should leave the default.
   */
  timeoutMs?: number;
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
function findHeadingTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(ROUTE_FOCUS_TARGET_SELECTOR);
}

/** The `<main>` landmark, used only after the heading search times out. */
function resolveFallbackTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(ROUTE_FOCUS_FALLBACK_SELECTOR);
}

export function RouteFocusManager({
  timeoutMs = FOCUS_TIMEOUT_MS,
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
    const deadline = Date.now() + timeoutMs;
    let frame = 0;
    let cancelled = false;

    const attempt = () => {
      if (cancelled) return;
      const heading = findHeadingTarget();
      const expired = Date.now() >= deadline;
      // Keep looking while the budget lasts. The heading lives inside a
      // lazily-loaded route chunk, so on a cold navigation it appears
      // several frames after `useLocation()` fires.
      if (!heading && !expired) {
        frame = requestAnimationFrame(attempt);
        return;
      }
      const target = heading ?? resolveFallbackTarget();
      if (!target) return;

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

      // `preventScroll` keeps ScrollRestoration authoritative: focusing
      // the heading must not scroll the container out from under a
      // restored position or an anchor jump.
      target.focus({ preventScroll: true });
    };

    frame = requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [pathname, navigationType, timeoutMs]);

  return null;
}
