// UI-thread-free state holder backing the AIStateMachineDebuggerNarrator shared surface — the native port of
// the web component's `withAiFeature` gate + `useAiStream({ url:'/ai/system/fsm/narrate',
// body:{vehicle_id,from_unix,to_unix} })` composition
// (web/src/components/ai/AIStateMachineDebuggerNarrator.tsx). It binds the AI gate + narrate stream (P1/S8)
// through [AIStateMachineDebuggerNarratorSource], reduces each parsed SSE frame onto the immutable
// [AiNarrationState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the narrate + retry actions plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [setScope] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aistatemachinedebuggernarrator

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
 * Lifecycle-aware state holder backing the Compose [AIStateMachineDebuggerNarrator] surface. It binds the AI
 * gate + narrate stream via [source], reduces each parsed frame onto [AiNarrationState], and owns no
 * networking — the view only collects [state] and calls the actions below.
 *
 * @param source the AI-gate + narrate-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a vehicle id, window bound, or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIStateMachineDebuggerNarratorViewModel(
    private val source: AIStateMachineDebuggerNarratorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiNarrationState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the in-scope (vehicle, window) target (web `haveScope`), the stream
     * phase, the in-flight + last-committed narration text, the classified error, and the freshness stamp. The
     * render boundary classifies this into a [NarrationSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiNarrationState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('state-machine-debugger-narrator')`); `false` collapses
        // the surface entirely (web `withAiFeature` → null).
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the in-scope narration target (web InnerSection's `vehicleId` / `fromUnix` / `toUnix` props). Any
     * incomplete or out-of-order triple (a non-positive id/start, or an end not strictly after the start)
     * leaves [AiNarrationState.canStart] false — the narrate action stays disabled and the empty hint shows
     * (web `haveScope` / `emptyHint`). A no-op when the scope is unchanged so the stream is never churned.
     */
    fun setScope(
        vehicleId: Long?,
        fromUnix: Long?,
        toUnix: Long?,
    ) {
        val next = NarrationScope(vehicleId = vehicleId, fromUnix = fromUnix, toUnix = toUnix)
        if (mutableState.value.scope == next) return
        mutableState.update { it.copy(scope = next) }
    }

    /**
     * Opens a fresh narrate stream for the in-scope (vehicle, window) tuple (web `stream.start()`), reducing
     * each parsed frame into [state]. A no-op without a valid scope (web `canStart`) or while a stream is
     * already open (the hook's in-flight guard). The in-scope tuple is threaded into the request body so the
     * LLM cannot widen it (ADR-015 §I8). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val (vehicleId, fromUnix, toUnix) = mutableState.value.scope.validated ?: return
        if (mutableState.value.isStreaming) return
        logger.info("aiStateMachineDebuggerNarrator.generate")
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .narrate(vehicleId, fromUnix, toUnix)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, window bound, or generated text, so a diagnostics line can never leak fleet
     * state. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_STATE_MACHINE_DEBUGGER_NARRATOR_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIStateMachineDebuggerNarratorSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIStateMachineDebuggerNarratorViewModel(source, logger) }
            }
    }
}
