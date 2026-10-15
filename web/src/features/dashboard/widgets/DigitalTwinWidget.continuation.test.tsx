import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  state: vi.fn(), security: vi.fn(), charging: vi.fn(),
  retryState: vi.fn(), retrySecurity: vi.fn(), retryCharging: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 1, model: 'Model 3', display_name: 'Complete vehicle display name' }], refetch: vi.fn() }),
  useVehicleState: mocks.state,
  useSecurityLatest: mocks.security,
  useChargingTelemetryLatest: mocks.charging,
}));
vi.mock('@/components/vehicles', () => ({
  VehicleTwin: (props: ComponentProps<typeof import('@/components/vehicles').VehicleTwin>) =>
    <div data-testid="twin" data-locked={props.locked == null ? 'unknown' : String(props.locked)} data-model={props.model} />,
}));

import DigitalTwinWidget from './DigitalTwinWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.mockReturnValue(query({ state: { is_locked: true, is_charging: false } }, mocks.retryState));
  mocks.security.mockReturnValue(query({ locked: true, windows_open: 'closed' }, mocks.retrySecurity));
  mocks.charging.mockReturnValue(query({ charging_state: 'Disconnected' }, mocks.retryCharging));
});

describe('digital twin independent source recovery', () => {
  it('retains the twin and lock evidence while only charging telemetry is unavailable', () => {
    mocks.charging.mockReturnValue(query(undefined, mocks.retryCharging, new Error('charging failed')));
    render(<MemoryRouter><DigitalTwinWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByTestId('twin')).toHaveAttribute('data-locked', 'true');
    expect(screen.getByTestId('twin')).toHaveAttribute('data-model', 'Model 3');
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Complete vehicle display name')).toBeInTheDocument();
    expect(screen.getByText('Charging state unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/digital-twin');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryCharging).toHaveBeenCalledTimes(1);
    expect(mocks.retryState).not.toHaveBeenCalled();
    expect(mocks.retrySecurity).not.toHaveBeenCalled();
  });

  it('keeps retained security values and identifies their failed refresh', () => {
    mocks.security.mockReturnValue(query({ locked: false, windows_open: 'closed' }, mocks.retrySecurity, new Error('refresh failed')));
    render(<MemoryRouter><DigitalTwinWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByTestId('twin')).toHaveAttribute('data-locked', 'false');
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Security state: previously loaded data remains visible while this source recovers.')).toBeInTheDocument();
  });
});
