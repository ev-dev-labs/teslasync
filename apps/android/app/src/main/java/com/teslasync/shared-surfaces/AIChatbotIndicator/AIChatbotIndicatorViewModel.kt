// UI-thread-free state holder backing the AIChatbotIndicator shared surface — the native port of the web
// component's `withAiFeature('chatbot-llm', …)` visibility gate (web/src/components/ai/AIChatbotIndicator.tsx).
// It binds the AI-feature gate (P1/S8) through [AIChatbotIndicatorSource], folds each emission into the immutable
// [ChatbotIndicatorState], and exposes the PII-safe one-shot `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] and calls [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIChatbotIndicator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [AIChatbotIndicator] surface — the Android port of the web
 * `withAiFeature('chatbot-llm', …)` gate over `useAiEnabled`.
 *
 * It subscribes to the injected [AIChatbotIndicatorSource] gate seam (the P1/S8 boundary) for its whole lifetime
 * and folds each emission into [ChatbotIndicatorState], so the render boundary can classify the surface as the
 * Helix chip (gate open) or nothing (gate closed) — the fail-closed web `withAiFeature` contract. The badge body
 * is static, so there is no further lifecycle to project (the same documented rationale as the accepted
 * VisuallyHidden sibling); the view stays a thin renderer (ADR-002). It owns no networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the AI-feature gate seam (a shared-AI-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's emissions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying only
 *   the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIChatbotIndicatorViewModel(
    private val source: AIChatbotIndicatorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(ChatbotIndicatorState())
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the resolved AI-feature gate. The render boundary classifies this into an
     * [IndicatorSurface]; the gate is fail-closed, so the surface stays hidden until it resolves to enabled.
     */
    val state: StateFlow<ChatbotIndicatorState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('chatbot-llm')` via `withAiFeature`); `false` hides the chip.
        launch { source.featureEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no settings value or generated text, so a diagnostics line can never leak fleet state. Call from
     * the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChatbotIndicatorOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIChatbotIndicatorSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIChatbotIndicatorViewModel(source, logger) }
            }
    }
}
