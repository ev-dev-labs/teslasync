/**
 * PlaybackSpeedMenu — behaviour + hardening suite.
 *
 * Covers every export of the module:
 *   - REPLAY_SPEEDS  (the canonical slot list)
 *   - nextSpeed      (forward cycle + wrap + invalid-input fallback)
 *   - shiftSpeed     (clamped signed stepping + the NaN/Infinity/fractional
 *                     guard that keeps its `: ReplaySpeed` return-type honest)
 *   - PlaybackSpeedMenu (render, accessible name that announces the value,
 *                     left-click forward cycle, right-click backward step with
 *                     preventDefault, className override, decorative-icon a11y,
 *                     and keyboard-operable native button)
 *
 * react-i18next is stubbed to echo each call's fallback (mirrors the sibling
 * Delta.test.tsx convention) so the accessible name is deterministic. `fireEvent`
 * is the repo's interaction primitive — @testing-library/user-event is not a
 * project dependency (see BulkActionsToolbar.test.tsx). No network is touched.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PlaybackSpeedMenu,
  REPLAY_SPEEDS,
  nextSpeed,
  shiftSpeed,
} from './PlaybackSpeedMenu';
import type { ReplaySpeed } from '@/hooks/useTripReplay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

/* ------------------------------------------------------------------ */
/*  REPLAY_SPEEDS                                                       */
/* ------------------------------------------------------------------ */

describe('REPLAY_SPEEDS', () => {
  it('exposes the canonical ordered slot list', () => {
    expect(REPLAY_SPEEDS).toEqual([1, 10, 25, 50, 100]);
  });

  it('is strictly ascending and all-positive', () => {
    for (let i = 1; i < REPLAY_SPEEDS.length; i++) {
      expect(REPLAY_SPEEDS[i]).toBeGreaterThan(REPLAY_SPEEDS[i - 1]);
    }
    expect(REPLAY_SPEEDS.every((s) => s > 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  nextSpeed                                                           */
/* ------------------------------------------------------------------ */

describe('nextSpeed', () => {
  it('advances to the next-fastest slot', () => {
    expect(nextSpeed(1)).toBe(10);
    expect(nextSpeed(10)).toBe(25);
    expect(nextSpeed(25)).toBe(50);
    expect(nextSpeed(50)).toBe(100);
  });

  it('wraps around from the fastest slot back to the slowest', () => {
    expect(nextSpeed(100)).toBe(1);
  });

  it('falls back to the slowest slot for a value not in the list', () => {
    expect(nextSpeed(7 as ReplaySpeed)).toBe(1);
  });

  it('only ever returns a member of REPLAY_SPEEDS', () => {
    REPLAY_SPEEDS.forEach((s) => expect(REPLAY_SPEEDS).toContain(nextSpeed(s)));
  });
});

/* ------------------------------------------------------------------ */
/*  shiftSpeed                                                          */
/* ------------------------------------------------------------------ */

describe('shiftSpeed — signed stepping', () => {
  it('steps forward one slot for delta +1', () => {
    expect(shiftSpeed(1, 1)).toBe(10);
    expect(shiftSpeed(25, 1)).toBe(50);
  });

  it('steps backward one slot for delta -1', () => {
    expect(shiftSpeed(10, -1)).toBe(1);
    expect(shiftSpeed(100, -1)).toBe(50);
  });

  it('does not move for delta 0', () => {
    expect(shiftSpeed(25, 0)).toBe(25);
  });
});

describe('shiftSpeed — clamping (never wraps)', () => {
  it('clamps at the top slot', () => {
    expect(shiftSpeed(100, 1)).toBe(100);
    expect(shiftSpeed(1, 99)).toBe(100);
  });

  it('clamps at the bottom slot', () => {
    expect(shiftSpeed(1, -1)).toBe(1);
    expect(shiftSpeed(100, -99)).toBe(1);
  });
});

describe('shiftSpeed — hardening', () => {
  it('treats an unknown current value as the slowest slot (idx 0)', () => {
    // idx === -1 → safeIdx 0, so +1 lands on the second slot.
    expect(shiftSpeed(3 as ReplaySpeed, 1)).toBe(10);
    expect(shiftSpeed(3 as ReplaySpeed, 0)).toBe(1);
  });

  it('never returns undefined for a NaN delta — it stays put', () => {
    const result = shiftSpeed(25, NaN);
    expect(result).toBe(25);
    expect(REPLAY_SPEEDS).toContain(result);
  });

  it('never returns undefined for an Infinity delta — it stays put', () => {
    expect(shiftSpeed(50, Infinity)).toBe(50);
    expect(shiftSpeed(50, -Infinity)).toBe(50);
  });

  it('rounds a fractional delta to a whole slot and returns a valid member', () => {
    const result = shiftSpeed(1, 1.4);
    expect(REPLAY_SPEEDS).toContain(result);
    expect(result).toBe(10); // round(1.4) === 1 → idx 0 + 1
  });
});

/* ------------------------------------------------------------------ */
/*  PlaybackSpeedMenu component                                         */
/* ------------------------------------------------------------------ */

function setup(speed: ReplaySpeed, className?: string) {
  const onChange = vi.fn();
  const utils = render(
    <PlaybackSpeedMenu speed={speed} onChange={onChange} className={className} />,
  );
  const button = screen.getByRole('button');
  return { onChange, button, ...utils };
}

describe('PlaybackSpeedMenu — render', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the current speed as visible text', () => {
    const { button } = setup(50);
    expect(button.textContent).toContain('50x');
  });

  it('renders a native, keyboard-operable button', () => {
    const { button } = setup(10);
    expect(button.tagName).toBe('BUTTON');
  });

  it('marks the decorative chevron icon as hidden from assistive tech', () => {
    const { container } = setup(10);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PlaybackSpeedMenu — accessible name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('folds the current speed value into the accessible name', () => {
    setup(50);
    expect(
      screen.getByRole('button', { name: /playback speed: 50x/i }),
    ).toBeInTheDocument();
  });

  it('updates the accessible name when the speed prop changes', () => {
    const { rerender } = setup(1);
    expect(screen.getByRole('button', { name: /playback speed: 1x/i })).toBeInTheDocument();
    rerender(<PlaybackSpeedMenu speed={100} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /playback speed: 100x/i })).toBeInTheDocument();
  });
});

describe('PlaybackSpeedMenu — left-click cycles forward', () => {
  beforeEach(() => vi.clearAllMocks());

  it('advances to the next speed on click', () => {
    const { onChange, button } = setup(1);
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('wraps from the fastest speed back to the slowest', () => {
    const { onChange, button } = setup(100);
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe('PlaybackSpeedMenu — right-click steps backward', () => {
  beforeEach(() => vi.clearAllMocks());

  it('steps to the previous speed and prevents the native context menu', () => {
    const { onChange, button } = setup(25);
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(button, evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('clamps at the slowest speed instead of wrapping', () => {
    const { onChange, button } = setup(1);
    fireEvent.contextMenu(button);
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe('PlaybackSpeedMenu — className', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies the compact default layout classes when none is supplied', () => {
    const { button } = setup(10);
    expect(button.className).toContain('font-mono');
  });

  it('replaces the default layout with a caller-supplied className', () => {
    const { button } = setup(10, 'my-custom-speed');
    expect(button.className).toContain('my-custom-speed');
    expect(button.className).not.toContain('font-mono');
  });
});
