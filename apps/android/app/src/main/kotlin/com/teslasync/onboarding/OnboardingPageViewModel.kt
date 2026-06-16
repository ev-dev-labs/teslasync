// The state holder backing the OnboardingPage surface (P1/S8) — the native counterpart of the web page's
// `useOnboardingStatus` TanStack-Query hook (web/src/features/onboarding/pages/OnboardingPage.tsx). It projects
// the single cache-then-network read (`GET /onboarding/status`) onto the shared lifecycle-aware [UiState]
// surface via [BaseFeedViewModel.asUiState]. The gate payload is never structurally empty — every resolved
// status is an actionable checklist value (defaulting to "nothing set up yet") — so the empty phase is
// intentionally unreachable; the render layer always paints the checklist, switching only between the first-load
// spinner (loading) and the resolved panel (content/success). All derivation lives in the framework-free model
// (OnboardingPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/onboarding) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.onboarding

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
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.onboarding.OnboardingStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingPageViewModel(
    private val source: OnboardingPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual re-check affordance), exactly as
    // the sibling OnboardingGate view-model does for the same shared gate.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The onboarding gate as cache-then-network UI state: loading (the first read in flight with nothing cached,
     * the web `PageContainer loading={isLoading}` spinner) / content (a resolved gate — the checklist panel) /
     * stale + offline (a cached gate served after a failed refresh) / error (a hard failure with no cache; the
     * render layer still paints the pessimistic checklist, matching the web hook's "assume not complete on
     * failure" intent). The empty predicate is constant-false because the gate is never structurally empty.
     */
    val status: StateFlow<UiState<OnboardingStatus>> =
        refreshTrigger
            .flatMapLatest { source.status() }
            .asUiState { false }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no gate anchors, so a diagnostics line can never leak the user's setup posture. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordOnboardingPageOpened(logger)
    }

    /** Re-runs the cache-then-network read (the web hook's 30s poll / `refetch` after a connect or vehicle sync). */
    fun refresh() {
        logger.info("onboarding.refresh")
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the freshness/offline retry affordance. */
    fun retry(): Unit = refresh()
}
