package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.totp.TOTPBackupCodesResponse
import io.teslasync.shared.core.presentation.totp.TOTPDerivations
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import io.teslasync.shared.core.presentation.totp.TOTPStatusPayload
import io.teslasync.shared.core.presentation.totp.TOTPSudoToken
import io.teslasync.shared.core.presentation.totp.TOTPVerifyResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [TOTPRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * The single status read uses the [CacheDomain.Totp] partition under one [STATUS_KEY] (mirroring the
 * web `totpKeys.status` tuple `['totp','status']`), whose 30-second default TTL matches the web
 * hook's `staleTime`.
 *
 * The read decodes the raw `{ mode, activated, last_used_at?, backup_codes_remaining }` body and
 * normalises it through [TOTPDerivations.statusResponse] (`backup_codes_remaining ?? 0`). The 501
 * `AUTH_MODE_OPEN` sentinel is caught and mapped to [TOTPStatus.Open] — a *successful* no-op cached
 * like any other value — exactly as the web `queryFn` does; any other [ApiError] propagates so the
 * read surfaces a [Resource.Error]. The endpoint is the version-namespaced `/auth/totp`; the
 * resilient client adds the `/api/v1` prefix exactly once, matching the web `request('/auth/totp')`
 * call verbatim.
 *
 * `enroll` / `verify` / `revoke` / `regenerateBackupCodes` call the API directly and, on success,
 * evict ONLY the single status key ([evict]) — the data-layer analogue of the web hooks invalidating
 * `totpKeys.status`. `stepUp` performs no eviction (the web `useTOTPStepUp` declares none) and posts
 * the conditional body assembled by [TOTPDerivations.stepUpBody], serialized byte-for-byte like the
 * web `JSON.stringify(body)`.
 */
public class HttpTOTPRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<TOTPStatus>(
        store,
        clock,
        json,
        TOTPStatus.serializer(),
    ),
    TOTPRepository {
    override val domain: CacheDomain = CacheDomain.Totp

    // ---- Read ---------------------------------------------------------------------

    override fun status(): Flow<Resource<TOTPStatus>> =
        observe(STATUS_KEY) {
            try {
                val payload = api.request<TOTPStatusPayload>(path = TOTP_PATH)
                TOTPDerivations.statusResponse(payload.activated, payload.lastUsedAt, payload.backupCodesRemaining)
            } catch (e: ApiError.Http) {
                // The backend's 501 AUTH_MODE_OPEN is a "feature unavailable" signal, not an error:
                // surface it as a successful open-mode value, exactly like the web queryFn.
                if (e.code == TOTPDerivations.AUTH_MODE_OPEN_CODE) {
                    TOTPStatus.Open
                } else {
                    throw e
                }
            }
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun enroll(): Result<TOTPEnrollment> =
        api
            .safeRequest<TOTPEnrollment>(method = HttpMethodKind.POST, path = "$TOTP_PATH/enroll")
            .onSuccess { evict(STATUS_KEY) }

    override suspend fun verify(code: String): Result<TOTPVerifyResult> {
        val body = buildJsonObject { put(TOTPDerivations.CODE_FIELD, code) }
        return api
            .safeRequest<TOTPVerifyResult>(method = HttpMethodKind.POST, path = "$TOTP_PATH/verify", body = jsonBody(body))
            .onSuccess { evict(STATUS_KEY) }
    }

    override suspend fun stepUp(
        code: String?,
        backupCode: String?,
    ): Result<TOTPSudoToken> {
        // Only the supplied of code / backup_code is sent — the web `if (code)` / `if (backup_code)`
        // guard, shared via the derivation so the C# port can never diverge.
        val body =
            buildJsonObject {
                for ((key, value) in TOTPDerivations.stepUpBody(code, backupCode)) {
                    put(key, value)
                }
            }
        // No cache invalidation: the web `useTOTPStepUp` performs none — it only parks the token.
        return api.safeRequest<TOTPSudoToken>(method = HttpMethodKind.POST, path = "$TOTP_PATH/sudo", body = jsonBody(body))
    }

    override suspend fun revoke(): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = TOTP_PATH)
            .map { }
            .onSuccess { evict(STATUS_KEY) }

    override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> =
        api
            .safeRequest<TOTPBackupCodesResponse>(method = HttpMethodKind.POST, path = "$TOTP_PATH/backup-codes/regenerate")
            .onSuccess { evict(STATUS_KEY) }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        const val TOTP_PATH = "/auth/totp"

        // Mirrors the web `totpKeys.status` tuple ['totp','status']: a single status feed.
        const val STATUS_KEY = "status"
    }
}
