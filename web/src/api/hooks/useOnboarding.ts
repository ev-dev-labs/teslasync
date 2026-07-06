import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

/**
 * useOnboarding.
 *
 * Hook against `GET /api/v1/onboarding/status` to drive the first-run
 * gate. The backend reports three independent anchors that all must be
 * true before TeslaSync considers an install "set up":
 *
 *   1. tesla_connected — a Tesla OAuth token has been stored
 *   2. vehicle_count   — at least one vehicle row exists locally
 *   3. data_flowing    — telemetry within the last 24 hours
 *
 * `is_complete` is the AND of all three — clients should prefer it
 * over re-implementing the gate logic on the frontend.
 */

export interface OnboardingStatus {
  tesla_connected: boolean;
  vehicle_count: number;
  data_flowing: boolean;
  is_complete: boolean;
}

export const onboardingKeys = {
  status: ['onboarding', 'status'] as const,
};

/**
 * Poll cadence while onboarding is still incomplete. 30s is fast enough
 * for a vehicle sync (≤60s) and a first signal batch (≤5min) to feel
 * responsive without spamming the backend.
 */
export const ONBOARDING_POLL_INTERVAL_MS = 30_000;

/**
 * Coerces a possibly-partial status payload into a fully-formed,
 * null-safe {@link OnboardingStatus}.
 *
 * The endpoint is a first-run *gate*: it must never let a missing or
 * malformed field decode as `undefined` and slip a half-configured
 * install past the gate into a dashboard that can only render empty
 * states. Every anchor therefore defaults to the pessimistic "not set
 * up yet" value when absent.
 *
 * `is_complete` is preferred verbatim from the backend when present — it
 * owns the gate logic (see the module doc). Only when the field is
 * missing do we fall back to recomputing it as the AND of the three
 * anchors, matching the documented contract.
 */
export function normalizeOnboardingStatus(
  raw: Partial<OnboardingStatus> | null | undefined,
): OnboardingStatus {
  const teslaConnected = raw?.tesla_connected ?? false;
  const vehicleCount = raw?.vehicle_count ?? 0;
  const dataFlowing = raw?.data_flowing ?? false;
  const isComplete =
    raw?.is_complete ?? (teslaConnected && vehicleCount > 0 && dataFlowing);

  return {
    tesla_connected: teslaConnected,
    vehicle_count: vehicleCount,
    data_flowing: dataFlowing,
    is_complete: isComplete,
  };
}

/**
 * Decides the next poll delay from a possibly-partial status. Returns
 * `false` once setup is complete so React Query stops the interval; the
 * gate then re-checks only on a full app reload. Any incomplete, empty,
 * or malformed payload keeps the poll alive at
 * {@link ONBOARDING_POLL_INTERVAL_MS}.
 */
export function onboardingRefetchInterval(
  raw: Partial<OnboardingStatus> | null | undefined,
): number | false {
  return normalizeOnboardingStatus(raw).is_complete
    ? false
    : ONBOARDING_POLL_INTERVAL_MS;
}

/**
 * Polls onboarding status while the user is being onboarded, then stops
 * polling once `is_complete` flips to true. The response is normalised
 * so consumers always receive a fully-formed, null-safe status even when
 * the backend omits a field during a first-boot race.
 */
export function useOnboardingStatus() {
  return useQuery<OnboardingStatus>({
    queryKey: onboardingKeys.status,
    queryFn: ({ signal }) => request<OnboardingStatus>('/onboarding/status', { signal }),
    // Null-safe shape for every consumer + the poll decision below.
    select: normalizeOnboardingStatus,
    // Stop polling once setup is complete; the gate flips to "pass"
    // and re-checks only on full app reload.
    refetchInterval: (query) => onboardingRefetchInterval(query.state.data),
    staleTime: 15_000,
    // Treat the gate as pessimistic — if the request fails (e.g. on
    // first boot before the API is up), assume not complete so the
    // user sees the onboarding page rather than a broken dashboard.
    retry: 2,
  });
}
