package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.CreateShareResponse
import io.teslasync.shared.core.presentation.sharing.ShareToken
import io.teslasync.shared.core.presentation.sharing.SharedDrive
import io.teslasync.shared.core.presentation.sharing.SharedDriveData
import io.teslasync.shared.core.presentation.sharing.SharedDriveDataV1
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The S7 data port for the shareable-drive-reports surface — the cross-platform analogue of the web
 * `useSharing` hook domain (web/src/api/hooks/useSharing.ts). Every native Sharing screen
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013):
 *  - [shareLinks] — `GET /drives/{driveId}/shares`, the authenticated owner's share rows for one
 *    drive (web `useShareLinks`). Cached under [shareLinksCacheKey] for [SHARE_LINKS_TTL_MILLIS]
 *    (web staleTime 0 ⇒ always stale, refetch on every access). Always resolves to an array.
 *  - [sharedDrive] — `GET /share/{token}`, the PUBLIC report behind a share token (web
 *    `useSharedDrive`). Cached under [sharedDriveCacheKey] for [SHARED_DRIVE_TTL_MILLIS]
 *    (web `STALE_TIMES.SLOW` = 5 minutes). Decoded into the [SharedDrive] union by
 *    [SharedDriveSerializer].
 *
 * The two mutations are non-throwing suspend [Result]s; on success each evicts ONLY the affected
 * drive's [shareLinksCacheKey] (the web hooks invalidate ONLY `sharingKeys.shares(driveId)` — never
 * the public `shared-drive` feed and never another drive's links), so the S8 store's matching
 * refresh re-fetches that one feed rather than replaying a stale entry.
 *
 * Share-link fields (ids, tokens, booleans, view counts, timestamps) are plain and not
 * unit-bearing, so they round-trip verbatim with no SI conversion; the public report's canonical
 * values are SI and converted only at the render boundary (S5).
 */
public interface SharingRepository {
    /**
     * `GET /drives/{driveId}/shares` — every share link for [driveId] (web `useShareLinks`). The
     * cache key is built by [shareLinksCacheKey], mirroring the web `sharingKeys.shares` tuple.
     * Always resolves to an array (never null) so consumers can iterate without a guard.
     */
    public fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>>

    /**
     * `GET /share/{token}` — the public shared-drive report for [token] (web `useSharedDrive`). The
     * cache key is built by [sharedDriveCacheKey], mirroring the web `sharingKeys.shared` tuple. The
     * payload decodes into either the SI-canonical or the legacy variant of the [SharedDrive] union.
     */
    public fun sharedDrive(token: String): Flow<Resource<SharedDrive>>

    /**
     * `POST /drives/{driveId}/share` — creates a share link (web `useCreateShareLink`). The body is
     * built by [createShareBody] (only supplied fields are sent). On success the affected drive's
     * [shareLinksCacheKey] is evicted (the web `invalidateQueries(sharingKeys.shares(driveId))`).
     */
    public suspend fun createShareLink(
        driveId: String,
        request: CreateShareRequest,
    ): Result<CreateShareResponse>

    /**
     * `DELETE /shares/{token}` — revokes a share link by token (web `useRevokeShareLink`). The
     * owning [driveId] is carried so the matching [shareLinksCacheKey] can be evicted on success
     * (the web `invalidateQueries(sharingKeys.shares(driveId))`), exactly as the web mutation
     * deletes by token but invalidates by drive.
     */
    public suspend fun revokeShareLink(
        driveId: String,
        token: String,
    ): Result<Unit>
}

/**
 * Builds the stable cache/feed key for a drive's share links, mirroring the web `sharingKeys.shares`
 * tuple `['shares', driveId]`. Prefixed with `shares:` so it can never collide with a
 * [sharedDriveCacheKey] sharing the same partition even when a `driveId` equals a `token`. Locked by
 * golden vectors shared with the C# port.
 */
public fun shareLinksCacheKey(driveId: String): String = "shares:$driveId"

/**
 * Builds the stable cache/feed key for a public shared-drive report, mirroring the web
 * `sharingKeys.shared` tuple `['shared-drive', token]`. Prefixed with `shared-drive:` so it can
 * never collide with a [shareLinksCacheKey] in the same partition. Locked by golden vectors shared
 * with the C# port.
 */
public fun sharedDriveCacheKey(token: String): String = "shared-drive:$token"

/**
 * Builds the `POST /drives/{driveId}/share` body, mirroring the web `JSON.stringify(data)` over a
 * `CreateShareRequest`: only the supplied (non-null) fields are emitted, so an absent field is
 * dropped from the wire rather than sent as `null`. Keys are snake_case, matching the Go handler.
 * Locked by golden vectors shared with the C# port.
 */
public fun createShareBody(request: CreateShareRequest): JsonObject =
    buildJsonObject {
        request.title?.let { put("title", JsonPrimitive(it)) }
        request.description?.let { put("description", JsonPrimitive(it)) }
        request.includeSpeed?.let { put("include_speed", JsonPrimitive(it)) }
        request.includeTelemetry?.let { put("include_telemetry", JsonPrimitive(it)) }
        request.expiresInDays?.let { put("expires_in_days", JsonPrimitive(it)) }
    }

/**
 * Discriminates the two shapes of the public shared-drive payload exactly as the web hook's union
 * is resolved: the SI-canonical [SharedDriveData] always carries a `payload_version` key, while the
 * legacy [SharedDriveDataV1] never does. A present `payload_version` (whatever its value) ⇒
 * canonical; an absent one ⇒ legacy. A pure function of the raw object — locked by golden vectors so
 * the C# and KMP ports cannot drift (ADR-004).
 */
public fun sharedDriveIsCanonical(obj: JsonObject): Boolean = obj.containsKey("payload_version")

/**
 * `DeserializationStrategy` for the [SharedDrive] union, selecting the concrete shape by
 * [sharedDriveIsCanonical]. Used to decode the cached/fetched [JsonElement] into the typed model at
 * the read boundary; the raw element is what is actually cached (SI-preserving, like the
 * Push/Notification ports), so this strategy is only ever asked to deserialize.
 */
public object SharedDriveSerializer : JsonContentPolymorphicSerializer<SharedDrive>(SharedDrive::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<SharedDrive> =
        if (sharedDriveIsCanonical(element.jsonObject)) SharedDriveData.serializer() else SharedDriveDataV1.serializer()
}

/**
 * Per-entity staleness threshold for a drive's share-link list — the web `useShareLinks` has no
 * `staleTime`, so it defaults to 0 (every read is immediately stale and refetches). Passed verbatim
 * to the per-read `observe(key, ttl, fetch)`.
 */
public const val SHARE_LINKS_TTL_MILLIS: Long = 0L

/**
 * Per-entity staleness threshold for the public shared-drive report — the web `useSharedDrive`
 * `staleTime` (`STALE_TIMES.SLOW` = 5 minutes). Passed verbatim to the per-read `observe`.
 */
public const val SHARED_DRIVE_TTL_MILLIS: Long = 5 * 60_000L
