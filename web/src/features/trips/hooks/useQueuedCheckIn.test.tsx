/**
 * useQueuedCheckIn — behaviour coverage via a harness component.
 *
 * `useCheckIn` and the resilience connection API are mocked and driven
 * per test; the real localStorage-backed outbox runs underneath so the
 * queue/flush round-trip is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── i18n stub (useMutationToast reads useTranslation) ──
vi.mock('react-i18next', () => {
  const t = (key: string, vars?: Record<string, unknown>): string => {
    if (vars && typeof vars.defaultValue === 'string') {
      let s: string = vars.defaultValue;
      for (const [k, v] of Object.entries(vars)) {
        if (k === 'defaultValue') continue;
        s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
      }
      return s;
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useJourney', () => ({
  useCheckIn: vi.fn(),
}));

vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

const statusState = {
  status: 'online' as 'online' | 'offline',
  listeners: new Set<(s: 'online' | 'offline') => void>(),
};

vi.mock('@/lib/resilience', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/resilience')>();
  return {
    ...original,
    getConnectionStatus: () => statusState.status,
    onStatusChange: (fn: (s: 'online' | 'offline') => void) => {
      statusState.listeners.add(fn);
      return () => {
        statusState.listeners.delete(fn);
      };
    },
  };
});

function setStatus(s: 'online' | 'offline') {
  statusState.status = s;
  statusState.listeners.forEach((fn) => fn(s));
}

import { useCheckIn } from '@/api/hooks/useJourney';
import { useQueuedCheckIn } from './useQueuedCheckIn';
import { enqueueCheckIn, loadOutbox } from '../lib/checkInOutbox';

const mockCheckIn = useCheckIn as unknown as ReturnType<typeof vi.fn>;

function Harness({ sessionId = 1 }: { sessionId?: number }) {
  const { checkIn, queued, isPending } = useQueuedCheckIn(sessionId);
  return (
    <div>
      <button type="button" onClick={checkIn} disabled={isPending}>
        tap
      </button>
      <span data-testid="queued">{queued}</span>
    </div>
  );
}

function renderHarness(sessionId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  statusState.status = 'online';
  statusState.listeners.clear();
  mockCheckIn.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
});

describe('useQueuedCheckIn', () => {
  it('sends immediately when online', () => {
    const mutate = vi.fn();
    mockCheckIn.mockReturnValue({ mutate, mutateAsync: vi.fn(), isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    expect(mutate).toHaveBeenCalledWith({ id: 1 }, expect.anything());
    expect(loadOutbox()).toHaveLength(0);
  });

  it('queues the tap while offline', () => {
    statusState.status = 'offline';
    const mutate = vi.fn();
    mockCheckIn.mockReturnValue({ mutate, mutateAsync: vi.fn(), isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('queued')).toHaveTextContent('1');
    expect(loadOutbox()).toHaveLength(1);
    expect(loadOutbox()[0].session_id).toBe(1);
  });

  it('queues when the send fails without a status', () => {
    const mutate = vi.fn((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new TypeError('fetch failed'));
    });
    mockCheckIn.mockReturnValue({ mutate, mutateAsync: vi.fn(), isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    expect(screen.getByTestId('queued')).toHaveTextContent('1');
    expect(loadOutbox()).toHaveLength(1);
  });

  it('does not queue HTTP errors', () => {
    const apiError = Object.assign(new Error('HTTP 409'), { name: 'ApiError', status: 409 });
    const mutate = vi.fn((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(apiError);
    });
    mockCheckIn.mockReturnValue({ mutate, mutateAsync: vi.fn(), isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    expect(screen.getByTestId('queued')).toHaveTextContent('0');
    expect(loadOutbox()).toHaveLength(0);
  });

  it('flushes the queue with original instants on reconnect', async () => {
    statusState.status = 'offline';
    const mutateAsync = vi.fn().mockResolvedValue({ id: 9, session_id: 1 });
    mockCheckIn.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    // A second tap in the same millisecond dedupes honestly, so seed
    // the second entry directly with a distinct instant.
    enqueueCheckIn({ session_id: 1, recorded_at: '2026-09-14T10:01:00.000Z' });
    const stamped = loadOutbox().map((e) => e.recorded_at);
    expect(loadOutbox()).toHaveLength(2);
    await act(async () => {
      setStatus('online');
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenNthCalledWith(1, { id: 1, recorded_at: stamped[0] });
    expect(mutateAsync).toHaveBeenNthCalledWith(2, { id: 1, recorded_at: stamped[1] });
    await waitFor(() => expect(loadOutbox()).toHaveLength(0));
    expect(screen.getByTestId('queued')).toHaveTextContent('0');
  });

  it('stops the flush at the first failure', async () => {
    statusState.status = 'offline';
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce({ id: 9, session_id: 1 })
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    mockCheckIn.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false });
    renderHarness();
    fireEvent.click(screen.getByText('tap'));
    enqueueCheckIn({ session_id: 1, recorded_at: '2026-09-14T10:01:00.000Z' });
    await act(async () => {
      setStatus('online');
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(loadOutbox()).toHaveLength(1);
    expect(screen.getByTestId('queued')).toHaveTextContent('1');
  });
});
