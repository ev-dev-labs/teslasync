import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  BatteryPassport,
  BatteryPassportVerifyResponse,
} from './useBatteryPassport';

const requestMock = vi.fn();

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  useBatteryPassport,
  useVerifyPassport,
} from './useBatteryPassport';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    );
  }
  return { Wrapper, client };
}

const passport: BatteryPassport = {
  vehicle_id: 7,
  vin_masked: '5YJ**********1234',
  issued_at: '2026-08-08T10:00:00Z',
  first_observed_at: null,
  soh_pct: 91.2,
  capacity_kwh: 68.4,
  original_capacity_kwh: 75,
  equivalent_full_cycles: 321.4,
  fast_charge_ratio: 0.125,
  avg_charge_limit_pct: 81.2,
  thermal_exposure: {
    cold_pct: 10,
    nominal_pct: 80,
    hot_pct: 10,
  },
  health_grade: 'B',
  degradation_trend: [],
  recommendations: [],
  provenance_hash: 'a'.repeat(64),
};

beforeEach(() => {
  requestMock.mockReset();
});

describe('useBatteryPassport', () => {
  it('uses the canonical route, preserved key, and AbortSignal', async () => {
    requestMock.mockResolvedValueOnce(passport);
    const { Wrapper, client } = wrapper();
    const { result } = renderHook(
      () => useBatteryPassport('7'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, options] = requestMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/vehicles/7/battery-passport');
    expect(url).not.toContain('/api/v1/');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(
      client.getQueryCache().find({
        queryKey: ['battery-passport', '7'],
      }),
    ).toBeDefined();
  });

  it('remains disabled without a vehicle identifier', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useBatteryPassport(null),
      { wrapper: Wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('useVerifyPassport', () => {
  it('encodes the snake_case hash query and forwards AbortSignal', async () => {
    const response: BatteryPassportVerifyResponse = {
      valid: false,
      expected_hash: 'expected',
      provided_hash: 'a b/&?=_',
    };
    requestMock.mockResolvedValueOnce(response);
    const { Wrapper, client } = wrapper();
    const { result } = renderHook(
      () => useVerifyPassport('7', 'a b/&?=_'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, options] = requestMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      '/vehicles/7/battery-passport/verify?hash=a%20b%2F%26%3F%3D_',
    );
    expect(url).not.toContain('/api/v1/');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(
      client.getQueryCache().find({
        queryKey: [
          'battery-passport-verify',
          '7',
          'a b/&?=_',
        ],
      }),
    ).toBeDefined();
  });

  it.each([
    [null, 'hash'],
    ['7', null],
    ['7', ''],
  ])(
    'is disabled for vehicle %s and hash %s',
    (vehicleId, hash) => {
      const { Wrapper } = wrapper();
      const { result } = renderHook(
        () => useVerifyPassport(vehicleId, hash),
        { wrapper: Wrapper },
      );

      expect(result.current.fetchStatus).toBe('idle');
      expect(requestMock).not.toHaveBeenCalled();
    },
  );
});
