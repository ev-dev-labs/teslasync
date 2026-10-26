/**
 * useCarbon hook tests.
 *
 * Asserts the request each hook builds (snake_case params, no `/api/v1`
 * prefix), AbortSignal threading, `enabled` gating, and — the TZ-4
 * contract — that the user's effective display zone travels as
 * `?timezone=` so the backend's (month, hour) buckets line up with the
 * selected zone. The HTTP boundary is mocked at `../client`.
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
  useCarbonIntensity,
  useCarbonSummary,
  useCarbonRecommendation,
  type CarbonIntensityCurve,
  type CarbonSummary,
  type CarbonRecommendation,
} from './useCarbon';

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

const summaryFixture: CarbonSummary = {
  total_energy_kwh: 100,
  total_co2_kg: 20,
  gas_equiv_co2_kg: 50,
  co2_saved_kg: 30,
  green_score: 80,
  sessions_scored: 10,
  monthly: [{ month: '2026-03', co2_kg: 20, energy_kwh: 100 }],
};

const recommendationFixture: CarbonRecommendation = {
  current_avg_intensity: 300,
  greenest_window: { start_hour: 1, end_hour: 5, avg_intensity: 100 },
  potential_co2_saving_kg: 5,
  potential_saving_pct: 25,
};

const intensityFixture: CarbonIntensityCurve = {
  curve: [{ hour_of_day: 0, g_co2_per_kwh: 100 }],
  min: 100,
  max: 100,
  greenest_hours: [0],
  dirtiest_hours: [0],
};

describe('useCarbonSummary', () => {
  it('sends the window and an explicit timezone with no /api/v1 prefix', async () => {
    mockedRequest.mockResolvedValueOnce(summaryFixture);
    const { result } = renderHook(
      () => useCarbonSummary(42, '2026-03-01', '2026-03-31', 'America/Los_Angeles'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, options] = callAt();
    expect(url.startsWith('/vehicles/42/carbon/summary?')).toBe(true);
    expect(url).not.toContain('/api/v1');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('from')).toBe('2026-03-01');
    expect(params.get('to')).toBe('2026-03-31');
    expect(params.get('timezone')).toBe('America/Los_Angeles');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the effective display zone when the timezone is omitted', async () => {
    mockedRequest.mockResolvedValueOnce(summaryFixture);
    const { result } = renderHook(() => useCarbonSummary(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Pacific/Auckland');
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
  });

  it('stays idle until a vehicle is known', async () => {
    renderHook(() => useCarbonSummary(null), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useCarbonRecommendation', () => {
  it('sends an explicit timezone', async () => {
    mockedRequest.mockResolvedValueOnce(recommendationFixture);
    const { result } = renderHook(() => useCarbonRecommendation(42, 'Asia/Tokyo'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    expect(url.startsWith('/vehicles/42/carbon/recommendation?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Asia/Tokyo');
  });

  it('sends the effective display zone when the timezone is omitted', async () => {
    mockedRequest.mockResolvedValueOnce(recommendationFixture);
    const { result } = renderHook(() => useCarbonRecommendation(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('timezone')).toBe('Pacific/Auckland');
  });

  it('stays idle until a vehicle is known', async () => {
    renderHook(() => useCarbonRecommendation(null), { wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

describe('useCarbonIntensity', () => {
  it('fetches the vehicle-independent grid model unconditionally', async () => {
    mockedRequest.mockResolvedValueOnce(intensityFixture);
    const { result } = renderHook(() => useCarbonIntensity(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = callAt();
    expect(url).toBe('/carbon/intensity');
    expect(result.current.data?.greenest_hours).toEqual([0]);
  });
});
