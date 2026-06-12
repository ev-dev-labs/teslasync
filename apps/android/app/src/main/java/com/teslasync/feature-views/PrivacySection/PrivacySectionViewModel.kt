// UI-thread-free state holder backing the Privacy feature view — the native counterpart to the web
// component's hook composition (web/src/features/settings/components/PrivacySection.tsx). It binds the
// read+write client stores ([RecentPagesController], [CookieConsentStore]) and the read-only
// [ConsentPolicySource] (all P1/S8) and re-shares them as a single [PrivacyUiState] stream, exposes the
// four mutations (clear pages / accept / decline / reset) as one-shot toast [UiEvent]s, and records the
// PII-safe `view.opened` diagnostic. The view never performs HTTP or touches storage — it only collects
// [state], collects [events], and calls the action methods.
//
// The web source composes a synchronous recent-pages count + a synchronous consent tri-state (no
// network) with a single non-blocking `useVersionInfo` query whose only effect is selecting which
// descriptive sentence the consent block shows. The native holder mirrors that exactly: the two client
// feeds drive the always-present panel content, and the version feed is folded in as a cache-then-network
// [UiState] so its freshness / offline / error chrome can render WITHOUT ever hiding the panel (web
// parity: a missing version response falls back to `requireConsent = false`). A brief [Loading] frame
// precedes the first client-store resolution — the one honest native-idiomatic addition, since the native
// stores read persistence off the main thread.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PrivacySection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.privacy

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The mutually-exclusive surface the Privacy view renders. [Loading] is the pre-resolution frame while
 * the client stores are first read; [Content] carries the resolved [PrivacySnapshot] (recent-page count +
 * consent tri-state + the resolved `require_cookie_consent` flag) plus the [version] cache-then-network
 * envelope that drives the consent block's freshness / offline / error chrome (never a blanking gate).
 */
sealed interface PrivacyUiState {
    /** First read of the client stores is in flight — render skeleton chrome under the stable header. */
    data object Loading : PrivacyUiState

    /** The stores resolved — render the full panel from [snapshot], with [version] freshness chrome. */
    data class Content(
        val snapshot: PrivacySnapshot,
        val version: UiState<Boolean>,
    ) : PrivacyUiState
}

/**
 * Lifecycle-aware state holder backing the Compose [PrivacySection]. It consumes the injected client
 * stores + the version-policy seam (P1/S8) and re-shares them as a single [PrivacyUiState] stream, exposes
 * the four mutations as one-shot toast [UiEvent.Message]s, and emits the PII-safe `view.opened`
 * diagnostic. It owns no networking and no storage access.
 *
 * @param recentPages the read+write recent-pages seam (SharedPreferences-backed in production, a fake in
 *   tests). [clearRecentPages] wipes it; [state] reflects its live count.
 * @param consentStore the read+write cookie-consent seam; [acceptConsent]/[declineConsent]/[resetConsent]
 *   mutate it; [state] reflects its live tri-state.
 * @param policy the read-only `require_cookie_consent` seam (the shared [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   version feed in production); folded into [state] as a cache-then-network [UiState].
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened` + refresh.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PrivacySectionViewModel(
    private val recentPages: RecentPagesController,
    private val consentStore: CookieConsentStore,
    private val policy: ConsentPolicySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val restart = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The Privacy surface as UI state: [PrivacyUiState.Loading] until the client stores first resolve,
     * then [PrivacyUiState.Content] folding the live recent-page count, the live consent tri-state, and
     * the version feed's resolved flag + freshness envelope. Collected only while observed
     * (`WhileSubscribed`). The version feed is never an empty surface (a boolean is never "empty"), so it
     * only ever contributes Content / stale / offline / error chrome — never a blanking gate.
     */
    val state: StateFlow<PrivacyUiState> =
        combine(
            recentPages.count(),
            consentStore.consent(),
            restart.flatMapLatest { policy.requireConsent() }.map { resource -> resource.toUiState { false } },
        ) { count, consent, version ->
            PrivacyUiState.Content(
                snapshot =
                    PrivacySnapshot(
                        recentCount = count.coerceAtLeast(0),
                        consent = consent,
                        requireConsent = version.data ?: false,
                    ),
                version = version,
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = PrivacyUiState.Loading,
        )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. The surface's values (recent-page count, consent decision) are privacy-sensitive, so the
     * diagnostic carries nothing beyond the slug. Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PrivacyRegistration.SLUG))
    }

    /** Wipes the recent-pages list, then surfaces the success toast (web `handleConfirm`). */
    fun clearRecentPages() {
        launch {
            recentPages.clear()
            emitEvent(UiEvent.Message(MESSAGE_CLEARED, severity = UiEvent.Severity.Success))
        }
    }

    /** Grants consent, then surfaces the success toast (web `handleAcceptConsent`). */
    fun acceptConsent() {
        launch {
            consentStore.set(ConsentState.Accepted)
            emitEvent(UiEvent.Message(MESSAGE_ACCEPTED, severity = UiEvent.Severity.Success))
        }
    }

    /** Withdraws consent, then surfaces the success toast (web `handleDeclineConsent`). */
    fun declineConsent() {
        launch {
            consentStore.set(ConsentState.Declined)
            emitEvent(UiEvent.Message(MESSAGE_DECLINED, severity = UiEvent.Severity.Success))
        }
    }

    /** Resets consent to unknown so the banner reappears, then surfaces the toast (web `handleResetConsent`). */
    fun resetConsent() {
        launch {
            consentStore.set(ConsentState.Unknown)
            emitEvent(UiEvent.Message(MESSAGE_RESET, severity = UiEvent.Severity.Success))
        }
    }

    /** Re-collects the version feed — backs the freshness/offline retry affordance (web TanStack refetch). */
    fun refreshVersion() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to PrivacyRegistration.SLUG))
        restart.update { it + 1 }
        launch { policy.refresh() }
    }

    companion object {
        /** Toast i18n key for a completed recent-pages clear (web `recentPages.cleared`). */
        const val MESSAGE_CLEARED = "recentPages.cleared"

        /** Toast i18n key for granted consent (web `consent.toast.accepted`). */
        const val MESSAGE_ACCEPTED = "consent.toast.accepted"

        /** Toast i18n key for withdrawn consent (web `consent.toast.declined`). */
        const val MESSAGE_DECLINED = "consent.toast.declined"

        /** Toast i18n key for reset consent (web `consent.toast.reset`). */
        const val MESSAGE_RESET = "consent.toast.reset"

        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "privacy.version.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            recentPages: RecentPagesController,
            consentStore: CookieConsentStore,
            policy: ConsentPolicySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PrivacySectionViewModel(recentPages, consentStore, policy, logger) }
            }
    }
}
