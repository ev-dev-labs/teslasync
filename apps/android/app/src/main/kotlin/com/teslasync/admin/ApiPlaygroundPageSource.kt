// The data seam the ApiPlaygroundPage admin surface binds to, plus its production binding over the shared resilient
// [ApiHttpClient]. The view (composable) performs NO HTTP — it only collects state from the page ViewModel, which
// drives this seam, reproducing the web page's single `useQuery(['openapi-spec'])` read of `/system/openapi`.
//
// The web page fetches the spec as text (`request('/system/openapi', { responseType: 'text' })`), parses the YAML
// client-side and renders a 10-row skeleton while in flight + a PageContainer error on failure. This seam models
// that exact lifecycle as a cache-then-network `Resource` stream so the native surface reproduces it faithfully:
// [ApiPlaygroundSource.endpoints] emits `Loading` then `Success`(parsed catalog) / `Error`(fetch failed). A narrow
// seam so the ViewModel depends on an abstraction (real `ApiHttpClient` binding ↔ test fake), never on the network.
//
// No shared-core OpenAPI store exists (the spec is a read-only YAML document, not a typed domain feed), so the
// production binding reads it directly through the one resilient client the DataContainer already exposes
// (`container.api`) — the same client every shared repository builds on — and hands the bytes to the framework-free
// [OpenApiSpecParser]. The `GET` is idempotent, so the client's retry/backoff/circuit-breaker contract applies
// cleanly. The binding lives in this admin-surface file (the prompt's allowed path), not in the shared core.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.apiplayground

import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * The single seam the [ApiPlaygroundPageViewModel] depends on so it binds to an abstraction (the shared
 * `ApiHttpClient` in production, a fake in tests), never to a concrete client or the network. The read is a
 * cache-then-network typed `Resource` flow of the parsed OpenAPI catalog (web `useQuery(['openapi-spec'])`);
 * [refresh] is a no-op because the ViewModel re-collects the feed to re-fetch (web query `refetch`). No HTTP
 * touches the view.
 */
interface ApiPlaygroundSource {
    /** The parsed OpenAPI endpoint catalog as a cache-then-network feed (web `endpoints`). */
    fun endpoints(): Flow<Resource<List<ParsedEndpoint>>>

    /** Hook for an explicit re-fetch; the feed itself re-runs on re-collection, so the binding leaves this a no-op. */
    suspend fun refresh()
}

/**
 * Binds the surface to the shared resilient [ApiHttpClient] — the one client (`container.api`) every shared
 * repository builds on. [ApiPlaygroundSource.endpoints] emits `Loading`, fetches the spec text from
 * [ApiPlaygroundPageRegistration.OPENAPI_PATH] (the client prepends `/api/v1` once), parses it with the
 * framework-free [OpenApiSpecParser], and emits `Success`(catalog) or `Error`(fetch failed) — the full state matrix
 * the render boundary draws (loading / content / empty / error). A `String` body is read verbatim regardless of the
 * `text/yaml` content type, so the YAML reaches the parser intact. No HTTP touches the view.
 */
fun ApiHttpClient.asApiPlaygroundSource(): ApiPlaygroundSource {
    val client = this
    return object : ApiPlaygroundSource {
        override fun endpoints(): Flow<Resource<List<ParsedEndpoint>>> =
            flow {
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                client
                    .safeRequest<String>(
                        method = HttpMethodKind.GET,
                        path = ApiPlaygroundPageRegistration.OPENAPI_PATH,
                    ).fold(
                        onSuccess = { yaml ->
                            emit(Resource.Success(OpenApiSpecParser.parse(yaml), fetchedAt = 0L, stale = false))
                        },
                        onFailure = { error ->
                            emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = error))
                        },
                    )
            }

        override suspend fun refresh() = Unit
    }
}
