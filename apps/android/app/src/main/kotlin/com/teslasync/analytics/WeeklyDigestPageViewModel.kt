// The state holder backing the WeeklyDigestPage analytics surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/analytics/pages/WeeklyDigestPage.tsx + useWeeklyDigest). It
// projects the `useWeeklyDigest` cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to
// the page's selected vehicle (web `vehicleId || vehicles[0].id`), exposes the enrolled-vehicle options for the
// vehicle `<Select>`, and derives the display preferences (distance unit + currency) from the live `/settings`
// document (web `useUnits`/`useFormatting`). All decode/derivation logic lives in the framework-free model
// (WeeklyDigestPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The digest feed re-collects whenever the effective vehicle changes (a new `/vehicles/{id}/weekly-digest` read) or
// the refresh trigger bumps. Until a vehicle resolves (a cold start, or an empty fleet) the surface projects the
// enrolled-vehicle feed instead (loading → error → empty) via [toNoVehicleDigest], so the three declared data states
// stay reachable without a vehicle id. An all-zero week resolves to UiPhase.Empty via [WeeklyDigest.hasData] so the
// surface shows the empty-state (web `noData` / `noDataMessage`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.weeklydigest

import io.teslasync.android.components.forms.VehicleOption
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.analytics.AnalyticsStore] +
 *   [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.settings.SettingsStore] +
 *   [io.teslasync.android.data.SelectedVehicleStore] adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WeeklyDigestPageViewModel(
    private val source: WeeklyDigestPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The enrolled vehicles as picker options (web `vehicleOptions`): a stable id + display name (VIN fallback). */
    val vehicleOptions: StateFlow<List<VehicleOption>> =
        source
            .vehicles()
            .map { resource -> (resource.cached ?: emptyList()).map { v -> VehicleOption(v.id, v.displayName.ifBlank { v.vin }) } }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = emptyList(),
            )

    /** The effective selected vehicle, web `vehicleId || vehicles[0].id`: the explicit choice, else the first vehicle. */
    val selectedVehicleId: StateFlow<Long?> =
        combine(source.selectedVehicleId(), vehicleOptions) { selected, options -> selected ?: options.firstOrNull()?.id }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = null,
            )

    /**
     * The decoded weekly-digest payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Re-collected whenever the effective vehicle changes or the
     * refresh trigger bumps. Before a vehicle resolves it projects the enrolled-vehicle feed (loading / error / empty)
     * so the data states stay reachable; an all-zero week resolves to the empty surface via [WeeklyDigest.hasData].
     */
    val state: StateFlow<UiState<WeeklyDigest>> =
        combine(source.vehicles(), source.selectedVehicleId(), refreshTrigger) { vehiclesRes, selected, _ -> vehiclesRes to selected }
            .flatMapLatest { (vehiclesRes, selected) ->
                val effectiveId = selected ?: vehiclesRes.cached?.firstOrNull()?.id
                if (effectiveId != null) {
                    source.weeklyDigest(effectiveId.toString()).map { resource -> resource.mapData(::parseWeeklyDigest) }
                } else {
                    flowOf(vehiclesRes.toNoVehicleDigest())
                }
            }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (distance unit + currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<WeeklyDigestDisplayPrefs> =
        source
            .settings()
            .map { resource -> WeeklyDigestDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = WeeklyDigestDisplayPrefs.DEFAULT,
            )

    /** Selects [id] as the active vehicle (web `<Select onChange>` ⇒ `setVehicleId`); the digest feed re-scopes. */
    fun selectVehicle(id: Long) = source.selectVehicle(id)

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("weeklyDigest.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / distance / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordWeeklyDigestOpened(logger)
    }
}
