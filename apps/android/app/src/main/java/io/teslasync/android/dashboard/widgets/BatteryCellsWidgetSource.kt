package io.teslasync.android.dashboard.widgets

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The data port the [BatteryCellsWidgetViewModel] binds to (P1/S8 state-holder seam). It yields the
 * cache-then-network sequence of parsed battery-cell summaries for
 * `GET /vehicles/{vehicleID}/battery/cells` — the native analogue of the web `useVehicles` +
 * `useBatteryCells` hook composition (vehicle resolution included). The view never performs HTTP
 * itself; the [EnergyStoreBatteryCellsSource] (or a test fake) drives this.
 */
fun interface BatteryCellsSource {
    /** Stream the cache-then-network battery-cell snapshots, replaying the cached value first. */
    fun stream(): Flow<Resource<BatteryCellSummary?>>
}

/**
 * Parse a raw [Resource] of `GET …/battery/cells` JSON into a [Resource] of [BatteryCellSummary],
 * preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can
 * render the full state matrix. Pure, so the parse-and-preserve contract is unit-tested without a
 * network or cache. A present-but-not-object body parses to `null` (web's outer empty gate); a
 * present object — even all-zero — parses to a non-null summary (web's truthy-`data` content path).
 */
internal fun Resource<JsonElement>.toBatteryCellsSummary(): Resource<BatteryCellSummary?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(BatteryCellSummary::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = BatteryCellSummary.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(BatteryCellSummary::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [BatteryCellsSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins,
 * otherwise the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [EnergyStore.batteryCells] cache-then-network feed (web `useBatteryCells`) into parsed summaries.
 * With no vehicle the stream emits a resolved-empty success (`null` summary) so the surface shows the
 * outer "No battery cell data" state, mirroring the web hook's disabled query
 * (`enabled: vehicleId !== null`). No HTTP touches the view — the [EnergyStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyStoreBatteryCellsSource(
    private val energyStore: EnergyStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : BatteryCellsSource {
    override fun stream(): Flow<Resource<BatteryCellSummary?>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId ?: active) {
                null -> flowOf(Resource.Success<BatteryCellSummary?>(data = null, fetchedAt = NO_FETCH, stale = false))
                else -> energyStore.batteryCells(vehicleId.toString()).map { it.toBatteryCellsSummary() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
