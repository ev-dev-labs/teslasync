package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.push.PushPublicKey
import io.teslasync.shared.core.presentation.push.PushSubscribeBody
import io.teslasync.shared.core.presentation.push.PushSubscription
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Web-Push subscription surface — the cross-platform analogue of the web
 * `usePush` hook domain (web/src/api/hooks/usePush.ts). Every native Push surface (Android/Apple
 * via KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a
 * single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013):
 *  - [publicKey] — `GET /push/public-key`, cached as the DERIVED [PushPublicKey] `{key}` wrapper
 *    (web `usePushPublicKey`): the server `publicKey` is empty-coalesced to `null` via
 *    [pushPublicKeyValue], and a 404 / "not configured" failure ([isPushUnconfigured]) is mapped to
 *    a successful `null` rather than a [Resource.Error] — the web hook's `retry: false` + catch
 *    contract. Cached under [pushPublicKeyKey] for `PUSH_PUBLIC_KEY_TTL_MILLIS` (web RARE / 1h).
 *  - [subscriptions] — `GET /push/subscribe`, the per-device list (web `usePushSubscriptions`),
 *    `safeArray`-guarded so it is always an array. Cached under [pushSubscriptionsKey] for
 *    `PUSH_SUBSCRIPTIONS_TTL_MILLIS` (web STANDARD / 60s).
 *
 * The two mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT
 * touch the durable cache and DO NOT invalidate anything here — invalidation is the S8 store's
 * targeted refresh of the subscription feed (the web `useSubscribePush` / `useUnsubscribePush`
 * mutations invalidate ONLY `pushKeys.list`, never the public key). Bodies are serialized to exact
 * JSON bytes for byte-for-byte parity with the web `JSON.stringify` payloads. Values are SI on the
 * wire (no unit-bearing fields here); display formatting is the render boundary's job (S5).
 */
public interface PushRepository {
    /**
     * `GET /push/public-key` — the derived VAPID public key (web `usePushPublicKey`). Resolves to
     * [PushPublicKey] with a non-empty `key`, or `key = null` when the server returned an empty key
     * OR web push is unconfigured (404 / "not configured"); the latter is a successful `null`, not
     * an error, exactly as the web `queryFn` returns `null` for a 404.
     */
    public fun publicKey(): Flow<Resource<PushPublicKey>>

    /**
     * `GET /push/subscribe` — every push subscription registered on this install (web
     * `usePushSubscriptions`, `safeArray`-guarded). Always resolves to an array (never null) so
     * consumers can iterate without a guard.
     */
    public fun subscriptions(): Flow<Resource<List<PushSubscription>>>

    /**
     * `POST /push/subscribe` with the browser `{ endpoint, keys: { p256dh, auth } }` body (web
     * `useSubscribePush`). Idempotent server-side — a repeat from the same browser updates the keys
     * in place. Returns the created/refreshed row (HTTP 201); on success the S8 store refreshes the
     * subscription feed (the web `invalidateQueries(pushKeys.list)`).
     */
    public suspend fun subscribe(body: PushSubscribeBody): Result<PushSubscription>

    /**
     * `DELETE /push/subscribe` with `{ endpoint }` (web `useUnsubscribePush`). Removes a single
     * subscription by endpoint; the server answers 204. On success the S8 store refreshes the
     * subscription feed (the web `invalidateQueries(pushKeys.list)`).
     */
    public suspend fun unsubscribe(endpoint: String): Result<Unit>
}

/**
 * Cache/feed key for the VAPID public key — the web `pushKeys.publicKey` (`['push','public-key']`).
 * Locked by golden vectors shared with the C# port.
 */
public fun pushPublicKeyKey(): String = "public-key"

/**
 * Cache/feed key for the subscription list — the web `pushKeys.list` (`['push','subscriptions']`).
 * Locked by golden vectors shared with the C# port.
 */
public fun pushSubscriptionsKey(): String = "subscriptions"

/**
 * Per-entity staleness threshold for the public key — the web `usePushPublicKey` `staleTime`
 * (`STALE_TIMES.RARE` = 1 hour). Passed verbatim to the per-read `observe(key, ttl, fetch)`.
 */
public const val PUSH_PUBLIC_KEY_TTL_MILLIS: Long = 60 * 60_000L

/**
 * Per-entity staleness threshold for the subscription list — the web `usePushSubscriptions`
 * `staleTime` (`STALE_TIMES.STANDARD` = 60s). Passed verbatim to the per-read `observe`.
 */
public const val PUSH_SUBSCRIPTIONS_TTL_MILLIS: Long = 60_000L

/**
 * The empty-coalescing derivation ported from the web `usePushPublicKey` `return res.publicKey ||
 * null`: a `null` OR empty server key collapses to `null`; any non-empty key passes through
 * verbatim. A pure function of its input — locked by golden vectors so the C# and KMP ports cannot
 * drift (ADR-004).
 */
public fun pushPublicKeyValue(raw: String?): String? = if (raw.isNullOrEmpty()) null else raw

/**
 * The "web push is unconfigured" classifier ported from the web `usePushPublicKey` catch guard
 * `/404|not configured/i.test(err.message)`: a 404 status OR a message/body matching `404` or
 * `not configured` (case-insensitive) means the install has no VAPID config and the read should
 * resolve to a `null` key rather than an error. A pure function of `(status, message)` — locked by
 * golden vectors so the C# and KMP ports cannot drift (ADR-004).
 */
public fun isPushUnconfigured(
    status: Int?,
    message: String?,
): Boolean {
    if (status == 404) return true
    val text = message ?: return false
    return PUSH_UNCONFIGURED_REGEX.containsMatchIn(text)
}

/**
 * Throwable overload of [isPushUnconfigured] used by the HTTP port: extracts the HTTP status from
 * an [ApiError.Http] and folds its `body` into the searched text (the web tests `err.message`,
 * which on a 404 carries the server's "web push is not configured on this install" copy).
 */
public fun isPushUnconfigured(error: Throwable): Boolean {
    val http = error as? ApiError.Http
    val text = listOfNotNull(error.message, http?.body).joinToString(" ")
    return isPushUnconfigured(http?.status, text)
}

private val PUSH_UNCONFIGURED_REGEX: Regex = Regex("404|not configured", RegexOption.IGNORE_CASE)
