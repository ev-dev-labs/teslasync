// UI-thread-free state holder backing the AIGeofenceAwareAutomationSuggestions shared surface — the native port
// of the `useAiStream` composition the web component owns
// (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx). It binds the [AiGeofenceStreamSource] seam
// (P1/S8 — the native counterpart of `useAiStream`), owns the vehicle scope + free-form prompt the backend route
// reads from the JSON body, folds the streamed `AiStreamEvent`s into a [StreamRuntime], projects that onto the
// [GeofenceDraftSnapshot] render contract (loading / content / empty / error / stale / offline), exposes the
// per-feature AI-Off [gated] flag (web `withAiFeature`), and emits the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [snapshot]/[prompt]/[gated] and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIGeofenceAwareAutomationSuggestions) cannot form a valid Kotlin package
// identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The streaming seam this surface binds — the native counterpart of the web `useAiStream` hook against
 * POST /ai/geofences/automations/draft. A production binding adapts the shared AI SSE transport (decoding frames
 * via [parseSseFrame]) and writes `vehicle_id` + `prompt` into the request JSON body; tests pass a lambda
 * emitting a scripted [AiStreamEvent] sequence. The view-model owns cancellation (on a new suggest, a vehicle
 * change, or its own clearing), so an implementation only needs to emit events and complete the flow.
 */
fun interface AiGeofenceStreamSource {
    /** Opens one draft-automation stream for [vehicleId] with the free-form [prompt]. */
    fun draftAutomation(
        vehicleId: Long,
        prompt: String,
    ): Flow<AiStreamEvent>
}

/**
 * Lifecycle-aware state holder backing the Compose [AIGeofenceAwareAutomationSuggestions] surface. It re-shares
 * the derived [snapshot] with `WhileSubscribed`, so the projection is computed only while the screen observes it
 * (via `collectAsStateWithLifecycle`). It owns no networking: [suggest] launches a collection of the injected
 * [AiGeofenceStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears the
 * in-flight stream down; [setVehicle] cancels + resets the captured proposal when the edited vehicle changes
 * (web's cancel-on-`vehicleId`-change effect); [setPrompt] tracks the prompt text gating the action; [retry]
 * re-runs the stream behind the error/offline affordance; and [recordViewOpened] emits the one-shot diagnostic.
 *
 * The AI panel NEVER persists — the captured graph is handed to the parent editor through the view's
 * `onApplyDraft` callback, never written here (ADR-015 §I3/§I8).
 *
 * @param source the streaming seam (a shared-transport adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + suggest/failure events.
 * @param initialVehicleId the vehicle the stream targets; updated via [setVehicle]. Non-positive disables suggest.
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables suggest.
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIGeofenceAwareAutomationSuggestionsViewModel(
    private val source: AiGeofenceStreamSource,
    logger: Logger,
    initialVehicleId: Long = 0L,
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    private val featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val vehicleId = MutableStateFlow(initialVehicleId)
    private val promptText = MutableStateFlow("")
    private val runtime = MutableStateFlow(StreamRuntime())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /** The free-form prompt bound to the textarea (web `prompt` state); two-way via [setPrompt]. */
    val prompt: StateFlow<String> = promptText.asStateFlow()

    /**
     * The render-ready snapshot of the stream lifecycle + vehicle scope + prompt-readiness + connectivity,
     * projected onto the prompt's mandated state set. Cold until observed: collecting it computes the projection
     * while the screen is mounted.
     */
    val snapshot: StateFlow<GeofenceDraftSnapshot> =
        combine(vehicleId, promptText, runtime, connectivity) { id, text, rt, online ->
            projectGeofenceDraft(id, text.isPromptReady(), rt, online)
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue =
                projectGeofenceDraft(
                    vehicleId.value,
                    promptText.value.isPromptReady(),
                    runtime.value,
                    connectivity.value,
                ),
        )

    /**
     * Re-targets the stream when the edited vehicle changes (web's `useEffect` cleanup keyed on `vehicleId`): a
     * stale stream from a previously-selected vehicle is cancelled and the captured proposal cleared so it cannot
     * bleed into the new vehicle's scope. The prompt is preserved (web keeps the textarea). A no-op when
     * unchanged.
     */
    fun setVehicle(newVehicleId: Long) {
        if (vehicleId.value == newVehicleId) return
        cancelStream()
        vehicleId.value = newVehicleId
        runtime.value = StreamRuntime()
    }

    /** Tracks the prompt text (web `setPrompt`); a non-blank prompt is a precondition of [suggest]. */
    fun setPrompt(text: String) {
        promptText.value = text
    }

    /**
     * Opens a draft-automation stream (web `handleSuggest`): a double-submit while streaming/paused is a no-op, a
     * missing vehicle, a blank prompt, or an offline connection is gated out, the prior proposal/replay/error are
     * reset, and each event is folded into the runtime. A flow that completes without a terminal frame promotes
     * `streaming` → `done` so the UI never sits spinning; a thrown failure becomes the error surface;
     * cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun suggest() {
        val id = vehicleId.value
        val text = promptText.value
        val phase = runtime.value.phase
        if (phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm) return
        if (id <= 0L || !text.isPromptReady() || !connectivity.value) return
        logger.info("aiGeofenceDraft.suggest", mapOf("vehicle_id" to id.toString()))
        runtime.value = StreamRuntime(phase = AiStreamPhase.Streaming)
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.draftAutomation(id, text).collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Done) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiGeofenceDraft.streamFailed", mapOf("vehicle_id" to id.toString()))
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, errorMessage = error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [suggest] (which resets the prior state first). */
    fun retry() = suggest()

    /** Abort the in-flight stream (user dismiss / leaving the editor); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGeofenceDraftViewOpened(logger)
    }

    private fun cancelStream() {
        streamJob?.cancel()
        streamJob = null
        runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
    }

    private fun reduce(event: AiStreamEvent) {
        when (event) {
            is AiStreamEvent.Delta ->
                runtime.update { it.copy(streamedText = it.streamedText + event.text) }
            is AiStreamEvent.ToolResult ->
                extractProposal(event)?.let { proposal -> runtime.update { state -> state.copy(proposal = proposal) } }
            is AiStreamEvent.ConfirmRequest ->
                runtime.update { it.copy(phase = AiStreamPhase.PausedConfirm) }
            is AiStreamEvent.Done ->
                runtime.update { it.copy(phase = AiStreamPhase.Done) }
            is AiStreamEvent.StreamError ->
                runtime.update {
                    it.copy(phase = AiStreamPhase.Error, errorMessage = event.message, limit = event.toLimitInfo())
                }
            is AiStreamEvent.ToolCall -> Unit
        }
    }

    companion object {
        private const val STREAM_ERROR = "stream_error"

        /** Builds a [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiGeofenceStreamSource,
            logger: Logger,
            initialVehicleId: Long,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AIGeofenceAwareAutomationSuggestionsViewModel(
                        source,
                        logger,
                        initialVehicleId,
                        connectivity,
                        featureEnabled,
                    )
                }
            }
    }
}

/** True when the prompt has non-whitespace content (web `prompt.trim().length > 0`). */
private fun String.isPromptReady(): Boolean = trim().isNotEmpty()

/** Lifts a terminal [AiStreamEvent.StreamError] onto the structured [AiLimitInfo] (only when it carried a reason). */
private fun AiStreamEvent.StreamError.toLimitInfo(): AiLimitInfo? =
    reason?.let {
        AiLimitInfo(
            reason = it,
            retryAfterS = retryAfterS ?: 0,
            bannerLevel = bannerLevel ?: "",
            baselineAvailable = baselineAvailable,
        )
    }
