import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { CostBreakdown } from '@/types/analytics';

const h = vi.hoisted(() => ({
  query: undefined as unknown,
  distance: 'km' as 'km' | 'mi',
  gasUnit: 'gallon' as 'gallon' | 'liter',
  vehicleId: 7 as number | null,
  hookIds: [] as string[],
}));

const refetch = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let text = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          text = arg2;
          options = typeof arg3 === 'object' && arg3
            ? arg3 as Record<string, unknown>
            : undefined;
        } else if (typeof arg2 === 'object' && arg2) {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') text = options.defaultValue;
        }
        return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, keyName: string) =>
          options?.[keyName] != null ? String(options[keyName]) : '');
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useAnalytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnalytics')>();
  return {
    ...actual,
    useCostBreakdown: (vehicleId: string) => {
      h.hookIds.push(vehicleId);
      return h.query;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      gas_unit: h.gasUnit,
      unit_of_length: h.distance,
      decimal_precision: 2,
    },
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.distance,
      speed: h.distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
    formatDistance: (meters: number | null | undefined) => {
      if (meters == null) return '—';
      const value = h.distance === 'mi' ? meters / 1609.344 : meters / 1000;
      return `${value.toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} ${h.distance}`;
    },
    formatEnergy: (wh: number | null | undefined) =>
      wh == null ? '—' : `${(wh / 1000).toFixed(1)} kWh`,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, precision = 2) =>
      `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })}`,
  }),
}));

vi.mock('@/components/ai/AITCONarration', () => ({
  AITCONarration: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-tco-narration" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

import TrueCostPage from './TrueCostPage';

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
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function query(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    isFetching: false,
    fetchStatus: 'idle',
    isStale: false,
    dataUpdatedAt: 0,
    refetch,
    ...overrides,
  };
}

function cost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    vehicle_id: 7,
    total_charging_cost: 100,
    total_wh: 100_000,
    total_sessions: 8,
    total_km: 1000,
    first_date: '2025-01-01',
    last_date: '2025-10-01',
    equivalent_gas_cost: 300,
    total_savings: 200,
    monthly_savings: 20,
    cost_per_km_ev: 0.1,
    cost_per_km_ice: 0.3,
    maintenance_savings_estimate: 500,
    months_of_ownership: 10,
    gas_price: 4,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 30,
    base_cost_per_kwh: 0.15,
    monthly_breakdown: [
      {
        month: '2025-01',
        ev_cost: 40,
        equiv_gas_cost: 120,
        savings: 80,
        cumulative_savings: 80,
        energy_wh: 40_000,
      },
      {
        month: '2025-03',
        ev_cost: 60,
        equiv_gas_cost: 180,
        savings: 120,
        cumulative_savings: 200,
        energy_wh: 60_000,
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/tco']}>
        <ToastProvider>
          <TrueCostPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SECTION_IDS = [
  'tco-evidence-kpis',
  'tco-source-scope',
  'tco-boundary',
  'tco-savings-envelope',
  'tco-cumulative-delta',
  'tco-monthly-cost-comparison',
  'tco-monthly-fuel-delta',
  'tco-energy-cost-trend',
  'tco-cost-per-distance',
  'tco-monthly-directory',
  'tco-assumptions',
  'tco-temporal-coverage',
  'tco-break-even',
  'tco-sensitivity',
  'tco-accounting',
  'tco-methodology',
] as const;

function expectPersistentShells() {
  SECTION_IDS.forEach((id) => {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  });
  expect(screen.getByTestId('tco-ai-slot')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hookIds.length = 0;
  h.distance = 'km';
  h.gasUnit = 'gallon';
  h.vehicleId = 7;
  h.query = query({
    data: cost(),
    isSuccess: true,
    dataUpdatedAt: Date.now(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrueCostPage persistent query states', () => {
  it('renders all 16 evidence sections, the AI slot, and exact vehicle hook scope', () => {
    renderPage();

    expectPersistentShells();
    expect(h.hookIds).toEqual(['7']);
    expect(screen.getByTestId('ai-tco-narration')).toHaveAttribute('data-vehicle-id', '7');
    expect(screen.getByText('GET /analytics/tco?vehicle_id=…')).toBeInTheDocument();
  });

  it('keeps every shell mounted with no selected vehicle and passes an empty hook ID', () => {
    h.vehicleId = null;
    h.query = query({ data: cost(), isSuccess: true });

    renderPage();

    expectPersistentShells();
    expect(h.hookIds).toEqual(['']);
    expect(screen.getAllByText(/Select a vehicle/i).length).toBeGreaterThan(5);
    expect(screen.queryByRole('button', { name: /Refresh/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Export chart' })).toHaveLength(0);
  });

  it('keeps every shell mounted during initial loading', () => {
    h.query = query({
      isLoading: true,
      isPending: true,
      isFetching: true,
      fetchStatus: 'fetching',
    });
    const { container } = renderPage();

    expectPersistentShells();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
    expect(screen.queryAllByRole('button', { name: 'Export chart' })).toHaveLength(0);
  });

  it('distinguishes an initially paused query from an empty response', () => {
    h.query = query({ isPending: true, fetchStatus: 'paused' });
    renderPage();

    expectPersistentShells();
    expect(screen.getAllByText(/initial query is paused|Initial loading is paused/i).length)
      .toBeGreaterThan(1);
    expect(screen.queryByText(/valid zero envelope/i)).not.toBeInTheDocument();
  });

  it('surfaces the initial error and wires retry while preserving every shell', () => {
    h.query = query({ isError: true, error: new Error('boom') });
    renderPage();

    expectPersistentShells();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps cached evidence visible through a refresh error', () => {
    h.query = query({
      data: cost(),
      isSuccess: true,
      isError: true,
      error: new Error('refresh failed'),
      dataUpdatedAt: Date.now(),
    });
    renderPage();

    expectPersistentShells();
    expect(screen.getByText(/most recently loaded evidence remains visible/i)).toBeInTheDocument();
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
  });

  it('keeps cached evidence visible through a paused refresh', () => {
    h.query = query({
      data: cost(),
      isSuccess: true,
      fetchStatus: 'paused',
      dataUpdatedAt: Date.now(),
    });
    renderPage();

    expectPersistentShells();
    expect(screen.getByText(/Cached evidence remains visible while its refresh is paused/i))
      .toBeInTheDocument();
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
  });

  it('marks cached refreshing without hiding evidence', () => {
    h.query = query({
      data: cost(),
      isSuccess: true,
      isFetching: true,
      fetchStatus: 'fetching',
      dataUpdatedAt: Date.now(),
    });
    renderPage();

    expectPersistentShells();
    expect(screen.getByText(/refresh is in progress/i)).toBeInTheDocument();
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
  });
});

describe('TrueCostPage evidence rendering', () => {
  it('withholds the synthetic $50 maintenance floor for a resolved zero envelope', () => {
    h.query = query({
      data: cost({
        total_charging_cost: 0,
        total_wh: 0,
        total_sessions: 0,
        total_km: 0,
        first_date: '',
        last_date: '',
        equivalent_gas_cost: 0,
        total_savings: 0,
        monthly_savings: 0,
        cost_per_km_ev: 0,
        cost_per_km_ice: 0,
        maintenance_savings_estimate: 50,
        months_of_ownership: 1,
        monthly_breakdown: [],
      }),
      isSuccess: true,
    });
    renderPage();

    expectPersistentShells();
    expect(screen.getByText(/valid zero envelope/i)).toBeInTheDocument();
    expect(screen.queryByText('$50.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+?\$50\.\d+$/)).not.toBeInTheDocument();
    expect(screen.getByText('Withheld')).toBeInTheDocument();
  });

  it('renders partial monthly rows with field-specific support and no fabricated chart rows', () => {
    const partial = {
      month: '2025-04',
      ev_cost: 10,
      equiv_gas_cost: Number.NaN,
      savings: Number.NaN,
      cumulative_savings: Number.NaN,
      energy_wh: 20_000,
    };
    h.query = query({
      data: cost({ monthly_breakdown: [partial] }),
      isSuccess: true,
    });
    renderPage();

    expectPersistentShells();
    expect(screen.getByText('Eligible')).toBeInTheDocument();
    expect(screen.getAllByText(/No month has supported EV and modeled gas values/i))
      .toHaveLength(1);
    expect(screen.getAllByText(/No supported monthly fuel deltas/i)).toHaveLength(2);
  });

  it('shows a negative fuel delta as a loss rather than green success', () => {
    h.query = query({
      data: cost({
        total_charging_cost: 350,
        equivalent_gas_cost: 300,
        total_savings: -50,
        monthly_savings: -5,
      }),
      isSuccess: true,
    });
    renderPage();

    expect(screen.getAllByText('Loss').length).toBeGreaterThan(0);
    const lossValue = screen.getAllByText('-$50.00')
      .find((element) => element.classList.contains('text-rose-300'));
    expect(lossValue).toBeDefined();
    if (!lossValue) throw new Error('sign-aware loss value was not rendered');
    expect(lossValue).toHaveClass('text-rose-300');
    expect(lossValue).not.toHaveClass('text-emerald-300');
  });

  it('converts canonical distance and cost/km to metric display units', () => {
    renderPage();

    expect(screen.getByText('1,000.0 km')).toBeInTheDocument();
    expect(screen.getAllByText('$0.1000').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Cost per km' })).toBeInTheDocument();
  });

  it('converts canonical distance and cost/km to imperial display units', () => {
    h.distance = 'mi';
    renderPage();

    expect(screen.getByText('621.4 mi')).toBeInTheDocument();
    expect(screen.getAllByText('$0.1609').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Cost per mi' })).toBeInTheDocument();
  });

  it('labels configured gasoline prices per litre', () => {
    h.query = query({
      data: cost({ gas_unit: 'liter' }),
      isSuccess: true,
    });
    renderPage();

    expect(screen.getByText('$4.00/L')).toBeInTheDocument();
    expect(screen.queryByText('$4.00/gal')).not.toBeInTheDocument();
  });

  it('renders valid chart, directory, accounting, and scenario evidence with exports enabled', () => {
    renderPage();

    expect(screen.getAllByRole('button', { name: 'Export chart' })).toHaveLength(5);
    expect(screen.getAllByText('Jan 2025').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Balances').length).toBeGreaterThan(5);
    expect(screen.getByText('1.0× MPG')).toBeInTheDocument();
    expect(screen.getAllByText(/Gas \$300\.00/).length).toBeGreaterThan(0);
  });

  it('states endpoint assumptions without claiming a complete ownership calculation', () => {
    renderPage();

    expect(screen.getByText(/not a complete ownership-cost calculation/i)).toBeInTheDocument();
    expect(screen.getByText(/Lifetime gasoline equivalent is distance-derived/i)).toBeInTheDocument();
    expect(screen.getByText(/Only monthly gasoline equivalents are energy-derived/i)).toBeInTheDocument();
    expect(screen.queryByText(/Total Cost of Ownership/i)).not.toBeInTheDocument();
  });
});
