// UI-thread-free state holder backing the AISafetySettingExplainer surface — the native port of the web
// component's hook composition (web/src/components/ai/AISafetySettingExplainer.tsx). It binds two shared
// P1/S8 concerns and performs no HTTP itself (ADR-002): the [SettingsStore] document for the AI-Off gate
// (web `withAiFeature` → `useAiEnabled`) and the [AiExplainStreamSource] seam for the on-demand narration
// stream (web `useAiStream`). The view never performs HTTP — it only collects [state] and calls
// [explain]/[cancel]/[retry]/[onViewOpened]. Unlike the per-vehicle narrators, this surface has no
// vehicle scope (the web body is `{}`; the backend reads identity from the ForwardAuth subject).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AISafetySettingExplainer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State holder for the gated safety-setting narrator card.
 *
 * The AI-Off gate is derived from the shared settings holder and folded into a single [state] alongside
 * the streamed-narration sub-state. [explain] opens the stream (no-op while one is already running, web
 * `start()`), [cancel] aborts it back to idle (web `cancel()`), and [retry] re-runs it. [onViewOpened]
 * emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never any narration content.
 *
 * @param gate the AI-Off gate stream (web `useAiEnabled`); the surface is hidden until it emits `true`.
 * @param source the narration stream seam (a shared-client adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AISafetySettingExplainerViewModel(
    gate: Flow<Boolean>,
    private val source: AiExplainStreamSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AISafetySettingExplainerState(gateEnabled = false))

    /** The gated narration surface state (gate / idle / streaming / content / error), folded from all sources. */
    val state: StateFlow<AISafetySettingExplainerState> = mutableState.asStateFlow()

    private var explainJob: Job? = null
    private var viewOpenedRecorded = false

    init {
        // The AI-Off gate (web `useAiEnabled`): fail-closed until the gate stream first emits.
        launch { gate.collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Opens a narration run (web `stream.start()`); a no-op unless [AISafetySettingExplainerState.canStart]. */
    fun explain() {
        val current = mutableState.value
        if (!current.canStart) return
        logger.info(EVENT_EXPLAIN, mapOf("surface" to AISafetySettingExplainerRegistration.SLUG))
        mutableState.update { AISafetySettingExplainerProjection.startExplain(it) }
        explainJob?.cancel()
        explainJob =
            stateScope.launch {
                source.explain().collect { event ->
                    mutableState.update { AISafetySettingExplainerProjection.reduceExplain(it, event) }
                }
                mutableState.update { AISafetySettingExplainerProjection.finishExplain(it) }
            }
    }

    /** Aborts an in-flight narration back to idle (web `cancel()` → AbortError → idle). */
    fun cancel() {
        explainJob?.cancel()
        explainJob = null
        mutableState.update { run ->
            if (run.phase == ExplainPhase.Streaming) run.copy(phase = ExplainPhase.Idle) else run
        }
    }

    /** Retry after a failure — re-runs the narration (backs the error surface's retry affordance). */
    fun retry() = explain()

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("surface" to AISafetySettingExplainerRegistration.SLUG))
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_EXPLAIN = "safetySettingExplainer.explain"

        /**
         * Wires the surface from the shared [SettingsStore] (P1/S8) and the shared resilient
         * [ApiHttpClient] (the narration stream seam). The gate is the settings document's
         * `ai_mode`/`ai_features` (web `useAiEnabled`).
         */
        fun create(
            settings: SettingsStore,
            client: ApiHttpClient,
            logger: Logger,
        ): AISafetySettingExplainerViewModel =
            AISafetySettingExplainerViewModel(
                gate =
                    settings.settings().map {
                        AISafetySettingExplainerProjection.isSafetyExplainerEnabled(it.cached)
                    },
                source = client.asAiExplainStreamSource(),
                logger = logger,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            settings: SettingsStore,
            client: ApiHttpClient,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    create(settings, client, logger)
                }
            }
    }
}
