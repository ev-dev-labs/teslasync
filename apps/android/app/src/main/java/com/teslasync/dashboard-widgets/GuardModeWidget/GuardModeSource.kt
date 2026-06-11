// The data port the Guard Mode widget binds to — the native analogue of the web `useGuardConfig` +
// `useGuardEvents` (+ `useVehicles` for the id fallback) hook composition
// (web/src/features/dashboard/widgets/GuardModeWidget.tsx + web/src/api/hooks/useGuard.ts). The view
// never performs HTTP; a concrete adapter over the shared S8 [GuardStore] (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the config feed is primary and
// drives the cached/stale/error chrome (and the hard-error short-circuit), while the events feed is
// folded in best-effort and only contributes its freshness, never blanking the surface — the native
// reading of the web `config ? … : <EmptyState>` body gate with `isLoading/isError/isStale` OR-combined.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/GuardModeWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.guardmode

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.GuardStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

private const val NO_FETCH = 0L

/**
 * Streams the cache-then-network sequence of combined guard snapshots the widget renders and exposes the
 * manual refresh. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store or the network.
 */
interface GuardModeSource {
    /** The cache-then-network combined guard feed (cached value first for an instant cold start). */
    fun stream(): Flow<Resource<GuardModeSnapshot>>

    /** Force a re-fetch of both the config + events feeds (web `refetchConfig()` + `refetchEvents()`). */
    fun refresh()
}

/**
 * Fold the primary config [Resource] together with the supplementary events [Resource] into a single
 * snapshot [Resource], reproducing the web component's scalar combination exactly:
 *  - skeleton (a `Loading` with no cache) while EITHER feed is doing its first load — web
 *    `isLoading = configLoading || eventsLoading`;
 *  - a hard `Error` (nothing to show) only when the PRIMARY config feed failed with no cache — config is
 *    what gates the web body (`config ? … : empty`), so an events-only failure never blanks the surface;
 *  - otherwise a snapshot carrying the config value + the best-effort events list (web `events ?? []`),
 *    in the variant that mirrors `isFetching` (a refresh in flight ⇒ `Loading` over the snapshot) and
 *    `isError`/`isStale` (a cached-but-failed/stale read ⇒ `Error`/stale over the snapshot), with the
 *    freshness stamp taken as the newer of the two (web `updatedAt = max(...)`).
 *
 * Pure, so the combine contract is unit-tested without a network or cache.
 */
internal fun combineGuard(
    configResource: Resource<GuardConfig>,
    eventsResource: Resource<List<GuardEvent>>,
): Resource<GuardModeSnapshot> {
    val eventsList = eventsResource.cached ?: emptyList()
    return when {
        isFirstLoading(configResource) || isFirstLoading(eventsResource) ->
            Resource.Loading(cached = null, fetchedAt = null, stale = false)

        configResource is Resource.Error && configResource.cached == null ->
            Resource.Error(
                cached = null,
                fetchedAt = configResource.fetchedAt,
                stale = configResource.stale,
                error = configResource.error,
            )

        else ->
            resolvedSnapshot(
                snapshot = GuardModeSnapshot(config = configResource.cached, events = eventsList),
                configResource = configResource,
                eventsResource = eventsResource,
            )
    }
}

/** True for a feed doing its very first load (a `Loading` carrying no cached value) — web `isLoading`. */
private fun isFirstLoading(resource: Resource<*>): Boolean = resource is Resource.Loading && resource.cached == null

/**
 * Pick the [Resource] variant for an already-resolved [snapshot] (both feeds past their first load, config
 * not a hard error): a refresh in flight ⇒ `Loading` (web `isFetching`), a cached-but-failed read ⇒
 * `Error`/stale (web `isError` + keep cache), otherwise `Success`. The freshness stamp is the newer of the
 * two (web `updatedAt = max(...)`).
 */
private fun resolvedSnapshot(
    snapshot: GuardModeSnapshot,
    configResource: Resource<GuardConfig>,
    eventsResource: Resource<List<GuardEvent>>,
): Resource<GuardModeSnapshot> {
    val fetchedAt = maxFetchedAt(configResource, eventsResource)
    val stale = configResource.stale || eventsResource.stale
    return when {
        configResource is Resource.Loading || eventsResource is Resource.Loading ->
            Resource.Loading(cached = snapshot, fetchedAt = fetchedAt, stale = stale)

        configResource is Resource.Error || eventsResource is Resource.Error ->
            Resource.Error(
                cached = snapshot,
                fetchedAt = fetchedAt,
                stale = true,
                error = firstError(configResource, eventsResource),
            )

        else -> Resource.Success(data = snapshot, fetchedAt = fetchedAt ?: NO_FETCH, stale = false)
    }
}

/** The freshness stamp of any [Resource] variant, or `null` when it has never fetched. */
private fun fetchedAtOf(resource: Resource<*>): Long? =
    when (resource) {
        is Resource.Loading -> resource.fetchedAt
        is Resource.Success -> resource.fetchedAt
        is Resource.Error -> resource.fetchedAt
    }

/** The newer of the two feeds' freshness stamps (web `Math.max(configUpdatedAt, eventsUpdatedAt)`). */
private fun maxFetchedAt(
    a: Resource<*>,
    b: Resource<*>,
): Long? {
    val x = fetchedAtOf(a)
    val y = fetchedAtOf(b)
    return when {
        x == null -> y
        y == null -> x
        else -> maxOf(x, y)
    }
}

/** The config error if any (preferred), else the events error; the caller guarantees one exists. */
private fun firstError(
    configResource: Resource<*>,
    eventsResource: Resource<*>,
): Throwable {
    val cause = (configResource as? Resource.Error)?.error ?: (eventsResource as? Resource.Error)?.error
    return cause ?: IllegalStateException("guard feed in error state without a cause")
}

/**
 * The shared-state-holder-backed [GuardModeSource]. It resolves the scoped vehicle (the native analogue of
 * the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise the app-wide
 * active vehicle from [activeVehicleId], which self-heals to the first enrolled vehicle via
 * `SelectedVehicleStore`), then combines the shared [GuardStore.config] feed (web `useGuardConfig`) with
 * the [GuardStore.events] feed (web `useGuardEvents`, already envelope-unwrapped to `List<GuardEvent>`).
 * With no vehicle the stream emits a resolved-empty success (`null` config) so the surface shows the "No
 * guard data" empty state, mirroring the web hooks' disabled query (`enabled: vehicleId > 0`). No HTTP
 * touches the view — the shared holder (S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreGuardModeSource(
    private val guardStore: GuardStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : GuardModeSource {
    override fun stream(): Flow<Resource<GuardModeSnapshot>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = resolveVehicleId(active)) {
                null ->
                    flowOf(
                        Resource.Success(
                            data = GuardModeSnapshot(config = null, events = emptyList()),
                            fetchedAt = NO_FETCH,
                            stale = false,
                        ),
                    )

                else ->
                    combine(
                        guardStore.config(vehicleId.toString()),
                        guardStore.events(vehicleId.toString()),
                    ) { configResource, eventsResource -> combineGuard(configResource, eventsResource) }
            }
        }

    override fun refresh() {
        val vehicleId = resolveVehicleId(activeVehicleId.value) ?: return
        val key = vehicleId.toString()
        guardStore.refreshConfig(key)
        guardStore.refreshEvents(key)
    }

    private fun resolveVehicleId(active: Long?): Long? = explicitVehicleId?.takeIf { it > 0 } ?: active
}
