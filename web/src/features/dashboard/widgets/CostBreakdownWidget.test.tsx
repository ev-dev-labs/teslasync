/**
 * CostBreakdownWidget — behaviour + hardening tests.
 *
 * CostBreakdownWidget is a dashboard tile that reads the EV cost/TCO breakdown
 * (`useCostBreakdown`) for a resolved vehicle (`vehicleId` prop → first vehicle
 * from `useVehicles` → 0) and renders one of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a `WidgetBigNumber` with the current month's EV cost,
 *                           the currency symbol, an optional "Saved … vs gas"
 *                           subtitle, and an optional "Saving" badge.
 *   - standard (cols > 1) → a donut chart (last 6 months), a ranked monthly list
 *                           (capped at 5), and a 3-up stat grid (total cost,
 *                           cost per user distance unit, lifetime gas savings).
 * The shell owns the loading skeleton, the error `QueryError`, and the freshness
 * / refresh affordance. The body is never a blank panel — an explicit
 * `EmptyState` stands in whenever there is no monthly breakdown.
 *
 * The exported `CostTooltip` (the Recharts tooltip content) is unit-tested
 * directly because jsdom has no layout, so a real hover never fires it.
 *
 * Data hooks are mocked at their module boundaries so every orchestration branch
 * is deterministic and the network is never touched. `useFormatting` is stubbed
 * with a deterministic `formatCurrency` (so currency assertions and the
 * cost-per-distance conversion are exact and inspectable), and `useUnits` is
 * stubbed so the km / mi distance branch can be flipped per-test.
 * `useThemeChartPalette` is stubbed (so no `ThemeProvider` is required) and
 * Recharts' `ResponsiveContainer` is given a concrete size so the donut actually
 * paints. `react-i18next` is echo-mocked (returns the English fallback, with
 * `{{var}}` interpolation); `useSettings` / `useTimezone` come from the global
 * stub in src/test-setup.ts. `matchMedia` reports reduced-motion so the
 * `AnimatedNumber` inside the compact big-number lands on its final value
 * synchronously.
 *
 * Facets covered:
 *   - CostTooltip: inactive / empty-payload → renders nothing; active → segment
 *     name, formatted currency (2 dp), and the dynamic colour swatch.
 *   - vehicle resolution: explicit prop wins → first vehicle → "0".
 *   - shell states: loading skeleton, error QueryError, and two empty paths
 *     (undefined data + empty monthly breakdown) — never a blank panel.
 *   - compact: current-month big number, savings subtitle + badge, and their
 *     suppression when there are no savings; empty state.
 *   - standard: title, donut (a11y role="img" label), ranked list, stat grid,
 *     the km cost-per-distance value, and the "—" placeholders when a metric
 *     is zero.
 *   - unit conversion: the mi branch multiplies cost/km by ~1.60934 and labels
 *     the stat "Cost / mi".
 *   - ranked list is capped at 5 rows (highest-value months win).
 *   - null-safety / hardening: null `ev_cost` → 0; multiple null months render
 *     as "—" without a duplicate-key React warning (the donut-key fix).
 *   - refresh wiring: the freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useAnalytics', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useCostBreakdown: vi.fn() };
});

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});

// useUnits stub — lets each test flip the display distance unit (km / mi).
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// useFormatting stub — a deterministic formatCurrency so currency assertions
// and the cost-per-distance conversion are exact and its arguments inspectable.
const money = vi.hoisted(() => ({
  formatCurrency: vi.fn(
    (amount: number, decimals = 2) => `$${Number(amount).toFixed(decimals)}`,
  ),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatCurrency: money.formatCurrency,
    formatEnergyCost: (kwh: number) => `$${kwh}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

// Charts: stub the theme palette (so no ThemeProvider is needed) and hand the
// donut a concrete size (jsdom reports 0×0) so it actually paints and the
// per-slice <Cell key> path is exercised.
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    useThemeChartPalette: () => ({
      primary: '#00b4d8',
      accent: '#e63946',
      series: ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6'],
      positive: '#22c55e',
      negative: '#ef4444',
      warning: '#f59e0b',
      neutral: '#94a3b8',
    }),
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 320, height: 160 }),
  };
});

// jsdom lacks matchMedia. Report reduced-motion so AnimatedNumber (inside the
// compact WidgetBigNumber) lands on its final value synchronously.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import CostBreakdownWidget, { CostTooltip } from './CostBreakdownWidget';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import type { CostBreakdown, MonthlyCostEntry } from '@/types/analytics';
import type { WidgetProps, WidgetSize } from './types';

const mockCost = vi.mocked(useCostBreakdown);
const mockVehicles = vi.mocked(useVehicles);
const mockUnits = vi.mocked(useUnits);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** `useVehicles()` stub — the widget only reads `.data[0].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

function makeEntry(over: Partial<MonthlyCostEntry> = {}): MonthlyCostEntry {
  return {
    month: '2025-01',
    ev_cost: 50,
    equiv_gas_cost: 120,
    cumulative_savings: 70,
    energy_wh: 10_000,
    ...over,
  };
}

function makeData(over: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    vehicle_id: 1,
    total_charging_cost: 240,
    total_wh: 0,
    total_sessions: 0,
    total_km: 0,
    first_date: '2025-01-01',
    last_date: '2025-03-31',
    equivalent_gas_cost: 0,
    total_savings: 180,
    monthly_savings: 30,
    cost_per_km_ev: 0.05,
    cost_per_km_ice: 0,
    maintenance_savings_estimate: 0,
    months_of_ownership: 0,
    gas_price: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 0,
    base_cost_per_kwh: 0,
    monthly_breakdown: [
      makeEntry({ month: '2025-01', ev_cost: 50 }),
      makeEntry({ month: '2025-02', ev_cost: 70 }),
      makeEntry({ month: '2025-03', ev_cost: 45 }),
    ],
    ...over,
  };
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 3 };

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CostBreakdownWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(vehicles([1]));
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } } as never);
  mockCost.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CostTooltip', () => {
  it('renders nothing when inactive or when the payload is empty', () => {
    const fc = vi.fn((a: number, d?: number) => `$${a.toFixed(d ?? 2)}`);
    const seg = { name: 'March', value: 42, color: '#ff0000' };

    const inactive = render(
      <CostTooltip active={false} payload={[{ payload: seg }]} formatCurrency={fc} />,
    );
    expect(inactive.container).toBeEmptyDOMElement();
    inactive.unmount();

    const noPayload = render(<CostTooltip active payload={undefined} formatCurrency={fc} />);
    expect(noPayload.container).toBeEmptyDOMElement();
    expect(fc).not.toHaveBeenCalled();
  });

  it('renders the segment name, formatted value (2 dp), and the colour swatch when active', () => {
    const fc = vi.fn((a: number, d?: number) => `$${a.toFixed(d ?? 2)}`);
    const seg = { name: 'March', value: 42, color: '#ff0000' };

    const { container } = render(
      <CostTooltip active payload={[{ payload: seg }]} formatCurrency={fc} />,
    );

    expect(screen.getByText('March')).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
    expect(fc).toHaveBeenCalledWith(42, 2);

    // The swatch colour is a dynamic per-slice value (jsdom normalises the hex).
    const swatch = container.querySelector('span[style]') as HTMLElement | null;
    expect(swatch?.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });
});

describe('CostBreakdownWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD, { vehicleId: 42 });

    expect(mockCost).toHaveBeenCalledWith('42');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD);

    expect(mockCost).toHaveBeenCalledWith('7');
  });

  it('falls back to "0" when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget(STANDARD);

    expect(mockCost).toHaveBeenCalledWith('0');
  });
});

describe('CostBreakdownWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no content while loading', () => {
    mockCost.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Cost Breakdown')).toBeNull();
    expect(screen.queryByText('No cost data')).toBeNull();
  });

  it('renders a QueryError (not an empty state) when the fetch fails', () => {
    mockCost.mockReturnValue(
      qr({ isError: true, error: new Error('tco down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No cost data')).toBeNull();
  });

  it('renders an explicit empty state when the query resolves to undefined data', () => {
    mockCost.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    expect(screen.getByText('No cost data')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the empty state when the monthly breakdown is empty', () => {
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: [] }) }));
    renderWidget(STANDARD);

    expect(screen.getByText('No cost data')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('CostBreakdownWidget — compact layout', () => {
  it('shows the current-month cost, savings subtitle, and "Saving" badge', () => {
    renderWidget(COMPACT);

    // Current month = last breakdown entry (2025-03, ev_cost 45).
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    // monthly_savings 30 → subtitle; total_savings 180 → badge.
    expect(screen.getByText('Saved $30.00 vs gas')).toBeInTheDocument();
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('suppresses the subtitle and badge when there are no savings', () => {
    mockCost.mockReturnValue(
      qr({ data: makeData({ monthly_savings: 0, total_savings: 0 }) }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.queryByText(/Saved/)).toBeNull();
    expect(screen.queryByText('Saving')).toBeNull();
  });

  it('renders an explicit empty state (compact) when there is no breakdown', () => {
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: [] }) }));
    renderWidget(COMPACT);

    expect(screen.getByText('No cost data')).toBeInTheDocument();
    expect(screen.queryByText('This Month')).toBeNull();
  });
});

describe('CostBreakdownWidget — standard layout', () => {
  it('renders the title, the labelled donut, the ranked list, and the stat grid', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Cost Breakdown')).toBeInTheDocument();

    // Donut carries an accessible label (icon-only visual otherwise).
    expect(
      screen.getByRole('img', { name: 'Monthly EV charging cost breakdown' }),
    ).toBeInTheDocument();

    // Ranked list: one row per month with its formatted cost.
    expect(screen.getByText('2025-02')).toBeInTheDocument();
    expect(screen.getByText('$70.00')).toBeInTheDocument();

    // Stat grid.
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$240.00')).toBeInTheDocument();
    expect(screen.getByText('Gas Savings')).toBeInTheDocument();
    expect(screen.getByText('$180.00')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });

  it('shows the cost per kilometre when the distance preference is metric', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / km')).toBeInTheDocument();
    // cost_per_km_ev 0.05, no conversion for km → formatCurrency(0.05, 3).
    expect(money.formatCurrency).toHaveBeenCalledWith(0.05, 3);
    expect(screen.getByText('$0.050')).toBeInTheDocument();
  });

  it('converts cost/km to cost/mi and labels the stat "Cost / mi" for imperial users', () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / mi')).toBeInTheDocument();
    // 0.05 $/km × 1.60934 km/mi ≈ 0.0804670 $/mi → "$0.080" at 3 dp.
    const [amount, decimals] = money.formatCurrency.mock.calls.find((c) => c[1] === 3) ?? [];
    expect(amount).toBeCloseTo(0.0804670, 6);
    expect(decimals).toBe(3);
    expect(screen.getByText('$0.080')).toBeInTheDocument();
  });

  it('renders "—" for cost/distance and gas savings when those metrics are zero', () => {
    mockCost.mockReturnValue(
      qr({ data: makeData({ cost_per_km_ev: 0, total_savings: 0 }) }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / km')).toBeInTheDocument();
    expect(screen.getByText('Gas Savings')).toBeInTheDocument();
    // Two placeholders — one per zeroed stat — never a bare/blank value.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Lifetime')).toBeNull();
  });

  it('caps the ranked monthly list at five rows (highest-value months win)', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      makeEntry({ month: `2025-0${i + 1}`, ev_cost: (i + 1) * 10 }),
    );
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: many }) }));
    renderWidget(STANDARD);

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    // Top five by value are 70…30; the two lowest months are dropped.
    expect(screen.getByText('2025-07')).toBeInTheDocument();
    expect(screen.queryByText('2025-01')).toBeNull();
    expect(screen.queryByText('2025-02')).toBeNull();
  });
});

describe('CostBreakdownWidget — null-safety & hardening', () => {
  it('treats a null current-month cost as 0 (compact big number)', () => {
    mockCost.mockReturnValue(
      qr({
        data: makeData({
          total_savings: 0,
          monthly_savings: 0,
          monthly_breakdown: [
            makeEntry({ month: '2025-01', ev_cost: null as unknown as number }),
          ],
        }),
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
  });

  it('renders multiple null months as "—" with no duplicate-key React warning', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCost.mockReturnValue(
      qr({
        data: makeData({
          monthly_breakdown: [
            makeEntry({ month: null as unknown as string, ev_cost: 30 }),
            makeEntry({ month: null as unknown as string, ev_cost: 20 }),
          ],
        }),
      }),
    );
    renderWidget(STANDARD);

    // Both null months surface as "—" in the ranked list (no crash, no blank).
    expect(screen.getByText('Cost Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);

    // The donut-key fix keeps every <Cell key> unique even when names collide.
    const dupKeyWarned = errSpy.mock.calls.some((args) =>
      args.some(
        (a) => typeof a === 'string' && /two children with the same key/i.test(a),
      ),
    );
    expect(dupKeyWarned).toBe(false);
    errSpy.mockRestore();
  });
});

describe('CostBreakdownWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockCost.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
