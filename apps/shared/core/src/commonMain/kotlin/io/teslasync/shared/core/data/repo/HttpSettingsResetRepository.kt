package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [SettingsResetRepository] over the resilient [ApiHttpClient] (ADR-006) and the offline
 * cache (ADR-013). Both surfaces are mutations (web `useMutation`), so this port keeps no
 * cache-then-network read of its own; it calls the API directly and returns a non-throwing [Result].
 *
 * On success each mutation invalidates the WHOLE cache ([CacheStore.clearAll]) — the data-layer
 * analogue of the web hooks' argument-less `queryClient.invalidateQueries()`. A reset can clear any
 * preference / rule / channel / geofence / automation / dashboard-layout / quiet-hours row, so every
 * cached read-model is now potentially stale; dropping everything is the honest, web-faithful
 * response, and the cache-then-network operator re-fetches each feed from the network on its next
 * read. The "last reset" receipt the web hooks cache via `setQueryData(settingsResetKeys.lastReset)`
 * is the S8 store's responsibility, not this layer's.
 *
 * The request body is assembled as a [JsonObject] so its exact bytes match the web
 * `JSON.stringify(...)` calls: `{ "section": "..." }` for [resetSection] and `{}` for [resetAll].
 * The backend decodes with `DisallowUnknownFields`, so byte-shape parity matters. The apply path is
 * sudo-gated upstream; the `RequireSudo` step-up is handled transparently inside [ApiHttpClient], so
 * there is no bespoke step-up plumbing here.
 */
public class HttpSettingsResetRepository(
    private val api: ApiHttpClient,
    private val store: CacheStore,
) : SettingsResetRepository {
    override suspend fun resetSection(section: String): Result<SettingsResetResult> =
        resetRequest(buildJsonObject { put("section", section) })

    override suspend fun resetAll(): Result<SettingsResetResult> = resetRequest(buildJsonObject {})

    private suspend fun resetRequest(body: JsonObject): Result<SettingsResetResult> {
        val result =
            api.safeRequest<SettingsResetResult>(
                method = HttpMethodKind.POST,
                path = RESET_PATH,
                body = jsonBody(body),
            )
        if (result.isSuccess) {
            invalidateAll()
        }
        return result
    }

    /**
     * Drops every cached query ([CacheStore.clearAll]) — the data-layer analogue of the web hooks'
     * argument-less `invalidateQueries()`. Best-effort: the server reset has already succeeded, so a
     * cache failure must NOT turn the non-throwing mutation [Result] into a thrown exception. A
     * coroutine cancellation still propagates; any stale row left behind is corrected on the next
     * read, because the cache-then-network operator always re-fetches from the network.
     */
    private suspend fun invalidateAll() {
        try {
            store.clearAll()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // Best-effort invalidation; each feed's next refresh re-fetches from the network anyway.
        }
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        const val RESET_PATH = "/settings/reset"
    }
}
