import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Voltage } from '../Voltage';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Voltage> is a pure formatting leaf: it depends only on `fmtNumber` and
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

describe('Voltage — rendered value', () => {
  it('renders a finite voltage with the "V" unit and the given precision', () => {
    const { container } = render(<Voltage volts={400.5} precision={1} />);
    expect(container.textContent).toBe('400.5 V');
  });

  it('treats zero as a valid reading, not an empty value', () => {
    const { container } = render(<Voltage volts={0} precision={0} />);
    expect(container.textContent).toBe('0 V');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.000 V');
  });

  it('preserves the sign of negative voltages (e.g. LV deltas)', () => {
    const { container } = render(<Voltage volts={-48} precision={0} />);
    expect(container.textContent).toBe('-48 V');
    expect(span(container)?.getAttribute('title')).toBe('-48.000 V');
  });

  it('renders large finite pack voltages without truncation', () => {
    const { container } = render(<Voltage volts={1_000_000} precision={0} />);
    expect(container.textContent).toBe('1,000,000 V');
  });
});

describe('Voltage — empty / invalid state', () => {
  it('renders an em dash for null', () => {
    const { container } = render(<Voltage volts={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when the volts prop is omitted (undefined)', () => {
    const { container } = render(<Voltage />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<Voltage volts={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for +Infinity', () => {
    const { container } = render(<Voltage volts={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for -Infinity', () => {
    const { container } = render(<Voltage volts={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Voltage />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Voltage className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });
});

describe('Voltage — formatting & precision', () => {
  it('respects an explicit precision prop', () => {
    const { container } = render(<Voltage volts={3.14159} precision={3} />);
    expect(container.textContent).toBe('3.142 V');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<Voltage volts={2} />);
    expect(container.textContent).toBe('2.000 V');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    const { container } = render(<Voltage volts={12345} precision={0} />);
    expect(container.textContent).toBe('12,345 V');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Voltage volts={1234.5} precision={1} />);
    // de-DE groups with "." and uses "," for the decimal → "1.234,5 V".
    expect(normalize(container.textContent)).toBe('1.234,5 V');
  });
});

describe('Voltage — title (canonical hover value)', () => {
  it('exposes the raw voltage at a fixed 3-decimal precision', () => {
    const { container } = render(<Voltage volts={400.5} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('400.500 V');
  });

  it('keeps the title at 3 decimals independent of the display precision', () => {
    const { container } = render(<Voltage volts={400} precision={0} />);
    // Display collapses to "400 V" but the hover title stays canonical.
    expect(container.textContent).toBe('400 V');
    expect(span(container)?.getAttribute('title')).toBe('400.000 V');
  });

  it('keeps the canonical title free of locale grouping separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Voltage volts={12345} precision={0} />);
    // toFixed(3) is locale-agnostic, so the title never picks up de-DE grouping.
    expect(span(container)?.getAttribute('title')).toBe('12345.000 V');
  });
});

describe('Voltage — DOM & re-render', () => {
  it('renders a single <span> element carrying the hover title', () => {
    const { container } = render(<Voltage volts={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.000 V');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Voltage volts={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the display and title when props change on re-render', () => {
    const { container, rerender } = render(<Voltage volts={100} precision={1} />);
    expect(container.textContent).toBe('100.0 V');
    expect(span(container)?.getAttribute('title')).toBe('100.000 V');

    rerender(<Voltage volts={240} precision={1} />);
    expect(container.textContent).toBe('240.0 V');
    expect(span(container)?.getAttribute('title')).toBe('240.000 V');
  });

  it('transitions from a valid value to the empty state when volts becomes null', () => {
    const { container, rerender } = render(<Voltage volts={12} precision={0} />);
    expect(container.textContent).toBe('12 V');

    rerender(<Voltage volts={null} precision={0} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});
