import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TourStep } from '@/hooks/useTour';

/**
 * TourOverlay contract.
 *
 * The overlay is a system spotlight (not a <Modal>): a dark clip-path
 * backdrop, a highlighted target ring, and a tooltip with nav controls +
 * a progress indicator. It renders nothing until it has a `targetRect`.
 *
 * - react-i18next is stubbed to echo the English default (and interpolate
 *   `{{current}}` / `{{total}}`) so assertions match the fallback copy.
 * - useMotionPreference is stubbed through a `vi.fn` toggle so we can drive
 *   the reduced-motion branch deterministically (framer-motion caches
 *   matchMedia at module load, so mocking our wrapper is the canonical
 *   pattern — see components/motion/__tests__/RouteTransition.test.tsx).
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof defaultOrOpts === 'string') {
        let out = defaultOrOpts;
        const interp = opts ?? {};
        for (const [k, v] of Object.entries(interp)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
        return out;
      }
      return _key;
    },
    i18n: { language: 'en-US' },
  }),
}));

const reduceMotion = vi.fn<() => boolean>(() => false);
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => {
    const reduce = reduceMotion();
    return { reduce, durationMs: reduce ? 0 : 250 };
  },
}));

import { TourOverlay, getTooltipPosition } from './TourOverlay';

type Props = {
  step: TourStep;
  targetRect: DOMRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
};

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  const base = {
    x: 100,
    y: 100,
    top: 100,
    left: 100,
    right: 300,
    bottom: 160,
    width: 200,
    height: 60,
  };
  const merged = { ...base, ...overrides };
  return { ...merged, toJSON: () => merged } as DOMRect;
}

const baseStep: TourStep = {
  target: '#nav',
  title: 'Welcome aboard',
  description: 'This is your dashboard.',
  placement: 'bottom',
};

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    step: baseStep,
    targetRect: makeRect(),
    currentStep: 1,
    totalSteps: 4,
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
  const utils = render(<TourOverlay {...props} />);
  return { ...utils, props };
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true });
}

beforeEach(() => {
  reduceMotion.mockReturnValue(false);
  setViewport(1024, 768);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TourOverlay', () => {
  it('renders nothing until it has a target rect', () => {
    const { container } = renderOverlay({ targetRect: null });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the tooltip dialog with a localized, interpolated aria-label and content', () => {
    renderOverlay({ currentStep: 1, totalSteps: 4 });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.getAttribute('aria-label')).toBe('Tour step 2 of 4');
    expect(screen.getByRole('heading', { name: 'Welcome aboard' })).toBeInTheDocument();
    expect(screen.getByText('This is your dashboard.')).toBeInTheDocument();
    expect(screen.getByTestId('tour-counter')).toHaveTextContent('2 / 4');
  });

  it('dismisses via the close button, which exposes an accessible name', () => {
    const onSkip = vi.fn();
    renderOverlay({ onSkip });
    const close = screen.getByRole('button', { name: 'Close tour' });
    expect(close).toHaveAttribute('type', 'button');
    fireEvent.click(close);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('dismisses when the backdrop or the "Skip tour" control is clicked', () => {
    const onSkip = vi.fn();
    renderOverlay({ onSkip });
    fireEvent.click(screen.getByTestId('tour-backdrop'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('hides the Back button on the first step and shows a "Next" primary action', () => {
    const onNext = vi.fn();
    renderOverlay({ currentStep: 0, totalSteps: 4, onNext });
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    const next = screen.getByRole('button', { name: /next/i });
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Get Started!')).toBeNull();
  });

  it('shows Back on intermediate steps and wires it to onPrev', () => {
    const onPrev = vi.fn();
    renderOverlay({ currentStep: 2, totalSteps: 4, onPrev });
    const back = screen.getByRole('button', { name: /back/i });
    fireEvent.click(back);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('swaps the primary action to a finish label on the last step', () => {
    const onNext = vi.fn();
    renderOverlay({ currentStep: 3, totalSteps: 4, onNext });
    expect(screen.queryByText('Next')).toBeNull();
    const finish = screen.getByRole('button', { name: /get started/i });
    fireEvent.click(finish);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('renders a decorative progress row where done, current and upcoming dots differ', () => {
    renderOverlay({ currentStep: 1, totalSteps: 4 });
    const row = screen.getByTestId('tour-progress');
    // The row is redundant with the counter/aria-label, so it is hidden
    // from assistive tech.
    expect(row.getAttribute('aria-hidden')).toBe('true');

    const dots = row.querySelectorAll('[data-state]');
    expect(dots).toHaveLength(4);
    expect(dots[0].getAttribute('data-state')).toBe('done');
    expect(dots[1].getAttribute('data-state')).toBe('current');
    expect(dots[2].getAttribute('data-state')).toBe('upcoming');

    // The active dot is visually widened.
    expect(dots[1].className).toContain('w-4');
    // Regression guard: completed dots must NOT look identical to upcoming
    // ones (the original code rendered both branches the same).
    expect(dots[0].className).not.toBe(dots[2].className);
    expect(dots[0].className).toContain('bg-[var(--theme-primary)]/40');
    expect(dots[2].className).toContain('bg-[var(--surface-2)]');
  });

  it('dismisses on Escape and removes the key listener when unmounted', () => {
    const onSkip = vi.fn();
    const { unmount } = renderOverlay({ onSkip });

    // An unrelated key does nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onSkip).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('applies entrance/transition classes only when motion is allowed', () => {
    reduceMotion.mockReturnValue(false);
    const { unmount } = renderOverlay();
    expect(screen.getByRole('dialog').className).toContain('animate-in');
    expect(
      screen.getByTestId('tour-progress').querySelector('[data-state]')!.className,
    ).toContain('transition-all');
    unmount();

    reduceMotion.mockReturnValue(true);
    renderOverlay();
    expect(screen.getByRole('dialog').className).not.toContain('animate-in');
    expect(
      screen.getByTestId('tour-progress').querySelector('[data-state]')!.className,
    ).not.toContain('transition-all');
  });
});

describe('getTooltipPosition', () => {
  beforeEach(() => setViewport(1024, 768));

  it('places a "bottom" tooltip below the target with a clamped left + maxWidth', () => {
    const style = getTooltipPosition('bottom', makeRect());
    expect(style).toEqual({ top: 176, left: 100, maxWidth: 360 });
    expect(style.bottom).toBeUndefined();
    expect(style.right).toBeUndefined();
  });

  it('anchors a "top" tooltip via bottom offset (never top)', () => {
    const style = getTooltipPosition('top', makeRect());
    expect(style).toEqual({ bottom: 684, left: 100, maxWidth: 360 });
    expect(style.top).toBeUndefined();
  });

  it('places a "right" tooltip to the right edge of the target', () => {
    const style = getTooltipPosition('right', makeRect());
    expect(style).toEqual({ top: 100, left: 316, maxWidth: 360 });
  });

  it('anchors a "left" tooltip via right offset (never left)', () => {
    const style = getTooltipPosition('left', makeRect());
    expect(style).toEqual({ top: 100, right: 940, maxWidth: 360 });
    expect(style.left).toBeUndefined();
  });

  it('falls back to bottom-style placement for an unknown placement', () => {
    expect(getTooltipPosition('weird', makeRect())).toEqual(
      getTooltipPosition('bottom', makeRect()),
    );
  });

  it('clamps a tooltip pushed off the left/top edges back to the padding', () => {
    const offLeft = getTooltipPosition('bottom', makeRect({ left: -500 }));
    expect(offLeft.left).toBe(16);
    const offTop = getTooltipPosition('bottom', makeRect({ bottom: -100 }));
    expect(offTop.top).toBe(16);
  });

  it('shrinks maxWidth to fit a narrow viewport', () => {
    setViewport(320, 640);
    const style = getTooltipPosition('bottom', makeRect());
    expect(style.maxWidth).toBe(288);
    expect(style.left).toBe(16);
  });
});
