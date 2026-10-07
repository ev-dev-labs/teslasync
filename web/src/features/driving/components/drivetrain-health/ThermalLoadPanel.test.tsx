/**
 * ThermalLoadPanel — behavioural, branch, hardening + a11y cover.
 *
 * ThermalLoadPanel is the presentational thermal-load bento in the
 * drivetrain-health stack. It never fetches: the parent hands it a shaped
 * `TempSensor[]`, the peak/avg motor power scalars and a `DrivingStats` bag,
 * so these tests drive it directly with hand-built props.
 *
 * The component composes three shared surfaces whose internals are exercised
 * for real (no chart doubles needed here):
 *   - a per-sensor <MetricBar> row (label + a colour-coded temperature
 *     sub-readout via the `displayTemp` helper);
 *   - a four-up <InlineMetric> grid (peak power, avg power, drive count,
 *     regen ratio) with `> 0` / `stats?` guards that fall back to an em dash;
 *   - loading (<Skeleton>) and empty (<EmptyState role="status">) branches.
 *
 * framer-motion is swapped for a passthrough double so <FadeIn> and the
 * animated <MetricBar> fill render deterministically (and so jsdom doesn't
 * need matchMedia). react-i18next is stubbed to echo the fallback copy AND
 * to spy on the key/default pairs. useUnits is mocked to a deterministic
 * formatter bag whose `formatTemperature` tags a distinctive "°C" suffix so
 * we can prove the value flows through the panel's own wrapper into the
 * per-sensor sub-readout. `numberFormat` runs for real so the kW / % /
 * integer formatting is genuine.
 *
 * Facets covered:
 *   1. CHROME    — the h3 panel title renders in every state; its icon is
 *                  decorative (aria-hidden) and i18n-keyed.
 *   2. SENSORS   — one MetricBar per sensor, i18n-keyed labels, the numeric
 *                  sub-readout formats through useUnits, a null reading shows
 *                  an em dash (not "0°C" / NaN).
 *   3. METRICS   — populated peak/avg/drives/regen format correctly and are
 *                  tied to the right labels.
 *   4. FALLBACKS — peak/avg <= 0 collapse to an em dash; undefined stats
 *                  collapses drives + regen to an em dash while power stays.
 *   5. LOADING   — the loading flag shows a skeleton and withholds all
 *                  metrics, keeping the title.
 *   6. EMPTY     — an empty sensor list shows the status empty-state and no
 *                  metric grid.
 *   7. HARDENING — an (untyped-at-runtime) undefined `sensors` renders the
 *                  empty state instead of throwing on `.length` / `.map`.
 *   8. A11Y      — all five metric icons are aria-hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';

// Shared, mutable doubles hoisted above the vi.mock factories.
const h = vi.hoisted(() => {
  const t = vi.fn((key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key,
  );
  return { t };
});

// i18n: echo the fallback string so assertions read real user copy, and spy
// on the key/default pairs so we can pin the translation contract.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: h.t,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// framer-motion: passthrough double. <FadeIn> + <MetricBar> both animate via
// motion.div; the real library measures nothing useful under jsdom and needs
// matchMedia (for useReducedMotion). The double renders the tag and drops the
// animation-only props so the DOM stays inspectable and deterministic.
vi.mock('framer-motion', () => {
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileInView',
    'whileFocus',
    'whileDrag',
    'layout',
    'layoutId',
    'drag',
    'dragConstraints',
    'onAnimationComplete',
  ]);
  const render = (props: Record<string, unknown>) => {
    const { children, as, ...rest } = props as {
      children?: ReactNode;
      as?: ElementType;
    } & Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!MOTION_ONLY.has(k)) clean[k] = v;
    }
    const Tag = (as as ElementType) ?? 'div';
    return <Tag {...clean}>{children as ReactNode}</Tag>;
  };
  return {
    motion: new Proxy({}, { get: () => render }),
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// useUnits: deterministic formatter bag. Only `formatTemperature` matters to
// this component; its distinctive "°C" tag lets us prove the reading flows
// through the panel's `formatTemperature` wrapper into `displayTemp`.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: number | null | undefined) => String(v ?? 0),
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatTemperature: (v: number | null | undefined) => `${v ?? 0}°C`,
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

import { ThermalLoadPanel } from './ThermalLoadPanel';
import type { TempSensor } from './constants';
import type { DrivingStats } from '@/types/driving';

type Props = ComponentProps<typeof ThermalLoadPanel>;

function sensor(overrides: Partial<TempSensor> = {}): TempSensor {
  return {
    key: 'front',
    labelKey: 'drivetrain.frontMotor',
    defaultLabel: 'Front Motor',
    value: 42,
    maxTemp: 150,
    color: '#06b6d4',
    icon: null,
    ...overrides,
  };
}

const baseStats: DrivingStats = {
  totalDrives: 42,
  totalDistanceKm: 8000,
  totalDurationS: 3600,
  avgEfficiencyWhKm: 150,
  avgSpeedKmh: 10,
  topSpeedKmh: 25,
  regenRatio: 0.2,
  regenEnergyWh: 500,
  co2SavedKg: 30,
};

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    sensors: [
      sensor({ key: 'front', labelKey: 'drivetrain.frontMotor', defaultLabel: 'Front Motor', value: 42, maxTemp: 150 }),
      sensor({ key: 'rear', labelKey: 'drivetrain.rearMotor', defaultLabel: 'Rear Motor', value: 88, maxTemp: 150 }),
      sensor({ key: 'inv', labelKey: 'drivetrain.inverter', defaultLabel: 'Inverter', value: null, maxTemp: 120 }),
    ],
    peakPower: 350,
    avgPowerMax: 125.5,
    stats: baseStats,
    loading: false,
    ...overrides,
  };
}

// The InlineMetric renders [icon][value][label] as sibling spans, so the value
// is the label span's previous sibling. This ties each read to its label
// unambiguously even when several cells collapse to the same em dash.
function inlineValueFor(label: string): string {
  return screen.getByText(label).previousElementSibling?.textContent ?? '';
}

// The MetricBar renders [label][sublabel] as sibling spans in its header row,
// so the temperature sub-readout is the label span's next sibling.
function sublabelFor(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  h.t.mockClear();
});

afterEach(cleanup);

describe('ThermalLoadPanel — chrome', () => {
  it('renders the i18n-keyed panel title as an h3 with a decorative (aria-hidden) icon', () => {
    render(<ThermalLoadPanel {...makeProps()} />);

    // PanelTitle → Heading level="panel" → <h3>. Accessible name excludes the
    // aria-hidden icon, so it is exactly the translated copy.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Thermal Load Indicators' }),
    ).toBeInTheDocument();
    expect(h.t).toHaveBeenCalledWith('drivetrain.thermalMetrics', 'Thermal Load Indicators');

    // The title's leading icon is presentational.
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('ThermalLoadPanel — sensor rows', () => {
  it('renders one MetricBar per sensor with i18n-keyed labels', () => {
    render(<ThermalLoadPanel {...makeProps()} />);

    expect(screen.getByText('Front Motor')).toBeInTheDocument();
    expect(screen.getByText('Rear Motor')).toBeInTheDocument();
    expect(screen.getByText('Inverter')).toBeInTheDocument();
    // Labels resolve through the i18n key + default-copy pair.
    expect(h.t).toHaveBeenCalledWith('drivetrain.frontMotor', 'Front Motor');
    expect(h.t).toHaveBeenCalledWith('drivetrain.inverter', 'Inverter');
  });

  it('formats a numeric reading through the useUnits wrapper into the sub-readout', () => {
    render(<ThermalLoadPanel {...makeProps()} />);

    // displayTemp(42, wrapper) → formatTemperature(42) → "42°C".
    expect(sublabelFor('Front Motor')).toBe('42°C');
    expect(sublabelFor('Rear Motor')).toBe('88°C');
  });

  it('shows an em dash (not "0°C" / NaN) for a null sensor reading and does not throw', () => {
    expect(() => render(<ThermalLoadPanel {...makeProps()} />)).not.toThrow();

    // displayTemp short-circuits null → "—" before the formatter is called.
    expect(sublabelFor('Inverter')).toBe('—');
  });
});

describe('ThermalLoadPanel — inline metrics (populated)', () => {
  it('formats peak power, avg power, drive count and regen ratio against their labels', () => {
    render(<ThermalLoadPanel {...makeProps()} />);

    expect(inlineValueFor('Peak Power')).toBe('350 kW');
    expect(inlineValueFor('Avg Power')).toBe('125.5 kW');
    expect(inlineValueFor('Drives')).toBe('42');
    expect(inlineValueFor('Regen Ratio')).toBe('20.0%');
  });
});

describe('ThermalLoadPanel — inline metric fallbacks', () => {
  it('collapses peak and avg power to an em dash when their scalars are not positive', () => {
    render(
      <ThermalLoadPanel
        {...makeProps({
          sensors: [sensor({ key: 'front', value: 42 })],
          peakPower: 0,
          avgPowerMax: 0,
        })}
      />,
    );

    expect(inlineValueFor('Peak Power')).toBe('—');
    expect(inlineValueFor('Avg Power')).toBe('—');
    // Stats-backed cells still render — only the power scalars fell back.
    expect(inlineValueFor('Drives')).toBe('42');
    expect(inlineValueFor('Regen Ratio')).toBe('20.0%');
  });

  it('collapses drives and regen ratio to an em dash when stats is undefined, keeping power', () => {
    render(
      <ThermalLoadPanel
        {...makeProps({
          sensors: [sensor({ key: 'front', value: 42 })],
          stats: undefined,
        })}
      />,
    );

    expect(inlineValueFor('Drives')).toBe('—');
    expect(inlineValueFor('Regen Ratio')).toBe('—');
    // Power scalars are independent of stats.
    expect(inlineValueFor('Peak Power')).toBe('350 kW');
    expect(inlineValueFor('Avg Power')).toBe('125.5 kW');
  });
});

describe('ThermalLoadPanel — loading + empty', () => {
  it('shows a skeleton and withholds every metric while loading, keeping the title', () => {
    const { container } = render(<ThermalLoadPanel {...makeProps({ loading: true })} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Title persists so the layout does not jump.
    expect(screen.getByRole('heading', { level: 3, name: 'Thermal Load Indicators' })).toBeInTheDocument();
    // No sensor rows, no inline metrics.
    expect(screen.queryByText('Front Motor')).toBeNull();
    expect(screen.queryByText('Peak Power')).toBeNull();
  });

  it('shows the status empty-state and no metric grid for an empty sensor list', () => {
    render(<ThermalLoadPanel {...makeProps({ sensors: [] })} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No temperature sensor data available yet');
    // The whole metric body is replaced by the empty state.
    expect(screen.queryByText('Peak Power')).toBeNull();
    expect(screen.queryByText('Front Motor')).toBeNull();
  });
});

describe('ThermalLoadPanel — hardening + a11y', () => {
  it('is null-safe: an undefined sensors prop renders the empty state instead of throwing', () => {
    expect(() =>
      render(<ThermalLoadPanel {...makeProps({ sensors: undefined as unknown as TempSensor[] })} />),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent(
      'No temperature sensor data available yet',
    );
    expect(screen.queryByText('Peak Power')).toBeNull();
  });

  it('marks every metric icon as decorative (aria-hidden) — title + four inline icons', () => {
    const { container } = render(<ThermalLoadPanel {...makeProps()} />);

    // Activity (title) + Zap + TrendingUp + Activity (drives) + Shield = 5.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5);
  });
});
