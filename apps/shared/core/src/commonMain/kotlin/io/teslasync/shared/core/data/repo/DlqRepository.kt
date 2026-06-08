package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the dead-letter-queue inspector — the cross-platform analogue of the
 * web `useDLQ` hook domain (web/src/api/hooks/useDLQ.ts), backed by the Go handlers under
 * `/api/v1/system/dlq*`. Every native DLQ surface (Android/Apple via KMP, Windows via the C#
 * port) reaches the backend exclusively through this interface, so a single fake stands in for
 * the whole domain in the S8 state-holder tests.
 *
 * Reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an instant
 * cold start, then the refreshed value. The lone mutation ([replayEntry]) is a non-throwing
 * suspend function returning a [Result] and — mirroring the web hook's
 * `invalidateQueries(['system','dlq'])` — evicting the entire DLQ partition so the next read of
 * any DLQ feed re-fetches.
 *
 * Payloads are carried as raw [JsonElement] (the same verbatim-SI strategy as
 * [AdminRepository]/[NotificationRepository]): the DLQ feeds are not unit-bearing, so there is no
 * display conversion to do here, and the exact server shape round-trips unchanged. The two
 * client-side derivations ported from the web — the entry-id guard ([dlqEntryNumericId]) and the
 * audit scoping ([dlqAuditScoped]/[dlqAuditPath]) — are pure functions locked by golden vectors
 * shared with the C# port so the three platforms cannot drift (ADR-004).
 */
public interface DlqRepository {
    // ---- Reads (3) ----------------------------------------------------------------

    /** `GET /system/dlq` — recent DLQ entries plus the server-side `replay_enabled` flag. */
    public fun list(): Flow<Resource<JsonElement>>

    /**
     * `GET /system/dlq/{id}` — the full DLQ entry (summary + raw + base64 inner payload). [id]
     * is the guarded numeric id ([dlqEntryNumericId]); callers must not pass a non-positive id
     * (the S8 store gates that as a disabled query, the web `enabled` analogue).
     */
    public fun entry(id: Long): Flow<Resource<JsonElement>>

    /**
     * `GET /system/dlq/{id}/audit?limit={limit}` (scoped) or `GET /system/dlq/audit?limit={limit}`
     * (global) — recent replay-audit rows. Pass a positive [dlqId] to scope to a single entry's
     * replay history; pass `null`/`0` for the global feed. The scoped/global decision and the path
     * are the pure [dlqAuditScoped]/[dlqAuditPath] derivations ported from the web hook.
     */
    public fun audit(
        dlqId: Long?,
        limit: Int,
    ): Flow<Resource<JsonElement>>

    // ---- Mutations (1) ------------------------------------------------------------

    /**
     * `POST /system/dlq/{id}/replay` → the replay result; invalidates the WHOLE DLQ partition
     * (list + entry + audit feeds), mirroring the web hook's `invalidateQueries(['system','dlq'])`.
     * The sudo gate and the `DLQ_REPLAY_ENABLED=false` 403 are surfaced through the [Result]
     * failure exactly as the web mutation surfaces them — no special-case plumbing here.
     */
    public suspend fun replayEntry(id: Long): Result<JsonElement>
}

/**
 * The entry-id guard ported from the web `useDLQEntry` (`numericId = typeof id === 'number' &&
 * id > 0 ? id : 0`): a positive id passes through; anything else (null, zero, negative) collapses
 * to `0`, the sentinel the web uses to keep the query disabled. Pure and language-neutral so the
 * C# port mirrors it exactly (golden-locked, ADR-004).
 */
public fun dlqEntryNumericId(id: Long?): Long = if (id != null && id > 0) id else 0L

/**
 * The audit scoping decision ported from the web `useDLQAudit` (`scoped = typeof dlqId === 'number'
 * && dlqId > 0`): a positive [dlqId] scopes the audit feed to one entry; null/zero/negative selects
 * the global feed. Pure and golden-locked for cross-platform parity (ADR-004).
 */
public fun dlqAuditScoped(dlqId: Long?): Boolean = dlqId != null && dlqId > 0

/**
 * The audit path ported from the web `useDLQAudit` (`scoped ? /system/dlq/${dlqId}/audit :
 * /system/dlq/audit`). The `limit` is carried as a query parameter, not embedded here, so the path
 * is a pure function of [dlqId]. Golden-locked for cross-platform parity (ADR-004).
 */
public fun dlqAuditPath(dlqId: Long?): String = if (dlqAuditScoped(dlqId)) "/system/dlq/$dlqId/audit" else "/system/dlq/audit"
