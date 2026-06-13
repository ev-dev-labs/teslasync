// The data ports the ErrorDisplay shared surface binds to — the native analogue of the inputs the web banner
// derives from. The web `ErrorDisplay` receives an `error` (and branches on its `ApiError.status`) and reads
// connectivity via `useOnlineStatus()`. The native surface binds those two seams: a representative
// cache-then-network feed whose failures drive the banner (the Charging history feed — the same worked
// example the sibling DataFreshness surface uses, web `useChargingHistory`), and a connectivity flow. The
// view-model depends on these abstractions (a real adapter over the shared Charging layer in production, a
// fake in tests), never on a concrete store/repository or the network, so the view performs NO HTTP
// (P1/S8 boundary, ADR-002).
//
// Cache-then-network failure semantics are preserved end to end (ADR-013): every emission's
// error / status / stale flags flow through unchanged, and it is exactly those flags the banner projects into
// its branch (404 / 401 / 5xx / offline / network). Re-collecting the feed performs a genuine
// cache-then-network re-fetch, which backs the banner's retry affordance (the web `onRetry`).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/ErrorDisplay) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [ErrorDisplayViewModel] binds to so it depends on abstractions (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [failures] is the cache-then-network feed whose error
 * state drives the banner (web's `error` prop, sourced here from `useChargingHistory`); [online] is the
 * connectivity signal (web `useOnlineStatus`). No HTTP touches the view.
 */
interface ErrorDisplaySource {
    /**
     * The cache-then-network `GET /charging-sessions?vehicle_id=` feed for [vehicleId] (web
     * `useChargingHistory`). The banner reads only its failure signals (error / status / stale) — never its
     * charging rows.
     */
    fun failures(vehicleId: Long): Flow<Resource<List<ChargingSession>>>

    /** The connectivity signal (web `useOnlineStatus`); `true` while a network path is believed reachable. */
    fun online(): Flow<Boolean>
}

/**
 * Binds the surface to the shared **S8** [ChargingStore] — the memoized, multi-observer charging feed every
 * Charging surface shares — and the host's [online] connectivity flow. Use this when a host wants the banner
 * to fold into the same shared collection (and the store's background refresh) as the rest of the app; the
 * live cache-then-network values flow through unchanged. [online] defaults to a constant-online flow for
 * hosts without an OS connectivity monitor, in which case the offline surface is still driven by the feed's
 * own transport failures. No HTTP touches the view.
 */
fun ChargingStore.asErrorDisplaySource(online: Flow<Boolean> = flowOf(true)): ErrorDisplaySource {
    val store = this
    return object : ErrorDisplaySource {
        override fun failures(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = store.sessions(vehicleId)

        override fun online(): Flow<Boolean> = online
    }
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] — the cold cache-then-network `Flow` the S8
 * [ChargingStore] also wraps — and the host's [online] connectivity flow. Re-collecting performs a genuine
 * cache-then-network re-fetch, which is what backs the banner's retry affordance (the web `onRetry`).
 * [online] defaults to a constant-online flow; the feed's transport failures still drive the offline surface.
 * No HTTP touches the view.
 */
fun ChargingRepository.asErrorDisplaySource(online: Flow<Boolean> = flowOf(true)): ErrorDisplaySource {
    val repo = this
    return object : ErrorDisplaySource {
        override fun failures(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = repo.sessions(vehicleId)

        override fun online(): Flow<Boolean> = online
    }
}

/**
 * Builds an [ErrorDisplaySource] from a failure-feed provider and an [online] flow — the host wiring seam
 * used when a caller already has the feed flow in hand (and the test double used to drive each failure branch
 * deterministically). Mirrors the per-vehicle contract of the store/repository adapters above.
 */
fun errorDisplaySource(
    online: Flow<Boolean> = flowOf(true),
    failures: (vehicleId: Long) -> Flow<Resource<List<ChargingSession>>>,
): ErrorDisplaySource =
    object : ErrorDisplaySource {
        override fun failures(vehicleId: Long): Flow<Resource<List<ChargingSession>>> = failures(vehicleId)

        override fun online(): Flow<Boolean> = online
    }
