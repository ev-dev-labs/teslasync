// UI-thread-free state holder backing the TimeMachineBanner surface — the native port of the read/write behind the
// web component (web/src/components/feedback/TimeMachineBanner.tsx: the `useAsOfDate` subscription). It binds the
// app-global as-of holder (P1/S8) through [TimeMachineBannerSource] and re-shares each PII-free
// [TimeMachineBannerSnapshot] as a lifecycle-aware flow the composable renders, exposes the banner's [setAsOf] /
// [returnToLive] write affordances, and emits the one-shot PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [snapshot] and calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TimeMachineBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

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
 * State holder backing the Compose `TimeMachineBanner` surface — the Android port of the web `TimeMachineBanner`
 * over the app-global point-in-time anchor.
 *
 * It re-collects the injected [source]'s as-of feed (the P1/S8 boundary) and re-shares the PII-free
 * [TimeMachineBannerSnapshot] as a lifecycle-aware [snapshot] flow — so the surface reflects the latest anchor
 * without owning any state itself. The snapshot carries only the as-of instant, never a vehicle id or signals.
 * [setAsOf] / [returnToLive] forward the banner's writes to the holder, and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open. Every diagnostic carries only the surface slug — never the
 * as-of value — so a line can never leak which historical moment a user was viewing.
 *
 * @param source the as-of seam (the app-global holder in production, a fake in tests). The view-model owns no
 *   networking — it only projects the feed and nudges its writes.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` / write events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class TimeMachineBannerViewModel(
    private val source: TimeMachineBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The point-in-time anchor as a lifecycle-aware [TimeMachineBannerSnapshot]. Collected only while the surface
     * is on-screen ([SharingStarted.WhileSubscribed]); the initial value is the live-mode snapshot so the first
     * frame is never a premature historical banner.
     */
    val snapshot: StateFlow<TimeMachineBannerSnapshot> =
        source
            .asOf()
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = TimeMachineBannerSnapshot.live(),
            )

    /**
     * Sets the point-in-time anchor (web `setAsOf`). Logs a PII-safe, slug-only event and forwards to the holder,
     * which refuses any value that is not a well-formed RFC 3339 instant.
     */
    fun setAsOf(iso: String?) {
        logger.info(EVENT_SET_AS_OF, mapOf(FIELD_SURFACE to TimeMachineBannerRegistration.SLUG))
        source.setAsOf(iso)
    }

    /** Returns to live mode (web `clear()`). Logs a PII-safe, slug-only event and forwards to the holder. */
    fun returnToLive() {
        logger.info(EVENT_RETURN_TO_LIVE, mapOf(FIELD_SURFACE to TimeMachineBannerRegistration.SLUG))
        source.clear()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no as-of value / vehicle id. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTimeMachineBannerOpened(logger)
    }

    companion object {
        private const val EVENT_SET_AS_OF = "timeMachine.setAsOf"
        private const val EVENT_RETURN_TO_LIVE = "timeMachine.returnToLive"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TimeMachineBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TimeMachineBannerViewModel(source, logger) }
            }
    }
}
