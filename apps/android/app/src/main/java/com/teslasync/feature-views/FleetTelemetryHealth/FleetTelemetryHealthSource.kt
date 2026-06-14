// The data port the FleetTelemetryHealth feature view binds to (P1/S8 state-holder seam) — the native
// analogue of the web hook composition the component owns
// (web/src/api/hooks/useTelemetry.ts: `useFleetTelemetryErrorVINs` + `useFleetTelemetryErrors` reads
// and `useRefreshFleetTelemetryErrorVINs` + `useRefreshFleetTelemetryErrors` mutations). The view never
// performs HTTP itself; a shared-store / repository adapter (or a test fake) drives this seam.
// Cache-then-network freshness is preserved end to end (ADR-013): each feed carries its own emission's
// cached / stale / error flags, and the two error-VINs / errors feeds stay independent so each card
// renders its own loading / empty / stale / offline / error surface (web parity: two `useQuery` results).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetTelemetryHealth) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleettelemetryhealth

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.flow.Flow

/**
 * The cache-then-network seam the surface binds to — a four-method abstraction so the ViewModel
 * depends on an interface (real adapter ↔ test fake), never on a concrete store/repository or the
 * network. The two reads mirror the web `useFleetTelemetryErrorVINs()` / `useFleetTelemetryErrors(vin)`
 * queries; the two mutations mirror the web `useRefreshFleetTelemetryErrorVINs()` /
 * `useRefreshFleetTelemetryErrors()` `mutate()` calls (the "Refresh from Tesla" buttons), each a
 * non-throwing suspend [Result].
 */
interface FleetTelemetryHealthSource {
    /** The cache-then-network error-VINs feed (web `useFleetTelemetryErrorVINs`). */
    fun errorVins(): Flow<Resource<List<FleetTelemetryErrorVIN>>>

    /** The cache-then-network errors feed for the optional [vin] filter (web `useFleetTelemetryErrors`). */
    fun errors(vin: String?): Flow<Resource<List<FleetTelemetryError>>>

    /** `POST /tesla/fleet-telemetry/error-vins/refresh` (web `useRefreshFleetTelemetryErrorVINs`). */
    suspend fun refreshErrorVins(): Result<Unit>

    /** `POST /tesla/fleet-telemetry/errors/refresh` (web `useRefreshFleetTelemetryErrors`). */
    suspend fun refreshErrors(): Result<Unit>
}

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] — the cold cache-then-network feeds
 * where the ViewModel's refresh trigger re-subscribing performs a genuine re-fetch (web `refetch()`),
 * and the two mutations are the repository's POST endpoints. No HTTP touches the view.
 */
fun TelemetryRepository.asFleetTelemetryHealthSource(): FleetTelemetryHealthSource {
    val repo = this
    return object : FleetTelemetryHealthSource {
        override fun errorVins(): Flow<Resource<List<FleetTelemetryErrorVIN>>> = repo.fleetTelemetryErrorVINs()

        override fun errors(vin: String?): Flow<Resource<List<FleetTelemetryError>>> = repo.fleetTelemetryErrors(vin)

        override suspend fun refreshErrorVins(): Result<Unit> = repo.refreshFleetTelemetryErrorVINs()

        override suspend fun refreshErrors(): Result<Unit> = repo.refreshFleetTelemetryErrors()
    }
}

/**
 * Binds the surface to the shared **S8** [TelemetryStore] — the memoized, multi-observer error-VINs +
 * errors feeds every Telemetry surface shares. Use this when a host shares one app-wide feed across
 * surfaces; the store folds every observer into a single upstream collection, and each mutation
 * additionally re-collects its affected family of feeds (web `invalidateQueries`). No HTTP touches the
 * view.
 */
fun TelemetryStore.asFleetTelemetryHealthSource(): FleetTelemetryHealthSource {
    val store = this
    return object : FleetTelemetryHealthSource {
        override fun errorVins(): Flow<Resource<List<FleetTelemetryErrorVIN>>> = store.fleetTelemetryErrorVINs()

        override fun errors(vin: String?): Flow<Resource<List<FleetTelemetryError>>> = store.fleetTelemetryErrors(vin)

        override suspend fun refreshErrorVins(): Result<Unit> = store.refreshFleetTelemetryErrorVINs()

        override suspend fun refreshErrors(): Result<Unit> = store.refreshFleetTelemetryErrors()
    }
}
