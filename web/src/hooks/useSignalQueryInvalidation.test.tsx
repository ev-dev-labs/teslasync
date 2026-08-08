/**
 * useSignalQueryInvalidation — SSE → TanStack cache bridge.
 *
 * The hook exists so a "live" page is not limited to its poll interval: the
 * backend already pushes every field-level change on the `signal_change` SSE
 * channel, so a pushed field can invalidate exactly the queries that project
 * it. Three properties are load-bearing and pinned here:
 *
 *   1. field → queryKey routing (an unrelated field must not cause a refetch);
 *   2. coalescing, so a multi-hertz powertrain stream cannot turn into a
 *      request storm that is worse than the poll it replaces;
 *   3. background suppression, so the hook does not silently reintroduce the
 *      hidden-tab traffic that `refetchIntervalInBackground: false` prevents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SignalChangeEvent } from '@/api/types';

import { useSignalQueryInvalidation } from './useSignalQueryInvalidation';

// Capture the handler the hook registers with the SSE stream so tests can
// drive events synchronously without standing up an EventSource.
let capturedHandler: ((e: SignalChangeEvent) => void) | null = null;
let capturedOptions: { enabled?: boolean; vehicleId?: number } | null = null;

vi.mock('./useSSE', () => ({
  useSignalChangeStream: (
    handler: (e: SignalChangeEvent) => void,
    options: { enabled?: boolean; vehicleId?: number },
  ) => {
    capturedHandler = handler;
    capturedOptions = options;
  },
}));

function emit(field: string, vehicleId = 1): void {
  capturedHandler?.({
    vehicle_id: vehicleId,
    field,
    kind: 'float',
    value: 1,
    ts: '2026-01-01T00:00:00Z',
  });
}

const MOTOR_KEY = ['motor', 'latest', 1] as const;
const DYN_KEY = ['drivedyn', 'latest', 1] as const;

const BINDINGS = [
  { fields: ['DiTorqueActualF', 'Gear'], queryKey: MOTOR_KEY },
  { fields: ['PedalPosition'], queryKey: DYN_KEY },
];

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Reads back the query keys passed to invalidateQueries, in call order. */
function invalidatedKeys(): unknown[][] {
  return invalidateSpy.mock.calls.map(
    (call) => (call[0] as { queryKey: unknown[] }).queryKey,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  capturedHandler = null;
  capturedOptions = null;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  invalidateSpy = vi.fn().mockResolvedValue(undefined);
  queryClient.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];
  // jsdom reports the document as visible by default; make it explicit so a
  // prior test's override can never leak into the next one.
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSignalQueryInvalidation — subscription gating', () => {
  it('subscribes with the vehicle filter when a vehicle is selected', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });
    expect(capturedOptions?.enabled).toBe(true);
    expect(capturedOptions?.vehicleId).toBe(1);
  });

  it('stays disabled while no vehicle is selected', () => {
    renderHook(() => useSignalQueryInvalidation({ bindings: BINDINGS }), { wrapper });
    expect(capturedOptions?.enabled).toBe(false);
  });

  it('stays disabled for a sentinel vehicle id of 0', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 0, bindings: BINDINGS }), {
      wrapper,
    });
    expect(capturedOptions?.enabled).toBe(false);
  });

  it('honours an explicit enabled: false', () => {
    renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS, enabled: false }),
      { wrapper },
    );
    expect(capturedOptions?.enabled).toBe(false);
  });
});

describe('useSignalQueryInvalidation — field routing', () => {
  it('invalidates only the query bound to the pushed field', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    emit('PedalPosition');
    vi.advanceTimersByTime(1000);

    expect(invalidatedKeys()).toEqual([DYN_KEY]);
  });

  it('invalidates every binding whose fields were touched in one window', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    emit('Gear');
    emit('PedalPosition');
    vi.advanceTimersByTime(1000);

    expect(invalidatedKeys()).toHaveLength(2);
    expect(invalidatedKeys()).toContainEqual(MOTOR_KEY);
    expect(invalidatedKeys()).toContainEqual(DYN_KEY);
  });

  it('ignores a field no binding claims', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    emit('SomeUnrelatedSignal');
    vi.advanceTimersByTime(5000);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does not invalidate before the throttle window elapses', () => {
    renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS, throttleMs: 750 }),
      { wrapper },
    );

    emit('Gear');
    vi.advanceTimersByTime(749);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useSignalQueryInvalidation — coalescing', () => {
  it('collapses a burst on one field into a single invalidation', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    // A powertrain field at ~10 Hz for a second.
    for (let i = 0; i < 50; i += 1) emit('DiTorqueActualF');
    vi.advanceTimersByTime(1000);

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses two fields sharing a binding into a single invalidation', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    emit('DiTorqueActualF');
    emit('Gear');
    vi.advanceTimersByTime(1000);

    expect(invalidatedKeys()).toEqual([MOTOR_KEY]);
  });

  it('opens a fresh window for events that arrive after a flush', () => {
    renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS, throttleMs: 500 }),
      { wrapper },
    );

    emit('Gear');
    vi.advanceTimersByTime(500);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    emit('Gear');
    vi.advanceTimersByTime(500);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('respects a custom throttle window', () => {
    renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS, throttleMs: 3000 }),
      { wrapper },
    );

    emit('Gear');
    vi.advanceTimersByTime(2999);
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useSignalQueryInvalidation — hidden-tab suppression', () => {
  it('does not refetch while the document is hidden', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    emit('Gear');
    vi.advanceTimersByTime(5000);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('catches up once the tab becomes visible again', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    emit('Gear');
    emit('PedalPosition');
    vi.advanceTimersByTime(5000);
    expect(invalidateSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidatedKeys()).toHaveLength(2);
  });

  it('does not flush on a visibilitychange that hides the tab', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    emit('Gear');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does not replay a stale pending set twice after catching up', () => {
    renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }), {
      wrapper,
    });

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    emit('Gear');
    vi.advanceTimersByTime(5000);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useSignalQueryInvalidation — lifecycle', () => {
  it('does not invalidate after unmount', () => {
    const { unmount } = renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }),
      { wrapper },
    );

    emit('Gear');
    unmount();
    vi.advanceTimersByTime(5000);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('detaches the visibility listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(
      () => useSignalQueryInvalidation({ vehicleId: 1, bindings: BINDINGS }),
      { wrapper },
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('picks up new bindings without changing the stream subscription inputs', () => {
    const { rerender } = renderHook(
      ({ bindings }: { bindings: typeof BINDINGS }) =>
        useSignalQueryInvalidation({ vehicleId: 1, bindings }),
      { wrapper, initialProps: { bindings: BINDINGS } },
    );

    // Callers pass an inline array literal, so a new reference arrives every
    // render. The hook must read bindings through a ref: the values it feeds
    // useSignalChangeStream (whose effect keys on enabled/vehicleId/endpoint)
    // must not change, or the EventSource would be torn down and reopened on
    // every render.
    rerender({ bindings: [{ fields: ['NewField'], queryKey: DYN_KEY }] });
    expect(capturedOptions).toEqual({ enabled: true, vehicleId: 1 });

    emit('NewField');
    vi.advanceTimersByTime(1000);
    expect(invalidatedKeys()).toEqual([DYN_KEY]);
  });

  it('tolerates an empty bindings list', () => {
    expect(() => {
      renderHook(() => useSignalQueryInvalidation({ vehicleId: 1, bindings: [] }), {
        wrapper,
      });
      emit('Gear');
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
