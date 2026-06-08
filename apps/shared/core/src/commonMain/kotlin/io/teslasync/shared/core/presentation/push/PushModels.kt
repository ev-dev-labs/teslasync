package io.teslasync.shared.core.presentation.push

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The cross-platform port of the web Push domain types (web/src/api/types.ts:
 * PushSubscriptionRow + PushSubscribeBody). Every native Push screen (Android/Apple via KMP,
 * Windows via the C# port) binds to these shapes through the S7
 * io.teslasync.shared.core.data.repo.PushRepository and the S8 PushStore.
 *
 * Keys arrive snake_case from `GET /api/v1/push/subscribe`; they are matched verbatim via
 * SerialName so the cached payload round-trips unchanged. No field is unit-bearing, so there is
 * no SI conversion at this layer — display formatting is the render boundary's job (S5).
 */

/**
 * One row of the `push_subscriptions` table — the port of the web `PushSubscriptionRow`
 * (web/src/api/types.ts), itself mirroring the Go `models.PushSubscription` struct
 * (internal/models/push_subscription.go). Returned by `GET /push/subscribe` (a list) and by
 * `POST /push/subscribe` (the single upserted row, HTTP 201).
 *
 * [userId] is null on a single-user install, [userAgent] is null when the subscribing browser
 * sent no `User-Agent`, and [lastUsedAt] is null until the first successful push delivery; every
 * optional server field defaults so a partial payload still decodes (the cache's
 * `ignoreUnknownKeys` + `explicitNulls = false`).
 */
@Serializable
public data class PushSubscription(
    val id: Long,
    @SerialName("user_id") val userId: Long? = null,
    val endpoint: String = "",
    val p256dh: String = "",
    val auth: String = "",
    @SerialName("user_agent") val userAgent: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("last_used_at") val lastUsedAt: String? = null,
)

/**
 * The browser `PushSubscription.toJSON()` shape — the `POST /push/subscribe` request body, ported
 * from the web `PushSubscribeBody` (web/src/api/types.ts). The server reads `endpoint` plus the
 * nested `keys.p256dh` / `keys.auth` (see `pushSubscribeRequest` in internal/api/push/handler.go).
 * Serialized verbatim (byte-for-byte with the web `JSON.stringify(body)`) by the S7 port.
 */
@Serializable
public data class PushSubscribeBody(
    val endpoint: String,
    val keys: PushSubscribeKeys,
)

/** The nested `keys` object of [PushSubscribeBody] — the P-256 ECDH public key and auth secret. */
@Serializable
public data class PushSubscribeKeys(
    val p256dh: String,
    val auth: String,
)

/**
 * The derived VAPID public-key read-model — the port of the web `usePushPublicKey` return value.
 * The web hook resolves `res.publicKey || null` and maps a 404 / "not configured" failure to the
 * SAME `null`, so the UI cannot tell "loading" from "unconfigured" by the value alone. [key] is
 * therefore the already-derived value: a non-empty server key, or `null` when the server returned
 * an empty key OR web push is not configured on this install. Cached as `{key}` so the
 * unconfigured `null` round-trips through the durable cache exactly like a real key.
 */
@Serializable
public data class PushPublicKey(
    val key: String? = null,
)
