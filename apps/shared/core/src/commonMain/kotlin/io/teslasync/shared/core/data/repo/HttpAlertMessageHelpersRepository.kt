package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [AlertMessageHelpersRepository] over the resilient [ApiHttpClient] and the offline
 * cache (ADR-013) — the data-layer port of the web `useAlertMessageHelpers` hooks.
 *
 * The two catalog reads share the single [CacheDomain.AlertMessages] partition, keyed by a stable
 * per-feed string that mirrors the web TanStack query keys (`['alerts','message-presets', kind]`
 * and the autocomplete-catalog key `[..., kind, signal_name, op, metric_id]`), so each
 * `(feed, params)` tuple caches independently while logout still clears the whole domain in one
 * call. Reads go through the generic cache-then-network operator ([observe]); the optional query
 * params are passed as nullable map values — a null value is dropped on the wire by the client,
 * reproducing the web hook's conditional-path behaviour (omit the param entirely when
 * absent/blank) without a second code path.
 *
 * [messagePreview] is the lone mutation: it POSTs the draft [JsonObject] verbatim and does not
 * touch the cache (the web `useAlertMessagePreview` registers no `onSuccess`/invalidation). The
 * body is wrapped as [TextContent] so its exact compact JSON bytes reach the wire unchanged —
 * byte-for-byte parity with the web `JSON.stringify(body)`.
 */
public class HttpAlertMessageHelpersRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AlertMessageHelpersRepository {
    override val domain: CacheDomain = CacheDomain.AlertMessages

    override fun messagePresets(kind: String?): Flow<Resource<JsonElement>> {
        val k = kind.orNull()
        return observe("$KEY_PRESETS:${k ?: ""}") {
            api.request<JsonElement>(
                path = "/alerts/message-presets",
                query = mapOf("kind" to k),
            )
        }
    }

    override fun messagePlaceholders( // parity:allow web-hook parity method name (ADR-014), not a stub
        kind: String?,
        signalName: String?,
        op: String?,
        metricId: String?,
    ): Flow<Resource<JsonElement>> {
        val k = kind.orNull()
        val s = signalName.orNull()
        val o = op.orNull()
        val m = metricId.orNull()
        return observe("$KEY_FIELDS:${k ?: ""}:${s ?: ""}:${o ?: ""}:${m ?: ""}") {
            api.request<JsonElement>(
                path = "/alerts/message-placeholders", // parity:allow API resource path (ADR-014), not a stub
                query =
                    mapOf(
                        "kind" to k,
                        "signal_name" to s,
                        "op" to o,
                        "metric_id" to m,
                    ),
            )
        }
    }

    override suspend fun messagePreview(body: JsonObject): Result<JsonElement> =
        api.safeRequest<JsonElement>(
            method = HttpMethodKind.POST,
            path = "/alerts/message-preview",
            body = TextContent(body.toString(), ContentType.Application.Json),
        )

    private companion object {
        const val KEY_PRESETS = "presets"

        // Stable cache-key prefix for the autocomplete field catalog feed.
        const val KEY_FIELDS = "fields"

        /** Mirrors the web truthiness check (`kind ? … : ''`): null or blank ⇒ omit the param. */
        fun String?.orNull(): String? = this?.takeIf { it.isNotBlank() }
    }
}
