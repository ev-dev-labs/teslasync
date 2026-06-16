// The state holder backing the SecurityAccessPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/admin/pages/SecurityAccessPage.tsx). It binds the two
// cache-then-network reads (`useVehicles`, `useSecurityEvents`) onto the shared lifecycle-aware [UiState] surface
// via [BaseFeedViewModel.asUiState]: the per-vehicle security history is decoded into the page's [SecurityAccessData]
// projection, and the fleet feed self-heals the app-wide selection (web `useSelectedVehicle` defaulting to the
// first vehicle) while surfacing list-load failures in the same error banner the web page shows. The security feed
// is gated on a selected vehicle (web `enabled: !!vehicleId`) so nothing is fetched until one resolves. All
// derivation logic lives in the framework-free model (SecurityAccessPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.securityaccess

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.admin.AdminStore] adapter ↔ test fake); the view never performs HTTP.
 * @param selection the app-scoped active-vehicle holder (web `useSelectedVehicle`); the security feed tracks it
 *   and the fleet feed reconciles it (self-healing default-to-first).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecurityAccessPageViewModel(
    private val source: SecurityAccessSource,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val vehiclesRefresh = MutableStateFlow(0)
    private val securityRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The fleet list as cache-then-network UI state (web `useVehicles`). Its only on-screen role is the list-load
     * error banner, but it also self-heals the app-wide selection: each emission reconciles
     * [SelectedVehicleStore] against the enrolled ids so a cold start defaults to the first vehicle (web
     * `useSelectedVehicle`). Re-collected when [refreshVehicles] bumps.
     */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        vehiclesRefresh
            .flatMapLatest { source.vehicles() }
            .onEach { resource -> resource.cached?.let { list -> selection.reconcile(list.map(Vehicle::id)) } }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The selected vehicle's security history as cache-then-network UI state (web `useSecurityEvents`). The raw
     * `GET /security` JSON array is decoded into the page's [SecurityAccessData] projection (latest snapshot +
     * derived secure/sentry stats). Gated on a selected vehicle (web `enabled: !!vehicleId`): with none it parks
     * on a loading sentinel until the fleet feed reconciles one. Re-collected whenever the selection changes or
     * [refresh] bumps.
     */
    val securityState: StateFlow<UiState<SecurityAccessData>> =
        combine(selection.selectedId, securityRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null) loadingFeed() else source.securityEvents(id.toString())
            }
            .map { resource -> resource.mapData { SecurityAccessData.from(it) } }
            .asUiState(isEmpty = { it.isEmpty })

    // ── Refresh / retry (web query `refetch` + the error-state retry) ────────────────────────────────────────────

    /** Re-collect the security history feed — the web `refetchInterval` / error-retry affordance. */
    fun refresh() {
        logger.info("securityAccess.refresh")
        securityRefresh.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface (the error banner's Retry button). */
    fun retry(): Unit = refresh()

    /** Re-collect the fleet list — the list-load error banner's retry affordance. */
    fun refreshVehicles() {
        logger.info("securityAccess.refreshVehicles")
        vehiclesRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSecurityAccessPageOpened(logger)
    }

    private fun loadingFeed(): Flow<Resource<JsonElement>> = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))
}
