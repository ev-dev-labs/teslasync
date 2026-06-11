// The data port the [RequestBuilderViewModel] binds to (P1/S8 state-holder seam) — the native analogue of
// the web RequestBuilder's data binding. The web component receives its `endpoint: ParsedEndpoint` as a prop
// from the parent (ApiPlaygroundPage), which fetches `/system/openapi`, parses the YAML, renders a skeleton
// while the request is in flight + a PageContainer error on failure, and shows a "select an endpoint" empty
// state until a row is chosen. So the loading / empty / error / stale / offline envelope is REAL end-to-end
// (the OpenAPI fetch + selection lifecycle), not invented — this seam models that parent-provided selection
// so the native surface reproduces it faithfully and stays uniform with the sibling EndpointSidebar surface.
// The view never performs HTTP (ADR-002); a host injects the concrete source (the production
// `/system/openapi` + selection store in the app, a fake in tests / previews).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RequestBuilder) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.requestbuilder

import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the currently-selected endpoint as a cache-then-network feed — the native port of the web
 * RequestBuilder's `endpoint` prop (sourced by the parent's `/system/openapi` query + selection state). A
 * narrow seam so the view-model depends on an abstraction, never on the concrete catalog: the production app
 * binds the real selection feed, while tests / previews bind a fake that drives the loading / empty (no
 * selection) / error / stale / offline branches. A `null` value is the no-selection (data-empty) state.
 */
interface RequestBuilderSource {
    /** The selected endpoint as a cache-then-network feed (web `endpoint` prop); `null` ⇒ no selection. */
    fun selectedEndpoint(): Flow<Resource<ParsedEndpoint?>>

    /** Re-fetch the OpenAPI spec / re-resolve the selection — backs the retry / auto-refresh affordances. */
    suspend fun refresh()
}

/**
 * Binds the surface to an already-resolved selection — the standalone / parent-provided binding, matching
 * the web prop contract (by the time the builder mounts, the parent has resolved the spec and the user has
 * picked a row). It is emitted once as a fresh [Resource.Success]; the surface's freshness chrome only
 * appears on the stale / offline / error branches, so the synthetic `fetchedAt` of `0` is never surfaced as
 * a "last updated" stamp. A host that owns the live `/system/openapi` query supplies its own
 * [RequestBuilderSource] (emitting Loading → Success/Error) instead.
 */
fun requestBuilderSource(endpoint: ParsedEndpoint?): RequestBuilderSource =
    object : RequestBuilderSource {
        private val feed: Resource<ParsedEndpoint?> = Resource.Success(endpoint, fetchedAt = 0L, stale = false)

        override fun selectedEndpoint(): Flow<Resource<ParsedEndpoint?>> = flowOf(feed)

        override suspend fun refresh() = Unit
    }

/**
 * Folds the source feed into a cache-then-network [Resource] of the projected [RequestBuilderSnapshot] — the
 * data adapter the state holder collects (and the unit test drives directly: cached selection → snapshot
 * projection). The freshness / error envelope is preserved unchanged from the upstream feed (ADR-013).
 */
internal fun requestBuilderResource(source: RequestBuilderSource): Flow<Resource<RequestBuilderSnapshot>> =
    source.selectedEndpoint().map { resource -> resource.toSnapshot() }

/** Projects a selection [Resource] onto a [RequestBuilderSnapshot] [Resource], preserving the envelope. */
private fun Resource<ParsedEndpoint?>.toSnapshot(): Resource<RequestBuilderSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(::RequestBuilderSnapshot), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(RequestBuilderSnapshot(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(::RequestBuilderSnapshot), fetchedAt, stale, error)
    }
