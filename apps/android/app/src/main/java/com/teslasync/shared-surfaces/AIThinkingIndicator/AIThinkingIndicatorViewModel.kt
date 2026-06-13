// UI-thread-free state holder backing the AIThinkingIndicator shared surface — the native port of the web
// component's reduced-motion gating (web/src/components/ai/AIThinkingIndicator.tsx, the `motion-safe:` variant).
// It binds the reduced-motion signal (P1/S8) through [AIThinkingIndicatorSource], folds each emission into the
// immutable [ThinkingIndicatorState], and exposes the PII-safe one-shot `view.opened` diagnostic. The label is a
// pure render parameter threaded through the composable (web's `label` prop), so it is not held here. The view
// never performs HTTP — it only collects [state] and calls [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIThinkingIndicator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

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
 * Lifecycle-aware state holder backing the Compose [AIThinkingIndicator] surface — the Android port of the web
 * indicator's `prefers-reduced-motion` gating.
 *
 * It subscribes to the injected [AIThinkingIndicatorSource] reduced-motion seam (the P1/S8 boundary) for its
 * whole lifetime and folds each emission into [ThinkingIndicatorState], so the render boundary can switch between
 * the animated indicator (full motion) and the static skeleton (reduced motion) — the web `motion-safe:`
 * contract. The label is a pure render parameter (web's `label` prop), not part of the bound state; the view
 * stays a thin renderer (ADR-002). It owns no networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the reduced-motion seam (a platform-motion adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's emissions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying only
 *   the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIThinkingIndicatorViewModel(
    private val source: AIThinkingIndicatorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(ThinkingIndicatorState())
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the resolved reduced-motion preference. The render boundary projects this (with the
     * caller's label) into the indicator; it defaults to full motion until the preference resolves.
     */
    val state: StateFlow<ThinkingIndicatorState> = mutableState.asStateFlow()

    init {
        // Bind the reduced-motion signal (web `prefers-reduced-motion`); `true` freezes the bounce + shimmer.
        launch {
            source.reducedMotion().collect { reduced -> mutableState.update { it.copy(reducedMotion = reduced) } }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no label text or model output, so a diagnostics line can never leak fleet state or the prompt. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordThinkingIndicatorOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIThinkingIndicatorSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIThinkingIndicatorViewModel(source, logger) }
            }
    }
}
