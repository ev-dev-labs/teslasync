/**
 * TrueCostPage — behaviour + hardening coverage.
 *
 * TrueCostPage has a single default export (the page component). Its
 * visual sections (KPI band, cumulative-savings area chart, savings
 * breakdown, cost-per-km bar chart + chips, monthly EV-vs-gas bar
 * chart) are all file-local JSX and are exercised transitively through
 * the page render.
 *
 * What is covered:
 *   1. READY   — KPI band, savings breakdown, cost-per-km chips, and all
 *      three chart figures render the deterministic values (km-identity
 *      distance path) and the opt-in AI narrator receives the selected
 *      vehicle id.
 *   2. UNITS   — flipping the distance preference to miles actually
 *      re-converts the SI (`total_km`) value at the render boundary,
 *      proving the `convertDistanceFromSI` wiring rather than a static
 *      string.
 *   3. LOADING — every panel shows a skeleton and no ready values leak.
 *   4. ERROR   — every panel surfaces `QueryError` and the Retry action
 *      is wired to the query's `refetch` (failure + interaction path).
 *   5. EMPTY   — each section shows its own EmptyState (never a blank
 *      panel) when the query resolves with no data.
 *   6. PARTIAL — scalar totals present but an empty `monthly_breakdown`
 *      still yields the per-chart "no monthly data" placeholder.
 *   7. DATE FIX — blank `first_date` / `last_date` render an em dash
 *      (regression guard for the empty-string date-range bug).
 *   8. GAS UNIT — the `liter` preference labels the gas price "/L".
 *
 * Network is never hit: the data hook + unit/format/settings hooks are
 * stubbed, and the AI narration surface (which has its own suite and is
 * gated by withAiFeature) is isolated. i18n is stubbed so visible copy
 * is the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type { CostBreakdown } from '@/types/analytics';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `query` feeds the stubbed useCostBreakdown; `unit` feeds useUnits so a
// single test can flip km→mi; `settings` feeds useSettings so the gas
// unit branch is switchable; `selected` feeds useSelectedVehicle.
const h = vi.hoisted(() => ({
  query: undefined as unknown,
  unit: { distance: 'km' } as { distance: string },
  settings: { gas_unit: 'gallon' } as { gas_unit: string },
  selected: { vehicleId: 7 as number | null, vehicles: [] as unknown[] },
}));

const refetchMock = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useAnalytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useCostBreakdown: () => h.query };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.selected.vehicleId,
    vehicle: null,
    vehicles: h.selected.vehicles,
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.unit.distance,
      speed: h.unit.distance === 'mi' ? 'mph' : 'km/h',
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
    formatTemperature: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: (kwh: number) => `$${kwh}`,
    formatCurrency: (amount: number, decimals = 2) =>
      `$${Number(amount ?? 0).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: h.settings }),
}));

// The TCO AI narrator has its own AI-off contract suite and is gated by
// withAiFeature; stub it so this page's test stays deterministic and
// network-free while still asserting the page threads the vehicle id.
vi.mock('@/components/ai/AITCONarration', () => ({
  AITCONarration: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-tco-narration" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

import TrueCostPage from './TrueCostPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

interface QueryStub {
  data: CostBreakdown | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchMock,
    ...overrides,
  };
}

function makeCost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    total_charging_cost: 123.45,
    total_wh: 50000,
    total_sessions: 42,
    total_km: 1000,
    first_date: '2024-01-01',
    last_date: '2024-12-31',
    equivalent_gas_cost: 456.78,
    total_savings: 333.33,
    monthly_savings: 27.5,
    cost_per_km_ev: 0.042,
    cost_per_km_ice: 0.135,
    maintenance_savings_estimate: 200,
    months_of_ownership: 12,
    gas_price: 3.5,
    gas_efficiency_mpg: 25,
    monthly_breakdown: [
      { month: 'Jan', ev_cost: 10, equiv_gas_cost: 40, cumulative_savings: 30, energy_wh: 4000 },
      { month: 'Feb', ev_cost: 12, equiv_gas_cost: 44, cumulative_savings: 62, energy_wh: 4200 },
    ],
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/analytics/tco']}>
        <ToastProvider>
          <TrueCostPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.unit.distance = 'km';
  h.settings.gas_unit = 'gallon';
  h.selected.vehicleId = 7;
  h.selected.vehicles = [];
  h.query = makeQuery({ data: makeCost() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrueCostPage', () => {
  it('renders the full TCO dashboard with km-identity values when data is ready', () => {
    renderPage();

    // Page shell.
    expect(
      screen.getByRole('heading', { level: 1, name: /Total Cost of Ownership/i }),
    ).toBeInTheDocument();

    // KPI band — four metric cards with formatted currency + subtitles.
    expect(screen.getByText('$123.45')).toBeInTheDocument(); // total EV cost
    expect(screen.getByText('$456.78')).toBeInTheDocument(); // equivalent gas cost
    expect(screen.getByText('$27.50')).toBeInTheDocument(); // monthly savings
    expect(screen.getByText(/50000 · 42 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/\$3\.50\/gal/)).toBeInTheDocument(); // gallon branch
    expect(screen.getByText(/Over 12\.00 months/)).toBeInTheDocument();

    // Savings breakdown — total savings appears in both the KPI band and
    // the breakdown card; maintenance + total-estimated are unique.
    expect(screen.getAllByText('$333.33')).toHaveLength(2);
    expect(screen.getByText('$200.00')).toBeInTheDocument(); // maintenance est.
    expect(screen.getByText('$533.33')).toBeInTheDocument(); // total estimated

    // Distance summary uses the km-identity conversion + real dates.
    const distanceLine = screen.getByText(/1,000 km/);
    expect(distanceLine.textContent).toContain('2024-01-01');
    expect(distanceLine.textContent).toContain('2024-12-31');

    // Cost-per-km chips render the Currency component at 3dp precision.
    expect(screen.getByText('$0.042')).toBeInTheDocument();
    expect(screen.getByText('$0.135')).toBeInTheDocument();

    // Every chart figure exposes its title + accessible name.
    expect(screen.getByRole('heading', { name: /Cumulative Savings Over Time/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cost per Kilometer/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Monthly EV vs Gas Cost/i })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Cumulative EV-vs-gas savings area chart/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Cost per kilometer bar chart/i }),
    ).toBeInTheDocument();

    // a11y landmark for the KPI band + isolated AI slot threaded with the
    // selected vehicle id.
    expect(screen.getByRole('region', { name: /Cost summary/i })).toBeInTheDocument();
    expect(screen.getByTestId('ai-tco-narration')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('re-converts the SI distance to the user mi preference at the render boundary', () => {
    h.unit.distance = 'mi';
    // 1000 km → 1,000,000 m → 621.371… mi → fmtInt → "621".
    h.query = makeQuery({ data: makeCost({ total_km: 1000 }) });

    renderPage();

    const distanceLine = screen.getByText(/621 mi/);
    expect(distanceLine.textContent).toContain('2024-01-01');
    // The km-identity value must NOT appear once the preference is miles.
    expect(screen.queryByText(/1,000 km/)).not.toBeInTheDocument();
    // Currency figures are unit-independent and stay put.
    expect(screen.getByText('$123.45')).toBeInTheDocument();
  });

  it('shows skeletons in every panel while loading and leaks no ready values', () => {
    h.query = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Total Cost of Ownership/i }),
    ).toBeInTheDocument();
    // No resolved KPI / chip values.
    expect(screen.queryByText('$123.45')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.042')).not.toBeInTheDocument();
    // Skeletons render across the page (KPI band + charts + breakdown).
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(4);
    // The opt-in AI narrator is rendered outside the data gate.
    expect(screen.getByTestId('ai-tco-narration')).toBeInTheDocument();
  });

  it('surfaces QueryError in every panel and wires Retry to the query refetch', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 });

    renderPage();

    // One QueryError per data-bound section: KPI band, cumulative chart,
    // savings breakdown, cost-per-km chart, monthly chart.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(5);

    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons).toHaveLength(5);

    fireEvent.click(retryButtons[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState (never a blank panel) when the query resolves with no data', () => {
    h.query = makeQuery({ data: null });

    renderPage();

    // KPI band, savings breakdown, and cost-per-km chart share the
    // "start charging" copy; both time-series charts share the monthly one.
    expect(screen.getAllByText(/No data available\. Start charging/i)).toHaveLength(3);
    expect(screen.getAllByText(/No monthly data available yet/i)).toHaveLength(2);
    // Cost-per-km chips fall back to an em dash rather than "$NaN".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // The KPI landmark still renders (shell is never hidden).
    expect(screen.getByRole('region', { name: /Cost summary/i })).toBeInTheDocument();
  });

  it('keeps the KPI band but shows the monthly empty-state when there is no monthly breakdown', () => {
    h.query = makeQuery({ data: makeCost({ monthly_breakdown: [] }) });

    renderPage();

    // Scalar KPIs still render from the resolved totals.
    expect(screen.getByText('$123.45')).toBeInTheDocument();
    expect(screen.getByText('$0.042')).toBeInTheDocument();
    // Both time-series charts degrade to the monthly empty-state.
    expect(screen.getAllByText(/No monthly data available yet/i)).toHaveLength(2);
    // ...but the "start charging" whole-page empty copy must NOT appear.
    expect(screen.queryByText(/No data available\. Start charging/i)).not.toBeInTheDocument();
  });

  it('renders an em dash for blank first/last dates instead of an empty gap', () => {
    // The API returns "" (not null) for the date range before any charging
    // history exists — a nullish-only guard would leak a blank gap.
    h.query = makeQuery({ data: makeCost({ first_date: '', last_date: '' }) });

    renderPage();

    const distanceLine = screen.getByText(/1,000 km/);
    expect(distanceLine.textContent).toContain('— → —');
    expect(distanceLine.textContent).not.toContain('2024');
  });

  it('labels the gas price per litre when the gas unit preference is liter', () => {
    h.settings.gas_unit = 'liter';
    h.query = makeQuery({ data: makeCost({ gas_price: 3.5 }) });

    renderPage();

    expect(screen.getByText(/\$3\.50\/L\b/)).toBeInTheDocument();
    // The gallon label must NOT appear when the preference is litres.
    expect(screen.queryByText(/\$3\.50\/gal/)).not.toBeInTheDocument();
  });
});
