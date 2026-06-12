// UI-thread-free state holder backing the TriggerConfigurator feature view — the native port of the single
// `useGeofences` query the web component owns to populate its geofence dropdown
// (web/src/features/automations/pages/TriggerConfigurator.tsx). It binds the shared cache-then-network
// [TriggerConfiguratorSource] (P1/S8), projects each emission onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error), and exposes the refresh/retry action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [geofences] and calls
// [refresh] / [retry] / [recordViewOpened]. The trigger value itself is host-owned form state (the web
// `trigger`/`onChange` props), not held here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TriggerConfigurator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.triggerconfigurator

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
 * Lifecycle-aware state holder backing the Compose [TriggerConfigurator]. It consumes the cache-then-network
 * [TriggerConfiguratorSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty
 * geofence list maps to the empty surface (the geofence dropdown shows only its prompt option + a "no
 * geofences" hint); a non-empty list maps to content. An error keeps the best-effort cached list visible
 * with the offline/error chip + retry, never blanking the dropdown.
 *
 * It owns no networking. [refresh]/[retry] re-collects the source (the web `useGeofences` refetch) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic with the surface slug (P1/S11).
 *
 * @param source the cache-then-network geofence seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class TriggerConfiguratorViewModel(
    source: TriggerConfiguratorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual retry affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The geofence dropdown's data as cache-then-network UI state: loading / content (a non-empty list) /
     * empty (no configured geofences) / stale / offline / error, carrying the freshness stamp + error kind.
     * Empty mirrors the web `geofences ?? []` empty branch — the dropdown still renders with its prompt.
     */
    public val geofences: StateFlow<UiState<List<Geofence>>> =
        refreshTrigger
            .flatMapLatest { source.geofences() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-runs the cache-then-network load (the web `useGeofences` refetch). */
    public fun refresh() {
        logger.info("triggerConfigurator.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the geofence dropdown's retry affordance. */
    public fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no geofence id, signal value, or cron string, so a diagnostics line can never leak
     * what a user is configuring. Call from the composable's first-composition effect.
     */
    public fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        TriggerConfiguratorDiagnostics.recordViewOpened(logger)
    }

    public companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        public fun factory(
            source: TriggerConfiguratorSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TriggerConfiguratorViewModel(source, logger) }
            }

        /** Wire the surface from the shared [LocationsStore] (P1/S8). */
        public fun create(
            locationsStore: LocationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): TriggerConfiguratorViewModel =
            TriggerConfiguratorViewModel(
                source = locationsStore.asTriggerConfiguratorSource(),
                logger = logger,
                scope = scope,
            )
    }
}
