// UI-thread-free state holder backing the ImpersonationBanner surface — the native port of the web
// `useImpersonationStatus` + `useEndImpersonation` reads (web/src/components/feedback/ImpersonationBanner.tsx
// renders the bar over the impersonation-state query and fires the end mutation). It binds the shared S8
// impersonation feed through [ImpersonationBannerSource] and performs no HTTP itself (ADR-002): the view
// collects [state] + [ending] and folds them through the pure [ImpersonationBannerProjection]. The
// impersonation-state document is the genuine async dependency a self-contained security bar resolves, so its
// cache-then-network lifecycle drives the surface's loading / hidden / active / error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ImpersonationBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.impersonationbanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * State holder for the ImpersonationBanner surface.
 *
 * The shared impersonation feed is re-shared as a lifecycle-aware [UiState] so the composable can switch
 * surfaces — loading (first fetch), the active bar (web content branch), the hidden non-impersonating state
 * (web `null`), a hard error with retry, and the stale/offline freshness envelope — without re-deriving the
 * cache-then-network contract. A non-active mode (Inactive/Open) is treated as structurally empty so the
 * surface honestly resolves to [io.teslasync.android.data.UiPhase.Empty] rather than a false content frame.
 *
 * [endImpersonation] fires the shared end mutation (web `endMut.mutate()`), exposing [ending] (web
 * `endMut.isPending`) so the button shows "Ending…" + disables while in flight; [refresh]/[retry] re-fetch the
 * feed (web polling / the stale auto-refresh); and [onViewOpened] emits the one PII-safe `view.opened`
 * diagnostic (P1/S11) — slug only, never the target or the original admin.
 *
 * @param source the impersonation feed + end-mutation seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ImpersonationBannerViewModel(
    private val source: ImpersonationBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val endingState = MutableStateFlow(false)

    /** `true` while the end mutation is in flight — the web `endMut.isPending` (button shows "Ending…", disabled). */
    val ending: StateFlow<Boolean> = endingState.asStateFlow()

    /**
     * The impersonation state as lifecycle-aware [UiState]. A non-active session (Inactive/Open) is treated as
     * structurally empty, so the surface's hidden state is honest rather than a blank active frame.
     */
    val state: StateFlow<UiState<ImpersonationBannerView>> =
        source.status
            .map { it.mapToView() }
            .asUiState(isEmpty = { it.mode != ImpersonationMode.Active })

    /**
     * Ends the current impersonation session (web `endMut.mutate()`). Guards against a double-fire while one is
     * in flight; the shared store wipes the cache + primes inactive on success and refreshes both feeds, so the
     * bar flips to hidden without an extra call here. [ending] resets when the mutation settles.
     */
    fun endImpersonation() {
        if (endingState.value) return
        endingState.update { true }
        logger.info(EVENT_END, surfaceField)
        launch {
            source.endImpersonation()
            endingState.update { false }
        }
    }

    /** Re-fetches the impersonation feed (web polling); backs the hard-error retry and the stale auto-refresh. */
    fun refresh() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
    }

    /** Re-fetches the impersonation feed after a hard error; backs the retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no target, original admin, or expiry. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ImpersonationBannerDiagnostics.recordViewOpened(logger)
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(SURFACE_KEY to ImpersonationBannerRegistration.SLUG)

    private fun Resource<ImpersonationStatus>.mapToView(): Resource<ImpersonationBannerView> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(cached?.let(ImpersonationBannerView::fromStatus), fetchedAt, stale)
            is Resource.Success ->
                Resource.Success(ImpersonationBannerView.fromStatus(data), fetchedAt, stale)
            is Resource.Error ->
                Resource.Error(cached?.let(ImpersonationBannerView::fromStatus), fetchedAt, stale, error)
        }

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_REFRESH = "impersonationBanner.refresh"
        private const val EVENT_END = "impersonationBanner.end"

        /** Wires the surface from the shared **S8** [ImpersonationStore] impersonation feed (web `useImpersonation`). */
        fun create(
            store: ImpersonationStore,
            logger: Logger,
        ): ImpersonationBannerViewModel = ImpersonationBannerViewModel(store.asImpersonationBannerSource(), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ImpersonationBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ImpersonationBannerViewModel(source, logger) }
            }
    }
}
