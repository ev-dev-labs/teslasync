// The data seam the ChargingDetailPage surface binds to, plus its production binding over a page-local cache-then-network
// repository for the four reads the shared Android graph exposes no store for, and the shared S8 Settings holder. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's data reads: `useChargingSessionDetail` (`/charging/{id}`), `useChargeTelemetry`
// (`/charging/{id}/telemetry`), `useVehicle` (`/vehicles/{id}`) and `useChargingTelemetryLatest`
// (`/charging-telemetry/latest`), plus `useUnits`/`useFormatting` (the `/settings` document).
//
// None of these four per-session/per-vehicle detail reads has a shared store method wired into the Android
// [io.teslasync.android.data.DataContainer], so they are served by the co-located [ChargingDetailRepository]: a
// [CachingRepository] over the SAME shared resilient client + offline cache the shared repositories use (so the
// ADR-013 freshness contract + SI-verbatim caching are identical), wired by the host from the primitives the
// DataContainer already exposes. The display-unit document is the shared [SettingsStore] feed. A narrow seam so the
// view-model depends on an abstraction (real adapters ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingdetail

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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Page-local cache-then-network repository for the four detail reads the Android [io.teslasync.android.data.DataContainer]
 * has no shared store for. It reuses the exact shared machinery — the resilient [ApiHttpClient], the offline
 * [CacheStore], and the [CachingRepository] cache-then-network operator — so each SI payload is cached verbatim and the
 * freshness/offline contract matches every other feed. All reads share the [CacheDomain.Charging] partition (logout
 * clears the whole domain in one call); each read is keyed by its own id so scopes read independently.
 */
class ChargingDetailRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Charging

    /** The cache-then-network `GET /charging/{id}` feed (web `useChargingSessionDetail`). */
    fun chargingSessionDetail(sessionId: Long): Flow<Resource<JsonElement>> =
        observe("$KEY_SESSION:$sessionId") {
            api.request<JsonElement>(path = "/charging/$sessionId")
        }

    /** The cache-then-network `GET /charging/{id}/telemetry` feed (web `useChargeTelemetry`). */
    fun chargeTelemetry(sessionId: Long): Flow<Resource<JsonElement>> =
        observe("$KEY_TELEMETRY:$sessionId") {
            api.request<JsonElement>(path = "/charging/$sessionId/telemetry")
        }

    /** The cache-then-network `GET /vehicles/{id}` feed (web `useVehicle`). */
    fun vehicle(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe("$KEY_VEHICLE:$vehicleId") {
            api.request<JsonElement>(path = "/vehicles/$vehicleId")
        }

    /**
     * The cache-then-network `GET /charging-telemetry/latest?vehicle_id={id}` feed (web `useChargingTelemetryLatest`).
     * A JSON-null body decodes to the empty snapshot in the model.
     */
    fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
        observe("$KEY_LIVE:$vehicleId") {
            api.request<JsonElement>(
                path = "/charging-telemetry/latest",
                query = mapOf("vehicle_id" to vehicleId.toString()),
            )
        }

    private companion object {
        const val KEY_SESSION = "charging-session-detail"
        const val KEY_TELEMETRY = "charge-telemetry"
        const val KEY_VEHICLE = "charging-vehicle"
        const val KEY_LIVE = "charging-telemetry-latest"
    }
}

/**
 * The single seam the [ChargingDetailPageViewModel] depends on so it binds to an abstraction (the page-local charging
 * repository + the shared Settings holder in production; a fake in tests), never to a concrete store or the network.
 * Every read feed is a cache-then-network `Resource` flow (the web read hooks). No HTTP touches the view.
 */
interface ChargingDetailPageSource {
    /** The cache-then-network `GET /charging/{id}` feed (web `useChargingSessionDetail`). */
    fun chargingSessionDetail(sessionId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /charging/{id}/telemetry` feed (web `useChargeTelemetry`). */
    fun chargeTelemetry(sessionId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicles/{id}` feed (web `useVehicle`). */
    fun vehicle(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /charging-telemetry/latest` feed (web `useChargingTelemetryLatest`). */
    fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the page-local [ChargingDetailRepository] and the shared **S8** [SettingsStore] — the memoized,
 * multi-observer feeds the surface needs. The live values flow through unchanged so the view-model renders the full
 * state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun chargingDetailPageSourceOf(
    repository: ChargingDetailRepository,
    settingsStore: SettingsStore,
): ChargingDetailPageSource =
    object : ChargingDetailPageSource {
        override fun chargingSessionDetail(sessionId: Long): Flow<Resource<JsonElement>> =
            repository.chargingSessionDetail(sessionId)

        override fun chargeTelemetry(sessionId: Long): Flow<Resource<JsonElement>> =
            repository.chargeTelemetry(sessionId)

        override fun vehicle(vehicleId: Long): Flow<Resource<JsonElement>> = repository.vehicle(vehicleId)

        override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            repository.chargingTelemetryLatest(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
