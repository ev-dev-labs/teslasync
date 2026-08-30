/**
 * `useFleetStates` refresh-policy wiring.
 *
 * The fleet-state query is the SPA's fleet-wide live read. It used to fan out
 * ONE request per vehicle on every tick; it now issues a single batch request
 * per tick against `GET /vehicles/states`. Either way, left on a fixed
 * `refetchInterval` it keeps firing into a backgrounded tab, an offline
 * device, a dead backend, and a metered 2G connection — the four situations
 * where the poll is guaranteed to be either wasted or actively harmful.
 *
 * The matrix itself is proven in `hooks/__tests__/useRefreshPolicy.test.tsx`
 * against the pure `resolveRefreshInterval`. What THIS file proves is the
 * wiring, which no pure test can reach:
 *
 *   1. the batch read asks the connection-aware policy for its cadence, at
 *      `standard` priority (not `essential` — a fleet list is not a live
 *      drive) and with the STANDARD base interval;
 *   2. the value the policy returns actually reaches the scheduler, so a
 *      `false` verdict really does stop the poll and a numeric verdict
 *      really does drive it;
 *   3. the policy hook is called unconditionally, so hook order is stable even
 *      for an empty fleet where the query itself is disabled.
 *
 * The policy hook is mocked so the verdict is a controlled input rather than
 * a function of jsdom's visibility/network plumbing — the point here is the
 * wire, not the matrix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const { requestMock, refreshIntervalMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  refreshIntervalMock: vi.fn<(base: number | false, opts?: unknown) => number | false>(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('@/hooks/useRefreshPolicy', () => ({
  useRefreshInterval: (base: number | false, opts?: unknown) => refreshIntervalMock(base, opts),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { INTERVALS } from '@/lib/constants';
import type { Vehicle } from '@/types/vehicle';
import { useFleetStates } from './useVehicles';

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

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/**
 * Poll cadence used by the timing cases. `queryPolicy('live')` clamps a
 * numeric interval up to its own storm-safety floor (`staleTime`), so a value
 * comfortably above that floor is required for the observed cadence to be the
 * policy's verdict rather than the clamp.
 */
const POLL_MS = 10_000;

describe('useFleetStates — the fleet read obeys the connection-aware refresh policy', () => {
  beforeEach(() => {
    requestMock.mockReset();
    refreshIntervalMock.mockReset();
    refreshIntervalMock.mockReturnValue(false);
    requestMock.mockImplementation((url: string) => {
      const query = String(url).split('?')[1] ?? '';
      const raw = new URLSearchParams(query).get('vehicle_ids') ?? '';
      const ids = raw === '' ? [] : raw.split(',').map(Number);
      return Promise.resolve({
        data: {
          now: new Date().toISOString(),
          total: ids.length,
          limit: 500,
          offset: 0,
          counts: { resolved: ids.length, missing: 0, failed: 0 },
          vehicles: ids.map((id) => ({
            vehicle_id: id,
            outcome: 'resolved',
            state: { vehicle_id: id, state: 'online' },
            live: true,
            data_source: 'live_signal_store',
            freshness: 'unknown',
            verified_fields: [],
          })),
        },
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the policy for a STANDARD-priority cadence at the STANDARD base interval', async () => {
    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), {
      wrapper: wrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(refreshIntervalMock).toHaveBeenCalled();
    const [base, options] = refreshIntervalMock.mock.calls[0]!;
    expect(base).toBe(INTERVALS.STANDARD);
    // No override: `standard` is the default, and it is the right tier — a
    // fleet roster is not a live drive, so it must NOT keep polling a hidden
    // tab or a dead backend the way `essential` does.
    expect(options).toBeUndefined();
  });

  it('consults the policy even for an EMPTY fleet, so hook order never shifts', () => {
    // The query is disabled for an empty fleet, but the policy hook has to be
    // called unconditionally or React sees a different hook count between a
    // zero-vehicle and a one-vehicle render.
    renderHook(() => useFleetStates([]), { wrapper: wrapper(makeClient()) });
    expect(refreshIntervalMock).toHaveBeenCalledWith(INTERVALS.STANDARD, undefined);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('issues no repeat read at all while the policy suppresses polling', async () => {
    vi.useFakeTimers();
    refreshIntervalMock.mockReturnValue(false);

    renderHook(() => useFleetStates([makeVehicle(1), makeVehicle(2)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // ONE request for the whole fleet — the batch endpoint's whole point.
    expect(requestMock).toHaveBeenCalledTimes(1);

    // Ten STANDARD periods of a hidden / offline / unreachable / save-data
    // tab. Not a single extra request may go out.
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVALS.STANDARD * 10); });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('drives the fleet read at exactly the cadence the policy returns', async () => {
    vi.useFakeTimers();
    // Above the `live` tier's storm-safety floor so the policy's own clamp
    // cannot be mistaken for the cadence under test.
    refreshIntervalMock.mockReturnValue(POLL_MS);

    renderHook(() => useFleetStates([makeVehicle(1), makeVehicle(2)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(requestMock).toHaveBeenCalledTimes(1);

    // One batch per tick regardless of fleet size.
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(requestMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('stops the fleet read as soon as the policy withdraws its cadence mid-session', async () => {
    vi.useFakeTimers();
    refreshIntervalMock.mockReturnValue(POLL_MS);

    const { rerender } = renderHook(() => useFleetStates([makeVehicle(1)]), {
      wrapper: wrapper(makeClient()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    const whilePolling = requestMock.mock.calls.length;
    expect(whilePolling).toBeGreaterThan(1);

    // The tab is hidden / the device drops off / Data Saver engages.
    refreshIntervalMock.mockReturnValue(false);
    await act(async () => { rerender(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 10); });
    expect(requestMock).toHaveBeenCalledTimes(whilePolling);
  });
});
