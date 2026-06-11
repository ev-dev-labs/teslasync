// The data port the Uptime Monitor widget binds to — the native analogue of the web `useSystemHealth`
// hook (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx, web/src/api/hooks/useAdmin.ts). The
// view never performs HTTP; a concrete adapter over the shared S7/S8 Admin data layer (or a test fake)
// drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): each parsed
// projection carries every cached/stale/error flag from its upstream feed so the view-model can render
// the full state matrix, and the raw `/system/health` JSON is parsed into the typed [UptimeHealth] here
// so the view-model + composable only ever see a render-ready snapshot.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/UptimeMonitorWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.uptimemonitor

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Streams the single cache-then-network feed the widget needs: the resolved system-health snapshot
 * (`GET /system/health`, web `useSystemHealth`), already parsed into a nullable [UptimeHealth] (a `null`
 * payload — absent / non-object JSON — is the empty surface, web `data ? body : <EmptyState>`). A narrow
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store
 * or the network. Each (re)collection is a fresh cache-then-network [Resource] stream, so the
 * view-model's refresh trigger re-subscribing performs the web `refetch()`.
 */
fun interface UptimeMonitorSource {
    /** The cache-then-network, parsed system-health feed (`GET /system/health`, web `useSystemHealth`). */
    fun stream(): Flow<Resource<UptimeHealth?>>
}

/**
 * Apply [transform] to the value carried by a [Resource], preserving the freshness flags
 * (cached / refreshing / stale / offline + error) exactly. A non-present cached value stays absent so a
 * first-load Loading slot is never fabricated into empty content.
 */
internal fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Binds the widget to the shared **S7** [AdminRepository] — the cold cache-then-network `Flow` the S8
 * [AdminStore] also wraps. Re-collecting performs a genuine cache-then-network re-fetch, which is what
 * backs the widget's manual refresh / error-retry affordance. The raw `JsonElement` is parsed into
 * [UptimeHealth] inline; no HTTP touches the view.
 */
fun AdminRepository.asUptimeMonitorSource(): UptimeMonitorSource =
    UptimeMonitorSource { systemHealth().map { it.mapResource(UptimeHealth::parse) } }

/**
 * Binds the widget to the shared **S8** [AdminStore] — the memoized, multi-observer system-health feed
 * every Admin surface shares (incl. its background refresh on the standard cadence). Use this when a host
 * wants the widget to fold into the same shared collection as the rest of the app; the live values flow
 * through unchanged, parsed into [UptimeHealth]. No HTTP touches the view.
 */
fun AdminStore.asUptimeMonitorSource(): UptimeMonitorSource {
    val store = this
    return UptimeMonitorSource { store.systemHealth().map { it.mapResource(UptimeHealth::parse) } }
}
