// UI-thread-free state holder backing the AIInboxAutoCategorization shared surface — the native port of the
// `useAiStream` composition the web component owns (web/src/components/ai/AIInboxAutoCategorization.tsx). It binds
// the [AiInboxCategorizeStreamSource] seam (P1/S8 — the native counterpart of `useAiStream`), folds the streamed
// `AiStreamEvent`s into a [StreamRuntime], projects that onto the [AiCategorizeSnapshot] render contract
// (loading / content / empty / error / stale / offline), exposes the per-feature AI-Off [gated] flag (web
// `withAiFeature`), and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [snapshot]/[gated] and calls these methods.
//
// The AI panel NEVER persists — the union of proposed rule ids ([AiCategorizeSnapshot.allRuleIds]) is handed to
// the parent inbox through the view's `onApplyCategories` callback, never written here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIInboxAutoCategorization) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiinboxautocategorization

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Lifecycle-aware state holder backing the Compose [AIInboxAutoCategorization] surface. It re-shares the derived
 * [snapshot] with `WhileSubscribed`, so the projection is computed only while the screen observes it (via
 * `collectAsStateWithLifecycle`). It owns no networking: [suggest] launches a collection of the injected
 * [AiInboxCategorizeStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears
 * the in-flight stream down; [setScope] cancels + resets when the inbox filter changes (web's cancel-on-scope
 * effect); [retry] re-runs the stream behind the error/offline affordance; and [recordViewOpened] emits the
 * one-shot diagnostic.
 *
 * @param source the streaming seam (a shared-transport adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + suggest/failure events.
 * @param initialScope the inbox scope the stream targets; updated via [setScope].
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables suggest.
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIInboxAutoCategorizationViewModel(
    private val source: AiInboxCategorizeStreamSource,
    logger: Logger,
    initialScope: InboxScope = InboxScope(),
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    private val featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val inboxScope = MutableStateFlow(initialScope)
    private val runtime = MutableStateFlow(StreamRuntime())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /**
     * The render-ready snapshot of the stream lifecycle + connectivity, projected onto the prompt's mandated
     * state set. Cold until observed: collecting it computes the projection while the screen is mounted.
     */
    val snapshot: StateFlow<AiCategorizeSnapshot> =
        combine(runtime, connectivity) { rt, online -> projectAiCategorize(rt, online) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = projectAiCategorize(runtime.value, connectivity.value),
            )

    /**
     * Re-targets the stream when the inbox filter changes (web's `useEffect` cleanup keyed on
     * `[vehicleId, windowDays, severities, ruleIds]`): a stale stream from a previously-selected scope is
     * cancelled and the captured proposal cleared so it cannot bleed into the new filter. A no-op when unchanged.
     */
    fun setScope(scope: InboxScope) {
        if (inboxScope.value == scope) return
        cancelStream()
        inboxScope.value = scope
        runtime.value = StreamRuntime()
    }

    /**
     * Opens a categorize stream (web `handleCategorize`): a double-submit while streaming/paused is a no-op, an
     * offline connection is gated out, the prior proposal/text/error are reset, and each event is folded into the
     * runtime. A flow that completes without a terminal frame promotes `streaming` → `done` so the UI never sits
     * spinning; a thrown failure becomes the error surface; cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun suggest() {
        val phase = runtime.value.phase
        if (phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm) return
        if (!connectivity.value) return
        logger.info("aiInboxCategorize.suggest")
        val current = inboxScope.value
        runtime.value = StreamRuntime(phase = AiStreamPhase.Streaming)
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.categorize(current).collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Done) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiInboxCategorize.streamFailed")
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, errorMessage = error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [suggest] (which resets the prior state first). */
    fun retry() = suggest()

    /** Abort the in-flight stream (user dismiss / leaving the inbox); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIInboxCategorizationViewOpened(logger)
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
                extractCategories(event)?.let { buckets -> runtime.update { state -> state.copy(proposal = buckets) } }
            is AiStreamEvent.ConfirmRequest ->
                runtime.update { it.copy(phase = AiStreamPhase.PausedConfirm) }
            is AiStreamEvent.Done ->
                runtime.update { it.copy(phase = AiStreamPhase.Done) }
            is AiStreamEvent.StreamError ->
                runtime.update { it.copy(phase = AiStreamPhase.Error, errorMessage = event.message, limit = event.toLimitInfo()) }
            is AiStreamEvent.ToolCall -> Unit
        }
    }

    companion object {
        private const val STREAM_ERROR = "stream_error"

        /** Builds a [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiInboxCategorizeStreamSource,
            logger: Logger,
            initialScope: InboxScope,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AIInboxAutoCategorizationViewModel(source, logger, initialScope, connectivity, featureEnabled)
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
