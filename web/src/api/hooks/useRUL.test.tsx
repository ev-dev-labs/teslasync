/**
 * useRUL hook tests.
 *
 * Asserts the request each hook builds (no `/api/v1` prefix), AbortSignal
 * threading, `enabled` gating, and — the TZ-4 contract — that the user's
 * effective display zone travels as `?timezone=` so the backend's daily
 * SoH series lines up with the selected zone. The HTTP boundary is mocked
 * at `../client`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

// Saved display zone for the omitted-timezone tests: Auckland is neither the
// CI host zone (UTC) nor a typical dev host zone, so it proves the hooks
// resolve the effective zone instead of the browser zone.
const h = vi.hoisted(() => ({
  timezone_user: 'Pacific/Auckland',
  tz_display_default: 'user',
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'en-US',
    settings: { timezone_user: h.timezone_user, tz_display_default: h.tz_display_default },
  }),
}));

import { request } from '../client';
import {
  useRUL,
  useComponentRUL,
  type RULResponse,
  type ComponentDetailResponse,
} from './useRUL';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The (url, options) tuple of the Nth `request()` invocation. */
function callAt(n = 0): [string, { signal?: unknown }] {
  return mockedRequest.mock.calls[n] as [string, { signal?: unknown }];
}

/** Let a disabled query settle so "did NOT fire" is a real observation. */
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  mockedRequest.mockReset();
});

const boardFixture: RULResponse = {
  vehicle_id: 7,
  components: [],
  next_service: null,
};

const detailFixture: ComponentDetailResponse = {
  component: 'tires',
  label: 'Tires',
  health_pct: 8,
  wear_rate_per_day: 0.1,
  remaining_days: 80,
  remaining_km: 4000,
  projected_eol_date: '2026-12-01',
  confidence: 0.9,
  status: 'replace_soon',
  basis: 'odometer',
  observation_available: true,
  projection_available: true,
  basis_kind: 'whole_life_odometer',
  eol_threshold: 0,
  nominal_life_km: 50000,
  nominal_life_days: null,
  notes: 'Tread life',
  projection: [],
};

describe('useRUL', () => {
  it('sends an explicit timezone with no /api/v1 prefix', async () => {
    mockedRequest.mockResolvedValueOnce(boardFixture);
    const { result } = renderHook(() => useRUL(7, 'America/Los_Angeles'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, options] = callAt();
    expect(url.startsWith('/vehicles/7/rul?')).toBe(true);
    expect(url).not.toContain('/api/v1');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('America/Los_Angeles');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the effective display zone when the timezone is omitted', async () => {
    mockedRequest.mockResolvedValueOnce(boardFixture);
    const { result } = renderHook(() => useRUL(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Pacific/Auckland');
  });

  it('stays idle until a vehicle is known', async () => {
    renderHook(() => useRUL(null), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useComponentRUL', () => {
  it('sends an explicit timezone', async () => {
    mockedRequest.mockResolvedValueOnce(detailFixture);
    const { result } = renderHook(() => useComponentRUL(7, 'tires', 'Asia/Tokyo'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    expect(url.startsWith('/vehicles/7/rul/tires?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Asia/Tokyo');
  });

  it('sends the effective display zone when the timezone is omitted', async () => {
    mockedRequest.mockResolvedValueOnce(detailFixture);
    const { result } = renderHook(() => useComponentRUL(7, 'tires'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Pacific/Auckland');
  });

  it('stays idle until a vehicle and component are known', async () => {
    renderHook(() => useComponentRUL(7, null), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
