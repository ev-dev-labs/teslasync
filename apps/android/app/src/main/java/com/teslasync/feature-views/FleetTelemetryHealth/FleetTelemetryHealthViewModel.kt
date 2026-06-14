// UI-thread-free state holder backing the FleetTelemetryHealth feature view — the native port of the
// web component's hook composition (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx).
// It binds the two shared cache-then-network feeds via the [FleetTelemetryHealthSource] (P1/S8) and
// re-shares each as an independent [UiState] stream (loading / content / empty / stale / offline /
// error), drives the VIN filter that scopes the errors feed (web `selectedVin`), and exposes the two
// "Refresh from Tesla" mutations (web `useRefreshFleetTelemetryErrorVINs` / `...Errors`) plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects state and calls
// the exposed actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetTelemetryHealth) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleettelemetryhealth

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [FleetTelemetryHealth]. It consumes the two
 * cache-then-network feeds the [FleetTelemetryHealthSource] (P1/S8) exposes and re-shares each as an
 * independent [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless
 * Composable that only renders. The two feeds stay independent (web parity: two `useQuery` results),
 * so the Error-VINs card and the Error-Log card each render their own loading / empty / stale /
 * offline / error surface.
 *
 * The VIN filter ([selectedVin]) scopes the errors feed (web `useFleetTelemetryErrors(selectedVin ||
 * undefined)`); toggling the same VIN clears it (web `r.vin === selectedVin ? '' : r.vin`). The two
 * "Refresh from Tesla" actions run the source's POST mutations and expose a per-card pending flag
 * ([vinsRefreshing] / [errorsRefreshing], web `mutation.isPending`), re-collecting the affected feed on
 * success. [retryVins] / [retryErrors] back the cards' error-surface retry affordance, and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic with [FLEET_TELEMETRY_HEALTH_SLUG]
 * (P1/S11).
 *
 * @param source the shared cache-then-network telemetry-health seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetTelemetryHealthViewModel(
    private val source: FleetTelemetryHealthSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping a trigger re-collects that cache-then-network feed (the web `refetch()` / error retry);
    // the repository-backed source re-fetches on re-subscribe, exactly as the shared store's own
    // trigger ▸ flatMapLatest pipeline does for its memoized feed.
    private val vinsTrigger = MutableStateFlow(0)
    private val errorsTrigger = MutableStateFlow(0)

    private val selectedVinState = MutableStateFlow("")
    private val vinsRefreshingState = MutableStateFlow(false)
    private val errorsRefreshingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The active VIN filter (web `selectedVin`); empty means "all VINs" (web disabled filter). */
    val selectedVin: StateFlow<String> = selectedVinState.asStateFlow()

    /** Whether the Error-VINs "Refresh from Tesla" mutation is in flight (web `refreshVINs.isPending`). */
    val vinsRefreshing: StateFlow<Boolean> = vinsRefreshingState.asStateFlow()

    /** Whether the Error-Log "Refresh from Tesla" mutation is in flight (web `refreshErrors.isPending`). */
    val errorsRefreshing: StateFlow<Boolean> = errorsRefreshingState.asStateFlow()

    /**
     * The Error-VINs feed as lifecycle-aware [UiState]: loading (no cache) / content / empty (web
     * `vinList.length === 0`) / stale / offline / error, carrying the freshness stamp + error kind.
     */
    val vinsState: StateFlow<UiState<List<FleetTelemetryErrorVIN>>> =
        vinsTrigger
            .flatMapLatest { source.errorVins() }
            .asUiState { it.isEmpty() }

    /**
     * The Error-Log feed (scoped by [selectedVin]) as lifecycle-aware [UiState]: loading / content /
     * empty (web `errorList.length === 0`) / stale / offline / error. Changing the filter or bumping
     * the refresh trigger switches the underlying collection (web query-key change / `refetch()`).
     */
    val errorsState: StateFlow<UiState<List<FleetTelemetryError>>> =
        combine(errorsTrigger, selectedVinState) { _, vin -> vin }
            .flatMapLatest { vin -> source.errors(vin.ifBlank { null }) }
            .asUiState { it.isEmpty() }

    /** Toggle the VIN filter (web `setSelectedVin(r.vin === selectedVin ? '' : r.vin)`). */
    fun selectVin(vin: String) {
        selectedVinState.update { current -> if (current == vin) "" else vin }
    }

    /** Clear the VIN filter (web the Filtered badge's `×` clear button). */
    fun clearVin() {
        selectedVinState.value = ""
    }

    /**
     * Run the Error-VINs "Refresh from Tesla" mutation (web `refreshVINs.mutate()`): flips the pending
     * flag, POSTs via the source, then re-collects the error-VINs feed on success. A failure clears the
     * pending flag and is logged + counted; the card's retry affordance remains for recovery.
     */
    fun refreshVins() {
        if (vinsRefreshingState.value) return
        logger.info(EVENT_REFRESH_VINS, surfaceField())
        vinsRefreshingState.value = true
        launch {
            val result = source.refreshErrorVins()
            vinsRefreshingState.value = false
            result
                .onSuccess { vinsTrigger.update { it + 1 } }
                .onFailure { logger.warn(EVENT_REFRESH_VINS_FAILED, surfaceField()) }
        }
    }

    /**
     * Run the Error-Log "Refresh from Tesla" mutation (web `refreshErrors.mutate()`): flips the pending
     * flag, POSTs via the source, then re-collects the errors feed on success. A failure clears the
     * pending flag and is logged + counted; the card's retry affordance remains for recovery.
     */
    fun refreshErrors() {
        if (errorsRefreshingState.value) return
        logger.info(EVENT_REFRESH_ERRORS, surfaceField())
        errorsRefreshingState.value = true
        launch {
            val result = source.refreshErrors()
            errorsRefreshingState.value = false
            result
                .onSuccess { errorsTrigger.update { it + 1 } }
                .onFailure { logger.warn(EVENT_REFRESH_ERRORS_FAILED, surfaceField()) }
        }
    }

    /** Re-collect the Error-VINs feed (the card's error-surface retry / cache-then-network re-fetch). */
    fun retryVins() {
        vinsTrigger.update { it + 1 }
    }

    /** Re-collect the Error-Log feed (the card's error-surface retry / cache-then-network re-fetch). */
    fun retryErrors() {
        errorsTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN or error payload, so a diagnostics line can never leak the fleet's
     * posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFleetTelemetryHealthOpened(logger)
    }

    private fun surfaceField(): Map<String, String> = mapOf(FIELD_SURFACE to FLEET_TELEMETRY_HEALTH_SLUG)

    companion object {
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH_VINS = "fleetTelemetryHealth.refreshVins"
        private const val EVENT_REFRESH_ERRORS = "fleetTelemetryHealth.refreshErrors"
        private const val EVENT_REFRESH_VINS_FAILED = "fleetTelemetryHealth.refreshVins.failed"
        private const val EVENT_REFRESH_ERRORS_FAILED = "fleetTelemetryHealth.refreshErrors.failed"

        /**
         * Wire the surface from the shared **S7** [TelemetryRepository] — the cold cache-then-network
         * feeds where the refresh trigger re-subscribing performs a genuine re-fetch (web `refetch()`).
         */
        fun create(
            repository: TelemetryRepository,
            logger: Logger,
        ): FleetTelemetryHealthViewModel = FleetTelemetryHealthViewModel(repository.asFleetTelemetryHealthSource(), logger)

        /**
         * Wire the surface from the shared **S8** [TelemetryStore] — the memoized, multi-observer
         * error-VINs + errors feeds every Telemetry surface shares (incl. its background refresh cadence).
         */
        fun create(
            store: TelemetryStore,
            logger: Logger,
        ): FleetTelemetryHealthViewModel = FleetTelemetryHealthViewModel(store.asFleetTelemetryHealthSource(), logger)
    }
}
