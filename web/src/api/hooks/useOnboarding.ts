import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

/**
 * useOnboarding.
 *
 * Hook against `GET /api/v1/onboarding/status` to drive the first-run gate
 * and surface live Fleet Telemetry health. The backend reports three setup
 * anchors:
 *
 *   1. tesla_connected — a Tesla OAuth token has been stored
 *   2. vehicle_count   — at least one vehicle row exists locally
 *   3. data_flowing    — telemetry within the last 24 hours
 *
 * Once all three have been observed, `setup_complete` is persisted and never
 * regresses because of a later token or telemetry outage. `setup_required`
 * alone drives routing; the live fields remain informational.
 */

export type TelemetryHealth = 'healthy' | 'stale' | 'unknown';

export interface OnboardingStatus {
  tesla_connected: boolean;
  vehicle_count: number;
  data_flowing: boolean;
  last_telemetry_at: string | null;
  telemetry_health: TelemetryHealth;
  setup_required: boolean;
  setup_complete: boolean;
  /** Backward-compatible alias of setup_complete. */
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
 * New servers own the durable gate through `setup_complete`. During a rolling
 * upgrade, an older payload can still supply only `is_complete`; only when
 * both fields are missing do we fall back to the legacy three-anchor AND.
 */
export function normalizeOnboardingStatus(
  raw: Partial<OnboardingStatus> | null | undefined,
): OnboardingStatus {
  const teslaConnected = raw?.tesla_connected ?? false;
  const vehicleCount = raw?.vehicle_count ?? 0;
  const dataFlowing = raw?.data_flowing ?? false;
  const legacyComplete = teslaConnected && vehicleCount > 0 && dataFlowing;
  const setupComplete = raw?.setup_complete ?? raw?.is_complete ?? legacyComplete;
  const lastTelemetryAt =
    typeof raw?.last_telemetry_at === 'string' && raw.last_telemetry_at.trim()
      ? raw.last_telemetry_at
      : null;
  const telemetryHealth: TelemetryHealth =
    raw?.telemetry_health === 'healthy' ||
    raw?.telemetry_health === 'stale' ||
    raw?.telemetry_health === 'unknown'
      ? raw.telemetry_health
      : vehicleCount === 0 || lastTelemetryAt === null
        ? 'unknown'
        : dataFlowing
          ? 'healthy'
          : 'stale';

  return {
    tesla_connected: teslaConnected,
    vehicle_count: vehicleCount,
    data_flowing: dataFlowing,
    last_telemetry_at: lastTelemetryAt,
    telemetry_health: telemetryHealth,
    setup_required: !setupComplete,
    setup_complete: setupComplete,
    is_complete: setupComplete,
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
  return normalizeOnboardingStatus(raw).setup_complete
    ? false
    : ONBOARDING_POLL_INTERVAL_MS;
}

export interface UseOnboardingStatusOptions {
  /** Keep polling live health after durable setup completes. */
  pollAfterSetup?: boolean;
}

/**
 * Polls while onboarding is incomplete. Runtime-health consumers can opt into
 * continued polling after setup so a telemetry outage clears automatically.
 */
export function useOnboardingStatus(options: UseOnboardingStatusOptions = {}) {
  return useQuery<OnboardingStatus>({
    queryKey: onboardingKeys.status,
    queryFn: ({ signal }) => request<OnboardingStatus>('/onboarding/status', { signal }),
    select: normalizeOnboardingStatus,
    refetchInterval: (query) =>
      options.pollAfterSetup
        ? ONBOARDING_POLL_INTERVAL_MS
        : onboardingRefetchInterval(query.state.data),
    staleTime: 15_000,
    retry: 2,
  });
}
