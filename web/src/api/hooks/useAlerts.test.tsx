// Tests for the `useAlerts` domain re-export shim.
//
// `useAlerts.ts` owns no logic — it re-exports the alert-focused hooks and
// query-key factories that physically live in `useNotifications.ts` and
// `useAlertMessageHelpers.ts`. These tests therefore do double duty:
//
//   1. Contract of the shim itself — every documented hook / key object is
//      re-exported and is the right kind of value (a broken re-export shows up
//      here as `undefined`, not just at `tsc` time).
//   2. Behaviour of every re-exported hook, exercised THROUGH the shim import
//      path so we prove the surface real call sites use actually works:
//      request URL + method + body, snake_case query params, optimistic cache
//      writes + rollback, non-array cache guards, toast keys, and the
//      success/error branches.
//
// Network is mocked at the `request` boundary (the repo convention — see
// __tests__/useNotifications.test.tsx). Toast + cross-tab broadcast are mocked
// so we can assert on i18n keys and invalidation without a live Toast/BC bus.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import * as alertsShim from './useAlerts';
import {
  alertKeys,
  alertMessageKeys,
  useAlerts,
  usePriorityAlerts,
  useAlertRules,
  useAlertMetrics,
  useAlertDetail,
  useMarkAlertRead,
  useAcknowledgeAlert,
  useCommentAlert,
  useReopenAlert,
  useToggleAlertRule,
  useSaveAlertRule,
  useDeleteAlertRule,
  useBulkEnableRules,
  useBulkDisableRules,
  useTestAlertRule,
  useSnoozeAlertRule,
  usePreviewComputedMetric,
  useAlertMessagePresets,
  useAlertMessagePlaceholders,
  useAlertMessagePreview,
  type Alert,
  type AlertDetail,
  type AlertRule,
} from './useAlerts';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Hoisted so the mock factories (also hoisted by Vitest) can close over the
// same spy instances the assertions read.
const { requestMock, toastSuccess, toastError, invalidateSpy } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateSpy: vi.fn(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

// Mock the cross-tab invalidation helper so mutation `onSettled`/`onSuccess`
// invalidations are observable AND deterministic (no 50ms coalesce timer
// leaking a BroadcastChannel post into the next test).
vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: (...args: unknown[]) => invalidateSpy(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 10,
    type: 'low_battery',
    severity: 'warning',
    title: 'Low battery',
    message: 'Battery at 15%',
    is_read: false,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    name: 'Low battery',
    enabled: true,
    signal_name: 'battery_level',
    op: '<',
    severity: 'warn',
    cooldown_min: 30,
    trigger_mode: 'once',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** URL string the mocked `request` was called with on invocation `i`. */
function calledUrl(i = 0): string {
  return requestMock.mock.calls[i]?.[0] as string;
}
/** RequestInit the mocked `request` was called with on invocation `i`. */
function calledOpts(i = 0): RequestInit {
  return requestMock.mock.calls[i]?.[1] as RequestInit;
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  invalidateSpy.mockReset();
});

// ── Re-export surface ────────────────────────────────────────────────────────
describe('useAlerts shim re-export surface', () => {
  it('re-exports every alert hook as a callable', () => {
    const hooks = [
      useAlerts,
      usePriorityAlerts,
      useAlertRules,
      useAlertMetrics,
      useAlertDetail,
      useMarkAlertRead,
      useAcknowledgeAlert,
      useCommentAlert,
      useReopenAlert,
      useToggleAlertRule,
      useSaveAlertRule,
      useDeleteAlertRule,
      useBulkEnableRules,
      useBulkDisableRules,
      useTestAlertRule,
      useSnoozeAlertRule,
      usePreviewComputedMetric,
      useAlertMessagePresets,
      useAlertMessagePlaceholders,
      useAlertMessagePreview,
    ];
    expect(hooks).toHaveLength(20);
    for (const hook of hooks) {
      expect(typeof hook).toBe('function');
    }
  });

  it('aliases notificationKeys as alertKeys and re-exports alertMessageKeys', () => {
    // `alertKeys` is the notification key factory under a focused name.
    expect(typeof alertKeys).toBe('object');
    expect(alertKeys.alerts).toEqual(['alerts']);
    expect(typeof alertMessageKeys.presets).toBe('function');
    // Namespace import sees the same bindings as the named imports.
    expect(alertsShim.useAlerts).toBe(useAlerts);
    expect(alertsShim.alertKeys).toBe(alertKeys);
  });
});

// ── Query-key factories ──────────────────────────────────────────────────────
describe('alertKeys', () => {
  it('builds stable notification/alert cache keys', () => {
    expect(alertKeys.alerts).toEqual(['alerts']);
    expect(alertKeys.alertDetail(7)).toEqual(['alerts', 'detail', 7]);
    expect(alertKeys.alertRules).toEqual(['alert-rules']);
    expect(alertKeys.alertMetrics).toEqual(['alert-metrics']);
  });
});

describe('alertMessageKeys', () => {
  it('encodes preset and placeholder keys, defaulting nullish parts to ""', () => {
    expect(alertMessageKeys.presets('signal')).toEqual(['alerts', 'message-presets', 'signal']);
    expect(alertMessageKeys.presets()).toEqual(['alerts', 'message-presets', '']);
    expect(alertMessageKeys.placeholders('signal', 'battery_level', '>', 'm1')).toEqual([
      'alerts',
      'message-placeholders',
      'signal',
      'battery_level',
      '>',
      'm1',
    ]);
    expect(alertMessageKeys.placeholders()).toEqual([
      'alerts',
      'message-placeholders',
      '',
      '',
      '',
      '',
    ]);
  });
});

// ── Read hooks ───────────────────────────────────────────────────────────────
describe('useAlerts', () => {
  it('GETs /alerts and passes an abort signal', async () => {
    requestMock.mockResolvedValue([makeAlert()]);
    const { result } = renderHook(() => useAlerts(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts');
    expect(calledOpts()).toEqual(expect.objectContaining({ signal: expect.anything() }));
    expect(result.current.data).toEqual([makeAlert()]);
  });

  describe('usePriorityAlerts', () => {
    it('server-filters unread critical and warning alerts before applying its preview cap', async () => {
      const critical = Array.from({ length: 51 }, (_, index) =>
        makeAlert({
          id: index + 1,
          severity: 'critical',
        }),
      );
      const warnings = [makeAlert({ id: 100, severity: 'warning' })];
      requestMock
        .mockResolvedValueOnce(critical)
        .mockResolvedValueOnce(warnings);

      const { result } = renderHook(() => usePriorityAlerts(), {
        wrapper: wrapperFor(makeClient()),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(calledUrl(0)).toBe(
        '/alerts?severity=critical&read=false&archived=false&limit=51',
      );
      expect(calledUrl(1)).toBe(
        '/alerts?severity=warn&read=false&archived=false&limit=51',
      );
      expect(calledOpts(0)).toEqual(
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(result.current.data).toMatchObject({
        count: 52,
        hasMore: true,
      });
      expect(result.current.data?.alerts).toHaveLength(51);
    });
  });

  it('coerces a non-array payload to [] via the safeArray select', async () => {
    requestMock.mockResolvedValue(null);
    const { result } = renderHook(() => useAlerts(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useAlertRules', () => {
  it('GETs /alerts/rules and guarantees an array', async () => {
    requestMock.mockResolvedValue(null);
    const { result } = renderHook(() => useAlertRules(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts/rules');
    expect(result.current.data).toEqual([]);
  });
});

describe('useAlertMetrics', () => {
  it('GETs /alerts/metrics and returns the registry array', async () => {
    const metrics = [{ id: 'kwh_per_100', label: 'kWh/100km', unit: 'kWh', windows: ['7d'], ops: ['>'] }];
    requestMock.mockResolvedValue(metrics);
    const { result } = renderHook(() => useAlertMetrics(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts/metrics');
    expect(result.current.data).toEqual(metrics);
  });
});

describe('useAlertDetail', () => {
  it('GETs /alerts/{id} when id is a positive integer', async () => {
    const detail: AlertDetail = { ...makeAlert({ id: 5 }), events: [] };
    requestMock.mockResolvedValue(detail);
    const { result } = renderHook(() => useAlertDetail(5), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts/5');
    expect(result.current.data).toEqual(detail);
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -3],
  ])('stays disabled and fires no request when id is %s', async (_label, id) => {
    const { result } = renderHook(() => useAlertDetail(id as number | null), {
      wrapper: wrapperFor(makeClient()),
    });
    // Give any (incorrectly) enabled query a chance to fire.
    await Promise.resolve();
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('honours an explicit enabled:false even for a valid id', async () => {
    const { result } = renderHook(() => useAlertDetail(9, { enabled: false }), {
      wrapper: wrapperFor(makeClient()),
    });
    await Promise.resolve();
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

// ── Mark read (optimistic) ───────────────────────────────────────────────────
describe('useMarkAlertRead', () => {
  it('POSTs /alerts/{id}/read, optimistically flips is_read, and toasts success', async () => {
    requestMock.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [makeAlert({ id: 1 }), makeAlert({ id: 2 })]);

    const { result } = renderHook(() => useMarkAlertRead(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync('1');
    });

    expect(calledUrl()).toBe('/alerts/1/read');
    expect(calledOpts().method).toBe('POST');
    const cached = client.getQueryData<Alert[]>(alertKeys.alerts) ?? [];
    expect(cached.find((a) => a.id === 1)?.is_read).toBe(true);
    expect(cached.find((a) => a.id === 2)?.is_read).toBe(false);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.markRead.success', 'Alert marked as read'),
    );
  });

  it('leaves non-array sibling caches under the alerts prefix untouched', async () => {
    requestMock.mockResolvedValue(undefined);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [makeAlert({ id: 1 })]);
    const detail: AlertDetail = { ...makeAlert({ id: 1 }), events: [] };
    client.setQueryData(alertKeys.alertDetail(1), detail);

    const { result } = renderHook(() => useMarkAlertRead(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync('1');
    });

    // The object-shaped detail cache is returned unchanged by the array guard.
    expect(client.getQueryData(alertKeys.alertDetail(1))).toBe(detail);
  });

  it('rolls the optimistic write back and toasts error when the request fails', async () => {
    const boom = new Error('HTTP 500');
    requestMock.mockRejectedValue(boom);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [makeAlert({ id: 1, is_read: false })]);

    const { result } = renderHook(() => useMarkAlertRead(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync('1').catch(() => undefined);
    });

    const cached = client.getQueryData<Alert[]>(alertKeys.alerts) ?? [];
    expect(cached[0]?.is_read).toBe(false);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toBe(boom);
  });
});

// ── Acknowledge / comment / reopen ───────────────────────────────────────────
describe('useAcknowledgeAlert', () => {
  it('POSTs a trimmed note, writes the detail cache, and marks the row acked', async () => {
    const detail: AlertDetail = { ...makeAlert({ id: 5, acknowledged_at: '2025-02-02T00:00:00Z' }), events: [] };
    requestMock.mockResolvedValue(detail);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [makeAlert({ id: 5 })]);

    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 5, note: '  handled  ' });
    });

    expect(calledUrl()).toBe('/alerts/5/acknowledge');
    expect(calledOpts().body).toBe(JSON.stringify({ note: 'handled' }));
    // Server-confirmed detail is written back so the modal re-renders.
    expect(client.getQueryData(alertKeys.alertDetail(5))).toEqual(detail);
    const cached = client.getQueryData<Alert[]>(alertKeys.alerts) ?? [];
    expect(cached[0]?.acknowledged_at).toBeTruthy();
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.ack.success', 'Alert acknowledged'),
    );
  });

  it('sends an empty object body when the note is blank', async () => {
    const detail: AlertDetail = { ...makeAlert({ id: 5 }), events: [] };
    requestMock.mockResolvedValue(detail);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [makeAlert({ id: 5 })]);

    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 5, note: '   ' });
    });

    expect(calledOpts().body).toBe('{}');
  });
});

describe('useCommentAlert', () => {
  it('POSTs /alerts/{id}/comment with a trimmed note and writes the detail cache', async () => {
    const detail: AlertDetail = { ...makeAlert({ id: 8 }), events: [{ id: 1, occurred_at: 'x', kind: 'commented', note: 'hi' }] };
    requestMock.mockResolvedValue(detail);
    const client = makeClient();

    const { result } = renderHook(() => useCommentAlert(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 8, note: '  hi  ' });
    });

    expect(calledUrl()).toBe('/alerts/8/comment');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify({ note: 'hi' }));
    expect(client.getQueryData(alertKeys.alertDetail(8))).toEqual(detail);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.comment.success', 'Comment added'),
    );
  });
});

describe('useReopenAlert', () => {
  it('POSTs /alerts/{id}/reopen and optimistically clears the ack columns', async () => {
    const detail: AlertDetail = { ...makeAlert({ id: 3 }), events: [] };
    requestMock.mockResolvedValue(detail);
    const client = makeClient();
    client.setQueryData(alertKeys.alerts, [
      makeAlert({ id: 3, acknowledged_at: '2025-02-02T00:00:00Z', acknowledged_by: 'me', acknowledgement_note: 'n' }),
    ]);

    const { result } = renderHook(() => useReopenAlert(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync(3);
    });

    expect(calledUrl()).toBe('/alerts/3/reopen');
    const cached = client.getQueryData<Alert[]>(alertKeys.alerts) ?? [];
    expect(cached[0]?.acknowledged_at).toBeNull();
    expect(cached[0]?.acknowledged_by).toBeNull();
    expect(cached[0]?.acknowledgement_note).toBeNull();
    expect(client.getQueryData(alertKeys.alertDetail(3))).toEqual(detail);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.reopen.success', 'Alert reopened'),
    );
  });
});

// ── Rule mutations ───────────────────────────────────────────────────────────
describe('useToggleAlertRule', () => {
  it('PUTs the enabled flag, optimistically toggles the rule, and toasts the disabled key', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 4, enabled: false }));
    const client = makeClient();
    client.setQueryData(alertKeys.alertRules, [makeRule({ id: 4, enabled: true })]);

    const { result } = renderHook(() => useToggleAlertRule(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 4, enabled: false });
    });

    expect(calledUrl()).toBe('/alerts/rules/4');
    expect(calledOpts().method).toBe('PUT');
    expect(calledOpts().body).toBe(JSON.stringify({ enabled: false }));
    const cached = client.getQueryData<AlertRule[]>(alertKeys.alertRules) ?? [];
    expect(cached[0]?.enabled).toBe(false);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.toggleRule.disabled', 'Alert rule disabled'),
    );
  });

  it('toasts the enabled key when flipping a rule on', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 4, enabled: true }));
    const client = makeClient();
    client.setQueryData(alertKeys.alertRules, [makeRule({ id: 4, enabled: false })]);

    const { result } = renderHook(() => useToggleAlertRule(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync({ id: 4, enabled: true });
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.toggleRule.enabled', 'Alert rule enabled'),
    );
  });
});

describe('useSaveAlertRule', () => {
  it('POSTs to /alerts/rules for a create (no id) and invalidates the rules cache', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 99 }));
    const { result } = renderHook(() => useSaveAlertRule(), { wrapper: wrapperFor(makeClient()) });

    const input = { name: 'New rule', signal_name: 'battery_level', op: '<' as const, severity: 'warn' as const };
    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(calledUrl()).toBe('/alerts/rules');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify(input));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), { queryKey: alertKeys.alertRules });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.saveRule.success', 'Alert rule saved'),
    );
  });

  it('PUTs to /alerts/rules/{id} for an update and strips id from the body', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 42 }));
    const { result } = renderHook(() => useSaveAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 42, name: 'Renamed', enabled: true });
    });

    expect(calledUrl()).toBe('/alerts/rules/42');
    expect(calledOpts().method).toBe('PUT');
    expect(calledOpts().body).toBe(JSON.stringify({ name: 'Renamed', enabled: true }));
  });
});

describe('useDeleteAlertRule', () => {
  it('DELETEs /alerts/rules/{id}, invalidates, and toasts success', async () => {
    requestMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync(7);
    });

    expect(calledUrl()).toBe('/alerts/rules/7');
    expect(calledOpts().method).toBe('DELETE');
    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), { queryKey: alertKeys.alertRules });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.deleteRule.success', 'Alert rule deleted'),
    );
  });
});

describe('bulk rule mutations', () => {
  it('useBulkEnableRules POSTs ids to the enable endpoint and reports the updated count', async () => {
    requestMock.mockResolvedValue({ updated: 3 });
    const { result } = renderHook(() => useBulkEnableRules(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync([1, 2, 3]);
    });

    expect(calledUrl()).toBe('/alerts/rules/bulk/enable');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.bulk.enable.success', '{{count}} enabled', { count: 3 }),
    );
  });

  it('useBulkDisableRules falls back to count 0 when the envelope omits updated', async () => {
    requestMock.mockResolvedValue({});
    const { result } = renderHook(() => useBulkDisableRules(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync([9]);
    });

    expect(calledUrl()).toBe('/alerts/rules/bulk/disable');
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.bulk.disable.success', '{{count}} disabled', { count: 0 }),
    );
  });
});

describe('useTestAlertRule', () => {
  it('POSTs the test payload to /alerts/test and toasts success', async () => {
    requestMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTestAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ message: 'ping', target: { all_channels: true } });
    });

    expect(calledUrl()).toBe('/alerts/test');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify({ message: 'ping', target: { all_channels: true } }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.test.success', 'Test alert sent'),
    );
  });

  it('toasts the error key when the test request fails', async () => {
    const boom = new Error('nope');
    requestMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useTestAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ message: 'ping' }).catch(() => undefined);
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(boom, 'toast.alerts.test.error', 'Failed to send test alert'),
    );
  });
});

describe('usePreviewComputedMetric', () => {
  it('POSTs a computed_metric envelope to /alerts/test and returns the preview', async () => {
    const preview = {
      kind: 'computed_metric',
      metric_id: 'kwh_per_100',
      metric_window: '7d',
      metric_op: '>',
      threshold: 20,
      value: 25,
      would_trigger: true,
    };
    requestMock.mockResolvedValue(preview);
    const { result } = renderHook(() => usePreviewComputedMetric(), { wrapper: wrapperFor(makeClient()) });

    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({
        metric_id: 'kwh_per_100',
        metric_window: '7d',
        metric_op: '>',
        metric_threshold: 20,
      });
    });

    expect(calledUrl()).toBe('/alerts/test');
    expect(JSON.parse(calledOpts().body as string)).toEqual({
      kind: 'computed_metric',
      metric_id: 'kwh_per_100',
      metric_window: '7d',
      metric_op: '>',
      metric_threshold: 20,
    });
    expect(out).toEqual(preview);
  });

  it('toasts the preview error key on failure', async () => {
    const boom = new Error('bad metric');
    requestMock.mockRejectedValue(boom);
    const { result } = renderHook(() => usePreviewComputedMetric(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current
        .mutateAsync({ metric_id: 'x', metric_window: '7d', metric_op: '>', metric_threshold: 1 })
        .catch(() => undefined);
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(boom, 'toast.alerts.preview.error', 'Failed to preview metric'),
    );
  });
});

describe('useSnoozeAlertRule', () => {
  it('POSTs the snooze body (id stripped) and toasts the snoozed key for a positive duration', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 6 }));
    const { result } = renderHook(() => useSnoozeAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 6, minutes: 30 });
    });

    expect(calledUrl()).toBe('/alerts/rules/6/snooze');
    expect(calledOpts().body).toBe(JSON.stringify({ minutes: 30 }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.anything(), { queryKey: alertKeys.alertRules });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.snooze.success', 'Rule snoozed'),
    );
  });

  it('toasts the cleared key when minutes <= 0', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 6 }));
    const { result } = renderHook(() => useSnoozeAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 6, minutes: 0 });
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.snooze.cleared', 'Snooze cleared'),
    );
  });

  it('treats a past `until` timestamp as clearing the snooze (documented contract)', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 6 }));
    const past = new Date(Date.now() - 60_000).toISOString();
    const { result } = renderHook(() => useSnoozeAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 6, until: past });
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.snooze.cleared', 'Snooze cleared'),
    );
  });

  it('treats a future `until` timestamp as an active snooze', async () => {
    requestMock.mockResolvedValue(makeRule({ id: 6 }));
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { result } = renderHook(() => useSnoozeAlertRule(), { wrapper: wrapperFor(makeClient()) });

    await act(async () => {
      await result.current.mutateAsync({ id: 6, until: future });
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.alerts.snooze.success', 'Rule snoozed'),
    );
  });
});

// ── Message-template helper hooks ────────────────────────────────────────────
describe('useAlertMessagePresets', () => {
  it('GETs /alerts/message-presets with an encoded kind filter', async () => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(() => useAlertMessagePresets('computed_metric'), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts/message-presets?kind=computed_metric');
  });

  it('omits the query string when no kind is passed', async () => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(() => useAlertMessagePresets(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toBe('/alerts/message-presets');
  });
});

describe('useAlertMessagePlaceholders', () => {
  it('builds a snake_case query string from the rule shape', async () => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(
      () =>
        useAlertMessagePlaceholders({
          kind: 'signal',
          signal_name: 'battery_level',
          op: '>',
          metric_id: 'm1',
        }),
      { wrapper: wrapperFor(makeClient()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url.startsWith('/alerts/message-placeholders?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('kind')).toBe('signal');
    expect(params.get('signal_name')).toBe('battery_level');
    expect(params.get('op')).toBe('>');
    expect(params.get('metric_id')).toBe('m1');
  });

  it('stays disabled (no request) when enabled is false', async () => {
    const { result } = renderHook(
      () => useAlertMessagePlaceholders({ kind: 'signal', enabled: false }),
      { wrapper: wrapperFor(makeClient()) },
    );
    await Promise.resolve();
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('useAlertMessagePreview', () => {
  it('POSTs the draft to /alerts/message-preview and returns the rendered title/body', async () => {
    const rendered = { title: 'Low battery', body: 'Battery at 15%' };
    requestMock.mockResolvedValue(rendered);
    const { result } = renderHook(() => useAlertMessagePreview(), { wrapper: wrapperFor(makeClient()) });

    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ kind: 'signal', signal_name: 'battery_level', op: '<' });
    });

    expect(calledUrl()).toBe('/alerts/message-preview');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(
      JSON.stringify({ kind: 'signal', signal_name: 'battery_level', op: '<' }),
    );
    expect(out).toEqual(rendered);
  });
});
