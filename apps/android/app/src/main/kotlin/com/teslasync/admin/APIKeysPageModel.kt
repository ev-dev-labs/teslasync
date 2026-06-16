// Pure, framework-free model + projection for the APIKeysPage feature view — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/APIKeysPage.tsx). No
// Compose, no Android, no HTTP lives here: every declaration in this file is exercised off-device in the
// :android:testDebugUnitTest gate, keeping the composable a thin render layer.
//
// The web page lists issued API keys, lets the operator mint a new key (with a read / read-write / admin
// permission level), reveals the freshly-minted secret exactly once, and revokes or permanently deletes a key.
// This file owns the canonical pieces:
//   - the [ApiKey] row projection parsed from the raw `/api-keys` JSON (the shared `safeArray` contract),
//   - the [PermissionLevel] mapping (web `PermissionBadge` config: read / read-write / admin),
//   - the freshly-minted secret extracted from the `POST /api-keys` response (web `data.key`),
//   - the expiry predicate (web `isExpired` = `expiresAt && new Date(expiresAt) < new Date()`),
//   - and the surface registry + PII-safe diagnostics ids (P1/S11).
// Label resolution + date formatting are render concerns the composable owns.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot match the app's `io.teslasync.android.*`
// package root, so the package intentionally diverges from the path — exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ApiKeysPageRegistration {
    /** Stable surface id. */
    const val ID: String = "api-keys-page"

    /** The web route this surface mirrors (web `/api-keys`). */
    const val ROUTE: String = "apiKeys"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "APIKeysPage"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Every event carries ONLY the surface slug — never a key name,
 * prefix, raw secret, or id — so a diagnostics line can never leak what was minted, revoked, or deleted. Kept
 * free of Compose so it is unit-tested with a recording [Logger].
 */
object ApiKeysPageDiagnostics {
    /** The one-shot view-open diagnostic event name. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Logged when a key is minted (web `createMut.mutate`). */
    const val EVENT_CREATE: String = "apiKeys.create"

    /** Logged when a key is revoked (web `revokeMut.mutate`). */
    const val EVENT_REVOKE: String = "apiKeys.revoke"

    /** Logged when a key is deleted (web `deleteMut.mutate`). */
    const val EVENT_DELETE: String = "apiKeys.delete"

    /** The diagnostics field carrying the surface slug. */
    const val FIELD_SURFACE: String = "surface"

    private fun emit(
        logger: Logger,
        event: String,
    ) = logger.info(event, mapOf(FIELD_SURFACE to ApiKeysPageRegistration.SLUG))

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger): Unit = emit(logger, EVENT_VIEW_OPENED)

    /** Emits the PII-safe key-minted diagnostic (surface slug only — never the name or secret). */
    fun recordCreate(logger: Logger): Unit = emit(logger, EVENT_CREATE)

    /** Emits the PII-safe key-revoked diagnostic (surface slug only — never the id). */
    fun recordRevoke(logger: Logger): Unit = emit(logger, EVENT_REVOKE)

    /** Emits the PII-safe key-deleted diagnostic (surface slug only — never the id). */
    fun recordDelete(logger: Logger): Unit = emit(logger, EVENT_DELETE)
}

/**
 * The permission level an API key grants — the native port of the web `PermissionBadge` config map
 * (read / read-write / admin). [wire] is the exact backend token the create request sends and the list rows
 * carry (web `k.permissions`); unknown values fall back to [Read] exactly as the web `cfg[perm] ?? cfg.read`.
 */
enum class PermissionLevel(
    val wire: String,
) {
    Read("read"),
    ReadWrite("read-write"),
    Admin("admin"),
    ;

    companion object {
        /** Resolves a backend permission token to a level, defaulting to [Read] for an unknown token. */
        fun fromWire(token: String?): PermissionLevel = entries.firstOrNull { it.wire == token } ?: Read
    }
}

/**
 * The render-ready API key — the native projection of one `/api-keys` row. Pure data (no Compose), so the row
 * derivation is fully covered by the off-device unit gate; the localized labels + date formatting are resolved
 * at the Compose boundary.
 *
 * @property id the numeric key id (web `k.id`), used as the stable list key + the mutation target.
 * @property name the human label (web `k.name`).
 * @property permission the granted level (web `k.permissions`).
 * @property keyPrefix the masked prefix shown in the row (web `k.keyPrefix` / backend `key_prefix`).
 * @property createdAtMillis epoch-ms of `created_at`, or `null` when unparseable (web `k.createdAt`).
 * @property lastUsedAtMillis epoch-ms of `last_used_at`, or `null` when never used (web `k.lastUsedAt`).
 * @property expiresAtMillis epoch-ms of `expires_at`, or `null` when the key never expires (web `k.expiresAt`).
 */
data class ApiKey(
    val id: Long,
    val name: String,
    val permission: PermissionLevel,
    val keyPrefix: String,
    val createdAtMillis: Long?,
    val lastUsedAtMillis: Long?,
    val expiresAtMillis: Long?,
) {
    /** True when the key carries an expiry stamp at or before [nowMillis] (web `isExpired`). */
    fun isExpired(nowMillis: Long): Boolean = expiresAtMillis?.let { it <= nowMillis } ?: false
}

/**
 * The pure list/created-key projection the composable renders. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate.
 */
object ApiKeysProjection {
    private const val FIELD_ID = "id"
    private const val FIELD_NAME = "name"
    private const val FIELD_PERMISSIONS = "permissions"
    private const val FIELD_KEY_PREFIX = "key_prefix"
    private const val FIELD_CREATED_AT = "created_at"
    private const val FIELD_LAST_USED_AT = "last_used_at"
    private const val FIELD_EXPIRES_AT = "expires_at"
    private const val FIELD_KEY = "key"

    /**
     * Projects the raw `GET /api-keys` payload (P1/S8) onto the render-ready [ApiKey] list. The payload is
     * array-guarded (the shared `safeArray` contract): a non-array or `null` collapses to empty, so the surface
     * never crashes on a malformed feed. Each object is read with the backend's exact snake_case field names —
     * the verbatim-SI strategy the shared `AdminRepository` round-trips unchanged.
     */
    fun parseList(payload: JsonElement?): List<ApiKey> =
        payload.asObjectArray().mapNotNull { row ->
            val id = row.longField(FIELD_ID) ?: return@mapNotNull null
            ApiKey(
                id = id,
                name = row.stringField(FIELD_NAME).orEmpty(),
                permission = PermissionLevel.fromWire(row.stringField(FIELD_PERMISSIONS)),
                keyPrefix = row.stringField(FIELD_KEY_PREFIX).orEmpty(),
                createdAtMillis = row.stringField(FIELD_CREATED_AT)?.let(::parseIsoMillis),
                lastUsedAtMillis = row.stringField(FIELD_LAST_USED_AT)?.let(::parseIsoMillis),
                expiresAtMillis = row.stringField(FIELD_EXPIRES_AT)?.let(::parseIsoMillis),
            )
        }

    /**
     * Extracts the freshly-minted raw secret from the `POST /api-keys` response (web `data.key`). Returns the
     * non-blank key string, or `null` when the response is shaped unexpectedly — the surface then keeps the
     * create form open rather than presenting a blank "copy this key" panel.
     */
    fun parseCreatedKey(payload: JsonElement?): String? = (payload as? JsonObject)?.stringField(FIELD_KEY)?.takeIf { it.isNotBlank() }

    /** The domain emptiness predicate fed to `toUiState` — empty when there are no issued keys (web `keys.length`). */
    fun isEmpty(keys: List<ApiKey>): Boolean = keys.isEmpty()
}

/** Array guard ported from the shared `safeArray`: a non-array / null collapses to an empty object list. */
private fun JsonElement?.asObjectArray(): List<JsonObject> = (this as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

/** Reads a string field, treating a JSON-null or non-primitive as absent. */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Reads a long field, tolerating both a JSON number and a numeric string (the backend emits `id` as a number). */
private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.contentOrNull?.toLongOrNull()
}

/** Parses an ISO-8601 timestamp to epoch-ms (API 26+ `java.time`), tolerating both offset and `Z` forms. */
internal fun parseIsoMillis(iso: String): Long? =
    runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(iso).toEpochMilli() }
        .getOrNull()
