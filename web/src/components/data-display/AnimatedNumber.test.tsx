/**
 * AnimatedNumber — behaviour, easing, edge-case, null-safety and a11y coverage.
 *
 * The component eases a numeric counter from its previous displayed value to a
 * new target over `duration` seconds using an ease-out-quad curve driven by
 * `requestAnimationFrame` + `performance.now`. To assert exact intermediate and
 * final values deterministically (instead of racing jsdom's real animation
 * scheduler) we install a controllable clock: `performance.now` returns a
 * variable we advance by hand, and `requestAnimationFrame` callbacks are
 * captured and flushed on demand.
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnimatedNumber } from './AnimatedNumber';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// ── Deterministic rAF + clock harness ────────────────────────────────────────

let now = 0;
let nextRafId = 0;
const frames = new Map<number, FrameRequestCallback>();
let rafSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;

/** Flush every currently-pending animation-frame callback once, at the current clock. */
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    pending.forEach((cb) => cb(now));
  });
}

/** Advance the fake clock by `ms` and flush the frames that were pending. */
function advance(ms: number) {
  now += ms;
  flushFrames();
}

/** Jump far past any duration and drain frames until the animation stops rescheduling. */
function runToCompletion() {
  now += 100_000;
  let guard = 0;
  while (frames.size > 0 && guard++ < 100) {
    flushFrames();
  }
}

/** Force `prefers-reduced-motion: reduce` (jsdom has no matchMedia by default). */
function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduce') ? reduce : false,
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

beforeEach(() => {
  now = 0;
  nextRafId = 0;
  frames.clear();

  vi.spyOn(performance, 'now').mockImplementation(() => now);

  rafSpy = vi.fn((cb: FrameRequestCallback) => {
    const id = ++nextRafId;
    frames.set(id, cb);
    return id;
  });
  cancelSpy = vi.fn((id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cancelSpy);

  // jsdom lacks matchMedia; default to "motion allowed" so the tween runs.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  // Pin formatter globals for deterministic string assertions.
  setGlobalPrecision(0);
  setGlobalLocale('en-US');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Basic rendering + props ──────────────────────────────────────────────────

describe('AnimatedNumber — rendering', () => {
  it('starts at 0 and eases up to the target value', () => {
    const { container } = render(<AnimatedNumber value={100} />);
    // Before any frame runs the counter shows its initial state.
    expect(container.textContent).toBe('0');

    runToCompletion();
    expect(container.textContent).toBe('100');
  });

  it('wraps the formatted value in the given prefix and suffix', () => {
    const { container } = render(<AnimatedNumber value={50} prefix="$" suffix=" kWh" />);
    expect(container.textContent).toBe('$0 kWh');

    runToCompletion();
    expect(container.textContent).toBe('$50 kWh');
  });

  it('honours the requested number of decimal places', () => {
    const { container } = render(<AnimatedNumber value={3.14159} decimals={2} />);
    runToCompletion();
    expect(container.textContent).toBe('3.14');
  });

  it('applies locale-aware thousands separators', () => {
    const { container } = render(<AnimatedNumber value={1234567} />);
    runToCompletion();
    expect(container.textContent).toBe('1,234,567');
  });

  it('merges a custom className with the tabular-nums base class', () => {
    const { container } = render(
      <AnimatedNumber value={5} className="text-emerald-300 font-bold" />,
    );
    const span = container.firstChild as HTMLElement;
    expect(span).toHaveClass('tabular-nums');
    expect(span).toHaveClass('text-emerald-300');
    expect(span).toHaveClass('font-bold');
  });
});

// ── Easing behaviour ─────────────────────────────────────────────────────────

describe('AnimatedNumber — easing', () => {
  it('follows the ease-out-quad curve at the animation midpoint', () => {
    // duration 1s → 1000ms. At 500ms progress=0.5, eased=1-(0.5)^2=0.75 → 75.
    const { container } = render(<AnimatedNumber value={100} duration={1} />);
    expect(container.textContent).toBe('0');

    advance(500);
    expect(container.textContent).toBe('75');

    advance(500);
    expect(container.textContent).toBe('100');
  });

  it('scales the timeline with a custom duration', () => {
    // duration 2s → 2000ms. 1000ms is the midpoint here (not the end).
    const { container } = render(<AnimatedNumber value={100} duration={2} />);

    advance(1000);
    expect(container.textContent).toBe('75'); // still mid-flight

    advance(1000);
    expect(container.textContent).toBe('100'); // now complete
  });
});

// ── Edge cases + bug fixes ───────────────────────────────────────────────────

describe('AnimatedNumber — edge cases', () => {
  it('jumps straight to the value when duration is zero (no frame scheduled)', () => {
    // Regression: duration 0 used to compute elapsed / 0 → NaN → a rendered "0".
    const { container } = render(<AnimatedNumber value={42} duration={0} />);
    expect(container.textContent).toBe('42');
    expect(container.textContent).not.toBe('0');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('treats a negative duration as an instant jump', () => {
    const { container } = render(<AnimatedNumber value={7} duration={-5} />);
    expect(container.textContent).toBe('7');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('treats a non-finite (NaN) duration as an instant jump instead of freezing on 0', () => {
    // Regression: a NaN duration poisoned durationMs → progress = elapsed / NaN
    // → NaN, which never satisfied `progress >= 1`, so the counter scheduled a
    // frame, rendered NaN → "0", and never advanced to the target.
    const { container } = render(<AnimatedNumber value={42} duration={NaN} />);
    expect(container.textContent).toBe('42');
    expect(container.textContent).not.toBe('0');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('treats an infinite duration as an instant jump', () => {
    const { container } = render(<AnimatedNumber value={9} duration={Infinity} />);
    expect(container.textContent).toBe('9');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('renders 0 instead of NaN for a non-finite value', () => {
    const { container: nan } = render(<AnimatedNumber value={NaN} />);
    runToCompletion();
    expect(nan.textContent).toBe('0');
    expect(nan.textContent).not.toContain('NaN');

    const { container: inf } = render(<AnimatedNumber value={Infinity} />);
    runToCompletion();
    expect(inf.textContent).toBe('0');
  });

  it('animates from the previous value on update instead of snapping back to zero', () => {
    // The core bug fix: a live-polling counter must not flash to 0 on refetch.
    const { container, rerender } = render(<AnimatedNumber value={100} duration={1} />);
    runToCompletion();
    expect(container.textContent).toBe('100');

    rerender(<AnimatedNumber value={200} duration={1} />);
    advance(500);
    // from=100, to=200, eased 0.75 → 100 + 100*0.75 = 175.
    expect(container.textContent).toBe('175');
    // Had it reset to 0 it would read 0 + 200*0.75 = 150 here.
    expect(container.textContent).not.toBe('150');

    advance(500);
    expect(container.textContent).toBe('200');
  });

  it('does not restart the animation when re-rendered with an unchanged value', () => {
    const { rerender } = render(<AnimatedNumber value={100} duration={1} />);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    rerender(<AnimatedNumber value={100} duration={1} />);
    // Same target + duration → the effect deps are stable → no new frame.
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Accessibility + lifecycle ────────────────────────────────────────────────

describe('AnimatedNumber — a11y + lifecycle', () => {
  it('respects prefers-reduced-motion by rendering the final value immediately', () => {
    setReducedMotion(true);
    const { container } = render(<AnimatedNumber value={250} duration={1} />);
    expect(container.textContent).toBe('250');
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('still animates when reduced motion is not requested', () => {
    setReducedMotion(false);
    const { container } = render(<AnimatedNumber value={80} duration={1} />);
    expect(container.textContent).toBe('0');
    expect(rafSpy).toHaveBeenCalledTimes(1);

    runToCompletion();
    expect(container.textContent).toBe('80');
  });

  it('cancels the pending animation frame on unmount', () => {
    const { unmount } = render(<AnimatedNumber value={100} duration={1} />);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    unmount();
    // The id returned by the first requestAnimationFrame call must be cancelled.
    expect(cancelSpy).toHaveBeenCalledWith(1);
  });
});
