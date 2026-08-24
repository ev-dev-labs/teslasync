/**
 * MaintenancePage — behaviour + hardening coverage.
 *
 * MaintenancePage has a single default export (the page component). Its
 * bento sections (KPI band, opt-in Helix advisor slot, items grid +
 * upcoming-projections panel, cost + category breakdown row, and the
 * service-records table) plus its file-local helpers (progress /
 * status derivation, sorting, cost stats) are all exercised through the
 * page render.
 *
 * What is covered:
 *   1. READY   — every panel renders its deterministic data: KPI counts
 *      from the raw status reduce, item cards, upcoming projections, the
 *      cost stats, the category breakdown, and the records table. The
 *      opt-in AI narrator receives the selected vehicle id.
 *   2. UNITS   — flipping the distance preference to miles re-converts the
 *      SI (`current_mileage` metres) value at the render boundary, proving
 *      the `useUnits().formatDistance` wiring rather than a static string.
 *   3. LOADING — every panel shows skeletons and no ready values leak; the
 *      AI slot still mounts outside the data gate.
 *   4. ERROR   — every data-bound panel surfaces `QueryError` and the Retry
 *      action is wired to the owning query's `refetch`.
 *   5. EMPTY   — each section shows its own EmptyState (never a blank panel)
 *      when a query resolves with no rows.
 *   6. FILTER  — the category `<select>` narrows the item grid.
 *   7. SORT    — the sort `<select>` reorders the item grid by name.
 *   8. STATUS  — the item card derives its badge + progress bar from
 *      `computeProgress` (interval-miles path) and hides the bar for
 *      completed items; the progress bar exposes a11y `role="progressbar"`.
 *   9. COST    — the single-record branch (avg == total, annual == total).
 *  10. BUG-FIX — a malformed `last_service_date` yields a 0% bar
 *      (`aria-valuenow="0"`) instead of a NaN one.
 *  11. BUG-FIX — sorting by due date is stable: null/invalid-due items sort
 *      last and tie-break deterministically by name.
 *  12. REFRESH — the header refresh control refetches both queries.
 *  13. RECORDS — blank record description / provider degrade to an em dash.
 *
 * Network is never hit: the two page queries are stubbed through a mocked
 * `useQuery`, and the unit / format / settings / selected-vehicle hooks plus
 * the AI narration surface (which has its own suite) are isolated. i18n is
 * stubbed so visible copy is the English fallback with {{placeholder}}
 * interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `itemsQuery` / `recordsQuery` feed the mocked useQuery (routed by
// queryKey[0]); `unit` feeds useUnits so a single test can flip km→mi;
// `selected` feeds useSelectedVehicle.
const h = vi.hoisted(() => ({
  itemsQuery: undefined as unknown,
  recordsQuery: undefined as unknown,
  unit: { distance: 'km' as 'km' | 'mi' },
  selected: { vehicleId: 7 as number | null },
}));

const benignQuery = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  isStale: false,
  dataUpdatedAt: 0,
  refetch: () => undefined,
};

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      const key = Array.isArray(options.queryKey) ? options.queryKey[0] : options.queryKey;
      if (key === 'maintenance') return h.itemsQuery;
      if (key === 'maintenance-records') return h.recordsQuery;
      return benignQuery;
    },
  };
});

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

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.selected.vehicleId,
    vehicle: null,
    vehicles: [],
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
    // SI metres in → user-preferred distance out. Deterministic + rounded so
    // tests can assert the exact rendered token.
    formatDistance: (v: number | null | undefined) => {
      const meters = v ?? 0;
      if (h.unit.distance === 'mi') return `${Math.round(meters / 1609.344)} mi`;
      return `${Math.round(meters / 1000)} km`;
    },
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

// useDateFormat (used by PageContainer's freshness chip) reads useSettings;
// isolate it so the freshness path never touches the network.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      locale: 'en-US',
      tz_display_default: 'utc',
      timezone_user: null,
      decimal_precision: 2,
    },
    locale: 'en-US',
    isMiles: false,
    isFahrenheit: false,
    isPSI: false,
    decimals: 2,
    density: 'comfortable',
    rangeType: 'rated',
  }),
}));

// The Helix predictive-maintenance narrator has its own AI-off contract
// suite and is gated by settings; stub it so this page stays deterministic
// and network-free while still asserting the page threads the vehicle id.
vi.mock('@/components/ai/AIPredictiveMaintenance', () => ({
  AIPredictiveMaintenance: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-predictive-maintenance" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

import MaintenancePage from './MaintenancePage';

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

type MaintenanceStatus = 'good' | 'soon' | 'overdue' | 'completed';

interface MItem {
  id: number;
  vehicle_id: number;
  category: string;
  name: string;
  description: string;
  due_date: string | null;
  due_mileage: number | null;
  current_mileage: number;
  last_service_date: string | null;
  last_service_mileage: number | null;
  interval_months: number | null;
  interval_miles: number | null;
  status: MaintenanceStatus;
  created_at: string;
}

interface MRecord {
  id: number;
  vehicle_id: number;
  date: string;
  description: string;
  mileage: number;
  cost: number;
  provider: string;
  notes: string;
  created_at: string;
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

let idSeq = 0;

function makeItem(overrides: Partial<MItem> = {}): MItem {
  idSeq += 1;
  return {
    id: idSeq,
    vehicle_id: 7,
    category: 'general',
    name: `Item ${idSeq}`,
    description: 'Routine service',
    due_date: null,
    due_mileage: null,
    current_mileage: 0,
    last_service_date: null,
    last_service_mileage: null,
    interval_months: null,
    interval_miles: null,
    status: 'good',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<MRecord> = {}): MRecord {
  idSeq += 1;
  return {
    id: idSeq,
    vehicle_id: 7,
    date: '2024-03-01T10:00:00Z',
    description: 'Service record',
    mileage: 25000,
    cost: 100,
    provider: 'Tesla Service Center',
    notes: '',
    created_at: '2024-03-01T10:00:00Z',
    ...overrides,
  };
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/maintenance']}>
        <MaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  idSeq = 0;
  h.unit.distance = 'km';
  h.selected.vehicleId = 7;
  h.itemsQuery = makeQuery({ data: [] });
  h.recordsQuery = makeQuery({ data: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MaintenancePage', () => {
  it('renders every panel with deterministic values when data is ready', () => {
    const items: MItem[] = [
      makeItem({
        id: 1, category: 'tires', name: 'Tire Rotation', status: 'soon',
        current_mileage: 30000, due_mileage: 40000, due_date: '2025-01-01',
        interval_miles: 20000, last_service_mileage: 20000, last_service_date: '2024-01-01',
      }),
      makeItem({
        id: 2, category: 'brakes', name: 'Brake Pads', status: 'overdue',
        current_mileage: 60000, due_mileage: 50000, interval_miles: 40000, last_service_mileage: 10000,
      }),
      makeItem({
        id: 3, category: 'battery', name: 'Coolant Check', status: 'good',
        current_mileage: 0, interval_months: 12, last_service_date: '2024-06-01',
      }),
      makeItem({ id: 4, category: 'tires', name: 'Tire Balance', status: 'completed', current_mileage: 30000 }),
    ];
    const records: MRecord[] = [
      makeRecord({ id: 11, date: '2024-03-01T10:00:00Z', description: 'Annual inspection', provider: 'Tesla Service Center', cost: 120, mileage: 30000 }),
      makeRecord({ id: 12, date: '2024-09-01T10:00:00Z', description: 'Brake fluid flush', provider: 'Downtown Auto', cost: 80, mileage: 45000 }),
    ];
    h.itemsQuery = makeQuery({ data: items });
    h.recordsQuery = makeQuery({ data: records });

    renderPage();

    // Page shell + every panel heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Maintenance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Maintenance Items/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Service Projections/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Estimated Annual Cost/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Maintenance by Category/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Service Records/i })).toBeInTheDocument();

    // KPI band — the raw-status reduce, scoped to its a11y landmark so the
    // labels don't collide with the status badges elsewhere on the page.
    const kpis = within(screen.getByRole('region', { name: 'Maintenance summary' }));
    expect(kpis.getByText('Total Items')).toBeInTheDocument();
    expect(kpis.getByText('Overdue')).toBeInTheDocument();
    expect(kpis.getByText('Due Soon')).toBeInTheDocument();
    expect(kpis.getByText('Healthy')).toBeInTheDocument();
    expect(kpis.getByText('Completed')).toBeInTheDocument();
    expect(kpis.getByText('4')).toBeInTheDocument(); // total items
    expect(kpis.getByText('3')).toBeInTheDocument(); // distinct categories

    // Item cards render every item name (h4 subheads).
    expect(screen.getByRole('heading', { level: 4, name: 'Tire Rotation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Brake Pads' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Coolant Check' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Tire Balance' })).toBeInTheDocument();

    // SI metres → km at the render boundary (30000 m → "30 km").
    expect(screen.getAllByText('30 km').length).toBeGreaterThanOrEqual(1);

    // Cost stats (deterministic scalar branches).
    expect(screen.getByText('$200')).toBeInTheDocument(); // total spent
    expect(screen.getByText('$100')).toBeInTheDocument(); // avg / service (200 / 2)

    // Service-records table cells.
    expect(screen.getByText('Annual inspection')).toBeInTheDocument();
    expect(screen.getByText('Tesla Service Center')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();

    // Opt-in AI slot threaded with the selected vehicle id.
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('re-converts the SI distance to the user mi preference at the render boundary', () => {
    h.unit.distance = 'mi';
    h.itemsQuery = makeQuery({
      data: [makeItem({ id: 1, name: 'Tire Rotation', category: 'tires', current_mileage: 30000 })],
    });

    renderPage();

    // 30000 m → 18.64 mi → rounded "19 mi"; the km token must be gone.
    expect(screen.getByText('19 mi')).toBeInTheDocument();
    expect(screen.queryByText('30 km')).not.toBeInTheDocument();
  });

  it('shows skeletons in every panel while loading and leaks no ready values', () => {
    h.itemsQuery = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });
    h.recordsQuery = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Maintenance' })).toBeInTheDocument();
    // KPI band collapses to its skeleton — the labels are absent while loading.
    expect(screen.queryByText('Total Items')).not.toBeInTheDocument();
    // Skeletons render across the page (KPI + items + projections + cost + records).
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
    // No resolved item or error copy.
    expect(screen.queryByText('Tire Rotation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    // The opt-in AI narrator mounts outside the data gate.
    expect(screen.getByTestId('ai-predictive-maintenance')).toBeInTheDocument();
  });

  it('surfaces QueryError in every data panel and wires Retry to the owning query refetch', () => {
    const refetchItems = vi.fn();
    const refetchRecords = vi.fn();
    h.itemsQuery = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0, refetch: refetchItems });
    h.recordsQuery = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0, refetch: refetchRecords });

    renderPage();

    // One QueryError per data-bound panel: items, projections, cost, category, records.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(5);
    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons).toHaveLength(5);

    // The first QueryError belongs to the items panel → items refetch only.
    fireEvent.click(retryButtons[0]);
    expect(refetchItems).toHaveBeenCalledTimes(1);
    expect(refetchRecords).not.toHaveBeenCalled();
  });

  it('renders a per-section EmptyState (never a blank panel) when queries resolve empty', () => {
    h.itemsQuery = makeQuery({ data: [] });
    h.recordsQuery = makeQuery({ data: [] });

    renderPage();

    expect(screen.getByText('No maintenance items found for this vehicle.')).toBeInTheDocument();
    expect(screen.getByText('No upcoming service projections available.')).toBeInTheDocument();
    expect(screen.getByText(/No cost data available yet/i)).toBeInTheDocument();
    expect(screen.getByText('No maintenance items to categorize yet.')).toBeInTheDocument();
    expect(screen.getByText('No service records logged yet.')).toBeInTheDocument();
    // Shell + AI slot still mount.
    expect(screen.getByText('Total Items')).toBeInTheDocument();
    expect(screen.getByTestId('ai-predictive-maintenance')).toBeInTheDocument();
  });

  it('filters the item grid by the selected category', () => {
    h.itemsQuery = makeQuery({
      data: [
        makeItem({ id: 1, category: 'tires', name: 'Tire Rotation' }),
        makeItem({ id: 2, category: 'tires', name: 'Tire Balance' }),
        makeItem({ id: 3, category: 'brakes', name: 'Brake Pads' }),
      ],
    });

    renderPage();

    // All three visible under the default "all" filter.
    expect(screen.getByText('Tire Rotation')).toBeInTheDocument();
    expect(screen.getByText('Brake Pads')).toBeInTheDocument();

    const filter = screen.getByRole('combobox', { name: 'Filter by category' });
    fireEvent.change(filter, { target: { value: 'brakes' } });

    // Only the brake item remains.
    expect(screen.getByText('Brake Pads')).toBeInTheDocument();
    expect(screen.queryByText('Tire Rotation')).not.toBeInTheDocument();
    expect(screen.queryByText('Tire Balance')).not.toBeInTheDocument();
  });

  it('reorders the item grid when the sort control changes to name', () => {
    h.itemsQuery = makeQuery({
      data: [
        makeItem({ id: 1, category: 'general', name: 'Alpha', status: 'good' }),
        makeItem({ id: 2, category: 'general', name: 'Zebra', status: 'overdue' }),
      ],
    });

    renderPage();

    // Default sort is by status → overdue (Zebra) before good (Alpha).
    const before = screen.getAllByRole('heading', { level: 4 }).map((h4) => h4.textContent);
    expect(before).toEqual(['Zebra', 'Alpha']);

    const sort = screen.getByRole('combobox', { name: 'Sort items' });
    fireEvent.change(sort, { target: { value: 'name' } });

    const after = screen.getAllByRole('heading', { level: 4 }).map((h4) => h4.textContent);
    expect(after).toEqual(['Alpha', 'Zebra']);
  });

  it('derives the item badge + progress bar from progress and hides the bar for completed items', () => {
    h.itemsQuery = makeQuery({
      data: [
        makeItem({
          id: 1, category: 'tires', name: 'Tire Rotation', status: 'soon',
          current_mileage: 39000, last_service_mileage: 20000, interval_miles: 20000, due_mileage: 40000,
        }),
        makeItem({ id: 2, category: 'tires', name: 'Tire Balance', status: 'completed', current_mileage: 30000 }),
      ],
    });

    renderPage();

    // (39000 - 20000) / 20000 = 95% → derived status "overdue".
    expect(screen.getByText('95%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Tire Rotation service progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '95');
    expect(
      screen.queryByRole('progressbar', { name: 'Tire Balance service progress' }),
    ).toBeNull();
    // The derived "Overdue" badge shows on the card even though raw status is "soon".
    expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(1);
  });

  it('computes cost stats from a single record (annual == total, avg == total)', () => {
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 11, cost: 500, date: '2024-05-01T00:00:00Z' })],
    });

    renderPage();

    expect(screen.getByText('Total Spent')).toBeInTheDocument();
    expect(screen.getByText('Avg / Service')).toBeInTheDocument();
    // Single record → the <2-dates branch: every figure collapses to $500.
    expect(screen.getAllByText('$500').length).toBeGreaterThanOrEqual(2);
  });

  it('renders a 0% bar for a malformed last_service_date instead of a NaN one (regression)', () => {
    h.itemsQuery = makeQuery({
      data: [
        makeItem({
          id: 1, category: 'filters', name: 'Air Filter', status: 'good',
          interval_months: 12, last_service_date: 'not-a-date', current_mileage: 0,
        }),
      ],
    });

    renderPage();

    const bar = screen.getByRole('progressbar', { name: 'Air Filter service progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).not.toHaveAttribute('aria-valuenow', 'NaN');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('sorts by due date stably: null/invalid-due items sort last and tie-break by name (regression)', () => {
    h.itemsQuery = makeQuery({
      data: [
        makeItem({ id: 1, category: 'general', name: 'Mid', status: 'good', due_date: '2024-06-01' }),
        makeItem({ id: 2, category: 'general', name: 'Zeta', status: 'good', due_date: null }),
        makeItem({ id: 3, category: 'general', name: 'Alpha', status: 'good', due_date: null }),
      ],
    });

    renderPage();

    const sort = screen.getByRole('combobox', { name: 'Sort items' });
    fireEvent.change(sort, { target: { value: 'due_date' } });

    // Dated item first; the two null-due items follow in deterministic name order.
    const order = screen.getAllByRole('heading', { level: 4 }).map((h4) => h4.textContent);
    expect(order).toEqual(['Mid', 'Alpha', 'Zeta']);
  });

  it('refetches both queries when the header refresh control is pressed', () => {
    const refetchItems = vi.fn();
    const refetchRecords = vi.fn();
    h.itemsQuery = makeQuery({ data: [makeItem({ id: 1, name: 'Tire Rotation' })], refetch: refetchItems });
    h.recordsQuery = makeQuery({ data: [makeRecord({ id: 11 })], refetch: refetchRecords });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh maintenance data' }));

    expect(refetchItems).toHaveBeenCalledTimes(1);
    expect(refetchRecords).toHaveBeenCalledTimes(1);
  });

  it('degrades blank record description / provider to an em dash in the records table', () => {
    h.itemsQuery = makeQuery({ data: [] });
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 11, description: '', provider: '', mileage: 25000, cost: 0 })],
    });

    renderPage();

    const recordsHeading = screen.getByRole('heading', { name: /Service Records/i });
    const panel = recordsHeading.closest('div');
    expect(panel).not.toBeNull();
    const scoped = within(panel as HTMLElement);
    // Blank description + blank provider both fall back to "—".
    expect(scoped.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // Mileage still renders through the SI formatter.
    expect(scoped.getByText('25 km')).toBeInTheDocument();
  });
});
