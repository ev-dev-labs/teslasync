import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const mocks = vi.hoisted(() => ({
  signals: vi.fn(),
  vehicleState: vi.fn(),
  retrySignals: vi.fn(),
  retryVehicle: vi.fn(),
}));
vi.mock('@tanstack/react-query', async () => ({
  ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQuery: mocks.signals,
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 1 }] }),
  useVehicleState: mocks.vehicleState,
}));

import ChargingScheduleWidget from './ChargingScheduleWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
function mount(pack: PackId) {
  return render(<MemoryRouter><PackBoundary requestedPackId={pack}>
    <ChargingScheduleWidget size={{ cols: 2, rows: 2 }} />
  </PackBoundary></MemoryRouter>);
}
async function expectTimeline(container: HTMLElement, pack: PackId) {
  if (pack === 'classic') {
    expect(container.querySelector('[data-timeline-appearance]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector(
      `[data-timeline-appearance="${PACK_APPEARANCES[pack]}"]`,
    )).not.toBeNull());
  }
}
const signals = {
  ScheduledChargingMode: { value: 'StartAt', timestamp: '2026-10-05T00:00:00Z' },
  ChargeLimitSoc: { value: 80, timestamp: '2026-10-05T00:00:00Z' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signals.mockReturnValue(query(signals, mocks.retrySignals));
  mocks.vehicleState.mockReturnValue(query({ state: { battery_level: 52, is_charging: false } }, mocks.retryVehicle));
});

describe.each(PACK_IDS)('charging schedule independent body sources · %s', (pack) => {
  it('keeps the schedule and retries only the missing vehicle state', async () => {
    mocks.vehicleState.mockReturnValue(query(undefined, mocks.retryVehicle, new Error('state failed')));
    const { container } = mount(pack);
    await expectTimeline(container, pack);
    expect(screen.getByText('Start at')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Vehicle charging state unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryVehicle).toHaveBeenCalledTimes(1);
    expect(mocks.retrySignals).not.toHaveBeenCalled();
  });

  it('keeps independent battery/status details when the schedule fails', () => {
    mocks.signals.mockReturnValue(query(undefined, mocks.retrySignals, new Error('schedule failed')));
    mount(pack);
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.getByText('Not charging')).toBeInTheDocument();
    expect(screen.getByText('Charging schedule unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retrySignals).toHaveBeenCalledTimes(1);
    expect(mocks.retryVehicle).not.toHaveBeenCalled();
  });

  it('retains cached schedule and vehicle readings after refresh failure', async () => {
    mocks.signals.mockReturnValue(query(signals, mocks.retrySignals, new Error('refresh failed')));
    const { container } = mount(pack);
    await expectTimeline(container, pack);
    expect(screen.getByText('Previously loaded charging schedule remains visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
  });

  it('shows tall vehicle details even when no schedule is configured', () => {
    mocks.signals.mockReturnValue(query({}, mocks.retrySignals));
    mount(pack);
    expect(screen.getByText('No schedule data')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
  });
});
