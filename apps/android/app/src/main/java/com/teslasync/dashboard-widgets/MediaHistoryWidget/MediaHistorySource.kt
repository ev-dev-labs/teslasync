// The data port the Media History widget binds to — the native analogue of the web `useVehicles` +
// `useMediaHistory` hook composition (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx,
// web/src/api/hooks/useVehicleSystems.ts), vehicle resolution included. The view never performs HTTP; a
// concrete adapter over the shared S7/S8 layer (or a test fake) drives this seam. Cache-then-network
// freshness is preserved end to end (ADR-013): the parsed projection carries every cached/stale/error
// flag from the upstream `/media` feed so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MediaHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mediahistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import io.teslasync.shared.core.presentation.vehiclesystems.VehicleSystemsStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network sequence of parsed media-history snapshots the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface MediaHistorySource {
    /** The cache-then-network track feed (cached rows first for an instant cold start, then refreshed). */
    fun history(): Flow<Resource<List<MediaTrackEntry>>>
}

/**
 * Parse a raw [Resource] of `/media` JSON into a [Resource] of [MediaTrackEntry] rows, preserving every
 * freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
 * matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or cache. A non-array
 * (or absent) body parses to an empty list — the web `select: safeArray` null-guard, which then drives
 * the "No tracks played" empty surface.
 */
internal fun Resource<JsonElement>.toMediaEntries(): Resource<List<MediaTrackEntry>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let { MediaTrackEntry.parseList(it) },
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = MediaTrackEntry.parseList(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let { MediaTrackEntry.parseList(it) },
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Composes the fleet list with the active vehicle's media history into one cache-then-network
 * [Resource] stream — the native port of the web `vid = vehicleId ?? vehicles?.[0]?.id` resolution feeding
 * `useMediaHistory(vidStr ?? '')`. A positive [preferredVehicleId] short-circuits straight to its history
 * feed (the web vehicle-list is not consulted when a prop id is supplied); otherwise the first enrolled
 * vehicle drives the feed, and when neither resolves the fleet resource is folded onto an empty-array
 * value so the surface renders its loading / empty / error state honestly (web's disabled
 * `enabled: !!vehicleId` query → `history` undefined → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun mediaHistoryJsonResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    historyFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        historyFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleHistory())
                else -> historyFor(id)
            }
        }
    }
}

/** Folds a fleet-list [Resource] onto an empty-history value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleHistory(): Resource<JsonElement> {
    val empty: JsonElement = JsonArray(emptyList())
    return when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(empty, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
}

/**
 * The shared **S8** state-holder-backed [MediaHistorySource]. Resolves the scoped vehicle from the shared
 * [VehiclesStore] enrolled-vehicle list (web `vehicles?.[0]?.id`, overridable by [explicitVehicleId]) and
 * maps the shared [VehicleSystemsStore.mediaHistory] cache-then-network feed (web `useMediaHistory`) into
 * parsed [MediaTrackEntry] rows. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app. No HTTP touches the view — the stores (S7/S8) own it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreMediaHistorySource(
    private val vehiclesStore: VehiclesStore,
    private val vehicleSystemsStore: VehicleSystemsStore,
    private val explicitVehicleId: Long? = null,
) : MediaHistorySource {
    override fun history(): Flow<Resource<List<MediaTrackEntry>>> =
        mediaHistoryJsonResource(
            vehicles = vehiclesStore.vehicles(),
            preferredVehicleId = explicitVehicleId,
            historyFor = { id -> vehicleSystemsStore.mediaHistory(id.toString()) },
        ).map { it.toMediaEntries() }
}

/**
 * The shared **S7** repository-backed [MediaHistorySource] — the cold cache-then-network feeds the S8
 * stores also wrap. Re-collecting performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual retry/refresh affordance (the web `useMediaHistory().refetch()`); the view-model
 * reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RepositoryMediaHistorySource(
    private val vehiclesRepository: VehiclesRepository,
    private val vehicleSystemsRepository: VehicleSystemsRepository,
    private val explicitVehicleId: Long? = null,
) : MediaHistorySource {
    override fun history(): Flow<Resource<List<MediaTrackEntry>>> =
        mediaHistoryJsonResource(
            vehicles = vehiclesRepository.vehicles(),
            preferredVehicleId = explicitVehicleId,
            historyFor = { id -> vehicleSystemsRepository.mediaHistory(id.toString()) },
        ).map { it.toMediaEntries() }
}
