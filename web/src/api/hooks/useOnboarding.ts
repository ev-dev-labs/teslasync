import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

/**
 * useOnboarding — Phase 40 / Prompt 18.
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
 * Polls onboarding status while the user is being onboarded, then
 * stops polling once `is_complete` flips to true. The 30s cadence is
 * fast enough for a vehicle sync ((≤60s) and a first signal batch
 * ((≤5min) to feel responsive without spamming the backend.
 */
export function useOnboardingStatus() {
  return useQuery<OnboardingStatus>({
    queryKey: onboardingKeys.status,
    queryFn: () => request<OnboardingStatus>('/onboarding/status'),
    // Stop polling once setup is complete; the gate flips to "pass"
    // and re-checks only on full app reload.
    refetchInterval: (query) =>
      query.state.data?.is_complete ? false : 30_000,
    staleTime: 15_000,
    // Treat the gate as pessimistic — if the request fails (e.g. on
    // first boot before the API is up), assume not complete so the
    // user sees the onboarding page rather than a broken dashboard.
    retry: 2,
  });
}
