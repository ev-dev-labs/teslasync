// The state holder backing the SafetySettingsPage vehicle-systems surface (P1/S8) — the native counterpart of the web
// page's TanStack-Query hooks (web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx). It projects the three
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display preferences (distance unit) from the live `/settings` document (web
// `useUnits`). All decode/derivation logic lives in the framework-free model (SafetySettingsPageModel.kt); this holder
// is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the `/safety/latest` ADAS snapshot: it re-collects whenever the selected vehicle changes or the
// refresh trigger bumps, and an absent / structurally-empty payload (or no selection — web `enabled: activeId !== ''`)
// resolves to UiPhase.Empty via [SafetySnapshot.hasData] so the body shows its `No safety data…` empty-state (the web
// `!latest` guard; see the model's documented divergence note). The history feed is its own lifecycle-aware [UiState]
// so the chart + table render their own content/empty surface without ever hiding a section; the live `/security/latest`
// signals are a plain value flow (web `securityData?.x`, em dash when missing) since the panel always renders.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.safetysettings

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
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the page-local safety repository + the real Settings holder + the app-scoped
 *   active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SafetySettingsPageViewModel(
    private val source: SafetySettingsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary `/safety/latest` ADAS feed as cache-then-network UI state (web primary `useQuery`). Re-collected
     * when the active vehicle changes or refresh bumps; an absent payload (or no selection — web `enabled: activeId
     * !== ''`) resolves to the empty surface (web `No safety data available…`).
     */
    val state: StateFlow<UiState<SafetySnapshot>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::safetyLatest) ?: emptyObjectFeed }
            .map { it.mapData(::parseSafetySnapshot) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/safety?limit=100` history feed (web `useQuery('/safety')`) — empty when no rows have accrued. */
    val history: StateFlow<UiState<List<SafetySnapshot>>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::safetyHistory) ?: emptyArrayFeed }
            .map { it.mapData(::parseSafetyHistory) }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The live `/security/latest` seat-belt / lock signals (web `useSecurityLatest`) as a plain value flow — the panel
     * always renders, reading each field or the em dash (web `securityData?.x == null ? '—' : …`). A missing payload
     * or no selection yields the all-null snapshot.
     */
    val security: StateFlow<SecurityLatest> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::securityLatest) ?: emptyObjectFeed }
            .map { parseSecurityLatest(it.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EMPTY_SECURITY,
            )

    /** The live display preferences (distance unit + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<SafetyDisplayPrefs> =
        source
            .settings()
            .map { resource -> SafetyDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SafetyDisplayPrefs.DEFAULT,
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("safety.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / signal / distance payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSafetySettingsOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The all-null live snapshot before a selection / payload (web `securityData` undefined ⇒ em dashes). */
        private val EMPTY_SECURITY = SecurityLatest(null, null, null, null)

        /** The synthetic "no selection" payloads so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
        private val emptyArrayFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonArray(emptyList()), 0L, false))
    }
}
