import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from '../client';
import {
  OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS,
  SudoCanceledError,
  serviceIntelligenceKeys,
  useCommunicationsCatalogStatus,
  useImportCommunicationsCatalog,
  useServiceIntelligence,
  type CommunicationsCatalogStatus,
  type CommunicationsImportStatus,
  type OfficialNHTSACommunicationsArtifactURL,
  type ServiceIntelligenceResponse,
} from './useServiceIntelligence';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client')>()),
  request: vi.fn(),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => toastMocks,
}));

const mockedRequest = vi.mocked(request);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

const response: ServiceIntelligenceResponse = {
  vehicle_id: 42,
  generated_at: '2026-08-05T06:00:00Z',
  vehicle_context: {
    make: 'TESLA',
    model: 'Model 3',
    model_year: 2019,
    build_date: null,
    build_match_basis: 'Decoded model year and assembly plant.',
    plant_country: 'UNITED STATES (USA)',
    plant_state: 'CALIFORNIA',
    plant_city: 'FREMONT',
    firmware_version: '2024.32.7',
  },
  summary: {
    recall_candidates: 0,
    potentially_applicable_recalls: 0,
    manufacturer_communications: 0,
    symptom_matches: 0,
  },
  recall_findings: [],
  communications: [],
  ranked_symptoms: [],
  evidence: {
    schema_version: '1.0.0',
    items: [],
    limitations: [],
    disclaimer: 'Hypotheses only.',
  },
  sources: [],
};

const importStatus: CommunicationsImportStatus = {
  id: 7,
  artifact_url: OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[4].url,
  source_etag: '"catalog-v1"',
  source_last_modified: 'Tue, 05 Aug 2026 00:00:00 GMT',
  artifact_sha256: 'a'.repeat(64),
  status: 'succeeded',
  total_rows: 1000,
  imported_rows: 188,
  rejected_rows: 0,
  not_modified: false,
  error_detail: null,
  started_at: '2026-08-05T06:00:00Z',
  completed_at: '2026-08-05T06:01:00Z',
};

afterEach(() => {
  mockedRequest.mockReset();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
});

describe('useServiceIntelligence', () => {
  it('does not fetch without a positive vehicle id', async () => {
    const { result, rerender } = renderHook(
      ({ vehicleId }: { vehicleId: number | null }) =>
        useServiceIntelligence(vehicleId),
      {
        initialProps: { vehicleId: null },
        wrapper: makeWrapper(),
      },
    );

    expect(result.current.fetchStatus).toBe('idle');
    rerender({ vehicleId: 0 });
    await Promise.resolve();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('uses the unprefixed route, default refresh flag, and TanStack AbortSignal', async () => {
    mockedRequest.mockResolvedValue(response);
    const { result } = renderHook(() => useServiceIntelligence(42), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, options] = mockedRequest.mock.calls[0]!;
    expect(path).toBe('/service-intelligence/vehicles/42?refresh=false');
    expect(path).not.toContain('/api/v1/');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data).toEqual(response);
  });

  it('propagates an explicit refresh=true query and cache key', async () => {
    mockedRequest.mockResolvedValue(response);
    const { result } = renderHook(() => useServiceIntelligence(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledWith(
      '/service-intelligence/vehicles/7?refresh=true',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(serviceIntelligenceKeys.detail(7, true)).toEqual([
      'service-intelligence',
      'vehicles',
      7,
      { refresh: true },
    ]);
  });

  it('loads typed catalog status through the unprefixed admin route', async () => {
    const status: CommunicationsCatalogStatus = {
      latest_attempt: importStatus,
      latest_successful: importStatus,
      record_count: 188,
    };
    mockedRequest.mockResolvedValue(status);
    const { result } = renderHook(() => useCommunicationsCatalogStatus(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledWith(
      '/admin/service-intelligence/communications/status',
      { signal: expect.any(AbortSignal) },
    );
    expect(result.current.data).toEqual(status);
  });

  it('imports only an official artifact and refreshes status and vehicle intelligence', async () => {
    mockedRequest.mockResolvedValue(importStatus);
    const { queryClient, Wrapper } = makeHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useImportCommunicationsCatalog(), {
      wrapper: Wrapper,
    });
    const artifactURL = OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[4].url;

    await act(async () => {
      await result.current.mutateAsync(artifactURL);
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      '/admin/service-intelligence/communications/import',
      expect.objectContaining({
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ artifact_url: artifactURL }),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: serviceIntelligenceKeys.catalog,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: serviceIntelligenceKeys.vehicles,
    });
    expect(toastMocks.success).toHaveBeenCalledTimes(1);
  });

  it('rejects an arbitrary artifact host before issuing a request', async () => {
    const { Wrapper } = makeHarness();
    const { result } = renderHook(() => useImportCommunicationsCatalog(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.mutateAsync(
        'https://example.com/TSBS_RECEIVED_2025.zip' as OfficialNHTSACommunicationsArtifactURL,
      ),
    ).rejects.toThrow('Unsupported NHTSA communications artifact');
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it('keeps a cancelled shared sudo challenge silent', async () => {
    mockedRequest.mockRejectedValue(new SudoCanceledError());
    const { Wrapper } = makeHarness();
    const { result } = renderHook(() => useImportCommunicationsCatalog(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.mutateAsync(OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[0].url),
    ).rejects.toBeInstanceOf(SudoCanceledError);
    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(toastMocks.success).not.toHaveBeenCalled();
  });
});
