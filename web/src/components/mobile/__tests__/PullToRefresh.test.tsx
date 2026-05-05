import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

// Drive `useIsCoarsePointer()` deterministically by stubbing matchMedia.
// We run these tests as if on a touch device unless a test overrides.
function setCoarsePointer(value: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('coarse') ? value : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// Stub framer-motion's reduced-motion hook so PullToRefresh can render
// without booting the real motion runtime.
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}));

// Stub i18n so the component can resolve fallback labels without the
// full i18n runtime.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import { PullToRefresh } from '../PullToRefresh';

/**
 * Dispatch a touch event with the shape PullToRefresh consumes. jsdom
 * supports `TouchEvent` constructor poorly, so we synthesise via the
 * generic `Event` and define `touches` / `changedTouches` ourselves.
 */
function fireTouch(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  el: Element,
  touches: { clientY: number; clientX?: number }[],
  options: { cancelable?: boolean } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: options.cancelable ?? true });
  const touchList = touches.map(t => ({
    clientX: t.clientX ?? 0,
    clientY: t.clientY,
    identifier: 0,
    pageX: t.clientX ?? 0,
    pageY: t.clientY,
    screenX: 0,
    screenY: 0,
    target: el,
  }));
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : touchList });
  Object.defineProperty(event, 'changedTouches', { value: touchList });
  Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' || type === 'touchcancel' ? [] : touchList });
  el.dispatchEvent(event);
  return event;
}

describe('PullToRefresh', () => {
  beforeEach(() => {
    setCoarsePointer(true);
    // jsdom defaults `window.scrollY` to 0 and `document.scrollTop` to 0
    // — that is exactly the "scrolled to top" condition we need to arm
    // the gesture.
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fires onRefresh when the user pulls past the threshold and releases', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh} threshold={80}>
        <div>list body</div>
      </PullToRefresh>,
    );
    const wrapper = screen.getByTestId('pull-to-refresh');

    act(() => { fireTouch('touchstart', wrapper, [{ clientY: 0 }]); });
    act(() => { fireTouch('touchmove', wrapper, [{ clientY: 100 }]); });
    act(() => { fireTouch('touchend', wrapper, []); });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire onRefresh when the pull is below the threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh} threshold={80}>
        <div>list body</div>
      </PullToRefresh>,
    );
    const wrapper = screen.getByTestId('pull-to-refresh');

    act(() => { fireTouch('touchstart', wrapper, [{ clientY: 0 }]); });
    act(() => { fireTouch('touchmove', wrapper, [{ clientY: 50 }]); });
    act(() => { fireTouch('touchend', wrapper, []); });

    // Give any microtask a chance to flush.
    await new Promise(r => setTimeout(r, 0));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does NOT fire onRefresh when the user has scrolled away from the top', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh} threshold={80}>
        <div>list body</div>
      </PullToRefresh>,
    );
    const wrapper = screen.getByTestId('pull-to-refresh');

    // Pretend the page is scrolled — touchstart should not arm.
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 200 });
    Object.defineProperty(document.documentElement, 'scrollTop', { configurable: true, writable: true, value: 200 });

    act(() => { fireTouch('touchstart', wrapper, [{ clientY: 0 }]); });
    act(() => { fireTouch('touchmove', wrapper, [{ clientY: 200 }]); });
    act(() => { fireTouch('touchend', wrapper, []); });

    await new Promise(r => setTimeout(r, 0));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('renders children straight through with no testid when enabled is false', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh} enabled={false}>
        <div>list body</div>
      </PullToRefresh>,
    );
    expect(screen.queryByTestId('pull-to-refresh')).not.toBeInTheDocument();
    expect(screen.getByText('list body')).toBeInTheDocument();
  });
});
