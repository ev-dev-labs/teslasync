// The data port the [VampireDrainWidgetViewModel] binds to (P1/S8 state-holder seam) — the native analogue
// of the web `VampireDrainWidget`'s hook composition
// (web/src/features/dashboard/widgets/VampireDrainWidget.tsx): `useVehicles` for the default vehicle id
// (web `vehicleId ?? vehicles?.[0]?.id`), then the two `useVampireDrainStats` / `useVampireDrainEvents`
// queries. On the shared side those are the [EnergyStore.vampireDrainStats] / [EnergyStore.vampireDrainEvents]
// feeds (the same deprecated `/vampire-drain/stats` + `/vampire-drain` routes the web hooks call), so this
// seam folds the vehicles feed with the two energy feeds. The view never performs HTTP itself (the P1/S8
// boundary); a re-collection (the ViewModel's refresh / retry) restarts the upstream so a manual refresh
// actually re-fetches.
//
// NOTE (web parity): the web `useVampireDrainStats` / `useVampireDrainEvents` hooks are deprecated — the
// backend routes were removed and reliably 404 — and the web widget surfaces that error GRACEFULLY (it
// never passes the `error` string to `WidgetShell`, so it shows the friendly "No vampire drain data" empty
// state with an error freshness chip + a refresh affordance, never a full error screen). This seam
// reproduces that exactly: a cache-less hard failure collapses to the empty surface with the error flagged,
// and any cached value is kept visible (offline / last-known) — see [combineVampireDrain].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VampireDrainWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vampiredrain

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement

/** Rows requested from `/vampire-drain` for the sparkline + feed (web `useVampireDrainEvents(idStr, 30)`). */
const val VAMPIRE_DRAIN_EVENT_LIMIT: Int = 30

/**
 * Streams the cache-then-network sequence of parsed [VampireDrainSnapshot]s the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface VampireDrainSource {
    /** Stream the cache-then-network vampire-drain snapshots, newest data following the cached value. */
    fun stream(): Flow<Resource<VampireDrainSnapshot>>
}

/**
 * Binds the surface to the shared **S8** holders — the [EnergyStore.vampireDrainStats] +
 * [EnergyStore.vampireDrainEvents] feeds (web `useVampireDrainStats` / `useVampireDrainEvents`) scoped to
 * the vehicle resolved from the app-wide [VehiclesStore.vehicles] list (web `useVehicles`). Use this when a
 * host shares one app-wide vehicles + energy feed across surfaces; the live values (incl. each store's
 * background refresh) flow through unchanged. No HTTP touches the view.
 */
fun vampireDrainSource(
    energy: EnergyStore,
    vehicles: VehiclesStore,
    vehicleId: Long? = null,
): VampireDrainSource =
    VampireDrainSource {
        vampireDrainResource(
            vehicles = vehicles.vehicles(),
            explicitVehicleId = vehicleId,
            stats = { id -> energy.vampireDrainStats(id.toString()) },
            events = { id -> energy.vampireDrainEvents(id.toString(), VAMPIRE_DRAIN_EVENT_LIMIT) },
        )
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Each [VampireDrainSource.stream] starts new `repository` collections, so the ViewModel's
 * refresh / retry trigger a genuine cache-then-network re-fetch (web `refetch()`). No HTTP touches the view.
 */
fun vampireDrainSource(
    energy: EnergyRepository,
    vehicles: VehiclesRepository,
    vehicleId: Long? = null,
): VampireDrainSource =
    VampireDrainSource {
        vampireDrainResource(
            vehicles = vehicles.vehicles(),
            explicitVehicleId = vehicleId,
            stats = { id -> energy.vampireDrainStats(id.toString()) },
            events = { id -> energy.vampireDrainEvents(id.toString(), VAMPIRE_DRAIN_EVENT_LIMIT) },
        )
    }

/**
 * Composes the vehicles feed with the per-vehicle stats + events feeds into one cache-then-network
 * [Resource] of a [VampireDrainSnapshot]. The effective vehicle id is resolved exactly like the web
 * (`vehicleId ?? vehicles?.[0]?.id`); when none resolves (`id <= 0`, the web disabled-query sentinel) the
 * energy feeds are never started and the vehicles resource is mapped to the empty snapshot (which renders
 * the "No vampire drain data" empty state). Otherwise the stats + events resources are [combineVampireDrain]d
 * so the surface's freshness mirrors the web widget's two queries.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun vampireDrainResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    stats: (Long) -> Flow<Resource<JsonElement>>,
    events: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<VampireDrainSnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
        if (id <= 0L) {
            flowOf(vehiclesRes.toNoVehicleSnapshot())
        } else {
            combine(stats(id), events(id)) { statsRes, eventsRes -> combineVampireDrain(statsRes, eventsRes) }
        }
    }

/**
 * Resolves the effective vehicle id exactly like the web `vehicleId ?? vehicles?.[0]?.id`: an
 * [explicitVehicleId] (the widget's configured vehicle) wins when present, otherwise the first enrolled
 * vehicle's id, otherwise `0` (the disabled-query sentinel → empty state).
 */
fun resolveVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long = explicitVehicleId ?: vehicles?.firstOrNull()?.id ?: 0L

/**
 * Folds the two per-vehicle feeds into one snapshot resource, reproducing the web widget's combined
 * freshness semantics (`isLoading = statsLoading || eventsLoading`, `hasData = stats != null ||
 * events.length > 0`, `isStale = statsStale || eventsStale`, `updatedAt = max(...)`):
 *  - while EITHER feed is still on its first load (no cached value) the combined resource is [Resource.Loading]
 *    with no cache, so the whole widget shows its skeleton (the web `WidgetShell` loading short-circuit);
 *  - once both have settled, a hard failure on either becomes a [Resource.Error] — keeping any combined
 *    cached value visible (offline / last-known), or, with nothing cached, a cache-less error the view
 *    renders as the friendly empty state + error chip (web parity: the widget never blanks to a hard error);
 *  - a refresh in flight over existing data is [Resource.Loading] carrying the combined snapshot;
 *  - otherwise a [Resource.Success] of the combined snapshot.
 *
 * Pure, so the combine-and-preserve contract is unit-tested without a network or cache.
 */
fun combineVampireDrain(
    stats: Resource<JsonElement>,
    events: Resource<JsonElement>,
): Resource<VampireDrainSnapshot> {
    val statsFirstLoad = stats is Resource.Loading && stats.cached == null
    val eventsFirstLoad = events is Resource.Loading && events.cached == null
    val snapshot = VampireDrainSnapshot.fromJson(stats.cached, events.cached)
    val fetchedAt = maxFetchedAt(stats.fetchedAtOrNull(), events.fetchedAtOrNull())
    val anyStale = stats.stale || events.stale
    val firstError = (stats as? Resource.Error)?.error ?: (events as? Resource.Error)?.error
    val anyRefreshing = stats is Resource.Loading || events is Resource.Loading
    return when {
        statsFirstLoad || eventsFirstLoad ->
            Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = anyStale)

        firstError != null ->
            Resource.Error(
                cached = snapshot.takeIf { it.hasData },
                fetchedAt = fetchedAt,
                stale = true,
                error = firstError,
            )

        anyRefreshing ->
            Resource.Loading(cached = snapshot, fetchedAt = fetchedAt, stale = anyStale)

        else ->
            Resource.Success(data = snapshot, fetchedAt = fetchedAt ?: 0L, stale = false)
    }
}

/** Maps a vehicles [Resource] to the no-vehicle snapshot, preserving the loading / stale / error freshness. */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<VampireDrainSnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { VampireDrainSnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(VampireDrainSnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { VampireDrainSnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** The freshness stamp of any [Resource] variant, or `null` when none has been recorded. */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/** The later of two optional freshness stamps (`null` only when both are absent). */
private fun maxFetchedAt(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
