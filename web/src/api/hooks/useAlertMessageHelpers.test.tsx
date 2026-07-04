// useAlertMessageHelpers hook tests.
//
// Covers every export of the Alert Studio message-helper hook module:
//
//   - alertMessageKeys.presets / .placeholders — stable, input-derived
//     cache-key tuples (undefined/null normalised to '').
//   - useAlertMessagePresets       — GET /alerts/message-presets, optional
//     ?kind filter, AbortSignal threading, null/non-array coercion via
//     safeArray, error surfacing.
//   - useAlertMessagePlaceholders  — GET /alerts/message-placeholders with a
//     URLSearchParams query string, empty/null param skipping, the
//     `enabled` gate, null coercion, error surfacing.
//   - useAlertMessagePreview       — POST /alerts/message-preview mutation,
//     JSON body round-trip, error propagation.
//
// Network is mocked at the @/api/client boundary (the repo convention —
// see useExports.test.tsx / useNotificationChannels.test.tsx). No real
// request ever leaves the process.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import {
  alertMessageKeys,
  useAlertMessagePresets,
  useAlertMessagePlaceholders,
  useAlertMessagePreview,
} from './useAlertMessageHelpers';
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
  AlertMessagePreviewRequest,
  AlertMessagePreviewResponse,
} from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const samplePreset: AlertMessagePreset = {
  id: 'over-speed',
  name: 'Over speed',
  description: 'Fires when the vehicle exceeds the limit',
  template: 'Speed {{value}} exceeded on {{vehicle_name}}',
  kind: 'signal',
  tags: ['driving', 'safety'],
};

const samplePlaceholder: AlertMessagePlaceholder = {
  key: 'vehicle_name',
  label: 'Vehicle name',
  description: 'Display name of the triggering vehicle',
  group: 'context',
  example: 'Model 3',
};

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// alertMessageKeys — pure cache-key factories
// ---------------------------------------------------------------------------

describe('alertMessageKeys.presets', () => {
  it('embeds the provided kind in a stable tuple', () => {
    expect(alertMessageKeys.presets('signal')).toEqual(['alerts', 'message-presets', 'signal']);
    expect(alertMessageKeys.presets('computed_metric')).toEqual([
      'alerts',
      'message-presets',
      'computed_metric',
    ]);
  });

  it('normalises undefined and the empty string to the same "all" key', () => {
    expect(alertMessageKeys.presets()).toEqual(['alerts', 'message-presets', '']);
    expect(alertMessageKeys.presets('')).toEqual(alertMessageKeys.presets(undefined));
  });
});

describe('alertMessageKeys.placeholders', () => {
  it('threads every argument into the tuple in a fixed order', () => {
    expect(alertMessageKeys.placeholders('signal', 'VehicleSpeed', '>', 'm1')).toEqual([
      'alerts',
      'message-placeholders',
      'signal',
      'VehicleSpeed',
      '>',
      'm1',
    ]);
  });

  it('normalises omitted / null arguments to empty strings', () => {
    expect(alertMessageKeys.placeholders()).toEqual([
      'alerts',
      'message-placeholders',
      '',
      '',
      '',
      '',
    ]);
    // A null metric id collapses to '' so the key matches the "no metric" call.
    expect(alertMessageKeys.placeholders('signal', 'VehicleSpeed', '>', null)).toEqual([
      'alerts',
      'message-placeholders',
      'signal',
      'VehicleSpeed',
      '>',
      '',
    ]);
  });
});

// ---------------------------------------------------------------------------
// useAlertMessagePresets
// ---------------------------------------------------------------------------

describe('useAlertMessagePresets', () => {
  it('GETs /alerts/message-presets with no query string when kind is omitted', async () => {
    mockedRequest.mockResolvedValueOnce([samplePreset]);
    const { result } = renderHook(() => useAlertMessagePresets(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe('over-speed');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/alerts/message-presets');
    // AbortSignal threaded so React Query can cancel an in-flight catalog
    // fetch on navigation.
    expect(opts).toHaveProperty('signal');
  });

  it('appends ?kind=... when a kind filter is supplied', async () => {
    mockedRequest.mockResolvedValueOnce([samplePreset]);
    renderHook(() => useAlertMessagePresets('computed_metric'), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/alerts/message-presets?kind=computed_metric');
  });

  it('treats the empty-string kind as "all" (no query string)', async () => {
    mockedRequest.mockResolvedValueOnce([samplePreset]);
    renderHook(() => useAlertMessagePresets(''), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/alerts/message-presets');
  });

  it('coerces a null payload to an empty array (safeArray hardening)', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as AlertMessagePreset[]);
    const { result } = renderHook(() => useAlertMessagePresets('signal'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('coerces a non-array payload to an empty array and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedRequest.mockResolvedValueOnce({ unexpected: true } as unknown as AlertMessagePreset[]);
    const { result } = renderHook(() => useAlertMessagePresets('signal'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAlertMessagePresets('signal'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useAlertMessagePlaceholders
// ---------------------------------------------------------------------------

describe('useAlertMessagePlaceholders', () => {
  it('GETs /alerts/message-placeholders with no query string when no args are set', async () => {
    mockedRequest.mockResolvedValueOnce([samplePlaceholder]);
    const { result } = renderHook(() => useAlertMessagePlaceholders({}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].key).toBe('vehicle_name');
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/alerts/message-placeholders');
    expect(opts).toHaveProperty('signal');
  });

  it('builds a URL-encoded query string from every supplied param', async () => {
    mockedRequest.mockResolvedValueOnce([samplePlaceholder]);
    renderHook(
      () =>
        useAlertMessagePlaceholders({
          kind: 'signal',
          signal_name: 'VehicleSpeed',
          op: '>=',
          metric_id: 'metric-1',
        }),
      { wrapper },
    );
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // Insertion order is kind, signal_name, op, metric_id. `>=` is
    // percent-encoded by URLSearchParams.
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/alerts/message-placeholders?kind=signal&signal_name=VehicleSpeed&op=%3E%3D&metric_id=metric-1',
    );
  });

  it('skips empty-string and null params entirely', async () => {
    mockedRequest.mockResolvedValueOnce([samplePlaceholder]);
    renderHook(
      () =>
        useAlertMessagePlaceholders({
          kind: '',
          signal_name: '',
          op: undefined,
          metric_id: null,
        }),
      { wrapper },
    );
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/alerts/message-placeholders');
  });

  it('does not fire while enabled is false', async () => {
    const { result } = renderHook(
      () => useAlertMessagePlaceholders({ kind: 'signal', enabled: false }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('coerces a null payload to an empty array (safeArray hardening)', async () => {
    mockedRequest.mockResolvedValueOnce(null as unknown as AlertMessagePlaceholder[]);
    const { result } = renderHook(
      () => useAlertMessagePlaceholders({ kind: 'signal' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(
      () => useAlertMessagePlaceholders({ kind: 'signal' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useAlertMessagePreview
// ---------------------------------------------------------------------------

describe('useAlertMessagePreview', () => {
  const previewBody: AlertMessagePreviewRequest = {
    kind: 'signal',
    signal_name: 'VehicleSpeed',
    op: '>',
    value_num: 120,
    vehicle_name: 'Model 3',
    msg_template: 'Speed {{value}} on {{vehicle_name}}',
    include_title: true,
  };

  it('POSTs the draft to /alerts/message-preview and returns the rendered result', async () => {
    const rendered: AlertMessagePreviewResponse = {
      title: 'Speed alert',
      body: 'Speed 120 on Model 3',
    };
    mockedRequest.mockResolvedValueOnce(rendered);

    const { result } = renderHook(() => useAlertMessagePreview(), { wrapper });
    let out: AlertMessagePreviewResponse | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(previewBody);
    });

    expect(out).toEqual(rendered);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/alerts/message-preview');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(previewBody);
  });

  it('propagates server errors through the mutation rejection', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('render failed'));
    const { result } = renderHook(() => useAlertMessagePreview(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(previewBody)).rejects.toThrow(/render failed/);
    });
    expect(result.current.isError).toBe(true);
  });
});
