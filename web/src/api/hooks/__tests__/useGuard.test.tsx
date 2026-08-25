import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useGuardEvents,
  isGuardEventAcknowledged,
  type GuardEvent,
  type GuardEventsResponse,
} from '../useGuard';

vi.mock('@/components/feedback/Toast', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  return {
    useToast: () => toast,
    useOptionalToast: () => toast,
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
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
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
