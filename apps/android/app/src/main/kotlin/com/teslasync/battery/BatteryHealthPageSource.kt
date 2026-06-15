// The data seam the BatteryHealthPage surface binds to, plus its production binding over the shared S8 holders and a
// page-local cache-then-network repository for the two reads the shared stores do not expose to the Android graph. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's data reads: `useBatteryHealthAnalytics` (`/analytics/battery-health`), `useBatteryDegradation`
// (`/analytics/battery-degradation`), `useChargingSessionsPaginated` (`/charging`) and `useChargingTelemetryLatest`
// (`/charging-telemetry/latest`), the global `useSelectedVehicle` scope, and `useUnits` (the `/settings` document).
//
// Two of the four feeds are shared-core cache-then-network `Resource` streams the S8 [EnergyStore] already exposes
// (battery-health + battery-degradation). The other two — the paginated charging-session list and the latest
// charging-telemetry snapshot — have no shared store method wired into the Android [io.teslasync.android.data.DataContainer],
// so they are served by the co-located [BatteryExtrasRepository]: a [CachingRepository] over the SAME shared resilient
// client + offline cache the shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are
// identical), wired by the host from the primitives the DataContainer already exposes. A narrow seam so the view-model
// depends on an abstraction (real adapters ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.batteryhealth

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Recent-session window the battery insights + charge-level distribution read (web `{ limit: 100 }`). */
const val BATTERY_SESSIONS_LIMIT: Int = 100

/**
 * Page-local cache-then-network repository for the two `/charging` reads the Android [io.teslasync.android.data.DataContainer]
 * has no shared store for (it wires no ChargingStore yet). It reuses the exact shared machinery — the resilient
 * [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network operator — so the SI payload
 * is cached verbatim and the freshness/offline contract matches every other feed. Both reads share the
 * [CacheDomain.Charging] partition (logout still clears the whole domain in one call).
 */
class BatteryExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Charging

    /**
     * The cache-then-network `GET /charging?vehicle_id={id}&limit={limit}&offset=0` feed (web
     * `useChargingSessionsPaginated(vehicleId, { limit })`). Cached per vehicle + window so each scope reads
     * independently.
     */
    fun chargingSessions(vehicleId: String, limit: Int): Flow<Resource<JsonElement>> =
        observe("$KEY_SESSIONS:$vehicleId:$limit") {
            api.request<JsonElement>(
                path = "/charging",
                query = mapOf("vehicle_id" to vehicleId, "limit" to limit.toString(), "offset" to "0"),
            )
        }

    /**
     * The cache-then-network `GET /charging-telemetry/latest?vehicle_id={id}` feed (web
     * `useChargingTelemetryLatest`). Cached per vehicle; a JSON-null body decodes to the empty snapshot in the model.
     */
    fun chargingTelemetryLatest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_TELEMETRY:$vehicleId") {
            api.request<JsonElement>(
                path = "/charging-telemetry/latest",
                query = mapOf("vehicle_id" to vehicleId),
            )
        }

    private companion object {
        const val KEY_SESSIONS = "charging-sessions"
        const val KEY_TELEMETRY = "charging-telemetry-latest"
    }
}

/**
 * The single seam the [BatteryHealthPageViewModel] depends on so it binds to an abstraction (the shared Energy +
 * Settings holders, the page-local charging repository, and the app-scoped selection in production; a fake in tests),
 * never to a concrete store or the network. Every read feed is a cache-then-network `Resource` flow (the web read
 * hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface BatteryHealthPageSource {
    /** The cache-then-network `GET /analytics/battery-health` feed for [vehicleId] (web `useBatteryHealthAnalytics`). */
    fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /analytics/battery-degradation` feed for [vehicleId] (web `useBatteryDegradation`). */
    fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network paginated `GET /charging` feed for [vehicleId] (web `useChargingSessionsPaginated`). */
    fun chargingSessions(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /charging-telemetry/latest` feed for [vehicleId] (web `useChargingTelemetryLatest`). */
    fun chargingTelemetryLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] and the
 * page-local [BatteryExtrasRepository] — the memoized, multi-observer feeds every surface shares app-wide. The live
 * values flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun batteryHealthPageSourceOf(
    extras: BatteryExtrasRepository,
    energyStore: EnergyStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): BatteryHealthPageSource =
    object : BatteryHealthPageSource {
        override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.batteryHealthAnalytics(vehicleId)

        override fun batteryDegradation(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.batteryDegradation(vehicleId)

        override fun chargingSessions(vehicleId: String): Flow<Resource<JsonElement>> =
            extras.chargingSessions(vehicleId, BATTERY_SESSIONS_LIMIT)

        override fun chargingTelemetryLatest(vehicleId: String): Flow<Resource<JsonElement>> =
            extras.chargingTelemetryLatest(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
