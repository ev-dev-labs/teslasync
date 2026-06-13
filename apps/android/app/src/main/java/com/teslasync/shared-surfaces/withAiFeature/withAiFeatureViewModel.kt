// UI-thread-free state holder backing the withAiFeature shared surface — the native port of the web component's
// `withAiFeature(feature, Inner)` visibility gate (web/src/components/ai/withAiFeature.tsx). It binds the
// AI-feature gate (P1/S8) through [WithAiFeatureSource] for the bound [feature], folds each emission into the
// immutable [WithAiFeatureState], and exposes the PII-safe one-shot `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/withAiFeature) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` for the camelCase web-source file name (`withAiFeature`).
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.withaifeature

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
 * Lifecycle-aware state holder backing the Compose [WithAiFeature] surface — the Android port of the web
 * `withAiFeature(feature, Inner)` gate over `useAiEnabled`.
 *
 * It subscribes to the injected [WithAiFeatureSource] gate seam (the P1/S8 boundary) for the bound [feature] for
 * its whole lifetime and folds each emission into [WithAiFeatureState], so the render boundary can classify the
 * surface as the wrapped inner content (gate open) or nothing (gate closed) — the fail-closed web `withAiFeature`
 * contract. The inner content is supplied by the caller, so there is no further lifecycle to project (the same
 * documented rationale as the accepted AIChatbotIndicator sibling); the view stays a thin renderer (ADR-002). It
 * owns no networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the AI-feature gate seam (a shared-AI-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's emissions.
 * @param feature the AI feature id this gate is bound to (web `withAiFeature(feature, …)` argument); the
 *   composable validates it is registered before constructing this holder.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying only
 *   the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class WithAiFeatureViewModel(
    private val source: WithAiFeatureSource,
    private val feature: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(WithAiFeatureState())
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the resolved AI-feature gate. The render boundary classifies this into a
     * [GateSurface]; the gate is fail-closed, so the surface stays hidden until it resolves to enabled.
     */
    val state: StateFlow<WithAiFeatureState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled(feature)` via `withAiFeature`); `false` hides the content.
        launch { source.aiEnabled(feature).collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no settings value, bound feature, or generated text, so a diagnostics line can never leak fleet
     * state. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordWithAiFeatureOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for [feature]. */
        fun factory(
            source: WithAiFeatureSource,
            feature: String,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WithAiFeatureViewModel(source, feature, logger) }
            }
    }
}
