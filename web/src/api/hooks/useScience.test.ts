// useScience hook tests.
//
// Covers the science fetch contract: snake_case vehicle_id/start/end,
// no /api/v1 prefix, path-id charge IR, and the enabled gate.
// Network is faked at the `@/api/client` boundary.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

import {
  scienceKeys,
  useScienceChargeIR,
  useScienceElectrochem,
  useScienceNotebook,
  useScienceThermal,
  useScienceTires,
  useScienceWeather,
} from './useScience';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useScience', () => {
  it.each([
    ['electrochem', useScienceElectrochem],
    ['thermal', useScienceThermal],
    ['weather', useScienceWeather],
    ['tires', useScienceTires],
    ['notebook', useScienceNotebook],
  ] as const)('requests /science/%s with snake_case params', async (domain, hook) => {
    requestMock.mockResolvedValueOnce({ vehicle_id: 1 });
    const { result } = renderHook(
      () => hook({ vehicleId: '1', start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(requestMock.mock.calls[0][0]);
    expect(url).not.toContain('/api/v1');
    expect(url).toContain(`/science/${domain}`);
    expect(url).toContain('vehicle_id=1');
    expect(url).toContain('start=');
    expect(url).toContain('end=');
    expect(url).not.toMatch(/vehicleId/);
  });

  it('does not fetch without a vehicle id', () => {
    renderHook(() => useScienceElectrochem({ vehicleId: undefined }), { wrapper: makeWrapper() });
    renderHook(() => useScienceNotebook({ vehicleId: undefined }), { wrapper: makeWrapper() });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('requests charge IR by path id', async () => {
    requestMock.mockResolvedValueOnce({ session_id: 9 });
    const { result } = renderHook(() => useScienceChargeIR('9'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(requestMock.mock.calls[0][0])).toBe('/science/charging/9/ir');
  });

  it('builds distinct cache keys per domain and scope', () => {
    expect(scienceKeys.electrochem({ vehicleId: '1' })).not.toEqual(scienceKeys.thermal({ vehicleId: '1' }));
    expect(scienceKeys.notebook({ vehicleId: '1' })).not.toEqual(scienceKeys.notebook({ vehicleId: '2' }));
  });
});
