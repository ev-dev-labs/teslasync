// The data seam the AuditLogPage notifications surface binds to, plus its production binding over the shared S8
// AdminStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's single TanStack-Query read (`useAuditLogs` ▸ `useQuery(getAuditLogs)`).
//
// The feed is the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`GET /system/audit` ▸ auditLogs(), array-guarded). A narrow seam so the view-model depends on an abstraction
// (real adapter ↔ test fake), never on a concrete store or the network. Each (re)collection is a fresh
// cache-then-network [Resource] stream, so the view-model's refresh trigger re-subscribing performs the web
// `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.auditlog

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [AuditLogPageViewModel] depends on so it binds to an abstraction (the shared Admin holder
 * in production, a fake in tests), never to a concrete store or the network. The member is a cache-then-network
 * raw-JSON `Resource` flow (the web read hook). No HTTP touches the view.
 */
interface AuditLogSource {
    /** The raw-JSON `GET /system/audit` feed (web `useAuditLogs`). */
    fun auditLogs(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer feed every Admin surface
 * shares app-wide (incl. its standard-cadence background refresh). The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP
 * touches the view.
 */
fun AdminStore.asAuditLogSource(): AuditLogSource {
    val store = this
    return object : AuditLogSource {
        override fun auditLogs(): Flow<Resource<JsonElement>> = store.auditLogs()
    }
}
