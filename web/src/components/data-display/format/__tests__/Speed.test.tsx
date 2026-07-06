import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Speed } from '../Speed';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// The real `useUnits` reads `useSettings()` to derive the display unit; mock the
// settings hook (repo convention — see Distance.test.tsx / Format.test.tsx) so we
// exercise the genuine convertSpeedFromSI + fmtNumber pipeline while controlling
// the metric/imperial preference. No network is involved in this pure leaf.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

type UnitSystem = 'metric' | 'imperial';

/**
 * Point the mocked settings hook at a metric (km/h) or imperial (mph)
 * preference. `useUnits` only cares about `unit_of_length` for <Speed> (km ->
 * km/h, mi -> mph), but a full-ish settings bag keeps the mock faithful to
 * production shape.
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
  // Pin global number-format state so precision/locale-sensitive assertions are
  // deterministic regardless of test-execution order.
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  // Default preference so `useUnits()` never destructures an undefined bag.
  setUnits('metric');
});

describe('Speed', () => {
  it('renders an mph input in imperial with the unit label and precision', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={60} precision={0} />);
    expect(container.textContent).toBe('60 mph');
  });

  it('exposes the raw caller value with its source unit via the title', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={60} precision={0} />);
    // Title always renders the raw mph value to one decimal, independent of the
    // display precision.
    expect(span(container)?.getAttribute('title')).toBe('60.0 mph');
  });

  it('renders a km/h input in metric with a 1-decimal hover title', () => {
    setUnits('metric');
    const { container } = render(<Speed kmh={100} precision={0} />);
    expect(container.textContent).toBe('100 km/h');
    expect(span(container)?.getAttribute('title')).toBe('100.0 km/h');
  });

  it('converts an mph input to km/h when the user prefers metric', () => {
    setUnits('metric');
    const { container } = render(<Speed mph={60} precision={1} />);
    // 60 mph = 26.8224 m/s = 96.56064 km/h -> 96.6 at 1dp. Title keeps mph source.
    expect(container.textContent).toBe('96.6 km/h');
    expect(span(container)?.getAttribute('title')).toBe('60.0 mph');
  });

  it('converts a km/h input to mph when the user prefers imperial', () => {
    setUnits('imperial');
    const { container } = render(<Speed kmh={100} precision={1} />);
    // 100 km/h = 27.7778 m/s = 62.1371 mph -> 62.1 at 1dp. Title keeps km/h source.
    expect(container.textContent).toBe('62.1 mph');
    expect(span(container)?.getAttribute('title')).toBe('100.0 km/h');
  });

  it('prefers mph over km/h when both inputs are supplied', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={50} kmh={9999} precision={0} />);
    expect(container.textContent).toBe('50 mph');
    // Title proves the mph branch (not km/h) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('50.0 mph');
  });

  it('falls back to the km/h branch when mph is null but km/h is finite', () => {
    setUnits('metric');
    const { container } = render(<Speed mph={null} kmh={80} precision={0} />);
    expect(container.textContent).toBe('80 km/h');
    expect(span(container)?.getAttribute('title')).toBe('80.0 km/h');
  });

  it('falls through a non-finite mph to the km/h branch', () => {
    setUnits('metric');
    const { container } = render(<Speed mph={NaN} kmh={50} precision={0} />);
    // NaN mph does not satisfy Number.isFinite, so the km/h branch wins.
    expect(container.textContent).toBe('50 km/h');
    expect(span(container)?.getAttribute('title')).toBe('50.0 km/h');
  });

  it('renders an em dash for null mph', () => {
    const { container } = render(<Speed mph={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when no speed props are supplied', () => {
    const { container } = render(<Speed />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<Speed mph={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for non-finite Infinity', () => {
    const { container } = render(<Speed kmh={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('treats zero as a valid speed, not an empty value', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={0} precision={0} />);
    expect(container.textContent).toBe('0 mph');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.0 mph');
  });

  it('renders negative speeds (deltas) with their sign preserved', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={-5} precision={1} />);
    expect(container.textContent).toBe('-5.0 mph');
    expect(span(container)?.getAttribute('title')).toBe('-5.0 mph');
  });

  it('respects an explicit precision prop', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={1.23456} precision={3} />);
    // Round-trips through SI back to mph; 3dp exposes the extra digits.
    expect(container.textContent).toBe('1.235 mph');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    setUnits('imperial');
    const { container } = render(<Speed mph={2} />);
    expect(container.textContent).toBe('2.000 mph');
  });

  it('applies the className to the rendered value span', () => {
    setUnits('metric');
    const { container } = render(<Speed kmh={50} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<Speed className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Speed />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders a <span> element carrying the hover title for context', () => {
    setUnits('imperial');
    const { container } = render(<Speed mph={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.0 mph');
  });

  it('recomputes the display when the user switches unit systems', () => {
    setUnits('imperial');
    const { container, rerender } = render(<Speed mph={60} precision={1} />);
    expect(container.textContent).toBe('60.0 mph');

    setUnits('metric');
    rerender(<Speed mph={60} precision={1} />);
    // Same mph source, now rendered in the user's newly-preferred km/h.
    expect(container.textContent).toBe('96.6 km/h');
  });
});
