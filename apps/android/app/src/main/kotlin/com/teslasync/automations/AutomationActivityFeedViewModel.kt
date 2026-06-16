// The state holder backing the AutomationActivityFeed A7 page surface (P1/S8) — the native counterpart of the
// web component's props composition (web/src/features/automations/pages/AutomationActivityFeed.tsx). The web
// component is presentational and binds no data hook of its own, so this holder owns no networking: it reads
// the page's local snapshot from the [AutomationActivityFeedSource] seam (navigation args / local state) and
// hoists it into the lifecycle-aware [UiState] surface the shared A3 feature view consumes, plus the two
// separate live SSE inputs (the most recent [liveEvents] and the SSE [connectionState]) the feature view
// renders above the history area. [load] establishes the snapshot (web `isLoading` resolving to the empty /
// content branch); [refresh] re-reads it and is wired to the feature view's retry affordance. All derivation
// lives in the framework-free model (AutomationActivityFeedModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.activityfeed

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.automationactivityfeed.AutomationActivityData
import io.teslasync.android.featureviews.automationactivityfeed.AutomationLiveEvent
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * @param source the local-state seam (a snapshot provider in production, a fake in tests); the view never
 *   performs HTTP — it only projects this seam's [AutomationActivitySnapshot].
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AutomationActivityFeedViewModel(
    private val source: AutomationActivityFeedSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow<UiState<AutomationActivityData>>(UiState.loading())
    private val mutableLiveEvents = MutableStateFlow<List<AutomationLiveEvent>>(emptyList())
    private val mutableConnectionState = MutableStateFlow(LiveConnectionStatus.Connected)
    private var viewOpenedRecorded = false

    /**
     * The execution-history feed as a lifecycle-aware [UiState] (loading / content / empty): a first load is
     * the loading surface, an empty history is the empty surface (web `items.length > 0`), and rows are the
     * content surface. Seeded as loading so the first frame is the web `isLoading` state until [load] runs.
     */
    val state: StateFlow<UiState<AutomationActivityData>> = mutableState.asStateFlow()

    /** The most recent live SSE events (web `liveEvents`); the feature view shows the first five. */
    val liveEvents: StateFlow<List<AutomationLiveEvent>> = mutableLiveEvents.asStateFlow()

    /** The SSE wire health driving the "Live" / "Reconnecting" chip (web `connectionState`). */
    val connectionState: StateFlow<LiveConnectionStatus> = mutableConnectionState.asStateFlow()

    /** Reads the local snapshot and projects it onto the three render flows (the web prop binding). */
    fun load() {
        apply(source.snapshot())
    }

    /** Re-reads the local snapshot (the feature view's retry affordance / the web query `refetch`). */
    fun refresh() {
        logger.info("automationActivityFeed.refresh")
        mutableState.value = UiState.loading()
        apply(source.snapshot())
    }

    /**
     * Emits the one-shot, PII-safe `view.opened` diagnostic with the page surface slug (P1/S11), at most once
     * per holder. Carries no automation name/status/run payload.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAutomationActivityFeedPageOpened(logger)
    }

    private fun apply(snapshot: AutomationActivitySnapshot) {
        mutableLiveEvents.value = snapshot.liveEvents
        mutableConnectionState.value = snapshot.connectionState
        mutableState.value = snapshot.toUiState()
    }
}
