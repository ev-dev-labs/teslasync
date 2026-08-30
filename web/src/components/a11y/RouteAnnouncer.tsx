/**
 * Route-change announcer.
 *
 * Single-page-app navigation is silent to screen readers — clicking a
 * `<NavLink>` swaps the document content but the AT user gets no
 * spoken cue that the page has changed. WCAG 2.4.2 (Page Titled) and
 * the WAI-ARIA APG both require SPAs to fire an `aria-live="polite"`
 * announcement carrying the new page's title whenever the route
 * changes.
 *
 * Implementation
 * --------------
 * Mounts once near the top of `<App />`. Subscribes to React Router's
 * `useLocation()` and, on every pathname change AFTER the first
 * render, waits for the destination title to replace the shell's temporary
 * `TeslaSync` title, and pushes the settled value into a
 * `VisuallyHidden liveRegion`.
 *
 * The 100 ms delay exists because `usePageTitle` runs INSIDE the
 * lazy-loaded page component — at the instant `useLocation()` fires,
 * the new page's chunk may still be downloading and the canonical
 * title for the new route hasn't been written to `document.title`
 * yet. The first read waits 100 ms; if the shell placeholder is still
 * present, a `MutationObserver` watches the document title until the route
 * supplies a meaningful value. A CPU-constrained lazy load therefore cannot
 * turn the placeholder into a false route announcement.
 *
 * Why NOT route through `useAnnouncer()` / `<AnnouncerRegion>`
 * -----------------------------------------------------------
 * The shared announcer is for imperative event-driven announcements
 * ("3 items archived", "Filter removed") fired from event handlers.
 * Route changes are declarative — they're a property of the URL,
 * not of any user action — and need their own region so a noisy
 * mutation announcement doesn't get clobbered by a route change
 * landing in the same tick. Splitting them also makes the test
 * surface trivially scoped: this file owns ONE concern and asserts
 * exactly one region.
 *
 * The region itself still goes through `<VisuallyHidden liveRegion>`
 * because the `audit:sr-only` script forbids the literal Tailwind
 * `sr-only` class outside `VisuallyHidden.tsx`.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { VisuallyHidden } from './VisuallyHidden';

/** Default delay before reading `document.title` after a route change. */
const DEFAULT_ANNOUNCE_DELAY_MS = 100;
const SHELL_TITLE = 'TeslaSync';

export interface RouteAnnouncerProps {
  /**
   * Override the read delay. Used by tests to drive the timer with
   * `vi.advanceTimersByTime`. Production should leave the default.
   */
  delayMs?: number;
}

export function RouteAnnouncer({
  delayMs = DEFAULT_ANNOUNCE_DELAY_MS,
}: RouteAnnouncerProps = {}) {
  const { pathname } = useLocation();
  const [message, setMessage] = useState('');
  const firstRender = useRef(true);
  // Rotating zero-width-space counter — see padding logic below.
  const counter = useRef(0);

  useEffect(() => {
    // The browser already announces the page title on initial load
    // (and the ARIA spec assumes so). Firing our own announcement on
    // first paint would double-speak the title.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    let titleObserver: MutationObserver | null = null;

    const readSettledTitle = () => {
      const title =
        typeof document !== 'undefined' ? document.title : '';
      if (!title || title === SHELL_TITLE) {
        if (!title) setMessage('');
        if (!titleObserver && document.head) {
          titleObserver = new MutationObserver(readSettledTitle);
          titleObserver.observe(document.head, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
        return;
      }
      titleObserver?.disconnect();
      titleObserver = null;
      // Rotate a 0-3 zero-width-space suffix on every announcement.
      // Without this, two consecutive routes that resolve to the same
      // `document.title` (e.g. `/charging/123` → `/charging/456` —
      // both render `Charging Session — TeslaSync`) would not be
      // announced the second time because the region's text content
      // is identical and most screen readers skip duplicates.
      counter.current = (counter.current + 1) % 4;
      const padding = '\u200B'.repeat(counter.current);
      setMessage(`${title}${padding}`);
    };

    const id = window.setTimeout(readSettledTitle, delayMs);

    return () => {
      window.clearTimeout(id);
      titleObserver?.disconnect();
    };
  }, [pathname, delayMs]);

  return (
    <VisuallyHidden
      liveRegion
      priority="polite"
      data-testid="route-announcer"
    >
      {message}
    </VisuallyHidden>
  );
}
