// UI-thread-free state holder backing the Service Health section — the native port of the web component's
// single `useQuery(getTelemetryStatus, refetchInterval: 2s)` (web/src/features/system/components/status/
// ServiceHealthSection.tsx). It binds the [ServiceHealthSectionSource] feed seam (P1/S8), projects each raw
// `/telemetry` [Resource] onto the typed [ServiceHealthData] (via [ServiceHealthProjection.build]) and then
// onto a lifecycle-aware [UiState], exposes refresh / retry (web `refetch`), and emits the PII-safe one-shot
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh] /
// [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ServiceHealthSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.servicehealth

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * State holder backing the Compose [ServiceHealthSection] — the Android port of the web component's polling
 * `useQuery(getTelemetryStatus)` composition.
 *
 * It binds the injected [ServiceHealthSectionSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the projected [ServiceHealthData]. The result covers every state the web surface renders —
 * loading (web `isLoading` ⇒ Skeleton), content (the metrics + table), and hard error (web `error` ⇒
 * `QueryError`) — and, through the ADR-013 freshness contract, the empty (payload not an object), stale and
 * offline (cached projection kept visible with the staleness + error flags) states the P3 checklist
 * mandates. The view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [refresh] / [retry] restart the feed through the source (web `refetch`), and [onViewOpened] emits the
 * P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared `/telemetry` seam (a host-wired raw feed in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ServiceHealthSectionViewModel(
    private val source: ServiceHealthSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The projected telemetry analysis as cache-then-network UI state (unresolved payload ⇒ Empty). */
    val state: StateFlow<UiState<ServiceHealthData>> =
        restart
            .flatMapLatest { source.telemetryStatus().map(::projectResource) }
            .asUiState { !it.hasData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to ServiceHealthSectionRegistration.SLUG))
    }

    /** Re-fetches the `/telemetry` feed (web `refetch()`). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to ServiceHealthSectionRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Maps a raw `/telemetry` [Resource] onto a typed [Resource] of the projected analysis, preserving the
     * cache-then-network envelope (cached value, freshness stamp, staleness, error) so the downstream
     * [UiState] projection still drives loading / content / empty / stale / offline / error correctly.
     */
    private fun projectResource(resource: Resource<JsonElement>): Resource<ServiceHealthData> =
        when (resource) {
            is Resource.Loading ->
                Resource.Loading(
                    cached = resource.cached?.let(ServiceHealthProjection::build),
                    fetchedAt = resource.fetchedAt,
                    stale = resource.stale,
                )

            is Resource.Success ->
                Resource.Success(
                    data = ServiceHealthProjection.build(resource.data),
                    fetchedAt = resource.fetchedAt,
                    stale = resource.stale,
                )

            is Resource.Error ->
                Resource.Error(
                    cached = resource.cached?.let(ServiceHealthProjection::build),
                    fetchedAt = resource.fetchedAt,
                    stale = resource.stale,
                    error = resource.error,
                )
        }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "serviceHealth.refresh"

        /** A [ViewModelProvider.Factory] a system-status host uses to construct this surface's ViewModel. */
        fun factory(
            source: ServiceHealthSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ServiceHealthSectionViewModel(source, logger) }
            }
    }
}
