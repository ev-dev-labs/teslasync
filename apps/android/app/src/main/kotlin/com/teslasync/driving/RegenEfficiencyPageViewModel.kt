// The state holder backing the RegenEfficiencyPage driving surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/RegenEfficiencyPage.tsx). It owns the page's local
// range selection (web `useRangeState`, default preset `'all'`), projects the backend `useRegenEfficiency` analytics
// read and the client-side `useDrives` read onto the shared lifecycle-aware [UiState] surface, scoped to the global
// active vehicle (web `useSelectedVehicle`), and derives the live display preferences from the `/settings` document
// (web `useUnits`). All decode/derivation logic lives in the framework-free model (RegenEfficiencyPageModel.kt); this
// holder is the thin orchestration layer and performs no HTTP.
//
// The regen feed re-collects whenever the active vehicle changes, the range changes, or the refresh trigger bumps; an
// absent / empty payload (or no vehicle — web `enabled: !!vehicleId`) resolves to UiPhase.Empty via
// [RegenEfficiencyAnalytics.present] so the body shows its `regen.noData` empty state (the web `data ?` guard). The
// drives feed re-collects on vehicle change / refresh and is folded — windowed by the active range — into the trend
// chart + recent-drives table; it never gates the page, so each of those sections renders its own empty surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.regenefficiency

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate

/**
 * @param source the P1/S8 data seam (the real shared driving repository + the app-scoped active-vehicle selection +
 *   the shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RegenEfficiencyPageViewModel(
    private val source: RegenEfficiencyPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableRange = MutableStateFlow(RegenRange.allTime())
    private var viewOpenedRecorded = false

    /** The active range window (web `useRangeState` value) that scopes both the analytics read and the drives window. */
    val range: StateFlow<RegenRange> = mutableRange.asStateFlow()

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The backend `/analytics/regen` feed as cache-then-network UI state (web `useRegenEfficiency`). Re-collected when
     * the active vehicle changes, the range changes, or refresh bumps; an absent payload (or no selection — web
     * `enabled: !!vehicleId`) resolves to the empty surface (web `regen.noData`).
     */
    val regenState: StateFlow<UiState<RegenEfficiencyAnalytics>> =
        combine(source.selectedVehicleId(), mutableRange, refreshTrigger) { id, range, _ -> id to range }
            .flatMapLatest { (id, range) ->
                val vehicleId = id.activeId()
                if (vehicleId == null) {
                    emptyObjectFeed
                } else {
                    source.regenEfficiency(vehicleId, range.startParam, range.endParam)
                }
            }
            .map { it.mapData(::parseRegenAnalytics) }
            .asUiState(isEmpty = { !it.present })

    /**
     * The `GET /drives` feed as cache-then-network UI state (web `useDrives`). Re-collected on vehicle change / refresh;
     * gated on a selected vehicle (web `enabled: !!vehicleId`). Feeds the windowed monthly-trend chart + recent-drives
     * table — it never gates the page, so those sections render their own empty surfaces.
     */
    val drivesState: StateFlow<UiState<List<Drive>>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) {
                    flowOf<Resource<List<Drive>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.drives(vehicleId)
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric/2dp. */
    val displayPrefs: StateFlow<RegenDisplayPrefs> =
        source
            .settings()
            .map { resource -> RegenDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = RegenDisplayPrefs.default(),
            )

    /** Applies a new `[start, end]` window (web `RangePicker` `onChange` / `setRange`). A no-op when unchanged. */
    fun setRange(
        start: LocalDate,
        end: LocalDate,
    ) {
        val next = if (start.isAfter(end)) RegenRange(end, start) else RegenRange(start, end)
        mutableRange.update { current -> if (current == next) current else next }
    }

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("regen.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / distance / energy payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordRegenEfficiencyPageOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
