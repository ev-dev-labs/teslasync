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

function fleetEntry(vehicleId: number, over: Record<string, unknown> = {}) {
  const vehicle = (state.vehicles.data ?? []).find((v) => v.id === vehicleId);
  return {
    vehicle,
    state: { vehicle_id: vehicleId, state: 'online' },
    outcome: 'resolved',
    freshness: 'fresh',
    verifiedFields: ['state'],
    stale: false,
    observedAt: Date.now() - 5_000,
    receivedAt: Date.now(),
    ...over,
  };
}

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
  state.fleet.summary = null;
  state.fleet.error = null;
  state.fleet.isPending = false;
  state.fleet.isError = false;
  state.fleet.refetch.mockClear();
});

describe('FleetPostureWidget', () => {
  it('shows the After posture: verified headline, coverage meter and per-vehicle rows', () => {
    state.fleet.data = [
      fleetEntry(1, {
        state: { vehicle_id: 1, state: 'online', is_charging: true },
        verifiedFields: ['state', 'is_charging'],
      }),
      fleetEntry(2, { state: { vehicle_id: 2, state: 'asleep' } }),
    ];
    const { container } = render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} />
      </MemoryRouter>,
    );

    const posture = within(container).getByTestId('fleet-posture');
    expect(screen.getByText('Fleet posture')).toBeInTheDocument();
    // One headline: verified fraction, never two competing large numbers.
    expect(within(posture).getByText('2')).toBeInTheDocument();
    expect(within(posture).getByText('/ 2')).toBeInTheDocument();
    expect(within(posture).getByText('Verified')).toBeInTheDocument();
    expect(within(posture).getByText('Fresh')).toBeInTheDocument();
    const meter = within(posture).getByRole('meter', { name: 'Coverage' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(within(posture).getByText('Coverage 100%')).toBeInTheDocument();
    expect(within(posture).getByText(/Newest evidence/)).toBeInTheDocument();
    // Per-vehicle rows name the state in text (dot is never the only signal).
    expect(within(posture).getByText('Falcon')).toBeInTheDocument();
    expect(within(posture).getByText('Roadrunner')).toBeInTheDocument();
    expect(within(posture).getByText('charging · telemetry live')).toBeInTheDocument();
    expect(within(posture).getByText('asleep · telemetry live')).toBeInTheDocument();
    // Old taxonomy grid and investigation chrome are gone.
    expect(screen.queryByTestId('fleet-posture-taxonomy')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommended actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary workflows' })).not.toBeInTheDocument();
    // Posture changes are announced politely; freshness stays the shell dot.
    const announcement = within(posture).getByTestId('fleet-posture-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('All 2 vehicles verified from current telemetry.');
    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2m ago/)).not.toBeInTheDocument();
  });

  it('shows partial coverage honestly instead of a confident Fresh pill', () => {
    state.fleet.data = [
      fleetEntry(1),
      fleetEntry(2, {
        freshness: 'stale',
        stale: true,
        verifiedFields: [],
        observedAt: Date.now() - 3 * 60 * 60_000,
      }),
    ];
    const { container } = render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 2, rows: 3 }} />
      </MemoryRouter>,
    );
    const posture = within(container).getByTestId('fleet-posture');
    expect(within(posture).getByText('1')).toBeInTheDocument();
    expect(within(posture).getByText('Coverage 50%')).toBeInTheDocument();
    expect(within(posture).getByRole('meter', { name: 'Coverage' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(posture).getByText('1 need attention')).toBeInTheDocument();
    expect(within(posture).queryByText('Fresh')).not.toBeInTheDocument();
    expect(within(posture).getByText(/Unverified · last seen 3h ago/)).toBeInTheDocument();
    expect(within(posture).getByTestId('fleet-posture-announcement')).toHaveTextContent(
      '1 of 2 vehicles verified. 1 need attention.',
    );
  });

  it('puts the dashboard vehicle scope first and links to it', () => {
    state.fleet.data = [fleetEntry(1), fleetEntry(2)];
    render(
      <MemoryRouter>
        <FleetPostureWidget size={{ cols: 4, rows: 7 }} vehicleId={1} />
      </MemoryRouter>,
    );

    const posture = screen.getByTestId('fleet-posture');
    const labels = [...posture.querySelectorAll('span')].map((el) => el.textContent);
    expect(labels.indexOf('Falcon')).toBeLessThan(labels.indexOf('Roadrunner'));
    expect(within(posture).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open vehicle' })).toHaveAttribute('href', '/vehicles/1');
  });

  it.each([1, 2, 4])('preserves the meter and rows in %i-column mode', (cols) => {
    state.fleet.data = [fleetEntry(1), fleetEntry(2)];
    render(<MemoryRouter><FleetPostureWidget size={{ cols, rows: 3 }} /></MemoryRouter>);
    expect(screen.getByRole('meter', { name: 'Coverage' })).toBeInTheDocument();
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
    expect(container.querySelector('[data-data-state="initial"] [class*="--skeleton-bg"]')).not.toBeNull();
  });

  it('does not leave disabled empty-fleet state in a permanent skeleton', () => {
    state.vehicles.data = [];
    state.fleet.data = undefined;
    state.fleet.isPending = true;
    const { container } = render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(container.querySelector('[data-data-state="initial"]')).toBeNull();
    expect(screen.getByText(/No vehicles registered yet/)).toBeInTheDocument();
  });

  it('keeps discovery and rows visible when fleet state fails, retrying both reads', () => {
    state.fleet.data = undefined;
    state.fleet.error = new Error('batch failed');
    state.fleet.isError = true;
    render(<MemoryRouter><FleetPostureWidget size={{ cols: 2, rows: 3 }} /></MemoryRouter>);
    expect(screen.getByTestId('fleet-posture')).toBeInTheDocument();
    expect(screen.getByText('Falcon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
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
