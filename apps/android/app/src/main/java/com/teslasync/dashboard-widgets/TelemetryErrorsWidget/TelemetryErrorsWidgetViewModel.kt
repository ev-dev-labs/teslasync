// UI-thread-free state holder backing the Telemetry Errors widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx). It binds
// the shared cache-then-network [TelemetryErrorsSource] (P1/S8), projecting each combined emission onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error) and carrying the
// freshness stamp + error kind, then exposes the refresh/retry action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[retry]/
// [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TelemetryErrorsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.telemetryerrors

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [TelemetryErrorsWidget]. It consumes the
 * cache-then-network [TelemetryErrorsSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An
 * empty payload (web `!hasData`: neither error-VINs nor errors) maps to the empty surface; any rows on
 * either feed map to content. A hard failure with nothing cached maps to the error surface, while a
 * failure with cached rows keeps them visible (offline / last-known) per the ADR-013 freshness contract.
 *
 * It owns no networking. [refresh]/[retry] re-collect the source (the web `refetch()` affordance + the
 * error-surface retry) and [recordViewOpened] emits the one-shot `view.opened` diagnostics event with
 * the surface [TelemetryErrorsRegistration.SLUG] (P1/S11).
 *
 * @param source the shared cache-then-network telemetry-error seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryErrorsWidgetViewModel(
    source: TelemetryErrorsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the web `refetch()` affordance); the
    // repository-backed source re-fetches on re-subscribe, exactly as the shared store's own
    // trigger ▸ flatMapLatest pipeline does for its memoized feed.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined telemetry-error payload as lifecycle-aware [UiState]: loading (no cache) / content /
     * empty (web `!hasData`) / stale / offline / error, carrying the freshness stamp + error kind.
     */
    val state: StateFlow<UiState<TelemetryErrorsData>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasData }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN or error payload, so a diagnostics line can never leak the fleet's posture.
     * Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to TelemetryErrorsRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (the web `onRefresh`/`refetch()` affordance). */
    fun refresh() {
        logger.info("telemetryErrors.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /**
         * Wire the surface from the shared **S7** [TelemetryRepository] — the cold cache-then-network
         * feeds where the refresh trigger re-subscribing performs a genuine re-fetch (web `refetch()`).
         */
        fun create(
            repository: TelemetryRepository,
            logger: Logger,
        ): TelemetryErrorsWidgetViewModel = TelemetryErrorsWidgetViewModel(telemetryErrorsSource(repository), logger)

        /**
         * Wire the surface from the shared **S8** [TelemetryStore] — the memoized, multi-observer
         * error-VINs + errors feeds every Telemetry surface shares (incl. its background refresh cadence).
         */
        fun create(
            store: TelemetryStore,
            logger: Logger,
        ): TelemetryErrorsWidgetViewModel = TelemetryErrorsWidgetViewModel(telemetryErrorsSource(store), logger)
    }
}
