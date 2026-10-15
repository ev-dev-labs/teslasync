import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import english from '@/i18n/en.json';
import fleetOpsEnglish from '@/i18n/en/locale-fleet-ops.json';

const scopeCalls = vi.hoisted(() => ({
  reservations: vi.fn(),
  forecast: vi.fn(),
}));

const operationalMode = vi.hoisted(() => ({
  canWrite: true,
  writeBlockReason: null as string | null,
}));
const fleetPageState = vi.hoisted(() => ({
  total: 1,
  driversError: null as Error | null,
  driversUnavailable: false,
  forecastError: null as Error | null,
  vehiclesError: null as Error | null,
  vehiclesUnavailable: false,
  vehiclesLoading: false,
  vehiclesEmpty: false,
  vehiclesPaused: false,
}));
const sectionState = vi.hoisted(() => ({
  sources: {} as Record<string, {
    unavailable?: boolean;
    loading?: boolean;
    paused?: boolean;
    empty?: boolean;
    zero?: boolean;
    fetching?: boolean;
    error?: Error;
  }>,
  retries: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, value),
        fallback,
      ),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const refetch = vi.fn();
const reset = vi.fn();
const mutate = vi.fn();

function query<T>(data: T, source?: string) {
  const state = source ? sectionState.sources[source] : undefined;
  const error = state?.error ?? (source === 'drivers' ? fleetPageState.driversError
    : source === 'forecast' ? fleetPageState.forecastError : null);
  const payload = state?.empty && data && typeof data === 'object'
    ? { ...data, items: [], total: 0, points: [] } : data;
  if (source && !sectionState.retries[source]) sectionState.retries[source] = vi.fn();
  return {
    data: state?.unavailable || (source === 'drivers' && fleetPageState.driversUnavailable) ? undefined : payload,
    isLoading: state?.loading ?? false,
    isFetching: state?.fetching ?? state?.loading ?? false,
    fetchStatus: state?.paused ? 'paused' as const
      : state?.loading || state?.fetching ? 'fetching' as const : 'idle' as const,
    isError: error != null,
    isStale: false,
    error,
    dataUpdatedAt: Date.now(),
    refetch: source ? () => { sectionState.retries[source](); refetch(); } : refetch,
  };
}

const vehiclesRefetch = vi.fn();

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    ...query(fleetPageState.vehiclesEmpty ? [] : [{ id: 7, display_name: 'Pool Y', vin: 'VIN7' }]),
    data: fleetPageState.vehiclesUnavailable ? undefined
      : fleetPageState.vehiclesEmpty ? [] : [{ id: 7, display_name: 'Pool Y', vin: 'VIN7' }],
    error: fleetPageState.vehiclesError,
    isError: fleetPageState.vehiclesError != null,
    isLoading: fleetPageState.vehiclesLoading,
    fetchStatus: fleetPageState.vehiclesPaused ? 'paused' : 'idle',
    refetch: vehiclesRefetch,
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatPower: (value: number | null) => value == null ? '—' : `${value / 1000} kW`,
    formatDistance: (value: number | null) => value == null ? '—' : `${value / 1000} km`,
    unitPrefs: { distance: 'km' },
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('@/api/hooks/useFleetOps', () => ({
  useFleetDrivers: () => query({ items: [{
    id: 2,
    reference_code: 'DRV-A',
    display_name: 'Driver A',
    status: 'active',
    version: 3,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: fleetPageState.total, limit: 100, offset: 0 }, 'drivers'),
  useFleetAssignments: () => query({ items: [{
    id: 1,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    driver_id: 2,
    driver_display_name: 'Driver A',
    starts_at: '2026-08-01T00:00:00Z',
    ends_at: null,
    notes: null,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: fleetPageState.total, limit: 100, offset: 0 }, 'assignments'),
  useFleetReservations: (...args: unknown[]) => {
    scopeCalls.reservations(...args);
    return query({ items: [{
    id: 3,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    driver_id: 2,
    driver_display_name: 'Driver A',
    cost_center_id: 4,
    cost_center_name: 'Field',
    title: 'Airport run',
    purpose: null,
    starts_at: '2026-08-06T10:00:00Z',
    ends_at: '2026-08-06T11:00:00Z',
    status: 'confirmed',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: fleetPageState.total, limit: 100, offset: 0 }, 'reservations');
  },
  useFleetCostCenters: () => query({ items: [{
    id: 4,
    code: 'FIELD',
    name: 'Field team',
    active: true,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: fleetPageState.total, limit: 100, offset: 0 }, 'costCenters'),
  useFleetChargingPolicies: () => query({ items: [{
    id: 5,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    name: 'Depot nights',
    target_soc_pct: 80,
    max_power_w: 11000,
    priority: 10,
    effective_from: '2026-08-01T00:00:00Z',
    effective_to: null,
    enabled: true,
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
  }], total: fleetPageState.total, limit: 100, offset: 0 }, 'policies'),
  useFleetWorkOrders: () => query({ items: [{
    id: 6,
    vehicle_id: 7,
    vehicle_display_name: 'Pool Y',
    cost_center_id: 4,
    cost_center_name: 'Field',
    title: 'Rotate tires',
    description: null,
    status: 'open',
    severity: 'high',
    due_odometer_m: 100000,
    due_at: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    cost_minor: sectionState.sources.workOrders?.zero ? 0 : 10000,
    currency: 'USD',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }], total: 1, limit: 100, offset: 0 }, 'workOrders'),
  useFleetUtilizationForecast: (...args: unknown[]) => {
    scopeCalls.forecast(...args);
    return query({
    from: '2026-08-05T00:00:00Z',
    to: '2026-08-19T00:00:00Z',
    generated_at: '2026-08-05T00:00:00Z',
    quality: 'fair',
    history_drive_count: 20,
    history_day_count: 12,
    limitations: ['Moderate history.'],
    points: [{
      vehicle_id: 7,
      vehicle_display_name: 'Pool Y',
      forecast_date: '2026-08-06T00:00:00Z',
      available_s: 36000,
      reserved_s: 7200,
      maintenance_downtime_s: 0,
      historical_expected_s: 3600,
      expected_utilization_pct: sectionState.sources.forecast?.zero ? 0 : 20,
      lower_utilization_pct: sectionState.sources.forecast?.zero ? 0 : 10,
      upper_utilization_pct: sectionState.sources.forecast?.zero ? 0 : 35,
    }],
  }, 'forecast');
  },
  useCreateFleetReservation: () => ({
    mutate,
    reset,
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateFleetReservation: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useCreateFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useUpdateFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetDriver: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetAssignment: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetCostCenter: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetChargingPolicy: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetWorkOrder: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
  useDeleteFleetReservation: () => ({ mutate, reset, isPending: false, isError: false, error: null }),
}));

import FleetOperationsPage from './FleetOperationsPage';

beforeEach(() => {
  scopeCalls.reservations.mockClear();
  scopeCalls.forecast.mockClear();
  sectionState.sources = {};
  sectionState.retries = {};
  refetch.mockReset();
  reset.mockReset();
  mutate.mockReset();
  operationalMode.canWrite = true;
  fleetPageState.total = 1;
  fleetPageState.driversError = null;
  fleetPageState.driversUnavailable = false;
  fleetPageState.forecastError = null;
  fleetPageState.vehiclesError = null;
  fleetPageState.vehiclesUnavailable = false;
  fleetPageState.vehiclesLoading = false;
  fleetPageState.vehiclesEmpty = false;
  fleetPageState.vehiclesPaused = false;
  vehiclesRefetch.mockReset();
  operationalMode.writeBlockReason = null;
});

describe('FleetOperationsPage', () => {
  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const page = (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <FleetOperationsPage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const rendered = render(page);
    return { ...rendered, rerenderPage: () => rendered.rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <FleetOperationsPage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    ) };
  }

  const sections = [
    ['reservations', 'Reservation calendar', 'No reservations found.'],
    ['drivers', 'Fleet drivers', 'No fleet drivers are configured.'],
    ['assignments', 'Assignment roster', 'No driver assignments are scheduled.'],
    ['costCenters', 'Cost-center allocation', 'No cost centers have been configured.'],
    ['policies', 'Charging policy matrix', 'No charging policies are configured.'],
    ['workOrders', 'Maintenance work-order board', 'No maintenance work orders are open.'],
    ['forecast', 'Utilization forecast', null],
  ] as const;
  function sectionCard(title: string) {
    const card = screen.getByRole('heading', { name: title }).closest<HTMLElement>('[data-card]');
    if (!card) throw new Error(`${title} card missing`);
    return card;
  }

  it('uses canonical undated reservation copy without applying the forecast window to the list', () => {
    sectionState.sources.reservations = { empty: true };
    const { rerenderPage } = renderPage();
    const message = 'No reservations found.';
    expect(english.fleetOps.reservations.empty).toBe(message);
    expect(fleetOpsEnglish.fleetOps.reservations.empty).toBe(message);
    const card = sectionCard('Reservation calendar');
    expect(within(card).getByText(message)).toBeInTheDocument();
    expect(within(card).queryByText(/planning window/i)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Add reservation' })).toBeEnabled();
    expect(scopeCalls.reservations).toHaveBeenLastCalledWith({ limit: 100 });
    const [vehicleId, from, to] = scopeCalls.forecast.mock.calls.at(-1)!;
    expect(vehicleId).toBeUndefined();
    expect(Date.parse(to) - Date.parse(from)).toBe(14 * 24 * 60 * 60 * 1000);
    expect(new Date(from).getUTCHours()).toBe(0);

    sectionState.sources.reservations = {};
    rerenderPage();
    expect(within(card).queryByText(message)).not.toBeInTheDocument();
    expect(within(card).getAllByText('Airport run').length).toBeGreaterThan(0);
    expect(within(card).getByRole('table', { hidden: true })).toHaveTextContent('Confirmed');
    expect(scopeCalls.reservations).toHaveBeenLastCalledWith({ limit: 100 });
    expect(scopeCalls.forecast).toHaveBeenLastCalledWith(undefined, from, to);
  });

  it.each(sections)('keeps %s awaiting until its source resolves, with paused retry isolated', (source, title, empty) => {
    sectionState.sources[source] = { unavailable: true, loading: true };
    const { rerenderPage } = renderPage();
    expect(within(sectionCard(title)).getByRole('status')).toHaveTextContent('Loading...');
    expect(within(sectionCard(title)).getByRole('status')).toHaveAttribute('aria-busy', 'true');
    if (empty) expect(screen.queryByText(empty)).not.toBeInTheDocument();
    sectionState.sources[source] = { unavailable: true };
    rerenderPage();
    expect(within(sectionCard(title)).getByRole('status')).toHaveTextContent('Awaiting source');
    sectionState.sources[source] = { unavailable: true, paused: true };
    rerenderPage();
    expect(within(sectionCard(title)).getByRole('status')).toHaveTextContent('Refresh paused');
    expect(within(sectionCard(title)).getByRole('status')).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(within(sectionCard(title)).getByRole('button', { name: 'Retry' }));
    expect(sectionState.retries[source]).toHaveBeenCalledTimes(1);
    for (const [key, retry] of Object.entries(sectionState.retries)) {
      if (key !== source) expect(retry).not.toHaveBeenCalled();
    }
    sectionState.sources[source] = { empty: true };
    rerenderPage();
    expect(within(sectionCard(title)).queryByText('Awaiting source')).not.toBeInTheDocument();
    expect(within(sectionCard(title)).queryByText('Refresh paused')).not.toBeInTheDocument();
    if (empty) expect(within(sectionCard(title)).getByText(empty)).toBeInTheDocument();
    else expect(within(sectionCard(title)).getByText('No data available')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each(sections)('isolates initial %s failure and recovers without removing other sections', (source, title) => {
    sectionState.sources[source] = { unavailable: true, error: new Error(`${title} unavailable`) };
    const { rerenderPage } = renderPage();
    const card = sectionCard(title);
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(sectionState.retries[source]).toHaveBeenCalledTimes(1);
    for (const [key, retry] of Object.entries(sectionState.retries)) {
      if (key !== source) expect(retry).not.toHaveBeenCalled();
    }
    for (const [, sectionTitle] of sections) {
      expect(screen.getByRole('heading', { name: sectionTitle })).toBeInTheDocument();
    }
    sectionState.sources[source] = {};
    rerenderPage();
    expect(within(sectionCard(title)).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each(sections)('retains %s content through refresh, pause, failure and recovery', (source, title) => {
    const { rerenderPage } = renderPage();
    const card = sectionCard(title);
    const content = card.textContent;
    sectionState.sources[source] = { loading: true, fetching: true };
    rerenderPage();
    expect(sectionCard(title)).toBe(card);
    expect(card.textContent).toBe(content);
    sectionState.sources[source] = { paused: true };
    rerenderPage();
    expect(card.textContent).toBe(content);
    sectionState.sources[source] = { error: new Error(`${title} refresh failed`) };
    rerenderPage();
    expect(card.textContent).toBe(content);
    const warning = screen.getByText(`${title} may be out of date`).closest<HTMLElement>('[data-testid="stale-refresh-warning"]');
    if (!warning) throw new Error('Refresh warning missing');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(sectionState.retries[source]).toHaveBeenCalledTimes(1);
    for (const [key, retry] of Object.entries(sectionState.retries)) {
      if (key !== source) expect(retry).not.toHaveBeenCalled();
    }
    sectionState.sources[source] = {};
    rerenderPage();
    expect(screen.queryByText(`${title} may be out of date`)).not.toBeInTheDocument();
    expect(card.textContent).toBe(content);
  });

  it('keeps cost-center records and independently known totals when allocation dependencies have not resolved', () => {
    sectionState.sources.reservations = { unavailable: true, paused: true };
    sectionState.sources.workOrders = { unavailable: true, error: new Error('Orders unavailable') };
    const { rerenderPage } = renderPage();
    const card = sectionCard('Cost-center allocation');
    expect(within(card).getByText('Field team')).toBeInTheDocument();
    expect(within(card).getAllByText('—')).toHaveLength(2);
    expect(within(card).getByText('Maintenance cost: —')).toBeInTheDocument();
    const retries = within(card).getAllByRole('button', { name: 'Retry' });
    fireEvent.click(retries[0]);
    expect(sectionState.retries.reservations).toHaveBeenCalledTimes(1);
    expect(sectionState.retries.workOrders).not.toHaveBeenCalled();
    fireEvent.click(retries[1]);
    expect(sectionState.retries.workOrders).toHaveBeenCalledTimes(1);
    expect(sectionState.retries.costCenters).not.toHaveBeenCalled();
    sectionState.sources.reservations = { empty: true };
    sectionState.sources.workOrders = { empty: true };
    rerenderPage();
    expect(within(card).getAllByText('0')).toHaveLength(2);
    expect(within(card).getByText('Maintenance cost: —')).toBeInTheDocument();
  });

  it('renders authoritative zero forecast and maintenance values without marking them empty', () => {
    sectionState.sources.forecast = { zero: true };
    sectionState.sources.workOrders = { zero: true };
    renderPage();
    const forecast = sectionCard('Utilization forecast');
    expect(within(forecast).queryByText('No data available')).not.toBeInTheDocument();
    const table = within(forecast).getByRole('table', { hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(rows[1]).toHaveTextContent('0');
    expect(within(sectionCard('Cost-center allocation')).getByText('Maintenance cost: $0.00')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-operations-summary').querySelector('[data-operational-metric="forecast"]'))
      .toHaveAttribute('data-value-state', 'value');
  });

  it('exposes initial vehicle failure and retries only that source without removing fleet panels', () => {
    fleetPageState.vehiclesUnavailable = true;
    fleetPageState.vehiclesError = new Error('Vehicle choices unavailable');
    const { rerenderPage } = renderPage();
    expect(screen.getByText('Failed to load vehicles.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeDisabled();
    expect(screen.queryByText('No vehicles yet')).not.toBeInTheDocument();
    for (const title of ['Reservation calendar', 'Fleet drivers', 'Assignment roster',
      'Cost-center allocation', 'Charging policy matrix', 'Maintenance work-order board',
      'Utilization forecast']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(vehiclesRefetch).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    fleetPageState.vehiclesUnavailable = false;
    fleetPageState.vehiclesError = null;
    rerenderPage();
    expect(screen.queryByText('Failed to load vehicles.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeEnabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('shows initial vehicle loading rather than an empty fleet while independent records remain usable', () => {
    fleetPageState.vehiclesUnavailable = true;
    fleetPageState.vehiclesLoading = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
    expect(screen.queryByText('No vehicles yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeEnabled();
    expect(screen.getByTestId('fleet-operations-summary')).toHaveTextContent('Fleet-wide');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('explains an authoritative empty fleet without hiding loaded operational records', () => {
    fleetPageState.vehiclesEmpty = true;
    renderPage();
    expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    expect(screen.getByText(/Connect your Tesla account and sync your vehicles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeDisabled();
    expect(screen.queryByText('Failed to load vehicles.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Utilization forecast' })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('describes paused initial vehicle discovery without inventing an offline or empty fleet', () => {
    fleetPageState.vehiclesUnavailable = true;
    fleetPageState.vehiclesPaused = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'Refresh paused' })).toHaveTextContent('Refresh paused');
    expect(screen.queryByRole('status', { name: 'Loading...' })).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicles yet')).not.toBeInTheDocument();
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeEnabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('retains usable vehicle choices after refresh failure and preserves the accessible reservation action', () => {
    fleetPageState.vehiclesError = new Error('Vehicle refresh failed');
    renderPage();
    expect(screen.getByText('Fleet may be out of date')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load vehicles.')).not.toBeInTheDocument();
    const reserve = screen.getByRole('button', { name: 'New reservation' });
    expect(reserve).toBeEnabled();
    expect(reserve).toHaveClass('min-h-11', 'md:min-h-10');
    expect(reserve.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(reserve);
    const dialog = screen.getByRole('dialog', { name: 'Create reservation' });
    expect(within(dialog).getByRole('option', { name: 'Pool Y' })).toHaveValue('7');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('retains an intentionally empty driver value selection through failed refresh and recovery', () => {
    const { rerenderPage } = renderPage();
    const driverCard = screen.getByRole('heading', { name: 'Fleet drivers' }).closest<HTMLElement>('[data-card]');
    if (!driverCard) throw new Error('Fleet drivers card missing');
    fireEvent.click(within(driverCard).getByRole('button', { name: 'Driver filter' }));
    const filter = screen.getByRole('dialog', { name: 'Driver filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Edit Driver A' })).not.toBeInTheDocument();

    fleetPageState.driversError = new Error('Driver roster refresh failed');
    rerenderPage();
    expect(screen.getByText('Fleet drivers may be out of date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Driver A' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assignment roster' })).toBeInTheDocument();
    const retainedFilterButton = within(driverCard).getByRole('button', { name: 'Driver filter' });
    fireEvent.click(retainedFilterButton);
    expect(screen.getByRole('checkbox', { name: 'Driver A' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fleetPageState.driversError = null;
    rerenderPage();
    expect(screen.queryByText('Fleet drivers may be out of date')).not.toBeInTheDocument();
    expect(within(driverCard).getByRole('button', { name: 'Driver filter' })).toBe(retainedFilterButton);
    expect(screen.queryByRole('button', { name: 'Edit Driver A' })).not.toBeInTheDocument();
    fireEvent.click(retainedFilterButton);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Driver A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('retains the forecast data alternative and export menu when only the forecast refresh fails', () => {
    const { rerenderPage } = renderPage();
    const table = screen.getByRole('table', { name: 'Utilization forecast — data table', hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true }).map(row => row.textContent);
    fleetPageState.forecastError = new Error('Forecast refresh failed');
    rerenderPage();
    expect(screen.getByRole('table', { name: 'Utilization forecast — data table', hidden: true })).toBe(table);
    expect(within(table).getAllByRole('row', { hidden: true }).map(row => row.textContent)).toEqual(rows);
    expect(screen.getByText('Utilization forecast may be out of date')).toBeInTheDocument();
    expect(screen.getByText('Moderate history.')).toBeInTheDocument();
    const brief = screen.getByTestId('fleet-operations-summary');
    expect(brief).toHaveTextContent('Retained source data');
    const forecastMetric = brief.querySelector('[data-operational-metric="forecast"]');
    expect(forecastMetric).toHaveAttribute('data-value-state', 'value');
    expect(forecastMetric?.querySelector('[data-operational-value]')).toHaveTextContent('20');
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    for (const action of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(screen.getByRole('menuitem', { name: action })).toBeEnabled();
    }
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('enables loaded-value checklists only when each complete fleet list is loaded', () => {
    const view = renderPage();
    for (const column of ['Reference', 'Ends', 'Reservation', 'Max power']) {
      expect(screen.getByRole('button', { name: `${column} filter` })).toBeInTheDocument();
    }
    view.unmount();
    fleetPageState.total = 101;
    renderPage();
    for (const column of ['Reference', 'Ends', 'Reservation', 'Max power']) {
      expect(screen.queryByRole('button', { name: `${column} filter` })).not.toBeInTheDocument();
    }
    expect(screen.getByText('Fleet drivers')).toBeInTheDocument();
    expect(screen.getByText('Charging policy matrix')).toBeInTheDocument();
  });

  it('renders every operational panel and opens the reservation workflow', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Fleet operations' })).toBeInTheDocument();
    expect(screen.getByText('Reservation calendar')).toBeInTheDocument();
    expect(screen.getByText('Fleet drivers')).toBeInTheDocument();
    expect(screen.getByText('Assignment roster')).toBeInTheDocument();
    expect(screen.getByText('Cost-center allocation')).toBeInTheDocument();
    expect(screen.getByText('Charging policy matrix')).toBeInTheDocument();
    expect(screen.getByText('Maintenance work-order board')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Utilization forecast' })).toBeInTheDocument();
    expect(screen.getAllByText('Pool Y').length).toBeGreaterThan(0);
    const reservation = screen.getByRole('button', { name: 'New reservation' });
    expect(reservation.closest('[data-action-group]')).toHaveAttribute('data-action-group', 'primary');
    const heading = screen.getByRole('heading', { level: 1, name: 'Fleet operations' });
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    expect(heading.closest('header')).toHaveClass('border-0', 'bg-transparent');
    fireEvent.click(reservation);
    expect(screen.getByRole('dialog', { name: 'Create reservation' })).toBeInTheDocument();
  });

  it('opens the actual summary drawer without displacing operational entities or write workflows', async () => {
    renderPage();
    const brief = screen.getByTestId('fleet-operations-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief).toHaveTextContent('Fleet-wide · Loaded operational records');
    expect(brief).toHaveTextContent('1 loaded of 1 source records; offset 0, limit 100');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog', { name: 'Operational record summary details' });
    expect(drawer).toHaveTextContent('Requested or confirmed reservations in the loaded records.');
    expect(drawer).toHaveTextContent('not a count of assignments active at this instant');
    expect(drawer).toHaveTextContent('Forecast limitations: Moderate history.');
    expect(drawer).toHaveTextContent('Loaded counts are not server-wide totals.');
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Operational record summary details' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeEnabled();
    expect(screen.getByRole('table', { name: 'Utilization forecast — data table', hidden: true })).toBeInTheDocument();
  });

  it('keeps retained roster rows and all independently usable operational panels on refresh failure', () => {
    fleetPageState.driversError = new Error('driver refresh failed');
    renderPage();
    expect(screen.getAllByText('Driver A').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Edit Driver A' })).toBeInTheDocument();
    expect(screen.getByText('Fleet drivers may be out of date')).toBeInTheDocument();
    for (const title of ['Reservation calendar', 'Assignment roster', 'Cost-center allocation',
      'Charging policy matrix', 'Maintenance work-order board', 'Utilization forecast']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByTestId('fleet-operations-summary')).toHaveAttribute('data-operational-brief');
    expect(document.querySelector('[data-chart-key="fleet-ops-utilization"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('contains an initial driver failure without removing reservation or forecast actions', () => {
    fleetPageState.driversError = new Error('drivers unavailable');
    fleetPageState.driversUnavailable = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New reservation' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Assignment roster' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Utilization forecast' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Driver A' })).not.toBeInTheDocument();
  });

  it('renders the read-only explanation outside the disabled reservation action', () => {
    operationalMode.canWrite = false;
    operationalMode.writeBlockReason =
      'Reconnect before making operational changes.';
    renderPage();

    const reservationButton = screen.getByRole('button', { name: 'New reservation' });
    const noticeTitle = screen.getByText('Fleet operations is read-only');

    expect(reservationButton).toBeDisabled();
    expect(reservationButton).toHaveAttribute(
      'title',
      'Reconnect before making operational changes.',
    );
    expect(noticeTitle.closest('button')).toBeNull();
    expect(
      screen.getByText('Reconnect before making operational changes.'),
    ).toBeInTheDocument();
  });

  it('creates and version-updates a driver with typed payloads', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add driver' }));
    const createDialog = screen.getByRole('dialog', { name: 'Add driver' });
    fireEvent.change(within(createDialog).getByLabelText(/Display name/), { target: { value: 'Driver B' } });
    fireEvent.change(within(createDialog).getByLabelText(/Non-sensitive reference code/), { target: { value: 'DRV-B' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenLastCalledWith(
      {
        display_name: 'Driver B',
        reference_code: 'DRV-B',
        status: 'active',
        max_charge_soc: null,
        curfew_start: null,
        curfew_end: null,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    mutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Driver A' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit driver' });
    fireEvent.change(within(editDialog).getByLabelText(/Display name/), { target: { value: 'Driver A2' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 2,
        version: 3,
        input: {
          display_name: 'Driver A2',
          reference_code: 'DRV-A',
          status: 'active',
          max_charge_soc: null,
          curfew_start: null,
          curfew_end: null,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('passes the current version when deleting a driver', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Driver A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 2, version: 3 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('opens each fleet resource creation workflow', () => {
    renderPage();
    const workflows = [
      ['Add assignment', 'Add assignment'],
      ['Add cost center', 'Add cost center'],
      ['Add policy', 'Add charging policy'],
      ['Add work order', 'Add work order'],
    ];
    workflows.forEach(([buttonName, dialogName]) => {
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('submits normalized charging windows', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
    const dialog = screen.getByRole('dialog', { name: 'Add charging policy' });
    fireEvent.change(within(dialog).getByLabelText(/Vehicle/), { target: { value: '7' } });
    fireEvent.change(within(dialog).getByLabelText(/Policy name/), { target: { value: 'Overnight' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle_id: 7,
        name: 'Overnight',
        target_soc_pct: 80,
        max_power_w: null,
        windows: [{
          day_of_week: 1,
          start_local_time: '00:00',
          end_local_time: '06:00',
        }],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('edits a timeline reservation with its optimistic version', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Airport run' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Edit reservation' });
    fireEvent.change(within(dialog).getByLabelText(/Reservation name/), {
      target: { value: 'Airport return' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 3,
        version: 1,
        input: expect.objectContaining({
          vehicle_id: 7,
          driver_id: 2,
          cost_center_id: 4,
          title: 'Airport return',
          status: 'confirmed',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('cancels a timeline reservation using a versioned update', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel Airport run' })[0]);
    expect(screen.getByRole('dialog', { name: 'Cancel reservation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: 3,
        version: 1,
        input: expect.objectContaining({
          title: 'Airport run',
          status: 'cancelled',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('deletes a timeline reservation with its optimistic version', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Airport run' })[0]);
    expect(screen.getByRole('dialog', { name: 'Delete reservation?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 3, version: 1 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
