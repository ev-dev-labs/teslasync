// UI-thread-free state holder backing the AICrossRuleConflictDetection shared surface — the native port of the
// `useAiStream` composition the web component owns (web/src/components/ai/AICrossRuleConflictDetection.tsx). It
// binds the [AiConflictStreamSource] seam (P1/S8 — the native counterpart of `useAiStream`), folds the streamed
// `AiStreamEvent`s into a [StreamRuntime], projects that onto the [AiConflictsSnapshot] render contract
// (loading / content / empty / error / stale / offline), exposes the per-feature AI-Off [gated] flag (web
// `withAiFeature`), and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [snapshot]/[gated] and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AICrossRuleConflictDetection) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aicrossruleconflictdetection

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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The streaming seam this surface binds — the native counterpart of the web `useAiStream` hook against
 * POST /ai/alerts/rules/conflicts. A production binding adapts the shared AI SSE transport (decoding frames via
 * [parseSseFrame]) and sends `{ rule_ids }` plus `vehicle_id` only when non-null (web body parity); tests pass a
 * lambda emitting a scripted [AiStreamEvent] sequence. The view-model owns cancellation (on a new detect, a
 * rule-set change, or its own clearing), so an implementation only needs to emit events and complete the flow.
 */
fun interface AiConflictStreamSource {
    /** Opens one conflict-detection stream over [ruleIds] (and optional [vehicleId] firing-history scope). */
    fun detectConflicts(
        ruleIds: List<Long>,
        vehicleId: Long?,
    ): Flow<AiStreamEvent>
}

/**
 * Lifecycle-aware state holder backing the Compose [AICrossRuleConflictDetection] surface. It re-shares the
 * derived [snapshot] with `WhileSubscribed`, so the projection is computed only while the screen observes it (via
 * `collectAsStateWithLifecycle`). It owns no networking: [detect] launches a collection of the injected
 * [AiConflictStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears the
 * in-flight stream down; [setRules] cancels + resets when the in-scope rule set changes (web's
 * cancel-on-`ruleIds`-change effect); [retry] re-runs the stream behind the error/offline affordance; and
 * [recordViewOpened] emits the one-shot diagnostic.
 *
 * The AI panel NEVER persists — a captured conflict is reviewed in the parent editor through the view's
 * `onSelectRule` callback, never written here (the baseline AlertStudio Save button stays the sole write path).
 *
 * @param source the streaming seam (a shared-transport adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + detect/failure events.
 * @param initialTarget the rule set (+ optional vehicle) the stream targets; updated via [setRules].
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables detect.
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AICrossRuleConflictDetectionViewModel(
    private val source: AiConflictStreamSource,
    logger: Logger,
    initialTarget: RulesTarget = RulesTarget(emptyList(), null),
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    private val featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val target = MutableStateFlow(initialTarget)
    private val runtime = MutableStateFlow(StreamRuntime())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /**
     * The render-ready snapshot of the stream lifecycle + connectivity, projected onto the prompt's mandated
     * state set. Cold until observed: collecting it computes the projection while the screen is mounted.
     */
    val snapshot: StateFlow<AiConflictsSnapshot> =
        combine(target, runtime, connectivity) { current, rt, online ->
            projectAiConflicts(current.ruleIds.size, rt, online)
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = projectAiConflicts(target.value.ruleIds.size, runtime.value, connectivity.value),
        )

    /**
     * Re-targets the stream when the in-scope rule set changes (web's `useEffect` cleanup keyed on the joined
     * `ruleIds`): a stale stream from a previously-selected rule set is cancelled and the captured conflicts
     * cleared so they cannot bleed into the new scope. A no-op when the target is unchanged.
     */
    fun setRules(
        ruleIds: List<Long>,
        vehicleId: Long?,
    ) {
        if (target.value.ruleIds == ruleIds && target.value.vehicleId == vehicleId) return
        cancelStream()
        target.value = RulesTarget(ruleIds, vehicleId)
        runtime.value = StreamRuntime()
    }

    /**
     * Opens a conflict-detection stream (web `handleDetect`): a double-submit while streaming/paused is a no-op,
     * fewer than two rules or an offline connection is gated out, the prior conflicts/text/error are reset, and
     * each event is folded into the runtime. A flow that completes without a terminal frame promotes
     * `streaming` → `done` so the UI never sits spinning; a thrown failure becomes the error surface;
     * cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun detect() {
        val current = target.value
        val phase = runtime.value.phase
        if (phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm) return
        if (current.ruleIds.size < MIN_RULE_COUNT || !connectivity.value) return
        logger.info("aiConflicts.detect", mapOf("rule_count" to current.ruleIds.size.toString()))
        runtime.value = StreamRuntime(phase = AiStreamPhase.Streaming)
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.detectConflicts(current.ruleIds, current.vehicleId).collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Done) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiConflicts.streamFailed", mapOf("rule_count" to current.ruleIds.size.toString()))
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, errorMessage = error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [detect] (which resets the prior state first). */
    fun retry() = detect()

    /** Abort the in-flight stream (user dismiss / leaving the editor); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIConflictsViewOpened(logger)
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
                extractConflicts(event)?.let { rows -> runtime.update { state -> state.copy(conflicts = rows) } }
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
            source: AiConflictStreamSource,
            logger: Logger,
            initialTarget: RulesTarget,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AICrossRuleConflictDetectionViewModel(source, logger, initialTarget, connectivity, featureEnabled)
                }
            }
    }
}

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
