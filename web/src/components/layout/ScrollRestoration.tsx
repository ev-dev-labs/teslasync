import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * ScrollRestoration for classic BrowserRouter routes.
 *
 * React Router v6 ships a `<ScrollRestoration>` component that only works
 * with the data-router (`createBrowserRouter`). TeslaSync uses the classic
 * `<BrowserRouter>` because the route tree is hand-written in `App.tsx`,
 * so this is a small re-implementation tailored to our layout.
 *
 * What it does:
 *   - Tracks the scrollTop of the scrollable region per location key
 *     (path + search). Stored in `sessionStorage` so it survives a
 *     navigation but not a tab close.
 *   - On POP (back/forward), restores the saved scrollTop synchronously
 *     before the browser paints. If no entry exists (first visit),
 *     scrolls to top.
 *   - On PUSH/REPLACE, scrolls to top — that is what the user expects when
 *     they click a nav link.
 *   - Operates on the `<main id="main-content">` element from `Layout.tsx`
 *     because that's the actual scroll container. Falls back to `window` if
 *     the main element is not present (e.g. standalone routes like
 *     `/watch` or `/onboarding`).
 *
 * Mount it ONCE near the router root. It listens to the current location;
 * mounting it twice would double the writes (harmless) but read the wrong
 * key on restoration.
 */

const STORAGE_PREFIX = 'teslasync.scroll:';

function keyFor(pathname: string, search: string): string {
  return `${STORAGE_PREFIX}${pathname}${search}`;
}

function readSaved(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: number): void {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch {
    // sessionStorage may be disabled (private mode, quota exceeded). The
    // user just loses scroll restoration for that visit — never a fatal.
  }
}

function getScrollEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('main-content');
}

function getScrollTop(target: HTMLElement | null): number {
  if (target) return target.scrollTop;
  if (typeof window === 'undefined') return 0;
  return window.scrollY;
}

function setScrollTop(target: HTMLElement | null, top: number): void {
  if (target) {
    target.scrollTop = top;
    return;
  }
  if (typeof window === 'undefined') return;
  window.scrollTo({ top, behavior: 'auto' });
}

export function ScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();

  // Scroll key for the current location (path + search).
  const key = keyFor(location.pathname, location.search);

  // Id of a pending rAF-throttled save. Shared across both effects so the
  // restore pass can cancel a save scheduled on the OUTGOING route before it
  // resets the scroll — otherwise that rAF fires after the reset and clobbers
  // the stored position with 0. 0 means "nothing scheduled".
  const pendingSave = useRef(0);

  // Persist the current scrollTop while the user scrolls. Throttled with
  // requestAnimationFrame so we write at most once per paint regardless of
  // scroll velocity.
  useEffect(() => {
    const target = getScrollEl();
    const scrollSource: HTMLElement | Window = target ?? window;

    const onScroll = () => {
      if (pendingSave.current) return;
      pendingSave.current = requestAnimationFrame(() => {
        pendingSave.current = 0;
        writeSaved(key, getScrollTop(target));
      });
    };

    scrollSource.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (pendingSave.current) {
        cancelAnimationFrame(pendingSave.current);
        pendingSave.current = 0;
      }
      scrollSource.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  // Restore (or scroll-to-top) on every navigation. Use useLayoutEffect so
  // the scroll position is set before the browser paints — otherwise the
  // user briefly sees the top of the page before it jumps.
  useLayoutEffect(() => {
    const target = getScrollEl();

    // A save scheduled on the previous route must not survive into this one:
    // it would fire after the scroll reset below and overwrite the stored
    // position with 0.
    if (pendingSave.current) {
      cancelAnimationFrame(pendingSave.current);
      pendingSave.current = 0;
    }

    if (navType === 'POP') {
      const saved = readSaved(key);
      setScrollTop(target, saved ?? 0);
    } else {
      // PUSH or REPLACE — fresh navigation. Always start at the top.
      setScrollTop(target, 0);
    }

    return () => {
      // Final flush of the outgoing position BEFORE the next route resets it.
      // This cleanup runs in the commit's layout phase, ahead of the next
      // restore — so the scroll is still at the user's position here. A
      // passive (useEffect) cleanup would instead run after the reset and
      // persist 0, silently breaking back/forward restoration.
      writeSaved(key, getScrollTop(target));
    };
  }, [key, navType]);

  return null;
}
