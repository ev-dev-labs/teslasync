// The data seam the DBHealthPage system surface binds to (P1/S8), plus its production binding over the shared S8
// AdminStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's three TanStack-Query reads (web/src/features/system/pages/DBHealthPage.tsx):
// `useDBStats`, `useMigrations`, and `useConnectionPool`.
//
// Each member is the raw verbatim server JSON the shared S8 AdminStore already memoizes + shares app-wide as a
// cache-then-network `Resource<JsonElement>` (`GET /dev-tools/db-stats` ▸ dbStats(),
// `GET /dev-tools/migration-status` ▸ migrations(), `GET /dev-tools/runtime-info` ▸ connectionPool()). The live
// values flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
// stale / offline). A narrow seam so the view-model depends on an abstraction (the real AdminStore in production, a
// fake in tests), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.dbhealth

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DBHealthPageViewModel] depends on so it binds to an abstraction (the shared [AdminStore] in
 * production, a fake in tests), never to a concrete store or the network. Every member is a cache-then-network
 * `Resource` flow (one of the web read hooks). No HTTP touches the view.
 */
interface DBHealthSource {
    /** The raw-JSON `GET /dev-tools/db-stats` feed (web `useDBStats`) — the page's spine (cards / chart / table). */
    fun dbStats(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /dev-tools/migration-status` feed (web `useMigrations`). */
    fun migrations(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /dev-tools/runtime-info` feed (web `useConnectionPool`). */
    fun connectionPool(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer holder every Admin/devtools
 * surface shares app-wide (incl. its standard-cadence background refresh). All three reads come from the one store;
 * the live values flow through unchanged so the view-model renders the full state matrix. No HTTP touches the view.
 */
fun AdminStore.asDBHealthSource(): DBHealthSource {
    val store = this
    return object : DBHealthSource {
        override fun dbStats(): Flow<Resource<JsonElement>> = store.dbStats()

        override fun migrations(): Flow<Resource<JsonElement>> = store.migrations()

        override fun connectionPool(): Flow<Resource<JsonElement>> = store.connectionPool()
    }
}
