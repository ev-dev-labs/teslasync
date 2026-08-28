/**
 * RouteFocusManager integration contract (A11Y-03).
 *
 * Asserts that focus actually lands on the route-focus target after a
 * client-side navigation, that the `<main>` landmark is used when a
 * route renders no page heading, and that the manager honours the
 * suppression rules in `@/lib/routeFocus` end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { RouteFocusManager } from '../RouteFocusManager';
import {
  ROUTE_FOCUS_SCOPE_ATTR,
  ROUTE_FOCUS_TARGET_ATTR,
} from '@/lib/routeFocus';

/**
 * jsdom does not implement `requestAnimationFrame` deterministically
 * under fake timers, so drive it from `setTimeout`. Every `act()` tick
 * below then flushes the manager's polling loop.
 */
function installRafShim() {
  const original = {
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
  };
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id as unknown as NodeJS.Timeout)) as typeof cancelAnimationFrame;
  return () => {
    globalThis.requestAnimationFrame = original.raf;
    globalThis.cancelAnimationFrame = original.caf;
  };
}

/** Minimal stand-in for `<PageContainer>`'s focusable page heading. */
function PageHeading({ title }: { title: string }) {
  return (
    <h1 tabIndex={-1} data-route-focus-target="true" data-testid={`h1-${title}`}>
      {title}
    </h1>
  );
}

function Navigator({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

function flush(ms = 400) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Advance the clock in small, separately-`act()`-wrapped slices.
 *
 * A single `advanceTimersByTime(400)` runs every queued timer inside one
 * `act()` block, but React's own scheduler work is NOT a timer — the
 * state update that mounts a lazy route's heading only commits when the
 * `act()` block exits. Stepping lets React commit between frames, which
 * is what actually reproduces "chunk resolves a few frames after the
 * navigation".
 */
function flushFrames(frames: number, stepMs = 20) {
  for (let i = 0; i < frames; i += 1) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
  }
}

/**
 * A route whose heading appears only after `afterFrames` animation
 * frames — the shape of a real lazily-loaded route chunk, where
 * `useLocation()` fires while the chunk is still downloading.
 */
function LazyPage({ title, afterFrames }: { title: string; afterFrames: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let remaining = afterFrames;
    let id = 0;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) setReady(true);
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [afterFrames]);
  if (!ready) return <div data-testid="chunk-loading">loading…</div>;
  return <PageHeading title={title} />;
}

describe('RouteFocusManager', () => {
  let restoreRaf: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    restoreRaf = installRafShim();
    // `document.hasFocus()` is false in jsdom by default, which the
    // policy (correctly) treats as a backgrounded tab.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    restoreRaf();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('moves focus to the page heading after a forward navigation', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <main id="main-content" tabIndex={-1} />
        <Routes>
          <Route
            path="/a"
            element={
              <>
                <PageHeading title="A" />
                <Navigator to="/b" />
              </>
            }
          />
          <Route path="/b" element={<PageHeading title="B" />} />
        </Routes>
      </MemoryRouter>,
    );

    flush();

    const heading = document.querySelector('[data-testid="h1-B"]');
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute(ROUTE_FOCUS_TARGET_ATTR, 'true');
  });

  it('does not move focus on the first render', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <Routes>
          <Route path="/a" element={<PageHeading title="A" />} />
        </Routes>
      </MemoryRouter>,
    );

    flush();

    expect(document.activeElement).toBe(document.body);
  });

  it('falls back to the main landmark when a route has no page heading', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <main id="main-content" tabIndex={-1} data-testid="main" />
        <Routes>
          <Route path="/a" element={<Navigator to="/bare" />} />
          <Route path="/bare" element={<div>no heading here</div>} />
        </Routes>
      </MemoryRouter>,
    );

    flush();

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="main"]'),
    );
  });

  it('keeps polling for a heading that mounts several frames late', () => {
    // Regression guard. `<main>` is rendered by Layout and therefore
    // exists on EVERY frame. When the search included it, frame one
    // always found `<main>`, focused it, and returned — so a heading
    // arriving from a lazily-loaded chunk two frames later was never
    // used, and every cold navigation dumped the user above the page
    // title instead of on it.
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <main id="main-content" tabIndex={-1} data-testid="main" />
        <Routes>
          <Route path="/a" element={<Navigator to="/lazy" />} />
          <Route
            path="/lazy"
            element={
              <>
                <div {...{ [ROUTE_FOCUS_SCOPE_ATTR]: '/a' }}>
                  <PageHeading title="Retained previous route" />
                </div>
                <div {...{ [ROUTE_FOCUS_SCOPE_ATTR]: '/lazy' }}>
                  <LazyPage title="Lazy" afterFrames={5} />
                </div>
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    flushFrames(1);
    expect(document.activeElement).not.toBe(
      document.querySelector('[data-testid="h1-Retained previous route"]'),
    );

    flushFrames(10);

    const heading = document.querySelector('[data-testid="h1-Lazy"]');
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(
      document.querySelector('[data-testid="main"]'),
    );
  });

  it('does not settle on <main> before the heading has had its budget', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager timeoutMs={350} />
        <main id="main-content" tabIndex={-1} data-testid="main" />
        <Routes>
          <Route path="/a" element={<Navigator to="/lazy" />} />
          <Route path="/lazy" element={<LazyPage title="Lazy" afterFrames={3} />} />
        </Routes>
      </MemoryRouter>,
    );

    // One frame in, the chunk has not produced its heading yet. Focus
    // must still be unclaimed rather than parked on the landmark.
    flushFrames(1);
    expect(document.activeElement).not.toBe(
      document.querySelector('[data-testid="main"]'),
    );

    flushFrames(10);
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="h1-Lazy"]'),
    );
  });

  it('gives up on <main> once the heading budget is exhausted', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager timeoutMs={100} />
        <main id="main-content" tabIndex={-1} data-testid="main" />
        <Routes>
          <Route path="/a" element={<Navigator to="/lazy" />} />
          {/* Heading arrives long after the 100 ms budget. */}
          <Route path="/lazy" element={<LazyPage title="Lazy" afterFrames={40} />} />
        </Routes>
      </MemoryRouter>,
    );

    flushFrames(8);

    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="main"]'),
    );
    // …and the heading, once it finally lands, is not retro-focused.
    expect(document.querySelector('[data-testid="h1-Lazy"]')).toBeNull();
  });

  it('advances provisional main focus to a late heading when focus stayed put', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager timeoutMs={1_000} fallbackDelayMs={100} />
        <main id="main-content" tabIndex={-1} data-testid="main" />
        <Routes>
          <Route path="/a" element={<Navigator to="/lazy" />} />
          <Route path="/lazy" element={<LazyPage title="Lazy" afterFrames={20} />} />
        </Routes>
      </MemoryRouter>,
    );

    flushFrames(8);
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="main"]'),
    );

    flushFrames(20);
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="h1-Lazy"]'),
    );
  });

  it('leaves focus alone while the user is typing in a field', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <input data-testid="filter" />
        <Routes>
          <Route path="/a" element={<Navigator to="/b" />} />
          <Route path="/b" element={<PageHeading title="B" />} />
        </Routes>
      </MemoryRouter>,
    );

    const input = document.querySelector<HTMLInputElement>('[data-testid="filter"]')!;
    input.focus();
    expect(document.activeElement).toBe(input);

    flush();

    expect(document.activeElement).toBe(input);
  });

  it('leaves focus alone when a dialog owns it', () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <div role="dialog" aria-modal="true">
          <button data-testid="dialog-button">Confirm</button>
        </div>
        <Routes>
          <Route path="/a" element={<Navigator to="/b" />} />
          <Route path="/b" element={<PageHeading title="B" />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="dialog-button"]',
    )!;
    button.focus();

    flush();

    expect(document.activeElement).toBe(button);
  });

  it('stays silent when the tab is backgrounded', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/a']}>
        <RouteFocusManager />
        <Routes>
          <Route path="/a" element={<Navigator to="/b" />} />
          <Route path="/b" element={<PageHeading title="B" />} />
        </Routes>
      </MemoryRouter>,
    );

    flush();

    expect(document.activeElement).toBe(document.body);
  });
});
