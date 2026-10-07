import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Current } from '../Current';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Current> is a pure formatting leaf: it depends only on `fmtNumber` and
// touches no hooks, settings, or network, so no mocking is required. We pin the
// global number-format state (precision + locale) so precision-fallback and
// thousands-separator assertions stay deterministic regardless of the order
// vitest happens to run files in.
const span = (c: HTMLElement) => c.querySelector('span');

// Some ICU/Node builds emit a NARROW NO-BREAK SPACE (U+202F) or NO-BREAK SPACE
// (U+00A0) as the grouping separator for certain locales. Normalise those to a
// plain space so locale assertions don't flake across environments.
const normalize = (s: string | null | undefined) => (s ?? '').replace(/[\u00A0\u202F]/g, ' ');

beforeEach(() => {
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('Current — rendered value', () => {
  it('renders a finite amperage with the "A" unit and the given precision', () => {
    const { container } = render(<Current amps={32.5} precision={1} />);
    expect(container.textContent).toBe('32.5 A');
  });

  it('always labels the value in Amperes (A), never a converted unit', () => {
    const { container } = render(<Current amps={16} precision={0} />);
    expect(container.textContent).toBe('16 A');
    expect(container.textContent).toContain('A');
  });

  it('treats zero as a valid reading, not an empty value', () => {
    const { container } = render(<Current amps={0} precision={0} />);
    expect(container.textContent).toBe('0 A');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.000 A');
  });

  it('preserves the sign of negative currents (e.g. regen / discharge deltas)', () => {
    const { container } = render(<Current amps={-48} precision={0} />);
    expect(container.textContent).toBe('-48 A');
    expect(span(container)?.getAttribute('title')).toBe('-48.000 A');
  });

  it('renders large finite DC-bus currents without truncation', () => {
    const { container } = render(<Current amps={1_000_000} precision={0} />);
    expect(container.textContent).toBe('1,000,000 A');
  });
});

describe('Current — empty / invalid state', () => {
  it('renders an em dash for null', () => {
    const { container } = render(<Current amps={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when the amps prop is omitted (undefined)', () => {
    const { container } = render(<Current />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<Current amps={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for +Infinity', () => {
    const { container } = render(<Current amps={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for -Infinity', () => {
    const { container } = render(<Current amps={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Current />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Current className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });
});

describe('Current — formatting & precision', () => {
  it('respects an explicit precision prop', () => {
    const { container } = render(<Current amps={3.14159} precision={3} />);
    expect(container.textContent).toBe('3.142 A');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<Current amps={2} />);
    expect(container.textContent).toBe('2.000 A');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    const { container } = render(<Current amps={12345} precision={0} />);
    expect(container.textContent).toBe('12,345 A');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Current amps={1234.5} precision={1} />);
    // de-DE groups with "." and uses "," for the decimal → "1.234,5 A".
    expect(normalize(container.textContent)).toBe('1.234,5 A');
  });
});

describe('Current — title (canonical hover value)', () => {
  it('exposes the raw amperage at a fixed 3-decimal precision', () => {
    const { container } = render(<Current amps={32.5} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('32.500 A');
  });

  it('keeps the title at 3 decimals independent of the display precision', () => {
    const { container } = render(<Current amps={40} precision={0} />);
    // Display collapses to "40 A" but the hover title stays canonical.
    expect(container.textContent).toBe('40 A');
    expect(span(container)?.getAttribute('title')).toBe('40.000 A');
  });

  it('keeps the canonical title free of locale grouping separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Current amps={12345} precision={0} />);
    // toFixed(3) is locale-agnostic, so the title never picks up de-DE grouping.
    expect(span(container)?.getAttribute('title')).toBe('12345.000 A');
  });
});

describe('Current — DOM & re-render', () => {
  it('renders a single <span> element carrying the hover title', () => {
    const { container } = render(<Current amps={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.000 A');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Current amps={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the display and title when props change on re-render', () => {
    const { container, rerender } = render(<Current amps={16} precision={1} />);
    expect(container.textContent).toBe('16.0 A');
    expect(span(container)?.getAttribute('title')).toBe('16.000 A');

    rerender(<Current amps={32} precision={1} />);
    expect(container.textContent).toBe('32.0 A');
    expect(span(container)?.getAttribute('title')).toBe('32.000 A');
  });

  it('transitions from a valid value to the empty state when amps becomes null', () => {
    const { container, rerender } = render(<Current amps={48} precision={0} />);
    expect(container.textContent).toBe('48 A');

    rerender(<Current amps={null} precision={0} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});
