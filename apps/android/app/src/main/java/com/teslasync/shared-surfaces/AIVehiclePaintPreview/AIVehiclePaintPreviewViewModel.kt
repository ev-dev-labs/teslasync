// UI-thread-free state holder backing the AIVehiclePaintPreview shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/vehicles/{id}/paint-preview/draft',
// body:{style_hint?} })` composition (web/src/components/ai/AIVehiclePaintPreview.tsx). It binds the AI gate +
// draft stream (P1/S8) through [AIVehiclePaintPreviewSource], reduces each parsed SSE frame onto the immutable
// [PaintPreviewState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the draft + retry actions plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [setVehicle] / [setStyleHint] / [draft] / [retry] /
// [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivehiclepaintpreview

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
 * @param source the AI-gate + draft-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `draft` events
 *   carrying only the non-PII surface slug (never a vehicle id, a style hint, or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIVehiclePaintPreviewViewModel(
    private val source: AIVehiclePaintPreviewSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(PaintPreviewState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false
    private var styleHint: String? = null

    /**
     * The live surface state: the AI gate, the selected vehicle (web `canStart`), the stream phase, the
     * in-flight + last-committed draft text, the classified error, and the freshness stamp. The render boundary
     * classifies this into a [PaintPreviewSurface]; every state renders a non-blank surface. The optional style
     * hint is a request input held separately (see [setStyleHint]), not part of the rendered state.
     */
    val state: StateFlow<PaintPreviewState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('vehicle-paint-preview')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); a `null` or non-positive id disables draft. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Sets the optional style hint (web InnerSection's `styleHint` prop). Resolved via [normalizeStyleHint]
     * (trimmed, clamped to [PAINT_PREVIEW_STYLE_HINT_MAX_CHARS], `null` when blank) so a blank hint omits the
     * body field — exactly as the web `body` memo omits `style_hint`. It is a request input — not render state
     * — so it is held here and threaded into the next [draft].
     */
    fun setStyleHint(styleHint: String?) {
        this.styleHint = normalizeStyleHint(styleHint)
    }

    /**
     * Opens a fresh draft stream for the selected vehicle (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a selected vehicle (web `canStart`) or while a stream is already open (the
     * hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun draft() {
        val vehicleId = mutableState.value.vehicleId
        if (!mutableState.value.canStart || vehicleId == null) return
        if (mutableState.value.isStreaming) return
        logger.info("aiVehiclePaintPreview.draft")
        streamJob?.cancel()
        val hint = styleHint
        mutableState.update { it.startDrafting() }
        streamJob =
            stateScope.launch {
                source
                    .draft(vehicleId, hint)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [draft]; backs the error/offline surfaces' retry affordance. */
    fun retry() = draft()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, style hint, or generated text, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_VEHICLE_PAINT_PREVIEW_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIVehiclePaintPreviewSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIVehiclePaintPreviewViewModel(source, logger) }
            }
    }
}
