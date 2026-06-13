// The single data port the DataFreshness shared surface binds to — the native analogue of the query the web
// chip surfaces the freshness of. The web `DataFreshness` is generic over any TanStack Query result; its own
// doc comment's worked example is `useChargingHistory` (web/src/components/data-display/DataFreshness.tsx →
// `const q = useChargingHistory(...); <DataFreshnessAuto query={q} compact />`), so this surface binds the
// Charging domain history feed as the representative query. The view-model depends on this abstraction (a
// real adapter over the shared Charging layer in production, a fake in tests), never on a concrete
// store/repository or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// Cache-then-network freshness is preserved end to end (ADR-013): every emission's
// fetched-at / stale / error flags flow through unchanged, and it is exactly those flags the chip projects
// into its dot + icon + relative-time label. Re-collecting the feed performs a genuine cache-then-network
// re-fetch, which backs the chip's manual-refresh affordance (the web `query.refetch()`).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/DataFreshness) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datafreshness

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.flow.Flow

/**
 * The seam the [DataFreshnessViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [chargingHistory] is the cache-then-network charging
 * history feed for a vehicle (web `useChargingHistory`); the chip surfaces only its freshness, never its
 * rows. No HTTP touches the view.
 */
interface DataFreshnessSource {
    /**
     * The cache-then-network `GET /charging-sessions?vehicle_id=` feed for [vehicleId] (web
     * `useChargingHistory`). Each emission is a [Resource] carrying the cached rows, its fetched-at stamp,
     * and its stale / error flags — the freshness signals the chip renders.
     */
    fun chargingHistory(vehicleId: Long): Flow<Resource<List<ChargingSession>>>
}

/**
 * Binds the surface to the shared **S8** [ChargingStore] — the memoized, multi-observer charging feed every
 * Charging surface shares. Use this when a host wants the chip to fold into the same shared collection (and
 * the store's background refresh) as the rest of the app; the live cache-then-network values flow through
 * unchanged. No HTTP touches the view.
 */
fun ChargingStore.asDataFreshnessSource(): DataFreshnessSource {
    val store = this
    return object : DataFreshnessSource {
        override fun chargingHistory(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = store.sessions(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] — the cold cache-then-network `Flow` the S8
 * [ChargingStore] also wraps. Re-collecting performs a genuine cache-then-network re-fetch, which is what
 * backs the chip's manual-refresh / error-retry affordance (the web `query.refetch()`). No HTTP touches the
 * view.
 */
fun ChargingRepository.asDataFreshnessSource(): DataFreshnessSource {
    val repo = this
    return object : DataFreshnessSource {
        override fun chargingHistory(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = repo.sessions(vehicleId)
    }
}

/**
 * Builds a [DataFreshnessSource] from a single history-feed provider — the host wiring seam used when a
 * caller already has the charging feed flow in hand (and the test double used to drive each freshness state
 * deterministically). Mirrors the per-vehicle contract of the store/repository adapters above.
 */
fun dataFreshnessSource(history: (vehicleId: Long) -> Flow<Resource<List<ChargingSession>>>): DataFreshnessSource =
    object : DataFreshnessSource {
        override fun chargingHistory(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = history(vehicleId)
    }
