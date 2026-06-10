package io.teslasync.shared.core.presentation.apihealth

import io.teslasync.shared.core.data.repo.ApiHealthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn

/**
 * UI-free shared state holder for the footer API-health indicator — the cross-platform port of
 * the web `useApiHealth` hook (web/src/api/hooks/useApiHealth.ts). Every native status segment
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the probe endpoint, the poll cadence, or the bucketing thresholds.
 *
 * The single read is exposed as a hot [StateFlow] of [ApiHealthState]. Unlike the cache-then-
 * network S8 domains this is a *poll*, mirroring the web hook's `refetchInterval` exactly:
 *  - the upstream probes immediately on first subscription, then re-probes every
 *    [pollIntervalMillis] (default 15s, the web `POLL_INTERVAL_MS`);
 *  - it starts at [ApiHealth.UNKNOWN] and only ever emits a derived state once a probe completes,
 *    reproducing the web `if (!data) unknown` branch;
 *  - [SharingStarted.WhileSubscribed] suspends polling when nothing observes it and resumes —
 *    re-probing from scratch — on the next subscription, matching the web
 *    `refetchIntervalInBackground: false` + remount-refetch behaviour.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected
 * [ApiHealthRepository] (S7), whose `probe()` never throws for an unreachable server (it
 * resolves to an offline probe), so the poll loop needs no error swallowing of its own.
 *
 * @property repo the S7 data port the probe is routed through.
 * @property scope the coroutine scope the shared poll runs in; cancelling it stops polling.
 * @property pollIntervalMillis delay between successive probes (web `POLL_INTERVAL_MS`).
 */
public class ApiHealthStore(
    private val repo: ApiHealthRepository,
    private val scope: CoroutineScope,
    private val pollIntervalMillis: Long = POLL_INTERVAL_MILLIS,
) {
    /**
     * The live API-health state. Cold until first collected; then probes on subscription and
     * every [pollIntervalMillis] thereafter, deriving each emission through [ApiHealth.deriveState].
     */
    public val state: StateFlow<ApiHealthState> =
        pollFlow().stateIn(
            scope = scope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = ApiHealth.UNKNOWN,
        )

    private fun pollFlow(): Flow<ApiHealthState> =
        flow {
            while (true) {
                emit(ApiHealth.deriveState(repo.probe()))
                delay(pollIntervalMillis)
            }
        }

    private companion object {
        // Web POLL_INTERVAL_MS — re-probe cadence for the footer indicator.
        const val POLL_INTERVAL_MILLIS = 15_000L

        // Keep the poll alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
