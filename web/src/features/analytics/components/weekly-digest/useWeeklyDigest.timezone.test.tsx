import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  timezone_user: 'Pacific/Auckland',
  tz_display_default: 'user',
  fsdArgs: [] as unknown[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key) }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'en-US',
    settings: { timezone_user: h.timezone_user, tz_display_default: h.tz_display_default },
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicles: [{ id: 7, display_name: 'Test Vehicle', vin: 'TESTVIN' }],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ isLoading: false }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertHistory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: (...args: unknown[]) => {
    h.fsdArgs = args;
    return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (v: number) => String(v),
    fmtInt: (v: number) => String(v),
    precision: 2,
    locale: 'en-US',
  }),
}));

import { useWeeklyDigest } from './useWeeklyDigest';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useWeeklyDigest — FSD timezone', () => {
  beforeEach(() => {
    h.timezone_user = 'Pacific/Auckland';
    h.tz_display_default = 'user';
    h.fsdArgs = [];
  });

  it('sends the effective display zone to FSD insights, not the browser zone', () => {
    // Auckland is neither the CI host zone (UTC) nor a typical dev host
    // zone, so this fails while the hook passes browserTimezone().
    renderHook(() => useWeeklyDigest(), { wrapper });
    expect(h.fsdArgs[3]).toBe('Pacific/Auckland');
  });
});
