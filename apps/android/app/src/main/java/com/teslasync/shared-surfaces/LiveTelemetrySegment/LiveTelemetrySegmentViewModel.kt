// UI-thread-free state holder backing the LiveTelemetrySegment — the native port of the web component's
// `useLiveConnection` derivation (web/src/components/layout/status-bar/LiveTelemetrySegment.tsx). It binds the
// app-scoped live pipeline (P1/S8) through [LiveTelemetrySegmentSource] and re-shares each PII-free
// [LiveTelemetrySnapshot] as a lifecycle-aware flow the composable renders, plus the one-shot PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [snapshot] and calls
// [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LiveTelemetrySegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livetelemetrysegment

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
 * State holder backing the Compose `LiveTelemetrySegment` — the Android port of the web `LiveTelemetrySegment`
 * over a `useLiveConnection()` result.
 *
 * It re-collects the injected [source]'s lifecycle-aware wire-health feed (the P1/S8 boundary) and re-shares
 * the PII-free [LiveTelemetrySnapshot] as a lifecycle-aware [snapshot] flow — so the segment reflects the
 * latest wire health without owning any state itself. The snapshot carries only the status, last-message
 * stamp, and staleness flag, never any vehicle id or signals.
 *
 * [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the live wire-health seam (a shared-live-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only projects the feed's wire health.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class LiveTelemetrySegmentViewModel(
    source: LiveTelemetrySegmentSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The live pipeline's wire health as a lifecycle-aware [LiveTelemetrySnapshot], carrying the status,
     * last-message stamp, and staleness flag without any signals. Collected only while the segment is
     * on-screen ([SharingStarted.WhileSubscribed]); the initial value is the cold-start `unknown` snapshot so
     * the first frame is never an artificial blank.
     */
    val snapshot: StateFlow<LiveTelemetrySnapshot> =
        source
            .connection()
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LiveTelemetrySnapshot.unknown(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / connection payload, so a diagnostics line can never leak which session the user
     * was viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveTelemetrySegmentOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LiveTelemetrySegmentSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LiveTelemetrySegmentViewModel(source, logger) }
            }
    }
}
