package io.teslasync.shared.core.presentation.push

import io.teslasync.shared.core.data.repo.PushRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Web-Push subscription surface — the cross-platform port of
 * the web `usePush` hook domain (web/src/api/hooks/usePush.ts). Every native Push screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the public-key derivation, or the invalidation rules.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 *  - [publicKey] mirrors the web `usePushPublicKey` — the derived VAPID key (a non-empty key, or
 *    `null` for an empty key / unconfigured install). It has NO invalidation trigger: the web
 *    mutations never invalidate `pushKeys.publicKey`, so neither does this feed.
 *  - [subscriptions] mirrors the web `usePushSubscriptions` — the per-device list, always an array.
 *    It is the single feed the mutations refresh.
 *
 * Each feed is lazily created on first access and shared so every observer folds into one upstream
 * collection ([SharingStarted.WhileSubscribed]).
 *
 * The two mutations are non-throwing suspend [Result]s; on success they refresh ONLY the
 * subscription feed ([refreshSubscriptions]), exactly as the web `useSubscribePush` /
 * `useUnsubscribePush` mutations invalidate ONLY `pushKeys.list`. A failed mutation refreshes
 * nothing (the web `onError` skips invalidation). Toasts and the browser PushManager/service-worker
 * lifecycle are render-layer concerns (web `useWebPush.ts`) and are intentionally NOT reproduced
 * here. A feed nobody is observing is a no-op to refresh.
 *
 * The holder makes no network calls itself — it delegates entirely to the injected
 * [PushRepository] (S7). It mirrors the web hook's single-threaded usage and is not internally
 * synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class PushStore(
    private val repo: PushRepository,
    private val scope: CoroutineScope,
) {
    private val subscriptionsTrigger: MutableStateFlow<Int> = MutableStateFlow(0)
    private var publicKeyFeed: StateFlow<Resource<PushPublicKey>>? = null
    private var subscriptionsFeed: StateFlow<Resource<List<PushSubscription>>>? = null

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared `GET /push/public-key` feed — the derived [PushPublicKey] (web `usePushPublicKey`).
     * Lazily created and shared; it carries no invalidation trigger because the web mutations never
     * invalidate the public-key query.
     */
    public fun publicKey(): StateFlow<Resource<PushPublicKey>> =
        publicKeyFeed ?: repo
            .publicKey()
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = PUBLIC_KEY_INITIAL,
            ).also { publicKeyFeed = it }

    /**
     * Shared, refreshable `GET /push/subscribe` feed — the per-device subscription list (web
     * `usePushSubscriptions`). Lazily created and shared; bumping [subscriptionsTrigger] (via
     * [refreshSubscriptions]) restarts its cache-then-network collection.
     */
    public fun subscriptions(): StateFlow<Resource<List<PushSubscription>>> =
        subscriptionsFeed ?: subscriptionsTrigger
            .flatMapLatest { repo.subscriptions() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SUBSCRIPTIONS_INITIAL,
            ).also { subscriptionsFeed = it }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Registers or refreshes a browser subscription on the server (web `useSubscribePush`). On
     * success the subscription feed is refreshed (the web `invalidateQueries(pushKeys.list)`); on
     * failure nothing is refreshed.
     */
    public suspend fun subscribe(body: PushSubscribeBody): Result<PushSubscription> =
        repo.subscribe(body).onSuccess { refreshSubscriptions() }

    /**
     * Removes a single subscription by endpoint (web `useUnsubscribePush`). On success the
     * subscription feed is refreshed (the web `invalidateQueries(pushKeys.list)`); on failure
     * nothing is refreshed.
     */
    public suspend fun unsubscribe(endpoint: String): Result<Unit> = repo.unsubscribe(endpoint).onSuccess { refreshSubscriptions() }

    // ---- Actions ------------------------------------------------------------------

    /**
     * Re-fetches the subscription feed — the holder-side analogue of invalidating `pushKeys.list`.
     * A no-op when nobody is observing the feed.
     */
    public fun refreshSubscriptions() {
        subscriptionsTrigger.update { it + 1 }
    }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val PUBLIC_KEY_INITIAL: Resource<PushPublicKey> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val SUBSCRIPTIONS_INITIAL: Resource<List<PushSubscription>> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
