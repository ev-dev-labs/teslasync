import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Trip } from '@/api/types';
import type { UseTripParams } from '@/api/hooks/useTrips';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';
import TripSummaryWidget from './TripSummaryWidget';

type TripFixture = Omit<Trip,
  'total_distance_m' | 'total_energy_wh' | 'total_duration_s' | 'charge_count'
> & {
  total_distance_m: number | null;
  total_energy_wh: number | null;
  total_duration_s: number | null;
  charge_count: number | null;
};

interface TripQuery {
  data: TripFixture[] | null | undefined;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: () => Promise<void>;
}

const mocks = vi.hoisted(() => ({
  trips: vi.fn<(params?: UseTripParams) => TripQuery>(),
  refetch: vi.fn<() => Promise<void>>(),
  distance: 'km' as 'km' | 'mi',
  energy: 'kWh' as 'kWh' | 'Wh',
}));

vi.mock('@/api/hooks/useTrips', () => ({ useTrips: mocks.trips }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: mocks.distance, energy: mocks.energy } }),
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({ formatWeekdayName: () => 'Fri' }),
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return options
        ? text.replace(/{{(\w+)}}/g, (match, name: string) => String(options[name] ?? match))
        : text;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const fullSize: WidgetSize = { cols: 2, rows: 2 };
const compactSize: WidgetSize = { cols: 1, rows: 1 };
const packPresentations = Object.entries(PACK_APPEARANCES);
const tripLabel = 'Home → A complete destination name that must remain readable';

function trip(overrides: Partial<TripFixture> = {}): TripFixture {
  return {
    id: 17, vehicle_id: 7, name: tripLabel,
    start_date: '2026-11-06T08:00:00Z', end_date: '2026-11-06T08:30:00Z',
    started_at: '2026-11-06T08:00:00Z', ended_at: '2026-11-06T08:30:00Z',
    total_distance_m: 17_000, total_energy_wh: 4200, total_duration_s: 1800,
    total_cost: 0, drive_count: 2, charge_count: 0, created_at: '2026-11-06T08:00:00Z',
    ...overrides,
  };
}

function query(overrides: Partial<TripQuery> = {}): TripQuery {
  return {
    data: [trip(), trip({ id: 18, name: 'Earlier trip' })],
    error: null, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    refetch: mocks.refetch,
    ...overrides,
  };
}

function tree(packId?: string, size = fullSize) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <TripSummaryWidget size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const node = container.querySelector<HTMLElement>(
      `[data-widget-family="map"][data-widget-appearance="${appearance}"]`,
    );
    expect(node).not.toBeNull();
    if (!node) throw new Error('Trip presentation has not loaded');
    return node;
  });
}

function expectSummary(root: HTMLElement) {
  const content = within(root);
  expect(content.getByText(tripLabel)).toBeInTheDocument();
  expect(content.getByText('Fri · 30m')).toBeInTheDocument();
  expect(content.getByText('Distance')).toBeInTheDocument();
  expect(content.getByText('17')).toBeInTheDocument();
  expect(content.getByText('km')).toBeInTheDocument();
  expect(content.getByText('Energy')).toBeInTheDocument();
  expect(content.getByText('4.2')).toBeInTheDocument();
  expect(content.getByText('kWh')).toBeInTheDocument();
  expect(content.getByText('Stops')).toBeInTheDocument();
  expect(content.getByText('0')).toBeInTheDocument();
  expect(content.queryByText('Earlier trip')).not.toBeInTheDocument();
  expect(content.queryByRole('meter')).not.toBeInTheDocument();
  expect(content.queryByRole('progressbar')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.distance = 'km';
  mocks.energy = 'kWh';
  mocks.refetch.mockResolvedValue(undefined);
  mocks.trips.mockReturnValue(query());
});

describe.each(packPresentations)('Trip Summary %s / %s', (packId, appearance) => {
  it('preserves the latest trip, SI metrics, semantic icon and refresh in full and compact layouts', async () => {
    const view = render(tree(packId));
    const body = await presentation(view.container, appearance);
    expectSummary(body);
    expect(body.querySelector('.lucide-navigation')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Trip summary' })).toBeInTheDocument();
    expect(mocks.trips).toHaveBeenCalledTimes(1);
    expect(mocks.trips).toHaveBeenCalledWith({ limit: 5 });

    view.rerender(tree(packId, compactSize));
    expectSummary(await presentation(view.container, appearance));
    expect(mocks.trips).toHaveBeenLastCalledWith({ limit: 5 });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('keeps unknown and invalid measurements distinct from measured zero and empty history', async () => {
    mocks.trips.mockReturnValue(query({
      data: [trip({
        name: '   ', total_distance_m: null, total_energy_wh: Number.NaN,
        total_duration_s: null, end_date: null, charge_count: Number.POSITIVE_INFINITY,
      })],
    }));
    const view = render(tree(packId));
    let body = await presentation(view.container, appearance);
    expect(within(body).getByText('Unnamed trip')).toBeInTheDocument();
    expect(within(body).getByText('Fri · —')).toBeInTheDocument();
    expect(within(body).getAllByText('—')).toHaveLength(4);
    expect(within(body).getByText('Schematic connection, not recorded route geometry.')).toBeInTheDocument();
    expect(body.querySelector('[data-flow-edge]')).toBeNull();
    expect(within(body).queryByText(/^(0|km|kWh)$/)).not.toBeInTheDocument();

    mocks.trips.mockReturnValue(query({
      data: [trip({ total_distance_m: 0, total_energy_wh: 0, total_duration_s: 30, charge_count: 0 })],
    }));
    view.rerender(tree(packId));
    body = await presentation(view.container, appearance);
    expect(within(body).getByText('Fri · <1m')).toBeInTheDocument();
    expect(within(body).getAllByText(/^0(?:\.0)?$/)).toHaveLength(3);
    expect(within(body).getByText('km')).toBeInTheDocument();
    expect(within(body).getByText('kWh')).toBeInTheDocument();
    expect(within(body).queryByText('—')).not.toBeInTheDocument();

    mocks.trips.mockReturnValue(query({ data: [] }));
    view.rerender(tree(packId));
    body = await presentation(view.container, appearance);
    expect(within(body).getByText('No trips recorded yet')).toBeInTheDocument();
    expect(within(body).queryByText('Distance')).not.toBeInTheDocument();
    expect(within(body).queryByText('Unnamed trip')).not.toBeInTheDocument();
    expect(within(body).queryByRole('meter')).not.toBeInTheDocument();
  });
});

it.each([undefined, 'classic', 'retired-pack'])('preserves the original Classic body for %s', (packId) => {
  const { container } = render(tree(packId));
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expectSummary(screen.getByTestId('widget-body'));
});

it('preserves the controller and refresh when switching packs and returning to Classic', async () => {
  const view = render(tree('classic'));
  for (const [packId, appearance] of packPresentations) {
    view.rerender(tree(packId));
    expectSummary(await presentation(view.container, appearance));
  }
  view.rerender(tree('classic'));
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expectSummary(screen.getByTestId('widget-body'));
  expect(mocks.trips).toHaveBeenCalledTimes(packPresentations.length + 2);
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it.each(packPresentations)('%s converts real SI values to preferred units and preserves signed energy', async (packId, appearance) => {
  mocks.distance = 'mi';
  mocks.energy = 'Wh';
  mocks.trips.mockReturnValue(query({ data: [trip({ total_energy_wh: -4200 })] }));
  const { container } = render(tree(packId));
  const body = await presentation(container, appearance);
  expect(within(body).getByText('11')).toBeInTheDocument();
  expect(within(body).getByText('mi')).toBeInTheDocument();
  expect(within(body).getByText(/^-4,?200$/)).toBeInTheDocument();
  expect(within(body).getByText('Wh')).toBeInTheDocument();
  expect(within(body).queryByText(/^(17|km|kWh)$/)).not.toBeInTheDocument();
});

it.each(packPresentations)('%s retains the timestamp-derived duration fallback and complete trip label', async (packId, appearance) => {
  mocks.trips.mockReturnValue(query({
    data: [trip({ total_duration_s: null, end_date: '2026-11-06T10:15:00Z' })],
  }));
  const { container } = render(tree(packId));
  const body = await presentation(container, appearance);
  expect(within(body).getByText('Fri · 2h 15m')).toBeInTheDocument();
  expect(within(body).getByText(tripLabel)).toBeInTheDocument();
});

describe.each(packPresentations)('Trip Summary %s source trust', (packId, appearance) => {
  it.each(['refresh-error', 'paused', 'stale'] as const)('preserves historical data and source trust while %s', async (state) => {
    mocks.trips.mockReturnValue(query({
      error: state === 'refresh-error' ? new Error('synthetic refresh failure') : null,
      isError: state === 'refresh-error',
      isStale: true,
      fetchStatus: state === 'paused' ? 'paused' : 'idle',
    }));
    const { container } = render(tree(packId));
    expectSummary(await presentation(container, appearance));
    expect(container.querySelector('[data-content-degraded="true"]')).not.toBeNull();
    if (state !== 'stale') {
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    }
    if (state === 'paused') {
      expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    }
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

it.each(packPresentations)('%s keeps the loading/fatal-error shell honest and prevents concurrent refreshes', async (packId, appearance) => {
  mocks.trips.mockReturnValue(query({
    data: undefined, dataUpdatedAt: 0, isLoading: true, isPending: true, isFetching: true,
    fetchStatus: 'fetching',
  }));
  const view = render(tree(packId));
  expect(screen.getByRole('heading', { name: 'Trip summary' })).toBeInTheDocument();
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('No trips recorded yet')).not.toBeInTheDocument();
  expect(screen.queryByText('Distance')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Refresh/i })).toBeDisabled();

  mocks.trips.mockReturnValue(query({
    data: undefined, dataUpdatedAt: 0, error: new Error('synthetic outage'), isError: true,
  }));
  view.rerender(tree(packId));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('No trips recorded yet')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refetch).toHaveBeenCalledOnce();

  mocks.trips.mockReturnValue(query({ isFetching: true, fetchStatus: 'fetching' }));
  view.rerender(tree(packId));
  expectSummary(await presentation(view.container, appearance));
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
