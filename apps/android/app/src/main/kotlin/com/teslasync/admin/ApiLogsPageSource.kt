// The data seam the ApiLogsPage admin surface binds to, plus its production binding over the shared S8
// AdminStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's two TanStack-Query reads (`useQuery(getAPICallLogs)`,
// `useQuery(getAPICallLogStats)`).
//
// Both feeds are the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`GET /api-logs` ▸ apiLogs(page), `GET /api-logs/stats` ▸ apiLogStats()). A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network. Each
// (re)collection is a fresh cache-then-network [Resource] stream, so the view-model's refresh trigger
// re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.apilogs

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ApiLogsPageViewModel] depends on so it binds to an abstraction (the shared Admin
 * holder in production, a fake in tests), never to a concrete store or the network. Both members are
 * cache-then-network raw-JSON `Resource` flows (the web read hooks). No HTTP touches the view.
 */
interface ApiLogsSource {
    /** The raw-JSON `GET /api-logs` page feed (web `getAPICallLogs`). */
    fun apiLogs(page: Int): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /api-logs/stats` rollup feed (web `getAPICallLogStats`). */
    fun apiLogStats(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer feeds every Admin
 * surface shares app-wide (incl. their standard-cadence background refresh). The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun AdminStore.asApiLogsSource(): ApiLogsSource {
    val store = this
    return object : ApiLogsSource {
        override fun apiLogs(page: Int): Flow<Resource<JsonElement>> = store.apiLogs(page)

        override fun apiLogStats(): Flow<Resource<JsonElement>> = store.apiLogStats()
    }
}
