package io.teslasync.shared.core.presentation.vehicles

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VEHICLES_FAMILY
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.data.repo.chargingTelemetryLatestKey
import io.teslasync.shared.core.data.repo.climateLatestKey
import io.teslasync.shared.core.data.repo.driveDynamicsLatestKey
import io.teslasync.shared.core.data.repo.locationSnapshotLatestKey
import io.teslasync.shared.core.data.repo.mediaLatestKey
import io.teslasync.shared.core.data.repo.mobileEnabledKey
import io.teslasync.shared.core.data.repo.motorHistoryKey
import io.teslasync.shared.core.data.repo.motorLatestKey
import io.teslasync.shared.core.data.repo.securityLatestKey
import io.teslasync.shared.core.data.repo.tirePressureLatestKey
import io.teslasync.shared.core.data.repo.userPreferenceLatestKey
import io.teslasync.shared.core.data.repo.vehicleConfigLatestKey
import io.teslasync.shared.core.data.repo.vehicleDetailKey
import io.teslasync.shared.core.data.repo.vehicleOptionsKey
import io.teslasync.shared.core.data.repo.vehiclePositionsKey
import io.teslasync.shared.core.data.repo.vehicleSpecsKey
import io.teslasync.shared.core.data.repo.vehicleStateKey
import io.teslasync.shared.core.data.repo.vehicleSubscriptionsKey
import io.teslasync.shared.core.data.repo.vehicleUpgradesKey
import io.teslasync.shared.core.data.repo.vehiclesKey
import io.teslasync.shared.core.data.repo.vehiclesKeyInFamily
import io.teslasync.shared.core.data.repo.warrantyDetailsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the Vehicles domain — the cross-platform port of the web
 * `useVehicles` hook domain (web/src/api/hooks/useVehicles.ts). Every native Vehicles screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the `safeArray` guards, the `useVehicleState`
 * normalisation, or the invalidation families.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is lazily
 * created on first access, shared so every observer of the same `(feed, params)` folds into one
 * upstream collection, and refreshable. The ten mutations are non-throwing suspend [Result]s; on
 * success each refreshes EXACTLY the feed family the matching web hook invalidates via
 * `invalidateQueries`:
 *  - [refreshVehicle]/[deleteVehicle]/[syncVehicles] → the [VEHICLES_FAMILY] (`['vehicles']`), which
 *    covers both the enrolled-vehicle list AND every per-vehicle detail (`['vehicles', id]`). The
 *    `|` separator boundary keeps it from touching the `vehicle-state`/`vehicle-options`/… cousins;
 *  - [refreshVehicleMobileEnabled]/[refreshVehicleOptions]/[refreshVehicleSpecs]/
 *    [refreshVehicleSubscriptions]/[refreshVehicleUpgrades]/[refreshWarrantyDetails] → ONLY the one
 *    info-envelope feed the matching web hook invalidates (e.g. `['vehicle-options', id]`);
 *  - [wakeVehicle] → nothing (the web hook only toasts).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder makes
 * no network calls itself — it delegates entirely to the injected [VehiclesRepository] (S7). A feed
 * nobody is observing is a no-op to refresh.
 *
 * The web per-read `refetchInterval` polls, the `enabled` lazy gates (`vehicleId > 0`, `!!vehicleId`),
 * and the mutation toasts are render-layer concerns and are intentionally NOT reproduced here; a
 * platform pull-to-refresh / live-poll cadence drives re-collection. Values stay SI; conversion is
 * display-only (S5). This holder mirrors the web hook's single-threaded usage and is not internally
 * synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class VehiclesStore(
    private val repo: VehiclesRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val vehicleListFeeds = mutableMapOf<String, StateFlow<Resource<List<Vehicle>>>>()
    private val vehicleFeeds = mutableMapOf<String, StateFlow<Resource<Vehicle>>>()
    private val stateFeeds = mutableMapOf<String, StateFlow<Resource<VehicleStateEnvelope>>>()
    private val jsonFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /vehicles` list feed (web `useVehicles`). */
    public fun vehicles(): StateFlow<Resource<List<Vehicle>>> = feed(vehiclesKey(), vehicleListFeeds) { repo.vehicles() }

    /** Shared, refreshable `GET /vehicles/{id}` detail feed (web `useVehicle`). */
    public fun vehicle(id: String): StateFlow<Resource<Vehicle>> = feed(vehicleDetailKey(id), vehicleFeeds) { repo.vehicle(id) }

    /** Shared, refreshable `GET /vehicles/{id}/state[?as_of=]` feed (web `useVehicleState`). */
    public fun vehicleState(
        vehicleId: Long,
        asOf: String? = null,
    ): StateFlow<Resource<VehicleStateEnvelope>> = feed(vehicleStateKey(vehicleId, asOf), stateFeeds) { repo.vehicleState(vehicleId, asOf) }

    /** Shared, refreshable `GET /vehicles/{id}/positions` feed (web `useVehiclePositions`). */
    public fun vehiclePositions(
        vehicleId: Long,
        limit: Int = VehiclesRepository.DEFAULT_POSITIONS_LIMIT,
    ): StateFlow<Resource<JsonElement>> = feed(vehiclePositionsKey(vehicleId), jsonFeeds) { repo.vehiclePositions(vehicleId, limit) }

    /** Shared, refreshable `GET /motor/latest` feed (web `useMotorLatest`). */
    public fun motorLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(motorLatestKey(vehicleId), jsonFeeds) { repo.motorLatest(vehicleId) }

    /** Shared, refreshable `GET /motor` history feed (web `useMotorHistory`). */
    public fun motorHistory(
        vehicleId: Long,
        limit: Int = VehiclesRepository.DEFAULT_MOTOR_HISTORY_LIMIT,
    ): StateFlow<Resource<JsonElement>> = feed(motorHistoryKey(vehicleId, limit), jsonFeeds) { repo.motorHistory(vehicleId, limit) }

    /** Shared, refreshable `GET /drive-dynamics/latest` feed (web `useDriveDynamicsLatest`). */
    public fun driveDynamicsLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(driveDynamicsLatestKey(vehicleId), jsonFeeds) { repo.driveDynamicsLatest(vehicleId) }

    /** Shared, refreshable `GET /climate/latest` feed (web `useClimateLatest`). */
    public fun climateLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(climateLatestKey(vehicleId), jsonFeeds) { repo.climateLatest(vehicleId) }

    /** Shared, refreshable `GET /security/latest` feed (web `useSecurityLatest`). */
    public fun securityLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(securityLatestKey(vehicleId), jsonFeeds) { repo.securityLatest(vehicleId) }

    /** Shared, refreshable `GET /tire-pressure/latest` feed (web `useLatestTirePressure`). */
    public fun latestTirePressure(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(tirePressureLatestKey(vehicleId), jsonFeeds) { repo.latestTirePressure(vehicleId) }

    /** Shared, refreshable `GET /charging-telemetry/latest` feed (web `useChargingTelemetryLatest`). */
    public fun chargingTelemetryLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(chargingTelemetryLatestKey(vehicleId), jsonFeeds) { repo.chargingTelemetryLatest(vehicleId) }

    /** Shared, refreshable `GET /media/latest` feed (web `useMediaLatest`). */
    public fun mediaLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(mediaLatestKey(vehicleId), jsonFeeds) { repo.mediaLatest(vehicleId) }

    /** Shared, refreshable `GET /location-snapshots/latest` feed (web `useLocationSnapshotLatest`). */
    public fun locationSnapshotLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(locationSnapshotLatestKey(vehicleId), jsonFeeds) { repo.locationSnapshotLatest(vehicleId) }

    /** Shared, refreshable `GET /vehicle-config/latest` feed (web `useVehicleConfigLatest`). */
    public fun vehicleConfigLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(vehicleConfigLatestKey(vehicleId), jsonFeeds) { repo.vehicleConfigLatest(vehicleId) }

    /** Shared, refreshable `GET /user-preferences/latest` feed (web `useUserPreferenceLatest`). */
    public fun userPreferenceLatest(vehicleId: Long): StateFlow<Resource<JsonElement>> =
        feed(userPreferenceLatestKey(vehicleId), jsonFeeds) { repo.userPreferenceLatest(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/mobile-enabled` feed (web `useVehicleMobileEnabled`). */
    public fun vehicleMobileEnabled(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(mobileEnabledKey(vehicleId), jsonFeeds) { repo.vehicleMobileEnabled(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/options` feed (web `useVehicleOptions`). */
    public fun vehicleOptions(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(vehicleOptionsKey(vehicleId), jsonFeeds) { repo.vehicleOptions(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/specs` feed (web `useVehicleSpecs`). */
    public fun vehicleSpecs(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(vehicleSpecsKey(vehicleId), jsonFeeds) { repo.vehicleSpecs(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/subscriptions` feed (web `useVehicleSubscriptions`). */
    public fun vehicleSubscriptions(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(vehicleSubscriptionsKey(vehicleId), jsonFeeds) { repo.vehicleSubscriptions(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/upgrades` feed (web `useVehicleUpgrades`). */
    public fun vehicleUpgrades(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(vehicleUpgradesKey(vehicleId), jsonFeeds) { repo.vehicleUpgrades(vehicleId) }

    /** Shared, refreshable `GET /tesla/warranty` feed (web `useWarrantyDetails`). */
    public fun warrantyDetails(): StateFlow<Resource<JsonElement>> = feed(warrantyDetailsKey(), jsonFeeds) { repo.warrantyDetails() }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Wakes/refreshes a vehicle and returns the refreshed [Vehicle], then re-fetches the
     * [VEHICLES_FAMILY] (web `useRefreshVehicle` seeds the detail cache and invalidates
     * `['vehicles']`, which by prefix covers both the list and the per-vehicle detail).
     */
    public suspend fun refreshVehicle(id: String): Result<Vehicle> = repo.refreshVehicle(id).onSuccess { refreshFamily(VEHICLES_FAMILY) }

    /** Deletes a vehicle, then re-fetches the [VEHICLES_FAMILY] (web `useDeleteVehicle` invalidates `['vehicles']`). */
    public suspend fun deleteVehicle(id: Long): Result<Unit> = repo.deleteVehicle(id).onSuccess { refreshFamily(VEHICLES_FAMILY) }

    /** Syncs vehicles from Tesla, then re-fetches the [VEHICLES_FAMILY] (web `useSyncVehicles` invalidates `['vehicles']`). */
    public suspend fun syncVehicles(): Result<JsonElement> = repo.syncVehicles().onSuccess { refreshFamily(VEHICLES_FAMILY) }

    /** Sends a wake command (web `useWakeVehicle`). The web hook only toasts, so no feed is refreshed. */
    public suspend fun wakeVehicle(id: Long): Result<JsonElement> = repo.wakeVehicle(id)

    /** Refreshes the mobile-access envelope, then re-fetches that one feed (web `useRefreshVehicleMobileEnabled`). */
    public suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement> =
        repo.refreshVehicleMobileEnabled(id).onSuccess { refreshFamily(mobileEnabledKey(id)) }

    /** Refreshes the options envelope, then re-fetches that one feed (web `useRefreshVehicleOptions`). */
    public suspend fun refreshVehicleOptions(id: String): Result<JsonElement> =
        repo.refreshVehicleOptions(id).onSuccess { refreshFamily(vehicleOptionsKey(id)) }

    /** Refreshes the specs envelope, then re-fetches that one feed (web `useRefreshVehicleSpecs`). */
    public suspend fun refreshVehicleSpecs(id: String): Result<JsonElement> =
        repo.refreshVehicleSpecs(id).onSuccess { refreshFamily(vehicleSpecsKey(id)) }

    /** Refreshes the subscriptions envelope, then re-fetches that one feed (web `useRefreshVehicleSubscriptions`). */
    public suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement> =
        repo.refreshVehicleSubscriptions(id).onSuccess { refreshFamily(vehicleSubscriptionsKey(id)) }

    /** Refreshes the upgrades envelope, then re-fetches that one feed (web `useRefreshVehicleUpgrades`). */
    public suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement> =
        repo.refreshVehicleUpgrades(id).onSuccess { refreshFamily(vehicleUpgradesKey(id)) }

    /** Refreshes the warranty envelope, then re-fetches that one feed (web `useRefreshWarrantyDetails`). */
    public suspend fun refreshWarrantyDetails(): Result<JsonElement> =
        repo.refreshWarrantyDetails().onSuccess { refreshFamily(warrantyDetailsKey()) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection (via [refreshFamily]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at least
     * one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /**
     * Re-fetches every observed feed whose key belongs to [family] under TanStack prefix-invalidation
     * semantics ([vehiclesKeyInFamily]) — the holder-side analogue of
     * `invalidateQueries({ queryKey: [family] })`. The keys are snapshotted before iterating so a
     * concurrent feed creation cannot disturb the walk; a family nobody observes is a no-op.
     */
    private fun refreshFamily(family: String) {
        triggers.keys
            .filter { vehiclesKeyInFamily(it, family) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
