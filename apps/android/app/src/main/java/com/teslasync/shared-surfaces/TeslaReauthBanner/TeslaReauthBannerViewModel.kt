// UI-thread-free state holder backing the TeslaReauthBanner surface — the native port of the local `visible` state and
// the two event handlers behind the web component (web/src/components/feedback/TeslaReauthBanner.tsx). It binds the
// app-scoped Tesla-grant signal bus (P1/S8) through [TeslaReauthBannerSource], folds each [TeslaReauthEvent] onto a
// lifecycle-aware [visible] flag via the pure [TeslaReauthBannerProjection], fires the recovery mutation drain (web
// `drainQueuedTeslaMutations`), exposes the [dismiss] / [reconnect] actions, and emits the one-shot PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [visible] and calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslareauthbanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose `TeslaReauthBanner` surface — the Android port of the web component's local
 * `visible` state machine over the app-global Tesla-grant signal bus.
 *
 * It collects the injected [source]'s hot event stream (the P1/S8 boundary) for the surface's lifetime and folds each
 * [TeslaReauthEvent] onto the lifecycle-aware [visible] flag through the pure [TeslaReauthBannerProjection], so the
 * surface reflects the latest grant signal without owning any networking. A [TeslaReauthEvent.Recovered] additionally
 * fires the best-effort mutation [drain][TeslaReauthBannerSource.drainQueuedMutations] (web `drainQueuedTeslaMutations`).
 * [dismiss] hides the banner locally (no recovery, no drain — web's X button), [reconnect] records the CTA
 * diagnostic (navigation is the view's concern, web `useNavigate`), and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open.
 *
 * @param source the grant-signal seam (a [TeslaReauthBus] adapter in production, a fake in tests). The view-model
 *   owns no networking — it only folds the stream and forwards the recovery drain.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the slug-only lifecycle events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class TeslaReauthBannerViewModel(
    private val source: TeslaReauthBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val mutableVisible = MutableStateFlow(false)

    /**
     * Whether the warning banner is shown — the native mirror of the web `visible` state. Seeded hidden (web
     * `useState(false)` / `if (!visible) return null`), flipped true by a [TeslaReauthEvent.Expired] and false by a
     * [TeslaReauthEvent.Recovered] or a [dismiss].
     */
    val visible: StateFlow<Boolean> = mutableVisible.asStateFlow()

    init {
        launch {
            source.events().collect(::onEvent)
        }
    }

    private suspend fun onEvent(event: TeslaReauthEvent) {
        mutableVisible.value = TeslaReauthBannerProjection.visibilityAfter(event)
        logger.info(eventName(event), slugFields())
        if (event == TeslaReauthEvent.Recovered) {
            // Best-effort replay; each closure surfaces its own error through its normal path (web comment).
            source.drainQueuedMutations()
        }
    }

    /**
     * Hides the banner locally without signalling recovery or replaying mutations — the web X button
     * (`setVisible(false)`). A subsequent [TeslaReauthEvent.Expired] re-shows it, matching the web.
     */
    fun dismiss() {
        mutableVisible.value = false
        logger.info(EVENT_DISMISS, slugFields())
    }

    /**
     * Records the reconnect CTA diagnostic (slug only). The actual navigation to the Tesla account screen is the
     * view's concern (web `useNavigate('/tesla-account')`), wired by the host through the surface's `onReconnect`.
     */
    fun reconnect() {
        logger.info(EVENT_RECONNECT, slugFields())
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / token / mutation payload, so a diagnostics line can never leak a user's session. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaReauthBannerOpened(logger)
    }

    private fun slugFields(): Map<String, String> = mapOf(FIELD_SURFACE to TeslaReauthBannerRegistration.SLUG)

    private fun eventName(event: TeslaReauthEvent): String =
        when (event) {
            TeslaReauthEvent.Expired -> EVENT_EXPIRED
            TeslaReauthEvent.Recovered -> EVENT_RECOVERED
        }

    companion object {
        private const val EVENT_EXPIRED = "teslaReauthBanner.expired"
        private const val EVENT_RECOVERED = "teslaReauthBanner.recovered"
        private const val EVENT_RECONNECT = "teslaReauthBanner.reconnect"
        private const val EVENT_DISMISS = "teslaReauthBanner.dismiss"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TeslaReauthBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TeslaReauthBannerViewModel(source, logger) }
            }
    }
}
