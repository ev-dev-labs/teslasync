// useDataRepair hook-suite tests.
//
// Covers EVERY export of useDataRepair.ts:
//   - dataRepairKeys                       — stable, distinct query-key tuple.
//   - useStaleSessions                     — GET /data-repair/stale-sessions,
//     AbortSignal threading, payload passthrough, and an error path.
//   - useUpdateCharging / useCloseCharging / useQuarantineCharging
//                                          — HTTP method + URL + JSON body,
//     cache invalidation (dataRepairKeys.stale), and success/error toast wiring.
//   - useUpdateDrive / useCloseDrive / useQuarantineDrive
//                                          — same, PLUS a regression guard that
//     the drive routes are SINGULAR (`/drive/`, not the pre-refactor `/drives/`
//     that 404'd every drive mutation — see the hook's file header).
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useDataRepair` as a contiguous substring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, warningToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  warningToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Replace the toast bridge with spies so onSuccess/onError assertions are exact
// and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({
    success: successToast,
    warning: warningToast,
    error: errorToast,
  }),
}));

import { request } from '@/api/client';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  dataRepairKeys,
  repairApplyInput,
  useApplyChargingRepair,
  useApplyDriveRepair,
  useBulkTransitionRepairCases,
  useRepairSuggestions,
  useStaleSessions,
  useUpdateCharging,
  useCloseCharging,
  useQuarantineCharging,
  useUpdateDrive,
  useCloseDrive,
  useQuarantineDrive,
  type RepairPatch,
  type RepairSuggestion,
  type RepairSuggestionsResponse,
  type StaleSessionsResponse,
} from './useDataRepair';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  warningToast.mockReset();
  errorToast.mockReset();
});

afterEach(() => {
  // Drain the coalesced cross-tab broadcast timer scheduled by
  // invalidateAndBroadcast so it can't fire after the env tears down.
  __flushQueryBroadcastForTests();
});

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('dataRepairKeys', () => {
  it('exposes the stable stale-sessions query-key tuple', () => {
    expect(dataRepairKeys.stale).toEqual(['data-repair', 'stale-sessions']);
    // Read-only const object — the tuple identity is the query cache anchor
    // every mutation invalidates, so its shape must not drift.
    expect(dataRepairKeys.stale).toHaveLength(2);
  });

  it('scopes the suggestions key so a vehicle filter does not collide with the global report', () => {
    expect(dataRepairKeys.suggestions()).toEqual(['data-repair', 'suggestions', {}]);
    expect(dataRepairKeys.suggestions({ vehicle_id: 7 })).toEqual([
      'data-repair',
      'suggestions',
      { vehicle_id: 7 },
    ]);
    expect(dataRepairKeys.suggestions({ vehicle_id: 7 })).not.toEqual(dataRepairKeys.suggestions());
  });
});

// ---------------------------------------------------------------------------
// useRepairSuggestions (read-only diagnosis)
// ---------------------------------------------------------------------------

const suggestion: RepairSuggestion = {
  kind: 'drive',
  session_id: 42,
  vehicle_id: 7,
  rule: 'drive_open_charging_started',
  confidence: 'high',
  started_at: '2026-03-29T06:00:00Z',
  stored_ended_at: null,
  stored_duration_s: null,
  last_in_session_evidence: {
    ts: '2026-03-29T07:00:00Z',
    source: 'drive_telemetry',
    field: 'Gear',
    value: 'D',
  },
  contradicting_evidence: {
    ts: '2026-03-29T08:00:00Z',
    source: 'charging_sessions',
    field: 'charging_session.started_at',
    value: '#900',
  },
  suggested_ended_at: '2026-03-29T07:00:00Z',
  suggested_duration_s: 3600,
  evidence_gap_s: 3600,
  applicable: true,
};

function suggestionsPayload(
  overrides?: Partial<RepairSuggestionsResponse>,
): RepairSuggestionsResponse {
  return {
    generated_at: '2026-03-30T00:00:00Z',
    lookback_days: 30,
    scanned_drives: 1,
    scanned_charging_sessions: 0,
    drive_suggestions: [suggestion],
    charging_suggestions: [],
    truncated: false,
    ...overrides,
  };
}

describe('useRepairSuggestions', () => {
  it('GETs /data-repair/suggestions with no query string when unscoped', async () => {
    mockedRequest.mockResolvedValueOnce(suggestionsPayload());

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRepairSuggestions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, opts] = mockedRequest.mock.calls[0];
    // No `/api/v1` prefix — request() adds it.
    expect(url).toBe('/data-repair/suggestions');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data?.drive_suggestions).toHaveLength(1);
  });

  it('serialises the scope as snake_case query params', async () => {
    mockedRequest.mockResolvedValueOnce(suggestionsPayload());

    const { Wrapper } = makeWrapper();
    renderHook(() => useRepairSuggestions({ vehicle_id: 7, lookback_days: 14, limit: 5 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/data-repair/suggestions?vehicle_id=7&lookback_days=14&limit=5',
    );
  });

  it('surfaces a rejection as isError without leaking a partial report', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('suggestions 503'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRepairSuggestions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// repairApplyInput — the concurrency pin
// ---------------------------------------------------------------------------

describe('repairApplyInput', () => {
  it('pins an OPEN session with an empty string so the backend asserts it is still open', () => {
    expect(repairApplyInput(suggestion)).toEqual({
      id: 42,
      ended_at: '2026-03-29T07:00:00Z',
      rule: 'drive_open_charging_started',
      expected_stored_ended_at: '',
    });
  });

  it('pins an already-closed session with its stored ended_at', () => {
    const closed: RepairSuggestion = {
      ...suggestion,
      rule: 'drive_end_after_contradiction',
      stored_ended_at: '2026-03-30T02:00:00Z',
    };
    expect(repairApplyInput(closed).expected_stored_ended_at).toBe('2026-03-30T02:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Apply mutations
// ---------------------------------------------------------------------------

describe('useApplyDriveRepair', () => {
  it('POSTs the reviewed boundary to the SINGULAR drive close route and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({
      status: 'closed',
      session_id: 42,
      ended_at: '2026-03-29T07:00:00Z',
      duration_s: 3600,
    });

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useApplyDriveRepair(), { wrapper: Wrapper });

    result.current.mutate(repairApplyInput(suggestion));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/42/close');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    // The id lives in the URL and must NOT be duplicated in the body.
    expect(JSON.parse(opts.body)).toEqual({
      ended_at: '2026-03-29T07:00:00Z',
      rule: 'drive_open_charging_started',
      expected_stored_ended_at: '',
    });

    expect(invalidate).toHaveBeenCalled();
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.drive.apply.success',
      'Drive boundary repaired',
    );
  });

  it('toasts and rejects when the backend refuses the repair', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('409 conflict'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApplyDriveRepair(), { wrapper: Wrapper });

    result.current.mutate(repairApplyInput(suggestion));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.apply.error',
      'Failed to repair drive boundary',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useApplyChargingRepair', () => {
  it('POSTs the reviewed boundary to the charging close route and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce({
      status: 'closed',
      session_id: 3,
      ended_at: '2026-03-29T07:00:00Z',
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApplyChargingRepair(), { wrapper: Wrapper });

    result.current.mutate({
      id: 3,
      ended_at: '2026-03-29T07:00:00Z',
      rule: 'charging_open_charge_ended',
      expected_stored_ended_at: '',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/3/close');
    expect(opts.method).toBe('POST');
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.apply.success',
      'Charging boundary repaired',
    );
  });
});

describe('useBulkTransitionRepairCases', () => {
  it('reports the exact number of successfully updated cases', async () => {
    mockedRequest.mockResolvedValueOnce({ updated: 2, skipped: 0 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkTransitionRepairCases(), { wrapper: Wrapper });

    await result.current.mutateAsync({ case_ids: [7, 8], status: 'in_review' });

    expect(mockedRequest).toHaveBeenCalledWith(
      '/data-repair/cases/bulk-transition',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ case_ids: [7, 8], status: 'in_review' }),
      }),
    );
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.case.bulk.success',
      'Updated {{count}} repair cases',
      { count: 2 },
    );
    expect(warningToast).not.toHaveBeenCalled();
  });

  it('surfaces partial and fully skipped outcomes instead of reporting success', async () => {
    mockedRequest
      .mockResolvedValueOnce({ updated: 1, skipped: 1 })
      .mockResolvedValueOnce({ updated: 0, skipped: 2 });
    const { Wrapper } = makeWrapper();
    const first = renderHook(() => useBulkTransitionRepairCases(), { wrapper: Wrapper });

    await first.result.current.mutateAsync({ case_ids: [7, 8], status: 'in_review' });
    expect(warningToast).toHaveBeenLastCalledWith(
      'toast.dataRepair.case.bulk.partial',
      'Updated {{updated}} repair cases; {{skipped}} skipped',
      { updated: 1, skipped: 1 },
    );

    const second = renderHook(() => useBulkTransitionRepairCases(), { wrapper: Wrapper });
    await second.result.current.mutateAsync({
      case_ids: [9, 10],
      status: 'dismissed',
      resolution_note: 'Not a valid finding',
    });
    expect(warningToast).toHaveBeenLastCalledWith(
      'toast.dataRepair.case.bulk.skipped',
      'No repair cases were updated; {{skipped}} skipped',
      { updated: 0, skipped: 2 },
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useStaleSessions (query)
// ---------------------------------------------------------------------------

describe('useStaleSessions', () => {
  it('GETs /data-repair/stale-sessions, threads the abort signal, and returns the payload', async () => {
    const payload: StaleSessionsResponse = {
      stale_charging: [
        {
          id: 1,
          vehicle_id: 7,
          started_at: '2026-01-01T00:00:00Z',
          total_energy_added_wh: 42_000,
          peak_power_w: 11_000,
        },
      ],
      stale_drives: [
        { id: 2, vehicle_id: 7, start_ts: '2026-01-01T00:00:00Z', distance_m: 1_000 },
      ],
    };
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStaleSessions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(payload);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/stale-sessions');
    // TanStack Query hands the queryFn an AbortSignal so route changes cancel
    // the in-flight poll; the hook must forward it to request().
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a request rejection as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('stale-sessions 500'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStaleSessions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Charging mutations
// ---------------------------------------------------------------------------

describe('useUpdateCharging', () => {
  it('PUTs the SI patch to /data-repair/charging/{id}, invalidates the worklist, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCharging(), { wrapper: Wrapper });

    const patch: RepairPatch = { end_soc_pct: 90, total_energy_added_wh: 42_000 };
    await result.current.mutateAsync({ id: 42, patch });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/42');
    expect(opts.method).toBe('PUT');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual(patch);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.update.success',
      'Charging session updated',
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('toasts the error and rejects (no invalidation) when the PUT fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('charging update boom'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCharging(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ id: 1, patch: { end_soc_pct: 80 } }),
    ).rejects.toThrow('charging update boom');

    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.update.error',
      'Failed to update charging session',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useCloseCharging', () => {
  it('POSTs an explicit manual boundary to /data-repair/charging/{id}/close', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCloseCharging(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      id: 5,
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/5/close');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(opts.body))).toEqual({
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.close.success',
      'Charging session closed',
    );
  });

  it('toasts the close error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('close boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCloseCharging(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({
      id: 9,
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    })).rejects.toThrow('close boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.close.error',
      'Failed to close charging session',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useQuarantineCharging', () => {
  it('quarantines /data-repair/charging/{id} with a reason and invalidates', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useQuarantineCharging(), { wrapper: Wrapper });

    await result.current.mutateAsync({ id: 55, reason: 'Duplicate recovery artifact' });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/charging/55');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(opts.body))).toEqual({ reason: 'Duplicate recovery artifact' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.charging.quarantine.success',
      'Charging session moved to quarantine',
    );
  });

  it('toasts the quarantine error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('quarantine boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useQuarantineCharging(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: 9, reason: 'Invalid session' }))
      .rejects.toThrow('quarantine boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.charging.quarantine.error',
      'Failed to quarantine charging session',
    );
  });
});

// ---------------------------------------------------------------------------
// Drive mutations — the routes are SINGULAR (`/drive/`). Guard the regression.
// ---------------------------------------------------------------------------

describe('useUpdateDrive', () => {
  it('PUTs the patch to the SINGULAR /data-repair/drive/{id} route, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateDrive(), { wrapper: Wrapper });

    const patch: RepairPatch = { distance_m: 12_500, duration_s: 900, max_speed_mps: 30 };
    await result.current.mutateAsync({ id: 8, patch });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/8');
    // Regression guard: the pre-refactor page used the plural `/drives/` which
    // 404'd every drive mutation. It MUST stay singular.
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('PUT');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual(patch);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith('toast.dataRepair.drive.update.success', 'Drive updated');
  });

  it('toasts the drive update error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive update boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateDrive(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({ id: 3, patch: { distance_m: 1 } }),
    ).rejects.toThrow('drive update boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.update.error',
      'Failed to update drive',
    );
    expect(successToast).not.toHaveBeenCalled();
  });
});

describe('useCloseDrive', () => {
  it('POSTs to the singular /data-repair/drive/{id}/close route and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCloseDrive(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      id: 17,
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/17/close');
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(opts.body))).toEqual({
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith('toast.dataRepair.drive.close.success', 'Drive closed');
  });

  it('toasts the drive close error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive close boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCloseDrive(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({
      id: 1,
      ended_at: '2026-03-30T04:00:00Z',
      rule: 'manual',
      expected_stored_ended_at: '',
    })).rejects.toThrow('drive close boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.close.error',
      'Failed to close drive',
    );
  });
});

describe('useQuarantineDrive', () => {
  it('quarantines the singular /data-repair/drive/{id} route with a reason', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useQuarantineDrive(), { wrapper: Wrapper });

    await result.current.mutateAsync({ id: 71, reason: 'Duplicate recovery artifact' });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/data-repair/drive/71');
    expect(url).not.toContain('/drives/');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(String(opts.body))).toEqual({ reason: 'Duplicate recovery artifact' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dataRepairKeys.stale });
    expect(successToast).toHaveBeenCalledWith(
      'toast.dataRepair.drive.quarantine.success',
      'Drive moved to quarantine',
    );
  });

  it('toasts the drive quarantine error on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('drive quarantine boom'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useQuarantineDrive(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ id: 9, reason: 'Invalid session' }))
      .rejects.toThrow('drive quarantine boom');
    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.dataRepair.drive.quarantine.error',
      'Failed to quarantine drive',
    );
  });
});
