import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLifetimeStats, type LifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import LifetimeStatsWidget from './LifetimeStatsWidget';
import type { WidgetProps } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const settingsState = vi.hoisted(() => ({ unitOfLength: 'km' as 'km' | 'mi' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        let text = fallbackOrOpts;
        if (opts) {
          Object.entries(opts).forEach(([key, value]) => {
            text = text.replace(`{{${key}}}`, String(value));
          });
        }
        return text;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: settingsState.unitOfLength,
        unit_of_temp: 'C',
        unit_of_pressure: 'bar',
        decimal_precision: 0,
        locale: 'en-US',
      },
      isMiles: settingsState.unitOfLength === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 0,
      locale: 'en-US',
      density: 'comfortable',
      rangeType: 'rated',
    }),
  };
});

vi.mock('@/api/hooks/useAnalytics', () => ({ useLifetimeStats: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

const mockLifetime = useLifetimeStats as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

function makeQuery(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeStats(over: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    total_drives: 2914,
    total_distance_km: 50000,
    total_driving_hours: 800,
    longest_drive_km: 500,
    highest_speed_kmh: 180,
    avg_efficiency_wh_km: 160,
    total_charge_sessions: 300,
    total_energy_kwh: 7604,
    total_charging_hours: 400,
    total_charging_cost: 456.78,
    gas_equivalent_cost: 3000,
    total_savings: 2500,
    co2_offset_kg: 9800,
    trees_equivalent: 50,
    earth_circumferences: 1.2,
    moon_trips: 0.1,
    days_on_road: 33,
    homes_equivalent_days: 20,
    first_drive_date: null,
    ownership_days: 1021,
    most_active_day_of_week: 'Monday',
    most_active_hour: 8,
    longest_drive_record: { value: 500, date: '2021-06-01' },
    highest_speed_record: { value: 180, date: '2021-07-01' },
    max_charge_record: { value: 75, date: '2021-08-01' },
    achievements: [],
    ...over,
  };
}

async function renderWidget(
  props: Partial<WidgetProps> = {},
  packId: PackId = 'classic',
  expectPresentation = true,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PackBoundary requestedPackId={packId}>
          <LifetimeStatsWidget size={{ cols: 2, rows: 2 }} {...props} />
        </PackBoundary>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  if (packId !== 'classic' && expectPresentation) {
    await waitFor(() => expect(
      view.container.querySelector('[data-status-appearance]'),
    ).toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]));
  }
  return view;
}

beforeEach(() => {
  settingsState.unitOfLength = 'km';
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mockLifetime.mockReset();
  mockVehicles.mockReset();
  mockVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockLifetime.mockReturnValue(makeQuery({ data: makeStats() }));
});

describe.each(PACK_IDS)('LifetimeStatsWidget %s', (packId) => {
  const renderPack = (props: Partial<WidgetProps> = {}, expectPresentation = true) =>
    renderWidget(props, packId, expectPresentation);

  it.each([1, 2, 3])('keeps the heading at %i columns', async (cols) => {
    await renderPack({ size: { cols, rows: 2 } });
    expect(screen.getByRole('heading', { name: 'Lifetime stats' })).toBeInTheDocument();
  });

  it('renders the five After-card values without a date or extra labels', async () => {
    const view = await renderPack();
    expect(view.container.querySelector('[data-data-state="ok"]')).not.toBeNull();
    expect(screen.getByText('Total distance')).toBeInTheDocument();
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByText('Total drives')).toBeInTheDocument();
    expect(screen.getByText('2,914')).toBeInTheDocument();
    expect(screen.getByText('Total energy')).toBeInTheDocument();
    expect(screen.getByText('7,604')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByText('CO₂ saved')).toBeInTheDocument();
    expect(screen.getByText('9.8')).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument();
    expect(screen.getByText('Ownership days')).toBeInTheDocument();
    expect(screen.getByText('1,021')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
    expect(screen.queryByText(/workspace date range/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
  });

  it('uses the user distance unit for the existing SI distance source', async () => {
    settingsState.unitOfLength = 'mi';
    await renderPack();
    expect(screen.getByText('31,069')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
  });

  it('renders one distance headline in compact mode', async () => {
    await renderPack({ size: { cols: 1, rows: 1 } });
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('lifetime')).toBeInTheDocument();
    expect(screen.queryByText('Total drives')).not.toBeInTheDocument();
  });

  it('keeps unknown values unknown and does not fabricate zeros', async () => {
    mockLifetime.mockReturnValue(makeQuery({
      data: makeStats({
        total_distance_km: undefined as unknown as number,
        total_drives: undefined as unknown as number,
        total_energy_kwh: undefined as unknown as number,
        co2_offset_kg: undefined as unknown as number,
        ownership_days: undefined as unknown as number,
      }),
    }));
    await renderPack();
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('preserves measured zeros instead of treating them as missing', async () => {
    mockLifetime.mockReturnValue(makeQuery({
      data: makeStats({
        total_distance_km: 0,
        total_drives: 0,
        total_energy_kwh: 0,
        co2_offset_kg: 0,
        ownership_days: 0,
      }),
    }));
    await renderPack();
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByText('0.0')).toBeInTheDocument();
    for (const unit of ['km', 'kWh', 't', 'days']) {
      expect(screen.getByText(unit)).toBeInTheDocument();
    }
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it.each([NaN, Infinity, -Infinity])('keeps non-finite readings unknown (%s)', async (value) => {
    mockLifetime.mockReturnValue(makeQuery({
      data: makeStats({
        total_distance_km: value,
        total_drives: value,
        total_energy_kwh: value,
        co2_offset_kg: value,
        ownership_days: value,
      }),
    }));
    await renderPack();
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText(/NaN|Infinity|^0$/)).not.toBeInTheDocument();
  });

  it('shows loading, empty, and initial error honestly', async () => {
    mockLifetime.mockReturnValue(makeQuery({ isLoading: true }));
    const loading = await renderPack({}, false);
    expect(loading.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    mockLifetime.mockReturnValue(makeQuery());
    const empty = await renderPack({}, false);
    expect(screen.getByText('No lifetime data')).toBeInTheDocument();
    empty.unmount();

    mockLifetime.mockReturnValue(makeQuery({ isError: true, error: new Error('boom') }));
    await renderPack({}, false);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No lifetime data')).not.toBeInTheDocument();
  });

  it('retains cached values during a background refresh error', async () => {
    mockLifetime.mockReturnValue(makeQuery({
      data: makeStats(),
      isError: true,
      error: new Error('boom'),
    }));
    const view = await renderPack();
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('7,604')).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('retains values and source trust while a background refresh is in flight', async () => {
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats(), isFetching: true }));
    const view = await renderPack();
    expect(view.container.querySelector('[data-data-state="ok"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('9.8')).toBeInTheDocument();
    expect(screen.queryByText('No lifetime data')).not.toBeInTheDocument();
  });

  it('refreshes and resolves the selected or first vehicle', async () => {
    const refetch = vi.fn();
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats(), refetch }));
    await renderPack({ vehicleId: 7 });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockLifetime).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle and disables the query without one', async () => {
    mockVehicles.mockReturnValue({ data: [{ id: 42 }] });
    await renderPack();
    expect(mockLifetime).toHaveBeenCalledWith('42');
    mockVehicles.mockReturnValue({ data: [] });
    await renderPack({ vehicleId: undefined });
    expect(mockLifetime).toHaveBeenCalledWith(undefined);
  });
});
