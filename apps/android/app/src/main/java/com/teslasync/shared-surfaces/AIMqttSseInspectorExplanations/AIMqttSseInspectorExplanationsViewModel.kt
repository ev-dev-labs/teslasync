// UI-thread-free state holder backing the AIMqttSseInspectorExplanations shared surface — the native port of the
// web component's `withAiFeature` gate + `useAiStream({ url:'/ai/system/streams/explain',
// body:{from_unix,to_unix} })` composition (web/src/components/ai/AIMqttSseInspectorExplanations.tsx). It binds
// the AI gate + explain stream (P1/S8) through [AIMqttSseInspectorExplanationsSource], reduces each parsed SSE
// frame onto the immutable [MqttExplainerState] surface (idle / streaming / done / failed, with last-known
// retained for the offline surface), and exposes the explain + retry actions plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [setWindow] / [generate] /
// [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

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
 * @param source the AI-gate + explain-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a window timestamp or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIMqttSseInspectorExplanationsViewModel(
    private val source: AIMqttSseInspectorExplanationsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(MqttExplainerState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected window (web `haveWindow` -> `canStart`), the stream
     * phase, the in-flight + last-committed explanation text, the classified error, and the freshness stamp. The
     * render boundary classifies this into an [ExplainerSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<MqttExplainerState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('mqtt-sse-inspector-explanations')`); `false` collapses
        // the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the active explanation window (web InnerSection's `fromUnix` / `toUnix` props). An invalid window
     * (absent bound, non-positive start, or end not after start) disables the explain action via
     * [MqttExplainerState.canStart], exactly as the web `haveWindow` guard disables the button.
     */
    fun setWindow(
        fromUnix: Long?,
        toUnix: Long?,
    ) {
        val next = ExplainerWindow(fromUnix, toUnix)
        if (mutableState.value.window == next) return
        mutableState.update { it.copy(window = next) }
    }

    /**
     * Opens a fresh explain stream for the selected window (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a valid window or while a stream is already open (web `canStart` + the hook's
     * in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val window = mutableState.value.window
        if (!window.isValid || mutableState.value.isStreaming) return
        val from = window.fromUnix as Long
        val to = window.toUnix as Long
        logger.info("aiMqttSseInspectorExplanations.generate")
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .explain(from, to)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no window timestamp or generated text, so a diagnostics line can never leak broker state. Call from
     * the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_MQTT_SSE_INSPECTOR_EXPLANATIONS_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIMqttSseInspectorExplanationsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIMqttSseInspectorExplanationsViewModel(source, logger) }
            }
    }
}
