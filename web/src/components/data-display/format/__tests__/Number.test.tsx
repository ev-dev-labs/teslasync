import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { FormattedNumber } from '../Number';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// `FormattedNumber` is a pure, non-interactive display leaf: it reads no hooks
// and touches no network, so there is nothing to mock and no `userEvent` flow
// to drive. The suite instead exercises every branch (finite / null / undefined
// / NaN / ±Infinity / zero / negative), the optional unit suffix, precision and
// locale plumbing through `fmtNumber`, the hover-title contract, and the
// className pass-through on both the value and empty states.
//
// `fmtNumber` reads module-scoped global precision + locale (set by
// `useSettings` in production). We pin both in `beforeEach` so separator- and
// precision-sensitive assertions are deterministic regardless of test order.

const span = (c: HTMLElement) => c.querySelector('span');

beforeEach(() => {
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('FormattedNumber', () => {
  it('renders a locale-aware number with thousands separators at the given precision', () => {
    const { container } = render(<FormattedNumber value={1234.5} precision={1} />);
    expect(container.textContent).toBe('1,234.5');
    expect(span(container)?.tagName).toBe('SPAN');
  });

  it('appends the optional unit after exactly one space', () => {
    const { container } = render(<FormattedNumber value={42} precision={0} unit="kWh" />);
    expect(container.textContent).toBe('42 kWh');
  });

  it('omits the unit (and its space) when unit is an empty string', () => {
    const { container } = render(<FormattedNumber value={42} precision={0} unit="" />);
    expect(container.textContent).toBe('42');
    expect(span(container)?.getAttribute('title')).toBe('42');
  });

  it('renders an em dash for null', () => {
    const { container } = render(<FormattedNumber value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for undefined', () => {
    const { container } = render(<FormattedNumber value={undefined} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<FormattedNumber value={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for non-finite Infinity and -Infinity', () => {
    const pos = render(<FormattedNumber value={Infinity} />);
    expect(pos.container.textContent).toBe('—');
    const neg = render(<FormattedNumber value={-Infinity} />);
    expect(neg.container.textContent).toBe('—');
  });

  it('treats zero as a valid value, not an empty state', () => {
    const { container } = render(<FormattedNumber value={0} precision={0} />);
    expect(container.textContent).toBe('0');
    expect(container.textContent).not.toBe('—');
  });

  it('renders negative numbers with their sign preserved', () => {
    const { container } = render(<FormattedNumber value={-1234.5} precision={1} />);
    expect(container.textContent).toBe('-1,234.5');
  });

  it('respects an explicit precision prop', () => {
    const { container } = render(<FormattedNumber value={3.14159} precision={3} />);
    expect(container.textContent).toBe('3.142');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    const { container } = render(<FormattedNumber value={2} />);
    expect(container.textContent).toBe('2.000');
  });

  it('applies the className to the rendered value span', () => {
    const { container } = render(<FormattedNumber value={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<FormattedNumber value={null} className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('exposes the full-precision raw value via the hover title even when the display is rounded', () => {
    const { container } = render(<FormattedNumber value={1234.567} precision={1} />);
    // Visible text is rounded to 1dp; the title keeps every digit.
    expect(container.textContent).toBe('1,234.6');
    expect(span(container)?.getAttribute('title')).toBe('1234.567');
  });

  it('includes the unit in the hover title so the exact figure is never ambiguous', () => {
    const { container } = render(<FormattedNumber value={1234.567} precision={1} unit="kWh" />);
    expect(container.textContent).toBe('1,234.6 kWh');
    expect(span(container)?.getAttribute('title')).toBe('1234.567 kWh');
  });

  it('omits the title attribute entirely on the empty state', () => {
    const { container } = render(<FormattedNumber value={null} />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('honours a switched global locale for the separators', () => {
    setGlobalLocale('de-DE');
    const { container } = render(<FormattedNumber value={1234.5} precision={1} />);
    // de-DE: '.' groups thousands, ',' is the decimal separator. Normalise any
    // narrow/non-breaking thousands space some ICU builds may emit.
    expect((container.textContent ?? '').replace(/[\u00A0\u202F]/g, '.')).toBe('1.234,5');
  });
});
