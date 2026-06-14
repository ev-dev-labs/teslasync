package io.teslasync.android.dashboardwidgets.weeklysummary

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * State holder backing the Compose [WeeklySummaryCardWidget] — the Android port of the web
 * `WeeklySummaryCardWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx`).
 *
 * It binds three shared P1/S8 holders and performs no HTTP itself (ADR-002): the [AnalyticsStore]
 * `GET /vehicles/{id}/weekly-digest` feed (web `useWeeklyDigest`), the [VehiclesStore] list to
 * resolve the primary vehicle when no explicit one is supplied (web `vehicleId ?? vehicles?.[0]?.id`),
 * and the [SettingsStore] document to derive the unit + monetary preferences (web `useUnits`/
 * `useFormatting`). Each is folded onto a lifecycle-aware [UiState]/[WeeklySummaryPrefs] so the view
 * stays a thin renderer that covers every state the web widget draws (loading / content / empty /
 * error, plus stale / offline via the ADR-013 freshness flags).
 *
 * [refresh]/[retry] re-fetch the resolved vehicle's digest through the shared feed (the web
 * `refetch()`), and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per
 * surface open.
 *
 * @param analytics the shared cache-then-network analytics holder (weekly-digest feed).
 * @param vehicles the shared vehicles holder (primary-vehicle resolution).
 * @param settings the shared settings holder (unit + monetary preferences).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param explicitVehicleId an explicit vehicle id; when null/≤0 the primary cached vehicle is used.
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WeeklySummaryCardWidgetViewModel(
    private val analytics: AnalyticsStore,
    private val vehicles: VehiclesStore,
    settings: SettingsStore,
    logger: Logger,
    private val explicitVehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // The vehicle the most recent collection resolved to — read by refresh() to target the shared feed.
    private var resolvedVehicleId: Long = explicitVehicleId?.takeIf { it > 0L } ?: 0L
    private var viewOpenedRecorded = false

    /** The weekly digest as cache-then-network UI state (a quiet week → empty surface). */
    val digest: StateFlow<UiState<JsonElement>> =
        vehicleDigestFlow().asUiState { !weeklyDigestHasData(it) }

    /** The live unit + monetary preferences (web `useUnits`/`useFormatting`), re-derived as settings change. */
    val prefs: StateFlow<WeeklySummaryPrefs> =
        settings
            .settings()
            .map { resource -> WeeklySummaryPrefs.from(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = WeeklySummaryPrefs.DEFAULT,
            )

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to WeeklySummaryCardRegistration.SLUG))
    }

    /** Re-fetches the weekly-digest feed for the resolved vehicle (web `refetch()`). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to WeeklySummaryCardRegistration.SLUG))
        val id = resolvedVehicleId
        if (id > 0L) analytics.refreshWeeklyDigest(id.toString())
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Resolves the vehicle to scope the digest read to, then streams that vehicle's weekly digest. An
     * explicit id binds directly; otherwise the primary cached vehicle is used (web
     * `vehicles?.[0]?.id`). With no vehicle yet the upstream short-circuits — loading while vehicles
     * are still resolving, empty once resolved with none (web's `enabled: !!vehicleId` query).
     */
    private fun vehicleDigestFlow(): Flow<Resource<JsonElement>> {
        val explicit = explicitVehicleId?.takeIf { it > 0L }
        if (explicit != null) return analytics.weeklyDigest(explicit.toString())

        return vehicles.vehicles().flatMapLatest { vehiclesResource ->
            val id = vehiclesResource.cached?.firstOrNull()?.id ?: 0L
            resolvedVehicleId = id
            when {
                id > 0L -> analytics.weeklyDigest(id.toString())
                vehiclesResource is Resource.Loading && vehiclesResource.cached == null ->
                    flowOf<Resource<JsonElement>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                else ->
                    flowOf<Resource<JsonElement>>(
                        Resource.Success(data = EMPTY_DIGEST, fetchedAt = SystemClock.nowMillis(), stale = false),
                    )
            }
        }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "weeklySummary.refresh"

        /** The empty-object digest emitted when no vehicle resolves — projects to the empty surface. */
        private val EMPTY_DIGEST: JsonElement = JsonObject(emptyMap())

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            analytics: AnalyticsStore,
            vehicles: VehiclesStore,
            settings: SettingsStore,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    WeeklySummaryCardWidgetViewModel(analytics, vehicles, settings, logger, explicitVehicleId)
                }
            }
    }
}
