// useVehicleSystems hook-family tests.
//
// This file guards the whole vehicle-systems query surface (climate, tire
// pressure, maintenance, service records, software updates, safety, media).
// Each hook is a thin TanStack Query wrapper over request(), so the contract
// worth pinning is behavioural:
//   - the exact API path (no /api/v1 double-prefix, snake_case query params)
//   - the AbortSignal is threaded through so route changes cancel in-flight fetches
//   - enabled-gating: vehicle-scoped hooks stay idle until a vehicle id exists
//   - select: safeArray coerces a null/omitted body to [] so callers can .map()
//   - request failures surface as isError (no silent swallow)
//
// Regression anchor: useSoftwareUpdates MUST scope the request to the
// vehicle_id it is keyed on — a bare /software-updates fetch returned every
// vehicle's updates under a per-vehicle cache key.
//
// Network is mocked at the request() boundary (the repo convention — see
// useExports.test.tsx / __tests__/useAiUsage.test.tsx) so no real fetch runs.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const requestMock = vi.fn();
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  vehicleSystemsKeys,
  useClimate,
  useClimateHistory,
  useTirePressure,
  useTirePressureHistory,
  useTirePressureAnalysisHistory,
  useMaintenance,
  useServiceRecords,
  useSoftwareUpdates,
  useSafety,
  useSafetyHistory,
  useMedia,
  useMediaHistory,
} from './useVehicleSystems';
import type {
  ClimateState,
  TirePressureReading,
  MaintenanceItem,
  ServiceRecord,
  SoftwareUpdate,
  SafetySnapshot,
} from '@/types/vehicle-systems';
import type { MediaSnapshot } from '@/api/types';

const VID = '42';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Reads the (url, options) pair from the first request() call. */
function firstCall(): { url: string; options: { signal?: unknown } } {
  const [url, options] = requestMock.mock.calls[0] as [string, { signal?: unknown }];
  return { url, options };
}

/** Parses the query string of a `/path?a=b` url into URLSearchParams. */
function queryOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

// Full-shape fixtures — typed against the real interfaces so a field rename in
// the API contract surfaces here as a compile error, not a silent runtime gap.
const climate: ClimateState = { insideTemp: 21.5, outsideTemp: 9.0, isAcOn: true };

const tire: TirePressureReading = {
  id: 'tp-1',
  vehicleId: VID,
  frontLeft: 2.9,
  frontRight: 2.9,
  rearLeft: 3.0,
  rearRight: 3.0,
  tpmsHardWarning: false,
  tpmsSoftWarning: false,
  timestamp: '2025-06-01T00:00:00Z',
};

const maintenanceItem: MaintenanceItem = {
  id: 'm-1',
  name: 'Cabin air filter',
  description: 'Replace cabin air filter',
  intervalKm: 30000,
  intervalMonths: 24,
  category: 'filters',
  estimatedCostUsd: 60,
};

const serviceRecord: ServiceRecord = {
  itemId: 'm-1',
  date: '2025-01-15',
  odometerKm: 24000,
  notes: 'done at service center',
};

const softwareUpdate: SoftwareUpdate = {
  id: 'su-1',
  vehicleId: VID,
  version: '2025.14.9',
  status: 'installed',
  installedAt: '2025-05-01T00:00:00Z',
  scheduledAt: null,
  createdAt: '2025-04-28T00:00:00Z',
};

const safety: SafetySnapshot = {
  id: 1,
  vehicle_id: 42,
  forward_collision_warning: 'FORWARD_COLLISION_SENSITIVITY_LEVEL_HIGH',
  pin_to_drive_enabled: true,
};

const media: MediaSnapshot = {
  id: 1,
  vehicle_id: 42,
  now_playing_title: 'Song',
  playback_status: 'Playing',
  created_at: '2025-06-01T00:00:00Z',
};

beforeEach(() => {
  requestMock.mockReset();
});

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('vehicleSystemsKeys', () => {
  it('produces stable, per-domain query key tuples', () => {
    expect(vehicleSystemsKeys.climate(VID)).toEqual(['climate', '42']);
    expect(vehicleSystemsKeys.climateHistory(VID)).toEqual(['climate', 'history', '42']);
    expect(vehicleSystemsKeys.tirePressure(VID)).toEqual(['tire-pressure', '42']);
    expect(vehicleSystemsKeys.tirePressureHistory(VID)).toEqual([
      'tire-pressure',
      'history',
      '42',
    ]);
    expect(vehicleSystemsKeys.tirePressureAnalysisHistory(VID, 30)).toEqual([
      'tire-pressure',
      'analysis-history',
      '42',
      30,
    ]);
    expect(vehicleSystemsKeys.maintenance).toEqual(['maintenance']);
    expect(vehicleSystemsKeys.serviceRecords).toEqual(['service-records']);
    expect(vehicleSystemsKeys.softwareUpdates(VID)).toEqual(['software-updates', '42']);
    expect(vehicleSystemsKeys.safety(VID)).toEqual(['safety', '42']);
    expect(vehicleSystemsKeys.safetyHistory(VID)).toEqual(['safety', 'history', '42']);
    expect(vehicleSystemsKeys.media(VID)).toEqual(['media', '42']);
    expect(vehicleSystemsKeys.mediaHistory(VID)).toEqual(['media', 'history', '42']);
  });

  it('scopes keys by vehicle id so two vehicles cache independently', () => {
    expect(vehicleSystemsKeys.climate('7')).not.toEqual(vehicleSystemsKeys.climate('8'));
    expect(vehicleSystemsKeys.safety('7')).not.toEqual(vehicleSystemsKeys.safety('8'));
  });
});

// ---------------------------------------------------------------------------
// Climate
// ---------------------------------------------------------------------------

describe('useClimate', () => {
  it('GETs /climate/latest scoped by vehicle_id and threads the abort signal', async () => {
    requestMock.mockResolvedValueOnce(climate);
    const { result } = renderHook(() => useClimate(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url, options } = firstCall();
    expect(url).toBe('/climate/latest?vehicle_id=42');
    expect(url).not.toContain('/api/v1');
    expect(options).toHaveProperty('signal');
    expect(result.current.data?.insideTemp).toBe(21.5);
  });

  it('stays idle (no request) until a vehicle id is provided', async () => {
    const { result } = renderHook(() => useClimate(''), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useClimateHistory', () => {
  it('GETs /climate for the vehicle and returns the array body', async () => {
    requestMock.mockResolvedValueOnce([climate]);
    const { result } = renderHook(() => useClimateHistory(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/climate?vehicle_id=42');
    expect(result.current.data).toHaveLength(1);
  });

  it('coerces a null body to [] via safeArray so callers can iterate safely', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useClimateHistory(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tire pressure
// ---------------------------------------------------------------------------

describe('useTirePressure', () => {
  it('GETs /tire-pressure/latest scoped by vehicle_id', async () => {
    requestMock.mockResolvedValueOnce(tire);
    const { result } = renderHook(() => useTirePressure(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/tire-pressure/latest?vehicle_id=42');
    expect(result.current.data?.frontLeft).toBe(2.9);
  });

  it('is disabled for an empty vehicle id', async () => {
    renderHook(() => useTirePressure(''), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('useTirePressureHistory', () => {
  it('GETs /tire-pressure and coerces a null body to []', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTirePressureHistory(VID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/tire-pressure?vehicle_id=42');
    expect(result.current.data).toEqual([]);
  });
});

describe('useTirePressureAnalysisHistory', () => {
  it('requests an explicit 30-day analytical window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    requestMock.mockResolvedValueOnce([tire]);
    const { result } = renderHook(() => useTirePressureAnalysisHistory(VID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url, options } = firstCall();
    const query = queryOf(url);
    expect(url.startsWith('/tire-pressure?')).toBe(true);
    expect(query.get('vehicle_id')).toBe(VID);
    expect(query.get('start')).toBe('2026-01-02T00:00:00.000Z');
    expect(options).toHaveProperty('signal');
    vi.useRealTimers();
  });

  it('is disabled without a vehicle id', async () => {
    renderHook(() => useTirePressureAnalysisHistory(''), { wrapper: makeWrapper() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Maintenance (fleet-wide, no vehicle scope)
// ---------------------------------------------------------------------------

describe('useMaintenance', () => {
  it('GETs the fleet-wide /maintenance catalog', async () => {
    requestMock.mockResolvedValueOnce([maintenanceItem]);
    const { result } = renderHook(() => useMaintenance(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url, options } = firstCall();
    expect(url).toBe('/maintenance');
    expect(options).toHaveProperty('signal');
    expect(result.current.data?.[0].name).toBe('Cabin air filter');
  });

  it('surfaces a request failure as isError instead of swallowing it', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useMaintenance(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('useServiceRecords', () => {
  it('GETs /maintenance/records and returns the rows', async () => {
    requestMock.mockResolvedValueOnce([serviceRecord]);
    const { result } = renderHook(() => useServiceRecords(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/maintenance/records');
    expect(result.current.data?.[0].itemId).toBe('m-1');
  });
});

// ---------------------------------------------------------------------------
// Software updates — regression: MUST scope to the keyed vehicle
// ---------------------------------------------------------------------------

describe('useSoftwareUpdates', () => {
  it('GETs /software-updates scoped by vehicle_id (not the whole fleet)', async () => {
    requestMock.mockResolvedValueOnce([softwareUpdate]);
    const { result } = renderHook(() => useSoftwareUpdates(VID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const { url } = firstCall();
    // Regression guard: the query is keyed per-vehicle, so the request must
    // carry vehicle_id — a bare '/software-updates' cached fleet-wide data.
    expect(url).toBe('/software-updates?vehicle_id=42');
    expect(queryOf(url).get('vehicle_id')).toBe('42');
    expect(result.current.data?.[0].version).toBe('2025.14.9');
  });

  it('is disabled until a vehicle id is available', async () => {
    const { result } = renderHook(() => useSoftwareUpdates(''), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

describe('useSafety', () => {
  it('GETs /safety/latest scoped by vehicle_id', async () => {
    requestMock.mockResolvedValueOnce(safety);
    const { result } = renderHook(() => useSafety(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/safety/latest?vehicle_id=42');
    expect(result.current.data?.pin_to_drive_enabled).toBe(true);
  });
});

describe('useSafetyHistory', () => {
  it('GETs /safety and coerces a null body to []', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSafetyHistory(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/safety?vehicle_id=42');
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

describe('useMedia', () => {
  it('GETs /media/latest scoped by vehicle_id', async () => {
    requestMock.mockResolvedValueOnce(media);
    const { result } = renderHook(() => useMedia(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(firstCall().url).toBe('/media/latest?vehicle_id=42');
    expect(result.current.data?.now_playing_title).toBe('Song');
  });
});

describe('useMediaHistory', () => {
  it('omits start/end params when no range is provided', async () => {
    requestMock.mockResolvedValueOnce([media]);
    const { result } = renderHook(() => useMediaHistory(VID), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = queryOf(firstCall().url);
    expect(params.get('vehicle_id')).toBe('42');
    expect(params.has('start')).toBe(false);
    expect(params.has('end')).toBe(false);
    expect(result.current.data).toHaveLength(1);
  });

  it('appends start and end params when a range is provided', async () => {
    requestMock.mockResolvedValueOnce([media]);
    const start = '2025-01-01T00:00:00Z';
    const end = '2025-01-31T00:00:00Z';
    renderHook(() => useMediaHistory(VID, { start, end }), { wrapper: makeWrapper() });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const params = queryOf(firstCall().url);
    expect(params.get('vehicle_id')).toBe('42');
    expect(params.get('start')).toBe(start);
    expect(params.get('end')).toBe(end);
  });

  it('includes only the provided range bound (end only)', async () => {
    requestMock.mockResolvedValueOnce([]);
    const end = '2025-02-01T00:00:00Z';
    renderHook(() => useMediaHistory(VID, { end }), { wrapper: makeWrapper() });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const params = queryOf(firstCall().url);
    expect(params.has('start')).toBe(false);
    expect(params.get('end')).toBe(end);
  });

  it('is disabled for an empty vehicle id', async () => {
    renderHook(() => useMediaHistory('', { start: 'x' }), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(requestMock).not.toHaveBeenCalled();
  });
});
