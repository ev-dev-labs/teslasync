/**
 * HeroGauges — the charging-list hero KPI strip.
 *
 * The strip used to be four radial gauges whose ceilings were derived from the
 * readings themselves: `max={Math.max(count, 50)}` renders a completely full
 * ring for every count above 50, and the energy and cost gauges did the same.
 * A user with 60 sessions and a user with 6,000 saw the identical picture. The
 * three unbounded totals are now plain readings; average power keeps a scale
 * because 250 kW (the Supercharger peak) is a real one.
 *
 * `MetricTile` and `ThresholdBar` are stubbed with prop-echoing doubles so the
 * derivation this component owns — which reading goes where, in what unit, at
 * what precision, and against which scale — is directly assertable. jsdom sizes
 * the real SVG/flex leaves at 0×0, so their internals are not the subject here.
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

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

interface Band {
  from: number;
  to: number;
  label?: string;
}

vi.mock('@/components/charts', () => ({
  ThresholdBar: ({
    value,
    min,
    max,
    bands,
    label,
    unit,
    decimals,
  }: {
    value: number;
    min: number;
    max: number;
    bands?: Band[];
    label: string;
    unit?: string;
    decimals?: number;
  }) => (
    <div
      data-testid="threshold-bar"
      data-label={label}
      data-value={String(value)}
      data-min={String(min)}
      data-max={String(max)}
      data-unit={unit ?? ''}
      data-decimals={String(decimals)}
      data-bands={(bands ?? []).map((b) => `${b.label}:${b.from}-${b.to}`).join('|')}
    />
  ),
}));

vi.mock('@/components/data-display', () => ({
  MetricTile: ({
    value,
    unit,
    label,
    decimals,
    accentClass,
  }: {
    value: number;
    unit?: string;
    label: string;
    decimals?: number;
    accentClass?: string;
  }) => (
    <div
      data-testid="metric-tile"
      data-label={label}
      data-value={String(value)}
      data-unit={unit ?? ''}
      data-decimals={String(decimals)}
      data-accent={accentClass ?? ''}
    />
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

function readout(container: HTMLElement, label: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-label="${label}"]`);
  if (!el) throw new Error(`readout "${label}" not rendered`);
  return el;
}

describe('HeroGauges — empty state', () => {
  it('renders an EmptyState (role="status") and no readouts when stats is null', () => {
    const { container } = render(<HeroGauges stats={null} />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(EMPTY_MESSAGE);

    expect(container.querySelectorAll('[data-testid="metric-tile"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="threshold-bar"]')).toHaveLength(0);
  });
});

describe('HeroGauges — unbounded totals carry no scale', () => {
  it('renders session count, energy, cost and unit cost as plain readings', () => {
    const { container } = render(<HeroGauges stats={makeStats()} />);

    expect(screen.getAllByTestId('metric-tile')).toHaveLength(4);
    expect(screen.queryByRole('status')).toBeNull();

    expect(readout(container, 'Sessions').getAttribute('data-value')).toBe('12');
    expect(readout(container, 'Energy').getAttribute('data-value')).toBe('345.6');
    expect(readout(container, 'Energy').getAttribute('data-unit')).toBe('kWh');
    expect(readout(container, 'Total Cost').getAttribute('data-value')).toBe('487.5');
    expect(readout(container, 'Avg cost').getAttribute('data-value')).toBe('0.128');
  });

  it('resolves the cost unit from the reader currency, never a hardcoded $', () => {
    const { container } = render(<HeroGauges stats={makeStats()} />);
    expect(readout(container, 'Total Cost').getAttribute('data-unit')).toBe('$');
  });

  it('keeps the third decimal on the unit cost that the reading depends on', () => {
    const { container } = render(<HeroGauges stats={makeStats({ avgCostPerKwh: 0.128 })} />);
    expect(readout(container, 'Avg cost').getAttribute('data-decimals')).toBe('3');
  });

  // Regression guard for the two rounding defects the old gauges carried.
  it('passes totals through unrounded rather than truncating at a separator', () => {
    const { container } = render(<HeroGauges stats={makeStats({ totalCost: 1234.56 })} />);

    // The old code did parseFloat(fmtNumber(1234.56, 0)) === parseFloat('1,234') === 1.
    const cost = readout(container, 'Total Cost');
    expect(cost.getAttribute('data-value')).toBe('1234.56');
    expect(cost.getAttribute('data-value')).not.toBe('1');
    // Rounding is now the formatter's job, declared once as a precision.
    expect(cost.getAttribute('data-decimals')).toBe('0');
  });

  it('never derives a ceiling from the reading — 60 and 6000 sessions differ', () => {
    const { container: few } = render(<HeroGauges stats={makeStats({ count: 60 })} />);
    const a = readout(few, 'Sessions').getAttribute('data-value');
    const { container: many } = render(<HeroGauges stats={makeStats({ count: 6000 })} />);
    const b = readout(many, 'Sessions').getAttribute('data-value');

    expect(a).toBe('60');
    expect(b).toBe('6000');
    expect(a).not.toBe(b);
  });
});

describe('HeroGauges — average power keeps a real scale', () => {
  it('scales average power against the 250 kW Supercharger peak', () => {
    const { container } = render(<HeroGauges stats={makeStats({ avgPower: 47.4 })} />);

    const power = readout(container, 'Avg Power');
    expect(power.getAttribute('data-testid')).toBe('threshold-bar');
    expect(power.getAttribute('data-value')).toBe('47.4');
    expect(power.getAttribute('data-min')).toBe('0');
    expect(power.getAttribute('data-max')).toBe('250');
    expect(power.getAttribute('data-unit')).toBe('kW');
  });

  it('names the charging regimes so the scale is legible without the numbers', () => {
    const { container } = render(<HeroGauges stats={makeStats()} />);

    expect(readout(container, 'Avg Power').getAttribute('data-bands')).toBe(
      'AC:0-22|DC fast:22-150|Supercharge:150-250',
    );
  });
});

describe('HeroGauges — hardening', () => {
  it('coerces absent numeric fields to 0 — no NaN reaches any readout', () => {
    // `stats` is truthy (renders the strip) but every metric is missing, the
    // exact absent-field shape the API can hand back.
    const partial = {} as ChargingStats;

    let container!: HTMLElement;
    expect(() => {
      container = render(<HeroGauges stats={partial} />).container;
    }).not.toThrow();

    expect(readout(container, 'Sessions').getAttribute('data-value')).toBe('0');
    expect(readout(container, 'Energy').getAttribute('data-value')).toBe('0');
    expect(readout(container, 'Total Cost').getAttribute('data-value')).toBe('0');
    expect(readout(container, 'Avg Power').getAttribute('data-value')).toBe('0');
    expect(readout(container, 'Avg cost').getAttribute('data-value')).toBe('0');

    // The power scale stays fixed and positive even with no data.
    expect(readout(container, 'Avg Power').getAttribute('data-max')).toBe('250');
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
