import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
function mount() {
  return render(<MemoryRouter><ChargingScheduleWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
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

describe('charging schedule independent body sources', () => {
  it('keeps the schedule and retries only the missing vehicle state', () => {
    mocks.vehicleState.mockReturnValue(query(undefined, mocks.retryVehicle, new Error('state failed')));
    mount();
    expect(screen.getByText('Start at')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Vehicle charging state unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryVehicle).toHaveBeenCalledTimes(1);
    expect(mocks.retrySignals).not.toHaveBeenCalled();
  });

  it('keeps independent battery/status details when the schedule fails', () => {
    mocks.signals.mockReturnValue(query(undefined, mocks.retrySignals, new Error('schedule failed')));
    mount();
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.getByText('Not charging')).toBeInTheDocument();
    expect(screen.getByText('Charging schedule unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retrySignals).toHaveBeenCalledTimes(1);
    expect(mocks.retryVehicle).not.toHaveBeenCalled();
  });

  it('retains cached schedule and vehicle readings after refresh failure', () => {
    mocks.signals.mockReturnValue(query(signals, mocks.retrySignals, new Error('refresh failed')));
    mount();
    expect(screen.getByText('Previously loaded charging schedule remains visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
  });

  it('shows tall vehicle details even when no schedule is configured', () => {
    mocks.signals.mockReturnValue(query({}, mocks.retrySignals));
    mount();
    expect(screen.getByText('No schedule data')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
  });
});
