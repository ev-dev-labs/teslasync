// The data seam the DrivetrainHealthPage surface binds to, plus its production binding over a page-local cache-then-network
// repository for the five reads the shared stores do not expose to the Android graph. The view (composable) performs NO
// HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's data reads:
// `useDrivetrainHealth` (`/drivetrain/health`), `useDrives` (`/drives`), `useDrivingStats` (`/drives/stats`),
// `useMotorLatest` (`/motor/latest`) and `useMotorHistory` (`/motor`), the global `useSelectedVehicle` scope, and
// `useUnits` (the `/settings` document).
//
// None of the five Driving/motor reads have a shared store method wired into the Android
// [io.teslasync.android.data.DataContainer] (it wires no DrivingStore), so they are all served by the co-located
// [DrivetrainExtrasRepository]: a [CachingRepository] over the SAME shared resilient client + offline cache the shared
// repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical), wired by the host from the
// primitives the DataContainer already exposes. A narrow seam so the view-model depends on an abstraction
// (real adapters ↔ test fake), never on a concrete store or the network. This mirrors the sibling
// [io.teslasync.android.battery.batteryhealth.BatteryExtrasRepository] precedent for store-less reads.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.drivetrainhealth

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
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Recent-snapshot window the motor-history charts read (web `useMotorHistory(vehicleId, 200)`). */
const val MOTOR_HISTORY_LIMIT: Int = 200

/**
 * Page-local cache-then-network repository for the five Driving/motor reads the Android
 * [io.teslasync.android.data.DataContainer] has no shared store for (it wires no DrivingStore yet). It reuses the exact
 * shared machinery — the resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository]
 * cache-then-network operator — so the SI payload is cached verbatim and the freshness/offline contract matches every
 * other feed. All reads share the [CacheDomain.Drives] partition (logout still clears the whole domain in one call).
 */
class DrivetrainExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Drives

    /** The cache-then-network `GET /drivetrain/health?vehicle_id={id}` feed (web `useDrivetrainHealth`). */
    fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_HEALTH:$vehicleId") {
            api.request<JsonElement>(path = "/drivetrain/health", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /drives?vehicle_id={id}` feed (web `useDrives`). */
    fun drives(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_DRIVES:$vehicleId") {
            api.request<JsonElement>(path = "/drives", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /drives/stats?vehicle_id={id}` feed (web `useDrivingStats`). */
    fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_STATS:$vehicleId") {
            api.request<JsonElement>(path = "/drives/stats", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /motor/latest?vehicle_id={id}` feed (web `useMotorLatest`). */
    fun motorLatest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_MOTOR_LATEST:$vehicleId") {
            api.request<JsonElement>(path = "/motor/latest", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /motor?vehicle_id={id}&limit={limit}` feed (web `useMotorHistory`). */
    fun motorHistory(vehicleId: String, limit: Int): Flow<Resource<JsonElement>> =
        observe("$KEY_MOTOR_HISTORY:$vehicleId:$limit") {
            api.request<JsonElement>(
                path = "/motor",
                query = mapOf("vehicle_id" to vehicleId, "limit" to limit.toString()),
            )
        }

    private companion object {
        const val KEY_HEALTH = "drivetrain-health"
        const val KEY_DRIVES = "drivetrain-drives"
        const val KEY_STATS = "drivetrain-stats"
        const val KEY_MOTOR_LATEST = "drivetrain-motor-latest"
        const val KEY_MOTOR_HISTORY = "drivetrain-motor-history"
    }
}

/**
 * The single seam the [DrivetrainHealthPageViewModel] depends on so it binds to an abstraction (the page-local Driving
 * repository, the shared Settings holder, and the app-scoped selection in production; a fake in tests), never to a
 * concrete store or the network. Every read feed is a cache-then-network `Resource` flow (the web read hooks); the
 * selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface DrivetrainHealthPageSource {
    /** The cache-then-network `GET /drivetrain/health` feed for [vehicleId] (web `useDrivetrainHealth`). */
    fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drives` feed for [vehicleId] (web `useDrives`). */
    fun drives(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drives/stats` feed for [vehicleId] (web `useDrivingStats`). */
    fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /motor/latest` feed for [vehicleId] (web `useMotorLatest`). */
    fun motorLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /motor` history feed for [vehicleId] (web `useMotorHistory`). */
    fun motorHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [DrivetrainExtrasRepository] + the shared **S8** [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun drivetrainHealthPageSourceOf(
    extras: DrivetrainExtrasRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): DrivetrainHealthPageSource =
    object : DrivetrainHealthPageSource {
        override fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> = extras.drivetrainHealth(vehicleId)

        override fun drives(vehicleId: String): Flow<Resource<JsonElement>> = extras.drives(vehicleId)

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> = extras.drivingStats(vehicleId)

        override fun motorLatest(vehicleId: String): Flow<Resource<JsonElement>> = extras.motorLatest(vehicleId)

        override fun motorHistory(vehicleId: String): Flow<Resource<JsonElement>> =
            extras.motorHistory(vehicleId, MOTOR_HISTORY_LIMIT)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
