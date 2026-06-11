// The data port the [SignalCatalogWidgetViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web `SignalCatalogWidget`'s hook composition
// (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx): `useSignalCatalog()` over the global
// `/signals/catalog` feed (which drives the WidgetShell loading/stale/error/freshness), `useVehicles()` to
// resolve the default vehicle (web `vehicleId ?? vehicles?.[0]?.id ?? 0`) and `useSignalObservations(id)`
// for the per-signal counts. The view never performs HTTP itself; a concrete adapter over the shared
// Telemetry + Vehicles layer (or a test fake) drives this seam, and cache-then-network freshness is
// preserved end to end (ADR-013) by folding the catalog envelope through unchanged.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalCatalogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signalcatalog

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the three cache-then-network feeds the widget composes — the native port of the web hooks
 * `useSignalCatalog` ([signalCatalog]), `useVehicles` ([vehicles], used only to resolve the default
 * vehicle) and `useSignalObservations` ([signalObservations]). A narrow seam so the view-model depends on
 * an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 * [refresh] re-fetches the catalog (web `refetchCatalog()`) plus the resolved vehicle's observations.
 */
interface SignalCatalogSource {
    /** The cache-then-network `GET /signals/catalog` feed (web `useSignalCatalog`); drives the envelope. */
    fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>>

    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network adapted `GET /signals/observations?vehicle_id={id}` feed (web `useSignalObservations`). */
    fun signalObservations(vehicleId: Long): Flow<Resource<List<SignalObservation>>>

    /** Re-fetch the catalog (web `refetchCatalog()`) and, when [vehicleId] resolves, its observations. */
    suspend fun refresh(vehicleId: Long?)
}

/**
 * Binds the surface to the shared **S8** [TelemetryStore] + [VehiclesStore] — the memoized, multi-observer
 * feeds every Telemetry/Vehicles surface shares (web `useSignalCatalog` + `useVehicles` +
 * `useSignalObservations` ports). Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values (incl. each store's background refresh) flow through
 * unchanged, and [refresh] bumps the stores' own re-fetch triggers. No HTTP touches the view.
 */
fun signalCatalogSource(
    telemetry: TelemetryStore,
    vehicles: VehiclesStore,
): SignalCatalogSource =
    object : SignalCatalogSource {
        override fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>> = telemetry.signalCatalog()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun signalObservations(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
            telemetry.signalObservations(SignalObservationsParams(vehicleId))

        override suspend fun refresh(vehicleId: Long?) {
            telemetry.refreshSignalCatalog()
            vehicleId?.takeIf { it > 0L }?.let { telemetry.refreshSignalObservations(SignalObservationsParams(it)) }
        }
    }

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] + [VehiclesRepository] — the cold
 * cache-then-network `Flow`s the S8 stores also wrap. Each feed re-collection (the ViewModel's
 * refresh/retry trigger) starts a genuine cache-then-network re-fetch (web `refetchCatalog()`), so the
 * suspend [refresh] is a no-op for this binding. No HTTP touches the view.
 */
fun signalCatalogSource(
    telemetry: TelemetryRepository,
    vehicles: VehiclesRepository,
): SignalCatalogSource =
    object : SignalCatalogSource {
        override fun signalCatalog(): Flow<Resource<List<SignalCatalogEntry>>> = telemetry.signalCatalog()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun signalObservations(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
            telemetry.signalObservations(SignalObservationsParams(vehicleId))

        override suspend fun refresh(vehicleId: Long?) = Unit
    }

/**
 * Composes the catalog feed with the active vehicle's observations into one cache-then-network [Resource]
 * of a [SignalCatalogSnapshot] — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0`
 * resolution feeding `useSignalObservations`, with the catalog (web `useSignalCatalog`) driving the
 * surface's loading/empty/error/freshness envelope exactly as the web binds the WidgetShell to the catalog
 * query. The observations feed is best-effort: its counts augment the rows, but its own loading/error never
 * gates the surface (web `observations ?? []`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun signalCatalogResource(
    source: SignalCatalogSource,
    preferredVehicleId: Long?,
): Flow<Resource<SignalCatalogSnapshot>> =
    combine(source.signalCatalog(), observationsFor(source, preferredVehicleId)) { catalog, observations ->
        foldEnvelope(catalog, observations)
    }

/**
 * Resolves which vehicle's observations to read — the native port of `id = vehicleId ?? vehicles?.[0]?.id`.
 * A positive [preferredVehicleId] short-circuits straight to its observations (the vehicle list is not
 * consulted); otherwise the first enrolled vehicle drives them, and when neither resolves (web `id <= 0` ⇒
 * disabled query) an empty observations success is emitted so no counts are shown.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun observationsFor(
    source: SignalCatalogSource,
    preferredVehicleId: Long?,
): Flow<Resource<List<SignalObservation>>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        source.signalObservations(preferred)
    } else {
        source.vehicles().flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(NO_OBSERVATIONS)
                else -> source.signalObservations(id)
            }
        }
    }
}

/**
 * Folds the catalog + observations resources into a single cache-then-network [Resource] of the projected
 * snapshot. The freshness/error envelope follows the catalog feed (web wires `isStale`/`isError`/
 * `dataUpdatedAt` from `useSignalCatalog`), gated to a first-load skeleton while the catalog is still
 * loading with nothing cached. A hard catalog failure keeps the cached entries visible (offline /
 * last-known) whenever there is a cached payload, and only blanks to an error surface when there is nothing
 * at all to show. Observation counts are folded in best-effort from whatever the observations feed has.
 */
private fun foldEnvelope(
    catalog: Resource<List<SignalCatalogEntry>>,
    observations: Resource<List<SignalObservation>>,
): Resource<SignalCatalogSnapshot> {
    val counts = SignalCatalogProjection.buildObservationCounts(observations.cached.orEmpty())
    val data = SignalCatalogSnapshot(entries = catalog.cached.orEmpty(), observationCounts = counts)
    return when (catalog) {
        is Resource.Loading ->
            if (catalog.cached == null) {
                Resource.Loading(cached = null, fetchedAt = catalog.fetchedAt, stale = catalog.stale)
            } else {
                Resource.Loading(cached = data, fetchedAt = catalog.fetchedAt, stale = catalog.stale)
            }

        is Resource.Success -> Resource.Success(data, fetchedAt = catalog.fetchedAt, stale = catalog.stale)

        is Resource.Error ->
            if (catalog.cached != null) {
                Resource.Error(cached = data, fetchedAt = catalog.fetchedAt, stale = true, error = catalog.error)
            } else {
                Resource.Error(cached = null, fetchedAt = catalog.fetchedAt, stale = catalog.stale, error = catalog.error)
            }
    }
}

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/** No-vehicle observations sentinel — an empty success so no counts are shown (web disabled-query branch). */
private val NO_OBSERVATIONS: Resource<List<SignalObservation>> =
    Resource.Success(emptyList(), fetchedAt = 0L, stale = false)
