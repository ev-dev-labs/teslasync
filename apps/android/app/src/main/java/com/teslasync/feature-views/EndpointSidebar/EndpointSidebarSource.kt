// The data port the [EndpointSidebarViewModel] binds to (P1/S8 state-holder seam) — the native analogue
// of the web EndpointSidebar's data binding. The web component receives `endpoints: ParsedEndpoint[]` as
// a prop from its parent (ApiPlaygroundPage), which fetches `/system/openapi`, parses the YAML and renders
// a 10-row skeleton while the request is in flight + a PageContainer error on failure. So the
// loading / empty / error / stale / offline envelope is REAL end-to-end (the OpenAPI fetch lifecycle), not
// invented — this seam models that parent-provided feed so the native surface reproduces it faithfully and
// stays uniform with the sibling devtools surfaces (HttpStatusTool, ClientUtilitiesSection). The view never
// performs HTTP (ADR-002); a host injects the concrete source (the production `/system/openapi` repository
// in the app, a fake in tests / previews).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EndpointSidebar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.endpointsidebar

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the parsed OpenAPI operations as a cache-then-network feed — the native port of the web
 * EndpointSidebar's `endpoints` prop (sourced by the parent's `/system/openapi` query). A narrow seam so
 * the view-model depends on an abstraction, never on the concrete catalog: the production app binds the
 * real spec repository, while tests / previews bind a fake that drives the loading / empty / error /
 * stale / offline branches.
 */
interface EndpointSidebarSource {
    /** The parsed operations as a cache-then-network feed (web `endpoints` prop). */
    fun endpoints(): Flow<Resource<List<ParsedEndpoint>>>

    /** Re-fetch the OpenAPI spec — backs the surface's retry / auto-refresh affordances. */
    suspend fun refresh()
}

/**
 * Binds the surface to an already-resolved list of [endpoints] — the standalone / parent-provided binding,
 * matching the web prop contract (by the time the sidebar mounts, the parent has resolved the spec). It is
 * emitted once as a fresh [Resource.Success]; the surface's freshness chrome only appears on the
 * stale / offline / error branches, so the synthetic `fetchedAt` of `0` is never surfaced as a "last
 * updated" stamp. A host that owns the live `/system/openapi` query supplies its own
 * [EndpointSidebarSource] (emitting Loading → Success/Error) instead.
 */
fun endpointSidebarSource(endpoints: List<ParsedEndpoint>): EndpointSidebarSource =
    object : EndpointSidebarSource {
        private val feed: Resource<List<ParsedEndpoint>> = Resource.Success(endpoints, fetchedAt = 0L, stale = false)

        override fun endpoints(): Flow<Resource<List<ParsedEndpoint>>> = flowOf(feed)

        override suspend fun refresh() = Unit
    }

/**
 * Folds the source feed into a cache-then-network [Resource] of the projected [EndpointSidebarSnapshot] —
 * the data adapter the state holder collects (and the unit test drives directly: cached list → snapshot
 * projection). The freshness / error envelope is preserved unchanged from the upstream feed (ADR-013).
 */
internal fun endpointSidebarResource(source: EndpointSidebarSource): Flow<Resource<EndpointSidebarSnapshot>> =
    source.endpoints().map { resource -> resource.toSnapshot() }

/** Projects an operations [Resource] onto an [EndpointSidebarSnapshot] [Resource], preserving the envelope. */
private fun Resource<List<ParsedEndpoint>>.toSnapshot(): Resource<EndpointSidebarSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(::EndpointSidebarSnapshot), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(EndpointSidebarSnapshot(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(::EndpointSidebarSnapshot), fetchedAt, stale, error)
    }
