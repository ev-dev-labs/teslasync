import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Percentage } from '../Percentage';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Percentage> is a pure formatting leaf: it depends only on `fmtNumber` and
// touches no hooks, settings, or network, so no mocking (and no userEvent) is
// required — it renders no interactive controls. We pin the global
// number-format state (precision + locale) in beforeEach so precision-fallback
// and thousands-separator assertions stay deterministic regardless of the order
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

describe('Percentage — value branch (already a percent)', () => {
  it('renders a finite percentage with the "%" suffix at the given precision', () => {
    const { container } = render(<Percentage value={85} precision={0} />);
    expect(container.textContent).toBe('85%');
  });

  it('rounds the display to the requested precision', () => {
    const { container } = render(<Percentage value={85.126} precision={2} />);
    expect(container.textContent).toBe('85.13%');
  });

  it('treats zero as a valid reading, not an empty value', () => {
    const { container } = render(<Percentage value={0} precision={0} />);
    expect(container.textContent).toBe('0%');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.000%');
  });

  it('preserves the sign of a negative percentage (e.g. a delta)', () => {
    const { container } = render(<Percentage value={-5} precision={0} />);
    expect(container.textContent).toBe('-5%');
    expect(span(container)?.getAttribute('title')).toBe('-5.000%');
  });

  it('applies locale-aware thousands separators to large percentages', () => {
    const { container } = render(<Percentage value={12345} precision={0} />);
    expect(container.textContent).toBe('12,345%');
  });
});

describe('Percentage — ratio branch (0–1 scaled to percent)', () => {
  it('multiplies a 0–1 ratio by 100 before display', () => {
    const { container } = render(<Percentage ratio={0.5} precision={0} />);
    expect(container.textContent).toBe('50%');
    expect(span(container)?.getAttribute('title')).toBe('50.000%');
  });

  it('treats a zero ratio as a valid 0%, not an empty value', () => {
    const { container } = render(<Percentage ratio={0} precision={0} />);
    expect(container.textContent).toBe('0%');
    expect(container.textContent).not.toBe('—');
  });

  it('renders a full ratio of 1 as 100%', () => {
    const { container } = render(<Percentage ratio={1} precision={0} />);
    expect(container.textContent).toBe('100%');
  });

  it('allows ratios above 1 (e.g. >100% efficiency) without clamping', () => {
    const { container } = render(<Percentage ratio={1.25} precision={0} />);
    expect(container.textContent).toBe('125%');
  });
});

describe('Percentage — source precedence', () => {
  it('prefers the value branch over ratio when both are finite', () => {
    const { container } = render(<Percentage value={80} ratio={0.5} precision={0} />);
    expect(container.textContent).toBe('80%');
    // Title proves the value branch (80), not the ratio (→50), produced it.
    expect(span(container)?.getAttribute('title')).toBe('80.000%');
  });

  it('falls back to the ratio branch when value is null', () => {
    const { container } = render(<Percentage value={null} ratio={0.5} precision={0} />);
    expect(container.textContent).toBe('50%');
  });

  it('falls back to the ratio branch when value is NaN', () => {
    const { container } = render(<Percentage value={NaN} ratio={0.25} precision={0} />);
    expect(container.textContent).toBe('25%');
  });

  it('falls back to the ratio branch when value is Infinity', () => {
    const { container } = render(<Percentage value={Infinity} ratio={0.1} precision={0} />);
    expect(container.textContent).toBe('10%');
  });
});

describe('Percentage — empty / invalid state', () => {
  it('renders an em dash for null with no ratio', () => {
    const { container } = render(<Percentage value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when no props are supplied (undefined)', () => {
    const { container } = render(<Percentage />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for a NaN value with no ratio fallback', () => {
    const { container } = render(<Percentage value={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for +Infinity with no ratio fallback', () => {
    const { container } = render(<Percentage value={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for -Infinity with no ratio fallback', () => {
    const { container } = render(<Percentage value={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for a NaN ratio', () => {
    const { container } = render(<Percentage ratio={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for an Infinity ratio', () => {
    const { container } = render(<Percentage ratio={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when both value and ratio are null', () => {
    const { container } = render(<Percentage value={null} ratio={null} />);
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Percentage />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Percentage className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });
});

describe('Percentage — precision & locale', () => {
  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<Percentage value={2} />);
    expect(container.textContent).toBe('2.000%');
  });

  it('honours the global locale for grouping and decimal separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Percentage value={1234.5} precision={1} />);
    // de-DE groups with "." and uses "," for the decimal → "1.234,5%".
    expect(normalize(container.textContent)).toBe('1.234,5%');
  });
});

describe('Percentage — title (canonical hover value)', () => {
  it('exposes the raw value at a fixed 3-decimal precision', () => {
    const { container } = render(<Percentage value={85.5} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('85.500%');
  });

  it('keeps the title at 3 decimals independent of the display precision', () => {
    const { container } = render(<Percentage value={85} precision={0} />);
    // Display collapses to "85%" but the hover title stays canonical.
    expect(container.textContent).toBe('85%');
    expect(span(container)?.getAttribute('title')).toBe('85.000%');
  });

  it('derives the canonical title from the scaled ratio, not the raw ratio', () => {
    const { container } = render(<Percentage ratio={0.5} precision={0} />);
    expect(span(container)?.getAttribute('title')).toBe('50.000%');
  });

  it('keeps the canonical title free of locale grouping separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<Percentage value={12345} precision={0} />);
    // toFixed(3) is locale-agnostic, so the title never picks up de-DE grouping.
    expect(span(container)?.getAttribute('title')).toBe('12345.000%');
  });
});

describe('Percentage — DOM & re-render', () => {
  it('renders a single <span> element carrying the hover title', () => {
    const { container } = render(<Percentage value={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.000%');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Percentage value={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('recomputes the display and title when the value changes on re-render', () => {
    const { container, rerender } = render(<Percentage value={10} precision={0} />);
    expect(container.textContent).toBe('10%');
    expect(span(container)?.getAttribute('title')).toBe('10.000%');

    rerender(<Percentage value={20} precision={0} />);
    expect(container.textContent).toBe('20%');
    expect(span(container)?.getAttribute('title')).toBe('20.000%');
  });

  it('transitions from a valid value to the empty state when value becomes null', () => {
    const { container, rerender } = render(<Percentage value={12} precision={0} />);
    expect(container.textContent).toBe('12%');

    rerender(<Percentage value={null} precision={0} />);
    expect(container.textContent).toBe('—');
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('transitions from the empty state to a value once a ratio arrives', () => {
    const { container, rerender } = render(<Percentage value={null} precision={0} />);
    expect(container.textContent).toBe('—');

    rerender(<Percentage ratio={0.5} precision={0} />);
    expect(container.textContent).toBe('50%');
    expect(span(container)?.getAttribute('title')).toBe('50.000%');
  });
});
