// UI-thread-free state holder backing the Layout surface — the native port of the web shell's three
// reads (web/src/components/layout/Layout.tsx binds `useVehicles`, `useAlerts`, and `useIsForwardAuth`).
// It binds them through [LayoutSource] and performs no HTTP itself (ADR-002): the view collects [state],
// [alerts], and [isForwardAuth] and folds them through the pure [LayoutProjection]. The vehicle list is
// the surface's primary async dependency, so its cache-then-network lifecycle drives the shell's
// loading / content / empty / error / stale / offline states; the alert list and the auth-mode boolean
// enrich the chrome (badges, the SSE alert banner, nav visibility) without gating the phase.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Layout) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layout

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder for the Layout surface.
 *
 * The vehicle feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the shell's
 * content-host surface — loading (first fetch), content/empty (fleet present vs no vehicles), a hard
 * error with retry, and the stale/offline freshness envelope — without re-deriving the cache-then-network
 * contract. [alerts] feeds the unread badge + the SSE alert banner; [isForwardAuth] gates the auth-only
 * nav items. [refresh]/[retry] re-collect every feed (web `refetch`; the shared stores also replay their
 * latest and re-fetch on a mutation elsewhere), and [onViewOpened] emits the one PII-safe `view.opened`
 * diagnostic (P1/S11) — slug only, never a VIN, route, or alert body.
 *
 * @param source the three-feed seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LayoutViewModel(
    private val source: LayoutSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The enrolled-vehicle list as lifecycle-aware [UiState] — the surface's primary feed. An empty list
     * is treated as the structurally-empty phase (the shell's "no vehicles" content-host branch), so the
     * empty state is honest rather than a blank content frame.
     */
    val state: StateFlow<UiState<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The alert list as lifecycle-aware [UiState] — drives the unread badge + the latest-alert banner. */
    val alerts: StateFlow<UiState<List<Alert>>> =
        refreshTrigger
            .flatMapLatest { source.alerts() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The deployment auth-mode boolean (web `useIsForwardAuth`); `false` until the contract resolves. */
    val isForwardAuth: StateFlow<Boolean> =
        source
            .isForwardAuth()
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), false)

    /** Re-fetches every feed after a hard error (web `refetch`); backs the content-host retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches every feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN, route, or alert content. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to LayoutRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "layout.refresh"
        private const val STOP_TIMEOUT_MILLIS = 5_000L

        /** Wires the surface from the shared **S8** stores (web `useVehicles` + `useAlerts` + `useIsForwardAuth`). */
        fun create(
            vehiclesStore: VehiclesStore,
            notificationsStore: NotificationsStore,
            authModeStore: AuthModeStore,
            logger: Logger,
        ): LayoutViewModel = LayoutViewModel(StoreLayoutSource(vehiclesStore, notificationsStore, authModeStore), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LayoutSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LayoutViewModel(source, logger) }
            }
    }
}
