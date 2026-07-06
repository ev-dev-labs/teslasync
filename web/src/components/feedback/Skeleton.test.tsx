import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

/**
 * Unit tests for the low-level <Skeleton> loading primitive.
 *
 * The component has two rendering modes plus several presentational props, so
 * the suite covers each facet independently:
 *   - single-bar mode: default sizing, the `rounded` (pill) variant, custom
 *     width/height (numeric → px, string → verbatim), and className merging;
 *   - multi-line mode: child count, the "last line is 60% wide" tapering rule,
 *     width/height propagation to the rows;
 *   - null-safety / robustness edges surfaced while hardening: `lines={0}` and
 *     negative counts collapse to a single bar, a fractional count still tapers
 *     its final row, and a non-finite count (Infinity) must NOT throw;
 *   - accessibility: the decorative placeholder is hidden from assistive tech.
 *
 * Skeletons render as empty <div>s (no role/text/label), so assertions go
 * through the container DOM (classes, inline style, aria-hidden) rather than
 * role/name queries.
 */

/** The animated placeholder bars, regardless of single/multi mode. */
function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.animate-pulse'));
}

describe('Skeleton — single-bar mode', () => {
  it('renders one pulsing bar with the default 100% × 16px sizing and the square (non-pill) radius', () => {
    const { container } = render(<Skeleton />);
    const el = bars(container);

    expect(el).toHaveLength(1);
    expect(el[0]).toHaveClass('animate-pulse', 'bg-gray-200', 'dark:bg-gray-700', 'rounded');
    expect(el[0]).not.toHaveClass('rounded-full');
    expect(el[0]).toHaveStyle({ width: '100%', height: '16px' });
    // The single-bar root is the placeholder itself, not a stacking wrapper.
    expect(container.firstElementChild).not.toHaveClass('space-y-2');
  });

  it('renders the circular (pill) variant when `rounded` is set', () => {
    const { container } = render(<Skeleton rounded />);
    const el = bars(container)[0];

    expect(el).toHaveClass('rounded-full');
    // twMerge must drop the default square `rounded` so the pill radius wins.
    expect(el.classList.contains('rounded')).toBe(false);
  });

  it('applies a custom string width and numeric height (numbers become px)', () => {
    const { container } = render(<Skeleton width="120px" height={120} />);
    expect(bars(container)[0]).toHaveStyle({ width: '120px', height: '120px' });
  });

  it('passes a string height through verbatim (e.g. percentage heights)', () => {
    const { container } = render(<Skeleton height="100%" />);
    expect(bars(container)[0]).toHaveStyle({ height: '100%' });
  });

  it('merges a caller className onto the bar and lets a radius utility override the default', () => {
    const { container } = render(<Skeleton className="h-64 rounded-xl custom-token" />);
    const el = bars(container)[0];

    expect(el).toHaveClass('animate-pulse', 'h-64', 'rounded-xl', 'custom-token');
    // twMerge resolves the `rounded` vs `rounded-xl` conflict in favour of the caller.
    expect(el.classList.contains('rounded')).toBe(false);
  });
});

describe('Skeleton — multi-line mode', () => {
  it('renders one bar per line inside an aria-hidden stacking wrapper', () => {
    const { container } = render(<Skeleton lines={3} />);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper).toHaveClass('space-y-2');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(bars(container)).toHaveLength(3);
  });

  it('tapers only the final row to 60% width; earlier rows fill the default 100%', () => {
    const { container } = render(<Skeleton lines={3} />);
    const rows = bars(container);

    expect(rows[0]).toHaveStyle({ width: '100%' });
    expect(rows[1]).toHaveStyle({ width: '100%' });
    expect(rows[rows.length - 1]).toHaveStyle({ width: '60%' });
  });

  it('honours a custom width for the non-final rows while still tapering the last', () => {
    const { container } = render(<Skeleton lines={3} width="80%" />);
    const rows = bars(container);

    expect(rows[0]).toHaveStyle({ width: '80%' });
    expect(rows[1]).toHaveStyle({ width: '80%' });
    expect(rows[2]).toHaveStyle({ width: '60%' });
  });

  it('propagates the height to every row', () => {
    const { container } = render(<Skeleton lines={2} height={20} />);
    const rows = bars(container);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveStyle({ height: '20px' });
    expect(rows[1]).toHaveStyle({ height: '20px' });
  });

  it('merges a caller className onto the wrapper', () => {
    const { container } = render(<Skeleton lines={2} className="mt-2 md:grid-cols-2" />);
    expect(container.firstElementChild).toHaveClass('space-y-2', 'mt-2', 'md:grid-cols-2');
  });
});

describe('Skeleton — robustness of the `lines` count', () => {
  it('collapses to a single bar when lines is 1, 0, or negative (no empty wrapper)', () => {
    for (const lines of [1, 0, -4]) {
      const { container } = render(<Skeleton lines={lines} />);
      expect(bars(container)).toHaveLength(1);
      expect(container.firstElementChild).not.toHaveClass('space-y-2');
    }
  });

  it('floors a fractional count and still tapers the final row', () => {
    const { container } = render(<Skeleton lines={3.7} />);
    const rows = bars(container);

    expect(rows).toHaveLength(3);
    // The pre-hardening code left `i === lines - 1` unreachable for fractions,
    // so no row tapered. It must now taper the real last row.
    expect(rows[rows.length - 1]).toHaveStyle({ width: '60%' });
  });

  it('does not throw for a non-finite count and degrades to a single bar', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(<Skeleton lines={Number.POSITIVE_INFINITY} />).container;
    }).not.toThrow();
    expect(bars(container)).toHaveLength(1);
  });
});

describe('Skeleton — accessibility', () => {
  it('marks both the single-bar and multi-line roots aria-hidden so screen readers skip the decoration', () => {
    const { container: single } = render(<Skeleton />);
    expect(single.firstElementChild).toHaveAttribute('aria-hidden', 'true');

    const { container: multi } = render(<Skeleton lines={4} />);
    expect(multi.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
