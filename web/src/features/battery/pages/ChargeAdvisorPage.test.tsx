import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-06-02T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  drives: undefined as unknown,
  charging: undefined as unknown,
  timeZone: 'America/Los_Angeles',
  driveHook: vi.fn(),
  chargingHook: vi.fn(),
  timezoneHook: vi.fn(),
  driveRefetch: vi.fn(),
  chargingRefetch: vi.fn(),
  live: {
    state: {
      batteryLevel: 80,
      chargeLimitSoc: 80,
      isCharging: false,
      lastUpdated: new Date(Date.parse('2026-06-02T12:00:00.000Z')),
      signalCount: 1,
    },
    connected: true,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        options?.[name] == null ? '' : String(options[name]));
    },
  }),
}));

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.driveHook(vehicleId, limit);
      return h.drives;
    },
  };
});

vi.mock('@/api/hooks/useCharging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return {
    ...actual,
    useChargingHistory: (vehicleId?: string, limit?: number) => {
      h.chargingHook(vehicleId, limit);
      return h.charging;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Test Tesla', vin: 'TEST' }],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: string) => {
      h.timezoneHook(mode);
      return h.timeZone;
    },
  };
});

vi.mock('@/hooks/useVehicleLive', () => ({
  useVehicleLive: () => h.live,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 1, locale: 'en-US',
    },
    formatEnergy: (value: number | null | undefined) =>
      value == null || !Number.isFinite(value) ? '—' : `${(value / 1_000).toFixed(1)} kWh`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import ChargeAdvisorPage from './ChargeAdvisorPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function query(
  data: unknown,
  overrides: Partial<QueryStub> = {},
  refetch: () => void = vi.fn(),
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: overrides.error ?? null,
    refetch,
    ...overrides,
  };
}

function driveAt(date: string, burn = 5): Drive {
  const startTs = `${date}T09:00:00Z`;
  return {
    id: Date.parse(startTs),
    vehicleId: 7,
    startTs,
    endTs: `${date}T09:30:00Z`,
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 80 - burn,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
  };
}

function chargingAt(date: string): ChargingSession {
  return {
    id: date,
    vehicle_id: '7',
    charger_type: 'home',
    start_soc_pct: 30,
    end_soc_pct: 80,
    total_energy_added_wh: 20_000,
    peak_power_w: 7_200,
    cost_decimal: null,
    started_at: `${date}T20:00:00Z`,
    ended_at: `${date}T21:00:00Z`,
    start_ts: `${date}T20:00:00Z`,
    startedAt: `${date}T20:00:00Z`,
    duration_min: 60,
  };
}

function readyDrives(): Drive[] {
  return [
    '2026-05-01',
    '2026-05-05',
    '2026-05-09',
    '2026-05-13',
    '2026-05-17',
    '2026-05-21',
    '2026-05-25',
    '2026-05-29',
  ].map((date) => driveAt(date));
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/battery/charge-advisor']}>
          <ChargeAdvisorPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(tree(client));
  return { ...view, rerenderPage: () => view.rerender(tree(client)) };
}

const sectionIds = [
  'charge-advisor-kpis',
  'charge-advisor-current',
  'charge-advisor-scenarios',
  'charge-advisor-directory',
  'charge-advisor-weekday',
  'charge-advisor-support',
  'charge-advisor-trend',
  'charge-advisor-distribution',
  'charge-advisor-sensitivity',
  'charge-advisor-charging-profile',
  'charge-advisor-charging-timing',
  'charge-advisor-accounting',
  'charge-advisor-methodology',
] as const;

function expectEveryShell(): void {
  for (const id of sectionIds) expect(screen.getByTestId(id)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  h.drives = query(readyDrives(), {}, h.driveRefetch);
  h.charging = query([chargingAt('2026-05-30')], {}, h.chargingRefetch);
  h.live = {
    state: {
      batteryLevel: 80,
      chargeLimitSoc: 80,
      isCharging: false,
      lastUpdated: new Date(FROZEN_NOW),
      signalCount: 1,
    },
    connected: true,
  };
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('ChargeAdvisorPage', () => {
  it('reviews real independent drive and charging row evidence without replacing the accounting categories', () => {
    renderPage();
    const accounting = screen.getByTestId('charge-advisor-accounting');
    const driveBrief = within(accounting).getByRole('region', { name: 'Drive-row evidence summary' });
    const chargingBrief = within(accounting).getByRole('region', { name: 'Charging-row evidence summary' });
    expect(driveBrief.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(3);
    expect(chargingBrief.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(3);
    expect(within(driveBrief).getByText('Returned rows').closest('[data-operational-metric]')?.querySelector('[data-operational-value]')).toHaveTextContent('8');
    expect(within(chargingBrief).getByText('Returned rows').closest('[data-operational-metric]')?.querySelector('[data-operational-value]')).toHaveTextContent('1');
    fireEvent.click(within(driveBrief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Returned rows')).toBeVisible();
    expect(within(drawer).getByText('Returned histories; qualification uses the stated local-date analysis window. Counts are not lifetime totals.')).toBeVisible();
  });

  it('renders all thirteen persistent shells and both capped analytical hooks', () => {
    renderPage();
    expectEveryShell();
    expect(h.driveHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.chargingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the analysis clock across cached query rerenders', () => {
    const view = renderPage();
    expect(screen.getByText(/through 2026-06-02/)).toBeInTheDocument();
    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 20 * 86_400_000);
    view.rerenderPage();
    expect(screen.getByText(/through 2026-06-02/)).toBeInTheDocument();
  });

  it('advances only the live validation clock when a live snapshot updates', () => {
    const view = renderPage();
    expect(screen.getByText('Live signal')).toBeInTheDocument();
    expect(screen.getByText(/through 2026-06-02/)).toBeInTheDocument();

    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 2 * 60 * 1_000);
    h.live = {
      state: {
        batteryLevel: 79,
        chargeLimitSoc: 85,
        isCharging: false,
        lastUpdated: new Date(FROZEN_NOW + 60 * 1_000),
        signalCount: 1,
      },
      connected: true,
    };
    view.rerenderPage();

    expect(screen.getByText('Live signal')).toBeInTheDocument();
    expect(screen.getByText('Charge limit 85.00%')).toBeInTheDocument();
    expect(screen.getByText(/through 2026-06-02/)).toBeInTheDocument();
  });

  it('recomputes scenarios when the shared reserve selector changes', () => {
    renderPage();
    const selector = screen.getByLabelText('Reserve floor');
    fireEvent.change(selector, { target: { value: '30' } });
    const sensitivity = within(screen.getByTestId('charge-advisor-sensitivity'));
    expect(sensitivity.getByText('30.00%')).toBeInTheDocument();
    expect(sensitivity.getByText('Selected')).toBeInTheDocument();
  });

  it('shows live current-state provenance and charge limit', () => {
    renderPage();
    const current = within(screen.getByTestId('charge-advisor-current'));
    expect(current.getByText('Live signal')).toBeInTheDocument();
    expect(current.getByText('80.00%')).toBeInTheDocument();
    expect(current.getByText('Charge limit 80.00%')).toBeInTheDocument();
  });

  it('keeps every shell visible with no selected vehicle', () => {
    h.vehicleId = null;
    renderPage();
    expectEveryShell();
    expect(screen.getAllByText(/Select a vehicle/).length).toBeGreaterThan(3);
  });

  it('keeps every shell visible while either history source is loading', () => {
    h.drives = query(undefined, { isLoading: true, isSuccess: false });
    h.charging = query(undefined, { isLoading: true, isSuccess: false });
    renderPage();
    expectEveryShell();
  });

  it('keeps completed charging and observed live provenance usable while drive history initially loads', () => {
    h.drives = query(undefined, { isLoading: true, isSuccess: false });
    renderPage();
    expectEveryShell();
    const charging = within(screen.getByTestId('charge-advisor-charging-profile'));
    expect(charging.getByText('20.0 kWh')).toBeInTheDocument();
    expect(charging.getByText('Median end 80.00%')).toBeInTheDocument();
    expect(charging.getByText('1 rows with valid Wh')).toBeInTheDocument();
    const current = within(screen.getByTestId('charge-advisor-current'));
    expect(current.getByText('Live signal')).toBeInTheDocument();
    expect(current.getByText('80.00%')).toBeInTheDocument();
    expect(within(screen.getByTestId('charge-advisor-trend')).queryByRole('table', { hidden: true }))
      .not.toBeInTheDocument();
    expect(h.driveHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.chargingHook).toHaveBeenLastCalledWith('7', 1_000);
  });

  it('keeps all daily observations and seven-day scenarios while charging history initially loads', () => {
    h.charging = query(undefined, { isLoading: true, isSuccess: false });
    renderPage();
    expectEveryShell();
    const trend = within(screen.getByTestId('charge-advisor-trend')).getByRole('table', { hidden: true });
    expect(within(trend).getAllByRole('row', { hidden: true })).toHaveLength(9);
    const scenarios = within(screen.getByTestId('charge-advisor-scenarios')).getByRole('table', { hidden: true });
    expect(within(scenarios).getAllByRole('columnheader', { hidden: true })).toHaveLength(5);
    expect(within(scenarios).getAllByRole('row', { hidden: true })).toHaveLength(8);
    const directory = screen.getByTestId('charge-advisor-directory');
    expect(directory.querySelectorAll('article')).toHaveLength(7);
    expect(within(directory).getByText('2026-06-03')).toBeInTheDocument();
    expect(within(directory).getByText('2026-06-09')).toBeInTheDocument();
    expect(within(screen.getByTestId('charge-advisor-current')).getByText('Live signal')).toBeInTheDocument();
    expect(within(screen.getByTestId('charge-advisor-charging-profile')).queryByText('20.0 kWh'))
      .not.toBeInTheDocument();
  });

  it.each(['drive', 'charging'] as const)(
    'retains every actual scenario/trend cell and independent live provenance after a cached %s refresh failure',
    failedSource => {
      const view = renderPage();
      const rows = (testId: string) => {
        const table = within(screen.getByTestId(testId)).getByRole('table', { hidden: true });
        return within(table).getAllByRole('row', { hidden: true }).slice(1).map(row =>
          within(row).getAllByRole('cell', { hidden: true }).map(cell => cell.textContent));
      };
      const beforeTrend = rows('charge-advisor-trend');
      const beforeScenarios = rows('charge-advisor-scenarios');
      expect(beforeTrend).toHaveLength(8);
      expect(beforeScenarios).toHaveLength(7);
      expect(beforeScenarios.every(row => row.length === 5)).toBe(true);
      if (failedSource === 'drive') {
        h.drives = query(readyDrives(), { isError: true, error: new Error('drive refresh failed') }, h.driveRefetch);
      } else {
        h.charging = query([chargingAt('2026-05-30')], { isError: true, error: new Error('charging refresh failed') }, h.chargingRefetch);
      }
      view.rerenderPage();
      expect(rows('charge-advisor-trend')).toEqual(beforeTrend);
      expect(rows('charge-advisor-scenarios')).toEqual(beforeScenarios);
      expect(within(screen.getByTestId('charge-advisor-charging-profile')).getByText('20.0 kWh')).toBeInTheDocument();
      expect(within(screen.getByTestId('charge-advisor-current')).getByText('Live signal')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
      expect(h.driveRefetch).toHaveBeenCalledTimes(failedSource === 'drive' ? 1 : 0);
      expect(h.chargingRefetch).toHaveBeenCalledTimes(failedSource === 'charging' ? 1 : 0);
    },
  );

  it('uses one retry surface for an initial drive/charging failure', () => {
    h.drives = query(undefined, { isError: true, isSuccess: false, error: new Error('drive') }, h.driveRefetch);
    h.charging = query(undefined, { isError: true, isSuccess: false, error: new Error('charge') }, h.chargingRefetch);
    renderPage();
    expectEveryShell();
    expect(screen.getAllByRole('button', { name: /retry/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.driveRefetch).toHaveBeenCalled();
    expect(h.chargingRefetch).toHaveBeenCalled();
  });

  it('keeps cached evidence visible with one refresh retry', () => {
    h.drives = query(readyDrives(), { isError: true, error: new Error('refresh') }, h.driveRefetch);
    h.charging = query([chargingAt('2026-05-30')], { isError: true, error: new Error('refresh') }, h.chargingRefetch);
    renderPage();
    expectEveryShell();
    expect(screen.getByText(/most recently loaded evidence/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i })).toHaveLength(1);
  });

  it('discloses charging failure while keeping drive evidence usable', () => {
    h.charging = query(undefined, { isError: true, isSuccess: false, error: new Error('charging') });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByText(/Charging history is unavailable/).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('charge-advisor-weekday')).getByText('Weekday use distribution')).toBeInTheDocument();
  });

  it('keeps shells visible for empty and unqualified drive history', () => {
    h.drives = query([]);
    const emptyView = renderPage();
    expectEveryShell();
    expect(screen.getByText(/qualified drive-associated/)).toBeInTheDocument();
    emptyView.unmount();

    h.drives = query([driveAt('2026-06-01', 0)]);
    const view = renderPage();
    expectEveryShell();
    expect(screen.getByText(/qualified local-day/)).toBeInTheDocument();
    view.unmount();
  });

  it('shows unavailable and stale current states without actionable claims', () => {
    h.drives = query([]);
    h.charging = query([]);
    h.live = {
      state: { batteryLevel: 0, chargeLimitSoc: 0, isCharging: false, lastUpdated: null, signalCount: 0 },
      connected: false,
    };
    const unavailableView = renderPage();
    expectEveryShell();
    expect(screen.getByText('Current state unavailable')).toBeInTheDocument();
    unavailableView.unmount();

    h.drives = query([driveAt('2026-05-20')]);
    h.charging = query([]);
    const view = renderPage();
    expectEveryShell();
    expect(screen.getByText('Current state is stale')).toBeInTheDocument();
    view.unmount();
  });

  it('shows thin support and both exact cap warnings honestly', () => {
    h.drives = query([driveAt('2026-06-01')]);
    const thinView = renderPage();
    expectEveryShell();
    expect(screen.getByText('More history needed')).toBeInTheDocument();
    thinView.unmount();

    h.drives = query(Array.from({ length: 1_000 }, () => driveAt('2026-05-01')));
    h.charging = query(Array.from({ length: 1_000 }, () => chargingAt('2026-05-01')));
    const view = renderPage();
    expectEveryShell();
    expect(screen.getByText(/Exactly 1000 drive rows/)).toBeInTheDocument();
    expect(screen.getByText(/Exactly 1000 charging rows/)).toBeInTheDocument();
    view.unmount();
  });

  it('uses descriptive terminology and chart accessibility data', () => {
    renderPage();
    expect(screen.queryByText(/Plug in|Skip it|no reserve risk|forecast probability/i)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Mean and calendar-day p75 battery percentage paths/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Observed daily drive-associated/ })).toBeInTheDocument();
    expect(screen.getByText(/Omitted inputs/)).toBeInTheDocument();
  });

  it('renders a charging-state precedence message from the live snapshot', () => {
    h.live = {
      state: {
        batteryLevel: 25,
        chargeLimitSoc: 80,
        isCharging: true,
        lastUpdated: new Date(FROZEN_NOW),
        signalCount: 1,
      },
      connected: true,
    };
    renderPage();
    expectEveryShell();
    expect(screen.getByText('Already charging')).toBeInTheDocument();
    expect(screen.getByText('Charging now')).toBeInTheDocument();
  });

  it('keeps all shells while rejecting invalid live charging fields', () => {
    h.live = {
      state: {
        batteryLevel: 25,
        chargeLimitSoc: 80,
        isCharging: true,
        lastUpdated: new Date(FROZEN_NOW + 60 * 1_000),
        signalCount: 1,
      },
      connected: true,
    };
    renderPage();
    expectEveryShell();
    expect(screen.queryByText('Already charging')).not.toBeInTheDocument();
    expect(screen.queryByText('Charge limit 80.00%')).not.toBeInTheDocument();
  });
});
