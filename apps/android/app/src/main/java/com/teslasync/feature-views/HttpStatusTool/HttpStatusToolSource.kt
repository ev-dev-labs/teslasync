// The data port the [HttpStatusToolViewModel] binds to (P1/S8 state-holder seam) — the native analogue of
// the web HttpStatusTool's data binding. The web tool reads no API (its rows are the static client-side
// `HTTP_CODES` array), so the production binding wraps the static [HttpStatusCatalog] in an already-resolved
// cache-then-network [Resource]; the seam still exists so the view depends on an abstraction (real binding
// ↔ test fake) and the loading / empty / error envelope stays uniform with every other surface. The view
// never performs HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HttpStatusTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.httpstatus

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the HTTP status catalog as a cache-then-network feed — the native port of the web tool's static
 * `HTTP_CODES` source. A narrow seam so the view-model depends on an abstraction, never on the concrete
 * catalog. [refresh] is a no-op for the static binding (the catalog never changes — web `useMemo`), but
 * exists so the surface's retry affordance is wired uniformly with the data-backed surfaces.
 */
interface HttpStatusToolSource {
    /** The HTTP status catalog as a cache-then-network feed (web static `HTTP_CODES`). */
    fun codes(): Flow<Resource<List<HttpStatusCode>>>

    /** Re-emit the catalog (web has no refetch; the static binding is a no-op). */
    suspend fun refresh()
}

/**
 * Binds the surface to the fixed [HttpStatusCatalog] — the production binding. The catalog is a client-side
 * constant (web `HTTP_CODES`), so it is emitted once as a fresh [Resource.Success]; the surface's freshness
 * chrome only appears for the stale / offline / error branches, so the synthetic [Resource.Success]
 * `fetchedAt` of `0` is never surfaced as a "last updated" stamp.
 */
fun httpStatusToolSource(catalog: List<HttpStatusCode> = HttpStatusCatalog.codes): HttpStatusToolSource =
    object : HttpStatusToolSource {
        private val feed: Resource<List<HttpStatusCode>> = Resource.Success(catalog, fetchedAt = 0L, stale = false)

        override fun codes(): Flow<Resource<List<HttpStatusCode>>> = flowOf(feed)

        override suspend fun refresh() = Unit
    }

/**
 * Folds the source feed into a cache-then-network [Resource] of the projected [HttpStatusSnapshot] — the
 * data adapter the state holder collects (and the unit test drives directly: cached list → snapshot
 * projection). The freshness / error envelope is preserved unchanged from the upstream feed (ADR-013).
 */
internal fun httpStatusResource(source: HttpStatusToolSource): Flow<Resource<HttpStatusSnapshot>> =
    source.codes().map { resource -> resource.toSnapshot() }

/** Projects a catalog [Resource] onto a [HttpStatusSnapshot] [Resource], preserving the envelope. */
private fun Resource<List<HttpStatusCode>>.toSnapshot(): Resource<HttpStatusSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(::HttpStatusSnapshot), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(HttpStatusSnapshot(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(::HttpStatusSnapshot), fetchedAt, stale, error)
    }
