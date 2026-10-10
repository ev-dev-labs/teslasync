/**
 * CostBreakdownWidget — behaviour + hardening tests.
 *
 * CostBreakdownWidget is a dashboard tile that reads the EV cost/TCO breakdown
 * (`useCostBreakdown`) for a resolved vehicle (`vehicleId` prop → first vehicle
 * from `useVehicles`, otherwise disabled) and renders two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a formatted latest-month EV cost (or aggregate cost),
 *                           a labelled monthly savings estimate and Saving badge.
 *   - standard (cols > 1) → a donut chart (last 6 months), a ranked monthly list
 *                           (capped at 5), and a 3-up stat grid (total cost,
 *                           cost per user distance unit, lifetime gas savings).
 * The shell owns initial loading/error and retained refresh failures. Aggregate
 * stats remain visible independently of the chart and ranked list's empty states.
 *
 * The chart's shared tooltip is captured and exercised because jsdom cannot hover.
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
 *     the km cost-per-distance value, measured zeros, and unknown placeholders.
 *   - unit conversion: the mi branch multiplies cost/km by ~1.60934 and labels
 *     the stat "Cost / mi".
 *   - ranked list is capped at 5 rows (highest-value months win).
 *   - null-safety / hardening: null `ev_cost` stays unknown; null months render
 *     as "—" without a duplicate-key React warning (the donut-key fix).
 *   - refresh wiring: the freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

interface TooltipInput {
  active?: boolean;
  payload?: Array<{ name: string; value: unknown; color?: string }>;
}
const tooltipState = vi.hoisted<{ content?: React.ReactElement<TooltipInput> }>(() => ({}));

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
    currencySymbol: '$',
    costPerKwh: 0.12,
    formatCurrency: money.formatCurrency,
    formatEnergyCost: (kwh: number) => `$${kwh}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

// Chart doubles expose the real derived data without relying on jsdom layout.
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ChartTooltip: actual.ChartTooltip,
    Tooltip: ({ content }: { content?: React.ReactElement<TooltipInput> }) => {
      tooltipState.content = content;
      return null;
    },
    PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Pie: ({ data, children }: { data?: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="cost-pie" data-json={JSON.stringify(data)}>{children}</div>
    ),
    BarChart: ({ data, children }: { data?: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="cost-bars" data-json={JSON.stringify(data)}>{children}</div>
    ),
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    useThemeChartPalette: () => ({
      primary: '#00b4d8',
      accent: '#e63946',
      series: ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6'],
      positive: '#22c55e',
      negative: '#ef4444',
      warning: '#f59e0b',
      neutral: '#94a3b8',
    }),
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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

import CostBreakdownWidget from './CostBreakdownWidget';
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
    savings: 70,
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

it('reviews actual cost quantities and the original tariff conversion without hiding monthly detail', () => {
  mockCost.mockReturnValue(qr({ data: makeData(), isError: true, error: new Error('refresh failed') }));
  renderWidget(STANDARD, { vehicleId: 42 });
  const brief = screen.getByTestId('cost-breakdown-operational-brief');
  expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog');
  expect(within(drawer).getByText('$240.00')).toBeInTheDocument();
  expect(within(drawer).getByText('$0.05')).toBeInTheDocument();
  expect(within(drawer).getByText('$180.00')).toBeInTheDocument();
  expect(within(drawer).getByText(/not independently measured savings/)).toBeInTheDocument();
  expect(within(drawer).getByText(/^Vehicle 42;/)).toBeInTheDocument();
});

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
  tooltipState.content = undefined;
  mockVehicles.mockReturnValue(vehicles([1]));
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } } as never);
  mockCost.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function captureTooltip() {
  const widget = renderWidget(STANDARD);
  const content = tooltipState.content;
  widget.unmount();
  money.formatCurrency.mockClear();
  if (!content) throw new Error('Cost chart did not mount its shared tooltip');
  return content;
}

describe('CostBreakdownWidget — shared tooltip', () => {
  it('renders nothing when inactive or when the payload is empty', () => {
    const content = captureTooltip();
    const seg = { name: 'March', value: 42, color: '#ff0000' };

    const inactive = render(
      React.cloneElement(content, { active: false, payload: [seg] }),
    );
    expect(inactive.container).toBeEmptyDOMElement();
    inactive.unmount();

    const noPayload = render(React.cloneElement(content, { active: true, payload: undefined }));
    expect(noPayload.container).toBeEmptyDOMElement();
    expect(money.formatCurrency).not.toHaveBeenCalled();
  });

  it('renders the segment name, formatted value (2 dp), and the colour swatch when active', () => {
    const content = captureTooltip();
    const seg = { name: 'March', value: 42, color: '#ff0000' };

    const { container } = render(
      React.cloneElement(content, { active: true, payload: [seg] }),
    );

    expect(screen.getByText('March:')).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
    expect(money.formatCurrency).toHaveBeenCalledWith(42, undefined);

    // The swatch colour is a dynamic per-slice value (jsdom normalises the hex).
    const swatch = container.querySelector('span[style]') as HTMLElement | null;
    expect(swatch?.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('formats an unknown tooltip reading as unknown, not zero', () => {
    const content = captureTooltip();
    render(React.cloneElement(content, { active: true, payload: [{ name: 'Unknown', value: null }] }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('—');
    expect(money.formatCurrency).not.toHaveBeenCalled();
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

  it('disables the hook when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget(STANDARD);

    expect(mockCost).toHaveBeenCalledWith('');
  });
});

describe('CostBreakdownWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no content while loading', () => {
    mockCost.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Cost breakdown')).toBeInTheDocument();
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

    expect(screen.getAllByText('No cost data')).toHaveLength(2);
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByText('Total cost')).toBeInTheDocument();
  });

  it('renders the empty state when the monthly breakdown is empty', () => {
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: [] }) }));
    renderWidget(STANDARD);

    expect(screen.getAllByText('No cost data')).toHaveLength(2);
    expect(screen.getByText('$240.00')).toBeInTheDocument();
    expect(screen.getByText('$180.00')).toBeInTheDocument();
  });
});

describe('CostBreakdownWidget — compact layout', () => {
  it('shows the current-month cost, savings subtitle, and "Saving" badge', () => {
    renderWidget(COMPACT);

    const heading = screen.getByRole('heading', { name: 'Cost breakdown', level: 3 });
    expect(heading).toBeVisible();
    expect(heading.parentElement?.querySelector('svg.lucide-pie-chart')).toBeInTheDocument();
    // Current month = last breakdown entry (2025-03, ev_cost 45).
    expect(screen.getByText('$45.00')).toBeInTheDocument();
    expect(screen.getByText('Latest recorded month')).toBeInTheDocument();
    // monthly_savings 30 → subtitle; total_savings 180 → badge.
    expect(screen.getByText('Monthly savings estimate vs gas: $30.00')).toBeInTheDocument();
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('preserves a measured zero savings estimate without a Saving badge', () => {
    mockCost.mockReturnValue(
      qr({ data: makeData({ monthly_savings: 0, total_savings: 0 }) }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('$45.00')).toBeInTheDocument();
    expect(screen.getByText('Monthly savings estimate vs gas: $0.00')).toBeInTheDocument();
    expect(screen.queryByText('Saving')).toBeNull();
  });

  it('retains known aggregate cost in compact mode when monthly rows are absent', () => {
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: [] }) }));
    renderWidget(COMPACT);

    expect(screen.getByText('$240.00')).toBeInTheDocument();
    expect(screen.getByText('Total cost')).toBeInTheDocument();
  });
});

describe('CostBreakdownWidget — standard layout', () => {
  it('renders the title, the labelled donut, the ranked list, and the stat grid', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Cost breakdown')).toBeInTheDocument();

    // Donut carries an accessible label (icon-only visual otherwise).
    expect(
      screen.getByRole('img', { name: 'Monthly EV charging cost breakdown' }),
    ).toBeInTheDocument();

    // Ranked list: one row per month with its formatted cost.
    expect(screen.getByText('2025-02')).toBeInTheDocument();
    expect(screen.getByText('$70.00')).toBeInTheDocument();

    // Stat grid.
    expect(screen.getByText('Total cost')).toBeInTheDocument();
    expect(screen.getByText('$240.00')).toBeInTheDocument();
    expect(screen.getByText('Gas savings')).toBeInTheDocument();
    expect(screen.getByText('$180.00')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });

  it('shows the cost per kilometre when the distance preference is metric', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / km')).toBeInTheDocument();
    // Metric cost/distance stays unchanged before display formatting.
    expect(money.formatCurrency).toHaveBeenCalledWith(0.05, undefined);
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });

  it('converts cost/km to cost/mi and labels the stat "Cost / mi" for imperial users', () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / mi')).toBeInTheDocument();
    // 0.05 $/km × 1.609344 km/mi = 0.0804672 $/mi → "$0.08".
    expect(money.formatCurrency).toHaveBeenCalledWith(0.0804672, undefined);
    expect(screen.getByText('$0.08')).toBeInTheDocument();
  });

  it('preserves measured zero cost/distance and gas savings', () => {
    mockCost.mockReturnValue(
      qr({ data: makeData({ cost_per_km_ev: 0, total_savings: 0 }) }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Cost / km')).toBeInTheDocument();
    expect(screen.getByText('Gas savings')).toBeInTheDocument();
    expect(screen.getAllByText('$0.00')).toHaveLength(2);
    expect(screen.queryByText('—')).toBeNull();
  });

  it('caps the ranked monthly list at five rows (highest-value months win)', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      makeEntry({ month: `2025-0${i + 1}`, ev_cost: (i + 1) * 10 }),
    );
    mockCost.mockReturnValue(qr({ data: makeData({ monthly_breakdown: many }) }));
    renderWidget(STANDARD);

    const rankedList = screen.getByText('2025-07').closest('ul');
    if (!rankedList) throw new Error('Ranked monthly list did not mount');
    expect(within(rankedList).getAllByRole('listitem')).toHaveLength(5);
    // Top five by value are 70…30; the two lowest months are dropped.
    expect(screen.getByText('2025-07')).toBeInTheDocument();
    expect(screen.queryByText('2025-01')).toBeNull();
    expect(screen.queryByText('2025-02')).toBeNull();
  });
});

describe('CostBreakdownWidget — null-safety & hardening', () => {
  it('preserves an unknown latest-month cost rather than displaying zero', () => {
    mockCost.mockReturnValue(
      qr({
        data: {
          ...makeData(),
          total_savings: 0,
          monthly_savings: 0,
          monthly_breakdown: [
            { ...makeEntry(), month: '2025-01', ev_cost: null },
          ],
        },
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Latest recorded month')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('renders multiple null months as "—" with no duplicate-key React warning', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCost.mockReturnValue(
      qr({
        data: {
          ...makeData(),
          monthly_breakdown: [
            { ...makeEntry(), month: null, ev_cost: 30 },
            { ...makeEntry(), month: null, ev_cost: 20 },
          ],
        },
      }),
    );
    renderWidget(STANDARD);

    // Both null months surface as "—" in the ranked list (no crash, no blank).
    expect(screen.getByText('Cost breakdown')).toBeInTheDocument();
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

  describe('CostBreakdownWidget — preservation and data trust', () => {
    it.each([COMPACT, STANDARD, { cols: 4, rows: 4 }])('retains each renderer on cached refresh failure at %j', (size) => {
      mockCost.mockReturnValue(qr({ data: makeData(), isError: true, error: new Error('refresh failed') }));
      renderWidget(size);
      expect(screen.getByText(size.cols === 1 ? '$45.00' : '$240.00')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('preserves signed credits and negative gas savings without fabricating a donut allocation', () => {
      mockCost.mockReturnValue(qr({ data: makeData({
        total_savings: -25,
        monthly_breakdown: [makeEntry({ ev_cost: -5 }), makeEntry({ month: '2025-02', ev_cost: 0 })],
      }) }));
      renderWidget(STANDARD);
      expect(screen.getByText('$-25.00')).toBeInTheDocument();
      expect(screen.getByText('$-5.00')).toBeInTheDocument();
      expect(screen.getByText('$0.00')).toBeInTheDocument();
      expect(screen.getByTestId('cost-bars')).toHaveAttribute('data-json', expect.stringContaining('"value":-5'));
      expect(screen.queryByTestId('cost-pie')).not.toBeInTheDocument();
    });

    it('keeps all three aggregate sections and reports missing metrics as unknown', () => {
      mockCost.mockReturnValue(qr({ data: {
        ...makeData(), total_charging_cost: null, total_savings: null, cost_per_km_ev: null,
      } }));
      renderWidget(STANDARD);
      for (const label of ['Total cost', 'Cost / km', 'Gas savings']) expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getAllByText('—')).toHaveLength(3);
      expect(screen.getByText('$70.00')).toBeInTheDocument();
    });

    it('preserves unknown monthly rows without ranking them as zero-cost readings', () => {
      mockCost.mockReturnValue(qr({ data: {
        ...makeData(), monthly_breakdown: [
          { ...makeEntry(), month: 'Unmeasured', ev_cost: null },
          makeEntry({ month: 'Credit', ev_cost: -5 }),
        ],
      } }));
      renderWidget(STANDARD);
      const rankedList = screen.getByText('Credit').closest('ul');
      if (!rankedList) throw new Error('Ranked monthly list did not mount');
      expect(within(rankedList).getAllByRole('listitem')).toHaveLength(1);
      expect(within(rankedList).getByRole('listitem')).toHaveTextContent('Credit');
      expect(within(rankedList).getByRole('listitem')).not.toHaveTextContent('Unmeasured');
      expect(screen.getAllByText('Unmeasured').length).toBeGreaterThan(0);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('resolves configured vehicle scope before falling back to the vehicle list', () => {
      renderWidget(STANDARD, { config: { vehicleId: 19 } });
      expect(mockCost).toHaveBeenCalledWith('19');
    });

    it('surfaces unresolved vehicle discovery failures and retries discovery', () => {
      const refetch = vi.fn();
      mockVehicles.mockReturnValue(qr({ error: new Error('vehicles failed'), isError: true, refetch }));
      mockCost.mockReturnValue(qr());
      renderWidget(STANDARD);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('preserves all-zero monthly records as measured chart data', () => {
      mockCost.mockReturnValue(qr({ data: makeData({
        total_charging_cost: 0, total_savings: 0, cost_per_km_ev: 0,
        monthly_breakdown: [makeEntry({ ev_cost: 0 })],
      }) }));
      renderWidget(STANDARD);
      expect(screen.queryByText('No cost data')).not.toBeInTheDocument();
      expect(screen.getByTestId('cost-bars')).toHaveAttribute('data-json', expect.stringContaining('"value":0'));
      expect(screen.getAllByText('$0.00')).toHaveLength(4);
    });

    it('reports malformed monthly data without losing known aggregate values', () => {
      mockCost.mockReturnValue(qr({ data: { ...makeData(), monthly_breakdown: 'not-an-array' } }));
      renderWidget(STANDARD);
      expect(screen.getByText('$240.00')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.getAllByText('No cost data')).toHaveLength(2);
    });
  });
});

describe('CostBreakdownWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockCost.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
