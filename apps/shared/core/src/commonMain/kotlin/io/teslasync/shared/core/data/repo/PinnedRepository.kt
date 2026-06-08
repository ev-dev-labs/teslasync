package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the unified pin store — the cross-platform analogue of the web
 * `usePinned` hook domain (web/src/api/hooks/usePinned.ts). Every native surface that floats
 * pinned rows to the top (vehicle picker, dashboard widgets, alerts, geofences, automations,
 * commands) reaches the backend exclusively through this interface, so a single fake stands in
 * for the whole domain in the S8 state-holder tests.
 *
 * The list read ([pinned]) streams a cache-then-network [Resource] (ADR-013): the cached rows
 * first for an instant cold start, then the refreshed rows. Each `(type, context)` bucket is
 * cached under its own key via [pinnedCacheKey], mirroring the web `pinnedKeys.list` tuple.
 *
 * The mutations ([createPin], [deletePin], [reorderPin]) are non-throwing suspend [Result]s and
 * have NO cache interaction here: invalidation is expressed as a targeted refresh in the S8
 * store (the web `invalidateQueries` analogue — a toggle invalidates `pinnedKeys.all`, a reorder
 * invalidates only `pinnedKeys.list(type)`), and the durable cache is left intact so a refresh
 * shows the last-known rows while the network reload runs. [peekPinned] and [fetchPinned] back
 * the unpin path's "find the existing row id" lookup, which the web does against the TanStack
 * query cache with a fresh-fetch fallback.
 *
 * Pin fields are plain (ids, item ids, positions, timestamps) — not unit-bearing — so they
 * round-trip verbatim with no SI conversion; display formatting is the render boundary's job (S5).
 */
public interface PinnedRepository {
    /**
     * `GET /pinned?type={type}[&context={context}]` — the pin list for one bucket (web
     * `usePinned`). The query is built by [pinnedQuery] and the cache key by [pinnedCacheKey],
     * mirroring the web `buildQuery` / `pinnedKeys.list` semantics. Always resolves to an array
     * (never null) so consumers can iterate without a guard.
     */
    public fun pinned(
        type: PinnedItemType,
        context: String? = null,
    ): Flow<Resource<List<PinnedItem>>>

    /**
     * Reads the currently-cached pin list for `(type, context)` without a network round-trip —
     * the data-layer analogue of the web `queryClient.getQueryData(pinnedKeys.list(type, context))`
     * the unpin path consults first. Returns null on a cold cache (never fetched), which drives
     * the [fetchPinned] fallback.
     */
    public suspend fun peekPinned(
        type: PinnedItemType,
        context: String? = null,
    ): List<PinnedItem>?

    /**
     * `GET /pinned?type={type}[&context={context}]` issued directly (NOT through the cache) — the
     * web unpin path's fresh-fetch fallback (`await request(...)`) used when the cache has not yet
     * been hydrated for the bucket. Does not write the cache, exactly as the web raw `request`
     * leaves the query cache untouched.
     */
    public suspend fun fetchPinned(
        type: PinnedItemType,
        context: String? = null,
    ): Result<List<PinnedItem>>

    /**
     * `POST /pinned` with `{ item_type, item_id[, context] }` — pins a single item (web
     * `useTogglePin` with `pin = true`). Returns the created row; on success the S8 store
     * refreshes every pin feed (the web `invalidateQueries(pinnedKeys.all)`).
     */
    public suspend fun createPin(
        type: PinnedItemType,
        itemId: String,
        context: String? = null,
    ): Result<PinnedItem>

    /**
     * `DELETE /pinned/{id}` — removes a single pin by id (web `useTogglePin` with `pin = false`,
     * after resolving the row id from the cache/fetch). On success the S8 store refreshes every
     * pin feed.
     */
    public suspend fun deletePin(id: Long): Result<Unit>

    /**
     * `PATCH /pinned/{id}` with `{ position }` — reorders a single pin within its bucket (web
     * `useReorderPin`). Returns the updated row; on success the S8 store refreshes ONLY the
     * `(type, no-context)` feed (the web `invalidateQueries(pinnedKeys.list(type))`).
     */
    public suspend fun reorderPin(
        id: Long,
        position: Int,
    ): Result<PinnedItem>
}

/**
 * Builds the `/pinned` query map with the web `buildQuery` semantics
 * (web/src/api/hooks/usePinned.ts): `type` is always present; `context` is sent whenever it is
 * non-null (mirroring `if (context != null) usp.set('context', context)`, so an explicit empty
 * string IS sent, unlike the truthy guards other hooks use). Keys are snake_case, matching the
 * Go handler. Locked by golden vectors shared with the C# port.
 */
public fun pinnedQuery(
    type: PinnedItemType,
    context: String?,
): Map<String, String> {
    val query = linkedMapOf("type" to type.wire)
    if (context != null) query["context"] = context
    return query
}

/**
 * Builds the stable cache/feed key for `(type, context)`, mirroring the web `pinnedKeys.list`
 * tuple `['pinned', type, context ?? null]`. The web array distinguishes an ABSENT context
 * (`null`) from a PRESENT one (a string, including `""` or even the literal `"null"`); a flat
 * string key would conflate them, so a present context is prefixed with `v:` while an absent
 * one collapses to the bare sentinel `null`. Thus `null → "widget:null"`, `"" → "widget:v:"`,
 * `"null" → "widget:v:null"` — all distinct, exactly as the web tuples are. Two param sets
 * collide in the cache iff their web query keys do. Locked by golden vectors shared with the C#
 * port.
 */
public fun pinnedCacheKey(
    type: PinnedItemType,
    context: String?,
): String = "${type.wire}:${if (context == null) "null" else "v:$context"}"
