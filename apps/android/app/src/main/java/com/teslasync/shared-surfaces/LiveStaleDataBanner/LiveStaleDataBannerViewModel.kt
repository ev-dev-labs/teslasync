// UI-thread-free state holder backing the LiveStaleDataBanner — the native port of the web component's
// `useLiveConnection` + `disconnectedSinceRef` derivation (web/src/components/feedback/LiveStaleDataBanner.tsx).
// It binds the app-scoped live pipeline (P1/S8) through [LiveStaleDataBannerSource] and re-shares the folded,
// PII-free [StaleBannerState] as a lifecycle-aware flow the composable renders, plus the one-shot PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LiveStaleDataBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livestaledatabanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `LiveStaleDataBanner` — the Android port of the web `LiveStaleDataBanner` over
 * a `useLiveConnection()` result.
 *
 * It re-collects the injected [source]'s lifecycle-aware wire-health feed (the P1/S8 boundary) and folds it into
 * the PII-free [StaleBannerState] — stamping the disconnection clock the first instant the wire is observed
 * disconnected (the web `disconnectedSinceRef`) and clearing it on any recovery — then re-shares it as a
 * lifecycle-aware [state] flow. The state carries only the wire status and that one clock, never any vehicle id
 * or signals.
 *
 * [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the live wire-health seam (a shared-live-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only folds the feed's wire health.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param clock the wall-clock source used to stamp the disconnection time; production uses the system clock, tests
 *   inject a deterministic one so the fold is verified off-device.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class LiveStaleDataBannerViewModel(
    source: LiveStaleDataBannerSource,
    logger: Logger,
    private val clock: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The folded wire health as a lifecycle-aware [StaleBannerState], carrying the status and the disconnection
     * stamp without any signals. Collected only while the banner is on-screen ([SharingStarted.WhileSubscribed]);
     * the initial value is the cold-start hidden seed so the first frame never flashes the banner.
     */
    val state: StateFlow<StaleBannerState> =
        source
            .status()
            .scan(StaleBannerState.initial()) { prev, status ->
                LiveStaleDataBannerProjection.fold(prev, status, clock())
            }.stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = StaleBannerState.initial(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / connection payload, so a diagnostics line can never leak which session the user was
     * viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        LiveStaleDataBannerDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LiveStaleDataBannerSource,
            logger: Logger,
            clock: () -> Long = { System.currentTimeMillis() },
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LiveStaleDataBannerViewModel(source, logger, clock) }
            }
    }
}
