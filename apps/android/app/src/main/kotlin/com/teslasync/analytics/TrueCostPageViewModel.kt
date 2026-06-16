// The state holder backing the TrueCostPage analytics surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/analytics/pages/TrueCostPage.tsx). It projects the
// `useCostBreakdown` cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the global
// active vehicle (web `useSelectedVehicle`), and derives the display preferences (distance unit + currency symbol +
// precision + gas unit) from the live `/settings` document (web `useUnits`/`useFormatting`/`useSettings`). All
// decode/derivation logic lives in the framework-free model (TrueCostPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// The cost feed re-collects whenever the selected vehicle changes or the refresh trigger bumps. The web query is
// gated on a selection (`enabled: !!vehicleId`), so a null / non-positive selection short-circuits to an empty
// envelope (JsonNull → [CostBreakdown.EMPTY]) which [CostBreakdown.hasData] resolves to UiPhase.Empty — the web
// `noData` panel ("Start charging to see your cost analysis"). An all-zero account resolves to Empty for the same
// reason (see the model's documented divergence note); any real cost history renders the full body.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.truecost

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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * @param source the P1/S8 data seam (real [AnalyticsStore] + [SettingsStore] + [SelectedVehicleStore] adapter ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TrueCostPageViewModel(
    private val source: TrueCostPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The decoded cost envelope as cache-then-network UI state (loading / content / empty / stale / offline / error),
     * carrying the freshness stamp + error kind. Re-collected whenever the active vehicle changes or the refresh
     * trigger bumps. A null / non-positive selection emits an empty envelope (web `enabled: !!vehicleId`), and an
     * all-zero payload resolves to the empty surface via [CostBreakdown.hasData] (web `noData`).
     */
    val state: StateFlow<UiState<CostBreakdown>> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id -> costFeed(id?.takeIf { it > 0L }) }
            .map { resource -> resource.mapData(::parseCostBreakdown) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (units + currency symbol + precision + locale + gas unit), re-derived as settings change. */
    val displayPrefs: StateFlow<TrueCostDisplayPrefs> =
        source
            .settings()
            .map { resource -> TrueCostDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = TrueCostDisplayPrefs.DEFAULT,
            )

    /**
     * The cost feed for a resolved [vehicleId], or an instantly-empty envelope when no vehicle is selected — the
     * native mirror of the web `enabled: !!vehicleId` gate (a disabled query leaves `tco` undefined ⇒ the `noData`
     * panel). The empty envelope decodes to [CostBreakdown.EMPTY] (`hasData == false`) ⇒ UiPhase.Empty.
     */
    private fun costFeed(vehicleId: Long?): Flow<Resource<JsonElement>> =
        if (vehicleId == null) {
            flowOf(Resource.Success(JsonNull, fetchedAt = 0L, stale = false))
        } else {
            source.costBreakdown(vehicleId.toString())
        }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("trueCost.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / cost / savings payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTrueCostOpened(logger)
    }
}
