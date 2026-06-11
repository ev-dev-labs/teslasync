@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * The data port the [ChargeSessionChartViewModel] binds to (P1/S8 state-holder seam). It yields the
 * cache-then-network sequence of a vehicle's ten most-recent charging sessions for
 * `GET /charging?vehicle_id=&limit=10` — the native analogue of the web `useVehicles` + `useQuery`
 * hook composition (vehicle resolution included). The view never performs HTTP itself; the
 * [ChargingStoreChargeSessionChartSource] (or a test fake) drives this.
 */
fun interface ChargeSessionChartSource {
    /** Stream the cache-then-network session list, replaying the cached value first. */
    fun stream(): Flow<Resource<List<ChargingSession>>>
}

/**
 * The shared-state-holder-backed [ChargeSessionChartSource]. It resolves the scoped vehicle (the
 * native analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins,
 * otherwise the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [ChargingStore.sessionsPaginated] cache-then-network feed (web
 * `request('/charging?vehicle_id=&limit=10')`). With no vehicle — or a non-positive id, mirroring the
 * web `enabled: id > 0` gate — the stream emits a resolved-empty success so the surface shows the
 * "No charge sessions yet" empty state. No HTTP touches the view — the [ChargingStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingStoreChargeSessionChartSource(
    private val chargingStore: ChargingStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : ChargeSessionChartSource {
    override fun stream(): Flow<Resource<List<ChargingSession>>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId ?: active) {
                null -> resolvedEmpty()
                else ->
                    if (vehicleId > 0) {
                        chargingStore.sessionsPaginated(vehicleId, ChargeSessionChartRegistration.SESSION_LIMIT)
                    } else {
                        resolvedEmpty()
                    }
            }
        }

    private fun resolvedEmpty(): Flow<Resource<List<ChargingSession>>> =
        flowOf(Resource.Success(data = emptyList(), fetchedAt = NO_FETCH, stale = false))

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}

/**
 * Lifecycle-aware state holder backing the Compose [ChargeSessionChartWidget] — the native port of
 * the web `ChargeSessionChartWidget`'s hook composition. It consumes the cache-then-network
 * [ChargeSessionChartSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An
 * empty session list maps to the empty surface; a non-empty list maps to content, mirroring the web
 * `hasData` gate.
 *
 * It owns no networking. [retry] re-collects the source (the web `refetch`) and [onAppear] emits the
 * one-shot `view.opened` diagnostics event with the surface [ChargeSessionChartRegistration.SLUG]
 * (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeSessionChartViewModel(
    private val source: ChargeSessionChartSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent sessions as cache-then-network UI state (loading / content / empty / stale / error). */
    val state: StateFlow<UiState<List<ChargingSession>>> =
        retryTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Records the one-shot `view.opened` diagnostics event the first time the surface appears. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SLUG to ChargeSessionChartRegistration.SLUG))
    }

    /** Re-collects the source feed (web `refetch`) — used by the error/offline retry affordance. */
    fun retry() {
        logger.info(EVENT_RETRY)
        retryTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SLUG = "slug"
        private const val EVENT_RETRY = "charge_session_chart.retry"

        /**
         * Wire the surface from the shared [ChargingStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            chargingStore: ChargingStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): ChargeSessionChartViewModel =
            ChargeSessionChartViewModel(
                source = ChargingStoreChargeSessionChartSource(chargingStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
