// Pure, framework-free model + projections for the MapOverviewPage maps surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/maps/pages/MapOverviewPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the framework-free
// maps geometry types [GeoPoint]/[RouteSample], the shared-core SI converters, and the framework-free ChartFormat
// number helper), so the composable stays a thin render layer and all of this is exercised off-device by the
// :android:testDebugUnitTest gate.
//
// The web page reads three feeds: the enrolled-vehicle list (`useVehicles`, the declared parity source, backing the
// selector + the marker name), the active vehicle's recent positions (`useVehiclePositions` ▸
// GET /vehicles/{id}/positions — the latest sample powering the four metric cards + the marker, the 50-row trail
// powering the polyline, the playback samples, and the recent-history table), and the latest location snapshot
// (`useLocationSnapshotLatest` ▸ GET /location-snapshots/latest — the home/work/HomeLink badges). This file ports
// the JSON decode of the two raw-JSON feeds ([parsePositions]/[parseLocationSnapshot]) and the verbatim derivations
// the web page folds with `useMemo` (the valid-location guard, the trail, and the time-ordered playback samples).
//
// SI boundary (the prompt's Units rule + ADR-013): the decode keeps every value SI (metres, m/s); the only display
// conversion lives in the explicit [MapOverviewDisplayPrefs] helpers used at the render boundary (the shared
// `convertSpeedFromSI`/`convertDistanceFromSI` + ChartFormat), exactly as the web converts only inside its
// `convertSpeedFromSI(...)` render calls (Phase-48 SI-canonical rule; the cache itself stays SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.maps

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.RouteSample
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `MapOverviewPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("liveMap", "/live", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/live` deep link) without the nav module depending on it.
 */
object MapOverviewPageRegistration {
    /** The navigation destination id (Destinations.kt `page("liveMap", "/live", …)`). */
    const val ROUTE_ID: String = "liveMap"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/live"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id / coordinate. */
    const val SLUG: String = "MapOverviewPage"

    /** The web history query `limit` (`/positions?limit=50`); the first row is also the "latest" sample. */
    const val HISTORY_LIMIT: Int = 50
}

/* ------------------------------------------------------------------ */
/*  Raw-feed records (web PositionRecord / LocationSnapshot)          */
/* ------------------------------------------------------------------ */

/**
 * One `/vehicles/{id}/positions` row (web `PositionRecord`). Coordinates/speed/odometer are SI (degrees, m/s,
 * metres); conversion to the user's units happens only at the render boundary via [MapOverviewDisplayPrefs].
 */
data class PositionRecord(
    val id: Long,
    val latitude: Double,
    val longitude: Double,
    val speedMps: Double?,
    val powerW: Double?,
    val headingDeg: Double?,
    val elevationM: Double?,
    val odometerM: Double?,
    val batteryLevel: Double?,
    val createdAt: String,
) {
    /** Mirrors the web `hasValidLocation`: finite, in-range, and not the 0,0 null island. */
    val hasValidLocation: Boolean
        get() =
            latitude.isFinite() &&
                longitude.isFinite() &&
                latitude in GeoPoint.MIN_LAT..GeoPoint.MAX_LAT &&
                longitude in GeoPoint.MIN_LNG..GeoPoint.MAX_LNG &&
                (latitude != 0.0 || longitude != 0.0)

    /** The SI coordinate as the framework-free maps point (only meaningful when [hasValidLocation]). */
    fun point(): GeoPoint = GeoPoint(latitude, longitude)
}

/**
 * The latest `/location-snapshots/latest` row (web `LocationSnapshot`). The home/work flags are nullable tri-state
 * (yes / no / unknown), mirroring the web `=== true` / `=== false` / fallback badge logic.
 */
data class LocationSnapshot(
    val locatedAtHome: Boolean?,
    val locatedAtWork: Boolean?,
    val homelinkNearby: Boolean,
    val activeRoute: Boolean,
    val destinationName: String,
    val createdAt: String,
)

/* ------------------------------------------------------------------ */
/*  Derived bundle (web useMemo chain)                                */
/* ------------------------------------------------------------------ */

/**
 * The positions feed folded into the slices the panels read — the native analogue of the web page's
 * `latest` / `history` / `trailPositions` / `playbackPoints` memos.
 *
 * @property latest the most-recent sample (web `latest`, the first row of the most-recent-first feed).
 * @property history every returned row, newest first (web `history`, the recent-history table source).
 * @property trail the valid-coordinate polyline points (web `trailPositions`).
 * @property playback the time-ordered (ascending) samples for the route-replay widget (web `playbackPoints`).
 */
data class MapOverviewData(
    val latest: PositionRecord?,
    val history: List<PositionRecord>,
    val trail: List<GeoPoint>,
    val playback: List<RouteSample>,
) {
    /** True when the latest sample carries a real fix the map can centre on (web `hasValidLocation`). */
    val hasValidLocation: Boolean get() = latest?.hasValidLocation == true

    /** True when there is nothing to render from the positions feed (drives the map empty state). */
    val isEmpty: Boolean get() = latest == null && history.isEmpty()

    companion object {
        /** The resting "no positions yet" bundle. */
        val EMPTY: MapOverviewData =
            MapOverviewData(latest = null, history = emptyList(), trail = emptyList(), playback = emptyList())
    }
}

/**
 * Folds the decoded [positions] (newest-first, as the API returns them) into the [MapOverviewData] slices the
 * panels read — the verbatim port of the web `trailPositions` / `playbackPoints` memos. The latest sample is the
 * first row (the web `?limit=1` "latest" query returns the same most-recent row the `?limit=50` feed leads with),
 * the trail keeps every valid coordinate, and the playback samples are filtered to valid+timestamped rows and
 * sorted ascending so replay runs forward in time.
 */
fun buildMapOverviewData(positions: List<PositionRecord>): MapOverviewData {
    if (positions.isEmpty()) return MapOverviewData.EMPTY
    val trail = positions.filter { it.hasValidLocation }.map { it.point() }
    val playback =
        positions
            .filter { it.hasValidLocation && it.createdAt.isNotBlank() }
            .map { record ->
                RouteSample(
                    point = record.point(),
                    timestampMs = parseIsoMillis(record.createdAt),
                    speed = record.speedMps,
                    soc = record.batteryLevel,
                    power = record.powerW,
                )
            }.sortedBy { it.timestampMs }
    return MapOverviewData(
        latest = positions.first(),
        history = positions,
        trail = trail,
        playback = playback,
    )
}

/* ------------------------------------------------------------------ */
/*  JSON decode (web request<PositionRecord[]> / LocationSnapshot)   */
/* ------------------------------------------------------------------ */

/** Decodes the safeArray-guarded `/positions` payload into [PositionRecord]s, skipping any non-object rows. */
fun parsePositions(json: JsonElement?): List<PositionRecord> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        PositionRecord(
            id = obj.long("id") ?: 0L,
            latitude = obj.double("latitude") ?: 0.0,
            longitude = obj.double("longitude") ?: 0.0,
            speedMps = obj.double("speed"),
            powerW = obj.double("power"),
            headingDeg = obj.double("heading"),
            elevationM = obj.double("elevation"),
            odometerM = obj.double("odometer"),
            batteryLevel = obj.double("battery_level") ?: obj.double("batteryLevel"),
            createdAt = obj.string("created_at") ?: obj.string("createdAt") ?: "",
        )
    }
}

/** Decodes the `/location-snapshots/latest` object into a [LocationSnapshot], or null when the payload is empty. */
fun parseLocationSnapshot(json: JsonElement?): LocationSnapshot? {
    val obj = json as? JsonObject ?: return null
    if (obj.isEmpty()) return null
    return LocationSnapshot(
        locatedAtHome = obj.boolean("located_at_home") ?: obj.boolean("locatedAtHome"),
        locatedAtWork = obj.boolean("located_at_work") ?: obj.boolean("locatedAtWork"),
        homelinkNearby = obj.boolean("homelink_nearby") ?: obj.boolean("homelinkNearby") ?: false,
        activeRoute = obj.boolean("active_route") ?: obj.boolean("activeRoute") ?: false,
        destinationName = obj.string("destination_name") ?: obj.string("destinationName") ?: "",
        createdAt = obj.string("created_at") ?: obj.string("createdAt") ?: "",
    )
}

/* ------------------------------------------------------------------ */
/*  Display preferences (web useUnits) — the SI -> display boundary   */
/* ------------------------------------------------------------------ */

/**
 * The live display preferences the metric cards / table / odometer convert SI values through — the Kotlin port of
 * the web `useUnits` derivation, bound to the `/settings` document. Every conversion delegates to the shared SI
 * converters (P1/S5); this bag owns no unit math, never mutates the SI source, and formats with the user's locale.
 */
data class MapOverviewDisplayPrefs(
    val speedUnit: SpeedUnitPref,
    val distanceUnit: DistanceUnitPref,
    val locale: Locale,
) {
    /** Speed unit token (`mph` / `km/h`) for the `speedUnitValue` string (web `{{unit}}`). */
    val speedUnitLabel: String get() = speedUnit.label

    /** Distance unit token (`mi` / `km`) for the `distanceUnitValue` string (web `{{unit}}`). */
    val distanceUnitLabel: String get() = distanceUnit.label

    /** SI m/s ▸ display number, 1 decimal (web `fmtNumber(convertSpeedFromSI(speed ?? 0, unit), 1)`). */
    fun speedNumber(metersPerSecond: Double?): String =
        ChartFormat.number(convertSpeedFromSI(metersPerSecond ?: 0.0, speedUnit), SPEED_DECIMALS, locale)

    /** SI metres ▸ display number, 1 decimal (web odometer `fmtNumber(convertDistanceFromSI(...), 1)`). */
    fun distanceNumber(meters: Double): String =
        ChartFormat.number(convertDistanceFromSI(meters, distanceUnit), DISTANCE_DECIMALS, locale)

    companion object {
        private const val SPEED_DECIMALS = 1
        private const val DISTANCE_DECIMALS = 1
        private const val UNIT_OF_LENGTH = "unit_of_length"
        private const val LOCALE_KEY = "locale"
        private const val MILES = "mi"
        private const val DEFAULT_LOCALE = "en-US"

        /** Derives the prefs from the raw `/settings` document, falling back to metric + en-US before it loads. */
        fun fromSettings(settings: JsonElement?): MapOverviewDisplayPrefs {
            val obj = settings as? JsonObject
            val miles = (obj?.get(UNIT_OF_LENGTH) as? JsonPrimitive)?.contentOrNull == MILES
            val localeTag =
                (obj?.get(LOCALE_KEY) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE
            return MapOverviewDisplayPrefs(
                speedUnit = if (miles) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
                distanceUnit = if (miles) DistanceUnitPref.MI else DistanceUnitPref.KM,
                locale = Locale.forLanguageTag(localeTag),
            )
        }

        /** The metric / en-US default used for previews + the cold-start frame before settings load. */
        fun default(): MapOverviewDisplayPrefs =
            MapOverviewDisplayPrefs(SpeedUnitPref.KMH, DistanceUnitPref.KM, Locale.forLanguageTag(DEFAULT_LOCALE))
    }
}

/* ------------------------------------------------------------------ */
/*  Render-boundary formatters (web fmtNumber / formatDateTime)       */
/* ------------------------------------------------------------------ */

/** Em dash shown for an absent value (web `'—'`). */
const val MAP_OVERVIEW_EM_DASH: String = "\u2014"

/** Heading degrees ▸ `"123°"`, or the em dash when null (web `heading != null ? \`${…}°\` : '—'`). */
fun headingText(
    headingDeg: Double?,
    locale: Locale,
): String = if (headingDeg != null) "${ChartFormat.number(headingDeg, 0, locale)}\u00B0" else MAP_OVERVIEW_EM_DASH

/** `"lat, lon"` to 4 decimals when the fix is valid, else the em dash (web `latLon` metric card). */
fun latLonText(
    record: PositionRecord?,
    locale: Locale,
): String {
    if (record == null || !record.hasValidLocation) return MAP_OVERVIEW_EM_DASH
    val lat = ChartFormat.number(record.latitude, 4, locale)
    val lon = ChartFormat.number(record.longitude, 4, locale)
    return "$lat, $lon"
}

/** A single lat / lon table cell to 5 decimals, or the em dash for the 0,0 null island (web history columns). */
fun coordCell(
    record: PositionRecord,
    longitude: Boolean,
    locale: Locale,
): String {
    if (!record.hasValidLocation) return MAP_OVERVIEW_EM_DASH
    val value = if (longitude) record.longitude else record.latitude
    return ChartFormat.number(value, 5, locale)
}

/** The localized "Last Updated" date-time (web `formatDateTime(latest.created_at)`). */
fun lastUpdatedText(
    createdAt: String,
    locale: Locale,
    zone: ZoneId = ZoneId.systemDefault(),
): String = formatIso(createdAt, FormatStyle.MEDIUM, locale, zone)

/** The compact history-table "Time" cell (web `<TimeStamp value={created_at} />`). */
fun timeCell(
    createdAt: String,
    locale: Locale,
    zone: ZoneId = ZoneId.systemDefault(),
): String = formatIso(createdAt, FormatStyle.SHORT, locale, zone)

/* ------------------------------------------------------------------ */
/*  Diagnostics (P1/S11)                                              */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug. Carries no vehicle id, coordinate, or
 * odometer figure — only the static [MapOverviewPageRegistration.SLUG].
 */
fun recordMapOverviewPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MapOverviewPageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  Internals                                                         */
/* ------------------------------------------------------------------ */

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.long(key: String): Long? =
    (this[key] as? JsonPrimitive)?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }

private fun JsonObject.boolean(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Parses an ISO-8601 instant to epoch millis, or 0 when unparseable (keeps replay ordering deterministic). */
private fun parseIsoMillis(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

/**
 * Maps a cache-then-network [Resource]'s payload through [transform] while preserving its freshness envelope
 * (cached / fetchedAt / stale / error). The page-local analogue of the shared-store `mapData` — it lets the
 * view-model decode raw JSON into the typed model once, before the lifecycle-aware `asUiState` projection.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun formatIso(
    iso: String,
    style: FormatStyle,
    locale: Locale,
    zone: ZoneId,
): String =
    runCatching {
        DateTimeFormatter
            .ofLocalizedDateTime(style)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.parse(iso))
    }.getOrDefault(iso.ifBlank { MAP_OVERVIEW_EM_DASH })
