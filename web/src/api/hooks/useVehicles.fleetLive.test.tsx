/**
 * Live-transition + recovery wiring for `useFleetStates`.
 *
 * Charging → Driving → Parked has to become visible promptly, and the two
 * mechanisms that make it prompt are also the two that can turn into a request
 * storm:
 *
 *   1. typed `vehicle_update` SSE frames. A moving car emits several a second;
 *      invalidating per frame would refetch the whole fleet continuously —
 *      strictly worse than the per-vehicle fan-out the batch endpoint
 *      replaced. The hook therefore THROTTLES to at most one refetch per
 *      {@link FLEET_STATE_EVENT_THROTTLE_MS}, and ignores frames for vehicles
 *      that are not in this fleet (or that carry no usable vehicle id).
 *   2. reconnect recovery. Redis Pub/Sub has no replay, so a tab that lost the
 *      pipe is silently behind with no error and no spinner. `useLiveRecovery`
 *      re-reads the authoritative state on reconnect.
 *
 * Both dependencies are mocked so the SSE frame is a controlled input; the
 * point here is the WIRING and the throttle, not the transport.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const {
  requestMock,
  realtimeSpy,
  liveRecoverySpy,
} = vi.hoisted(() => ({
  requestMock: vi.fn(),
  realtimeSpy: vi.fn(),
  liveRecoverySpy: vi.fn(),
}));

// Captured OUTSIDE the hoisted block: only dereferenced at test time.
let capturedOnVehicleUpdate: ((data: unknown) => void) | undefined;
let capturedRealtimeEnabled: boolean | undefined;
let capturedRecoveryKeys: readonly (readonly unknown[])[] | undefined;
let capturedRecoveryEnabled: boolean | undefined;

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (opts: { onVehicleUpdate?: (data: unknown) => void; enabled?: boolean }) => {
    capturedOnVehicleUpdate = opts.onVehicleUpdate;
    capturedRealtimeEnabled = opts.enabled;
    realtimeSpy(opts);
    return { connected: true, state: 'connected' as const, diagnostics: {} };
  },
}));

vi.mock('@/hooks/useLiveRecovery', () => ({
  useLiveRecovery: (opts: {
    queryKeys: readonly (readonly unknown[])[];
    enabled?: boolean;
  }) => {
    capturedRecoveryKeys = opts.queryKeys;
    capturedRecoveryEnabled = opts.enabled;
    liveRecoverySpy(opts);
  },
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import type { Vehicle } from '@/types/vehicle';
import {
  useFleetStates,
  FLEET_STATE_EVENT_THROTTLE_MS,
  FLEET_STATES_QUERY_ROOT,
} from './useVehicles';

function makeVehicle(id: number): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: `Car ${id}`,
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  } as Vehicle;
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Polling stays OFF here so every request the assertions see is
      // attributable to an SSE frame rather than to the ambient interval.
      queries: { retry: false, gcTime: 5 * 60_000, refetchInterval: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function batchFor(url: string, vehicleState: string) {
  const query = String(url).split('?')[1] ?? '';
  const raw = new URLSearchParams(query).get('vehicle_ids') ?? '';
  const ids = raw === '' ? [] : raw.split(',').map(Number);
  return {
    data: {
      now: new Date().toISOString(),
      total: ids.length,
      limit: 500,
      offset: 0,
      counts: { resolved: ids.length, missing: 0, failed: 0 },
      vehicles: ids.map((id) => ({
        vehicle_id: id,
        outcome: 'resolved',
        state: { vehicle_id: id, state: vehicleState, is_charging: vehicleState === 'charging' },
        live: true,
        data_source: 'live_signal_store',
        observed_at: new Date().toISOString(),
        freshness: 'fresh',
        verified_fields: ['state', 'is_charging', 'speed'],
      })),
    },
  };
}

/** Push a typed `vehicle_update` frame through the captured handler. */
function emit(payload: unknown) {
  act(() => {
    capturedOnVehicleUpdate?.(payload);
  });
}

describe('useFleetStates — live transitions without a request storm', () => {
  beforeEach(() => {
    requestMock.mockReset();
    realtimeSpy.mockReset();
    liveRecoverySpy.mockReset();
    capturedOnVehicleUpdate = undefined;
    capturedRealtimeEnabled = undefined;
    capturedRecoveryKeys = undefined;
    capturedRecoveryEnabled = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms SSE reconnect recovery against the fleet-state root', () => {
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, 'online')));
    renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper(makeClient()) });

    expect(liveRecoverySpy).toHaveBeenCalled();
    const roots = (capturedRecoveryKeys ?? []).map((key) => key[0]);
    expect(roots).toContain(FLEET_STATES_QUERY_ROOT);
    // The seeded single-vehicle cache has to be re-read too, or a widget keeps
    // rendering pre-outage state behind a healthy-looking indicator.
    expect(roots).toContain('vehicle-state');
    expect(capturedRecoveryEnabled).toBe(true);
  });

  it('does not subscribe or recover for an empty fleet', () => {
    renderHook(() => useFleetStates([]), { wrapper: wrapper(makeClient()) });
    expect(capturedRealtimeEnabled).toBe(false);
    expect(capturedRecoveryEnabled).toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refetches once for a burst of updates from a moving vehicle', async () => {
    vi.useFakeTimers();
    let vehicleState = 'parked';
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, vehicleState)));

    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(requestMock).toHaveBeenCalledTimes(1);

    // A driving car emits many frames per second.
    vehicleState = 'driving';
    for (let i = 0; i < 25; i += 1) emit({ vehicle_id: 1, ts: Date.now() });
    // Nothing fires synchronously — the burst is coalesced into one timer.
    expect(requestMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS + 50); });
    expect(requestMock).toHaveBeenCalledTimes(2);
    // `waitFor` is avoided under fake timers: it polls on real timers and
    // would simply hang. Flushing the timer queue is the deterministic wait.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.data?.[0].state?.state).toBe('driving');

    // A second burst inside the same window still costs at most one more read.
    for (let i = 0; i < 25; i += 1) emit({ vehicle_id: 1, ts: Date.now() });
    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS + 50); });
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces a charging transition promptly', async () => {
    vi.useFakeTimers();
    let vehicleState = 'parked';
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, vehicleState)));

    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data?.[0].state?.state).toBe('parked');

    vehicleState = 'charging';
    emit({ vehicle_id: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS + 50); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(result.current.data?.[0].state?.is_charging).toBe(true);
  });

  it('ignores frames for vehicles outside this fleet', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, 'online')));

    renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper(makeClient()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(requestMock).toHaveBeenCalledTimes(1);

    emit({ vehicle_id: 999 });
    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS * 3); });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed frames rather than trusting them into a refetch', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, 'online')));

    renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper(makeClient()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(requestMock).toHaveBeenCalledTimes(1);

    for (const payload of [null, undefined, 'vehicle_update', 42, {}, { vehicle_id: '1' }, { vehicle_id: NaN }]) {
      emit(payload);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS * 3); });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending throttled refetch on unmount', async () => {
    vi.useFakeTimers();
    requestMock.mockImplementation((url: string) => Promise.resolve(batchFor(url, 'online')));

    const mounted = renderHook(() => useFleetStates([makeVehicle(1)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(requestMock).toHaveBeenCalledTimes(1);

    emit({ vehicle_id: 1 });
    mounted.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_STATE_EVENT_THROTTLE_MS * 3); });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
