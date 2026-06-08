package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the AI-usage audit read-models — the cross-platform analogue of the
 * web `useAiUsage` hook domain (web/src/api/hooks/useAiUsage.ts). Every native AI-usage
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * All three members are reads — `useAiUsage.ts` contains only `useQuery`s, no mutations — so
 * each streams a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. There is nothing to invalidate here.
 *
 * Payloads are carried as raw [JsonElement] (the same verbatim-SI strategy as
 * [AdminRepository]): the usage feeds are token counts, micro-cents, and millisecond
 * latencies — not display-unit-bearing — so there is no S5 conversion to do here and the
 * exact server shape round-trips unchanged. The web hooks apply no `select`/derivation, so
 * neither does this port.
 *
 * The `__usage__` feature id is special-cased server-side to gate only on `ai_mode != 'off'`,
 * so these reads stay safe to call even when no AI feature is enabled: the body is all-zeros /
 * empty when nothing has been audited, and a 403 (surfaced through [Resource.Error]) when AI
 * is fully off — exactly as the web `useQuery` surfaces it.
 */
public interface AiUsageRepository {
    /**
     * `GET /ai/usage/today` — the calling user's aggregate AI usage for the current UTC day
     * bucket (call/error counts, token totals, micro-cent cost, average latency). Returns an
     * all-zeros payload when nothing has been audited yet.
     */
    public fun today(): Flow<Resource<JsonElement>>

    /**
     * `GET /ai/usage/by-feature[?since={since}]` — per-feature aggregate since the given
     * ISO-8601 UTC timestamp. When [since] is null the param is omitted and the server
     * defaults to the last 7 days (verbatim with the web hook's conditional path).
     */
    public fun byFeature(since: String? = null): Flow<Resource<JsonElement>>

    /**
     * `GET /ai/usage/recent[?limit={limit}]` — the most recent AI calls (newest first),
     * capped server-side at 500 and defaulted to 50. When [limit] is null the param is
     * omitted (verbatim with the web hook's conditional path).
     */
    public fun recent(limit: Int? = null): Flow<Resource<JsonElement>>
}
