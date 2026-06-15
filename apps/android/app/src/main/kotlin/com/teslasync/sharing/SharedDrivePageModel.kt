// Pure, framework-free model + projections for the SharedDrivePage sharing surface (P3/A7) — the native analogue
// of everything web/src/features/sharing/pages/SharedDrivePage.tsx derives before composing its report. No Compose,
// no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared SI converters +
// formatters, the framework-free maps GeoPoint, the kotlinx-serialization JSON model, and the diagnostics Logger),
// so the composable stays a thin render layer and all of this is exercised off-device by the
// :android:testDebugUnitTest gate.
//
// The web page reads one public backend source — `GET /share/{token}` (web `useSharedDrive`) — then runs it through
// `normalizeSharedDriveData`, which upgrades the legacy v1 payload (km / min / km/h / Wh-per-km) to the SI v2 shape
// (m / s / m/s / Wh-per-m) and passes a v2 payload through untouched. This file ports that decode
// ([parseSharedDrive] + [normalizeV1]/[readV2]) into the SI domain model, plus the verbatim display helpers the page
// applies at the render boundary ([SharedDriveDisplayPrefs]: distance/speed via the shared formatters, the inline
// foot + Wh/mi conversions the web keeps because no SI helper exists for elevation-as-feet or energy-per-distance)
// and the web `formatDurationSecondsAsMinutes` minute formatter.
//
// SI boundary (unit-conversion.instructions): the model stays SI end to end (meters, m/s, Wh/m); the only display
// conversion lives in the explicit [SharedDriveDisplayPrefs] helpers used at the render boundary (Phase-48
// SI-canonical rule; ADR-013 keeps any cache SI), so the SI source is never stored converted.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.sharing.shareddrive

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatSpeed
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SharedDrivePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `standalone("sharedDrive", "/s/:token", NavGroup.Sharing, listOf("token"), AuthRequirement.Public)`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/s/{token}` deep
 * link) without the nav module depending on it.
 */
object SharedDrivePageRegistration {
    /** The navigation destination id (Destinations.kt `standalone("sharedDrive", "/s/:token", …)`). */
    const val ROUTE_ID: String = "sharedDrive"

    /** The route argument carrying the public share token (web `useParams().token`). */
    const val ARG_TOKEN: String = "token"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/s/:token"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no token / drive payload. */
    const val SLUG: String = "SharedDrivePage"
}

/* ------------------------------------------------------------------ */
/*  Boundary constants (mirror the web SharedDrivePage module)        */
/* ------------------------------------------------------------------ */

/** 1 km = 1000 m exactly (web `METERS_PER_KM`). */
private const val METERS_PER_KM = 1000.0

/** 1 m/s = 3.6 km/h exactly (web `KMH_PER_MPS`). */
private const val KMH_PER_MPS = 3.6

/** 1 mile = 1.609344 km exactly (web `KM_PER_MILE`) — the Wh/km → Wh/mi factor; no SI energy-per-distance helper. */
private const val KM_PER_MILE = 1.609344

/** 1 ft = 0.3048 m exactly (web `METERS_PER_FOOT`) — elevation has no `convertElevationFromSI` helper. */
private const val METERS_PER_FOOT = 0.3048

/** Seconds in an hour / minute, for the [formatDurationSecondsAsMinutes] port. */
private const val SECONDS_PER_HOUR = 3600L
private const val SECONDS_PER_MINUTE = 60.0

/** Em dash shown for a missing data value (web `?? '—'`). */
const val SHARED_DRIVE_EM_DASH: String = "\u2014"

/* ------------------------------------------------------------------ */
/*  SI domain model (the normalized web SharedDriveData v2 shape)     */
/* ------------------------------------------------------------------ */

/** The decoded, SI-canonical shared-drive report (web normalized `SharedDriveData`). */
data class SharedDrive(
    val title: String,
    val description: String?,
    val drive: SharedDriveInfo,
    val vehicle: SharedVehicle?,
    val mapPoints: List<GeoPoint>,
    val elevationProfile: List<SharedElevationPoint>,
    val speedProfile: List<SharedSpeedPoint>,
)

/** The summary metrics for a shared drive — all SI (web `SharedDriveInfo`). */
data class SharedDriveInfo(
    val date: String,
    val distanceM: Double,
    val durationS: Double,
    val startAddress: String?,
    val endAddress: String?,
    val startBattery: Int?,
    val endBattery: Int?,
    val elevationGainM: Double?,
    val maxSpeedMps: Double?,
    val avgSpeedMps: Double?,
    val efficiencyWhPerM: Double?,
)

/** The badge vehicle (web `SharedVehicle`). */
data class SharedVehicle(
    val model: String,
    val color: String,
)

/** One elevation-profile sample — SI metres at an SI distance (web `SharedElevationPoint`). */
data class SharedElevationPoint(
    val distanceM: Double,
    val elevationM: Double,
)

/** One speed-profile sample — SI m/s at an SI distance (web `SharedSpeedPoint`). */
data class SharedSpeedPoint(
    val distanceM: Double,
    val speedMps: Double,
)

/* ------------------------------------------------------------------ */
/*  Display preferences (web useUnits + the page's inline helpers)    */
/* ------------------------------------------------------------------ */

/**
 * The display-boundary helpers the page applies to the SI model — the Kotlin port of the web page's `useUnits`
 * derivation plus its inline `elevationLabel` / `efficiencyUnit` / `convertElevation` / `toEfficiencyDisplay`
 * helpers. Distance + speed go through the shared SI formatters; elevation (metres → feet) and efficiency
 * (Wh/km → Wh/mi) use the inline factors the web keeps because the shared units module ships no helper for them.
 */
data class SharedDriveDisplayPrefs(
    val units: UnitPref,
) {
    private val distancePref: DistanceUnitPref get() = units.distance
    private val imperial: Boolean get() = distancePref == DistanceUnitPref.MI

    /** The elevation unit label (web `elevationLabel`): feet for imperial, else metres. */
    val elevationLabel: String get() = if (imperial) "ft" else "m"

    /** The efficiency unit label (web `efficiencyUnit`): Wh/mi for imperial, else Wh/km. */
    val efficiencyLabel: String get() = if (imperial) "Wh/mi" else "Wh/km"

    /** The distance unit label, for chart axes/tooltips (web `distancePref`). */
    val distanceLabel: String get() = distancePref.label

    /** The speed unit label, for chart tooltips (web `speedPref`). */
    val speedLabel: String get() = units.speed.label

    /** Formats SI metres as the preferred distance string (web `formatDistance`). */
    fun distance(
        meters: Double?,
        precision: Int? = null,
    ): String = formatDistance(meters, units, precision)

    /** Formats SI m/s as the preferred speed string (web `formatSpeed`). */
    fun speed(
        mps: Double?,
        precision: Int? = null,
    ): String = formatSpeed(mps, units, precision)

    /** SI metres → display elevation (web `convertElevation`): feet for imperial, else metres. */
    fun elevation(meters: Double): Double = if (imperial) meters / METERS_PER_FOOT else meters

    /** The rounded elevation value + unit (web `${Math.round(convertElevation(v))} ${elevPref}`). */
    fun elevationDisplay(meters: Double): String = "${elevation(meters).roundToInt()} $elevationLabel"

    /**
     * The rounded efficiency value + unit (web `${Math.round(toEfficiencyDisplay(eff * METERS_PER_KM))} ${effPref}`).
     * Input is SI Wh-per-metre; it is lifted to Wh/km then, for imperial, to Wh/mi.
     */
    fun efficiencyDisplay(whPerMeter: Double): String {
        val whPerKm = whPerMeter * METERS_PER_KM
        val display = if (imperial) whPerKm * KM_PER_MILE else whPerKm
        return "${display.roundToInt()} $efficiencyLabel"
    }

    /** SI metres → display distance number for a chart axis (web `convertDistanceFromSI`). */
    fun chartDistance(meters: Double): Double = convertDistanceFromSI(meters, distancePref)

    /** SI m/s → display speed number for a chart axis (web `convertSpeedFromSI`). */
    fun chartSpeed(mps: Double): Double = convertSpeedFromSI(mps, units.speed)

    /** A chart x-axis label for an SI distance: rounded value + the distance unit (web XAxis tickFormatter). */
    fun chartDistanceLabel(meters: Double): String = "${chartDistance(meters).roundToInt()} $distanceLabel"

    companion object {
        /** The metric default, for previews / cold start before the settings document loads. */
        val DEFAULT: SharedDriveDisplayPrefs = SharedDriveDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): SharedDriveDisplayPrefs =
            SharedDriveDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/**
 * The web `formatDurationSecondsAsMinutes` (web/src/lib/dateFormat.ts) — a minute-resolution duration string from
 * SI seconds: a sub-hour duration renders as `"45m"`; an hour-or-more as `"2h 05m"`, dropping the minutes when
 * they round to zero (`"2h"`). Negative or non-finite input renders the em-dash fallback.
 */
fun formatDurationSecondsAsMinutes(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0.0) return SHARED_DRIVE_EM_DASH
    val whole = seconds.roundToLong()
    val hours = whole / SECONDS_PER_HOUR
    val minutes = (whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    if (hours == 0L) return "${minutes.roundToInt()}m"
    return if (minutes >= 0.5) "${hours}h ${minutes.roundToInt()}m" else "${hours}h"
}

/* ------------------------------------------------------------------ */
/*  JSON decode (web normalizeSharedDriveData)                        */
/* ------------------------------------------------------------------ */

/**
 * Decodes + normalizes the `GET /share/{token}` payload into the SI [SharedDrive] model (web
 * `normalizeSharedDriveData`): a `payload_version == "v2"` document is read as SI directly ([readV2]); anything
 * else is treated as the legacy v1 shape and upgraded to SI ([normalizeV1]). Returns `null` only when the payload
 * is absent or not a JSON object (web `if (!data) return undefined`), which the view renders as the unavailable
 * surface.
 */
fun parseSharedDrive(payload: JsonElement?): SharedDrive? {
    val root = payload as? JsonObject ?: return null
    return if (root.string("payload_version") == "v2") readV2(root) else normalizeV1(root)
}

/** Reads an already-SI v2 document straight into the model (web returns the v2 payload unchanged). */
private fun readV2(root: JsonObject): SharedDrive {
    val drive = root.obj("drive") ?: EMPTY_OBJECT
    return SharedDrive(
        title = root.string("title").orEmpty(),
        description = root.string("description"),
        drive =
            SharedDriveInfo(
                date = drive.string("date").orEmpty(),
                distanceM = drive.double("distance_m") ?: 0.0,
                durationS = drive.double("duration_s") ?: 0.0,
                startAddress = drive.string("start_address"),
                endAddress = drive.string("end_address"),
                startBattery = drive.int("start_battery"),
                endBattery = drive.int("end_battery"),
                elevationGainM = drive.double("elevation_gain"),
                maxSpeedMps = drive.double("max_speed_mps"),
                avgSpeedMps = drive.double("avg_speed_mps"),
                efficiencyWhPerM = drive.double("efficiency_wh_per_m"),
            ),
        vehicle = readVehicle(root.obj("vehicle")),
        mapPoints = readMapPoints(root.array("map_points")),
        elevationProfile =
            root.array("elevation_profile").objects().map { point ->
                SharedElevationPoint(point.double("distance_m") ?: 0.0, point.double("elevation_m") ?: 0.0)
            },
        speedProfile =
            root.array("speed_profile").objects().map { point ->
                SharedSpeedPoint(point.double("distance_m") ?: 0.0, point.double("speed_mps") ?: 0.0)
            },
    )
}

/** Upgrades a legacy v1 document (km / min / km/h / Wh-per-km) to the SI model (web v1 branch). */
private fun normalizeV1(root: JsonObject): SharedDrive {
    val drive = root.obj("drive") ?: EMPTY_OBJECT
    return SharedDrive(
        title = root.string("title").orEmpty(),
        description = root.string("description"),
        drive =
            SharedDriveInfo(
                date = drive.string("date").orEmpty(),
                distanceM = (drive.double("distance_km") ?: 0.0) * METERS_PER_KM,
                durationS = roundSeconds((drive.double("duration_min") ?: 0.0) * SECONDS_PER_MINUTE),
                startAddress = drive.string("start_address"),
                endAddress = drive.string("end_address"),
                startBattery = drive.int("start_battery"),
                endBattery = drive.int("end_battery"),
                elevationGainM = drive.double("elevation_gain"),
                maxSpeedMps = drive.double("max_speed_kmh")?.let { it / KMH_PER_MPS },
                avgSpeedMps = drive.double("avg_speed_kmh")?.let { it / KMH_PER_MPS },
                efficiencyWhPerM = drive.double("efficiency_wh_km")?.let { it / METERS_PER_KM },
            ),
        vehicle = readVehicle(root.obj("vehicle")),
        mapPoints = readMapPoints(root.array("map_points")),
        elevationProfile =
            root.array("elevation_profile").objects().map { point ->
                SharedElevationPoint(
                    (point.double("distance_km") ?: 0.0) * METERS_PER_KM,
                    point.double("elevation_m") ?: 0.0,
                )
            },
        speedProfile =
            root.array("speed_profile").objects().map { point ->
                SharedSpeedPoint(
                    (point.double("distance_km") ?: 0.0) * METERS_PER_KM,
                    (point.double("speed_kmh") ?: 0.0) / KMH_PER_MPS,
                )
            },
    )
}

private fun readVehicle(obj: JsonObject?): SharedVehicle? {
    if (obj == null) return null
    return SharedVehicle(model = obj.string("model").orEmpty(), color = obj.string("color").orEmpty())
}

private fun readMapPoints(array: JsonArray?): List<GeoPoint> =
    array.objects().mapNotNull { point ->
        val lat = point.double("lat")
        val lng = point.double("lng")
        if (lat == null || lng == null) null else GeoPoint(lat, lng)
    }

/* ------------------------------------------------------------------ */
/*  Resource mapping + diagnostics                                    */
/* ------------------------------------------------------------------ */

/** Projects a decode over a cache-then-network [Resource] (the sibling A7 page-model helper). */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SharedDrivePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no token, location, or drive payload.
 */
fun recordSharedDrivePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SharedDrivePageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  JSON helpers                                                      */
/* ------------------------------------------------------------------ */

private val EMPTY_OBJECT = JsonObject(emptyMap())

/** Rounds an SI-second value half-up to a whole second (web `Math.round`), carried as a double. */
private fun roundSeconds(seconds: Double): Double = seconds.roundToLong() * 1.0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray

private fun JsonArray?.objects(): List<JsonObject> = this?.mapNotNull { it as? JsonObject } ?: emptyList()
