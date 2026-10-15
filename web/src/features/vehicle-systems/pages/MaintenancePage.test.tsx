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
import userEvent from '@testing-library/user-event';
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
  dates: {
    locale: 'en-US',
    tz_display_default: 'utc',
    timezone_user: null as string | null,
  },
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
      ...h.dates,
      decimal_precision: 2,
    },
    locale: h.dates.locale,
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

function renderPage(path = '/maintenance') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
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
  h.dates.locale = 'en-US';
  h.dates.tz_display_default = 'utc';
  h.dates.timezone_user = null;
  h.itemsQuery = makeQuery({ data: [] });
  h.recordsQuery = makeQuery({ data: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MaintenancePage', () => {
  it('uses saved locale and timezone consistently across dates and evidence day links', async () => {
    h.dates.locale = 'de-DE';
    h.dates.tz_display_default = 'user';
    h.dates.timezone_user = 'America/Los_Angeles';
    const instant = '2024-03-01T01:30:00Z';
    h.itemsQuery = makeQuery({ data: [makeItem({
      name: 'Boundary service', due_date: instant, last_service_date: instant,
      created_at: instant, interval_miles: 10000, last_service_mileage: 0,
    })] });
    h.recordsQuery = makeQuery({ data: [makeRecord({
      description: 'Boundary record', date: instant, created_at: instant,
    })] });
    renderPage('/maintenance?from=2026-01-01&to=2026-01-31');
    const expectedDate = new Date(instant).toLocaleDateString('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
    });
    const expectedTime = new Date(instant).toLocaleString('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    expect(screen.getAllByText(`Due: ${expectedDate}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(expectedDate).length).toBeGreaterThan(0);
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Boundary record' }));
    expect(drawer.getAllByText(expectedTime)).toHaveLength(2);
    const href = drawer.getByRole('link', { name: 'Drive history' }).getAttribute('href');
    expect(href).toContain('from=2024-02-29');
    expect(href).toContain('to=2024-02-29');
    expect(href).not.toContain('2026');
  });

  it('preserves date-only business days in a non-default timezone', async () => {
    h.dates.locale = 'fr-FR';
    h.dates.tz_display_default = 'user';
    h.dates.timezone_user = 'America/Los_Angeles';
    h.itemsQuery = makeQuery({ data: [makeItem({
      due_date: '2024-03-01', last_service_date: '2024-03-01',
      interval_miles: 10000, last_service_mileage: 0,
    })] });
    h.recordsQuery = makeQuery({ data: [makeRecord({ date: '2024-03-01' })] });
    renderPage();
    const label = new Date('2024-03-01T12:00:00Z').toLocaleDateString('fr-FR', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    });
    expect(screen.getAllByText(`Due: ${label}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Service record' }));
    expect(drawer.getByText(label)).toBeInTheDocument();
    expect(drawer.getByRole('link', { name: 'Drive history' })).toHaveAttribute(
      'href', expect.stringContaining('from=2024-03-01'),
    );
  });

  it.each(['not-a-date', '', '2024-02-30'])('handles invalid or missing business dates: %s', async date => {
    h.itemsQuery = makeQuery({ data: [makeItem({
      due_date: date || null, last_service_date: date || null, created_at: 'not-a-date',
      interval_miles: 10000, last_service_mileage: 0,
    })] });
    h.recordsQuery = makeQuery({ data: [makeRecord({ date, created_at: '' })] });
    renderPage();
    expect(screen.queryByText(/Invalid Date|NaN/)).not.toBeInTheDocument();
    const item = document.querySelector<HTMLElement>('[data-maintenance-item]');
    expect(item).not.toBeNull();
    if (item) {
      await userEvent.click(within(item).getByRole('button', {
        name: 'Service interval and metadata',
      }));
      expect(within(item).getAllByText('—').length).toBeGreaterThan(0);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Service record' }));
    expect(drawer.getAllByText('—')).toHaveLength(2);
    const href = drawer.getByRole('link', { name: 'Drive history' }).getAttribute('href');
    expect(href).not.toContain('from=');
    expect(href).not.toContain('to=');
  });

  it('keeps mobile action minimums responsive and lets the schedule label wrap', () => {
    h.recordsQuery = makeQuery({ data: [makeRecord()] });
    renderPage();

    const refresh = screen.getByRole('button', { name: 'Refresh maintenance data' });
    const schedule = screen.getByRole('button', { name: 'Schedule' });
    const inspect = screen.getByRole('button', { name: 'Inspect service record' });
    for (const action of [refresh, schedule, inspect]) {
      expect(action).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9');
    }
    expect(inspect).toHaveClass('md:min-w-9');
    expect(inspect).not.toHaveClass('h-11', 'w-11');
    expect(schedule).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
    expect(schedule.querySelector('span.break-words')).toHaveTextContent('Schedule');
  });

  it('supports keyboard refresh and record inspection without losing record fields', async () => {
    const user = userEvent.setup();
    const itemsRefetch = vi.fn();
    const recordsRefetch = vi.fn();
    h.itemsQuery = makeQuery({ refetch: itemsRefetch });
    h.recordsQuery = makeQuery({
      refetch: recordsRefetch,
      data: [makeRecord({
        id: 11, description: 'Annual inspection', provider: 'Tesla Service Center',
        mileage: 30000, cost: 120, notes: 'Brake wear documented',
      })],
    });
    renderPage();

    screen.getByRole('button', { name: 'Refresh maintenance data' }).focus();
    await user.keyboard('{Enter}');
    expect(itemsRefetch).toHaveBeenCalledTimes(1);
    expect(recordsRefetch).toHaveBeenCalledTimes(1);

    const inspect = screen.getByRole('button', { name: 'Inspect service record' });
    inspect.focus();
    await user.keyboard(' ');
    const drawer = screen.getByRole('dialog', { name: 'Annual inspection' });
    for (const label of ['Date', 'Mileage', 'Cost', 'Provider', 'Record ID', 'Vehicle', 'Created']) {
      expect(within(drawer).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(drawer).getByText('Brake wear documented')).toBeInTheDocument();
    expect(within(drawer).getByText('Tesla Service Center')).toBeInTheDocument();
    expect(within(drawer).getByText('30 km')).toBeInTheDocument();
    expect(within(drawer).getByText('$120.00')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Annual inspection' })).not.toBeInTheDocument();
    expect(inspect).toHaveFocus();
  });

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
    expect(screen.getByRole('heading', { name: /Maintenance items/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Service projections/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estimated annual cost', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Maintenance by category/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Service records/i })).toBeInTheDocument();

    // KPI band — the raw-status reduce, scoped to its a11y landmark so the
    // labels don't collide with the status badges elsewhere on the page.
    const kpis = within(screen.getByRole('region', { name: 'Maintenance summary' }));
    expect(kpis.getByText('Total items', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    expect(kpis.getByText('Overdue', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    expect(kpis.getByText('Due soon', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    expect(kpis.getByText('Healthy', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    expect(kpis.getByText('Completed', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
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
    expect(screen.getByText('$200.00')).toBeInTheDocument(); // total spent
    expect(screen.getByText('$100.00')).toBeInTheDocument(); // avg / service (200 / 2)

    // Service-records table cells.
    expect(screen.getByText('Annual inspection')).toBeInTheDocument();
    expect(screen.getByText('Tesla Service Center')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();

    // Opt-in AI slot threaded with the selected vehicle id.
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('opens a service record with related operational evidence links', () => {
    h.recordsQuery = makeQuery({
      data: [
        makeRecord({
          id: 11,
          date: '2024-03-01T10:00:00Z',
          description: 'Annual inspection',
          notes: 'Brake wear documented',
        }),
      ],
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));

    const drawer = screen.getByRole('dialog', { name: 'Annual inspection' });
    expect(within(drawer).getByText('Brake wear documented')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/7');
    expect(within(drawer).getByRole('link', { name: 'Drive history' }))
      .toHaveAttribute('href', '/drives?from=2024-03-01&to=2024-03-01');
    expect(within(drawer).getByRole('link', { name: 'Charging sessions' }))
      .toHaveAttribute('href', '/charging?from=2024-03-01&to=2024-03-01');
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute('href', '/signals?from=2024-03-01&to=2024-03-01');
    expect(within(drawer).getByRole('link', { name: 'Build service evidence pack' }))
      .toHaveAttribute('href', '/diagnostics/service-evidence');
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
    // The brief retains metric labels while suppressing unresolved readings.
    const summary = screen.getByRole('region', { name: 'Maintenance summary' });
    expect(summary).toHaveAttribute('aria-busy', 'true');
    expect(within(summary).getByText('Total items', {
      selector: '[data-operational-metric] > div:first-child > :first-child',
    })).toBeInTheDocument();
    expect(within(summary).queryByText('Total items', {
      selector: '[data-operational-value]',
    })).not.toBeInTheDocument();
    expect(summary.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    // Skeletons render across the page (KPI + items + projections + cost + records).
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(10);
    for (const title of [
      'Maintenance items', 'Service projections', 'Estimated annual cost',
      'Maintenance by category', 'Service records',
    ]) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    }
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
    expect(screen.getByText('Total items', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
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
    expect(screen.getByText('95.00%')).toBeInTheDocument();
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

    expect(screen.getByText('Total spent', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    expect(screen.getByText('Avg / service', { selector: '[data-operational-metric] > div:first-child > :first-child' })).toBeInTheDocument();
    // Single record → the <2-dates branch: every figure collapses to $500.
    expect(screen.getAllByText('$500.00').length).toBeGreaterThanOrEqual(2);
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
    expect(screen.getByText('0.00%')).toBeInTheDocument();
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

    const recordsHeading = screen.getByRole('heading', { name: /Service records/i });
    const panel = recordsHeading.closest('[data-card]');
    expect(panel).not.toBeNull();
    const scoped = within(panel as HTMLElement);
    // Blank description + blank provider both fall back to "—".
    expect(scoped.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // Mileage still renders through the SI formatter.
    expect(scoped.getByText('25 km')).toBeInTheDocument();
  });
});

describe('MaintenancePage workspace preview scope', () => {
  function renderScopedPage() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const page = () => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/maintenance']}>
          <MaintenancePage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(page());
    return { rerenderPage: () => view.rerender(page()) };
  }

  it('closes the previous vehicle preview before inspecting the new vehicle records', () => {
    const previousRecords = [
      makeRecord({ id: 71, vehicle_id: 7, description: 'Previous vehicle inspection', notes: 'Previous vehicle notes' }),
    ];
    h.recordsQuery = makeQuery({ data: previousRecords });

    const view = renderScopedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const previousDrawer = screen.getByRole('dialog', { name: 'Previous vehicle inspection' });
    expect(within(previousDrawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/7');

    h.selected.vehicleId = 8;
    h.itemsQuery = makeQuery({ data: [makeItem({ id: 81, vehicle_id: 8, name: 'New vehicle tires' })] });
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 82, vehicle_id: 8, description: 'New vehicle inspection', notes: 'New vehicle notes', cost: 0, mileage: 0 })],
    });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous vehicle notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vehicle' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'New vehicle tires' })).toBeInTheDocument();
    expect(screen.getByText('New vehicle inspection')).toBeInTheDocument();
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '8');

    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const newDrawer = screen.getByRole('dialog', { name: 'New vehicle inspection' });
    expect(within(newDrawer).getByText('New vehicle notes')).toBeInTheDocument();
    expect(within(newDrawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/8');
    expect(within(newDrawer).getByText('0 km')).toBeInTheDocument();
    expect(within(newDrawer).getByText('$0.00')).toBeInTheDocument();

    h.selected.vehicleId = 7;
    h.recordsQuery = makeQuery({ data: previousRecords });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('New vehicle notes')).not.toBeInTheDocument();
    expect(screen.getByText('Previous vehicle inspection')).toBeInTheDocument();
  });

  it('retains a same-vehicle preview during a refresh error but clears it and the old error on scope change', () => {
    const previousRecords = [
      makeRecord({ id: 71, vehicle_id: 7, description: 'Retained inspection', notes: 'Retained evidence' }),
    ];
    const retryItems = vi.fn();
    const retryRecords = vi.fn();
    h.itemsQuery = makeQuery({ data: [], refetch: retryItems });
    h.recordsQuery = makeQuery({ data: previousRecords, refetch: retryRecords });

    const view = renderScopedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    h.recordsQuery = makeQuery({
      data: previousRecords,
      isError: true,
      error: new Error('Previous vehicle records refresh failed'),
      refetch: retryRecords,
    });
    view.rerenderPage();

    const retainedDrawer = screen.getByRole('dialog', { name: 'Retained inspection' });
    expect(within(retainedDrawer).getByText('Retained evidence')).toBeInTheDocument();
    expect(within(retainedDrawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/7');
    // Retention belongs to each source, not a page-wide copy count: the cost
    // panel also exposes the embedded operational brief's own retained evidence.
    for (const title of ['Estimated annual cost', 'Service records']) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      const retry = within(panel as HTMLElement).getByRole('button', { name: /^Retry$/i });
      const sourceWarning = retry.parentElement;
      expect(sourceWarning).not.toBeNull();
      expect(within(sourceWarning as HTMLElement).getByRole('status'))
        .toHaveTextContent('Showing retained measurements');
      expect(within(panel as HTMLElement).queryByText(/Can't reach server/i)).not.toBeInTheDocument();
      fireEvent.click(retry);
    }
    expect(retryRecords).toHaveBeenCalledTimes(2);
    expect(retryItems).not.toHaveBeenCalled();

    const costBrief = screen.getByRole('region', { name: 'Estimated annual cost evidence' });
    expect(within(costBrief).getByText('Retained evidence')).toBeInTheDocument();
    expect(costBrief.parentElement).not.toBeNull();
    expect(within(costBrief.parentElement as HTMLElement).getByRole('status'))
      .toHaveTextContent('Showing retained measurements');
    const recordsPanel = screen.getByRole('heading', { name: 'Service records', exact: true }).closest('[data-card]');
    expect(recordsPanel).not.toBeNull();
    expect(within(recordsPanel as HTMLElement).getByText('Retained inspection')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Retained inspection' })).toBeInTheDocument();

    h.selected.vehicleId = 8;
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 81, vehicle_id: 8, description: 'Recovered new vehicle inspection' })],
    });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Showing retained measurements')).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    expect(screen.getByText('Recovered new vehicle inspection')).toBeInTheDocument();
  });

  it('clears an old preview when the new vehicle history fails and preserves independent recovery', () => {
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 71, vehicle_id: 7, description: 'Old inspection', notes: 'Old private evidence' })],
    });
    const view = renderScopedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    expect(screen.getByRole('dialog', { name: 'Old inspection' })).toBeInTheDocument();

    const retryRecords = vi.fn();
    h.selected.vehicleId = 8;
    h.itemsQuery = makeQuery({ data: [makeItem({ id: 81, vehicle_id: 8, name: 'New vehicle maintenance' })] });
    h.recordsQuery = makeQuery({
      data: undefined, isError: true, error: new Error('New vehicle records unavailable'),
      dataUpdatedAt: 0, refetch: retryRecords,
    });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Old private evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'New vehicle maintenance' })).toBeInTheDocument();
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(2);
    const recordsPanel = screen.getByRole('heading', { name: 'Service records', exact: true }).closest('[data-card]');
    expect(recordsPanel).not.toBeNull();
    fireEvent.click(within(recordsPanel as HTMLElement).getByRole('button', { name: /^Retry$/i }));
    expect(retryRecords).toHaveBeenCalledTimes(1);

    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 82, vehicle_id: 8, description: 'Recovered inspection' })],
    });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    const recoveredDrawer = screen.getByRole('dialog', { name: 'Recovered inspection' });
    expect(within(recoveredDrawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/8');
  });

  it('clears the preview on vehicle deselection without reopening it when the same vehicle returns', () => {
    const previousRecords = [
      makeRecord({ id: 71, vehicle_id: 7, description: 'Selected vehicle inspection', notes: 'Selected vehicle evidence' }),
    ];
    h.recordsQuery = makeQuery({ data: previousRecords });
    const view = renderScopedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect service record' }));
    expect(screen.getByRole('dialog', { name: 'Selected vehicle inspection' })).toBeInTheDocument();

    h.selected.vehicleId = null;
    h.itemsQuery = makeQuery({ data: undefined, dataUpdatedAt: 0 });
    h.recordsQuery = makeQuery({ data: undefined, dataUpdatedAt: 0 });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Selected vehicle evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Maintenance items', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Service records', exact: true })).toBeInTheDocument();
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '');

    h.selected.vehicleId = 7;
    h.recordsQuery = makeQuery({ data: previousRecords });
    view.rerenderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Selected vehicle inspection')).toBeInTheDocument();
  });
});


describe('MaintenancePage independent source adoption', () => {
  it('keeps ready service history and header actions available when maintenance fails independently', () => {
    const retryItems = vi.fn();
    const retryRecords = vi.fn();
    h.itemsQuery = makeQuery({
      data: undefined, isError: true, error: new Error('Maintenance unavailable'),
      dataUpdatedAt: 0, refetch: retryItems,
    });
    h.recordsQuery = makeQuery({
      data: [makeRecord({ id: 91, description: 'Independent service history', mileage: 30000, cost: 40 })],
      refetch: retryRecords,
    });

    renderPage();

    for (const title of ['Maintenance items', 'Service projections', 'Maintenance by category']) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      expect(within(panel as HTMLElement).getByText(/Can't reach server/i)).toBeInTheDocument();
      fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: /^Retry$/i }));
    }
    expect(retryItems).toHaveBeenCalledTimes(3);
    expect(retryRecords).not.toHaveBeenCalled();

    for (const title of ['Estimated annual cost', 'Service records']) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      expect(within(panel as HTMLElement).queryByText(/Can't reach server/i)).not.toBeInTheDocument();
      expect(within(panel as HTMLElement).queryByRole('button', { name: /^Retry$/i })).not.toBeInTheDocument();
    }
    const history = screen.getByRole('heading', { name: 'Service records', exact: true }).closest('[data-card]');
    expect(within(history as HTMLElement).getByText('Independent service history')).toBeInTheDocument();
    expect(within(history as HTMLElement).getByText('30 km')).toBeInTheDocument();
    expect(within(history as HTMLElement).getByRole('button', { name: 'Inspect service record' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Maintenance summary' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '7');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Maintenance' })).toHaveLength(1);

    // Schedule remains the inherited no-op: adoption must not invent a write.
    fireEvent.click(screen.getByRole('button', { name: 'Schedule', exact: true }));
    expect(retryItems).toHaveBeenCalledTimes(3);
    expect(retryRecords).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh maintenance data' }));
    expect(retryItems).toHaveBeenCalledTimes(4);
    expect(retryRecords).toHaveBeenCalledTimes(1);
  });

  it('keeps ready maintenance sections visible while service history is independently loading', () => {
    h.itemsQuery = makeQuery({
      data: [makeItem({
        id: 92, category: 'tires', name: 'Independent tire service', status: 'soon',
        current_mileage: 30000, due_mileage: 40000,
        interval_miles: 20000, last_service_mileage: 20000,
      })],
    });
    h.recordsQuery = makeQuery({
      data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0,
    });

    renderPage();

    expect(screen.getByRole('heading', { level: 4, name: 'Independent tire service' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Maintenance summary' });
    expect(summary.querySelector('[data-operational-value]')).toBeInTheDocument();
    for (const title of ['Maintenance items', 'Service projections', 'Maintenance by category']) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('[class*="--skeleton-bg"]')).not.toBeInTheDocument();
      expect(within(panel as HTMLElement).queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    }
    for (const title of ['Estimated annual cost', 'Service records']) {
      const panel = screen.getByRole('heading', { name: title, exact: true }).closest('[data-card]');
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    }
    expect(screen.queryByText('No service records logged yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(/No cost data available yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect service record' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-predictive-maintenance')).toHaveAttribute('data-vehicle-id', '7');
  });
});
