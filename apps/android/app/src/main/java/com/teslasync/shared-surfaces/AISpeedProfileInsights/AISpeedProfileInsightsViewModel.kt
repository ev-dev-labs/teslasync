// UI-thread-free state holder backing the AISpeedProfileInsights shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/drives/{driveID}/speed-profile/insights',
// body:{} })` composition (web/src/components/ai/AISpeedProfileInsights.tsx). It binds the AI gate + insights
// stream (P1/S8) through [AISpeedProfileInsightsSource], reduces each parsed SSE frame onto the immutable
// [SpeedProfileInsightsState] surface (idle / streaming / done / failed, with last-known retained for the
// offline surface), and exposes the generate + retry actions plus the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] and calls [setDrive] / [generate] / [retry] /
// [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AISpeedProfileInsights) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aispeedprofileinsights

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * @param source the AI-gate + insights-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a drive id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AISpeedProfileInsightsViewModel(
    private val source: AISpeedProfileInsightsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(SpeedProfileInsightsState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected drive (web `canStart`), the stream phase, the
     * in-flight + last-committed narrative text, the classified error, and the freshness stamp. The render
     * boundary classifies this into an [InsightsSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<SpeedProfileInsightsState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('speed-profile-insights')`); `false` collapses the
        // surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active drive (web InnerSection's `driveId` prop); `null`/blank disables the generate action. */
    fun setDrive(driveId: String?) {
        if (mutableState.value.driveId == driveId) return
        mutableState.update { it.copy(driveId = driveId) }
    }

    /**
     * Opens a fresh insights stream for the selected drive (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a selected drive or while a stream is already open (web `canStart` + the
     * hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val driveId = mutableState.value.driveId
        if (driveId.isNullOrEmpty()) return
        if (mutableState.value.isStreaming) return
        logger.info("aiSpeedProfileInsights.generate")
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .insights(driveId)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no drive id or generated text, so a diagnostics line can never leak fleet state. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_SPEED_PROFILE_INSIGHTS_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AISpeedProfileInsightsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AISpeedProfileInsightsViewModel(source, logger) }
            }
    }
}
