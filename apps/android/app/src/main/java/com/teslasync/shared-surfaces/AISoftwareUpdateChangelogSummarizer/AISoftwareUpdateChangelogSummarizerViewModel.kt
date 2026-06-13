// UI-thread-free state holder backing the AISoftwareUpdateChangelogSummarizer shared surface — the native port
// of the web component's `withAiFeature` gate + `useAiStream({ url:'/ai/software-updates/summarize',
// body:{ vehicle_id } })` composition
// (web/src/components/ai/AISoftwareUpdateChangelogSummarizer.tsx). It binds the AI gate + summarize stream
// (P1/S8) through [AISoftwareUpdateChangelogSummarizerSource], reduces each parsed SSE frame onto the immutable
// [ChangelogSummaryState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the generate + retry actions plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [setVehicle] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisoftwareupdatechangelogsummarizer

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
 * @param source the AI-gate + summarize-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a vehicle id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AISoftwareUpdateChangelogSummarizerViewModel(
    private val source: AISoftwareUpdateChangelogSummarizerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(ChangelogSummaryState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected vehicle (web `haveInputs`), the stream phase, the
     * in-flight + last-committed summary text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [SummarySurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<ChangelogSummaryState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('software-update-changelog-summarizer')`); `false`
        // collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); `null` disables the generate action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Opens a fresh summarize stream for the selected vehicle (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a usable vehicle (web `haveInputs`) or while a stream is already open (the
     * hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        // web `haveInputs = numericVehicleId > 0`: require a non-null, positive vehicle id in one guard.
        val vehicleId = current.vehicleId?.takeIf { it > 0L } ?: return
        if (current.isStreaming) return
        logger.info("aiSoftwareUpdateChangelogSummarizer.generate")
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .summarize(vehicleId)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id or generated text, so a diagnostics line can never leak fleet state. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_SOFTWARE_UPDATE_CHANGELOG_SUMMARIZER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AISoftwareUpdateChangelogSummarizerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AISoftwareUpdateChangelogSummarizerViewModel(source, logger) }
            }
    }
}
