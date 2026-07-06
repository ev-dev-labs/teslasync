import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Duration } from '../Duration';

/**
 * `Duration` is a pure display leaf: it delegates formatting to the
 * `formatDuration*` helpers in `@/lib/dateFormat` and adds a raw-millisecond
 * hover title. It reads no hooks and touches no network, so these tests need
 * no mocking — they exercise the genuine helper pipeline while pinning the
 * component's own responsibilities: variant routing, the em-dash empty state,
 * the `title` contract, and `className` propagation.
 */

const FALLBACK = '—';
const span = (c: HTMLElement) => c.querySelector('span');

describe('Duration — short variant (default)', () => {
  it('renders sub-second values in milliseconds by default', () => {
    const { container } = render(<Duration ms={250} />);
    expect(container.textContent).toBe('250ms');
  });

  it('rolls values >= 1000ms over to one-decimal seconds', () => {
    const { container } = render(<Duration ms={1500} />);
    expect(container.textContent).toBe('1.5s');
  });

  it('treats an explicit variant="short" identically to the default', () => {
    const explicit = render(<Duration ms={1500} variant="short" />);
    const implicit = render(<Duration ms={1500} />);
    expect(explicit.container.textContent).toBe(implicit.container.textContent);
    expect(explicit.container.textContent).toBe('1.5s');
  });

  it('treats zero as a valid duration, not an empty value', () => {
    const { container } = render(<Duration ms={0} />);
    expect(container.textContent).toBe('0ms');
    expect(container.textContent).not.toBe(FALLBACK);
  });
});

describe('Duration — long variant', () => {
  it('formats minutes and seconds for multi-minute durations', () => {
    const { container } = render(<Duration ms={65_000} variant="long" />);
    expect(container.textContent).toBe('1m 5s');
  });

  it('rounds the seconds remainder to a whole number', () => {
    // 125.5s → 2m + 5.5s, rounded half-away-from-zero to "6s".
    const { container } = render(<Duration ms={125_500} variant="long" />);
    expect(container.textContent).toBe('2m 6s');
  });

  it('formats sub-minute durations as one-decimal seconds', () => {
    const { container } = render(<Duration ms={45_000} variant="long" />);
    expect(container.textContent).toBe('45.0s');
  });

  it('formats sub-second durations in milliseconds', () => {
    const { container } = render(<Duration ms={500} variant="long" />);
    expect(container.textContent).toBe('500ms');
  });

  it('rolls minutes past 60 without collapsing into hours', () => {
    const { container } = render(<Duration ms={3_600_000} variant="long" />);
    expect(container.textContent).toBe('60m 0s');
  });
});

describe('Duration — compact variant', () => {
  it('keeps sub-second values in milliseconds', () => {
    const { container } = render(<Duration ms={250} variant="compact" />);
    expect(container.textContent).toBe('250ms');
  });

  it('shows one-decimal seconds below a minute', () => {
    const { container } = render(<Duration ms={30_000} variant="compact" />);
    expect(container.textContent).toBe('30.0s');
  });

  it('rolls into one-decimal minutes at/above a minute', () => {
    const { container } = render(<Duration ms={120_000} variant="compact" />);
    expect(container.textContent).toBe('2.0m');
  });
});

describe('Duration — clock variant', () => {
  it('zero-pads the seconds field to two digits', () => {
    const { container } = render(<Duration ms={187_000} variant="clock" />);
    expect(container.textContent).toBe('3:07');
  });

  it('renders a sub-minute clock as 0:SS', () => {
    const { container } = render(<Duration ms={5_000} variant="clock" />);
    expect(container.textContent).toBe('0:05');
  });

  it('renders 0:00 for a zero-length clock and keeps the hover title', () => {
    const { container } = render(<Duration ms={0} variant="clock" />);
    expect(container.textContent).toBe('0:00');
    expect(span(container)?.getAttribute('title')).toBe('0 ms');
  });
});

describe('Duration — empty / invalid input', () => {
  it('renders the em dash for null', () => {
    const { container } = render(<Duration ms={null} />);
    expect(container.textContent).toBe(FALLBACK);
  });

  it('renders the em dash for undefined', () => {
    const { container } = render(<Duration ms={undefined} />);
    expect(container.textContent).toBe(FALLBACK);
  });

  it('renders the em dash for NaN', () => {
    const { container } = render(<Duration ms={NaN} />);
    expect(container.textContent).toBe(FALLBACK);
  });

  it('renders the em dash for Infinity', () => {
    const { container } = render(<Duration ms={Infinity} />);
    expect(container.textContent).toBe(FALLBACK);
  });

  it('renders the em dash for -Infinity', () => {
    const { container } = render(<Duration ms={-Infinity} />);
    expect(container.textContent).toBe(FALLBACK);
  });

  it('never throws on unrenderable input', () => {
    expect(() => render(<Duration ms={NaN} variant="clock" />)).not.toThrow();
    expect(() => render(<Duration ms={null} variant="long" />)).not.toThrow();
  });
});

describe('Duration — hover title contract', () => {
  it('exposes the raw millisecond value via the title on a valid value', () => {
    const { container } = render(<Duration ms={1500} />);
    expect(span(container)?.getAttribute('title')).toBe('1500 ms');
  });

  it('omits the title attribute on the null empty state', () => {
    const { container } = render(<Duration ms={null} />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('omits the title when a variant collapses an out-of-range value to the em dash', () => {
    // Regression guard: `long` rejects non-positive durations, so ms=0 renders
    // the em dash. It must render like the empty state — WITHOUT a misleading
    // "0 ms" hover title.
    const { container } = render(<Duration ms={0} variant="long" />);
    expect(container.textContent).toBe(FALLBACK);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('omits the title for a negative clock duration collapsed to the em dash', () => {
    const { container } = render(<Duration ms={-5_000} variant="clock" />);
    expect(container.textContent).toBe(FALLBACK);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('Duration — className + structure', () => {
  it('applies the className to the rendered value span', () => {
    const { container } = render(<Duration ms={1500} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<Duration ms={null} className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe(FALLBACK);
  });

  it('renders exactly one span element carrying the value', () => {
    const { container } = render(<Duration ms={187_000} variant="clock" />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(container.querySelectorAll('span')).toHaveLength(1);
  });

  it('recomputes the display when props change on rerender', () => {
    const { container, rerender } = render(<Duration ms={1500} />);
    expect(container.textContent).toBe('1.5s');
    rerender(<Duration ms={65_000} variant="long" />);
    expect(container.textContent).toBe('1m 5s');
  });
});
