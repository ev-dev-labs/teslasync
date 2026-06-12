// The data ports the [PrivacySectionViewModel] binds to (P1/S8 state-holder seams) plus their production
// implementations. The web component reads three sources — a privacy-sensitive client-side recent-pages
// LRU (web/src/lib/recentPages.ts), the tri-state cookie-consent store (web/src/lib/cookieConsent.ts), and
// the server `require_cookie_consent` flag from `GET /system/version` (web `useVersionInfo`) — and mutates
// the first two. The native analogues are: two read+write client stores over the same on-device
// SharedPreferences the web keeps in `localStorage` (privacy-sensitive, never synced), and a read-only
// policy seam that folds the shared S8 [SettingsStore.versionInfo] feed down to the single boolean the
// surface needs. The view never touches storage or HTTP — it only collects the view-model.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PrivacySection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.privacy

import android.content.Context
import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

// ── Recent pages ─────────────────────────────────────────────────────────────

/**
 * The read+write port over the recent-pages LRU — the native analogue of the web `getRecentPages().length`
 * snapshot + `subscribeRecentPages()` subscription + `clearRecentPages()` mutator the section uses. A
 * narrow seam so the view-model depends on an abstraction (real persistence ↔ a test fake), never on a
 * concrete store or Android framework type.
 */
interface RecentPagesController {
    /** The recent-page entry count: the current value first, then a fresh value on every persisted change. */
    fun count(): Flow<Int>

    /** Wipes the recent-page list (web `clearRecentPages()`); the [count] feed re-emits `0`. */
    suspend fun clear()
}

/**
 * The production [RecentPagesController], backed by the client-side [SharedPreferences] the recent-pages
 * list is persisted in (the native counterpart of the web `localStorage` store — privacy-sensitive,
 * on-device only, never synced). It emits the decoded count immediately on collection and re-emits
 * whenever the stored value changes (the native analogue of the web same-tab + cross-tab change events),
 * counting through the pure [RecentPagesCounter]. Reads + the clear write run on [ioDispatcher] so the
 * first decode and the wipe never block the main thread. The prefs file/key match the sibling
 * Recently-Viewed surface, so a clear here empties the same list that widget reads.
 */
class SharedPreferencesRecentPagesController(
    context: Context,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : RecentPagesController {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PrivacyRegistration.RECENT_PAGES_PREFS, Context.MODE_PRIVATE)

    override fun count(): Flow<Int> =
        callbackFlow {
            fun emitCurrent() {
                trySend(RecentPagesCounter.count(prefs.getString(PrivacyRegistration.RECENT_PAGES_KEY, null)))
            }
            val listener =
                SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                    if (key == null || key == PrivacyRegistration.RECENT_PAGES_KEY) emitCurrent()
                }
            emitCurrent()
            prefs.registerOnSharedPreferenceChangeListener(listener)
            awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
        }.flowOn(ioDispatcher).conflate().distinctUntilChanged()

    override suspend fun clear() {
        withContext(ioDispatcher) {
            prefs.edit().remove(PrivacyRegistration.RECENT_PAGES_KEY).apply()
        }
    }
}

// ── Cookie / GDPR consent ─────────────────────────────────────────────────────

/**
 * The read+write port over the cookie/GDPR consent decision — the native analogue of the web
 * `getConsent()` + `subscribeConsent()` + `setConsent()`/`clearConsent()` helpers. A narrow seam so the
 * view-model depends on an abstraction (real persistence ↔ a test fake).
 */
interface CookieConsentStore {
    /** The consent state: the current value first, then a fresh value on every persisted change. */
    fun consent(): Flow<ConsentState>

    /**
     * Persists the consent decision: [ConsentState.Accepted]/[ConsentState.Declined] write their wire
     * literal (web `setConsent`); [ConsentState.Unknown] removes the key so the banner reappears (web
     * `clearConsent`). The [consent] feed re-emits the new value.
     */
    suspend fun set(state: ConsentState)
}

/**
 * The production [CookieConsentStore], backed by the client-side [SharedPreferences] the consent decision
 * is persisted in (the native counterpart of the web `localStorage` store — privacy-sensitive, on-device
 * only, never synced). It emits the decoded state immediately on collection and re-emits on every change
 * (the native analogue of the web same-tab `cookie-consent-changed` + cross-tab `storage` events),
 * decoding through the pure [ConsentState.fromWire]. The write runs on [ioDispatcher].
 */
class SharedPreferencesCookieConsentStore(
    context: Context,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : CookieConsentStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PrivacyRegistration.CONSENT_PREFS, Context.MODE_PRIVATE)

    override fun consent(): Flow<ConsentState> =
        callbackFlow {
            fun emitCurrent() {
                trySend(ConsentState.fromWire(prefs.getString(PrivacyRegistration.CONSENT_KEY, null)))
            }
            val listener =
                SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                    if (key == null || key == PrivacyRegistration.CONSENT_KEY) emitCurrent()
                }
            emitCurrent()
            prefs.registerOnSharedPreferenceChangeListener(listener)
            awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
        }.flowOn(ioDispatcher).conflate().distinctUntilChanged()

    override suspend fun set(state: ConsentState) {
        withContext(ioDispatcher) {
            val editor = prefs.edit()
            val wire = state.wire
            if (wire == null) editor.remove(PrivacyRegistration.CONSENT_KEY) else editor.putString(PrivacyRegistration.CONSENT_KEY, wire)
            editor.apply()
        }
    }
}

// ── Server consent policy (require_cookie_consent) ────────────────────────────

/**
 * The read-only port for the deployment-wide GDPR/ePrivacy flag — the native analogue of the web
 * `useVersionInfo()` query's `require_cookie_consent` field. A narrow seam (real S8 binding ↔ test fake)
 * that exposes only the single boolean the consent block needs, wrapped in a cache-then-network [Resource]
 * (ADR-013) so the surface's freshness chrome (stale / offline / error + retry) stays uniform with every
 * other data-backed surface.
 */
interface ConsentPolicySource {
    /** Whether the deployment requires cookie consent, as a cache-then-network feed (web `useVersionInfo`). */
    fun requireConsent(): Flow<Resource<Boolean>>

    /** Re-collect the version feed (web TanStack refetch). A no-op when the shared store owns the cadence. */
    suspend fun refresh()
}

/**
 * Binds the surface to the shared S8 [SettingsStore.versionInfo] feed — the production binding and the
 * honest native port of the web `useVersionInfo()` hook (both read `GET /system/version`). The
 * [VersionInfo] payload is folded down to its [VersionInfo.requireCookieConsent] flag (absent ⇒ `false`,
 * matching the web `Boolean(versionQuery.data?.require_cookie_consent)`), preserving the cache-then-network
 * freshness/error envelope unchanged. [refresh] is a no-op because the shared store owns the refetch
 * cadence (`SharingStarted.WhileSubscribed`); the retry affordance re-collects the shared feed.
 */
fun settingsStoreConsentPolicy(settingsStore: SettingsStore): ConsentPolicySource =
    object : ConsentPolicySource {
        override fun requireConsent(): Flow<Resource<Boolean>> =
            settingsStore.versionInfo().map { resource -> resource.mapRequireConsent() }

        override suspend fun refresh() = Unit
    }

/** Projects a [VersionInfo] [Resource] onto its `require_cookie_consent` boolean, preserving the envelope. */
private fun Resource<VersionInfo>.mapRequireConsent(): Resource<Boolean> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.requireConsentFlag(), fetchedAt, stale)
        is Resource.Success -> Resource.Success(data.requireConsentFlag(), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.requireConsentFlag(), fetchedAt, stale, error)
    }

private fun VersionInfo.requireConsentFlag(): Boolean = requireCookieConsent ?: false
