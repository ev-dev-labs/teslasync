// UI-thread-free state holder backing the CookieConsentBanner surface — the native port of the reads + actions
// behind the web component (web/src/components/feedback/CookieConsentBanner.tsx). It binds the shared Settings
// feed (P1/S8) + the local consent store through [CookieConsentBannerSource] and exposes:
//   • [requirement] — the deployment gate `require_cookie_consent` as cache-then-network [UiState] (loading /
//     content / stale / offline / error), the leg that raises the surface's loading + error states;
//   • [consent] — the per-user decision as a hot flow (web `getConsent` + the `cookie-consent-changed`
//     re-render);
//   • [accept] / [decline] — persist the explicit decision (web `setConsent`), flipping the surface to the
//     recorded-state panel;
//   • [refresh] — re-collect the requirement feed (the error-retry / stale auto-refresh affordance);
//   • [recordViewOpened] — the one-shot PII-safe `view.opened` diagnostic (P1/S11).
// The view never performs HTTP and never touches persistence — it only collects the two flows and calls the
// actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CookieConsentBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `CookieConsentBanner` surface — the Android port of the web
 * `CookieConsentBanner`'s `useVersionInfo` + `getConsent`/`setConsent` composition.
 *
 * The deployment gate is projected onto a lifecycle-aware [requirement] [UiState] (collected only while the
 * surface is on-screen), and the per-user decision is re-published as the hot [consent] flow. [accept] /
 * [decline] persist the decision through the source (web `setConsent`) and log a PII-safe, slug-only action
 * event; [refresh] re-collects the requirement feed (the error-retry + stale auto-refresh affordance), and
 * [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open. The view-model owns no
 * networking and no persistence — it only projects the source's feeds and forwards the surface's actions.
 *
 * @param source the requirement + consent seam (a shared-Settings + SharedPreferences adapter in production, a
 *   fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CookieConsentBannerViewModel(
    private val source: CookieConsentBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network requirement feed (the manual refetch affordance),
    // exactly as the dashboard VersionInfoWidget re-collects the shared Settings feed it shares with this surface.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The deployment gate as cache-then-network UI state (loading / content / stale / offline / error). A
     * boolean gate is never structurally empty, so the empty phase never arises here — the surface's own
     * "resolved" panel (consent off / already decided) is a render-layer concept folded in by the projection,
     * not a UiState.Empty.
     */
    val requirement: StateFlow<UiState<Boolean>> =
        refreshTrigger
            .flatMapLatest { source.consentRequirement() }
            .asUiState(isEmpty = { false })

    /**
     * The per-user consent decision (web `getConsent`), re-emitting after [accept] / [decline] so the surface
     * flips from the active prompt to the recorded-state panel. Owned by the source's local store; the
     * view-model only re-publishes it.
     */
    val consent: StateFlow<ConsentDecision> = source.consent()

    /** Web `setConsent('accepted')`: persist the accept and log a PII-safe, slug-only action event. */
    fun accept() {
        logger.info(EVENT_ACCEPT, mapOf(FIELD_SURFACE to CookieConsentBannerRegistration.SLUG))
        source.setConsent(ConsentDecision.Accepted)
    }

    /** Web `setConsent('declined')`: persist the decline and log a PII-safe, slug-only action event. */
    fun decline() {
        logger.info(EVENT_DECLINE, mapOf(FIELD_SURFACE to CookieConsentBannerRegistration.SLUG))
        source.setConsent(ConsentDecision.Declined)
    }

    /**
     * Re-collects the cache-then-network requirement feed — the hard-error surface's retry and the stale
     * surface's auto-refresh. Because the shared Settings feed is collected with `WhileSubscribed`, this restarts
     * a cache-then-network fetch when the shared upstream had gone idle and replays the last-known requirement
     * otherwise (the same affordance the dashboard VersionInfoWidget exposes over this feed). Logs a PII-safe,
     * slug-only event.
     */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to CookieConsentBannerRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no consent decision and no deployment detail, so a diagnostics line can never leak the user's
     * privacy posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCookieConsentOpened(logger)
    }

    companion object {
        private const val EVENT_ACCEPT = "cookieConsent.accept"
        private const val EVENT_DECLINE = "cookieConsent.decline"
        private const val EVENT_REFRESH = "cookieConsent.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: CookieConsentBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CookieConsentBannerViewModel(source, logger) }
            }
    }
}
