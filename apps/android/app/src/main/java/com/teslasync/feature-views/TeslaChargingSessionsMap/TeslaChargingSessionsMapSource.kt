// The data port the TeslaChargingSessionsMap surface binds to (P1/S8 state-holder seam) — the native
// analogue of the web `useTeslaChargingSessions` hook (web/src/api/hooks/useCharging.ts). The view never
// performs HTTP itself; the [ChargingStoreSessionsSource] (or a test fake) drives this. Cache-then-network
// freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow through the
// parse so the view-model can render the full state matrix. The `/tesla/charging/sessions` payload arrives
// as a raw JSON object (`{ sessions: [...], summary: {...} }`), so this file owns the decode from
// `JsonElement` to the typed [TeslaChargingSession] rows the map renders (web reading `data.sessions`).
// Energy stays SI watt-hours and coordinates stay WGS-84 degrees — neither is converted here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaChargingSessionsMap) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslachargingsessionsmap

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.roundToLong

private const val KEY_SESSIONS = "sessions"
private const val KEY_SESSION_ID = "session_id"
private const val KEY_SITE_LOCATION_NAME = "site_location_name"
private const val KEY_CHARGE_START_DATETIME = "charge_start_datetime"
private const val KEY_TOTAL_ENERGY_ADDED_WH = "total_energy_added_wh"
private const val KEY_TOTAL_COST = "total_cost"
private const val KEY_CHARGER_TYPE = "charger_type"
private const val KEY_LATITUDE = "latitude"
private const val KEY_LONGITUDE = "longitude"

/**
 * Streams the cache-then-network `GET /tesla/charging/sessions` rows the map renders. A single-method seam
 * so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the
 * network.
 */
fun interface ChargingSessionsSource {
    /** The cache-then-network sessions feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<List<TeslaChargingSession>>>
}

/**
 * Decode a raw `/tesla/charging/sessions` [JsonElement] (the `{ sessions, summary }` response object) into
 * the typed [TeslaChargingSession] rows the map renders — the native analogue of the web component reading
 * `data.sessions`. A non-object payload, a missing `sessions` array, or a non-object row degrades to an
 * empty list / a skipped row (web `safeArray` / optional-chaining), so a partial payload never throws.
 */
internal fun JsonElement.parseChargingSessions(): List<TeslaChargingSession> {
    val array = (this as? JsonObject)?.get(KEY_SESSIONS) as? JsonArray ?: return emptyList()
    return array.mapNotNull { parseSession(it) }
}

/**
 * Parse a raw [Resource] of the sessions [JsonElement] into a [Resource] of decoded rows, preserving every
 * freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
 * matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or cache.
 */
internal fun Resource<JsonElement>.toChargingSessions(): Resource<List<TeslaChargingSession>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.parseChargingSessions(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = data.parseChargingSessions(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.parseChargingSessions(),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

private fun parseSession(element: JsonElement): TeslaChargingSession? {
    val obj = element as? JsonObject ?: return null
    return TeslaChargingSession(
        sessionId = obj.longField(KEY_SESSION_ID),
        siteLocationName = obj.stringField(KEY_SITE_LOCATION_NAME),
        chargeStartDatetime = obj.stringField(KEY_CHARGE_START_DATETIME),
        totalEnergyAddedWh = obj.doubleField(KEY_TOTAL_ENERGY_ADDED_WH),
        totalCost = obj.doubleField(KEY_TOTAL_COST),
        chargerType = obj.stringField(KEY_CHARGER_TYPE),
        latitude = obj.doubleField(KEY_LATITUDE),
        longitude = obj.doubleField(KEY_LONGITUDE),
    )
}

private fun JsonObject.longField(key: String): Long {
    val primitive = this[key] as? JsonPrimitive ?: return 0L
    return primitive.longOrNull ?: primitive.doubleOrNull?.roundToLong() ?: 0L
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/**
 * The shared-state-holder-backed [ChargingSessionsSource]. It maps the shared
 * [ChargingStore.teslaChargingSessions] cache-then-network feed (web `useTeslaChargingSessions`) into
 * decoded rows. An optional [vin] scopes the feed to one vehicle (web `vin ? byVin(vin) : all`); `null`
 * fetches every business-account session. No HTTP touches the view — the [ChargingStore] (S7/S8) owns it.
 */
class ChargingStoreSessionsSource(
    private val chargingStore: ChargingStore,
    private val vin: String? = null,
) : ChargingSessionsSource {
    override fun stream(): Flow<Resource<List<TeslaChargingSession>>> =
        chargingStore.teslaChargingSessions(vin).map { it.toChargingSessions() }
}
