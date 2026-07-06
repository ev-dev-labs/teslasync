/**
 * useSharing hook tests.
 *
 * Covers every export of `useSharing.ts`:
 *   - sharingKeys           — stable query-key tuples for the shares list and
 *     the public shared-drive read.
 *   - useCreateShareLink    — POST /drives/{id}/share; invalidates the shares
 *     list and fires a translated success toast; surfaces failures as an
 *     assertive error toast with the underlying detail line.
 *   - useShareLinks         — GET /drives/{id}/shares; disabled without a
 *     driveId; threads the AbortSignal; `select: safeArray` coerces a
 *     null/non-array body to [] so consumers never crash on `.map`.
 *   - useRevokeShareLink    — DELETE /shares/{token}; invalidates + toasts.
 *   - useSharedDrive        — GET /share/{token}; disabled without a token;
 *     `retry: false` means a single request attempt on failure; passes both
 *     the v2 and legacy v1 payload shapes straight through.
 *
 * `request` is mocked so the hooks exercise their real internals (key
 * resolution, invalidation, toast wiring) without touching the network. The
 * REAL <ToastProvider> + _toastHelpers are used so the success/error toast
 * contract is asserted end-to-end through rendered DOM (role="status" vs
 * role="alert"). react-i18next is mocked with a deterministic translator that
 * honours `defaultValue`, and framer-motion is flattened so toasts mount
 * synchronously in jsdom — the established pattern in this repo's suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// Deterministic translator: honours `defaultValue` so toast titles render as
// their English fallback, matching what useMutationToast passes.
vi.mock('react-i18next', () => {
  const t = (key: string, opts?: unknown): string => {
    if (opts && typeof opts === 'object') {
      const bag = opts as Record<string, unknown>;
      if (typeof bag.defaultValue === 'string') return bag.defaultValue;
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// Flatten framer-motion so <Toast> mounts inert + immediately while keeping
// role / aria-live / className intact.
function filterDomProps(props: Record<string, unknown>) {
  const { layout: _l, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
  return rest;
}
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import {
  sharingKeys,
  useCreateShareLink,
  useShareLinks,
  useRevokeShareLink,
  useSharedDrive,
} from './useSharing';
import type {
  ShareToken,
  SharedDriveData,
  SharedDriveDataV1,
  CreateShareResponse,
} from '@/types/sharing';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper(queryOptions: Record<string, unknown> = { retry: false }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, ...queryOptions },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, qc };
}

const shareToken: ShareToken = {
  id: 1,
  token: 'tok-1',
  drive_id: 42,
  created_by: 'alice',
  title: 'My share',
  description: null,
  include_map: true,
  include_telemetry: false,
  include_speed: true,
  views: 5,
  expires_at: null,
  created_at: '2025-06-01T00:00:00Z',
};

const createResponse: CreateShareResponse = {
  token: 'abc',
  url: 'https://example.test/s/abc',
  id: 7,
};

const v2Data: SharedDriveData = {
  payload_version: 'v2',
  title: 'SF to LA',
  description: 'Road trip',
  drive: {
    date: '2025-06-01T08:00:00Z',
    distance_m: 617_000,
    duration_s: 21_600,
    start_address: 'San Francisco, CA',
    end_address: 'Los Angeles, CA',
    start_battery: 92,
    end_battery: 18,
    elevation_gain: 1_200,
    elevation_loss: 1_150,
    max_speed_mps: 34.5,
    avg_speed_mps: 28.6,
    efficiency_wh_per_m: 0.17,
  },
  vehicle: { model: 'Model 3', color: 'Red' },
  map_points: [{ lat: 37.77, lng: -122.41 }],
  elevation_profile: [{ distance_m: 0, elevation_m: 12 }],
  speed_profile: [{ distance_m: 0, speed_mps: 0 }],
  telemetry: [{ distance_m: 0, battery_level: 92, power: 0, elevation: 12 }],
};

const v1Data: SharedDriveDataV1 = {
  title: 'Legacy share',
  description: 'v1 payload',
  drive: {
    date: '2024-01-01T08:00:00Z',
    distance_km: 617,
    duration_min: 360,
    start_address: 'SF',
    end_address: 'LA',
    start_battery: 90,
    end_battery: 20,
    elevation_gain: 1_000,
    elevation_loss: 950,
    max_speed_kmh: 120,
    avg_speed_kmh: 100,
    efficiency_wh_km: 170,
  },
  vehicle: null,
  map_points: null,
  elevation_profile: null,
  speed_profile: null,
  telemetry: null,
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('sharingKeys', () => {
  it('builds a stable per-drive shares key tuple', () => {
    expect(sharingKeys.shares('42')).toEqual(['shares', '42']);
    expect(sharingKeys.shares('7')).toEqual(['shares', '7']);
  });

  it('builds a stable per-token shared-drive key tuple', () => {
    expect(sharingKeys.shared('tok-1')).toEqual(['shared-drive', 'tok-1']);
    expect(sharingKeys.shared('')).toEqual(['shared-drive', '']);
  });
});

describe('useCreateShareLink', () => {
  it('POSTs the request to /drives/{id}/share and returns the created link', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce(createResponse);

    const { result } = renderHook(() => useCreateShareLink('42'), { wrapper: Wrapper });

    let created: CreateShareResponse | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        title: 'Trip',
        include_speed: true,
        include_telemetry: false,
        expires_in_days: 30,
      });
    });

    expect(created).toEqual(createResponse);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/drives/42/share');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({
      title: 'Trip',
      include_speed: true,
      include_telemetry: false,
      expires_in_days: 30,
    });
  });

  it('invalidates the shares query and shows a success toast on success', async () => {
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce(createResponse);

    const { result } = renderHook(() => useCreateShareLink('42'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Trip' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shares', '42'] });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share link created'),
    );
    // Success is polite, never assertive.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces failures as an assertive error toast carrying the detail line', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockRejectedValueOnce(new Error('drive not found'));

    const { result } = renderHook(() => useCreateShareLink('42'), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ title: 'Trip' })).rejects.toThrow(
        'drive not found',
      );
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to create share link');
    expect(alert).toHaveTextContent('drive not found');
  });
});

describe('useShareLinks', () => {
  it('GETs /drives/{id}/shares with an abort signal and returns the list', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce([shareToken]);

    const { result } = renderHook(() => useShareLinks('42'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/drives/42/shares');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toEqual([shareToken]);
  });

  it('is disabled when driveId is the empty string (no request fires)', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useShareLinks(''), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('coerces a null body to an empty array via safeArray', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce(null as unknown as ShareToken[]);

    const { result } = renderHook(() => useShareLinks('42'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces request errors as isError', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useShareLinks('42'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useRevokeShareLink', () => {
  it('DELETEs /shares/{token}, invalidates the shares query and toasts success', async () => {
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    mockedRequest.mockResolvedValueOnce({ status: 'ok' });

    const { result } = renderHook(() => useRevokeShareLink('42'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('tok-1');
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/shares/tok-1');
    expect(opts.method).toBe('DELETE');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shares', '42'] });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share link revoked'),
    );
  });

  it('shows an assertive error toast when revocation fails', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockRejectedValueOnce(new Error('already revoked'));

    const { result } = renderHook(() => useRevokeShareLink('42'), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync('tok-1')).rejects.toThrow('already revoked');
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to revoke share link');
    expect(alert).toHaveTextContent('already revoked');
  });
});

describe('useSharedDrive', () => {
  it('GETs /share/{token} with an abort signal and returns v2 payloads unchanged', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce(v2Data);

    const { result } = renderHook(() => useSharedDrive('tok-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/share/tok-1');
    expect(opts).toHaveProperty('signal');
    const data = result.current.data as SharedDriveData;
    expect(data.payload_version).toBe('v2');
    expect(data.drive.distance_m).toBe(617_000);
  });

  it('passes the legacy v1 payload shape straight through (no normalization)', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce(v1Data);

    const { result } = renderHook(() => useSharedDrive('legacy'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data as SharedDriveDataV1;
    expect('payload_version' in data).toBe(false);
    expect(data.drive.distance_km).toBe(617);
  });

  it('is disabled when the token is the empty string (no request fires)', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSharedDrive(''), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not retry on error (retry: false) — a single request attempt', async () => {
    // Global default enables retries; the hook must override it to false, so
    // exactly one request should fire despite the rejecting mock.
    const { Wrapper } = makeWrapper({ retry: 3, retryDelay: () => 1 });
    mockedRequest.mockRejectedValue(new Error('gone'));

    const { result } = renderHook(() => useSharedDrive('tok-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});
