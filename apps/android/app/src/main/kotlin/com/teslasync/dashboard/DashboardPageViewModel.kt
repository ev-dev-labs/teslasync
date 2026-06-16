// The state holder backing the DashboardPage surface (P1/S8) — the native counterpart of the web page's two
// bound hooks (web/src/features/dashboard/pages/DashboardPage.tsx): `useAuthStatus` (the cache-then-network
// `GET /auth/status` read that decides the onboarding panel's connected/disconnected copy) and `useSyncVehicles`
// (the `POST /vehicles/sync` mutation the "Sync Vehicles" action fires). It projects the auth-status feed onto
// the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], tracks the in-flight sync flag
// for the button spinner (web `isPending`), and surfaces the sync outcome as a one-shot [UiEvent] for a toast.
// All derivation logic lives in the framework-free model (DashboardPageModel.kt) and the seam
// (DashboardPageSource.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.dashboard

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.settings.SettingsStore] +
 *   [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] adapter ↔ test fake); the view never does HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, `sync`, and `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardPageViewModel(
    private val source: DashboardPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableSyncing = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** Whether a "Sync Vehicles" mutation is in flight — the web `useSyncVehicles().isPending` spinner gate. */
    val syncing: StateFlow<Boolean> = mutableSyncing.asStateFlow()

    /**
     * The Tesla auth-status as a lifecycle-aware [UiState]: loading / content / error / stale / offline. It is
     * never "empty" (the web `useAuthStatus` always resolves to a present boolean either way), so the onboarding
     * panel always selects connected-vs-disconnected copy from the loaded snapshot; the loading phase draws the
     * panel skeleton and a hard error draws the retry surface. Re-collected whenever the refresh trigger bumps
     * (the panel's error-retry affordance, or a successful sync re-reading the feed).
     */
    val state: StateFlow<UiState<AuthStatus>> =
        refreshTrigger
            .flatMapLatest { source.authStatus() }
            .asUiState(isEmpty = { false })

    /**
     * Re-discovers vehicles from Tesla (web `useSyncVehicles().mutate()`), tracking the in-flight [syncing] flag
     * for the button spinner and surfacing the outcome as a one-shot [UiEvent] toast. On success it bumps the
     * refresh trigger so the auth-status feed re-reads (mirroring the web mutation invalidating its queries).
     * Never caches the result as if applied (ADR-013). A no-op while a sync is already running.
     */
    fun syncVehicles() {
        if (mutableSyncing.value) return
        logger.info("dashboard.sync.start")
        mutableSyncing.value = true
        launch {
            source.syncVehicles().fold(
                onSuccess = {
                    logger.info("dashboard.sync.ok")
                    emitEvent(UiEvent.CommandOutcome(commandKey = "vehicles.sync", success = true))
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { error ->
                    logger.warn("dashboard.sync.fail", mapOf("kind" to errorKindOf(error).name))
                    emitEvent(UiEvent.CommandOutcome(commandKey = "vehicles.sync", success = false))
                },
            )
            mutableSyncing.value = false
        }
    }

    /** Re-collect the auth-status feed — the web query `refetch` / the onboarding panel's error-retry affordance. */
    fun refresh() {
        logger.info("dashboard.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the auth-status hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Records a PII-safe diagnostic when a page-chrome affordance whose full engine is outside this parity unit
     * (the layout/widget/kiosk manager, or the cross-page connect navigation) is tapped. The chrome renders for
     * string + structure parity with the web header; its backing engine is owned elsewhere (see the log's scope
     * note). [action] is a stable dot-namespaced key, never user content.
     */
    fun recordChromeAction(action: String) {
        logger.info("dashboard.chrome", mapOf("action" to action))
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDashboardPageOpened(logger)
    }
}
