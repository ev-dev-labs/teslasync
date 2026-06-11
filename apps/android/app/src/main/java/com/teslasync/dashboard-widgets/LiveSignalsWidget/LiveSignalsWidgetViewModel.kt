// UI-thread-free state holder backing the Live Signals widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx). It binds the shared Vehicles
// feeds (P1/S8) through [LiveSignalsSource]: when no explicit vehicle is configured it resolves the default
// vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), then combines the four
// cache-then-network `/…/latest` feeds into a single [LiveSignalsState]. The **motor** feed drives the
// header freshness (loading / stale / offline / error), exactly as the web binds `WidgetShell` to the
// `useMotorLatest` query; the other three feeds populate their sections (or show a skeleton). It exposes the
// single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LiveSignalsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livesignals

import io.teslasync.android.data.BaseFeedViewModel
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network Vehicles seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the default vehicle and combines the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalsWidgetViewModel(
    private val source: LiveSignalsSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feeds (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined live-signal surface: the four `/…/latest` documents plus the motor feed's freshness, as a
     * lifecycle-aware [StateFlow]. While no vehicle resolves (web id≤0 ⇒ disabled queries) it stays
     * [LiveSignalsState.EMPTY], so the widget shows its friendly empty state rather than spinning forever.
     */
    val state: StateFlow<LiveSignalsState> =
        refreshTrigger
            .flatMapLatest { resolvedFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LiveSignalsState.EMPTY,
            )

    /** Re-runs the cache-then-network load (the web `refetchMotor()` affordance + the freshness retry). */
    fun refresh() {
        logger.info("liveSignals.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no torque / temperature / pressure / lock payload, so a diagnostics line can never
     * leak the vehicle's state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to LiveSignalsRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's signals when one is configured, otherwise the first enrolled
     * vehicle's signals resolved from the live vehicles list. With no usable vehicle (list loading, empty, or
     * errored — the web's disabled-query branch) it emits [LiveSignalsState.EMPTY], all without ever issuing
     * HTTP from the view.
     */
    private fun resolvedFeed(): Flow<LiveSignalsState> {
        val explicit = vehicleId
        return if (explicit != null && explicit > 0L) {
            signalsFeed(explicit)
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = firstVehicleId(vehiclesResource.cached)
                if (firstId != null) signalsFeed(firstId) else flowOf(LiveSignalsState.EMPTY)
            }
        }
    }

    /**
     * Combines the four per-vehicle `/…/latest` feeds into one [LiveSignalsState]. Each section carries its
     * last-known document (web query `data`, kept across refetch/error); the motor feed additionally supplies
     * the header freshness (web `WidgetShell` bound to `useMotorLatest`).
     */
    private fun signalsFeed(id: Long): Flow<LiveSignalsState> =
        combine(
            source.motorLatest(id),
            source.climateLatest(id),
            source.securityLatest(id),
            source.tirePressureLatest(id),
        ) { motor, climate, security, tires ->
            LiveSignalsState(
                motor = motor.cached,
                climate = climate.cached,
                security = security.cached,
                tires = tires.cached,
                updatedAtMillis = motor.fetchedAtMillis(),
                isFetching = motor is Resource.Loading,
                isStale = motor.stale,
                isError = motor is Resource.Error,
            )
        }

    /** The freshness stamp of a feed emission (web `dataUpdatedAt`), across loading / success / error. */
    private fun Resource<JsonElement>.fetchedAtMillis(): Long? =
        when (this) {
            is Resource.Loading -> fetchedAt
            is Resource.Success -> fetchedAt
            is Resource.Error -> fetchedAt
        }

    private companion object {
        /** Keep the combined upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
