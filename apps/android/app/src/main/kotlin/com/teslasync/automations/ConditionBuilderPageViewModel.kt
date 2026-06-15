// State holder backing the ConditionBuilder page surface (P1/S8) — the native counterpart of the host state
// the web component composes (web/src/features/automations/pages/ConditionBuilder.tsx). The web sub-component
// is a controlled editor: its parent owns the `conditions` list (passed straight through to the embedded
// shared surface), while the one data dependency — the geofence list for the geofence-condition dropdown
// (web `useGeofences` → GET /geofences) — is bound here. This page-layer holder projects that shared
// cache-then-network geofence feed (the shared S8 [LocationsStore].geofences() via [ConditionBuilderSource])
// onto the lifecycle-aware [UiState] surface the stateless screen renders, so the same loading / content /
// stale-offline / error chrome the shared feature view implements is reachable from a single [StateFlow]. It
// performs NO HTTP and owns no business logic — the geofence fetch lives entirely in the shared data layer,
// and this binding is the standard [BaseFeedViewModel.asUiState] page-VM job.
//
// The geofence feed drives the surface CHROME only (the freshness chip + the geofence dropdown options),
// never whether the builder renders: an empty fence list is valid content, and a failed load keeps the
// best-effort cached list visible with an offline/error chip + retry (refresh), exactly as the web degrades
// gracefully (`geofences ?? []`). The builder's own "no conditions yet" empty state is decided by the
// caller-owned conditions list at the render boundary, so [asUiState] is told the geofence payload is never
// "empty" (`isEmpty = { false }`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page
// surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.conditionbuilder.ConditionBuilderSource
import io.teslasync.android.featureviews.conditionbuilder.conditionBuilderSource
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
 * Lifecycle-aware state holder for the ConditionBuilder page surface. It consumes the cache-then-network
 * geofence [source] (P1/S8) and re-shares it as a single [UiState] stream via [BaseFeedViewModel.asUiState],
 * so the screen stays a stateless Composable that only renders. The edited conditions list itself is owned by
 * the caller (web `conditions` + `onChange` props), exactly like the web controlled component, so it is NOT
 * held here.
 *
 * The states are honest cache-then-network projections: a first frame of [UiState.loading] until the feed
 * emits, then content carrying the freshness stamp (and the offline/error chip + retry when a refresh fails
 * over cached data). It owns no networking. [refresh] re-collects the feed (the web `geofencesRefetch`) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic with [ConditionBuilderPageRegistration.SLUG]
 * (P1/S11).
 *
 * @param source the cache-then-network geofence seam (a shared-data-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConditionBuilderPageViewModel(
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

    /** Re-runs the cache-then-network geofence load (the web `geofencesRefetch` / error-state retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to ConditionBuilderPageRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Emits the one-shot PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordConditionBuilderPageOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "conditionBuilder.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] the page composable uses to construct this surface's ViewModel. */
        fun factory(
            source: ConditionBuilderSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ConditionBuilderPageViewModel(source, logger) }
            }

        /** Wire the surface from the shared [LocationsStore] (P1/S8) — the web `useGeofences` seam. */
        fun create(
            locationsStore: LocationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ConditionBuilderPageViewModel =
            ConditionBuilderPageViewModel(
                source = conditionBuilderSource(locationsStore),
                logger = logger,
                scope = scope,
            )
    }
}
