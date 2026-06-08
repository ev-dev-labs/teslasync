package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [SettingsBackupRepository] over the resilient [ApiHttpClient] (ADR-006). The three
 * surfaces are all mutations (web `useMutation`), so this port keeps NO durable cache: it calls the
 * API directly and returns a non-throwing [Result]. The "last export"/"last import" cache priming
 * the web hooks do via `setQueryData` is the S8 store's responsibility, not this layer's.
 *
 * The import body is assembled as a single [JsonObject] with the fetched [SettingsBundle] re-encoded
 * verbatim under `bundle` (its opaque sections round-trip shape-preserving), so the bytes match the
 * web `JSON.stringify({ dry_run, bundle })` exactly — important because the backend decodes with
 * `DisallowUnknownFields`. The apply path may trip the backend's RequireSudo step-up; that is handled
 * transparently inside [ApiHttpClient], so there is no bespoke step-up plumbing here.
 */
public class HttpSettingsBackupRepository(
    private val api: ApiHttpClient,
    private val json: Json = defaultApiJson,
) : SettingsBackupRepository {
    override suspend fun exportSettings(): Result<SettingsBundle> =
        api.safeRequest<SettingsBundle>(method = HttpMethodKind.GET, path = "/settings/export")

    override suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> = importRequest(bundle, dryRun = true)

    override suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> = importRequest(bundle, dryRun = false)

    private suspend fun importRequest(
        bundle: SettingsBundle,
        dryRun: Boolean,
    ): Result<SettingsImportResult> {
        val body =
            buildJsonObject {
                put("dry_run", dryRun)
                put("bundle", json.encodeToJsonElement(SettingsBundle.serializer(), bundle))
            }
        return api.safeRequest<SettingsImportResult>(
            method = HttpMethodKind.POST,
            path = "/settings/import",
            body = jsonBody(body),
        )
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
