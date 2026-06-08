package io.teslasync.shared.core.presentation.fleettelemetry

import io.teslasync.shared.core.data.repo.FleetTelemetryRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Fleet-Telemetry routing-coverage snapshot — the cross-platform
 * port of the web `useFleetTelemetry` hook domain (web/src/api/hooks/useFleetTelemetry.ts). Every
 * native Fleet-Telemetry screen (Android/Apple via KMP, Windows via the C# port) binds to this
 * single holder rather than re-implementing the endpoint, the query key, the refetch rule, or the
 * `?? []` / `?? {}` normalization.
 *
 * The lone read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013): it is
 * lazily created on first access, shared so every observer folds into one upstream collection, and
 * refreshable via [refreshCoverage]. There are no parameters (the snapshot is fleet-wide) and no
 * mutations — the web hook file contains only a single `useQuery` — so there is neither a
 * per-key feed map nor an invalidation surface.
 *
 * The emitted [FleetTelemetryCoverageResponse] is already normalized by the repository (S7) via the
 * pure [FleetTelemetryCoverage.normalize] derivation, so the holder neither converts nor reshapes
 * it; values stay SI and conversion is display-only (S5). The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed is routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class FleetTelemetryStore(
    private val repo: FleetTelemetryRepository,
    private val scope: CoroutineScope,
) {
    private val trigger = MutableStateFlow(0)

    private val coverageFeed: StateFlow<Resource<FleetTelemetryCoverageResponse>> by lazy {
        trigger
            .flatMapLatest { repo.coverage() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )
    }

    /**
     * Shared, refreshable `GET /tesla/fleet-telemetry/coverage` feed (web `useFleetTelemetryCoverage`).
     * Cold until first collected; every caller receives the same shared instance.
     */
    public fun coverage(): StateFlow<Resource<FleetTelemetryCoverageResponse>> = coverageFeed

    /**
     * Re-fetches the [coverage] feed if it is being observed. Bumping the trigger restarts the
     * underlying cache-then-network collection; a no-op while nothing observes the feed (the upstream
     * is not running, so there is nothing to restart).
     */
    public fun refreshCoverage() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<FleetTelemetryCoverageResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
