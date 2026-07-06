// useVehiclePhoto hook + helper tests.
//
// Covers every export of `useVehiclePhoto.ts`:
//   - VEHICLE_PHOTO_FORM_FIELD / VEHICLE_PHOTO_MAX_BYTES /
//     VEHICLE_PHOTO_ALLOWED_MIME — the client-side contract mirroring the
//     backend upload constraints.
//   - vehiclePhotoKeys           — stable query-key tuples.
//   - vehiclePhotoUrl            — the cache-busting <img src> builder, across
//     every branch (no meta / has_photo:false / missing uploaded_at /
//     unparseable uploaded_at / valid uploaded_at) PLUS the non-finite-id
//     guard that stops a broken `/vehicles/NaN/photo/...` URL.
//   - useVehiclePhoto           — GET metadata query; disabled for
//     null/undefined AND NaN ids (so a bad Number() never fires
//     `/vehicles/NaN/photo`); threads the AbortSignal; surfaces errors.
//   - validateVehiclePhotoFile  — empty / zero-byte / oversize / bad-mime /
//     case-insensitive-mime / typeless / happy-path branches.
//   - useUploadVehiclePhoto     — POST multipart via the fetch() bypass;
//     primes + invalidates the cache; rejects a bad file before the network;
//     surfaces the backend detail line and a generic fallback.
//   - useDeleteVehiclePhoto     — DELETE via request(); writes has_photo:false
//     into the cache and invalidates the photo + vehicle detail keys.
//
// `request` is mocked so the query/delete paths exercise their real internals
// without hitting the network. `invalidateAndBroadcast` is mocked to a pure
// spy so cache mutations survive for read-back and the wired invalidation keys
// can be asserted directly. The upload path uses the browser `fetch()` (an
// intentional bypass of request() — see the source header), so global fetch is
// stubbed per-test. Co-located next to the source because the gate's
// path-scoped regex matches `api/hooks/useVehiclePhoto` as a contiguous
// substring that a __tests__/ subdir would interrupt.

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

// Pure spy: keeps cache writes intact (no real invalidate/refetch) so we can
// both read back optimistic cache state AND assert the exact keys the hook
// broadcasts.
vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: vi.fn(),
}));

import { request } from '@/api/client';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { VehiclePhotoMeta } from '@/api/types';
import {
  VEHICLE_PHOTO_FORM_FIELD,
  VEHICLE_PHOTO_MAX_BYTES,
  VEHICLE_PHOTO_ALLOWED_MIME,
  vehiclePhotoKeys,
  vehiclePhotoUrl,
  useVehiclePhoto,
  validateVehiclePhotoFile,
  useUploadVehiclePhoto,
  useDeleteVehiclePhoto,
} from './useVehiclePhoto';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockedInvalidate = invalidateAndBroadcast as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

/** Minimal Response stand-in for the fetch() upload path. */
function fakeResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; throwOnJson?: boolean } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => {
      if (init.throwOnJson) throw new SyntaxError('not json');
      return body;
    },
  } as unknown as Response;
}

/** A jsdom File with a controllable `size` (avoids allocating 8+ MB). */
function makeFile(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(Math.min(size, 32))], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size, configurable: true });
  }
  return file;
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedInvalidate.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('module constants', () => {
  it('exposes the multipart field name and the 8 MiB cap', () => {
    expect(VEHICLE_PHOTO_FORM_FIELD).toBe('photo');
    expect(VEHICLE_PHOTO_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('allows jpeg/png but rejects webp/gif', () => {
    expect(VEHICLE_PHOTO_ALLOWED_MIME.has('image/jpeg')).toBe(true);
    expect(VEHICLE_PHOTO_ALLOWED_MIME.has('image/png')).toBe(true);
    expect(VEHICLE_PHOTO_ALLOWED_MIME.has('image/webp')).toBe(false);
    expect(VEHICLE_PHOTO_ALLOWED_MIME.has('image/gif')).toBe(false);
  });
});

describe('vehiclePhotoKeys', () => {
  it('builds stable key tuples', () => {
    expect(vehiclePhotoKeys.all).toEqual(['vehicle-photos']);
    expect(vehiclePhotoKeys.detail(7)).toEqual(['vehicle-photos', 7]);
    expect(vehiclePhotoKeys.detail(42)).toEqual(['vehicle-photos', 42]);
  });
});

describe('vehiclePhotoUrl', () => {
  const withPhoto: VehiclePhotoMeta = { has_photo: true, uploaded_at: '2025-06-01T12:00:00Z' };

  it('returns null when meta is absent or has_photo is false', () => {
    expect(vehiclePhotoUrl(7, 'thumb', null)).toBeNull();
    expect(vehiclePhotoUrl(7, 'thumb', undefined)).toBeNull();
    expect(vehiclePhotoUrl(7, 'thumb', { has_photo: false })).toBeNull();
  });

  it('appends uploaded_at as a ?v= cache-buster', () => {
    const ts = Date.parse('2025-06-01T12:00:00Z');
    expect(vehiclePhotoUrl(7, 'medium', withPhoto)).toBe(
      `/api/v1/vehicles/7/photo/medium?v=${ts}`,
    );
  });

  it('omits the cache-buster when uploaded_at is missing', () => {
    expect(vehiclePhotoUrl(7, 'full', { has_photo: true })).toBe('/api/v1/vehicles/7/photo/full');
  });

  it('omits the cache-buster when uploaded_at is unparseable', () => {
    expect(vehiclePhotoUrl(7, 'thumb', { has_photo: true, uploaded_at: 'not-a-date' })).toBe(
      '/api/v1/vehicles/7/photo/thumb',
    );
  });

  it('returns null for a non-finite vehicleId instead of a broken URL', () => {
    expect(vehiclePhotoUrl(Number.NaN, 'thumb', withPhoto)).toBeNull();
    expect(vehiclePhotoUrl(Number.POSITIVE_INFINITY, 'thumb', withPhoto)).toBeNull();
  });
});

describe('validateVehiclePhotoFile', () => {
  it('flags a missing file as empty', () => {
    expect(validateVehiclePhotoFile(null)).toEqual({ reason: 'empty', message: 'No file selected.' });
    expect(validateVehiclePhotoFile(undefined)?.reason).toBe('empty');
  });

  it('flags a zero-byte file as empty', () => {
    const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
    expect(validateVehiclePhotoFile(empty)).toEqual({
      reason: 'empty',
      message: 'Selected file is empty.',
    });
  });

  it('flags a file over the size cap and names the limit', () => {
    const big = makeFile('big.jpg', 'image/jpeg', VEHICLE_PHOTO_MAX_BYTES + 1);
    const err = validateVehiclePhotoFile(big);
    expect(err?.reason).toBe('size');
    expect(err?.message).toContain('8 MB');
  });

  it('accepts a file exactly at the cap (boundary is inclusive)', () => {
    const atCap = makeFile('exact.jpg', 'image/jpeg', VEHICLE_PHOTO_MAX_BYTES);
    expect(validateVehiclePhotoFile(atCap)).toBeNull();
  });

  it('flags an unsupported mime type', () => {
    const gif = makeFile('a.gif', 'image/gif');
    expect(validateVehiclePhotoFile(gif)).toEqual({
      reason: 'mime',
      message: 'Unsupported image type: image/gif',
    });
  });

  it('lower-cases the mime before checking the allowlist', () => {
    // Duck-typed so the uppercase survives (jsdom's File normalises `type`).
    const upper = { size: 1024, type: 'IMAGE/PNG', name: 'a.png' } as unknown as File;
    expect(validateVehiclePhotoFile(upper)).toBeNull();
  });

  it('accepts a typeless file (server does the authoritative check)', () => {
    const typeless = makeFile('a.bin', '');
    expect(validateVehiclePhotoFile(typeless)).toBeNull();
  });

  it('accepts valid jpeg and png files', () => {
    expect(validateVehiclePhotoFile(makeFile('a.jpg', 'image/jpeg'))).toBeNull();
    expect(validateVehiclePhotoFile(makeFile('a.png', 'image/png'))).toBeNull();
  });
});

describe('useVehiclePhoto', () => {
  it('GETs /vehicles/{id}/photo with an abort signal when enabled', async () => {
    const { Wrapper } = makeWrapper();
    const meta: VehiclePhotoMeta = { has_photo: true, uploaded_at: '2025-06-01T00:00:00Z' };
    mockedRequest.mockResolvedValueOnce(meta);

    const { result } = renderHook(() => useVehiclePhoto(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(meta);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/vehicles/7/photo');
    expect(opts).toHaveProperty('signal');
  });

  it('stays idle when vehicleId is null', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehiclePhoto(null), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays idle when vehicleId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehiclePhoto(undefined), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('stays idle for a NaN vehicleId rather than firing /vehicles/NaN/photo', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVehiclePhoto(Number.NaN), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces request errors as isError', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useVehiclePhoto(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useUploadVehiclePhoto', () => {
  it('POSTs a multipart body to /api/v1/vehicles/{id}/photo and returns the new meta', async () => {
    const { Wrapper } = makeWrapper();
    const meta: VehiclePhotoMeta = { has_photo: true, uploaded_at: '2025-06-02T00:00:00Z' };
    const fetchMock = vi.fn(async () => fakeResponse(meta));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUploadVehiclePhoto(), { wrapper: Wrapper });
    const file = makeFile('car.jpg', 'image/jpeg', 2048);

    let returned: VehiclePhotoMeta | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ vehicleId: 7, file });
    });

    expect(returned).toEqual(meta);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/vehicles/7/photo');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');

    const form = opts.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const uploaded = form.get(VEHICLE_PHOTO_FORM_FIELD) as File;
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.name).toBe('car.jpg');
  });

  it('primes the cache and broadcasts the photo + vehicle invalidations on success', async () => {
    const { Wrapper, qc } = makeWrapper();
    const meta: VehiclePhotoMeta = { has_photo: true, uploaded_at: '2025-06-02T00:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(meta)));

    const { result } = renderHook(() => useUploadVehiclePhoto(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ vehicleId: 7, file: makeFile('car.jpg', 'image/png') });
    });

    expect(qc.getQueryData(vehiclePhotoKeys.detail(7))).toEqual(meta);
    expect(mockedInvalidate).toHaveBeenCalledWith(qc, { queryKey: vehiclePhotoKeys.detail(7) });
    expect(mockedInvalidate).toHaveBeenCalledWith(qc, { queryKey: ['vehicles', '7'] });
  });

  it('rejects an oversized file before touching the network', async () => {
    const { Wrapper } = makeWrapper();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useUploadVehiclePhoto(), { wrapper: Wrapper });
    const big = makeFile('big.jpg', 'image/jpeg', VEHICLE_PHOTO_MAX_BYTES + 1);

    await act(async () => {
      await expect(result.current.mutateAsync({ vehicleId: 7, file: big })).rejects.toThrow(/8 MB/);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the backend error detail on a non-2xx response', async () => {
    const { Wrapper } = makeWrapper();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ error: 'file too large' }, { ok: false, status: 413 })),
    );

    const { result } = renderHook(() => useUploadVehiclePhoto(), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ vehicleId: 7, file: makeFile('car.png', 'image/png') }),
      ).rejects.toThrow('file too large');
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const { Wrapper } = makeWrapper();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(null, { ok: false, status: 500, throwOnJson: true })),
    );

    const { result } = renderHook(() => useUploadVehiclePhoto(), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ vehicleId: 7, file: makeFile('car.png', 'image/png') }),
      ).rejects.toThrow('Upload failed (500)');
    });
  });
});

describe('useDeleteVehiclePhoto', () => {
  it('DELETEs /vehicles/{id}/photo, clears the cache and invalidates', async () => {
    const { Wrapper, qc } = makeWrapper();
    mockedRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteVehiclePhoto(), { wrapper: Wrapper });

    let out: number | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(7);
    });

    expect(out).toBe(7);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/vehicles/7/photo');
    expect(opts.method).toBe('DELETE');
    expect(qc.getQueryData(vehiclePhotoKeys.detail(7))).toEqual({ has_photo: false });
    expect(mockedInvalidate).toHaveBeenCalledWith(qc, { queryKey: vehiclePhotoKeys.detail(7) });
    expect(mockedInvalidate).toHaveBeenCalledWith(qc, { queryKey: ['vehicles', '7'] });
  });

  it('propagates a DELETE failure to the caller', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockRejectedValueOnce(new Error('gone'));

    const { result } = renderHook(() => useDeleteVehiclePhoto(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(7)).rejects.toThrow('gone');
    });
    expect(mockedInvalidate).not.toHaveBeenCalled();
  });
});
