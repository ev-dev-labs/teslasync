/**
 * HeroGauges — the charging-list hero KPI strip.
 *
 * The four radial gauges (`<RadialGauge>`) and the animated "$/kWh" tile
 * (`<AnimatedNumber>`) are presentational leaves: RadialGauge draws an SVG ring
 * that jsdom sizes at 0×0, and AnimatedNumber eases its display over a
 * `requestAnimationFrame` loop that never settles synchronously in jsdom. So —
 * like the sibling ChartsRow suite — we stub those two leaves with prop-echoing
 * doubles and assert the ONE thing HeroGauges actually owns: deriving each
 * gauge's `value` / `max` / `label` / `unit` / `color` from `stats`, plus the
 * hardening (null-safety + the locale-truncation and double-rounding bug fixes).
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default,
 * making the label / empty-state assertions exact.
 */
import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Prop-echoing double for the SVG gauge. Each instance is discoverable by its
// `data-label`, and every derived prop is exposed as a data-attribute so the
// derivation logic (and its bug fixes) is directly assertable.
vi.mock('@/components/charts', () => ({
  RadialGauge: ({
    value,
    max,
    label,
    unit,
    color,
  }: {
    value: number;
    max: number;
    label: string;
    unit?: string;
    color?: string;
  }) => (
    <div
      data-testid="radial-gauge"
      data-label={label}
      data-value={String(value)}
      data-max={String(max)}
      data-unit={unit ?? ''}
      data-color={color ?? ''}
    />
  ),
}));

// Prop-echoing double for the animated total — renders synchronously so the
// value/decimals it receives are observable without pumping RAF.
vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({
    value,
    decimals,
  }: {
    value: number;
    decimals?: number;
  }) => (
    <span
      data-testid="animated-number"
      data-value={String(value)}
      data-decimals={String(decimals)}
    >
      {value.toFixed(decimals ?? 0)}
    </span>
  ),
}));

import { HeroGauges } from './HeroGauges';
import type { ChargingStats } from './helpers';

const EMPTY_MESSAGE = 'No charging statistics available yet';

function makeStats(overrides: Partial<ChargingStats> = {}): ChargingStats {
  return {
    totalEnergy: 345.6,
    totalCost: 487.5,
    totalDuration: 600,
    avgPower: 47.4,
    avgCostPerKwh: 0.128,
    homeCount: 2,
    scCount: 3,
    dcCount: 1,
    count: 12,
    ...overrides,
  };
}

function gauge(container: HTMLElement, label: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-label="${label}"]`);
  if (!el) throw new Error(`gauge "${label}" not rendered`);
  return el;
}

describe('HeroGauges — empty state', () => {
  it('renders an EmptyState (role="status") and no gauges when stats is null', () => {
    const { container } = render(<HeroGauges stats={null} />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(EMPTY_MESSAGE);

    // The gauge strip must not render at all in the empty branch.
    expect(container.querySelectorAll('[data-testid="radial-gauge"]')).toHaveLength(0);
    expect(screen.queryByTestId('animated-number')).toBeNull();
  });
});

describe('HeroGauges — populated strip', () => {
  it('renders exactly four gauges plus the $/kWh tile with correct labels', () => {
    render(<HeroGauges stats={makeStats()} />);

    expect(screen.getAllByTestId('radial-gauge')).toHaveLength(4);
    // No empty-state placeholder leaks through when data is present.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('animated-number')).toBeInTheDocument();
  });

  it('maps each gauge to its unit + brand color (the static contract)', () => {
    const { container } = render(<HeroGauges stats={makeStats()} />);

    expect(gauge(container, 'Sessions').getAttribute('data-unit')).toBe('');
    expect(gauge(container, 'Sessions').getAttribute('data-color')).toBe('#00f0ff');
    expect(gauge(container, 'Energy').getAttribute('data-unit')).toBe('kWh');
    expect(gauge(container, 'Energy').getAttribute('data-color')).toBe('#10b981');
    expect(gauge(container, 'Total Cost').getAttribute('data-unit')).toBe('$');
    expect(gauge(container, 'Total Cost').getAttribute('data-color')).toBe('#f59e0b');
    expect(gauge(container, 'Avg Power').getAttribute('data-unit')).toBe('kW');
    expect(gauge(container, 'Avg Power').getAttribute('data-color')).toBe('#a855f7');
  });

  it('derives value + max: rounds energy/power/cost, passes sessions through', () => {
    const { container } = render(
      <HeroGauges stats={makeStats({ count: 12, totalEnergy: 345.6, avgPower: 47.4, totalCost: 487.5 })} />,
    );

    // Sessions: raw count, floor-50 axis.
    expect(gauge(container, 'Sessions').getAttribute('data-value')).toBe('12');
    expect(gauge(container, 'Sessions').getAttribute('data-max')).toBe('50');

    // Energy: Math.round(345.6) = 346, floor-500 axis.
    expect(gauge(container, 'Energy').getAttribute('data-value')).toBe('346');
    expect(gauge(container, 'Energy').getAttribute('data-max')).toBe('500');

    // Avg Power: Math.round(47.4) = 47, fixed 250 axis.
    expect(gauge(container, 'Avg Power').getAttribute('data-value')).toBe('47');
    expect(gauge(container, 'Avg Power').getAttribute('data-max')).toBe('250');

    // Total Cost: Math.round(487.5) = 488, axis tracks the raw total.
    expect(gauge(container, 'Total Cost').getAttribute('data-value')).toBe('488');
    expect(gauge(container, 'Total Cost').getAttribute('data-max')).toBe('487.5');
  });

  it('passes the raw $/kWh through to AnimatedNumber at 3-decimal precision', () => {
    render(<HeroGauges stats={makeStats({ avgCostPerKwh: 0.128 })} />);

    const animated = screen.getByTestId('animated-number');
    // The raw value flows through — NOT pre-rounded to 2 decimals (0.13), which
    // would have made the requested 3rd decimal permanently dead.
    expect(animated.getAttribute('data-value')).toBe('0.128');
    expect(animated.getAttribute('data-decimals')).toBe('3');
    expect(animated).toHaveTextContent('0.128');
  });
});

describe('HeroGauges — bug guards', () => {
  it('does NOT truncate a >= 1,000 total via the locale thousands separator', () => {
    const { container } = render(<HeroGauges stats={makeStats({ totalCost: 1234.56 })} />);

    const cost = gauge(container, 'Total Cost');
    // Regression guard: parseFloat(fmtNumber(1234.56, 0)) === parseFloat('1,234') === 1.
    // Math.round keeps the real magnitude.
    expect(cost.getAttribute('data-value')).toBe('1235');
    expect(cost.getAttribute('data-value')).not.toBe('1');
    expect(cost.getAttribute('data-max')).toBe('1234.56');
  });

  it('coerces absent numeric fields to 0 — no NaN reaches a gauge or the total', () => {
    // `stats` is truthy (renders the strip) but every metric is missing, the
    // exact snake_case/absent-field shape the API can hand back.
    const partial = {} as ChargingStats;

    let container!: HTMLElement;
    expect(() => {
      container = render(<HeroGauges stats={partial} />).container;
    }).not.toThrow();

    expect(gauge(container, 'Sessions').getAttribute('data-value')).toBe('0');
    expect(gauge(container, 'Energy').getAttribute('data-value')).toBe('0');
    expect(gauge(container, 'Total Cost').getAttribute('data-value')).toBe('0');
    expect(gauge(container, 'Avg Power').getAttribute('data-value')).toBe('0');
    expect(screen.getByTestId('animated-number').getAttribute('data-value')).toBe('0');

    // Floors still apply, so a "no data" gauge has a sane, positive axis.
    expect(gauge(container, 'Sessions').getAttribute('data-max')).toBe('50');
    expect(gauge(container, 'Energy').getAttribute('data-max')).toBe('500');

    expect(container.textContent).not.toMatch(/NaN/);
  });
});
