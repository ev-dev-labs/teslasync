package io.teslasync.shared.core.presentation.dlq

import io.teslasync.shared.core.data.repo.DlqRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.dlqEntryNumericId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the dead-letter-queue inspector — the cross-platform port of the
 * web `useDLQ` hook domain (web/src/api/hooks/useDLQ.ts). Every native DLQ screen (Android/Apple via
 * KMP, Windows via the C# port) binds to this single holder rather than re-implementing endpoints,
 * query keys, the entry `enabled` gate, or the replay invalidation rule.
 *
 * The three reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * is lazily created on first access, shared so every observer of the same feed (or the same
 * `(feed, params)`) folds into one upstream collection, and refreshable. The lone mutation
 * ([replay]) is a non-throwing suspend function returning a [Result]; on success it refreshes EVERY
 * observed DLQ feed, mirroring the web hook's `invalidateQueries(['system','dlq'])` which
 * invalidates the whole `['system','dlq']` prefix (list + entry + audit). The holder makes no
 * network calls itself — it delegates entirely to the injected [DlqRepository] (S7), which also
 * clears the affected cache partition so a refresh re-fetches rather than replaying a stale entry.
 *
 * The web `useDLQEntry(id, enabled)` gates the query with `enabled && numericId > 0`. The holder
 * reproduces that gate: when [id] is non-positive or [enabled] is false the returned feed never
 * fetches and stays at the initial Loading slot (the analogue of a TanStack query with
 * `enabled: false`), collapsing to one stable disabled instance so a drawer can bind before an
 * entry is selected. Values stay SI; conversion is display-only (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class DlqStore(
    private val repo: DlqRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()
    private val disabledFeed: StateFlow<Resource<JsonElement>> = MutableStateFlow(INITIAL)

    // ---- Reads (3) ----------------------------------------------------------------

    /** Shared, refreshable `GET /system/dlq` feed (web `useDLQList`). */
    public fun list(): StateFlow<Resource<JsonElement>> = feed(KEY_LIST) { repo.list() }

    /**
     * Shared, refreshable `GET /system/dlq/{id}` feed (web `useDLQEntry`). When [id] is non-positive
     * or [enabled] is false the returned feed never fetches and stays at the initial Loading slot —
     * the analogue of the web `enabled: enabled && numericId > 0` gate. The id is guarded via
     * [dlqEntryNumericId] before keying, exactly as the web computes `numericId`.
     */
    public fun entry(
        id: Long?,
        enabled: Boolean = true,
    ): StateFlow<Resource<JsonElement>> {
        val numericId = dlqEntryNumericId(id)
        if (!enabled || numericId <= 0L) return disabledFeed
        return feed("$KEY_ENTRY:$numericId") { repo.entry(numericId) }
    }

    /**
     * Shared, refreshable DLQ replay-audit feed (web `useDLQAudit`). A positive [dlqId] scopes the
     * feed to one entry's replay history; `null`/`0` selects the global feed. [limit] mirrors the
     * server-side query param and the web hook's default of 50 (`PAGINATION.DEFAULT_LIMIT`).
     */
    public fun audit(
        dlqId: Long? = null,
        limit: Int = DEFAULT_LIMIT,
    ): StateFlow<Resource<JsonElement>> = feed(auditKey(dlqId, limit)) { repo.audit(dlqId, limit) }

    // ---- Mutations (1) ------------------------------------------------------------

    /**
     * Replays a single DLQ entry, then refreshes EVERY observed DLQ feed — mirroring the web hook's
     * `invalidateQueries(['system','dlq'])`, which invalidates the whole `['system','dlq']` prefix
     * (the new audit row appears and the entry's state updates within one cycle). The repository has
     * already cleared the DLQ cache partition on success, so each refresh re-fetches.
     */
    public suspend fun replay(id: Long): Result<JsonElement> = repo.replayEntry(id).onSuccess { refreshAll() }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refreshAll]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }

    /** Re-fetches every feed that is being observed — the `invalidateQueries(['system','dlq'])` analogue. */
    private fun refreshAll() {
        triggers.values.forEach { t -> t.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        // Web `PAGINATION.DEFAULT_LIMIT` (web/src/lib/constants.ts).
        const val DEFAULT_LIMIT = 50

        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        const val KEY_LIST = "list"
        const val KEY_ENTRY = "entry"
        const val KEY_AUDIT = "audit"
        const val KEY_ENTRY_AUDIT = "entry-audit"

        fun auditKey(
            dlqId: Long?,
            limit: Int,
        ): String = if (dlqId != null && dlqId > 0) "$KEY_ENTRY_AUDIT:$dlqId:$limit" else "$KEY_AUDIT:$limit"
    }
}
