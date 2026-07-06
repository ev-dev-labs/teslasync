/**
 * TemperatureMetricCards — the Drivetrain-Health KPI band (N sensor tiles +
 * Health Score + Peak Power).
 *
 * These tests exercise the pieces the component actually paints in jsdom, not a
 * smoke render:
 *   - the three mutually-exclusive states in priority order (loading skeleton
 *     grid > empty > populated), incl. the null-safety guard that a missing
 *     `sensors` feed degrades to the empty state instead of throwing on
 *     `.length`,
 *   - each sensor tile's value (delegated to displayTemp → the unit formatter)
 *     and its "% of max" subtitle, including the hardening branch where a
 *     non-finite reading or a non-positive ceiling shows "No data" (mirroring
 *     the '—' value) rather than a misleading "0% of max",
 *   - the Health Score tile's status→neon-colour branch (good/warning/critical)
 *     and its NaN guard (never "NaN%"),
 *   - the Peak Power tile's `> 0` gate (formatted kW vs '—'), and
 *   - a11y: the two component-owned decorative icons (Heart, Zap) are
 *     aria-hidden, and the loading skeleton grid is hidden from assistive tech.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default
 * for exact copy assertions. `@/hooks/useUnits` is mocked to a deterministic
 * Celsius formatter (a spy) so temperature output is stable and we can prove
 * displayTemp only ever hands the formatter a finite reading.
 */
import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const tMock = (key: string, fallbackOrOpts?: unknown): string => {
  if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
  if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
    const o = fallbackOrOpts as Record<string, unknown>;
    if (typeof o.defaultValue === 'string') return o.defaultValue;
  }
  return key;
};

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tMock,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Deterministic Celsius formatter, exposed as a spy so a test can assert the
// component only ever delegates a *finite* reading (displayTemp guards null /
// NaN / ±Infinity before calling). `vi.hoisted` makes it visible to the
// hoisted `vi.mock` factory below.
const unitsRef = vi.hoisted(() => ({
  formatTemperature: vi.fn(
    (v: number | null | undefined): string =>
      v === null || v === undefined || !Number.isFinite(v)
        ? '—'
        : `${Number(v).toFixed(1)}°C`,
  ),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatTemperature: unitsRef.formatTemperature }),
}));

import { TemperatureMetricCards } from './TemperatureMetricCards';
import type { HealthStatus, TempSensor } from './constants';

function sensor(overrides: Partial<TempSensor> & Pick<TempSensor, 'key'>): TempSensor {
  return {
    labelKey: `drivetrain.${overrides.key}`,
    defaultLabel: overrides.key,
    value: 0,
    maxTemp: 150,
    color: '#06b6d4',
    icon: <span data-testid={`icon-${overrides.key}`} />,
    ...overrides,
  };
}

// Front motor 60/150 = 0.40 → "40% of max"; inverter 84/120 = 0.70 →
// "70% of max"; battery has no reading → value '—', subtitle "No data".
const baseSensors: TempSensor[] = [
  sensor({ key: 'frontMotor', defaultLabel: 'Front Motor', value: 60, maxTemp: 150 }),
  sensor({ key: 'inverter', defaultLabel: 'Inverter', value: 84, maxTemp: 120 }),
  sensor({ key: 'battery', defaultLabel: 'Battery', value: null, maxTemp: 60 }),
];

// All-finite variant so the only '—' on screen is the Peak Power tile.
const finiteSensors: TempSensor[] = [
  sensor({ key: 'frontMotor', defaultLabel: 'Front Motor', value: 60, maxTemp: 150 }),
  sensor({ key: 'inverter', defaultLabel: 'Inverter', value: 84, maxTemp: 120 }),
];

interface Props {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
  loading?: boolean;
}

function renderCards(overrides: Partial<Props> = {}) {
  const props: Props = {
    sensors: baseSensors,
    overallHealth: 'good',
    healthScore: 95,
    peakPower: 1234,
    ...overrides,
  };
  return render(<TemperatureMetricCards {...props} />);
}

beforeEach(() => {
  unitsRef.formatTemperature.mockClear();
});

describe('TemperatureMetricCards — states (loading > empty > data)', () => {
  it('renders six aria-hidden skeletons and no tiles while loading', () => {
    const { container } = renderCards({ loading: true });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Loading strictly precedes the empty / data branches.
    expect(screen.queryByText('Health Score')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('loading wins even when the sensor list is empty (no EmptyState flash)', () => {
    const { container } = renderCards({ sensors: [], loading: true });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders an EmptyState (role=status) with the awaiting-telemetry copy when there are no sensors', () => {
    renderCards({ sensors: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText('No temperature sensor data available yet'),
    ).toBeInTheDocument();
    // No metric tiles leak through.
    expect(screen.queryByText('Health Score')).toBeNull();
    expect(screen.queryByText('Peak Power')).toBeNull();
  });

  it('degrades an undefined sensor feed to the empty state instead of throwing', () => {
    // Null-safety hardening: `sensors ?? []` must guard `.length` / `.map`.
    expect(() =>
      renderCards({ sensors: undefined as unknown as TempSensor[] }),
    ).not.toThrow();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('TemperatureMetricCards — populated tiles', () => {
  it('renders every sensor label plus the Health Score and Peak Power tiles', () => {
    renderCards();

    expect(screen.getByText('Front Motor')).toBeInTheDocument();
    expect(screen.getByText('Inverter')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Health Score')).toBeInTheDocument();
    expect(screen.getByText('Peak Power')).toBeInTheDocument();
  });

  it('shows the formatter output for finite readings and "—" for a missing one', () => {
    renderCards();

    expect(screen.getByText('60.0°C')).toBeInTheDocument();
    expect(screen.getByText('84.0°C')).toBeInTheDocument();
    // Battery has no reading → em-dash, never "NaN°C".
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('computes the "% of max" subtitle from reading / ceiling', () => {
    renderCards();

    expect(screen.getByText('40% of max')).toBeInTheDocument(); // 60 / 150
    expect(screen.getByText('70% of max')).toBeInTheDocument(); // 84 / 120
    // The missing-reading tile falls back to the "No data" copy.
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('only ever delegates a finite reading to the unit formatter', () => {
    renderCards();

    const calls = unitsRef.formatTemperature.mock.calls;
    const firstArgs = calls.map((c) => c[0]);
    // Both finite sensors were formatted…
    expect(firstArgs).toContain(60);
    expect(firstArgs).toContain(84);
    // …and displayTemp never handed the formatter a null / non-finite value.
    expect(firstArgs.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
  });
});

describe('TemperatureMetricCards — subtitle hardening', () => {
  it('shows "No data" (not "0% of max") for a NaN reading, matching the "—" value', () => {
    const { container } = renderCards({
      sensors: [sensor({ key: 'frontMotor', defaultLabel: 'Front Motor', value: Number.NaN, maxTemp: 150 })],
    });

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText(/% of max/)).toBeNull();
    // The tile value is the neutral em-dash and no "NaN" reaches the DOM.
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('shows "No data" for a non-positive ceiling (division would be meaningless)', () => {
    renderCards({
      sensors: [sensor({ key: 'inverter', defaultLabel: 'Inverter', value: 90, maxTemp: 0 })],
    });

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByText(/% of max/)).toBeNull();
  });

  it('still ranks a cold (below-zero) reading rather than calling it "No data"', () => {
    renderCards({
      sensors: [sensor({ key: 'battery', defaultLabel: 'Battery', value: -6, maxTemp: 60 })],
    });

    // -6 is a legitimate finite reading → percent subtitle, not "No data".
    expect(screen.queryByText('No data')).toBeNull();
    expect(screen.getByText(/% of max/)).toBeInTheDocument();
  });
});

describe('TemperatureMetricCards — Health Score tile', () => {
  const bgClass: Record<HealthStatus, string> = {
    good: 'bg-neon-green/10',
    warning: 'bg-neon-amber/10',
    critical: 'bg-neon-red/10',
  };

  it.each(['good', 'warning', 'critical'] as const)(
    'maps overallHealth=%s to its neon accent on the Health Score tile',
    (overallHealth) => {
      const { unmount } = renderCards({ overallHealth });

      const card = screen.getByText('Health Score').closest('.rounded-xl');
      expect(card).not.toBeNull();
      expect(card?.querySelector(`[class*="${bgClass[overallHealth]}"]`)).not.toBeNull();
      unmount();
    },
  );

  it('renders the health score as a percent', () => {
    renderCards({ healthScore: 60, overallHealth: 'warning' });
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('guards a non-finite health score to 0% (never "NaN%")', () => {
    const { container } = renderCards({ healthScore: Number.NaN });

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe('TemperatureMetricCards — Peak Power tile', () => {
  it('formats a positive peak power as locale-grouped kW', () => {
    renderCards({ peakPower: 1234 });
    expect(screen.getByText('1,234 kW')).toBeInTheDocument();
  });

  it('renders "—" for a zero / non-positive peak power', () => {
    renderCards({ sensors: finiteSensors, peakPower: 0 });

    // finiteSensors have no missing reading, so this em-dash is the Peak Power tile.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/kW$/)).toBeNull();
  });
});

describe('TemperatureMetricCards — a11y', () => {
  it('marks the component-owned Heart and Zap icons as decorative (aria-hidden)', () => {
    const { container } = renderCards({ sensors: finiteSensors });

    // Sensor icons are non-svg spans; the only svgs are the owned Heart/Zap,
    // both hidden from assistive tech so the tile labels carry the meaning.
    const svgs = container.querySelectorAll('svg');
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs).toHaveLength(2);
    expect(hidden).toHaveLength(2);
  });

  it('hides the loading skeleton grid from assistive tech', () => {
    const { container } = renderCards({ loading: true });
    const grid = container.querySelector('div[aria-hidden="true"]');
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll('.animate-pulse')).toHaveLength(6);
  });
});
