// The state holder backing the ChargingDetailPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/charging/pages/ChargingDetailPage.tsx). It projects the four
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface, scoped to the [sessionId] route argument
// (web `useParams().id`), and derives the display preferences (distance + temperature unit + precision + locale +
// cost) from the live `/settings` document (web `useUnits` / `useFormatting`). All decode/derivation logic lives in the
// framework-free model (ChargingDetailPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the `/charging/{id}` session read (web `session`): a no-session payload resolves to UiPhase.Empty
// via [ChargingSessionDetail.hasData] so the page shows its empty state (the web `!session` guard), and it re-collects
// whenever the refresh trigger bumps. The vehicle + live-telemetry feeds are derived from the loaded session's
// `vehicle_id` (web `useVehicle(session?.vehicle_id)` / `useChargingTelemetryLatest(session?.vehicle_id)`), and the
// per-session telemetry feed is its own lifecycle-aware [UiState] — so every panel renders its own loading / content /
// empty surface without ever hiding a section (web per-section truthiness guards).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingdetail

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the page-local charging repository + the shared Settings holder in production ↔ a
 *   test fake); the view never performs HTTP.
 * @param sessionId the numeric charging-session id from the route argument (web `Number(useParams().id)`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingDetailPageViewModel(
    private val source: ChargingDetailPageSource,
    private val sessionId: Long,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The primary `/charging/{id}` feed as cache-then-network UI state (web `session`). Re-collected when refresh
     * bumps; a no-session payload resolves to the empty surface (web `!session`).
     */
    val session: StateFlow<UiState<ChargingSessionDetail>> =
        refreshTrigger
            .flatMapLatest { source.chargingSessionDetail(sessionId) }
            .map { it.mapData(::parseSession) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/charging/{id}/telemetry` feed (web `useChargeTelemetry`) — empty when no readings exist. */
    val telemetry: StateFlow<UiState<List<ChargeTelemetryReading>>> =
        refreshTrigger
            .flatMapLatest { source.chargeTelemetry(sessionId) }
            .map { it.mapData(::parseTelemetry) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The active vehicle id derived from the loaded session (web `session?.vehicle_id`); null until it loads. */
    private val vehicleIdFlow: Flow<Long?> =
        session
            .map { it.data?.vehicleId?.takeIf { id -> id > 0L } }
            .distinctUntilChanged()

    /** The `/vehicles/{id}` feed (web `useVehicle`) — empty when no named vehicle resolves for the session. */
    val vehicle: StateFlow<UiState<VehicleInfo>> =
        vehicleIdFlow
            .flatMapLatest { id -> id?.let(source::vehicle) ?: emptyObjectFeed }
            .map { it.mapData(::parseVehicle) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/charging-telemetry/latest` feed (web `useChargingTelemetryLatest`) — empty when no live snapshot. */
    val live: StateFlow<UiState<ChargingTelemetrySnapshot>> =
        vehicleIdFlow
            .flatMapLatest { id -> id?.let(source::chargingTelemetryLatest) ?: emptyObjectFeed }
            .map { it.mapData(::parseLiveTelemetry) }
            .asUiState(isEmpty = { !it.present })

    /** The live display preferences (units + precision + locale + cost), re-derived as settings change. */
    val displayPrefs: StateFlow<ChargingDisplayPrefs> =
        source
            .settings()
            .map { resource -> ChargingDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ChargingDisplayPrefs.DEFAULT,
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("charging.detail.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no session id / vehicle id / energy / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChargingDetailOpened(logger)
    }

    private companion object {
        /** The synthetic "no vehicle yet" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
