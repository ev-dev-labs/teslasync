package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the first-run onboarding gate — the cross-platform analogue of the web
 * `useOnboarding` hook domain (web/src/api/hooks/useOnboarding.ts), mounted at
 * `/api/v1/onboarding/status`. Every native onboarding surface (Android/Apple via KMP, Windows via
 * the C# port) reaches the backend exclusively through this interface, so a single fake stands in
 * for the whole domain in the S8 state-holder tests.
 *
 * The single member is a read — `useOnboarding.ts` contains only one `useQuery`, no mutations — so
 * it streams a cache-then-network [Resource] (ADR-013): the cached gate first for an instant cold
 * start, then the refreshed value. The web hook's 30s `refetchInterval` (and the stop-when-complete
 * rule) is a polling cadence owned by the S8 store, not the data port; this port just streams one
 * cache-then-network cycle per call. There is nothing to invalidate (no mutations).
 *
 * The payload is plain gate metadata (two booleans, a count, and the server-computed
 * `is_complete`) — not display-unit-bearing — so there is no S5 conversion here and the exact
 * server shape round-trips unchanged.
 */
public interface OnboardingRepository {
    /**
     * `GET /onboarding/status` — the three first-run anchors plus the server-computed
     * `is_complete`. The endpoint is designed to return 200 even when individual checks fail
     * (falling back to "not connected / no vehicles / no data"), so a non-2xx surfaces only on a
     * hard infrastructure error and reaches consumers as [Resource.Error]; the gate then stays
     * pessimistically incomplete, matching the web hook's `retry: 2` "assume not complete on
     * failure" intent.
     */
    public fun status(): Flow<Resource<OnboardingStatus>>
}
