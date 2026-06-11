// The data port the [ClientUtilitiesSectionViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web `ClientUtilitiesSection`'s `useToolList()` hook. The web hook is a synchronous,
// client-side `useMemo` over a fixed array (no HTTP), so the production binding wraps the static
// [ClientUtilitiesCatalog] in an already-resolved cache-then-network [Resource]; the seam still exists so
// the view depends on an abstraction (real binding ↔ test fake) and the loading / empty / error envelope
// stays uniform with every other surface. The view never performs HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClientUtilitiesSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.clientutilities

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the client-utilities registry as a cache-then-network feed — the native port of the web
 * `useToolList()` hook. A narrow seam so the view-model depends on an abstraction, never on the concrete
 * catalog. [refresh] is a no-op for the static binding (the catalog never changes — web `useMemo`), but
 * exists so the surface's retry affordance is wired uniformly with the data-backed surfaces.
 */
interface ClientUtilitiesSource {
    /** The client-side tool registry as a cache-then-network feed (web `useToolList()`). */
    fun tools(): Flow<Resource<List<ClientUtilityTool>>>

    /** Re-emit the registry (web has no refetch; the static binding is a no-op). */
    suspend fun refresh()
}

/**
 * Binds the surface to the fixed [ClientUtilitiesCatalog] — the production binding. The catalog is a
 * client-side constant (web `useToolList`), so it is emitted once as a fresh [Resource.Success]; the
 * surface's freshness chrome only appears for the stale / offline / error branches, so the synthetic
 * [Resource.Success.fetchedAt] of `0` is never surfaced as a "last updated" stamp.
 */
fun clientUtilitiesSource(catalog: List<ClientUtilityTool> = ClientUtilitiesCatalog.tools): ClientUtilitiesSource =
    object : ClientUtilitiesSource {
        private val feed: Resource<List<ClientUtilityTool>> = Resource.Success(catalog, fetchedAt = 0L, stale = false)

        override fun tools(): Flow<Resource<List<ClientUtilityTool>>> = flowOf(feed)

        override suspend fun refresh() = Unit
    }

/**
 * Folds the source feed into a cache-then-network [Resource] of the projected [ClientUtilitiesSnapshot] —
 * the data adapter the state holder collects (and the unit test drives directly: cached list → snapshot
 * projection). The freshness / error envelope is preserved unchanged from the upstream feed (ADR-013).
 */
internal fun clientUtilitiesResource(source: ClientUtilitiesSource): Flow<Resource<ClientUtilitiesSnapshot>> =
    source.tools().map { resource -> resource.toSnapshot() }

/** Projects a registry [Resource] onto a [ClientUtilitiesSnapshot] [Resource], preserving the envelope. */
private fun Resource<List<ClientUtilityTool>>.toSnapshot(): Resource<ClientUtilitiesSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(::ClientUtilitiesSnapshot), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(ClientUtilitiesSnapshot(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(::ClientUtilitiesSnapshot), fetchedAt, stale, error)
    }
