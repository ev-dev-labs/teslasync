// UI-thread-free state holder backing the WhyEndedPanel feature view — the native port of the single
// `useDriveWhyEnded` query the web component owns
// (web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx + web/src/api/hooks/useDriving.ts). It
// binds the shared Driving feed (P1/S8 DrivingStore / S7 DrivingRepository) through [WhyEndedPanelSource]:
// it collects the cache-then-network `GET /drives/{id}/why-ended?window=` [Resource] for the configured
// drive and the selected window, and projects it (with the expand flag) onto a single [WhyEndedFeedState].
// The view never performs HTTP — it only collects [state] and calls the trigger methods.
//
// Two render-layer concerns the shared DrivingRepository deliberately does NOT reproduce live here (its
// own docs say so): the web `enabled: expanded && id !== '' && id !== '0'` lazy gate and the
// `refetchInterval`. This holder owns the lazy gate: while collapsed (or while the drive id is missing) it
// emits a feedless [WhyEndedFeedState] and opens NO upstream collection, so expanding is what fires the
// first fetch — exactly the web behaviour. Changing the window re-subscribes the feed (`flatMapLatest`),
// and [refresh] re-collects it (the freshness/error retry + a host poll cadence).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WhyEndedPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.whyendedpanel

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The data port the panel binds to — the native analogue of the web `useDriveWhyEnded` hook. A concrete
 * adapter over the shared Driving data layer (or a test fake) drives this seam; the view never performs
 * HTTP. The diagnostic is carried as the raw SI [JsonElement] the backend serves, untouched.
 */
interface WhyEndedPanelSource {
    /** The cache-then-network `GET /drives/{driveId}/why-ended?window={window}` feed (web `useDriveWhyEnded`). */
    fun driveWhyEnded(
        driveId: String,
        window: String,
    ): Flow<Resource<JsonElement>>
}

/**
 * Binds the panel to the shared **S8** [DrivingStore] — the memoized, multi-observer feed every Driving
 * surface shares; the store's targeted family refresh (the `invalidateQueries` analogue) flows through
 * unchanged. Use this when a host wants the panel to fold into the same shared collection as the rest of the
 * Driving screens. No HTTP touches the view.
 */
fun DrivingStore.asWhyEndedPanelSource(): WhyEndedPanelSource {
    val store = this
    return object : WhyEndedPanelSource {
        override fun driveWhyEnded(
            driveId: String,
            window: String,
        ): Flow<Resource<JsonElement>> = store.driveWhyEnded(driveId, window)
    }
}

/**
 * Binds the panel to the shared **S7** [DrivingRepository] — the cold cache-then-network `Flow`. Re-collecting
 * the feed performs a genuine cache-then-network re-fetch, which backs the panel's window switch + manual
 * refresh / error-retry affordance. No HTTP touches the view.
 */
fun DrivingRepository.asWhyEndedPanelSource(): WhyEndedPanelSource {
    val repo = this
    return object : WhyEndedPanelSource {
        override fun driveWhyEnded(
            driveId: String,
            window: String,
        ): Flow<Resource<JsonElement>> = repo.driveWhyEnded(driveId, window)
    }
}

/**
 * The immutable state the [WhyEndedPanelViewModel] exposes — the expand flag, the selected window, and the
 * cache-then-network feed value (or `null` while collapsed / lazy-disabled). The pure
 * [WhyEndedPanelProjection] turns this (+ the viewer zone/locale) into the render-ready [WhyEndedDisplay].
 */
data class WhyEndedFeedState(
    val expanded: Boolean,
    val window: WhyEndedWindow,
    val resource: Resource<JsonElement>?,
) {
    companion object {
        /** The collapsed (lazy default / no-feed) state for [window]: nothing loaded, no upstream open. */
        fun collapsed(window: WhyEndedWindow): WhyEndedFeedState = WhyEndedFeedState(false, window, null)
    }
}

/**
 * @param source the cache-then-network Driving seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + re-shares the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the PII-safe `view.opened`,
 *   `whyEndedPanel.toggle`, `whyEndedPanel.window`, and `whyEndedPanel.refresh` events.
 * @param driveId the drive whose diagnostic to load (web `driveId` prop). A blank or `"0"` id holds the
 *   feedless state even while expanded — the web `enabled: id !== '' && id !== '0'` gate.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WhyEndedPanelViewModel(
    private val source: WhyEndedPanelSource,
    logger: Logger,
    private val driveId: String,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val expandedFlow = MutableStateFlow(false)
    private val windowFlow = MutableStateFlow(WhyEndedWindow.DEFAULT)
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The projected feed state as a lifecycle-aware [StateFlow]. While collapsed (or while the drive id is
     * missing) it stays feedless and opens no upstream collection — the lazy `enabled` gate; expanding or
     * changing the window re-subscribes the cache-then-network feed via `flatMapLatest`.
     */
    val state: StateFlow<WhyEndedFeedState> =
        combine(expandedFlow, windowFlow, refreshTrigger) { expanded, window, _ -> expanded to window }
            .flatMapLatest { (expanded, window) -> resolvedFeed(expanded, window) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = WhyEndedFeedState.collapsed(WhyEndedWindow.DEFAULT),
            )

    /** Toggles the panel open/closed (web `setExpanded((p) => !p)`); expanding fires the lazy first fetch. */
    fun toggleExpanded() {
        val next = !expandedFlow.value
        expandedFlow.value = next
        logger.info("whyEndedPanel.toggle", mapOf("expanded" to next.toString()))
    }

    /** Selects the diagnostic [window] (web `setWindowSel`); re-subscribes the feed for the new window. */
    fun selectWindow(window: WhyEndedWindow) {
        if (window == windowFlow.value) return
        logger.info("whyEndedPanel.window", mapOf("window" to window.wire))
        windowFlow.value = window
    }

    /** Re-runs the cache-then-network load (the web `why.refetch()` retry + a host poll cadence). */
    fun refresh() {
        logger.info("whyEndedPanel.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no drive id, FSM state, trigger, or signal value. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        WhyEndedPanelDiagnostics.recordViewOpened(logger)
    }

    /**
     * The rendered feed: the configured drive's why-ended diagnostic for [window] when [expanded] and the
     * drive id is valid, or a feedless [WhyEndedFeedState] (collapsed / lazy-disabled) otherwise — all
     * without ever issuing HTTP from the view.
     */
    private fun resolvedFeed(
        expanded: Boolean,
        window: WhyEndedWindow,
    ): Flow<WhyEndedFeedState> =
        if (expanded && hasValidDrive()) {
            source.driveWhyEnded(driveId, window.wire).map { WhyEndedFeedState(true, window, it) }
        } else {
            flowOf(WhyEndedFeedState(expanded, window, null))
        }

    /** The web `id !== '' && id !== '0'` guard: a blank/zero drive id never opens a feed. */
    private fun hasValidDrive(): Boolean = driveId.isNotBlank() && driveId != "0"

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
