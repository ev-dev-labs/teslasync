// UI-thread-free state holder backing the AIChargingDiagnosis shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/charging/{sessionID}/diagnose', body:{} })`
// composition (web/src/components/ai/AIChargingDiagnosis.tsx). It binds the AI gate + diagnose stream (P1/S8)
// through [AIChargingDiagnosisSource], reduces each parsed SSE frame onto the immutable [AiDiagnosisState]
// surface (idle / streaming / done / failed, with last-known retained for the offline surface), and exposes
// the generate + retry actions plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it
// only collects [state] and calls [setSession] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingdiagnosis

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
 * @param source the AI-gate + diagnose-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a session id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIChargingDiagnosisViewModel(
    private val source: AIChargingDiagnosisSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiDiagnosisState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected session (web `canStart`), the stream phase, the
     * in-flight + last-committed diagnosis text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [DiagnosisSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiDiagnosisState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('charging-diagnosis')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active charging session (web InnerSection's `sessionId` prop); `null`/empty disables Generate. */
    fun setSession(sessionId: String?) {
        if (mutableState.value.sessionId == sessionId) return
        mutableState.update { it.copy(sessionId = sessionId) }
    }

    /**
     * Opens a fresh diagnose stream for the selected session (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a non-empty session id or while a stream is already open (web `canStart` +
     * the hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val sessionId = mutableState.value.sessionId
        if (sessionId.isNullOrEmpty()) return
        if (mutableState.value.isStreaming) return
        logger.info("aiChargingDiagnosis.generate")
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .diagnose(sessionId)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no session id or generated text, so a diagnostics line can never leak fleet state. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_CHARGING_DIAGNOSIS_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIChargingDiagnosisSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIChargingDiagnosisViewModel(source, logger) }
            }
    }
}
