import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Power } from '../Power';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// <Power> is a pure formatting leaf: it depends only on `fmtNumber` and touches
// no hooks, settings, or network, so no mocking is required. We do pin the
// global number-format state (precision + locale) so precision-fallback and
// thousands-separator assertions stay deterministic regardless of the order
// vitest happens to run files in.
const span = (c: HTMLElement) => c.querySelector('span');

beforeEach(() => {
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('Power — source selection', () => {
  it('renders a finite kW input directly', () => {
    const { container } = render(<Power kw={11} precision={1} />);
    expect(container.textContent).toBe('11.0 kW');
  });

  it('converts a W input to kW before display (w / 1000)', () => {
    const { container } = render(<Power w={2500} precision={1} />);
    expect(container.textContent).toBe('2.5 kW');
    // Title always exposes the canonical kW value, not the raw watts.
    expect(span(container)?.getAttribute('title')).toBe('2.500 kW');
  });

  it('prefers the kW input over W when both are supplied', () => {
    const { container } = render(<Power kw={5} w={999999} precision={0} />);
    expect(container.textContent).toBe('5 kW');
    // Title proves the kW branch (not the watts) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('5.000 kW');
  });

  it('falls back to the W branch when kw is null but w is finite', () => {
    const { container } = render(<Power kw={null} w={3000} precision={0} />);
    expect(container.textContent).toBe('3 kW');
    expect(span(container)?.getAttribute('title')).toBe('3.000 kW');
  });

  it('falls back to the W branch when kw is NaN but w is finite', () => {
    const { container } = render(<Power kw={NaN} w={1500} precision={1} />);
    expect(container.textContent).toBe('1.5 kW');
    expect(span(container)?.getAttribute('title')).toBe('1.500 kW');
  });

  it('falls back to the W branch when kw is Infinity but w is finite', () => {
    const { container } = render(<Power kw={Infinity} w={4000} precision={0} />);
    expect(container.textContent).toBe('4 kW');
  });
});

describe('Power — empty state', () => {
  it('renders an em dash when no power props are supplied', () => {
    const { container } = render(<Power />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when both inputs are null', () => {
    const { container } = render(<Power kw={null} w={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN with no W fallback', () => {
    const { container } = render(<Power kw={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for non-finite Infinity with no W fallback', () => {
    const { container } = render(<Power kw={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when only W is supplied but is NaN', () => {
    const { container } = render(<Power w={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('applies the className to the empty-state span', () => {
    const { container } = render(<Power className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Power />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });
});

describe('Power — auto unit selection', () => {
  it('auto-picks W for sub-kW magnitudes (|kW| < 1)', () => {
    const { container } = render(<Power kw={0.5} precision={0} />);
    expect(container.textContent).toBe('500 W');
    expect(span(container)?.getAttribute('title')).toBe('0.500 kW');
  });

  it('auto-picks kW at and above the 1 kW threshold', () => {
    const { container } = render(<Power kw={1} precision={0} />);
    // Exactly 1 kW is NOT sub-kW, so it stays in kW.
    expect(container.textContent).toBe('1 kW');
    expect(span(container)?.getAttribute('title')).toBe('1.000 kW');
  });

  it('uses the magnitude (not the sign) to choose the auto unit', () => {
    const { container } = render(<Power kw={-0.5} precision={0} />);
    // |−0.5| < 1 → Watts, and the negative sign is preserved.
    expect(container.textContent).toBe('-500 W');
    expect(span(container)?.getAttribute('title')).toBe('-0.500 kW');
  });

  it('keeps large negative deltas in kW with the sign intact', () => {
    const { container } = render(<Power kw={-11} precision={1} />);
    expect(container.textContent).toBe('-11.0 kW');
    expect(span(container)?.getAttribute('title')).toBe('-11.000 kW');
  });

  it('treats zero as a valid power reading, not an empty value', () => {
    const { container } = render(<Power kw={0} precision={0} />);
    expect(container.textContent).toBe('0 W');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.000 kW');
  });
});

describe('Power — forced unit override', () => {
  it('forces Watts even for a value that would auto-pick kW', () => {
    const { container } = render(<Power kw={12} unit="W" precision={0} />);
    expect(container.textContent).toBe('12,000 W');
    expect(span(container)?.getAttribute('title')).toBe('12.000 kW');
  });

  it('forces kW even for a sub-kW value that would auto-pick W', () => {
    const { container } = render(<Power kw={0.25} unit="kW" precision={2} />);
    expect(container.textContent).toBe('0.25 kW');
    expect(span(container)?.getAttribute('title')).toBe('0.250 kW');
  });
});

describe('Power — formatting concerns', () => {
  it('respects an explicit precision prop', () => {
    const { container } = render(<Power kw={11.23456} precision={3} />);
    expect(container.textContent).toBe('11.235 kW');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<Power kw={2} />);
    expect(container.textContent).toBe('2.000 kW');
  });

  it('applies locale-aware thousands separators to the display value', () => {
    const { container } = render(<Power kw={12345} unit="kW" precision={0} />);
    expect(container.textContent).toBe('12,345 kW');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<Power kw={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('renders a <span> element carrying the canonical kW title', () => {
    const { container } = render(<Power kw={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.000 kW');
  });

  it('recomputes the unit and value when props change on re-render', () => {
    const { container, rerender } = render(<Power kw={0.5} precision={0} />);
    expect(container.textContent).toBe('500 W');

    rerender(<Power kw={5} precision={0} />);
    expect(container.textContent).toBe('5 kW');
  });
});
