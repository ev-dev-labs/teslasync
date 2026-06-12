// UI-thread-free state holder backing the OnboardingGate feature view — the native port of the gate read the
// web component owns (web/src/features/onboarding/components/OnboardingGate.tsx: `useOnboardingStatus`). It
// binds the shared **S8** onboarding feed through [OnboardingGateSource], folds each cache-then-network
// emission onto the shared [UiState] surface (loading / content / stale / offline / error), and exposes the
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// [status] and calls [refresh]/[retry]/[onViewOpened]; the guard decision itself is computed at the render
// boundary from [status] + the hoisted skip flag + path (the web effect's inputs).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OnboardingGate) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.onboardinggate

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network onboarding-status seam (a shared-S8-store adapter in production, a fake
 *   in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingGateViewModel(
    private val source: OnboardingGateSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual re-check affordance), exactly as
    // the sibling AutopilotSection view-model does for its shared feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The onboarding gate read as a lifecycle-aware [UiState]: loading (first read in flight) / content (a
     * resolved gate) / stale + offline (a cached gate served after a failed refresh) / error (a hard failure
     * with no cache). The gate payload is never structurally empty — every resolved status is an actionable
     * gate value — so the empty phase is intentionally unreachable here. The render boundary turns this into
     * the guard decision (web `[data, isLoading, isError]` inputs).
     */
    val status: StateFlow<UiState<OnboardingStatus>> =
        refreshTrigger
            .flatMapLatest { source.status() }
            .asUiState { false }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no gate anchors / path / skip payload, so a diagnostics line can never leak the user's setup
     * posture. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        OnboardingGateDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network read (the web hook's poll / `refetch` after a connect or vehicle sync). */
    fun refresh() {
        logger.info("onboardingGate.refresh")
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the redirect surface's freshness retry. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: OnboardingGateSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { OnboardingGateViewModel(source, logger) }
            }
    }
}
