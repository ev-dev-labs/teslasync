// UI-thread-free state holder backing the system-status Infrastructure section — the native port of the web
// component's two-`useQuery` composition (web/src/features/system/components/status/InfrastructureSection.tsx).
// It binds the [InfrastructureStatusSectionSource] cache-then-network seam (P1/S8), folds the telemetry-status
// + system-health feeds into one lifecycle-aware [UiState] via [InfrastructureStatusSectionProjection.combine]
// + [BaseFeedViewModel.asUiState] (loading / content / empty / stale / offline / error), exposes the
// refresh/retry affordance (the web 2s/30s polls + a freshness retry), and emits the PII-safe one-shot
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructurestatus

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network telemetry-status + system-health seam (a shared-client adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects these feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events
 *   carrying no telemetry/health payload.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InfrastructureStatusSectionViewModel(
    private val source: InfrastructureStatusSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch + the freshness
    // retry), exactly as the shared stores' trigger ▸ flatMapLatest pipeline does for their memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined surface state as a lifecycle-aware [UiState]: loading / content / empty (telemetry resolved
     * but blank ⇒ the cards still render with the web's undefined-defaults) / stale / offline / error,
     * carrying the freshness stamp + error kind. The telemetry feed drives the phase; the latest-known health
     * value rides along so the optional database-pool row appears as soon as that feed resolves.
     */
    val state: StateFlow<UiState<InfrastructureStatusData>> =
        refreshTrigger
            .flatMapLatest {
                combine(source.telemetryStatus(), source.systemHealth()) { telemetry, health ->
                    InfrastructureStatusSectionProjection.combine(telemetry, health)
                }
            }.asUiState { InfrastructureStatusSectionProjection.isEmpty(it) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordInfrastructureStatusSectionOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web 2s/30s polls + the freshness `refetch()`). */
    fun refresh() {
        logger.info("infrastructureStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: InfrastructureStatusSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { InfrastructureStatusSectionViewModel(source, logger) }
            }
    }
}
