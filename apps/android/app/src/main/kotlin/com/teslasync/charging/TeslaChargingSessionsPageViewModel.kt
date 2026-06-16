// The state holder backing the TeslaChargingSessionsPage surface (P1/S8) — the native counterpart of the web page's
// three TanStack-Query hooks + the local VIN selector + the refresh mutation
// (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx). It projects the cache-then-network reads onto the
// shared lifecycle-aware [UiState] surface and performs no HTTP — all decode/derivation lives in the framework-free
// model (TeslaChargingSessionsPageModel.kt) and the seam (TeslaChargingSessionsPageSource.kt).
//
// The primary [sessions] feed re-collects whenever the selected VIN changes (web local `selectedVin` state) or the
// refresh trigger bumps; a `{ sessions: [] }` payload resolves to UiPhase.Empty (the web `sessions.length > 0` guard)
// so the table + chart + map show their friendly empty states. [vehicles] backs the VIN dropdown (web `useVehicles`),
// [displayPrefs] is the live `/settings`-derived currency + locale + SI energy boundary (web `useUnits`/`useFormatting`),
// and [refreshState] mirrors the web `refreshMutation.isPending` (spinning button) + `is403` (the
// "Business account required" hint). [refresh] runs the `POST …/refresh` sync; [retry] re-runs the `GET` read for the
// page's hard-error surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 charging pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessions

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingSessionsSource
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (the shared charging repository + the shared Vehicles / Settings holders in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaChargingSessionsPageViewModel(
    private val source: TeslaChargingSessionsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val selectedVinState = MutableStateFlow("")
    private val refreshStateMutable = MutableStateFlow(TeslaChargingRefreshState())
    private var viewOpenedRecorded = false

    /** The currently selected VIN, or `""` for the "All Vehicles" scope (web local `selectedVin` state). */
    val selectedVin: StateFlow<String> = selectedVinState.asStateFlow()

    /**
     * The `/tesla/charging/sessions` response as cache-then-network UI state: loading / content / empty (no sessions) /
     * stale / offline / error. Re-collected whenever the selected VIN changes or the refresh trigger bumps; an empty
     * `sessions` list resolves to the empty surface (web `sessions.length > 0`).
     */
    val sessions: StateFlow<UiState<TeslaChargingSessionsResponse>> =
        combine(selectedVinState, refreshTrigger) { vin, _ -> vin }
            .flatMapLatest { vin -> source.teslaChargingSessions(vin.ifEmpty { null }) }
            .map { it.toResponseResource() }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/vehicles` list as UI state, backing the VIN dropdown (web `useVehicles`); empty when no vehicle exists. */
    val vehicles: StateFlow<UiState<List<Vehicle>>> =
        source.vehicles().asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences (currency symbol + locale + SI energy formatter), re-derived as settings change. */
    val displayPrefs: StateFlow<TeslaChargingDisplayPrefs> =
        source
            .settings()
            .map { resource -> TeslaChargingDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = TeslaChargingDisplayPrefs.DEFAULT,
            )

    /** The refresh-mutation state — the spinning button (web `isPending`) + the 403 hint (web `is403`). */
    val refreshState: StateFlow<TeslaChargingRefreshState> = refreshStateMutable.asStateFlow()

    /** Selects [vin] as the active scope (`""` ⇒ all vehicles), re-collecting the sessions feed (web `setSelectedVin`). */
    fun selectVehicle(vin: String) {
        selectedVinState.value = vin
    }

    /**
     * Runs the `POST /tesla/charging/sessions/refresh` sync for the active VIN (web `refreshMutation.mutate`). Marks the
     * button pending, classifies a `403` failure as the "Business account required" hint, and re-collects the read feed
     * on success. A second tap while a sync is in flight is ignored (the web button is `disabled` while pending).
     */
    fun refresh() {
        logger.info("teslaChargingSessions.refresh")
        if (refreshStateMutable.value.pending) return
        launch {
            refreshStateMutable.update { it.copy(pending = true) }
            val result = source.refreshTeslaChargingSessions(selectedVinState.value.ifEmpty { null })
            refreshStateMutable.value =
                TeslaChargingRefreshState(pending = false, forbidden = result.isForbidden())
            if (result.isSuccess) refreshTrigger.update { it + 1 }
        }
    }

    /** Re-runs the cache-then-network `GET` read — the page's hard-error retry affordance (web `refetch`). */
    fun retry() {
        refreshTrigger.update { it + 1 }
    }

    /** Builds the embedded session-location map's seam for [vin] (web passes its `mapPoints` to `<TeslaChargingSessionsMap>`). */
    fun mapSource(vin: String?): ChargingSessionsSource = ChargingSessionsSource { source.mapSessions(vin) }

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaChargingSessionsPageOpened(logger)
    }

    /** Whether a failed sync was an HTTP 403 — the web `error.status === 403` business-account guard. */
    private fun Result<JsonElement>.isForbidden(): Boolean {
        val error = exceptionOrNull()
        return error is ApiError.Http && error.status == HTTP_FORBIDDEN
    }
}
