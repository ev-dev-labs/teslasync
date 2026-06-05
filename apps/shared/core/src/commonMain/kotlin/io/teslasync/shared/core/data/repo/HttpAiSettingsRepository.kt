package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult
import io.teslasync.shared.core.presentation.aisettings.reasonFromCode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * HTTP-backed [AiSettingsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013) — the data-layer port of the web `useAiSettings` mutations.
 *
 * Unlike the read-model repositories there is no cache-then-network feed here; the only cache
 * interaction is the settings-document read/invalidate the web `useSaveAiSettings` performs
 * against the shared [CacheDomain.Settings] partition (the analogue of TanStack's
 * `qc.getQueryData(settingsKeys.settings)` / `invalidateQueries(settingsKeys.settings)`). The
 * settings document itself is owned by the (separate) settings domain; this repository only
 * reads the cached copy to merge into and evicts it after a successful save.
 */
public class HttpAiSettingsRepository(
    private val api: ApiHttpClient,
    private val store: CacheStore,
    private val json: Json = defaultApiJson,
) : AiSettingsRepository {
    override suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> {
        // Mirrors `qc.getQueryData<AppSettings>(settingsKeys.settings)`: a cache miss fails
        // closed rather than submitting an undefined-laden blob that would partial-overwrite
        // the user's saved preferences on a full-replace PUT.
        val current =
            store.read(CacheDomain.Settings, SETTINGS_KEY)?.let { record ->
                runCatching { json.parseToJsonElement(record.payload) as? JsonObject }.getOrNull()
            } ?: return Result.failure(IllegalStateException(CACHE_EMPTY_MESSAGE))

        // Verbatim `{ ...current, ...patch }`: current's keys first (order preserved), patch
        // keys overriding on collision and appended when new.
        val merged = JsonObject(current + patch)

        return api
            .safeRequest<JsonElement>(method = HttpMethodKind.PUT, path = "/settings", body = jsonBody(merged))
            .onSuccess {
                // invalidateAndBroadcast(qc, settingsKeys.settings) analogue: evict so the next
                // settings read re-fetches the server-canonicalised document.
                store.delete(CacheDomain.Settings, SETTINGS_KEY)
            }
    }

    override suspend fun validateAiProvider(request: ValidateAiProviderRequest): Result<ValidateAiProviderResult> {
        val body =
            buildJsonObject {
                // `mode` is always present; every cloud field is omitted when null, exactly as
                // the web `JSON.stringify(req)` drops `undefined` keys (snake_case wire names).
                put("mode", request.mode)
                request.provider?.let { put("provider", it) }
                request.baseUrl?.let { put("base_url", it) }
                request.apiKey?.let { put("api_key", it) }
                request.model?.let { put("model", it) }
                request.apiVersion?.let { put("api_version", it) }
                request.flavor?.let { put("flavor", it) }
                request.deployment?.let { put("deployment", it) }
                request.embeddingModel?.let { put("embedding_model", it) }
                request.embeddingDeployment?.let { put("embedding_deployment", it) }
            }

        return try {
            val response =
                api.request<JsonElement>(
                    method = HttpMethodKind.POST,
                    path = "/settings/ai/validate-config",
                    body = jsonBody(body),
                )
            Result.success(parseSuccess(response))
        } catch (e: ApiError.Http) {
            // 422 is the validator's structured rejection — surface it as the Failure variant of
            // the union (a validation outcome). Any other status re-fails so the consumer's error
            // path fires, mirroring the web hook's selective catch.
            if (e.status == 422) {
                Result.success(
                    ValidateAiProviderResult.Failure(
                        reason = reasonFromCode(e.code),
                        message = messageOf(e),
                    ),
                )
            } else {
                Result.failure(e)
            }
        } catch (e: ApiError) {
            Result.failure(e)
        }
    }

    /**
     * Re-shapes a 2xx validation body into [ValidateAiProviderResult.Success]. Reads the
     * snake_case wire fields defensively: a non-object body or an absent field yields an empty
     * `mode`/`base_url` and null optionals rather than throwing, so a benignly-shaped success
     * never turns into a spurious decode failure.
     */
    private fun parseSuccess(response: JsonElement): ValidateAiProviderResult.Success {
        val obj = response as? JsonObject ?: JsonObject(emptyMap())

        fun str(key: String): String? = obj[key]?.jsonPrimitive?.contentOrNull
        return ValidateAiProviderResult.Success(
            mode = str("mode") ?: "",
            baseUrl = str("base_url") ?: "",
            pinnedIp = str("pinned_ip"),
            probedModel = str("probed_model"),
            note = str("note"),
        )
    }

    /**
     * Extracts the human message from a 422 `{error, code}` envelope — the verbatim web
     * `ApiError.message`, which is `body.error` when a non-blank string is present and otherwise
     * the status line. Falls back to the raw body / generic HTTP message if the body is not the
     * expected JSON shape.
     */
    private fun messageOf(error: ApiError.Http): String {
        val body = error.body
        if (!body.isNullOrBlank()) {
            val parsed =
                runCatching {
                    json
                        .parseToJsonElement(body)
                        .jsonObject["error"]
                        ?.jsonPrimitive
                        ?.contentOrNull
                }.getOrNull()
            if (!parsed.isNullOrBlank()) return parsed
            return body
        }
        return error.message ?: "HTTP ${error.status}"
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        const val SETTINGS_KEY = "settings"
        const val CACHE_EMPTY_MESSAGE = "settings cache empty — refresh the page and try again"
    }
}
