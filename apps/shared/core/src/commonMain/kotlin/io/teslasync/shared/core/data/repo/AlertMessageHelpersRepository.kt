package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The S7 data port for the Alert Studio message-template helpers — the cross-platform analogue
 * of the web `useAlertMessageHelpers` hook domain (web/src/api/hooks/useAlertMessageHelpers.ts).
 * Every native Alert-Studio editor surface (Android/Apple via KMP, Windows via the C# port)
 * reaches the backend exclusively through this interface, so a single fake stands in for the
 * whole domain in the S8 state-holder tests.
 *
 * Two members are cache-then-network reads (the web `useQuery`s) and one is an imperative action
 * (the web `useMutation`):
 *  - [messagePresets] and the autocomplete-catalog read stream a [Resource] (ADR-013) — the
 *    cached value first for an instant cold start, then the refreshed value. They are pure
 *    functions of their inputs (no per-user state) so they share the
 *    [io.teslasync.shared.core.cache.CacheDomain] `AlertMessages` partition keyed by their
 *    snake_case params, exactly like the web TanStack query keys.
 *  - [messagePreview] is a non-throwing suspend action returning a [Result], mirroring the web
 *    `useAlertMessagePreview` mutation: it POSTs the live editor draft and renders a single
 *    preview on demand (the editor debounces it). It performs no cache read/write and has no
 *    invalidation surface — verbatim with the web hook, which registers no `onSuccess`.
 *
 * Payloads are carried as raw [JsonElement]/[JsonObject] (the same verbatim strategy as
 * [AdminRepository]): preset templates, autocomplete catalogs, and the preview title/body are
 * plain strings — not display-unit-bearing — so there is no S5 conversion to do here and the
 * exact server shape round-trips unchanged. The web hooks apply no `select`/derivation, so
 * neither does this port.
 */
public interface AlertMessageHelpersRepository {
    /**
     * `GET /alerts/message-presets[?kind={kind}]` — the curated preset gallery. When [kind] is
     * null or blank the param is omitted and the server returns the full catalog (verbatim with
     * the web hook's `kind ? '?kind=…' : ''` conditional path); a non-blank `signal` /
     * `computed_metric` filters to that shape plus the universal entries.
     */
    public fun messagePresets(kind: String? = null): Flow<Resource<JsonElement>>

    /**
     * The autocomplete field catalog for the given rule shape, served by the
     * `/alerts/message-placeholders` endpoint.  // parity:allow API resource name (ADR-014), not a stub
     * Each param is omitted when null or blank, mirroring the web hook's `if (x) params.set(...)`
     * conditional assembly (snake_case wire names: `kind`, `signal_name`, `op`, `metric_id`).
     */
    public fun messagePlaceholders( // parity:allow web-hook parity method name (ADR-014), not a stub
        kind: String? = null,
        signalName: String? = null,
        op: String? = null,
        metricId: String? = null,
    ): Flow<Resource<JsonElement>>

    /**
     * `POST /alerts/message-preview` — renders a single message preview against the backend from
     * the live editor draft [body] (sent verbatim, snake_case). A 2xx yields
     * `Result.success(JsonElement)` (the `{title, body}` envelope); any HTTP/transport failure
     * yields `Result.failure`. Performs no cache interaction — the web hook is a `useMutation`
     * with no `onSuccess`/invalidation.
     */
    public suspend fun messagePreview(body: JsonObject): Result<JsonElement>
}
