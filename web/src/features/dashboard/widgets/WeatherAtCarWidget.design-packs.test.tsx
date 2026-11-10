import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { VehicleStateReadings } from '@/api/types';
import WeatherAtCarWidget from './WeatherAtCarWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  state: vi.fn(),
  temperature: '°C' as '°C' | '°F',
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: mocks.vehicles,
  useVehicleState: mocks.state,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: mocks.temperature } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

interface WeatherSnapshot {
  state?: Pick<VehicleStateReadings, 'vehicle_id' | 'outside_temp'>;
  live: boolean;
  observedAt: number | null;
  freshness: 'fresh' | 'stale' | 'unknown';
}

interface QueryFixture<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

const productionPacks = PACK_IDS.filter((id): id is Exclude<PackId, 'classic'> => id !== 'classic');
const caveat = 'Do not infer weather conditions from temperature alone.';
const clients: QueryClient[] = [];

function makeQuery<T>(data: T | undefined, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, error: null, isLoading: false, isPending: false,
    isFetching: false, isStale: false, isError: false, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}

function snapshot(temperature: number | null = 18, overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    state: { vehicle_id: 9, outside_temp: temperature },
    live: true, observedAt: Date.now(), freshness: 'fresh', ...overrides,
  };
}

function renderWidget(packId: unknown = 'classic', props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <WeatherAtCarWidget vehicleId={9} size={{ cols: 2, rows: 2 }} {...props} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function expectPack(container: HTMLElement, packId: Exclude<PackId, 'classic'>) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="climate"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`,
  )).not.toBeNull());
  return container.querySelector<HTMLElement>('[data-widget-family="climate"]')!;
}

function expectFact(label: string, value: string) {
  expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value);
}

beforeEach(() => {
  mocks.temperature = '°C';
  mocks.vehicles.mockReset().mockReturnValue(makeQuery([{ id: 9 }]));
  mocks.state.mockReset().mockReturnValue(makeQuery(snapshot()));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(productionPacks)('Weather at Car %s production appearance', packId => {
  it.each([{ cols: 1, rows: 1 }, { cols: 2, rows: 2 }])(
    'preserves the real temperature, source and unknown conditions at %j',
    async size => {
      const { container } = renderWidget(packId, { size });
      const presentation = await expectPack(container, packId);
      expect(within(presentation).getByText('18°C')).toBeInTheDocument();
      expect(within(presentation).getByText('Outside temperature')).toBeInTheDocument();
      expect(within(presentation).getByText('AT VEHICLE')).toBeInTheDocument();
      expectFact('Source', 'Vehicle reading');
      expectFact('Conditions', '—');
      expect(within(presentation).getByText(caveat)).toBeInTheDocument();
      expect(presentation.querySelector('[data-climate-readout]')).toHaveAttribute('data-climate-readout', PACK_APPEARANCES[packId]);
      expect(presentation.querySelector('.lucide-thermometer')).toHaveAttribute('aria-hidden', 'true');
      expect(presentation.querySelector('.lucide-cloud-sun, .lucide-sun, .lucide-cloud-snow')).toBeNull();
      expect(within(presentation).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(mocks.state).toHaveBeenLastCalledWith(9, { refetchInterval: 30_000 });
    },
  );

  it('keeps the source and condition sections when the temperature is unavailable, without inventing zero', async () => {
    mocks.state.mockReturnValue(makeQuery(snapshot(null)));
    const { container } = renderWidget(packId);
    const presentation = await expectPack(container, packId);
    expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull();
    expect(within(presentation).getByText('Outside temperature')).toBeInTheDocument();
    expect(within(presentation).getByText('No weather data')).toBeInTheDocument();
    expectFact('Source', '—');
    expectFact('Conditions', '—');
    expect(within(presentation).getByText(caveat)).toBeInTheDocument();
    expect(screen.queryByText('0°C')).not.toBeInTheDocument();
    expect(screen.queryByText('Vehicle reading')).not.toBeInTheDocument();
  });

  it('retains the reading and refresh interaction after a background failure', async () => {
    const refetch = vi.fn();
    mocks.state.mockReturnValue(makeQuery(snapshot(-6), {
      isError: true, isStale: true, error: new Error('Refresh failed'), refetch,
    }));
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(screen.getByText('-6°C')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
    expectFact('Conditions', '—');
    expect(screen.getByText(caveat)).toBeInTheDocument();
  });

  it('converts real zero Celsius at the display boundary without fabricating snow conditions', async () => {
    mocks.temperature = '°F';
    const reading = snapshot(0);
    mocks.state.mockReturnValue(makeQuery(reading));
    const { container } = renderWidget(packId);
    const presentation = await expectPack(container, packId);
    expect(screen.getByText('32°F')).toBeInTheDocument();
    expect(screen.queryByText('0°C')).not.toBeInTheDocument();
    expectFact('Source', 'Vehicle reading');
    expectFact('Conditions', '—');
    expect(presentation.querySelector('.lucide-cloud-snow')).toBeNull();
    expect(reading.state?.outside_temp).toBe(0);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats malformed temperature %s as unknown instead of zero or extreme weather',
    async temperature => {
      mocks.state.mockReturnValue(makeQuery(snapshot(temperature)));
      const { container } = renderWidget(packId);
      const presentation = await expectPack(container, packId);
      expect(screen.getByText('No weather data')).toBeInTheDocument();
      expectFact('Conditions', '—');
      expect(presentation.querySelector('.lucide-cloud-snow, .lucide-sun')).toBeNull();
      expect(screen.queryByText(/NaN|Infinity|0°C/)).not.toBeInTheDocument();
    },
  );

  it('preserves the empty source shell when no vehicle snapshot has arrived', async () => {
    mocks.state.mockReturnValue(makeQuery(snapshot(null, { state: undefined, live: false })));
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(screen.getByRole('heading', { name: 'Weather at car' })).toBeInTheDocument();
    expect(screen.getByText('No weather data')).toBeInTheDocument();
    expectFact('Source', '—');
    expectFact('Conditions', '—');
  });

  it.each([
    { freshness: 'stale', observedAt: Date.now() - 600_000, status: 'stale' },
    { freshness: 'unknown', observedAt: null, status: 'partial' },
  ] as const)('retains $freshness observations without claiming fresh weather', async evidence => {
    mocks.state.mockReturnValue(makeQuery(snapshot(18, {
      freshness: evidence.freshness, observedAt: evidence.observedAt,
    })));
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(container.querySelector(`[data-data-state="${evidence.status}"]`)).not.toBeNull();
    expect(screen.getByText('18°C')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh data · Stale/i })).toBeInTheDocument();
    expectFact('Conditions', '—');
  });

  it('keeps loading and fatal-error recovery in the shell instead of showing invented weather', async () => {
    mocks.state.mockReturnValue(makeQuery<WeatherSnapshot>(undefined, {
      isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching', dataUpdatedAt: 0,
    }));
    const view = renderWidget(packId);
    expect(view.container.querySelector(`[data-widget-pack="${packId}"]`)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('18°C')).not.toBeInTheDocument();
    expect(screen.queryByText('No weather data')).not.toBeInTheDocument();
    const refetch = vi.fn();
    mocks.state.mockReturnValue(makeQuery<WeatherSnapshot>(undefined, {
      error: new Error('No source'), isError: true, dataUpdatedAt: 0, refetch,
    }));
    view.selectPack(packId);
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No weather data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('refreshes discovery and the selected fallback vehicle', async () => {
    const discoveryRefetch = vi.fn();
    const stateRefetch = vi.fn();
    mocks.vehicles.mockReturnValue(makeQuery([{ id: 42 }], { refetch: discoveryRefetch }));
    mocks.state.mockReturnValue(makeQuery(snapshot(), { refetch: stateRefetch }));
    const { container } = renderWidget(packId, { vehicleId: undefined });
    await expectPack(container, packId);
    expect(mocks.state).toHaveBeenLastCalledWith(42, { refetchInterval: 30_000 });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(discoveryRefetch).toHaveBeenCalledOnce();
    expect(stateRefetch).toHaveBeenCalledOnce();
  });

  it('keeps the retained temperature visible and prevents duplicate refreshes while fetching', async () => {
    const refetch = vi.fn();
    mocks.state.mockReturnValue(makeQuery(snapshot(), { isFetching: true, fetchStatus: 'fetching', refetch }));
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(screen.getByText('18°C')).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).not.toHaveBeenCalled();
    expect(container.querySelector(`[data-widget-pack="${packId}"]`)).toHaveAttribute('aria-busy', 'true');
  });
});

it.each([{ cols: 1, rows: 1 }, { cols: 2, rows: 2 }])(
  'keeps Classic and unknown-pack recovery unchanged at %j',
  async size => {
    const view = renderWidget(undefined, { size });
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-climate-readout]')).toBeNull();
    expect(screen.getByText('18°C')).toBeInTheDocument();
    expect(view.container.querySelector('.lucide-cloud-sun')).not.toBeNull();
    expect(screen.queryByText('Outside temperature')).not.toBeInTheDocument();
    expect(screen.queryByText('Conditions')).not.toBeInTheDocument();
    view.selectPack('v7');
    await expectPack(view.container, 'v7');
    view.selectPack('unknown-pack');
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText('18°C')).toBeInTheDocument();
    expect(screen.queryByText(caveat)).not.toBeInTheDocument();
    expect(screen.queryByText('Conditions')).not.toBeInTheDocument();
  },
);
