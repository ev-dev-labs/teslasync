/**
 * TemperatureGauges — behaviour, branch, unit-conversion, severity-colour,
 * a11y, and null-safety coverage for the file's sole export.
 *
 * The panel is a presentational leaf: given a `sensors: TempSensor[]` list and a
 * `loading` flag it renders one `LinearGauge` per sensor (temperature reading +
 * a scale caption stating the gauge's range), or a loading skeleton, or a labelled empty state.
 * There is no data source — the surface under test is the three-way render branch
 * plus the way each sensor is projected onto a gauge:
 *
 *   1. RENDER BRANCH — `loading` shows the skeleton (no gauges); an empty list
 *      shows the translated `EmptyState`; a populated list shows the gauges. The
 *      panel title renders in every branch.
 *   2. UNIT BOUNDARY — every temperature (the gauge value AND the "Max" caption)
 *      is converted from SI Celsius to the user's unit at the render boundary via
 *      `useUnits()` → °C under metric, °F under Fahrenheit. Both branches are
 *      exercised through a mutable settings mock.
 *   3. SEVERITY COLOUR — the gauge arc colour comes from `tempSeverityColor`,
 *      computed on the SI values, so the same physical reading keeps its colour
 *      regardless of the display unit (a null reading is drawn grey).
 *   4. NULL-SAFETY (the hardening this pass adds) — a `null` sensor reading draws
 *      a zeroed grey gauge without emitting NaN, and a nullish `sensors` prop
 *      degrades to the empty state instead of throwing on `.length`.
 *   5. i18n — the title, empty-state copy, "Max" label, and every sensor label
 *      resolve through translation keys with English fallbacks (the spy pins the
 *      contract).
 *   6. a11y — the title is a level-3 heading and its decorative thermometer icon
 *      is hidden from assistive tech.
 *
 * Strategy: the component takes props and touches no network, so a bare render()
 * suffices. `@/hooks/useSettings` is mocked per-file with a mutable object so the
 * °C and °F branches of useUnits are both reachable; this file-level mock takes
 * precedence over the global test-setup stub. `react-i18next` is mocked so
 * `t(key, fallback)` renders the English fallback deterministically while a spy
 * records the (key, fallback) pairs. A matchMedia stub is installed before any
 * module evaluates because FadeIn → useMotionPreference → framer-motion's
 * useReducedMotion reaches for it under jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TempSensor } from './constants';

// jsdom lacks matchMedia; the FadeIn wrapper reads it at render for the
// reduced-motion preference. Install a benign stub before anything evaluates.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Mutable settings so a single test can flip metric ↔ Fahrenheit. useUnits reads
// settings.unit_of_temp synchronously each render, so mutating before render is
// enough. This file-level mock takes precedence over the global test-setup stub.
let mockSettings = {
  unit_of_length: 'km' as const,
  unit_of_temp: 'C' as const,
  unit_of_pressure: 'bar' as const,
  locale: 'en-US',
  decimal_precision: 2,
};
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}));

// i18n → return the developer fallback so labels read as real English; the spy
// records the (key, fallback) pairs so the i18n contract can be asserted.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

import { TemperatureGauges } from './TemperatureGauges';
import { gaugeColors } from '@/test/gaugeTestUtils';

/** A single sensor with sane defaults; each spec overrides the fields it asserts. */
function sensor(over: Partial<TempSensor> = {}): TempSensor {
  return {
    key: 'k',
    labelKey: 'drivetrain.frontMotor',
    defaultLabel: 'Front Motor',
    value: 30,
    maxTemp: 150,
    color: '#06b6d4',
    icon: null,
    ...over,
  };
}

/**
 * Four sensors spanning every severity band + a null reading, with distinct
 * maxTemps so the "Max" captions stay unique:
 *   front   30/150 → 0.20 → good     (#10b981)
 *   inverter 90/120 → 0.75 → warning  (#f59e0b)
 *   battery  55/60  → 0.92 → critical (#ef4444)
 *   rear     null/100 →      unknown  (#6b7280), gauge value 0
 */
function fourSensors(): TempSensor[] {
  return [
    sensor({ key: 'front', labelKey: 'drivetrain.frontMotor', defaultLabel: 'Front Motor', value: 30, maxTemp: 150 }),
    sensor({ key: 'inverter', labelKey: 'drivetrain.inverter', defaultLabel: 'Inverter', value: 90, maxTemp: 120 }),
    sensor({ key: 'battery', labelKey: 'drivetrain.battery', defaultLabel: 'Battery', value: 55, maxTemp: 60 }),
    sensor({ key: 'rear', labelKey: 'drivetrain.rearMotor', defaultLabel: 'Rear Motor', value: null, maxTemp: 100 }),
  ];
}

function renderGauges(props: { sensors: TempSensor[]; loading?: boolean }) {
  return render(<TemperatureGauges {...props} />);
}

/** The fill colour of every gauge (severity hex). */
function circleStrokes(container: HTMLElement): string[] {
  return gaugeColors(container);
}

const EMPTY_MESSAGE = 'No temperature sensor data available yet';

beforeEach(() => {
  tSpy.mockClear();
  mockSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
  };
});

describe('TemperatureGauges — panel chrome + a11y', () => {
  it('renders the title as a level-3 heading resolved through i18n in every branch', () => {
    renderGauges({ sensors: [] });

    expect(
      screen.getByRole('heading', { level: 3, name: 'Temperature Gauges' }),
    ).toBeInTheDocument();
    expect(tSpy).toHaveBeenCalledWith('drivetrain.tempGauges', 'Temperature Gauges');
  });

  it('marks the decorative thermometer icon as hidden from assistive tech', () => {
    renderGauges({ sensors: fourSensors() });

    const heading = screen.getByRole('heading', { level: 3 });
    const icon = heading.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('TemperatureGauges — loading branch', () => {
  it('shows the skeleton and no gauges while loading, keeping the title visible', () => {
    const { container } = renderGauges({ sensors: fourSensors(), loading: true });

    // A pulsing placeholder stands in for the gauges…
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // …and none of the sensor content renders yet.
    expect(screen.queryByText('Front Motor')).toBeNull();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
    // The panel title still anchors the panel.
    expect(screen.getByRole('heading', { level: 3, name: 'Temperature Gauges' })).toBeInTheDocument();
  });
});

describe('TemperatureGauges — empty branch', () => {
  it('shows the translated empty state when there are no sensors', () => {
    renderGauges({ sensors: [] });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(EMPTY_MESSAGE);
    expect(tSpy).toHaveBeenCalledWith('drivetrain.noSensors', EMPTY_MESSAGE);
    // No gauges in the empty branch.
    expect(screen.queryByText('Front Motor')).toBeNull();
  });
});

describe('TemperatureGauges — populated (metric / °C)', () => {
  it('renders one labelled gauge per sensor with °C "Max" captions', () => {
    renderGauges({ sensors: fourSensors() });

    // Every sensor label resolves through its i18n key.
    expect(screen.getByText('Front Motor')).toBeInTheDocument();
    expect(screen.getByText('Inverter')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Rear Motor')).toBeInTheDocument();
    expect(tSpy).toHaveBeenCalledWith('drivetrain.frontMotor', 'Front Motor');
    expect(tSpy).toHaveBeenCalledWith('drivetrain.battery', 'Battery');

    // Each gauge states its own scale, so the ceiling is visible rather than
    // implicit in the arc — printed as an SI-converted range in the active unit.
    expect(screen.getByText('0 – 150°C')).toBeInTheDocument();
    expect(screen.getByText('0 – 120°C')).toBeInTheDocument();
    expect(screen.getByText('0 – 60°C')).toBeInTheDocument();
    expect(screen.getByText('0 – 100°C')).toBeInTheDocument();
  });

  it('shows a live reading (unit-converted) and zeroes a null reading', () => {
    renderGauges({ sensors: fourSensors() });

    // Battery reads 55°C under metric preferences (identity conversion)…
    expect(screen.getByText('55')).toBeInTheDocument();
    // …and the null rear-motor reading is rendered as a zeroed gauge, not "NaN".
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('paints each arc by SI severity band — good/warning/critical + grey for null', () => {
    const { container } = renderGauges({ sensors: fourSensors() });

    const strokes = circleStrokes(container);
    expect(strokes).toContain('#10b981'); // front: good
    expect(strokes).toContain('#f59e0b'); // inverter: warning
    expect(strokes).toContain('#ef4444'); // battery: critical
    expect(strokes).toContain('#6b7280'); // rear: null → grey
  });
});

describe('TemperatureGauges — Fahrenheit boundary', () => {
  it('converts every temperature to °F while keeping the SI-based severity colour', () => {
    mockSettings = { ...mockSettings, unit_of_temp: 'F' };
    const { container } = renderGauges({ sensors: fourSensors() });

    // Scale captions swap to Fahrenheit at BOTH ends — the floor is 0 °C, which
    // is 32 °F, not zero. Converting only the ceiling would misreport the range.
    expect(screen.getByText('32 – 302°F')).toBeInTheDocument();
    expect(screen.getByText('32 – 140°F')).toBeInTheDocument();
    expect(screen.queryByText('0 – 60°C')).toBeNull();

    // The battery reading converts 55°C → 131°F at the render boundary.
    expect(screen.getByText('131')).toBeInTheDocument();

    // Severity is computed on the SI values, so the battery arc stays critical.
    expect(circleStrokes(container)).toContain('#ef4444');
  });
});

describe('TemperatureGauges — null safety', () => {
  it('degrades to the empty state (no throw) when the sensors prop is nullish', () => {
    expect(() =>
      renderGauges({ sensors: undefined as unknown as TempSensor[] }),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_MESSAGE);
    expect(screen.queryByText('Front Motor')).toBeNull();
  });

  it('renders a single null-reading sensor as a grey zeroed gauge without NaN', () => {
    const { container } = renderGauges({
      sensors: [sensor({ key: 'solo', value: null, maxTemp: 60 })],
    });

    expect(screen.getByText('0 – 60°C')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(circleStrokes(container)).toContain('#6b7280');
  });
});
