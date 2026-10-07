import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vehicle } from '@/types/vehicle';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  vehicles: {
    data: [
      { id: 1, display_name: 'Falcon', vin: 'VIN1', state: 'unknown' },
      { id: 2, display_name: 'Roadrunner', vin: 'VIN2', state: 'unknown' },
    ] as Vehicle[] | undefined,
    isPending: false,
    error: null as Error | null,
    isError: false,
    isStale: false,
    isFetching: false,
    refetch: vi.fn(),
    dataUpdatedAt: Date.now(),
  },
  fleet: {
    data: [] as unknown[] | undefined,
    summary: null,
    isPending: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
  },
  selectedId: 2,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const variables = (typeof fallback === 'object' ? fallback : options) ?? {};
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String((variables as Record<string, unknown>)[name] ?? `{{${name}}}`));
    },
  }),
}));
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: () => state.vehicles,
  useFleetStates: () => state.fleet,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.selectedId }),
}));

import FleetPostureWidget from './FleetPostureWidget';

afterEach(cleanup);
beforeEach(() => {
  state.vehicles.data = [
    { id: 1, display_name: 'Falcon', vin: 'VIN1', state: 'unknown' },
    { id: 2, display_name: 'Roadrunner', vin: 'VIN2', state: 'unknown' },
  ] as Vehicle[];
  state.vehicles.error = null;
  state.vehicles.isPending = false;
  state.vehicles.isError = false;
  state.vehicles.refetch.mockClear();
  state.fleet.data = [];
  state.fleet.error = null;
  state.fleet.isPending = false;
  state.fleet.isError = false;
  state.fleet.refetch.mockClear();
});

describe('FleetPostureWidget', () => {
  it('shows the shared trust-aware posture inside a widget, without investigation links', () => {
    const { container } = render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} />
      </MemoryRouter>,
    );

    const posture = within(container).getByTestId('fleet-operations-brief');
    expect(screen.getByText('Fleet posture')).toBeInTheDocument();
    expect(within(posture).getByText('Roadrunner')).toBeInTheDocument();
    expect(within(posture).getByTestId('fleet-posture-taxonomy')).toBeInTheDocument();
    expect(screen.queryByText('Recommended actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary workflows' })).not.toBeInTheDocument();
  });

  it('respects the dashboard vehicle scope over the header selection', () => {
    render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} vehicleId={1} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Falcon')).toBeInTheDocument();
    expect(screen.queryByText('Roadrunner')).not.toBeInTheDocument();
  });

  it.each([1, 2, 4])('preserves the taxonomy and scope in %i-column mode', (cols) => {
    render(<MemoryRouter><FleetPostureWidget size={{ cols, rows: 3 }} /></MemoryRouter>);
    expect(screen.getByTestId('fleet-posture-taxonomy')).toBeInTheDocument();
    expect(screen.getByText('Roadrunner')).toBeInTheDocument();
  });

  it('owns vehicle discovery initial failure and offers recovery instead of a false healthy fleet', () => {
    state.vehicles.data = undefined;
    state.vehicles.error = new Error('discovery failed');
    state.vehicles.isError = true;
    render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.fleet.refetch).not.toHaveBeenCalled();
  });

  it('renders initial skeleton only before discovery resolves', () => {
    state.vehicles.data = undefined;
    state.vehicles.isPending = true;
    const { container } = render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(container.querySelector('[data-data-state="initial"] .animate-pulse')).not.toBeNull();
  });

  it('does not leave disabled empty-fleet state in a permanent skeleton', () => {
    state.vehicles.data = [];
    state.fleet.data = undefined;
    state.fleet.isPending = true;
    const { container } = render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(container.querySelector('[data-data-state="initial"]')).toBeNull();
    expect(screen.getByTestId('fleet-posture-taxonomy')).toBeInTheDocument();
  });

  it('keeps discovery and taxonomy visible when fleet state fails, retrying both reads', () => {
    state.fleet.data = undefined;
    state.fleet.error = new Error('batch failed');
    state.fleet.isError = true;
    render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(screen.getByTestId('fleet-posture-taxonomy')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.fleet.refetch).toHaveBeenCalledOnce();
  });

  it('preserves retained fleet content and stale warning on refresh failure', () => {
    state.fleet.error = new Error('refresh failed');
    state.fleet.isError = true;
    const { container } = render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Roadrunner')).toBeInTheDocument();
  });
});
