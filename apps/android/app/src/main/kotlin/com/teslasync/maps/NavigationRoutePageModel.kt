// Pure, framework-free model + projections for the NavigationRoutePage maps surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/maps/pages/NavigationRoutePage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it references only kotlinx.serialization JSON, the shared
// SI converters, and java.time), so the composable stays a thin render layer and all of this is exercised off-device by
// the :android:testDebugUnitTest gate.
//
// The web page reads four sources: the `/vehicles` list (page gate), the `/location-snapshots/latest` snapshot (the
// navigation-status panel + the location-status cards + the route-metric cards), the `/location-snapshots?limit=200`
// history (the speed-profile area chart, the home/work presence line chart, the recent-destinations table and the
// location-history table) and the `/charging-telemetry/latest` projection (web `useChargingTelemetryLatest`, the
// expected-energy-at-arrival metric). This file ports the JSON decode of each ([parseLocationSnapshot] /
// [parseLocationHistory] / [parseChargingTelemetry]) and the verbatim `useMemo` derivations over the history
// ([speedProfile] / [presenceSeries] / [recentDestinations] / [avgSpeedDisplay] / [buildWaypoints]).
//
// SI boundary (unit-conversion.instructions / Phase-48): the wire stays SI — `speed_mph` is metres-per-second and
// `miles_to_arrival` is metres despite the legacy field names (see the web page's SI-floor comment). The only display
// conversion lives in the explicit [NavDisplayPrefs] helpers used at the render boundary, exactly as the web page
// converts only inside its `convertSpeedFromSI` / `convertDistanceFromSI` / `formatDuration` callbacks (ADR-013 keeps
// the cache SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.maps.navigationroute

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.formatDuration
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `NavigationRoutePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("navigationRoute", "/navigation", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to
 * that destination (and its `/navigation` deep link) without the nav module depending on it.
 */
object NavigationRoutePageRegistration {
    /** The navigation destination id (Destinations.kt `page("navigationRoute", "/navigation", …)`). */
    const val ROUTE_ID: String = "navigationRoute"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/navigation"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle / location payload. */
    const val SLUG: String = "NavigationRoutePage"

    /** The location-history read window (web `&limit=200`). */
    const val HISTORY_LIMIT: Int = 200

    /** The recent-destinations table caps at the 20 most-recent unique destinations (web `.slice(0, 20)`). */
    const val RECENT_DESTINATIONS_LIMIT: Int = 20
}

/* ------------------------------------------------------------------ */
/*  Location snapshot (GET /location-snapshots[/latest])              */
/* ------------------------------------------------------------------ */

/**
 * One decoded `/location-snapshots` row — the native analogue of the web `LocationSnapshot` interface. Every figure is
 * raw on the wire (SI: `speedMps` is metres-per-second, `milesToArrivalMeters` is metres — the legacy `speed_mph` /
 * `miles_to_arrival` names are kept for backward compat but the values are SI canonical), converted only at the render
 * boundary via [NavDisplayPrefs]. Nullable fields stay nullable so the page can show its em-dash / fallback markers.
 */
data class LocationSnapshot(
    val id: Long,
    val latitude: Double?,
    val longitude: Double?,
    val heading: Double?,
    val gpsState: String?,
    val speedMps: Double?,
    val destinationName: String?,
    val milesToArrivalMeters: Double?,
    val minutesToArrival: Double?,
    val routeTrafficDelaySeconds: Double?,
    val routeLastUpdated: String?,
    val locatedAtHome: Boolean?,
    val locatedAtWork: Boolean?,
    val homelinkNearby: Boolean?,
    val createdAt: String?,
) {
    /** Whether the snapshot carries a non-zero GPS fix (web `hasValidLocation`). */
    val hasValidLocation: Boolean
        get() {
            val la = latitude
            val lo = longitude
            return la != null && lo != null && (la != 0.0 || lo != 0.0)
        }

    /** Whether an active route is in progress (web `hasActiveRoute = latest?.destination_name != null`). */
    val hasActiveRoute: Boolean get() = destinationName != null
}

/**
 * Decodes the raw `/location-snapshots/latest` [json] (SI, snake_case on the wire) into a [LocationSnapshot], or `null`
 * when the body is absent / not an object / an empty object — reproducing the web `latest ?` truthiness guard.
 */
fun parseLocationSnapshot(json: JsonElement?): LocationSnapshot? {
    val obj = json as? JsonObject
    if (obj == null || obj.isEmpty()) return null
    return LocationSnapshot(
        id = obj.long("id") ?: 0L,
        latitude = obj.double("latitude"),
        longitude = obj.double("longitude"),
        heading = obj.double("heading"),
        gpsState = obj.string("gps_state"),
        speedMps = obj.double("speed_mph"),
        destinationName = obj.string("destination_name"),
        milesToArrivalMeters = obj.double("miles_to_arrival"),
        minutesToArrival = obj.double("minutes_to_arrival"),
        routeTrafficDelaySeconds = obj.double("route_traffic_delay_s"),
        routeLastUpdated = obj.string("route_last_updated"),
        locatedAtHome = obj.bool("located_at_home"),
        locatedAtWork = obj.bool("located_at_work"),
        homelinkNearby = obj.bool("homelink_nearby"),
        createdAt = obj.string("created_at"),
    )
}

/**
 * Decodes the raw `/location-snapshots` history [json] (a SI array on the wire) into a list of [LocationSnapshot]. A
 * non-array body (the `safeArray` guard) or any non-object element collapses to an empty list, so the charts/tables
 * render their own empty states rather than crashing.
 */
fun parseLocationHistory(json: JsonElement?): List<LocationSnapshot> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { parseLocationSnapshot(it) }
}

/* ------------------------------------------------------------------ */
/*  Charging telemetry (GET /charging-telemetry/latest)               */
/* ------------------------------------------------------------------ */

/**
 * The decoded `/charging-telemetry/latest` projection — the only field the navigation page reads from the web
 * `useChargingTelemetryLatest` hook: the expected battery percentage at the route's destination ([expectedEnergyPctAtArrival]).
 */
data class ChargingTelemetry(
    val expectedEnergyPctAtArrival: Double?,
)

/** Decodes the raw `/charging-telemetry/latest` [json]; a missing field / non-object yields a `null` projection. */
fun parseChargingTelemetry(json: JsonElement?): ChargingTelemetry {
    val obj = json as? JsonObject ?: return ChargingTelemetry(null)
    return ChargingTelemetry(expectedEnergyPctAtArrival = obj.double("expected_energy_pct_at_arrival"))
}

/* ------------------------------------------------------------------ */
/*  Heading + GPS helpers                                              */
/* ------------------------------------------------------------------ */

/** Maps a compass bearing in degrees to its 8-point cardinal label — the verbatim web `headingToCardinal`. */
fun headingToCardinal(deg: Double?): String {
    if (deg == null) return EM_DASH
    val dirs = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    val index = (Math.round(deg / DEGREES_PER_OCTANT).toInt() % dirs.size + dirs.size) % dirs.size
    return dirs[index]
}

/** The canonical GPS-fix states the catalog labels (`nav.gpsState.*`). */
enum class GpsFixState { Locked, Unlocked, Unknown }

/**
 * Normalizes the polymorphic `gps_state` signal to one of [GpsFixState] — the verbatim port of the web
 * `normalizeGpsState` (Tesla emits "true"/"false"; legacy data uses "GPSValid"/"GPSInvalid"; canonical enum is
 * NoFix/Fix2D/Fix3D). An unrecognised / blank / null value resolves to [GpsFixState.Unknown].
 */
fun normalizeGpsState(raw: String?): GpsFixState {
    val v = raw?.trim()?.lowercase().orEmpty()
    val locked = setOf("true", "1", "yes", "gpsvalid", "fix2d", "fix3d", "normal", "good", "strong", "ok", "valid")
    val unlocked = setOf("false", "0", "no", "gpsinvalid", "nofix", "invalid", "none")
    return when {
        v.isEmpty() -> GpsFixState.Unknown
        v in locked -> GpsFixState.Locked
        v in unlocked -> GpsFixState.Unlocked
        else -> GpsFixState.Unknown
    }
}

/* ------------------------------------------------------------------ */
/*  Traffic-delay severity                                            */
/* ------------------------------------------------------------------ */

/** The semantic severity of a traffic delay — the web badge `variant` ladder (success ▸ warning ▸ danger). */
enum class TrafficSeverity { Ok, Warning, Critical }

/** Maps a traffic delay (seconds) to its severity — verbatim web `seconds < 300 ? … : seconds <= 900 ? … : …`. */
fun trafficSeverity(seconds: Double): TrafficSeverity =
    when {
        seconds < TRAFFIC_WARN_SECONDS -> TrafficSeverity.Ok
        seconds <= TRAFFIC_CRITICAL_SECONDS -> TrafficSeverity.Warning
        else -> TrafficSeverity.Critical
    }

/* ------------------------------------------------------------------ */
/*  History-derived projections (useMemo analogues)                   */
/* ------------------------------------------------------------------ */

/** One point in the speed-profile area chart — the web `chartData[]` row (already display-converted). */
data class SpeedProfilePoint(
    /** The short local time label for the x-axis (web `formatDateTime` ▸ tickFormatter time part). */
    val time: String,
    /** The snapshot speed in the user's display unit (web `convertSpeedFromSI(speed_mph, speedUnit)`). */
    val speed: Double,
    /** The distance-to-arrival in the user's display unit (web `convertDistanceFromSI(miles_to_arrival, distanceUnit)`). */
    val distance: Double,
)

/**
 * Projects [history] into the ascending speed-profile points — the verbatim port of the web `chartData` `useMemo`
 * (sort by `created_at` then convert both axes to the user's units via [prefs]).
 */
fun speedProfile(
    history: List<LocationSnapshot>,
    prefs: NavDisplayPrefs,
    zone: ZoneId = ZoneId.systemDefault(),
): List<SpeedProfilePoint> =
    history
        .sortedBy { it.epochMillis() }
        .map { snap ->
            SpeedProfilePoint(
                time = formatTimeLabel(snap.createdAt, zone, prefs.locale),
                speed = prefs.toSpeedDisplay(snap.speedMps ?: 0.0),
                distance = prefs.toDistanceDisplay(snap.milesToArrivalMeters ?: 0.0),
            )
        }

/** One point in the home/work presence step chart — the web `presenceChartData[]` row (1.0 present / 0.0 absent). */
data class PresencePoint(
    val time: String,
    val home: Double,
    val work: Double,
    val homelink: Double,
)

/** Projects [history] into the ascending presence step series — the verbatim port of the web `presenceChartData`. */
fun presenceSeries(
    history: List<LocationSnapshot>,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.US,
): List<PresencePoint> =
    history
        .sortedBy { it.epochMillis() }
        .map { snap ->
            PresencePoint(
                time = formatTimeLabel(snap.createdAt, zone, locale),
                home = if (snap.locatedAtHome == true) 1.0 else 0.0,
                work = if (snap.locatedAtWork == true) 1.0 else 0.0,
                homelink = if (snap.homelinkNearby == true) 1.0 else 0.0,
            )
        }

/** One row in the recent-destinations table — the web `recentDestinations[]` row (already display-formatted). */
data class DestinationRow(
    val time: String,
    val destination: String,
    /** The distance remaining in the user's display unit (web `convertDistanceFromSI(miles_to_arrival, distanceUnit)`). */
    val distance: Double,
    /** The ETA in minutes (web `minutes_to_arrival ?? 0`). */
    val etaMinutes: Double,
)

/**
 * Projects the unique active-route destinations from [history] into the recent-destinations rows, capped at 20 — the
 * verbatim port of the web `recentDestinations` `useMemo` (first-seen wins; distance converted via [prefs]).
 */
fun recentDestinations(
    history: List<LocationSnapshot>,
    prefs: NavDisplayPrefs,
    zone: ZoneId = ZoneId.systemDefault(),
): List<DestinationRow> {
    if (history.isEmpty()) return emptyList()
    val seen = HashSet<String>()
    val rows = ArrayList<DestinationRow>()
    for (snap in history) {
        val name = snap.destinationName
        if (name != null && seen.add(name)) {
            rows.add(
                DestinationRow(
                    time = formatDateTime(snap.createdAt, zone, prefs.locale),
                    destination = name,
                    distance = prefs.toDistanceDisplay(snap.milesToArrivalMeters ?: 0.0),
                    etaMinutes = snap.minutesToArrival ?: 0.0,
                ),
            )
        }
    }
    return rows.take(NavigationRoutePageRegistration.RECENT_DESTINATIONS_LIMIT)
}

/**
 * The display average speed over [history] — the verbatim port of the web `avgSpeed` `useMemo`: average the positive
 * SI speeds, then convert at the boundary via [prefs]. Returns 0.0 for an empty / all-zero history.
 */
fun avgSpeedDisplay(
    history: List<LocationSnapshot>,
    prefs: NavDisplayPrefs,
): Double {
    val speeds = history.mapNotNull { it.speedMps }.filter { it > 0.0 }
    if (speeds.isEmpty()) return 0.0
    val avgMps = speeds.sum() / speeds.size
    return prefs.toSpeedDisplay(avgMps)
}

/** One waypoint row — the web `Waypoint` (always a single `destination` derived from the latest active route). */
data class Waypoint(
    val name: String,
    val type: WaypointType,
    /** The distance to the waypoint in SI metres (converted to display units at the render boundary). */
    val distanceMeters: Double,
)

/** Waypoint kind — the web `'supercharger' | 'destination' | 'waypoint'` union. */
enum class WaypointType { Supercharger, Destination, Waypoint }

/** Builds the waypoint list from the latest snapshot — the verbatim web `buildWaypoints` (empty when no destination). */
fun buildWaypoints(latest: LocationSnapshot?): List<Waypoint> {
    val name = latest?.destinationName ?: return emptyList()
    return listOf(
        Waypoint(
            name = name,
            type = WaypointType.Destination,
            distanceMeters = latest.milesToArrivalMeters ?: 0.0,
        ),
    )
}

/* ------------------------------------------------------------------ */
/*  Location-history table rows                                       */
/* ------------------------------------------------------------------ */

/** One row in the location-history table — the web `historyColumns` projection over a snapshot (display-formatted). */
data class HistoryRow(
    val id: Long,
    val time: String,
    val latitude: String,
    val longitude: String,
    val atHome: Boolean?,
    val atWork: Boolean?,
    val destination: String,
)

/** Projects [history] (newest first) into the location-history table rows — the web `sortedHistory` default (time desc). */
fun historyRows(
    history: List<LocationSnapshot>,
    locale: Locale,
    zone: ZoneId = ZoneId.systemDefault(),
): List<HistoryRow> =
    history
        .sortedByDescending { it.epochMillis() }
        .map { snap ->
            HistoryRow(
                id = snap.id,
                time = formatDateTime(snap.createdAt, zone, locale),
                latitude = snap.latitude?.takeIf { it != 0.0 }
                    ?.let { ChartFormat.number(it, COORD_DECIMALS, locale) } ?: EM_DASH,
                longitude = snap.longitude?.takeIf { it != 0.0 }
                    ?.let { ChartFormat.number(it, COORD_DECIMALS, locale) } ?: EM_DASH,
                atHome = snap.locatedAtHome,
                atWork = snap.locatedAtWork,
                destination = snap.destinationName ?: EM_DASH,
            )
        }

/* ------------------------------------------------------------------ */
/*  Display preferences (useUnits)                                    */
/* ------------------------------------------------------------------ */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the distance + speed units (the metric cards, the chart axes, the tables) and the duration formatter +
 * locale (the traffic-delay figures). The backend stores and serves SI; this is the single place a preference becomes a
 * display unit, so the SI source is never stored converted (Phase-48; ADR-013 keeps the cache SI).
 */
data class NavDisplayPrefs(
    val unitPref: UnitPref,
) {
    /** The user's locale for grouped-number formatting (web `_globalLocale`, en-US fallback). */
    val locale: Locale =
        runCatching { Locale.forLanguageTag(unitPref.locale ?: DEFAULT_LOCALE) }.getOrDefault(Locale.US)

    /** The user's default fraction digits (web `_globalPrecision`, floored & non-negative, else 2). */
    val precision: Int = unitPref.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION

    /** The distance unit preference + label (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unitPref.distance
    val distanceLabel: String get() = unitPref.distance.label

    /** The speed unit preference + label (web `unitPrefs.speed`). */
    val speedUnit: SpeedUnitPref get() = unitPref.speed
    val speedLabel: String get() = unitPref.speed.label

    /** SI metres → the user's display distance (web `convertDistanceFromSI`). */
    fun toDistanceDisplay(meters: Double): Double = convertDistanceFromSI(meters, unitPref.distance)

    /** SI metres-per-second → the user's display speed (web `convertSpeedFromSI`). */
    fun toSpeedDisplay(mps: Double): Double = convertSpeedFromSI(mps, unitPref.speed)

    /** SI seconds → the user's display duration string (web `formatDuration`). */
    fun duration(seconds: Double?): String = formatDuration(seconds, unitPref)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`); defaults to the user's precision. */
    fun number(
        value: Double,
        decimals: Int = precision,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number + a trailing [unit] (web `fmtNumber(value, decimals) + ' ' + unit`). */
    fun withUnit(
        value: Double,
        unit: String,
        decimals: Int = precision,
    ): String = "${ChartFormat.number(value, decimals, locale)} $unit"

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        fun default(): NavDisplayPrefs = NavDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): NavDisplayPrefs =
            NavDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/* ------------------------------------------------------------------ */
/*  Diagnostics + Resource mapping                                    */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NavigationRoutePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, coordinates, or destination payload.
 */
fun recordNavigationRoutePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NavigationRoutePageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. Pure, so the
 * view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/* ------------------------------------------------------------------ */
/*  JSON + time helpers                                               */
/* ------------------------------------------------------------------ */

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

private fun JsonObject.bool(key: String): Boolean? = prim(key)?.booleanOrNull

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull?.takeIf { it.isNotBlank() }

/** Parses an ISO-8601 `created_at` to epoch millis (UTC instant or offset), or `0` when unparseable. */
internal fun LocationSnapshot.epochMillis(): Long = parseInstant(createdAt)?.toEpochMilli() ?: 0L

private fun parseInstant(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso) }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant() }
        .getOrNull()
}

/** Medium localized date + short time (web `formatDateTime`); the em dash when the stamp is unparseable. */
internal fun formatDateTime(
    iso: String?,
    zone: ZoneId,
    locale: Locale,
): String {
    val instant = parseInstant(iso) ?: return EM_DASH
    return instant.atZone(zone)
        .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
}

/** Short localized time only (the chart x-axis tick — web `tickFormatter` time part); em dash when unparseable. */
internal fun formatTimeLabel(
    iso: String?,
    zone: ZoneId,
    locale: Locale,
): String {
    val instant = parseInstant(iso) ?: return EM_DASH
    return instant.atZone(zone)
        .format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
}

private const val DEFAULT_LOCALE = "en-US"
private const val DEFAULT_PRECISION = 2
private const val COORD_DECIMALS = 6
private const val DEGREES_PER_OCTANT = 45.0
private const val TRAFFIC_WARN_SECONDS = 300.0
private const val TRAFFIC_CRITICAL_SECONDS = 900.0
internal const val EM_DASH = "\u2014"
