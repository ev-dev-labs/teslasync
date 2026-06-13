// UI-thread-free state holder backing the RequiresAuth shared surface — the native port of the web component's
// `useAuthMode` read (web/src/components/feedback/RequiresAuth.tsx gates its children over the auth-mode query).
// It binds the shared S8 auth-mode feed through [RequiresAuthSource], re-shares it as a lifecycle-aware [UiState]
// of the render-relevant [AuthModeView], and exposes the PII-safe one-shot `view.opened` diagnostic. The view
// performs no HTTP itself (ADR-002): it only collects [state] and folds it through the pure
// [RequiresAuthProjection]. The auth-mode contract is the genuine async dependency the gate resolves, so its
// cache-then-network lifecycle (loading / success / error / stale / offline) drives the surface's outcomes — the
// projection maps each onto the web's children-or-notice branches (see RequiresAuthModel.kt).
//
// A single holder serves every wrapped section on a screen: the contract feed is capability-agnostic, and each
// [RequiresAuth] call applies its own [RequiresAuthCapability] at the render boundary, so one shared store +
// one ViewModel gate any number of sections without re-fetching.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RequiresAuth) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.requiresauth

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/**
 * State holder for the RequiresAuth surface.
 *
 * The shared auth-mode feed is re-shared as a lifecycle-aware [UiState] of [AuthModeView] so the composable can
 * resolve the gate — render the children (web `forward_auth && capabilities[capability]`) or the auth notice
 * (every other state) — without re-deriving the cache-then-network contract. The contract is never "empty" in the
 * structural sense (its value is always a meaningful gate decision), so the surface is classified by
 * [RequiresAuthProjection] from the best-known cached value rather than a [io.teslasync.android.data.UiPhase].
 *
 * [refresh]/[retry] re-fetch the contract (web's window-focus refetch; backs the view's ADR-013 stale
 * auto-refresh), and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never
 * the auth mode or provider hint.
 *
 * @param source the auth-mode feed seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class RequiresAuthViewModel(
    private val source: RequiresAuthSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The auth-mode contract as a lifecycle-aware [UiState] of the render-relevant [AuthModeView]. Marked never
     * structurally empty: the gate (children vs notice) is decided by [RequiresAuthProjection], not by a payload
     * being empty, so the phase stays Loading / Content / Error and the projection reads the cached contract.
     */
    val state: StateFlow<UiState<AuthModeView>> =
        source.authMode
            .map { it.mapToView() }
            .asUiState(isEmpty = { false })

    /** Re-fetches the auth-mode contract; backs the hard-failure retry affordance and the stale auto-refresh. */
    fun refresh() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.refresh()
    }

    /** Re-fetches the auth-mode contract after a failure; backs the retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no auth mode, capability, or provider hint. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        RequiresAuthDiagnostics.recordViewOpened(logger)
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(SURFACE_KEY to RequiresAuthRegistration.SLUG)

    private fun Resource<AuthModeResponse>.mapToView(): Resource<AuthModeView> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(AuthModeView::fromResponse), fetchedAt, stale)
            is Resource.Success -> Resource.Success(AuthModeView.fromResponse(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(AuthModeView::fromResponse), fetchedAt, stale, error)
        }

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_REFRESH = "requiresAuth.refresh"

        /** Wires the surface from the shared **S8** [AuthModeStore] auth-mode feed (web `useAuthMode`). */
        fun create(
            store: AuthModeStore,
            logger: Logger,
        ): RequiresAuthViewModel = RequiresAuthViewModel(store.asRequiresAuthSource(), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: RequiresAuthSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { RequiresAuthViewModel(source, logger) }
            }
    }
}
