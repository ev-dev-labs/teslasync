import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requestMock,
  successMock,
  warningMock,
  errorMock,
} = vi.hoisted(() => ({
  requestMock: vi.fn(),
  successMock: vi.fn(),
  warningMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({
    success: successMock,
    warning: warningMock,
    error: errorMock,
  }),
}));

import {
  MAX_BULK_WAKE_VEHICLES,
  useWakeVehiclesBulk,
  type FleetWakeProgress,
} from './useFleetRemediation';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useWakeVehiclesBulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds a sequential batch and reports per-vehicle progress', async () => {
    requestMock.mockImplementation((url: string) => {
      if (url === '/vehicles/2/wake') {
        return Promise.reject(new Error('vehicle unavailable'));
      }
      return Promise.resolve({ status: 'accepted' });
    });
    const progress: FleetWakeProgress[] = [];
    const { result } = renderHook(() => useWakeVehiclesBulk(), { wrapper });

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        vehicleIds: Array.from({ length: 12 }, (_, index) => index + 1),
        onProgress: (next) => progress.push(next),
      });
    });

    expect(requestMock).toHaveBeenCalledTimes(MAX_BULK_WAKE_VEHICLES);
    expect(response).toMatchObject({
      requested: 12,
      submitted: MAX_BULK_WAKE_VEHICLES,
      omitted: 2,
    });
    expect(response?.succeeded).toHaveLength(9);
    expect(response?.failed).toEqual([
      { vehicleId: 2, message: 'vehicle unavailable' },
    ]);
    expect(progress.at(-1)).toEqual({
      completed: 10,
      total: 10,
      succeeded: 9,
      failed: 1,
    });
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(successMock).not.toHaveBeenCalled();
  });

  it('deduplicates vehicle ids and emits one success result', async () => {
    requestMock.mockResolvedValue({ status: 'accepted' });
    const { result } = renderHook(() => useWakeVehiclesBulk(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ vehicleIds: [7, 7, 8] });
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      '/vehicles/7/wake',
      { method: 'POST', requiresLiveMode: true },
    );
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(warningMock).not.toHaveBeenCalled();
  });
});
