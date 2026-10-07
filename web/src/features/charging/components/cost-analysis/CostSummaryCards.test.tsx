/**
 * CostSummaryCards — the Cost Analysis KPI band (six MetricCards).
 *
 * The component owns four mutually-exclusive states in strict priority order —
 * error > loading (with no stats yet) > empty (loaded, no sessions) > data —
 * plus the six formatted metric tiles. These tests assert the pieces the
 * component actually paints in jsdom:
 *   - the state machine and its priority ordering (error beats a stale
 *     coreStats + isLoading; loading only wins while coreStats is still null;
 *     a null coreStats after load degrades to an EmptyState, never six
 *     misleading "$0.00" tiles),
 *   - every tile's formatted value + subtitle (formatCurrency at 2/3 dp,
 *     fmtWithUnit kWh, gal-equiv, savings %, session count),
 *   - the distance-unit label branch (Mile vs km) and the gas-unit label
 *     branch (gal vs L, driven by settings.gas_unit),
 *   - a11y: every card/empty icon is decorative (aria-hidden) and the loading
 *     skeleton grid is hidden from assistive tech, and
 *   - hardening: undefined numeric fields and a non-finite gasPrice coerce to
 *     0 with no NaN reaching the DOM.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default
 * and the `{ unit, defaultValue }` interpolation form resolves to
 * "Cost Per Mile" / "Cost Per km" for exact copy assertions. `useOnlineStatus`
 * is pinned online so the error branch renders QueryError's network
 * `role="alert"` with an enabled Retry. `useSettings` is mocked at file level
 * (via a hoisted, mutable gas-unit ref) so the real `useFormatting` produces
 * deterministic currency strings without a QueryClientProvider.
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const tMock = (key: string, opts?: unknown): string => {
  if (typeof opts === 'string') return opts;
  if (opts && typeof opts === 'object') {
    const o = opts as Record<string, unknown>;
    let s = typeof o.defaultValue === 'string' ? o.defaultValue : key;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'defaultValue') continue;
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
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

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

// Mutable gas-unit ref so a single test can flip gallon → liter. `vi.hoisted`
// makes it available to the hoisted `vi.mock` factory below. The real
// `useFormatting` / `useUnits` (which import `./useSettings`) resolve to the
// same module id, so they observe this mock too.
const settingsRef = vi.hoisted(() => ({
  gasUnit: 'gallon' as 'gallon' | 'liter',
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      preferred_range: 'rated',
      language: 'en',
      base_cost_per_kwh: 0.12,
      api_suspended: false,
      theme: 'neon-cyan',
      mode: 'dark',
      custom_primary: '#00b4d8',
      custom_accent: '#e63946',
      gas_price_per_unit: 0,
      gas_unit: settingsRef.gasUnit,
      gas_efficiency_mpg: 25,
      decimal_precision: 2,
      currency_symbol: '$',
      locale: 'en-US',
      ui_density: 'comfortable',
    },
    isMiles: false,
    isFahrenheit: false,
    isPSI: false,
    decimals: 2,
    locale: 'en-US',
    density: 'comfortable' as const,
    rangeType: 'rated' as const,
  }),
}));

import { CostSummaryCards } from './CostSummaryCards';
import type { CoreStats } from './types';

const FULL_STATS: CoreStats = {
  totalCost: 123.45,
  totalEnergy: 250,
  avgCostPerKwh: 0.123,
  totalDuration: 600,
  totalDistanceM: 160934,
  costPerDist: 0.05,
  gasCost: 200,
  savings: 76.55,
  savingsPercent: 38.3,
  co2SavedKg: 50,
  treeEquiv: 2,
  gallonsEquiv: 7.5,
  count: 12,
};

type Props = ComponentProps<typeof CostSummaryCards>;

function renderCards(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    coreStats: FULL_STATS,
    gasPrice: 3.5,
    distanceUnit: 'mi',
    isMiles: true,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <CostSummaryCards {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

beforeEach(() => {
  settingsRef.gasUnit = 'gallon';
});

describe('CostSummaryCards — state priority', () => {
  it('renders the error panel (and no tiles/skeleton) even when stale stats + loading are present', () => {
    renderCards({
      error: new Error('boom'),
      coreStats: FULL_STATS,
      isLoading: true,
    });

    // Error beats every other branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();
    // No metric tile leaks through.
    expect(screen.queryByText('Total Cost')).toBeNull();
    expect(screen.queryByText('$123.45')).toBeNull();
  });

  it('renders the skeleton grid (aria-hidden, no tiles) while loading with no stats yet', () => {
    const { container } = renderCards({ coreStats: null, isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    const grid = container.querySelector('[aria-hidden="true"]');
    expect(grid).not.toBeNull();
    // Loading strictly precedes the empty / data branches.
    expect(screen.queryByText('Total Cost')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps rendering the tiles (stale-while-revalidate) when isLoading is true but stats exist', () => {
    const { container } = renderCards({ coreStats: FULL_STATS, isLoading: true });

    // A background refetch must NOT flash the skeleton over existing data.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$123.45')).toBeInTheDocument();
  });

  it('renders an EmptyState (never six $0.00 tiles) when loaded with null stats', () => {
    const { container } = renderCards({ coreStats: null, isLoading: false });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No cost data yet')).toBeInTheDocument();
    expect(screen.getByText(/no charging sessions in the selected range/i)).toBeInTheDocument();
    // No tiles, no skeleton.
    expect(screen.queryByText('Total Cost')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('CostSummaryCards — populated tiles', () => {
  it('renders all six tiles with correctly formatted values and subtitles', () => {
    renderCards({ coreStats: FULL_STATS, gasPrice: 3.5, isMiles: true, distanceUnit: 'mi' });

    // Total Cost — 2dp currency + session count.
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$123.45')).toBeInTheDocument();
    expect(screen.getByText('12 sessions')).toBeInTheDocument();

    // Avg $/kWh — 3dp currency.
    expect(screen.getByText('Avg $/kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.123')).toBeInTheDocument();

    // Cost Per Mile — 3dp currency + "per mi" subtitle.
    expect(screen.getByText('Cost Per Mile')).toBeInTheDocument();
    expect(screen.getByText('$0.050')).toBeInTheDocument();
    expect(screen.getByText('per mi')).toBeInTheDocument();

    // Total Energy — kWh value + gal-equiv subtitle.
    expect(screen.getByText('Total Energy')).toBeInTheDocument();
    expect(screen.getByText('250.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('7.5 gal equiv')).toBeInTheDocument();

    // Gas Savings — currency value + "vs $/gal" subtitle.
    expect(screen.getByText('Gas Savings $')).toBeInTheDocument();
    expect(screen.getByText('$76.55')).toBeInTheDocument();
    expect(screen.getByText('vs $3.50/gal')).toBeInTheDocument();

    // Savings % — 1dp percent.
    expect(screen.getByText('Savings %')).toBeInTheDocument();
    expect(screen.getByText('38.3%')).toBeInTheDocument();
  });

  it('switches the distance tile to the metric label + unit when isMiles is false', () => {
    renderCards({ coreStats: FULL_STATS, isMiles: false, distanceUnit: 'km' });

    expect(screen.getByText('Cost Per km')).toBeInTheDocument();
    expect(screen.getByText('per km')).toBeInTheDocument();
    // The mile variant must be gone.
    expect(screen.queryByText('Cost Per Mile')).toBeNull();
  });
});

describe('CostSummaryCards — gas-unit label branch', () => {
  it('shows /gal in the savings subtitle when gas_unit is gallon', () => {
    settingsRef.gasUnit = 'gallon';
    renderCards({ coreStats: FULL_STATS, gasPrice: 4 });

    expect(screen.getByText('vs $4.00/gal')).toBeInTheDocument();
    expect(screen.queryByText('vs $4.00/L')).toBeNull();
  });

  it('shows /L in the savings subtitle when gas_unit is liter', () => {
    settingsRef.gasUnit = 'liter';
    renderCards({ coreStats: FULL_STATS, gasPrice: 2 });

    expect(screen.getByText('vs $2.00/L')).toBeInTheDocument();
    expect(screen.queryByText('vs $2.00/gal')).toBeNull();
  });
});

describe('CostSummaryCards — error branch', () => {
  it('wires QueryError Retry to the onRetry callback', () => {
    const { onRetry } = renderCards({ coreStats: null, error: new Error('down') });

    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('CostSummaryCards — a11y', () => {
  it('marks every metric-tile icon as decorative (aria-hidden) so labels stay clean', () => {
    const { container } = renderCards({ coreStats: FULL_STATS });

    const icons = container.querySelectorAll('svg');
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]');
    // Six tiles → six icons, all hidden from assistive tech.
    expect(icons.length).toBe(6);
    expect(hidden.length).toBe(icons.length);
  });

  it('exposes the empty state as role=status with a decorative icon', () => {
    const { container } = renderCards({ coreStats: null });

    expect(screen.getByRole('status')).toBeInTheDocument();
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('CostSummaryCards — null-safety hardening', () => {
  it('coerces undefined numeric fields to 0 with no NaN reaching the DOM', () => {
    const partial = { count: 3 } as unknown as CoreStats;
    const { container } = renderCards({ coreStats: partial, gasPrice: 3.5 });

    // count survives; everything else degrades to a formatted zero.
    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0 gal equiv')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    // totalCost + savings both render "$0.00".
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a $0.00/unit gas subtitle (never $NaN) for a non-finite gasPrice', () => {
    const { container } = renderCards({
      coreStats: FULL_STATS,
      gasPrice: Number.NaN,
    });

    expect(screen.getByText('vs $0.00/gal')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
