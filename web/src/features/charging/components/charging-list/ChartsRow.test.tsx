/**
 * ChartsRow — energy/cost trend + charger-breakdown panel contract.
 *
 * The two Recharts surfaces (`<AreaChart>` and `<PieChart>`) live inside a
 * `<ResponsiveContainer>`, which jsdom sizes at 0×0 so their inner SVG never
 * paints. So — like the sibling SpeedTrendChart suite — these tests assert
 * against the pieces the component actually owns and renders in jsdom:
 *   - the two GlassPanel headings (each `role="heading"`, level 3, with a
 *     decorative `aria-hidden` icon that must NOT leak into the accessible name),
 *   - the cost-by-type list on the right of the breakdown panel — the one place
 *     the numeric formatting (`fmtWithUnit` kWh, `$…  total`, `$…/kWh`) is
 *     observable, and
 *   - the hardening: every data source degrades to an <EmptyState> (role
 *     `status`) instead of a blank panel, and an `undefined` array prop (a
 *     late/failed fetch) must NOT crash on `.map` / `.length`.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default,
 * making the empty-state / label assertions exact. `fmtNumber` uses its module
 * default precision (2) + `en-US` locale, so the formatted strings are
 * deterministic without touching the global settings singleton.
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

import { ChartsRow } from './ChartsRow';
import type {
  EnergyTrendPoint,
  ChargerBreakdownEntry,
  CostByTypeEntry,
} from './helpers';

const TREND_EMPTY = 'No charging trend data available yet.';
const BREAKDOWN_EMPTY = 'No charger breakdown data available yet.';

function trend(overrides: Partial<EnergyTrendPoint> = {}): EnergyTrendPoint {
  return { date: 'Jan 10', energy: 42.5, cost: 8.4, ...overrides };
}

function breakdownEntry(
  overrides: Partial<ChargerBreakdownEntry> = {},
): ChargerBreakdownEntry {
  return { name: 'Supercharger', value: 3, fill: '#ff0000', ...overrides };
}

function cost(overrides: Partial<CostByTypeEntry> = {}): CostByTypeEntry {
  return { name: 'Supercharger', energy: 120.5, cost: 12.34, perKwh: 0.3, ...overrides };
}

function renderRow(props: {
  energyTrend: EnergyTrendPoint[];
  chargerBreakdown: ChargerBreakdownEntry[];
  costByType: CostByTypeEntry[];
}) {
  return render(<ChartsRow {...props} />);
}

describe('ChartsRow — populated panels', () => {
  it('renders both panel headings with decorative, aria-hidden icons (a11y)', () => {
    renderRow({
      energyTrend: [trend()],
      chargerBreakdown: [breakdownEntry()],
      costByType: [cost()],
    });

    const trendHeading = screen.getByRole('heading', {
      level: 3,
      name: 'Energy & Cost Trend',
    });
    const breakdownHeading = screen.getByRole('heading', {
      level: 3,
      name: 'Charger Breakdown',
    });
    expect(trendHeading).toBeInTheDocument();
    expect(breakdownHeading).toBeInTheDocument();

    // The lucide icon is decorative — hidden from assistive tech so it never
    // pollutes the heading's accessible name.
    expect(trendHeading.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(
      breakdownHeading.querySelector('svg')?.getAttribute('aria-hidden'),
    ).toBe('true');

    // Fully populated → no empty-state placeholder anywhere.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('formats each cost-by-type row (kWh energy, "$… total", "$…/kWh")', () => {
    renderRow({
      energyTrend: [trend()],
      chargerBreakdown: [
        breakdownEntry({ name: 'Supercharger' }),
        breakdownEntry({ name: 'DC Fast', fill: '#00ff00' }),
      ],
      costByType: [
        cost({ name: 'Supercharger', energy: 120.5, cost: 12.34, perKwh: 0.3 }),
        cost({ name: 'DC Fast', energy: 45, cost: 8, perKwh: 0.18 }),
      ],
    });

    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('120.50 kWh')).toBeInTheDocument();
    expect(screen.getByText('$12.34 total')).toBeInTheDocument();
    expect(screen.getByText('$0.30/kWh')).toBeInTheDocument();

    expect(screen.getByText('DC Fast')).toBeInTheDocument();
    expect(screen.getByText('45.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('$8.00 total')).toBeInTheDocument();
    expect(screen.getByText('$0.18/kWh')).toBeInTheDocument();
  });
});

describe('ChartsRow — per-source empty states (never a blank panel)', () => {
  it('shows the trend empty-state but still renders the breakdown list', () => {
    renderRow({
      energyTrend: [],
      chargerBreakdown: [breakdownEntry()],
      costByType: [cost({ name: 'Home / AC' })],
    });

    // Exactly one placeholder — the energy trend — the breakdown is intact.
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(screen.getByText(TREND_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(BREAKDOWN_EMPTY)).toBeNull();

    // Breakdown list content is still present.
    expect(screen.getByText('Home / AC')).toBeInTheDocument();
  });

  it('shows the breakdown empty-state but still renders the trend chart panel', () => {
    renderRow({
      energyTrend: [trend()],
      chargerBreakdown: [],
      costByType: [],
    });

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(screen.getByText(BREAKDOWN_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(TREND_EMPTY)).toBeNull();
    // No cost row leaked through.
    expect(screen.queryByText(/total$/)).toBeNull();
  });

  it('shows BOTH empty-states when every data source is empty', () => {
    renderRow({ energyTrend: [], chargerBreakdown: [], costByType: [] });

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText(TREND_EMPTY)).toBeInTheDocument();
    expect(screen.getByText(BREAKDOWN_EMPTY)).toBeInTheDocument();
    // Headings always render, even with no data.
    expect(
      screen.getByRole('heading', { name: 'Energy & Cost Trend' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Charger Breakdown' }),
    ).toBeInTheDocument();
  });
});

describe('ChartsRow — null-safety (the bug this test guards)', () => {
  it('does not crash on `.map` / `.length` when array props are undefined', () => {
    // Pre-hardening the raw `chargerBreakdown.map(...)` / `costByType.map(...)`
    // threw a TypeError here; the `?? []` normalisation degrades to empty state.
    expect(() =>
      renderRow({
        energyTrend: undefined as unknown as EnergyTrendPoint[],
        chargerBreakdown: undefined as unknown as ChargerBreakdownEntry[],
        costByType: undefined as unknown as CostByTypeEntry[],
      }),
    ).not.toThrow();

    expect(screen.getByText(TREND_EMPTY)).toBeInTheDocument();
    expect(screen.getByText(BREAKDOWN_EMPTY)).toBeInTheDocument();
  });

  it('coerces undefined energy/cost/perKwh in a cost row to 0 (no NaN)', () => {
    const { container } = renderRow({
      energyTrend: [trend()],
      chargerBreakdown: [breakdownEntry()],
      costByType: [
        {
          name: 'Home / AC',
          energy: undefined,
          cost: undefined,
          perKwh: undefined,
        } as unknown as CostByTypeEntry,
      ],
    });

    expect(screen.getByText('Home / AC')).toBeInTheDocument();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.00 total')).toBeInTheDocument();
    expect(screen.getByText('$0.00/kWh')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
