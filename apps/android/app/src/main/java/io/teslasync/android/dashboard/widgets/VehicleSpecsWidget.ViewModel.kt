@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The data port the [VehicleSpecsViewModel] binds to (P1/S8 state-holder seam). It yields the
 * cache-then-network sequence of the combined vehicle-configuration payload — the native analogue of
 * the web `useVehicles` + `useVehicleSpecs` + `useVehicleOptions` + `useVehicleConfigLatest` hook
 * composition (vehicle resolution included). The view never performs HTTP itself; the
 * [VehiclesStoreVehicleSpecsSource] (or a test fake) drives this.
 */
fun interface VehicleSpecsSource {
    /** Stream the cache-then-network combined-spec snapshots, replaying any cached value first. */
    fun stream(): Flow<Resource<VehicleSpecsData>>
}

/**
 * The shared-state-holder-backed [VehicleSpecsSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins,
 * otherwise the app-wide active vehicle from [activeVehicleId]), then OR-merges the three shared
 * [VehiclesStore] cache-then-network feeds — `vehicleSpecs`, `vehicleOptions`, `vehicleConfigLatest`
 * (web `useVehicleSpecs`/`useVehicleOptions`/`useVehicleConfigLatest`) — into one [Resource] via
 * [combineSpecsResources]. With no vehicle — or a non-positive id, mirroring the web `enabled`
 * (`!!vehicleId` / `vehicleId > 0`) gates — the stream emits a resolved-empty success so the surface
 * shows the "No specs available" empty state. No HTTP touches the view — the [VehiclesStore] (S7/S8)
 * owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStoreVehicleSpecsSource(
    private val store: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : VehicleSpecsSource {
    override fun stream(): Flow<Resource<VehicleSpecsData>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = resolveSpecsVehicleId(explicitVehicleId, active)) {
                null -> resolvedEmpty()
                else ->
                    combine(
                        store.vehicleSpecs(vehicleId.toString()),
                        store.vehicleOptions(vehicleId.toString()),
                        store.vehicleConfigLatest(vehicleId),
                    ) { specs, options, config -> combineSpecsResources(specs, options, config) }
            }
        }

    private fun resolvedEmpty(): Flow<Resource<VehicleSpecsData>> =
        flowOf(Resource.Success(data = VehicleSpecsData.EMPTY, fetchedAt = NO_FETCH, stale = false))

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}

/**
 * Resolve the effective vehicle id the surface reads (the native analogue of the web
 * `numericId = vehicleId ?? vehicles?.[0]?.id ?? 0`, with the `> 0` enabled gate): an [explicit] id
 * wins over the app-wide [active] selection, and a missing or non-positive result yields `null` so
 * the source short-circuits to the resolved-empty surface.
 */
internal fun resolveSpecsVehicleId(
    explicit: Long?,
    active: Long?,
): Long? = (explicit ?: active)?.takeIf { it > 0 }

/**
 * Fold the three cache-then-network feeds the Vehicle Specs surface composes into one [Resource] of
 * [VehicleSpecsData], reproducing the web widget's OR-merged freshness (`isLoading`/`isError`/
 * `isStale` = OR, `updatedAt` = max). [specs] and [options] are unwrapped from their info-envelope
 * `data` field; [config] is the raw snapshot. Precedence mirrors the web `WidgetShell` gate, where
 * loading wins over error:
 *  - any feed in its FIRST load (Loading with no cached value) → [Resource.Loading] with no value
 *    (skeleton chrome), exactly as the web `isLoading` OR hides partial data behind the skeleton;
 *  - else any feed failed → [Resource.Error]; with at least one resolved source the combined value is
 *    kept (offline / "last known" + an error chip), otherwise a hard error (the retry surface — a
 *    deliberate parity enhancement: the web widget shows the empty state on a no-data error because
 *    it leaves `WidgetShell.error` unset, whereas every native dashboard surface offers retry);
 *  - else a background refresh in flight over cached values → [Resource.Loading] carrying the value;
 *  - else all settled → [Resource.Success], stale if any source is stale, stamped with the newest
 *    `fetchedAt`.
 */
internal fun combineSpecsResources(
    specs: Resource<JsonElement>,
    options: Resource<JsonElement>,
    config: Resource<JsonElement>,
): Resource<VehicleSpecsData> {
    val feeds = listOf(specs, options, config)
    val data =
        VehicleSpecsData(
            specs = envelopeData(specs.cached),
            options = envelopeData(options.cached),
            config = snapshotObject(config.cached),
        )
    val newestFetchedAt = feeds.mapNotNull(::fetchedAtOf).maxOrNull()
    val anyStale = feeds.any { it.stale }
    val firstLoading = feeds.any { it is Resource.Loading && it.cached == null }
    val failure = feeds.firstNotNullOfOrNull { (it as? Resource.Error)?.error }
    val refreshing = feeds.any { it is Resource.Loading }

    return when {
        firstLoading -> Resource.Loading(cached = null, fetchedAt = newestFetchedAt, stale = false)
        failure != null && data.hasAnyData -> Resource.Error(cached = data, fetchedAt = newestFetchedAt, stale = true, error = failure)
        failure != null -> Resource.Error(cached = null, fetchedAt = newestFetchedAt, stale = anyStale, error = failure)
        refreshing -> Resource.Loading(cached = data, fetchedAt = newestFetchedAt, stale = anyStale)
        else -> Resource.Success(data = data, fetchedAt = newestFetchedAt ?: 0L, stale = anyStale)
    }
}

/** The freshness stamp of any [Resource] variant, or `null` when nothing has loaded for it. */
private fun fetchedAtOf(resource: Resource<*>): Long? =
    when (resource) {
        is Resource.Loading -> resource.fetchedAt
        is Resource.Success -> resource.fetchedAt
        is Resource.Error -> resource.fetchedAt
    }

/** Unwrap a vehicle-info envelope's `data` object (web `envelope?.data`); `null` when absent. */
private fun envelopeData(element: JsonElement?): JsonObject? = (element as? JsonObject)?.get("data") as? JsonObject

/** The raw vehicle-config snapshot as an object (web `configData`); `null` when absent / non-object. */
private fun snapshotObject(element: JsonElement?): JsonObject? = element as? JsonObject

/**
 * Lifecycle-aware state holder backing the Compose [VehicleSpecsWidget] — the native port of the web
 * `VehicleSpecsWidget`'s hook composition (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx).
 * It consumes the cache-then-network [VehicleSpecsSource] (P1/S8) and re-shares it as a single
 * [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that
 * only renders. A payload with no resolved source maps to the empty surface; any resolved source maps
 * to content, mirroring the web `hasAnyData` gate.
 *
 * It owns no networking. [retry] re-collects the source (the web `refetch`) and [onAppear] emits the
 * one-shot `view.opened` diagnostics event with the surface [VehicleSpecsRegistration.SLUG] (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSpecsViewModel(
    private val source: VehicleSpecsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The combined configuration payload as cache-then-network UI state (loading/content/empty/stale/error). */
    val state: StateFlow<UiState<VehicleSpecsData>> =
        retryTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { !it.hasAnyData })

    /** Records the one-shot `view.opened` diagnostics event the first time the surface appears. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SLUG to VehicleSpecsRegistration.SLUG))
    }

    /** Re-collects the source feed (web `refetch`) — used by the error/offline retry affordance. */
    fun retry() {
        logger.info(EVENT_RETRY)
        retryTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SLUG = "slug"
        private const val EVENT_RETRY = "vehicle_specs.retry"

        /**
         * Wire the surface from the shared [VehiclesStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            vehiclesStore: VehiclesStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): VehicleSpecsViewModel =
            VehicleSpecsViewModel(
                source = VehiclesStoreVehicleSpecsSource(vehiclesStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
