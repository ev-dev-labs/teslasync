// UI-thread-free state holder backing the OfflineBanner surface — the native port of the read behind the web
// component (web/src/components/feedback/OfflineBanner.tsx: the `useOnlineStatus()` subscription). It binds the
// app-scoped live pipeline (P1/S8, ADR-009) through [OfflineBannerSource] and re-shares each PII-free
// [OfflineBannerSnapshot] as a lifecycle-aware flow the composable renders, exposes the banner's [reconnect]
// retry affordance, and emits the one-shot PII-safe `view.opened` diagnostic. The view never performs HTTP — it
// only collects [snapshot] and calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.offlinebanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `OfflineBanner` surface — the Android port of the web `OfflineBanner` over the
 * app-global service-reachability signal.
 *
 * It re-collects the injected [source]'s lifecycle-aware wire-health feed (the P1/S8 boundary) and re-shares the
 * PII-free [OfflineBannerSnapshot] as a lifecycle-aware [snapshot] flow — so the surface reflects the latest wire
 * health without owning any state itself. The snapshot carries only the connection status, never any vehicle id
 * or signals. [reconnect] forwards the banner's retry to the live layer, and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open.
 *
 * @param source the live wire-health seam (a shared-live-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only projects the feed's wire status and nudges its reconnect.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` / reconnect events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class OfflineBannerViewModel(
    private val source: OfflineBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The live pipeline's wire health as a lifecycle-aware [OfflineBannerSnapshot], carrying the connection
     * status without any signals. Collected only while the surface is on-screen
     * ([SharingStarted.WhileSubscribed]); the initial value is the cold-start `unknown` snapshot (which projects
     * to the dormant online phase) so the first frame is never a premature "offline" banner.
     */
    val snapshot: StateFlow<OfflineBannerSnapshot> =
        source
            .connection()
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = OfflineBannerSnapshot.unknown(),
            )

    /**
     * Forces a fresh connection now (the banner's retry affordance). Logs a PII-safe, slug-only event and
     * forwards to the live layer's reconnect; a no-op effect while the stream is gated closed.
     */
    fun reconnect() {
        logger.info(EVENT_RECONNECT, mapOf(FIELD_SURFACE to OfflineBannerRegistration.SLUG))
        source.reconnect()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / connection payload, so a diagnostics line can never leak which session the user was
     * viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordOfflineBannerOpened(logger)
    }

    companion object {
        private const val EVENT_RECONNECT = "offlineBanner.reconnect"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: OfflineBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { OfflineBannerViewModel(source, logger) }
            }
    }
}
