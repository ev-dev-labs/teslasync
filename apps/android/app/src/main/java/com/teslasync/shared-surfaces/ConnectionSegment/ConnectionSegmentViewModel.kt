// UI-thread-free state holder backing the ConnectionSegment surface — the native port of the web component's
// `useApiHealth` read (web/src/components/layout/status-bar/ConnectionSegment.tsx). It binds the shared
// API-health poll (P1/S8) through [ConnectionSegmentSource] and re-shares each PII-free [ConnectionSnapshot] as
// a lifecycle-aware flow the composable renders, plus the one-shot PII-safe `view.opened` diagnostic. The view
// never performs HTTP — it only collects [snapshot] and calls [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ConnectionSegment) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.connectionsegment

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
 * State holder backing the Compose `ConnectionSegment` surface — the Android port of the web `ConnectionSegment`
 * over a `useApiHealth()` result.
 *
 * It re-collects the injected [source]'s lifecycle-aware API-health feed (the P1/S8 boundary) and re-shares the
 * PII-free [ConnectionSnapshot] as a lifecycle-aware [snapshot] flow — so the segment reflects the latest tier
 * + latency + freshness without owning any state itself. The snapshot carries only the coarse health tier, the
 * measured latency, and the last-probe stamp, never any vehicle id or request payload. Collected only while the
 * segment is on-screen ([SharingStarted.WhileSubscribed]), so subscribing resumes the shared poll and the last
 * observer leaving suspends it (the web `refetchIntervalInBackground: false` analogue); the initial value is the
 * cold-start `unknown` snapshot so the first frame is never an artificial blank.
 *
 * [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the API-health seam (a shared-store adapter in production, a fake in tests). The view-model
 *   owns no networking — it only projects the feed's health.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ConnectionSegmentViewModel(
    source: ConnectionSegmentSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The shared poll's API health as a lifecycle-aware [ConnectionSnapshot], carrying the tier, latency, and
     * last-probe stamp without any request payload. Seeded with the cold-start `unknown` snapshot.
     */
    val snapshot: StateFlow<ConnectionSnapshot> =
        source
            .apiHealth()
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ConnectionSnapshot.unknown(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / latency / request payload, so a diagnostics line can never leak anything about
     * the user's session. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordConnectionSegmentOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ConnectionSegmentSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ConnectionSegmentViewModel(source, logger) }
            }
    }
}
