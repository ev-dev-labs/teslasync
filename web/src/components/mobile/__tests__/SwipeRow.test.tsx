import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import { SwipeRow } from '../SwipeRow';

function fireTouch(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  el: Element,
  touches: { clientX: number; clientY: number }[],
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touchList = touches.map(t => ({
    clientX: t.clientX,
    clientY: t.clientY,
    identifier: 0,
    pageX: t.clientX,
    pageY: t.clientY,
    screenX: 0,
    screenY: 0,
    target: el,
  }));
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : touchList });
  Object.defineProperty(event, 'changedTouches', { value: touchList });
  Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' || type === 'touchcancel' ? [] : touchList });
  el.dispatchEvent(event);
}

/**
 * Stub `getBoundingClientRect` on the SwipeRow wrapper so the half-width
 * auto-fire calculation has a deterministic basis. jsdom returns 0 for
 * width, which would make every release look like a "far swipe".
 */
function stubRowWidth(width: number) {
  const original = HTMLDivElement.prototype.getBoundingClientRect;
  HTMLDivElement.prototype.getBoundingClientRect = function () {
    return {
      width,
      height: 48,
      top: 0,
      left: 0,
      right: width,
      bottom: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    HTMLDivElement.prototype.getBoundingClientRect = original;
  };
}

describe('SwipeRow', () => {
  beforeEach(() => {
    setCoarsePointer(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reveals the right action panel after a left swipe past the reveal threshold', () => {
    const restore = stubRowWidth(400);
    try {
      const onAction = vi.fn();
      render(
        <SwipeRow rightAction={{ label: 'Archive', onAction, tone: 'default' }} revealThreshold={64}>
          <div>row body</div>
        </SwipeRow>,
      );
      const row = screen.getByTestId('swipe-row');

      act(() => { fireTouch('touchstart', row, [{ clientX: 200, clientY: 50 }]); });
      // Drag left 80px (past 64 reveal threshold but well under half-width=200).
      act(() => { fireTouch('touchmove', row, [{ clientX: 120, clientY: 50 }]); });
      act(() => { fireTouch('touchend', row, []); });

      // Row should be peeked (not auto-fired) — onAction not called yet.
      expect(onAction).not.toHaveBeenCalled();
      expect(Number(row.dataset.offset ?? '0')).toBeLessThan(0);
    } finally {
      restore();
    }
  });

  it('auto-fires the right action when released past the half-width', () => {
    const restore = stubRowWidth(400);
    try {
      const onAction = vi.fn();
      render(
        <SwipeRow rightAction={{ label: 'Archive', onAction, tone: 'default' }} revealThreshold={64}>
          <div>row body</div>
        </SwipeRow>,
      );
      const row = screen.getByTestId('swipe-row');

      act(() => { fireTouch('touchstart', row, [{ clientX: 350, clientY: 50 }]); });
      // Drag left 300px — past 200 (50% of 400), so we auto-fire.
      act(() => { fireTouch('touchmove', row, [{ clientX: 50, clientY: 50 }]); });
      act(() => { fireTouch('touchend', row, []); });

      expect(onAction).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('does NOT fire when the swipe is below the reveal threshold', () => {
    const restore = stubRowWidth(400);
    try {
      const onAction = vi.fn();
      render(
        <SwipeRow rightAction={{ label: 'Archive', onAction, tone: 'default' }} revealThreshold={64}>
          <div>row body</div>
        </SwipeRow>,
      );
      const row = screen.getByTestId('swipe-row');

      act(() => { fireTouch('touchstart', row, [{ clientX: 200, clientY: 50 }]); });
      // Drag left only 30px — under both 64 reveal and 200 auto-fire.
      act(() => { fireTouch('touchmove', row, [{ clientX: 170, clientY: 50 }]); });
      act(() => { fireTouch('touchend', row, []); });

      expect(onAction).not.toHaveBeenCalled();
      // Row should snap back to 0.
      expect(Number(row.dataset.offset ?? '0')).toBe(0);
    } finally {
      restore();
    }
  });

  it('cancels the swipe when the user drags vertically (preserves list scroll)', () => {
    const restore = stubRowWidth(400);
    try {
      const onAction = vi.fn();
      render(
        <SwipeRow rightAction={{ label: 'Archive', onAction, tone: 'default' }} revealThreshold={64}>
          <div>row body</div>
        </SwipeRow>,
      );
      const row = screen.getByTestId('swipe-row');

      act(() => { fireTouch('touchstart', row, [{ clientX: 200, clientY: 50 }]); });
      // Vertical drag dominates — gesture should abort, no offset applied.
      act(() => { fireTouch('touchmove', row, [{ clientX: 195, clientY: 150 }]); });
      act(() => { fireTouch('touchend', row, []); });

      expect(onAction).not.toHaveBeenCalled();
      expect(Number(row.dataset.offset ?? '0')).toBe(0);
    } finally {
      restore();
    }
  });

  it('renders children straight through with no testid when enabled is false', () => {
    render(
      <SwipeRow
        rightAction={{ label: 'Archive', onAction: vi.fn() }}
        enabled={false}
      >
        <div>row body</div>
      </SwipeRow>,
    );
    expect(screen.queryByTestId('swipe-row')).not.toBeInTheDocument();
    expect(screen.getByText('row body')).toBeInTheDocument();
  });

  it('renders children straight through when there are no actions configured', () => {
    render(
      <SwipeRow>
        <div>row body</div>
      </SwipeRow>,
    );
    expect(screen.queryByTestId('swipe-row')).not.toBeInTheDocument();
    expect(screen.getByText('row body')).toBeInTheDocument();
  });
});
