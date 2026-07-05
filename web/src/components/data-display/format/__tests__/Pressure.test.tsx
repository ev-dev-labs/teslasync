import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pressure } from '../Pressure';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Pressure> resolves the display unit through the real `useUnits` →
// `useSettings` chain, then runs the genuine convertPressureFromSI + fmtNumber
// pipeline. Mock only the settings hook (repo convention — see Distance.test.tsx
// / Format.test.tsx) so we can flip the bar/psi preference while exercising the
// real conversion math. No network is involved in this pure leaf.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

type PressureUnit = 'bar' | 'psi';

/**
 * Point the mocked settings hook at a metric (bar) or imperial (psi)
 * preference. `derivePressure` in useUnits only reads `unit_of_pressure`, but a
 * full-ish settings bag keeps the mock faithful to the production shape so the
 * hook never destructures an undefined field.
 */
function setUnits(pressure: PressureUnit = 'bar') {
  vi.mocked(useSettings).mockReturnValue({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: pressure,
      decimal_precision: 2,
      locale: 'en-US',
    },
    isMiles: false,
    isFahrenheit: false,
    isPSI: pressure === 'psi',
    decimals: 2,
    locale: 'en-US',
    density: 'comfortable',
    rangeType: 'rated',
  } as never);
}

const span = (c: HTMLElement) => c.querySelector('span');

// Some ICU/Node builds emit a NARROW NO-BREAK SPACE (U+202F) or NO-BREAK SPACE
// (U+00A0) as the grouping separator for certain locales. Normalise those to a
// plain space so locale assertions don't flake across environments.
const normalize = (s: string | null | undefined) => (s ?? '').replace(/[\u00A0\u202F]/g, ' ');

beforeEach(() => {
  vi.mocked(useSettings).mockReset();
  // Pin global number-format state so precision/locale-sensitive assertions are
  // deterministic regardless of the order vitest happens to run files in.
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  // Default preference so `useUnits()` never destructures an undefined bag.
  setUnits('bar');
});

describe('Pressure — source selection', () => {
  it('renders a bar input directly in metric with unit + precision', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');
  });

  it('exposes the raw caller bar value with its source unit via the title', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('2.40 bar');
  });

  it('converts a psi input to bar for display but keeps the psi source title', () => {
    setUnits('bar');
    const { container } = render(<Pressure psi={35} precision={1} />);
    // 35 psi ≈ 241.32 kPa ≈ 2.41 bar → 2.4 at 1dp; title still reflects psi.
    expect(container.textContent).toBe('2.4 bar');
    expect(span(container)?.getAttribute('title')).toBe('35.00 psi');
  });

  it('prefers the bar input over psi when both are supplied', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} psi={99} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');
    // Title proves the bar branch (not psi) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('2.40 bar');
  });

  it('falls back to the psi branch when bar is null but psi is finite', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={null} psi={35} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');
    expect(span(container)?.getAttribute('title')).toBe('35.00 psi');
  });

  it('falls back to the psi branch when bar is NaN but psi is finite', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={NaN} psi={35} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');
    expect(span(container)?.getAttribute('title')).toBe('35.00 psi');
  });

  it('falls back to the psi branch when bar is Infinity but psi is finite', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={Infinity} psi={35} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');
    expect(span(container)?.getAttribute('title')).toBe('35.00 psi');
  });
});

describe('Pressure — imperial (psi) preference', () => {
  it('renders a psi input directly as psi', () => {
    setUnits('psi');
    const { container } = render(<Pressure psi={35} precision={0} />);
    // psi → kPa → psi round-trips through the shared constant, so 35 stays 35.
    expect(container.textContent).toBe('35 psi');
    expect(span(container)?.getAttribute('title')).toBe('35.00 psi');
  });

  it('converts a bar input to psi when the user prefers psi', () => {
    setUnits('psi');
    const { container } = render(<Pressure bar={2.4} precision={0} />);
    // 2.4 bar = 240 kPa ≈ 34.8 psi → 35 at 0dp; title still reflects bar.
    expect(container.textContent).toBe('35 psi');
    expect(span(container)?.getAttribute('title')).toBe('2.40 bar');
  });

  it('keeps a finer-precision bar→psi conversion visible', () => {
    setUnits('psi');
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    // 240 kPa / 6.894757 = 34.805… → 34.8 at 1dp.
    expect(container.textContent).toBe('34.8 psi');
  });
});

describe('Pressure — empty / invalid state', () => {
  it('renders an em dash for null bar with no psi', () => {
    const { container } = render(<Pressure bar={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when no pressure props are supplied', () => {
    const { container } = render(<Pressure />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when both inputs are null', () => {
    const { container } = render(<Pressure bar={null} psi={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN with no psi fallback', () => {
    const { container } = render(<Pressure bar={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for +Infinity with no psi fallback', () => {
    const { container } = render(<Pressure bar={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for -Infinity psi', () => {
    const { container } = render(<Pressure psi={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when only psi is supplied but is NaN', () => {
    const { container } = render(<Pressure psi={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Pressure className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Pressure />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('Pressure — zero & negative readings', () => {
  it('treats zero bar as a valid reading, not an empty value', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={0} precision={1} />);
    expect(container.textContent).toBe('0.0 bar');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.00 bar');
  });

  it('treats zero psi as a valid reading and converts it to 0 bar', () => {
    setUnits('bar');
    const { container } = render(<Pressure psi={0} precision={1} />);
    expect(container.textContent).toBe('0.0 bar');
    expect(span(container)?.getAttribute('title')).toBe('0.00 psi');
  });

  it('preserves the sign of a negative bar delta', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={-2} precision={1} />);
    expect(container.textContent).toBe('-2.0 bar');
    expect(span(container)?.getAttribute('title')).toBe('-2.00 bar');
  });
});

describe('Pressure — formatting & precision', () => {
  it('respects an explicit precision prop', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.41316} precision={3} />);
    expect(container.textContent).toBe('2.413 bar');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    setUnits('bar');
    const { container } = render(<Pressure bar={2} />);
    expect(container.textContent).toBe('2.000 bar');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    setUnits('psi');
    const { container } = render(<Pressure psi={12345} precision={0} />);
    expect(container.textContent).toBe('12,345 psi');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    setUnits('psi');
    const { container } = render(<Pressure psi={12345} precision={0} />);
    // de-DE groups with "." → "12.345 psi".
    expect(normalize(container.textContent)).toBe('12.345 psi');
  });
});

describe('Pressure — title (canonical hover value)', () => {
  it('exposes the raw bar value at a fixed 2-decimal precision', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('2.40 bar');
  });

  it('keeps the title at 2 decimals independent of the display precision', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} precision={0} />);
    // Display collapses to "2 bar" but the hover title stays canonical.
    expect(container.textContent).toBe('2 bar');
    expect(span(container)?.getAttribute('title')).toBe('2.40 bar');
  });

  it('keeps the canonical title free of locale grouping separators', () => {
    setGlobalLocale('de-DE');
    setUnits('psi');
    const { container } = render(<Pressure psi={12345} precision={0} />);
    // toFixed(2) is locale-agnostic, so the title never picks up de-DE grouping.
    expect(span(container)?.getAttribute('title')).toBe('12345.00 psi');
  });
});

describe('Pressure — DOM & re-render', () => {
  it('renders a single <span> element carrying the hover title', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('2.40 bar');
  });

  it('applies the className to the rendered value span', () => {
    setUnits('bar');
    const { container } = render(<Pressure bar={2.4} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the value when props change on re-render', () => {
    setUnits('bar');
    const { container, rerender } = render(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');

    rerender(<Pressure bar={3} precision={1} />);
    expect(container.textContent).toBe('3.0 bar');
  });

  it('recomputes the display when the user switches unit systems', () => {
    setUnits('bar');
    const { container, rerender } = render(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');

    setUnits('psi');
    rerender(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toBe('34.8 psi');
  });

  it('transitions from a valid value to the empty state when bar becomes null', () => {
    setUnits('bar');
    const { container, rerender } = render(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toBe('2.4 bar');

    rerender(<Pressure bar={null} precision={1} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});
