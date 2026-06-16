// The data seam the DLQInspectorPage admin surface binds to, plus its production binding over the shared S8
// DlqStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's three TanStack-Query reads (`useDLQList`, `useDLQEntry`, `useDLQAudit`)
// and its one mutation (`useDLQReplay`).
//
// Every feed is the raw verbatim server JSON the shared S8 DlqStore already exposes (`GET /system/dlq` ▸
// list(), `GET /system/dlq/{id}` ▸ entry(id, enabled), `GET /system/dlq/{id|''}/audit` ▸ audit(dlqId, limit)),
// and the replay mutation routes through `DlqStore.replay(id)` which refreshes the whole DLQ partition on
// success (the web `invalidateQueries(['system','dlq'])`). A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete store or the network.
//
// The entry feed forwards the web `enabled` gate verbatim: `DlqStore.entry(id, enabled)` returns a stable
// disabled (perpetually-Loading) feed when the id is non-positive or `enabled` is false, the analogue of the
// web `useDLQEntry(id, enabled)` `enabled: enabled && numericId > 0`, so the drawer can bind before a row is
// selected.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.dlq

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.dlq.DlqStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DLQInspectorPageViewModel] depends on so it binds to an abstraction (the shared DLQ
 * holder in production, a fake in tests), never to a concrete store or the network. The three reads are
 * cache-then-network raw-JSON `Resource` flows (the web read hooks); [replay] is the non-throwing mutation
 * returning a [Result] (the web mutation). No HTTP touches the view.
 */
interface DLQInspectorSource {
    /** The raw-JSON `GET /system/dlq` list feed (web `useDLQList`). */
    fun list(): Flow<Resource<JsonElement>>

    /**
     * The raw-JSON `GET /system/dlq/{id}` entry feed (web `useDLQEntry`). When [id] is null/non-positive or
     * [enabled] is false the feed never fetches (the web `enabled` gate), so the drawer can bind unselected.
     */
    fun entry(
        id: Long?,
        enabled: Boolean,
    ): Flow<Resource<JsonElement>>

    /**
     * The raw-JSON replay-audit feed (web `useDLQAudit`). A positive [dlqId] scopes to one entry's history;
     * `null`/`0` selects the global feed. [limit] mirrors the server-side query param.
     */
    fun audit(
        dlqId: Long?,
        limit: Int,
    ): Flow<Resource<JsonElement>>

    /**
     * Replays a single DLQ entry (web `useDLQReplay`). Non-throwing — the sudo gate and the
     * `DLQ_REPLAY_ENABLED=false` 403 surface through the [Result] failure exactly as on the web. On success the
     * store refreshes the whole DLQ partition (`invalidateQueries(['system','dlq'])`).
     */
    suspend fun replay(id: Long): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S8** [DlqStore] — the memoized, multi-observer feeds every native DLQ
 * surface shares (incl. the entry `enabled` gate and the replay invalidation rule). The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun DlqStore.asDLQInspectorSource(): DLQInspectorSource {
    val store = this
    return object : DLQInspectorSource {
        override fun list(): Flow<Resource<JsonElement>> = store.list()

        override fun entry(
            id: Long?,
            enabled: Boolean,
        ): Flow<Resource<JsonElement>> = store.entry(id, enabled)

        override fun audit(
            dlqId: Long?,
            limit: Int,
        ): Flow<Resource<JsonElement>> = store.audit(dlqId, limit)

        override suspend fun replay(id: Long): Result<JsonElement> = store.replay(id)
    }
}
