import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import {
  useGuardEvents,
  useGuardConfig,
  useSetGuardConfig,
  useAcknowledgeGuardEvent,
  useGuardPanic,
  isGuardEventAcknowledged,
  type GuardEvent,
  type GuardEventsResponse,
  type GuardPanicResponse,
} from '../useGuard';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/feedback/Toast', () => {
  return {
    useToast: () => toastMock,
    useOptionalToast: () => toastMock,
  };
});

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: vi.fn(),
}));

const requestMock = vi.fn();
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, throwOnError: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const mkEvent = (overrides: Partial<GuardEvent> = {}): GuardEvent => ({
  id: 1,
  vehicle_id: 42,
  ts: '2026-05-09T07:35:02Z',
  event_type: 'locked',
  from_state: null,
  to_state: 'true',
  details: null,
  acknowledged_at: null,
  acknowledged_by: null,
  ...overrides,
});

describe('useGuardEvents — Phase-43a envelope contract', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('unwraps the {vehicle_id, events} envelope into GuardEvent[]', async () => {
    const envelope: GuardEventsResponse = {
      vehicle_id: 42,
      events: [mkEvent({ id: 1 }), mkEvent({ id: 2, event_type: 'sentry_mode' })],
    };
    requestMock.mockResolvedValueOnce(envelope);

    const { result } = renderHook(() => useGuardEvents(42), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].id).toBe(1);
    expect(result.current.data?.[1].event_type).toBe('sentry_mode');
  });

  it('returns [] when the envelope omits the events key', async () => {
    requestMock.mockResolvedValueOnce({ vehicle_id: 42 } as GuardEventsResponse);

    const { result } = renderHook(() => useGuardEvents(42), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns [] when events is explicitly null (defensive)', async () => {
    requestMock.mockResolvedValueOnce({
      vehicle_id: 42,
      events: null,
    } as unknown as GuardEventsResponse);

    const { result } = renderHook(() => useGuardEvents(42), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('returns [] when the response is the empty envelope', async () => {
    requestMock.mockResolvedValueOnce({ vehicle_id: 42, events: [] } as GuardEventsResponse);

    const { result } = renderHook(() => useGuardEvents(42), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('hits the correct endpoint and is disabled for vehicleId <= 0', () => {
    requestMock.mockResolvedValue({ vehicle_id: 42, events: [] });
    renderHook(() => useGuardEvents(42), { wrapper: makeWrapper() });
    expect(requestMock).toHaveBeenCalledWith(
      '/vehicles/42/guard/events',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    requestMock.mockClear();
    renderHook(() => useGuardEvents(0), { wrapper: makeWrapper() });
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('isGuardEventAcknowledged', () => {
  it('returns true only when acknowledged_at is set', () => {
    expect(isGuardEventAcknowledged(mkEvent({ acknowledged_at: null }))).toBe(false);
    expect(
      isGuardEventAcknowledged(mkEvent({ acknowledged_at: '2026-05-09T07:35:02Z' })),
    ).toBe(true);
  });

});

describe('guard config route contract', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('reads saved policy separately from telemetry status and preserves null', async () => {
    requestMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGuardConfig(42), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(requestMock).toHaveBeenCalledWith(
      '/vehicles/42/guard/config',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    requestMock.mockClear();
    renderHook(() => useGuardConfig(0), { wrapper: makeWrapper() });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('posts enabled=%s to the mounted root route in live mode', async (enabled) => {
    const body = { enabled, home_geofence_id: null, sensitivity: 'medium', auto_panic: false };
    requestMock.mockResolvedValue({ config: { vehicle_id: 42, ...body }, arm_results: {} });
    const { result } = renderHook(() => useSetGuardConfig(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ vehicleId: 42, ...body });
    });
    expect(requestMock).toHaveBeenCalledWith('/vehicles/42/guard', {
      method: 'POST',
      requiresLiveMode: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('does not turn an arming failure into mutation success', async () => {
    requestMock.mockRejectedValue(new Error('guard config saved but vehicle arming failed'));
    const { result } = renderHook(() => useSetGuardConfig(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({
        vehicleId: 42, enabled: true, home_geofence_id: null,
        sensitivity: 'medium', auto_panic: false,
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('arming failed');
  });
});

describe('guard ACK and PANIC wire contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
  });

  it('ACK posts no body and returns the actual updated GuardEvent, not a status envelope', async () => {
    const updated: GuardEvent = mkEvent({
      id: 7,
      acknowledged_at: '2026-10-04T18:00:00Z',
      acknowledged_by: 'test-operator',
    });
    requestMock.mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useAcknowledgeGuardEvent(), { wrapper: makeWrapper() });
    await act(async () => {
      const response = await result.current.mutateAsync({ vehicleId: 42, eventId: 7 });
      expect(response).toEqual(updated);
      expect(response.acknowledged_by).toBe('test-operator');
      expect(isGuardEventAcknowledged(response)).toBe(true);
    });
    expect(requestMock).toHaveBeenCalledExactlyOnceWith(
      '/vehicles/42/guard/events/7/acknowledge',
      { method: 'POST', requiresLiveMode: true },
    );
    expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.any(QueryClient), {
      queryKey: ['guard-events', 42],
    });
    expect(toastMock.success).toHaveBeenCalledExactlyOnceWith('Event acknowledged');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('PANIC posts no body and preserves ordered per-command results without legacy fields', async () => {
    const response: GuardPanicResponse = {
      vehicle_id: 42,
      vin: 'TEST_ONLY_NOT_A_VEHICLE',
      results: [
        { command: 'sentry_on', ok: true },
        { command: 'honk_horn', ok: true },
        { command: 'flash_lights', ok: true },
      ],
    };
    requestMock.mockResolvedValueOnce(response);
    const { result } = renderHook(() => useGuardPanic(), { wrapper: makeWrapper() });
    await act(async () => {
      const returned = await result.current.mutateAsync(42);
      expect(returned).toEqual(response);
      expect(returned.results.map(entry => entry.command)).toEqual([
        'sentry_on', 'honk_horn', 'flash_lights',
      ]);
      expect(returned.results.every(entry => entry.ok && entry.error === undefined)).toBe(true);
      expect(returned).not.toHaveProperty('command_results');
      expect(returned).not.toHaveProperty('notified_channels');
      expect(returned).not.toHaveProperty('event_id');
    });
    expect(requestMock).toHaveBeenCalledExactlyOnceWith(
      '/vehicles/42/guard/panic',
      { method: 'POST', requiresLiveMode: true },
    );
    expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.any(QueryClient), {
      queryKey: ['guard-events', 42],
    });
    expect(toastMock.success).toHaveBeenCalledExactlyOnceWith('Panic alert triggered');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it.each([404, 400])('ACK keeps HTTP %s failures as errors rather than inventing an acknowledged row', async (status) => {
    const failure = Object.assign(new Error('guard event not acknowledged'), { status });
    requestMock.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useAcknowledgeGuardEvent(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({ vehicleId: 42, eventId: 7 });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledExactlyOnceWith(
      'Failed to acknowledge event: guard event not acknowledged',
    );
    expect(invalidateAndBroadcast).not.toHaveBeenCalled();
  });

  it.each([502, 429, 503, 501])('PANIC keeps HTTP %s partial/budget/proxy failures rejected', async (status) => {
    const failure = Object.assign(new Error('panic request failed'), { status });
    requestMock.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useGuardPanic(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate(42);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledExactlyOnceWith('Failed to trigger panic: panic request failed');
    expect(requestMock).toHaveBeenCalledExactlyOnceWith(
      '/vehicles/42/guard/panic',
      { method: 'POST', requiresLiveMode: true },
    );
  });
});
