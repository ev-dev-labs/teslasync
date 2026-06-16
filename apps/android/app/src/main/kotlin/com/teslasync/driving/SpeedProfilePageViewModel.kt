// The state holder backing the SpeedProfilePage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/driving/pages/SpeedProfilePage.tsx). It owns the page's local
// interaction state (the picked `[start, end]` window) as an immutable [SpeedProfileRange] snapshot, projects the
// raw `useSpeedProfile` analytics read onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState] (decoding the SI JSON into a typed [SpeedProfileData] on the way), exposes the
// supplementary `useDrives` list that enriches the per-bucket efficiency table + the scatter cloud, and derives
// the live display preferences from the settings document (web `useUnits`). Both feeds re-collect whenever the
// active vehicle changes (web `useSelectedVehicle`) or the window/refresh trigger bumps; with no vehicle in scope
// the analytics feed parks on an empty success (the web disabled-hook gap), which the page renders as its no-data
// empty state. All derivation logic lives in the framework-free model (SpeedProfilePageModel.kt); this holder is
// the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.speedprofile

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.DrivingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `range` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param zone the device time zone the window bounds resolve in (test seam; production uses the system default).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SpeedProfilePageViewModel(
    private val source: SpeedProfilePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val zone: ZoneId = ZoneId.systemDefault(),
) : BaseFeedViewModel(logger, scope) {
    private val mutableRange = MutableStateFlow(SpeedProfileRange.allTime(zone))
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The picked `[start, end]` window (web `useRangeState` value), default the all-time preset. */
    val range: StateFlow<SpeedProfileRange> = mutableRange.asStateFlow()

    /**
     * The speed-profile aggregate as cache-then-network UI state (web `useSpeedProfile`), decoded from the raw SI
     * JSON into a typed [SpeedProfileData]. Re-collected whenever the active vehicle, the window, or the refresh
     * trigger changes. Gated on a selected vehicle (web `enabled: vehicleId != null`): with no vehicle it parks on
     * an empty success the page renders as its no-data empty state.
     */
    val speedProfileState: StateFlow<UiState<SpeedProfileData>> =
        combine(source.selectedVehicleId(), mutableRange, refreshTrigger) { vehicleId, window, _ -> vehicleId to window }
            .flatMapLatest { (vehicleId, window) ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<SpeedProfileData>>(
                        Resource.Success(SpeedProfileData.EMPTY, fetchedAt = 0L, stale = false),
                    )
                } else {
                    source.speedProfile(vehicleId, window.start, window.end)
                        .map { resource -> resource.mapResource { json -> SpeedProfileData.parse(json) } }
                }
            }
            .asUiState(isEmpty = { it.isEmpty })

    /**
     * The vehicle's drives feeding the per-bucket efficiency table + the scatter cloud (web `useDrives`). Exposed
     * as the best-available list (cached or fresh) rather than a full UI state — it is supplementary to the primary
     * analytics feed, so a gap degrades the enrichment gracefully (empty scatter / no per-bucket efficiency)
     * without blanking the page.
     */
    val drives: StateFlow<List<Drive>> =
        combine(source.selectedVehicleId(), refreshTrigger) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf(emptyList())
                } else {
                    source.drives(vehicleId).map { resource -> resource.cached ?: emptyList() }
                }
            }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /**
     * The live display preferences derived from the settings document (web `useUnits`). Shared while observed;
     * falls back to the metric/2dp/en-US defaults before settings load so the first frame is never blank.
     */
    val displayPrefs: StateFlow<SpeedProfileDisplayPrefs> =
        source.settings()
            .map { resource -> SpeedProfileDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), SpeedProfileDisplayPrefs.default())

    /** Sets the picked window from the date-range control's epoch-day picks (web `setRange`). */
    fun setRange(
        startEpochDay: Long?,
        endEpochDay: Long?,
    ) {
        logger.info("speedProfile.range")
        mutableRange.value = SpeedProfileRange.fromEpochDays(startEpochDay, endEpochDay, zone)
    }

    /** Re-collect the analytics + drives feeds — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("speedProfile.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the analytics feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSpeedProfilePageOpened(logger)
    }
}
