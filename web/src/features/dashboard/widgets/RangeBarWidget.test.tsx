import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { Vehicle, VehicleStateReadings } from '@/api/types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import type { WidgetSize } from './types';

interface RangeQuery extends DataStateSource<{
  state: Partial<VehicleStateReadings> | null;
  live: boolean;
}> {
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
}

type StateOverrides = Partial<Omit<RangeQuery, 'data'>> & {
  state?: Partial<VehicleStateReadings> | null;
  live?: boolean;
};

const { vehiclesMock, stateMock, unitsMock, refetchMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn<() => { data?: Vehicle[]; isLoading: boolean }>(),
  stateMock: vi.fn<(id: number) => RangeQuery>(),
  unitsMock: vi.fn<() => { unitPrefs: { distance: 'mi' | 'km' } }>(),
  refetchMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (id: number) => stateMock(id),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => String(Math.round(value)),
    fmtNumber: (value: number, decimals = 0) => value.toFixed(decimals),
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      if (!opts) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(opts[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

import RangeBarWidget from './RangeBarWidget';

const MILE = 1609.344;
const KM = 1000;
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Model 3',
    model: '3', trim_badging: '', exterior_color: '', wheel_type: '',
    state: 'online', healthy: true, created_at: '2026-07-05T12:00:00.000Z',
    updated_at: '2026-07-05T12:00:00.000Z', ...over,
  };
}

function makeState(over: Partial<VehicleStateReadings> = {}): Partial<VehicleStateReadings> {
  return {
    vehicle_id: 7, state: 'online', battery_level: 60,
    rated_range: 300 * MILE, ideal_range: 350 * MILE,
    ...over,
  };
}

function setState({ state, live = false, ...over }: StateOverrides = {}) {
  const query: RangeQuery = {
    data: state !== undefined ? { state, live } : undefined,
    isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: Date.now(), error: undefined, refetch: refetchMock, ...over,
  };
  stateMock.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [makeVehicle()], isLoading: false });
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  setState({ state: makeState() });
});

describe.each(PACK_IDS)('RangeBarWidget — %s range card', packId => {
  function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
    const view = render(
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <RangeBarWidget size={size} vehicleId={vehicleId} />
        </PackBoundary>
      </MemoryRouter>,
    );
    expect(view.container.querySelector(`[data-widget-pack="${packId}"]`)).not.toBeNull();
    return view;
  }

  async function expectPresentation(container: HTMLElement) {
    if (packId === 'classic') return;
    await waitFor(() => {
      expect(container.querySelector(
        `[data-widget-family="meter"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`,
      )).not.toBeNull();
    });
  }

  it('renders the rated headline and ideal secondary value without a fabricated meter', async () => {
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByRole('heading', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(2);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/EPA full/i)).toBeNull();
    expect(screen.queryByText(/Estimated/i)).toBeNull();
  });

  it('falls back to ideal when rated is zero and labels both readings honestly', async () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: 280 * MILE }) });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('280')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(2);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('preserves measured zero values in full and compact layouts', async () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: 0 }) });
    const full = renderWidget(FULL);
    await expectPresentation(full.container);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.queryByText('No range data')).toBeNull();
    full.unmount();
    const compact = renderWidget(COMPACT);
    await expectPresentation(compact.container);
    expect(screen.getAllByText('0')).toHaveLength(1);
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('converts rated and ideal SI metres to kilometres exactly once', async () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
    setState({ state: makeState({ rated_range: 400 * KM, ideal_range: 360 * KM }) });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('360')).toBeInTheDocument();
    expect(screen.getAllByText('km')).toHaveLength(2);
  });

  it('shows missing secondary data as an em dash and never fabricates zero', async () => {
    setState({ state: makeState({ rated_range: 300 * MILE, ideal_range: null }) });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 mi')).toBeNull();
  });

  it.each([
    { name: 'absent readings', state: makeState({ rated_range: null, ideal_range: null }) },
    { name: 'invalid readings', state: makeState({ rated_range: NaN, ideal_range: Infinity }) },
    { name: 'missing state', state: null },
  ])('shows the empty state for $name without inventing a range', async ({ state }) => {
    setState({ state });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('mi')).toBeNull();
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it.each([null, NaN, Infinity])('falls back to measured ideal range when rated is %s', async rated => {
    setState({ state: makeState({ rated_range: rated, ideal_range: 280 * MILE }) });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('280')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(1);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('keeps the compact empty state without the full-only comparison', async () => {
    setState({ state: makeState({ rated_range: null, ideal_range: null }) });
    const { container } = renderWidget(COMPACT);
    await expectPresentation(container);
    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.queryByText('Ideal range')).toBeNull();
  });

  it('renders a loading skeleton without range or empty content', () => {
    setState({ state: undefined, isLoading: true });
    const { container } = renderWidget();
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('renders a loading skeleton while vehicles resolve', () => {
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    setState({ state: undefined });
    const { container } = renderWidget();
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('shows the initial error state and does not present it as empty data', () => {
    setState({ state: undefined, isError: true, error: new Error('offline') });
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it.each([false, true])('retains range readings and refresh freshness after live=%s refresh fails', async live => {
    setState({ state: makeState(), live, isError: true, error: new Error('refresh failed') });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves healthy source trust with live=%s during refresh', async live => {
    setState({ state: makeState(), live, isFetching: true });
    const { container } = renderWidget();
    await expectPresentation(container);
    expect(container.querySelector('[data-data-state="ok"][aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses the compact layout without full-only secondary text or headings', async () => {
    const { container } = renderWidget(COMPACT);
    await expectPresentation(container);
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.queryByText('Ideal range')).toBeNull();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Widget overview' })).toBeInTheDocument();
    expect(screen.getByTestId('widget-body').querySelector('h1, h2, h3, h4')).toBeNull();
  });

  it('resolves an explicit vehicle id and falls back to the first vehicle', async () => {
    vehiclesMock.mockReturnValue({ data: [makeVehicle({ id: 42 }), makeVehicle({ id: 9 })], isLoading: false });
    const explicit = renderWidget(FULL, 9);
    await expectPresentation(explicit.container);
    expect(stateMock).toHaveBeenCalledWith(9);
    explicit.unmount();
    const first = renderWidget(FULL, undefined);
    await expectPresentation(first.container);
    expect(stateMock).toHaveBeenCalledWith(42);
  });
});
