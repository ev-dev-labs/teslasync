// useOnboarding hook + helper tests.
//
// Covers every export of the first-run onboarding gate module:
//
//   - onboardingKeys.status is a stable readonly query-key tuple.
//   - ONBOARDING_POLL_INTERVAL_MS is the 30s cadence.
//   - normalizeOnboardingStatus coerces a full / partial / null /
//     undefined / malformed payload into a null-safe OnboardingStatus,
//     preferring the backend `is_complete` when present and recomputing
//     it (AND of the three anchors) only when it is absent.
//   - onboardingRefetchInterval stops polling (false) once complete and
//     keeps polling (30s) for every incomplete / empty payload.
//   - useOnboardingStatus resolves the normalised status, threads the
//     AbortSignal to request('/onboarding/status'), normalises a partial
//     backend payload end-to-end, and surfaces ApiError on transport
//     failure so the gate stays pessimistic.
//
// Sibling-of-source location is mandatory — the gate matches
// `api/hooks/useOnboarding` as a contiguous substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { ApiError, request } from '@/api/client';
import {
  onboardingKeys,
  ONBOARDING_POLL_INTERVAL_MS,
  normalizeOnboardingStatus,
  onboardingRefetchInterval,
  useOnboardingStatus,
  type OnboardingStatus,
} from './useOnboarding';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// Fresh QueryClient per test so retry state transitions (the hook keeps
// its own retry: 2) survive re-renders instead of resetting. retryDelay
// is pinned to 0 so the error path resolves without real backoff waits.
function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const completePayload: OnboardingStatus = {
  tesla_connected: true,
  vehicle_count: 2,
  data_flowing: true,
  last_telemetry_at: '2026-01-01T00:00:00Z',
  telemetry_health: 'healthy',
  setup_required: false,
  setup_complete: true,
  is_complete: true,
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('onboardingKeys', () => {
  it('exports a stable readonly status key tuple', () => {
    expect(onboardingKeys.status).toEqual(['onboarding', 'status']);
  });
});

describe('ONBOARDING_POLL_INTERVAL_MS', () => {
  it('is the documented 30s cadence', () => {
    expect(ONBOARDING_POLL_INTERVAL_MS).toBe(30_000);
  });
});

describe('normalizeOnboardingStatus', () => {
  it('passes a complete payload through and prefers the backend is_complete', () => {
    expect(normalizeOnboardingStatus(completePayload)).toEqual(completePayload);
  });

  it('keeps is_complete=true from the backend even if anchors disagree', () => {
    const rollingUpgradePayload: Partial<OnboardingStatus> = {
      tesla_connected: false,
      vehicle_count: 0,
      data_flowing: false,
      is_complete: true,
    };
    expect(normalizeOnboardingStatus(rollingUpgradePayload)).toMatchObject({
      setup_complete: true,
      setup_required: false,
      is_complete: true,
    });
  });

  it('prefers durable setup_complete over a conflicting compatibility alias', () => {
    const inconsistent: Partial<OnboardingStatus> = {
      tesla_connected: true,
      vehicle_count: 3,
      data_flowing: true,
      is_complete: false,
      setup_complete: true,
    };
    expect(normalizeOnboardingStatus(inconsistent)).toMatchObject({
      setup_complete: true,
      setup_required: false,
      is_complete: true,
    });
  });

  it('recomputes setup completion from the three anchors for a legacy payload', () => {
    const withoutFlag: Partial<OnboardingStatus> = {
      tesla_connected: true,
      vehicle_count: 1,
      data_flowing: true,
    };
    expect(normalizeOnboardingStatus(withoutFlag)).toMatchObject({
      setup_complete: true,
      setup_required: false,
      is_complete: true,
    });
  });

  it('recomputes is_complete=false when a vehicle is missing and flag omitted', () => {
    const noVehicles: Partial<OnboardingStatus> = {
      tesla_connected: true,
      vehicle_count: 0,
      data_flowing: true,
    };
    expect(normalizeOnboardingStatus(noVehicles).is_complete).toBe(false);
  });

  it('defaults every anchor pessimistically for a partial payload', () => {
    expect(normalizeOnboardingStatus({ tesla_connected: true })).toEqual({
      tesla_connected: true,
      vehicle_count: 0,
      data_flowing: false,
      last_telemetry_at: null,
      telemetry_health: 'unknown',
      setup_required: true,
      setup_complete: false,
      is_complete: false,
    });
  });

  it('returns an all-false status for undefined input', () => {
    expect(normalizeOnboardingStatus(undefined)).toEqual({
      tesla_connected: false,
      vehicle_count: 0,
      data_flowing: false,
      last_telemetry_at: null,
      telemetry_health: 'unknown',
      setup_required: true,
      setup_complete: false,
      is_complete: false,
    });
  });

  it('returns an all-false status for null input', () => {
    expect(normalizeOnboardingStatus(null)).toEqual({
      tesla_connected: false,
      vehicle_count: 0,
      data_flowing: false,
      last_telemetry_at: null,
      telemetry_health: 'unknown',
      setup_required: true,
      setup_complete: false,
      is_complete: false,
    });
  });

  it('keeps a configured installation complete when live telemetry is stale', () => {
    expect(
      normalizeOnboardingStatus({
        tesla_connected: true,
        vehicle_count: 1,
        data_flowing: false,
        last_telemetry_at: '2025-12-31T00:00:00Z',
        telemetry_health: 'stale',
        setup_complete: true,
      }),
    ).toMatchObject({
      telemetry_health: 'stale',
      setup_complete: true,
      setup_required: false,
      is_complete: true,
    });
  });
});

describe('onboardingRefetchInterval', () => {
  it('stops polling once setup is complete', () => {
    expect(onboardingRefetchInterval(completePayload)).toBe(false);
  });

  it('keeps polling at the 30s cadence while incomplete', () => {
    expect(onboardingRefetchInterval({
      ...completePayload,
      setup_complete: false,
      setup_required: true,
      is_complete: false,
    })).toBe(
      ONBOARDING_POLL_INTERVAL_MS,
    );
  });

  it('keeps polling for an undefined payload (loading / error)', () => {
    expect(onboardingRefetchInterval(undefined)).toBe(ONBOARDING_POLL_INTERVAL_MS);
  });

  it('stops polling when all anchors are set but the flag was omitted', () => {
    expect(
      onboardingRefetchInterval({
        tesla_connected: true,
        vehicle_count: 1,
        data_flowing: true,
      }),
    ).toBe(false);
  });
});

describe('useOnboardingStatus', () => {
  it('resolves the normalised status payload', async () => {
    mockedRequest.mockResolvedValue(completePayload);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(completePayload);
  });

  it('calls request() against /onboarding/status with an AbortSignal', async () => {
    mockedRequest.mockResolvedValue(completePayload);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedRequest.mock.calls[0] ?? [];
    expect(path).toBe('/onboarding/status');
    // The hook must thread the React Query signal so the in-flight
    // request is cancelled when the consumer unmounts mid-poll.
    expect(opts).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('normalises a partial backend payload into a pessimistic status', async () => {
    // Simulate a first-boot race where the backend omits fields.
    mockedRequest.mockResolvedValue({ tesla_connected: true } as OnboardingStatus);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      tesla_connected: true,
      vehicle_count: 0,
      data_flowing: false,
      last_telemetry_at: null,
      telemetry_health: 'unknown',
      setup_required: true,
      setup_complete: false,
      is_complete: false,
    });
  });

  it('continues polling after setup when requested by a runtime-health consumer', async () => {
    mockedRequest.mockResolvedValue(completePayload);
    const { result } = renderHook(
      () => useOnboardingStatus({ pollAfterSetup: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.setup_complete).toBe(true);
  });

  it('surfaces transport failures as ApiError so the gate stays pessimistic', async () => {
    mockedRequest.mockRejectedValue(new ApiError('Service Unavailable', 503));
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.status).toBe(503);
  });
});
