import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Distance } from '../Distance';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// The real `useUnits` reads `useSettings()` to derive the display unit; mock
// the settings hook (repo convention — see Format.test.tsx) so we exercise the
// genuine convertDistanceFromSI + fmtNumber pipeline while controlling the
// metric/imperial preference. No network is involved in this pure leaf.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

type UnitSystem = 'metric' | 'imperial';

/**
 * Point the mocked settings hook at a metric (km/°C/bar) or imperial (mi)
 * preference. `useUnits` only cares about `unit_of_length` for <Distance>, but
 * a full-ish settings bag keeps the mock faithful to production shape.
 */
function setUnits(system: UnitSystem = 'metric') {
  const unitOfLength = system === 'imperial' ? 'mi' : 'km';
  vi.mocked(useSettings).mockReturnValue({
    settings: {
      unit_of_length: unitOfLength,
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      locale: 'en-US',
    },
    isMiles: unitOfLength === 'mi',
    isFahrenheit: false,
    isPSI: false,
    decimals: 2,
    locale: 'en-US',
    density: 'comfortable',
    rangeType: 'rated',
  } as never);
}

const span = (c: HTMLElement) => c.querySelector('span');

beforeEach(() => {
  vi.mocked(useSettings).mockReset();
  // Pin global number-format state so precision/locale-sensitive assertions
  // are deterministic regardless of test-execution order.
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  // Default preference so `useUnits()` never destructures an undefined bag.
  setUnits('metric');
});

describe('Distance', () => {
  it('renders a km input in metric with the unit label and precision', () => {
    setUnits('metric');
    const { container } = render(<Distance km={100} precision={1} />);
    expect(container.textContent).toBe('100.0 km');
  });

  it('exposes the raw caller value with its source unit via the title', () => {
    setUnits('metric');
    const { container } = render(<Distance km={100} precision={1} />);
    expect(span(container)?.getAttribute('title')).toBe('100.00 km');
  });

  it('renders a miles input in imperial with a 2-decimal hover title', () => {
    setUnits('imperial');
    const { container } = render(<Distance miles={62.1371} precision={1} />);
    expect(container.textContent).toBe('62.1 mi');
    expect(span(container)?.getAttribute('title')).toBe('62.14 mi');
  });

  it('converts a km input to miles when the user prefers imperial', () => {
    setUnits('imperial');
    const { container } = render(<Distance km={100} precision={1} />);
    // 100 km ≈ 62.1 mi, but the title still reflects the km source value.
    expect(container.textContent).toBe('62.1 mi');
    expect(span(container)?.getAttribute('title')).toBe('100.00 km');
  });

  it('converts a miles input to km when the user prefers metric', () => {
    setUnits('metric');
    const { container } = render(<Distance miles={10} precision={2} />);
    // 10 mi = 16.09344 km → 16.09 at 2dp.
    expect(container.textContent).toBe('16.09 km');
    expect(span(container)?.getAttribute('title')).toBe('10.00 mi');
  });

  it('prefers miles over km when both inputs are supplied', () => {
    setUnits('imperial');
    const { container } = render(<Distance miles={50} km={9999} precision={0} />);
    expect(container.textContent).toBe('50 mi');
    // Title proves the miles branch (not km) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('50.00 mi');
  });

  it('falls back to the km branch when miles is null but km is finite', () => {
    setUnits('metric');
    const { container } = render(<Distance miles={null} km={5} precision={1} />);
    expect(container.textContent).toBe('5.0 km');
    expect(span(container)?.getAttribute('title')).toBe('5.00 km');
  });

  it('renders an em dash for null miles', () => {
    const { container } = render(<Distance miles={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when no distance props are supplied', () => {
    const { container } = render(<Distance />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<Distance miles={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for non-finite Infinity', () => {
    const { container } = render(<Distance km={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('treats zero as a valid distance, not an empty value', () => {
    setUnits('imperial');
    const { container } = render(<Distance miles={0} precision={0} />);
    expect(container.textContent).toBe('0 mi');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.00 mi');
  });

  it('renders negative distances (deltas) with their sign preserved', () => {
    setUnits('imperial');
    const { container } = render(<Distance miles={-5} precision={1} />);
    expect(container.textContent).toBe('-5.0 mi');
    expect(span(container)?.getAttribute('title')).toBe('-5.00 mi');
  });

  it('respects an explicit precision prop', () => {
    setUnits('metric');
    const { container } = render(<Distance km={1.23456} precision={3} />);
    expect(container.textContent).toBe('1.235 km');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    setUnits('metric');
    const { container } = render(<Distance km={2} />);
    expect(container.textContent).toBe('2.000 km');
  });

  it('applies the className to the rendered value span', () => {
    setUnits('metric');
    const { container } = render(<Distance km={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<Distance className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Distance />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders a <span> element carrying the hover title for context', () => {
    setUnits('metric');
    const { container } = render(<Distance km={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.00 km');
  });

  it('recomputes the display when the user switches unit systems', () => {
    setUnits('metric');
    const { container, rerender } = render(<Distance km={100} precision={1} />);
    expect(container.textContent).toBe('100.0 km');

    setUnits('imperial');
    rerender(<Distance km={100} precision={1} />);
    expect(container.textContent).toBe('62.1 mi');
  });
});
