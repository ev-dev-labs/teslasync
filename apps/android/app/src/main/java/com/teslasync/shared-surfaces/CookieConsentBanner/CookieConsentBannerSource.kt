// The data port the CookieConsentBanner shared surface binds to — the native analogue of the two web inputs the
// component composes (web/src/components/feedback/CookieConsentBanner.tsx): `useVersionInfo().require_cookie_consent`
// (GET /system/version, the deployment GDPR gate) and the localStorage tri-state read by web/src/lib/cookieConsent.ts
// (`getConsent` / `setConsent`). The view never performs HTTP and never touches persistence directly; a concrete
// adapter over the shared S7/S8 Settings layer + an Android SharedPreferences store (or a test fake) drives this
// seam (the P1/S8 boundary, ADR-002).
//
// The requirement leg preserves the cache-then-network freshness contract end to end (ADR-013): each
// `versionInfo()` emission is projected onto a `Resource<Boolean>` carrying the same Loading/Success/Error +
// cached/stale flags, so the ViewModel can surface loading / content / stale / offline / error honestly. The
// consent leg is SYNCHRONOUS local state (a SharedPreferences flag, the web localStorage analogue) modelled — like
// the sibling TourLauncher surface — as a hot [StateFlow] that re-emits after a [CookieConsentStore.setConsent]
// write, so the surface flips from the active prompt to the recorded-state panel the instant the user decides.
//
// The persistence is split behind a tiny [ConsentPersistence] port so the store's read/decode/write logic is
// verified off-device with an in-memory fake (the JVM unit gate cannot exercise real `SharedPreferences`); the
// production binding wraps Android [SharedPreferences].
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/CookieConsentBanner) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located ports + adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map

/** SharedPreferences file name backing the per-user consent decision (the web localStorage analogue). */
const val COOKIE_CONSENT_PREFS_NAME: String = "teslasync.consent"

/**
 * The single seam the [CookieConsentBannerViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store, repository, or `SharedPreferences`. [consentRequirement] is the cold,
 * cache-then-network deployment-gate feed (web `useVersionInfo`); [consent] is the hot per-user decision (web
 * `getConsent`, re-emitting after [setConsent]); [setConsent] persists an explicit decision (web `setConsent`).
 * No HTTP touches the view.
 */
interface CookieConsentBannerSource {
    /**
     * The deployment GDPR gate as a cache-then-network `Resource<Boolean>` (web `useVersionInfo`'s
     * `require_cookie_consent` ?? false). Collecting it opens the shared Settings feed; the Loading/Success/Error
     * + cached/stale flags flow through unchanged so the surface renders loading / content / stale / offline /
     * error.
     */
    fun consentRequirement(): Flow<Resource<Boolean>>

    /** The current per-user consent decision as a hot flow; re-emits after [setConsent] (web `getConsent`). */
    fun consent(): StateFlow<ConsentDecision>

    /** Persists an explicit [decision] and re-emits it on [consent] (web `setConsent('accepted'|'declined')`). */
    fun setConsent(decision: ConsentDecision)
}

/**
 * The minimal key/value persistence the [CookieConsentStore] needs — a tiny port over the platform store so the
 * store's read/decode/write logic is verified off-device with an in-memory fake. Only the single consent entry
 * is surfaced; [read] returns its raw stored string (or `null` when absent — the web "unknown" state), and
 * [write] persists `"accepted"`/`"declined"` or removes the entry when handed `null` (web `clearConsent`).
 */
interface ConsentPersistence {
    /** The raw stored consent value (web `localStorage.getItem(CONSENT_STORAGE_KEY)`), or `null` when absent. */
    fun read(): String?

    /** Persist [value] (web `localStorage.setItem`), or remove the entry when `null` (web `localStorage.removeItem`). */
    fun write(value: String?)
}

/**
 * Android [SharedPreferences]-backed [ConsentPersistence]. A thin, side-effect-only adapter: it never holds
 * derived state (the store owns the projected decision), so all interesting logic stays in the off-device-tested
 * store + model. Mirrors the web helper's resilience contract — a `null` write removes the key so the next read
 * collapses to the "unknown" state.
 */
class SharedPreferencesConsentPersistence(
    private val prefs: SharedPreferences,
) : ConsentPersistence {
    override fun read(): String? = prefs.getString(CONSENT_STORAGE_KEY, null)

    override fun write(value: String?) {
        val editor = prefs.edit()
        if (value == null) {
            editor.remove(CONSENT_STORAGE_KEY)
        } else {
            editor.putString(CONSENT_STORAGE_KEY, value)
        }
        editor.apply()
    }
}

/**
 * The shared per-user consent state holder — the native port of the web `cookieConsent.ts` localStorage layer.
 * It decodes the raw persisted value onto a [ConsentDecision] (via the off-device-tested
 * [ConsentDecision.fromStored]) and exposes it as a hot [StateFlow] so every observing surface re-renders
 * together; [setConsent] persists the decision and re-projects, and [refresh] re-reads persistence so a decision
 * written elsewhere (e.g. a Settings → Privacy reset) surfaces when the banner re-opens. No HTTP — the data is
 * entirely local.
 */
class CookieConsentStore(
    private val persistence: ConsentPersistence,
) {
    private val state = MutableStateFlow(read())

    /** The current decision as a hot flow; re-emits after [setConsent] / [refresh]. */
    fun consent(): StateFlow<ConsentDecision> = state.asStateFlow()

    /** Web `setConsent`: persist the explicit [decision] and re-project the live snapshot. */
    fun setConsent(decision: ConsentDecision) {
        persistence.write(decision.stored)
        state.value = decision
    }

    /** Re-read the decision from persistence (web re-render on the `cookie-consent-changed` event). */
    fun refresh() {
        state.value = read()
    }

    private fun read(): ConsentDecision = ConsentDecision.fromStored(persistence.read())
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] (the requirement leg) + a [CookieConsentStore] (the
 * consent leg) — the production wiring the composable's default source uses. The `versionInfo()` envelope's
 * `require_cookie_consent` is projected to a `Resource<Boolean>` preserving every freshness flag, and the
 * consent decision + write are delegated to the local store. No HTTP touches the view.
 */
fun SettingsStore.asCookieConsentBannerSource(consentStore: CookieConsentStore): CookieConsentBannerSource {
    val settingsStore = this
    return object : CookieConsentBannerSource {
        override fun consentRequirement(): Flow<Resource<Boolean>> = settingsStore.versionInfo().map { it.mapRequireConsent() }

        override fun consent(): StateFlow<ConsentDecision> = consentStore.consent()

        override fun setConsent(decision: ConsentDecision) = consentStore.setConsent(decision)
    }
}

/**
 * Builds a [CookieConsentStore] over Android [SharedPreferences] — the production persistence wiring the
 * composable's `rememberCookieConsentBannerSource` uses; tests inject an in-memory [ConsentPersistence] fake
 * instead.
 */
fun bindCookieConsentStore(prefs: SharedPreferences): CookieConsentStore = CookieConsentStore(SharedPreferencesConsentPersistence(prefs))

/**
 * Builds a [CookieConsentBannerSource] from a requirement-[feed] provider + a [CookieConsentStore] — the test
 * double used to drive each requirement state deterministically while exercising the real consent store/model.
 * Mirrors the contract of the production [asCookieConsentBannerSource] binding.
 */
fun cookieConsentBannerSource(
    consentStore: CookieConsentStore,
    feed: () -> Flow<Resource<Boolean>>,
): CookieConsentBannerSource =
    object : CookieConsentBannerSource {
        override fun consentRequirement(): Flow<Resource<Boolean>> = feed()

        override fun consent(): StateFlow<ConsentDecision> = consentStore.consent()

        override fun setConsent(decision: ConsentDecision) = consentStore.setConsent(decision)
    }

/**
 * Projects a `Resource<VersionInfo>` (web `useVersionInfo`) onto the `Resource<Boolean>` deployment gate,
 * preserving every Loading/Success/Error + cached/stale flag so the requirement's freshness lifecycle reaches
 * the surface unchanged. A missing `require_cookie_consent` collapses to `false` — the self-hosted default where
 * there is no banner (web `Boolean(versionQuery.data?.require_cookie_consent)`). `internal` so the off-device
 * unit gate exercises the adapter mapping directly.
 */
internal fun Resource<VersionInfo>.mapRequireConsent(): Resource<Boolean> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = cached?.requireConsentFlag(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Success ->
            Resource.Success(data = data.requireConsentFlag(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error ->
            Resource.Error(cached = cached?.requireConsentFlag(), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/** Web `Boolean(version.require_cookie_consent)` — a missing flag is the self-hosted "no banner" default. */
internal fun VersionInfo.requireConsentFlag(): Boolean = requireCookieConsent ?: false
