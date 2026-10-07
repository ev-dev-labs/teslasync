import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Energy } from '../Energy';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Energy> is a pure formatting leaf: it depends only on `fmtNumber` and
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

describe('Energy — source selection', () => {
  it('renders a finite kWh input directly', () => {
    const { container } = render(<Energy kwh={42.5} precision={2} />);
    expect(container.textContent).toBe('42.50 kWh');
  });

  it('converts a Wh input to kWh before display (wh / 1000)', () => {
    const { container } = render(<Energy wh={2500} precision={1} />);
    expect(container.textContent).toBe('2.5 kWh');
    // Title always exposes the canonical kWh value, not the raw watt-hours.
    expect(span(container)?.getAttribute('title')).toBe('2.500 kWh');
  });

  it('prefers the kWh input over Wh when both are supplied', () => {
    const { container } = render(<Energy kwh={5} wh={999999} precision={0} />);
    expect(container.textContent).toBe('5 kWh');
    // Title proves the kWh branch (not the watt-hours) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('5.000 kWh');
  });

  it('falls back to the Wh branch when kwh is null but wh is finite', () => {
    const { container } = render(<Energy kwh={null} wh={3000} precision={0} />);
    expect(container.textContent).toBe('3 kWh');
    expect(span(container)?.getAttribute('title')).toBe('3.000 kWh');
  });

  it('falls back to the Wh branch when kwh is NaN but wh is finite', () => {
    const { container } = render(<Energy kwh={NaN} wh={1500} precision={1} />);
    expect(container.textContent).toBe('1.5 kWh');
    expect(span(container)?.getAttribute('title')).toBe('1.500 kWh');
  });

  it('falls back to the Wh branch when kwh is Infinity but wh is finite', () => {
    const { container } = render(<Energy kwh={Infinity} wh={4000} precision={0} />);
    expect(container.textContent).toBe('4 kWh');
    expect(span(container)?.getAttribute('title')).toBe('4.000 kWh');
  });
});

describe('Energy — empty / invalid state', () => {
  it('renders an em dash when no energy props are supplied', () => {
    const { container } = render(<Energy />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when both inputs are null', () => {
    const { container } = render(<Energy kwh={null} wh={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN with no Wh fallback', () => {
    const { container } = render(<Energy kwh={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for +Infinity with no Wh fallback', () => {
    const { container } = render(<Energy kwh={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for -Infinity with no Wh fallback', () => {
    const { container } = render(<Energy kwh={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when only Wh is supplied but is NaN', () => {
    const { container } = render(<Energy wh={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Energy className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Energy />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('Energy — auto unit selection', () => {
  it('auto-picks Wh for sub-kWh magnitudes (|kWh| < 1)', () => {
    const { container } = render(<Energy kwh={0.25} precision={0} />);
    expect(container.textContent).toBe('250 Wh');
    expect(span(container)?.getAttribute('title')).toBe('0.250 kWh');
  });

  it('auto-picks kWh at and above the 1 kWh threshold', () => {
    const { container } = render(<Energy kwh={1} precision={0} />);
    // Exactly 1 kWh is NOT sub-kWh, so it stays in kWh.
    expect(container.textContent).toBe('1 kWh');
    expect(span(container)?.getAttribute('title')).toBe('1.000 kWh');
  });

  it('uses the magnitude (not the sign) to choose the auto unit', () => {
    const { container } = render(<Energy kwh={-0.5} precision={0} />);
    // |−0.5| < 1 → watt-hours, and the negative sign is preserved.
    expect(container.textContent).toBe('-500 Wh');
    expect(span(container)?.getAttribute('title')).toBe('-0.500 kWh');
  });

  it('keeps large negative deltas in kWh with the sign intact', () => {
    const { container } = render(<Energy kwh={-11} precision={1} />);
    expect(container.textContent).toBe('-11.0 kWh');
    expect(span(container)?.getAttribute('title')).toBe('-11.000 kWh');
  });

  it('treats zero as a valid energy reading, not an empty value', () => {
    const { container } = render(<Energy kwh={0} precision={0} />);
    expect(container.textContent).toBe('0 Wh');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.000 kWh');
  });

  it('auto-picks Wh for a sub-kWh Wh input', () => {
    const { container } = render(<Energy wh={500} precision={0} />);
    // 500 Wh = 0.5 kWh → below the 1 kWh threshold, so display stays in Wh.
    expect(container.textContent).toBe('500 Wh');
    expect(span(container)?.getAttribute('title')).toBe('0.500 kWh');
  });
});

describe('Energy — forced unit override', () => {
  it('forces watt-hours even for a value that would auto-pick kWh', () => {
    const { container } = render(<Energy kwh={12} unit="Wh" precision={0} />);
    expect(container.textContent).toBe('12,000 Wh');
    expect(span(container)?.getAttribute('title')).toBe('12.000 kWh');
  });

  it('forces kWh even for a sub-kWh value that would auto-pick Wh', () => {
    const { container } = render(<Energy kwh={0.25} unit="kWh" precision={2} />);
    expect(container.textContent).toBe('0.25 kWh');
    expect(span(container)?.getAttribute('title')).toBe('0.250 kWh');
  });
});

describe('Energy — formatting & precision', () => {
  it('respects an explicit precision prop', () => {
    const { container } = render(<Energy kwh={11.23456} precision={3} />);
    expect(container.textContent).toBe('11.235 kWh');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<Energy kwh={2} />);
    expect(container.textContent).toBe('2.000 kWh');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    const { container } = render(<Energy kwh={12345} unit="kWh" precision={0} />);
    expect(container.textContent).toBe('12,345 kWh');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Energy kwh={1234.5} unit="kWh" precision={1} />);
    // de-DE groups with "." and uses "," for the decimal → "1.234,5 kWh".
    expect(normalize(container.textContent)).toBe('1.234,5 kWh');
  });
});

describe('Energy — title (canonical hover value)', () => {
  it('exposes the raw kWh at a fixed 3-decimal precision', () => {
    const { container } = render(<Energy kwh={42.5} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('42.500 kWh');
  });

  it('keeps the title at 3 decimals independent of the display precision', () => {
    const { container } = render(<Energy kwh={42} precision={0} />);
    // Display collapses to "42 kWh" but the hover title stays canonical.
    expect(container.textContent).toBe('42 kWh');
    expect(span(container)?.getAttribute('title')).toBe('42.000 kWh');
  });

  it('keeps the canonical title free of locale grouping separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Energy kwh={12345} unit="kWh" precision={0} />);
    // toFixed(3) is locale-agnostic, so the title never picks up de-DE grouping.
    expect(span(container)?.getAttribute('title')).toBe('12345.000 kWh');
  });

  it('reports the canonical kWh even when the display renders in Wh', () => {
    const { container } = render(<Energy wh={250} precision={0} />);
    // 250 Wh displays as "250 Wh" but the title is the canonical 0.250 kWh.
    expect(container.textContent).toBe('250 Wh');
    expect(span(container)?.getAttribute('title')).toBe('0.250 kWh');
  });
});

describe('Energy — DOM & re-render', () => {
  it('renders a single <span> element carrying the canonical kWh title', () => {
    const { container } = render(<Energy kwh={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.000 kWh');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Energy kwh={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the unit and value when props change on re-render', () => {
    const { container, rerender } = render(<Energy kwh={0.5} precision={0} />);
    expect(container.textContent).toBe('500 Wh');

    rerender(<Energy kwh={5} precision={0} />);
    expect(container.textContent).toBe('5 kWh');
  });

  it('transitions from a valid value to the empty state when kwh becomes null', () => {
    const { container, rerender } = render(<Energy kwh={12} precision={0} />);
    expect(container.textContent).toBe('12 kWh');

    rerender(<Energy kwh={null} precision={0} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});
