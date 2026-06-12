// UI-thread-free state holder backing the ConditionBuilder feature view — the native port of the web
// component's `useGeofences()` composition (web/src/features/automations/pages/ConditionBuilder.tsx). It
// binds the shared cache-then-network [ConditionBuilderSource] (P1/S8), projects each emission onto the
// shared [UiState] surface (loading / content / stale / offline / error), and exposes the single refresh
// action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// [state] and calls [refresh] / [recordViewOpened]. The edited conditions list itself is owned by the
// caller (web `conditions` + `onChange` props), exactly like the web controlled component.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ConditionBuilder) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.conditionbuilder

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.LocationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [ConditionBuilder]. It consumes the cache-then-network
 * [ConditionBuilderSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders.
 *
 * The geofence list drives the surface CHROME only (the freshness chip + the geofence dropdown options),
 * never whether the whole builder renders: an empty geofence list is still valid content (the dropdown
 * shows just the "Select geofence…" sentinel), and a failed load keeps the best-effort cached list visible
 * with the offline/error chip + a retry (refresh), exactly as the web degrades gracefully (`geofences ??
 * []`, it never blanks the builder). The surface's own empty state ("no conditions yet") is decided by the
 * caller-owned conditions list at the render boundary, so [asUiState] is told the geofence payload is
 * never "empty" (`isEmpty = { false }`).
 *
 * It owns no networking. [refresh] re-collects the source (the web `geofencesRefetch`) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostics event with [CONDITION_BUILDER_SLUG]
 * (P1/S11).
 *
 * @param source the cache-then-network geofence seam (a shared-data-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConditionBuilderViewModel(
    source: ConditionBuilderSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The geofence list as cache-then-network UI state: loading / content / stale / offline / error,
     * carrying the freshness stamp + error kind. The payload is never treated as "empty" (an empty fence
     * list is valid content); the builder's own empty state is the caller's conditions list.
     */
    val state: StateFlow<UiState<List<Geofence>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { false })

    /** Re-runs the cache-then-network geofence load (the web `geofencesRefetch` affordance). */
    fun refresh() {
        logger.info("conditionBuilder.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no geofence names, ids, or condition values, so a diagnostics line can never leak a
     * vehicle's configuration. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to CONDITION_BUILDER_SLUG))
    }

    companion object {
        /** Wire the surface from the shared [LocationsStore] (P1/S8). */
        fun create(
            locationsStore: LocationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ConditionBuilderViewModel =
            ConditionBuilderViewModel(
                source = conditionBuilderSource(locationsStore),
                logger = logger,
                scope = scope,
            )
    }
}
