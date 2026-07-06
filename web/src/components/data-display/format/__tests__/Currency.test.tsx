import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Currency } from '../Currency';
import { useFormatting } from '@/hooks/useFormatting';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Currency> reads only `currencySymbol` off `useFormatting`, so we stub the
// hook directly (a file-level vi.mock takes precedence over the global
// useSettings stub in test-setup.ts) and drive the symbol per test. This keeps
// the leaf isolated from the settings/units machinery while still exercising the
// real `fmtNumber` locale formatting underneath.
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: vi.fn(),
}));

const span = (c: HTMLElement) => c.querySelector('span');

// Some ICU/Node builds emit a NARROW NO-BREAK SPACE (U+202F) or NO-BREAK SPACE
// (U+00A0) as the grouping separator for certain locales. Normalise those to a
// plain space so locale assertions don't flake across environments.
const normalize = (s: string | null | undefined) => (s ?? '').replace(/[\u00A0\u202F]/g, ' ');

const mockFormatting = (currencySymbol = '$') => {
  vi.mocked(useFormatting).mockReturnValue({
    costPerKwh: 0.12,
    currencySymbol,
    formatEnergyCost: (kwh: number) => `${currencySymbol}${kwh}`,
    formatCurrency: (amount: number) => `${currencySymbol}${amount}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  });
};

beforeEach(() => {
  vi.mocked(useFormatting).mockReset();
  mockFormatting('$');
  // Pin global number-format state so precision/locale assertions are
  // deterministic regardless of the order vitest runs files in.
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('Currency — symbol source', () => {
  it('renders the currencySymbol from useFormatting with the value', () => {
    mockFormatting('$');
    const { container } = render(<Currency value={12.34} />);
    expect(container.textContent).toBe('$12.34');
    expect(vi.mocked(useFormatting)).toHaveBeenCalled();
  });

  it('reflects a non-"$" symbol supplied by settings', () => {
    mockFormatting('€');
    const { container } = render(<Currency value={1234.5} precision={2} />);
    expect(container.textContent).toBe('€1,234.50');
  });

  it('lets symbolOverride win over the hook symbol', () => {
    mockFormatting('$');
    const { container } = render(<Currency value={42} symbolOverride="€" />);
    expect(container.textContent).toBe('€42.00');
  });

  it('treats an explicit empty-string override as "no symbol" (not the hook symbol)', () => {
    mockFormatting('$');
    // '' is not nullish, so `symbolOverride ?? currencySymbol` keeps the ''.
    const { container } = render(<Currency value={7.5} symbolOverride="" />);
    expect(container.textContent).toBe('7.50');
    expect(container.textContent).not.toContain('$');
  });
});

describe('Currency — value formatting', () => {
  it('defaults to 2 decimal places', () => {
    const { container } = render(<Currency value={5} />);
    expect(container.textContent).toBe('$5.00');
  });

  it('respects an explicit precision prop', () => {
    const { container } = render(<Currency value={3.14159} precision={3} />);
    expect(container.textContent).toBe('$3.142');
  });

  it('treats 0 as a valid amount, not the empty state', () => {
    const { container } = render(<Currency value={0} />);
    expect(container.textContent).toBe('$0.00');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('$0.00');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    const { container } = render(<Currency value={1234567.89} precision={2} />);
    expect(container.textContent).toBe('$1,234,567.89');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Currency value={1234.5} precision={2} />);
    // de-DE groups with "." and uses "," for the decimal → "$1.234,50".
    expect(normalize(container.textContent)).toBe('$1.234,50');
    // The canonical hover title stays locale-agnostic (dot decimal, no grouping).
    expect(span(container)?.getAttribute('title')).toBe('$1234.50');
  });
});

describe('Currency — negative amounts (established contract)', () => {
  it('keeps the symbol before the sign ("$-3.00"), matching the cost-table contract', () => {
    // MonthlyCostTable pins this exact shape; do not flip to "-$3.00".
    const { container } = render(<Currency value={-3} precision={2} />);
    expect(container.textContent).toBe('$-3.00');
    expect(span(container)?.getAttribute('title')).toBe('$-3.00');
  });

  it('groups large negative amounts while preserving the sign placement', () => {
    const { container } = render(<Currency value={-1234.5} precision={2} />);
    expect(container.textContent).toBe('$-1,234.50');
  });
});

describe('Currency — empty / invalid state', () => {
  it('renders the fallback em dash for null', () => {
    const { container } = render(<Currency value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders the fallback when the value prop is omitted (undefined)', () => {
    const { container } = render(<Currency />);
    expect(container.textContent).toBe('—');
  });

  it('renders the fallback for NaN', () => {
    const { container } = render(<Currency value={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders the fallback for +Infinity and -Infinity', () => {
    const pos = render(<Currency value={Infinity} />);
    expect(pos.container.textContent).toBe('—');
    const neg = render(<Currency value={-Infinity} />);
    expect(neg.container.textContent).toBe('—');
  });

  it('honours a custom fallback string', () => {
    const { container } = render(<Currency value={null} fallback="n/a" />);
    expect(container.textContent).toBe('n/a');
  });

  it('omits the title and applies the className on the empty-state span', () => {
    const { container } = render(<Currency value={null} className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(span(container)?.hasAttribute('title')).toBe(false);
    expect(container.textContent).toBe('—');
  });
});

describe('Currency — precision safety (hardening)', () => {
  it('does not throw and clamps a negative precision to 0 decimals', () => {
    expect(() => render(<Currency value={12.34} precision={-1} />)).not.toThrow();
    const { container } = render(<Currency value={12.34} precision={-1} />);
    expect(container.textContent).toBe('$12');
    expect(span(container)?.getAttribute('title')).toBe('$12');
  });

  it('falls back to 2 decimals for a non-finite precision instead of crashing', () => {
    expect(() => render(<Currency value={5} precision={NaN} />)).not.toThrow();
    const { container } = render(<Currency value={5} precision={NaN} />);
    expect(container.textContent).toBe('$5.00');
  });

  it('floors a fractional precision', () => {
    const { container } = render(<Currency value={9.999} precision={2.9} />);
    expect(container.textContent).toBe('$10.00');
    expect(span(container)?.getAttribute('title')).toBe('$10.00');
  });
});

describe('Currency — canonical title & DOM', () => {
  it('exposes the canonical value via title without locale grouping', () => {
    const { container } = render(<Currency value={1234.5} precision={2} />);
    // Display carries locale grouping; the hover title is the raw fixed value.
    expect(container.textContent).toBe('$1,234.50');
    expect(span(container)?.getAttribute('title')).toBe('$1234.50');
  });

  it('renders a single <span> carrying the value and title', () => {
    const { container } = render(<Currency value={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.textContent).toBe('$42');
    expect(el?.getAttribute('title')).toBe('$42');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Currency value={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the display and title when the value changes on re-render', () => {
    const { container, rerender } = render(<Currency value={10} precision={2} />);
    expect(container.textContent).toBe('$10.00');
    expect(span(container)?.getAttribute('title')).toBe('$10.00');

    rerender(<Currency value={20.5} precision={2} />);
    expect(container.textContent).toBe('$20.50');
    expect(span(container)?.getAttribute('title')).toBe('$20.50');
  });

  it('transitions from a valid amount to the empty state when value becomes null', () => {
    const { container, rerender } = render(<Currency value={12} precision={0} />);
    expect(container.textContent).toBe('$12');

    rerender(<Currency value={null} precision={0} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});
