import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Temperature } from '../Temperature';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

// The real `useUnits` reads `useSettings()` to derive the °C/°F display unit;
// mock the settings hook (repo convention — see Distance.test.tsx / Format.test.tsx)
// so we exercise the genuine convertTempFromSI + fmtNumber pipeline while
// controlling the metric/imperial preference. No network is involved in this
// pure leaf.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

type UnitSystem = 'metric' | 'imperial';

/**
 * Point the mocked settings hook at a metric (°C) or imperial (°F) preference.
 * `useUnits` only reads `unit_of_temp` for <Temperature>, but a full-ish
 * settings bag keeps the mock faithful to production shape.
 */
function setUnits(system: UnitSystem = 'metric') {
  const unitOfTemp = system === 'imperial' ? 'F' : 'C';
  vi.mocked(useSettings).mockReturnValue({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: unitOfTemp,
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      locale: 'en-US',
    },
    isMiles: false,
    isFahrenheit: unitOfTemp === 'F',
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

describe('Temperature', () => {
  it('renders a °C input in metric with the unit label and precision', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={20} precision={0} />);
    expect(container.textContent).toBe('20°C');
  });

  it('renders the value and unit with no separating space (temperature convention)', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={20} precision={0} />);
    // Contrast with <Distance> which uses "100 km"; temperature is "20°C".
    expect(container.textContent).not.toContain(' °C');
    expect(container.textContent).toBe('20°C');
  });

  it('exposes the raw caller value with its °C source unit via the title', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={20} precision={0} />);
    expect(span(container)?.getAttribute('title')).toBe('20.0 °C');
  });

  it('converts a °C input to °F when the user prefers imperial', () => {
    setUnits('imperial');
    const { container } = render(<Temperature c={20} precision={0} />);
    // 20 °C = 68 °F, but the title still reflects the °C source value.
    expect(container.textContent).toBe('68°F');
    expect(span(container)?.getAttribute('title')).toBe('20.0 °C');
  });

  it('renders a °F input in imperial with a °F hover title (round trip)', () => {
    setUnits('imperial');
    const { container } = render(<Temperature f={68} precision={0} />);
    // 68 °F → 20 °C (SI) → 68 °F for display; title keeps the °F source.
    expect(container.textContent).toBe('68°F');
    expect(span(container)?.getAttribute('title')).toBe('68.0 °F');
  });

  it('converts a °F input to °C when the user prefers metric', () => {
    setUnits('metric');
    const { container } = render(<Temperature f={68} precision={0} />);
    // 68 °F = 20 °C; title still reflects the °F source value.
    expect(container.textContent).toBe('20°C');
    expect(span(container)?.getAttribute('title')).toBe('68.0 °F');
  });

  it('prefers the °C branch over °F when both inputs are supplied', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={20} f={999} precision={0} />);
    expect(container.textContent).toBe('20°C');
    // Title proves the °C branch (not °F) produced the value.
    expect(span(container)?.getAttribute('title')).toBe('20.0 °C');
  });

  it('falls back to the °F branch when c is null but f is finite', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={null} f={68} precision={0} />);
    expect(container.textContent).toBe('20°C');
    expect(span(container)?.getAttribute('title')).toBe('68.0 °F');
  });

  it('falls back to the °F branch when c is NaN but f is finite', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={NaN} f={68} precision={0} />);
    expect(container.textContent).toBe('20°C');
    expect(span(container)?.getAttribute('title')).toBe('68.0 °F');
  });

  it('renders an em dash for null c', () => {
    const { container } = render(<Temperature c={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when no temperature props are supplied', () => {
    const { container } = render(<Temperature />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for NaN', () => {
    const { container } = render(<Temperature c={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for non-finite Infinity', () => {
    const { container } = render(<Temperature c={Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for a non-finite f input', () => {
    const { container } = render(<Temperature f={-Infinity} />);
    expect(container.textContent).toBe('—');
  });

  it('treats zero as a valid temperature, not an empty value', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={0} precision={0} />);
    expect(container.textContent).toBe('0°C');
    expect(container.textContent).not.toBe('—');
    expect(span(container)?.getAttribute('title')).toBe('0.0 °C');
  });

  it('renders negative temperatures with their sign preserved (−40 crossover)', () => {
    setUnits('imperial');
    const { container } = render(<Temperature c={-40} precision={0} />);
    // −40 °C == −40 °F (the famous crossover).
    expect(container.textContent).toBe('-40°F');
    expect(span(container)?.getAttribute('title')).toBe('-40.0 °C');
  });

  it('respects an explicit precision prop', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={1.23456} precision={3} />);
    expect(container.textContent).toBe('1.235°C');
  });

  it('falls back to the global precision when the precision prop is omitted', () => {
    setGlobalPrecision(3);
    setUnits('metric');
    const { container } = render(<Temperature c={2} />);
    expect(container.textContent).toBe('2.000°C');
  });

  it('keeps the hover title at one decimal regardless of the display precision', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={36.7} precision={0} />);
    // Display rounds to 0 decimals; the title always carries 1 decimal.
    expect(container.textContent).toBe('37°C');
    expect(span(container)?.getAttribute('title')).toBe('36.7 °C');
  });

  it('applies the className to the rendered value span', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={1} className="text-cyan-300" />);
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<Temperature className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('omits the title attribute on the empty state', () => {
    const { container } = render(<Temperature />);
    expect(span(container)?.hasAttribute('title')).toBe(false);
  });

  it('renders a <span> element carrying the hover title for context', () => {
    setUnits('metric');
    const { container } = render(<Temperature c={42} precision={0} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
    expect(el?.getAttribute('title')).toBe('42.0 °C');
  });

  it('recomputes the display when the user switches unit systems', () => {
    setUnits('metric');
    const { container, rerender } = render(<Temperature c={20} precision={0} />);
    expect(container.textContent).toBe('20°C');

    setUnits('imperial');
    rerender(<Temperature c={20} precision={0} />);
    expect(container.textContent).toBe('68°F');
  });
});
