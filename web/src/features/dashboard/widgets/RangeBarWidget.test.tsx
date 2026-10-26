import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Vehicle, VehicleState } from '@/api/types';
import type { WidgetSize } from './types';

const { vehiclesMock, stateMock, unitsMock, refetchMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  stateMock: vi.fn(),
  unitsMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (...args: unknown[]) => stateMock(...args),
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
const NOW = Date.parse('2026-07-05T12:00:00.000Z');

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Model 3',
    state: 'online', healthy: true, created_at: '2026-07-05T12:00:00.000Z',
    updated_at: '2026-07-05T12:00:00.000Z', ...over,
  } as Vehicle;
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 7, state: 'online', battery_level: 60,
    rated_range: 300 * MILE, ideal_range: 350 * MILE,
    ...over,
  } as VehicleState;
}

function setState(over: Record<string, unknown> = {}) {
  const query = {
    data: over.state !== undefined ? { state: over.state, live: false } : undefined,
    isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: NOW, error: undefined, refetch: refetchMock, ...over,
  };
  stateMock.mockReturnValue(query);
  return query;
}

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <RangeBarWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [makeVehicle()], isLoading: false });
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  setState({ state: makeState() });
});

describe('RangeBarWidget — redesigned range card', () => {
  it('renders the rated headline and ideal secondary value without a fabricated meter', () => {
    renderWidget();
    expect(screen.getByRole('heading', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(2);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/EPA full/i)).toBeNull();
    expect(screen.queryByText(/Estimated/i)).toBeNull();
  });

  it('falls back to ideal when rated is zero and labels both readings honestly', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: 280 * MILE }) });
    renderWidget();
    expect(screen.getByText('280')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(2);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('preserves measured zero values in full and compact layouts', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: 0 }) });
    renderWidget(FULL);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('No range data')).toBeNull();
    renderWidget(COMPACT);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('converts rated and ideal SI metres to kilometres exactly once', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
    setState({ state: makeState({ rated_range: 400 * KM, ideal_range: 360 * KM }) });
    renderWidget();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('360')).toBeInTheDocument();
    expect(screen.getAllByText('km')).toHaveLength(2);
  });

  it('shows missing secondary data as an em dash and never fabricates zero', () => {
    setState({ state: makeState({ rated_range: 300 * MILE, ideal_range: undefined as unknown as number }) });
    renderWidget();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 mi')).toBeNull();
  });

  it('shows the empty state only when both range readings are absent', () => {
    setState({ state: makeState({ rated_range: undefined as unknown as number, ideal_range: undefined as unknown as number }) });
    renderWidget();
    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
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

  it('retains range readings and refresh freshness during a cached refresh failure', () => {
    setState({ state: makeState(), isError: true, error: new Error('refresh failed') });
    renderWidget();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the compact layout without full-only secondary text or headings', () => {
    renderWidget(COMPACT);
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.queryByText('Ideal range')).toBeNull();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Widget overview' })).toBeInTheDocument();
    expect(screen.getByTestId('widget-body').querySelector('h1, h2, h3, h4')).toBeNull();
  });

  it('resolves an explicit vehicle id and falls back to the first vehicle', () => {
    vehiclesMock.mockReturnValue({ data: [makeVehicle({ id: 42 }), makeVehicle({ id: 9 })], isLoading: false });
    renderWidget(FULL, 9);
    expect(stateMock).toHaveBeenCalledWith(9);
    renderWidget(FULL, undefined);
    expect(stateMock).toHaveBeenCalledWith(42);
  });
});
