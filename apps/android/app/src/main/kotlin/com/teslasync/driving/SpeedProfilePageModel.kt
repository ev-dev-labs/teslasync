// Pure, framework-free model + projections for the SpeedProfilePage driving surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/driving/pages/SpeedProfilePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI
// [Drive] DTO, the raw analytics JSON, the shared SI converters and the framework-free ChartFormat helper), so the
// composable stays a thin render layer.
//
// The web page threads two reads — the backend `useSpeedProfile` aggregate (hero gauges + speed-bucket
// distribution) and the unbounded `useDrives` list (narrowed to the picked window, then folded into the per-bucket
// efficiency table and the speed-vs-efficiency scatter). This file ports that fold verbatim: parse the SI analytics
// payload, window the drives, compute each drive's Wh/km efficiency (energy-first, battery-estimate fallback),
// bucket them against the distribution's display-unit boundaries, and emit the scatter cloud — so the whole
// derivation is asserted off-device and the screen only resolves i18n + draws.
//
// SI boundary (unit-conversion instructions): the aggregation stays SI end to end (meters, m/s, Wh); the only
// display conversion lives in the explicit [SpeedProfileDisplayPrefs] helpers used at the render boundary
// (`convertSpeedFromSI` + the Wh/km→Wh/mi efficiency factor), exactly as the web page converts only inside its
// `toSpeedDisplay`/`toEfficiencyDisplay` callbacks (Phase-48 SI-canonical rule; ADR-013 keeps the cache itself SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.speedprofile

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.android.data.UnitPreferences
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SpeedProfilePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("speedProfile", "/speed-profile", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/speed-profile` deep link) without the nav module depending on it.
 */
object SpeedProfilePageRegistration {
    /** The navigation destination id (Destinations.kt `page("speedProfile", "/speed-profile", …)`). */
    const val ROUTE_ID: String = "speedProfile"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/speed-profile"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/drive id. */
    const val SLUG: String = "SpeedProfilePage"

    /**
     * Lower bound of the web `defaultPresetId: 'all'` window. With no `minDate` the web `resolveAllTimeStart`
     * falls back to `2015-01-01`, so the first frame requests the full history exactly as the web does.
     */
    const val ALL_TIME_START: String = "2015-01-01"

    /** Hero-gauge full-scale speeds in SI m/s (web gauge `max` literals: 55.56 ≈ 200 km/h, 69.44 ≈ 250 km/h). */
    const val AVG_GAUGE_MAX_MPS: Double = 55.56
    const val PEAK_GAUGE_MAX_MPS: Double = 69.44
    const val OPTIMAL_GAUGE_MAX_MPS: Double = 55.56
}

// ── Speed-profile analytics payload (web `SpeedProfileData`) ───────────────────────────────────────────────────

/**
 * One speed-distribution bucket from `GET /analytics/speed-profile` (`distribution[]`). [speedBucket] is the
 * mph-derived label literal the backend emits (`0-15`, `15-30`, …, `75+`), [readings] the drive count in the
 * bucket, [avgPowerW] the mean SI power. Mirrors the web `SpeedBucket` (snake-case wire shape; the camel-case
 * alias only exists after the web `camelCaseKeys` transform, which the native client does not apply).
 */
data class SpeedBucketDatum(
    val speedBucket: String,
    val readings: Int,
    val avgPowerW: Double,
)

/**
 * The decoded speed-profile aggregate — the native [SpeedProfileData] equivalent. Carried as a typed value parsed
 * from the raw SI [JsonElement] the shared repository returns (no generated DTO exists for this analytics shape),
 * reading the snake-case keys the handler emits (`avg_speed_mps`, `peak_speed_mps`, `optimal_speed_mps`,
 * `distribution[].speed_bucket/readings/avg_power_w`).
 */
data class SpeedProfileData(
    val distribution: List<SpeedBucketDatum>,
    val avgSpeedMps: Double,
    val peakSpeedMps: Double,
    val optimalSpeedMps: Double,
) {
    /**
     * Whether the aggregate has nothing to show — no distribution buckets and every hero aggregate zero. The page
     * renders its `speedProfile.noData` empty state for this case (the web `data ? … : <EmptyState/>` branch, plus
     * the no-vehicle / first-load gap the native feed parks on an empty success).
     */
    val isEmpty: Boolean
        get() = distribution.isEmpty() && avgSpeedMps == 0.0 && peakSpeedMps == 0.0 && optimalSpeedMps == 0.0

    /** Total readings across all buckets — the web `distribution.reduce((s, b) => s + b.readings, 0)` denominator. */
    val totalReadings: Int get() = distribution.sumOf { it.readings }

    companion object {
        /** The all-zero aggregate the feed parks on when no vehicle is selected (the web disabled-hook gap). */
        val EMPTY: SpeedProfileData = SpeedProfileData(emptyList(), 0.0, 0.0, 0.0)

        /** Parses the raw SI `/analytics/speed-profile` payload into the typed aggregate; tolerant of gaps. */
        fun parse(json: JsonElement?): SpeedProfileData {
            val obj = json as? JsonObject ?: return EMPTY
            val distribution =
                (obj["distribution"] as? JsonArray).orEmpty().mapNotNull { element ->
                    val row = element as? JsonObject ?: return@mapNotNull null
                    val bucket =
                        (row["speed_bucket"] as? JsonPrimitive)?.contentOrNull
                            ?: (row["speedBucket"] as? JsonPrimitive)?.contentOrNull
                            ?: return@mapNotNull null
                    SpeedBucketDatum(
                        speedBucket = bucket,
                        readings = (row["readings"] as? JsonPrimitive)?.intOrNull ?: 0,
                        avgPowerW = (row["avg_power_w"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
                    )
                }
            return SpeedProfileData(
                distribution = distribution,
                avgSpeedMps = obj.numberOrZero("avg_speed_mps"),
                peakSpeedMps = obj.numberOrZero("peak_speed_mps"),
                optimalSpeedMps = obj.numberOrZero("optimal_speed_mps"),
            )
        }

        private fun JsonObject.numberOrZero(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0
    }
}

// ── Per-drive efficiency (web `getEfficiency`) ─────────────────────────────────────────────────────────────────

/**
 * Wh/km for one drive, or `null` when it cannot be estimated — a verbatim port of the web `getEfficiency`:
 * energy-first (`energyUsedWh / km`) when a positive energy figure exists, else the battery-delta estimate
 * (`battUsed * 0.75 kWh-per-% * 1000 / km`), else `null`. Stays in SI (Wh, meters); the caller converts at the
 * display boundary.
 */
fun speedProfileEfficiency(drive: Drive): Double? {
    if (!(drive.distanceM > 0.0)) return null
    val km = drive.distanceM / 1000.0
    val energy = drive.energyUsedWh
    val batteryUsed = 1.0 * (drive.startBatteryPct ?: 0L) - 1.0 * (drive.endBatteryPct ?: 0L)
    return when {
        energy != null && energy > 0.0 -> energy / km
        batteryUsed > 0.0 -> (batteryUsed * BATTERY_KWH_PER_PCT * 1000.0) / km
        else -> null
    }
}

// ── Derived view slices (web useMemo chain) ───────────────────────────────────────────────────────────────────

/** One point of the speed-vs-efficiency scatter (web `scatterData`) in the user's display units, pre-rounding. */
data class SpeedScatterPoint(
    val speedDisplay: Double,
    val efficiencyDisplay: Double,
)

/** The mean efficiency + mean SI speed accumulated for a distribution bucket (web `bucketEfficiency` value). */
data class BucketEfficiency(
    val avgEff: Double,
    val avgSpeedMps: Double,
)

/** A single speed-bucket detail card (web GlassPanel3 grid cell): label, count, time-share %, optional efficiency. */
data class SpeedBucketCard(
    val range: String,
    val readings: Int,
    val timeSharePct: Double,
    val efficiency: BucketEfficiency?,
)

/** The folded page content the screen draws — the bucket cards + the scatter cloud (hero values read from data). */
data class SpeedProfileDerived(
    val buckets: List<SpeedBucketCard>,
    val scatter: List<SpeedScatterPoint>,
)

/**
 * Windows [allDrives] to the picked `[start, end]` (inclusive of the whole end day in [zone]) — the web `drives`
 * useMemo that narrows the unbounded `useDrives` list to match the backend-windowed distribution/scatter. Invalid
 * range bounds degrade to the full list rather than dropping every drive.
 */
fun drivesInRange(
    allDrives: List<Drive>,
    range: SpeedProfileRange,
    zone: ZoneId,
): List<Drive> {
    if (allDrives.isEmpty()) return allDrives
    val bounds =
        runCatching {
            val startMs = LocalDate.parse(range.start).atStartOfDay(zone).toInstant().toEpochMilli()
            val endMs =
                LocalDate.parse(range.end)
                    .atTime(END_OF_DAY_HOUR, END_OF_DAY_MINUTE, END_OF_DAY_SECOND, END_OF_DAY_NANOS)
                    .atZone(zone)
                    .toInstant()
                    .toEpochMilli()
            startMs to endMs
        }.getOrNull()
    return if (bounds == null) {
        allDrives
    } else {
        val (startMs, endMs) = bounds
        allDrives.filter { drive ->
            val instant = drive.startTs.toEpochMilliseconds()
            instant in startMs..endMs
        }
    }
}

/**
 * Builds the per-bucket mean-efficiency map (web `bucketEfficiency`): each windowed drive is matched to the
 * distribution bucket whose `[lo, hi)` numeric label range contains its DISPLAY speed (the labels are mph-derived,
 * compared against the converted value exactly as the web does), accumulating its SI speed + Wh/km efficiency.
 */
fun bucketEfficiencyMap(
    drives: List<Drive>,
    data: SpeedProfileData,
    prefs: SpeedProfileDisplayPrefs,
): Map<String, BucketEfficiency> {
    if (drives.isEmpty() || data.distribution.isEmpty()) return emptyMap()

    class Accumulator(var totalEff: Double = 0.0, var totalSpeedMps: Double = 0.0, var count: Int = 0)

    val ranges =
        data.distribution.mapNotNull { datum -> bucketBounds(datum.speedBucket)?.let { datum.speedBucket to it } }
    val accumulators = LinkedHashMap<String, Accumulator>()
    for (drive in drives) {
        val mps = drive.avgSpeedMps
        val efficiency = speedProfileEfficiency(drive)
        if (mps == null || efficiency == null) continue
        val speedDisplay = prefs.toSpeed(mps)
        val match = ranges.firstOrNull { (_, bounds) -> speedDisplay >= bounds.first && speedDisplay < bounds.second }
        if (match != null) {
            val acc = accumulators.getOrPut(match.first) { Accumulator() }
            acc.totalEff += efficiency
            acc.totalSpeedMps += mps
            acc.count++
        }
    }
    return accumulators.mapValues { (_, acc) ->
        BucketEfficiency(avgEff = acc.totalEff / acc.count, avgSpeedMps = acc.totalSpeedMps / acc.count)
    }
}

/**
 * Folds the analytics aggregate + the windowed drives into the screen slices (web `scatterData` + the bucket-card
 * map + the per-bucket time-share). Pure: the page hands it the parsed [data], the full [allDrives] list, the live
 * [prefs] and the picked [range]; it returns the cards + scatter the panels render.
 */
fun deriveSpeedProfile(
    data: SpeedProfileData,
    allDrives: List<Drive>,
    prefs: SpeedProfileDisplayPrefs,
    range: SpeedProfileRange,
    zone: ZoneId,
): SpeedProfileDerived {
    val drives = drivesInRange(allDrives, range, zone)

    val scatter =
        drives
            .filter { it.avgSpeedMps != null && it.avgSpeedMps != 0.0 && (speedProfileEfficiency(it) ?: 0.0) > 0.0 }
            .map { drive ->
                SpeedScatterPoint(
                    speedDisplay = prefs.toSpeed(drive.avgSpeedMps!!),
                    efficiencyDisplay = prefs.toEfficiency(speedProfileEfficiency(drive)!!),
                )
            }

    val efficiencyByBucket = bucketEfficiencyMap(drives, data, prefs)
    val totalReadings = data.totalReadings
    val buckets =
        data.distribution.map { bucket ->
            val pct = if (totalReadings > 0) bucket.readings * 1.0 / totalReadings * PERCENT else 0.0
            SpeedBucketCard(
                range = bucket.speedBucket,
                readings = bucket.readings,
                timeSharePct = pct,
                efficiency = efficiencyByBucket[bucket.speedBucket],
            )
        }

    return SpeedProfileDerived(buckets = buckets, scatter = scatter)
}

/**
 * The `[lo, hi)` numeric bounds of a bucket label (`"0-15"` → 0..15, `"75+"` → 75..[OPEN_UPPER]) — the web
 * `bucket.match(/(\d+)/g)` parse. `null` when the label carries no digits.
 */
private fun bucketBounds(label: String): Pair<Int, Int>? {
    val numbers = DIGIT_RUN.findAll(label).map { it.value.toInt() }.toList()
    if (numbers.isEmpty()) return null
    val lo = numbers[0]
    val hi = if (numbers.size > 1) numbers[1] else OPEN_UPPER
    return lo to hi
}

// ── Display preferences (web `useUnits`) ──────────────────────────────────────────────────────────────────────

/**
 * The display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the [distance]/[speed] units, the formatting [precision] (web `decimal_precision`, floored &
 * non-negative, else 2) and the [locale] used for number grouping. The SI→display conversions live here so the
 * page never converts inline.
 */
data class SpeedProfileDisplayPrefs(
    val distance: DistanceUnitPref,
    val speed: SpeedUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** Speed unit short label (web `unitPrefs.speed`: "mph" / "km/h"). */
    val speedLabel: String get() = speed.label

    /** Efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyLabel: String get() = if (distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI m/s → display speed (web `toSpeedDisplay` / `convertSpeedFromSI`). */
    fun toSpeed(mps: Double): Double = convertSpeedFromSI(mps, speed)

    /** Wh/km → display efficiency (web `whPerKm * 1.609344` for miles, else identity). */
    fun toEfficiency(whPerKm: Double): Double = if (distance == DistanceUnitPref.MI) whPerKm * MILES_FACTOR else whPerKm

    companion object {
        private const val DEFAULT_PRECISION = 2

        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        fun default(): SpeedProfileDisplayPrefs =
            SpeedProfileDisplayPrefs(
                distance = DistanceUnitPref.KM,
                speed = SpeedUnitPref.KMH,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): SpeedProfileDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return SpeedProfileDisplayPrefs(
                distance = unit.distance,
                speed = unit.speed,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: "en-US") }.getOrDefault(Locale.US),
            )
        }
    }
}

// ── Picked window (web `useRangeState`) ───────────────────────────────────────────────────────────────────────

/** The picked `[start, end]` window as inclusive ISO dates (web `useRangeState` value). */
data class SpeedProfileRange(
    val start: String,
    val end: String,
) {
    companion object {
        /** The web default-preset `'all'` window: `2015-01-01` … today in [zone]. */
        fun allTime(zone: ZoneId): SpeedProfileRange =
            SpeedProfileRange(SpeedProfilePageRegistration.ALL_TIME_START, LocalDate.now(zone).toString())

        /**
         * Resolves a `[start, end]` window from epoch-day picks (the Material date-range control), defaulting a
         * missing start to the all-time floor and a missing end to today, and ordering the pair so start ≤ end.
         */
        fun fromEpochDays(
            startEpochDay: Long?,
            endEpochDay: Long?,
            zone: ZoneId,
        ): SpeedProfileRange {
            val start = startEpochDay?.let { LocalDate.ofEpochDay(it) } ?: LocalDate.parse(SpeedProfilePageRegistration.ALL_TIME_START)
            val end = endEpochDay?.let { LocalDate.ofEpochDay(it) } ?: LocalDate.now(zone)
            val (lo, hi) = if (start.isAfter(end)) end to start else start to end
            return SpeedProfileRange(lo.toString(), hi.toString())
        }
    }
}

// ── Resource projection helper ────────────────────────────────────────────────────────────────────────────────

/**
 * Maps a cache-then-network [Resource] payload through [transform] while preserving its lifecycle tier (loading /
 * success / error) + freshness stamps — so the raw `/analytics/speed-profile` JSON feed can be decoded into the
 * typed [SpeedProfileData] before the view-model projects it onto [io.teslasync.android.data.UiState].
 */
fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SpeedProfilePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, drive id, speed, or efficiency figure.
 */
fun recordSpeedProfilePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SpeedProfilePageRegistration.SLUG))
}

private val DIGIT_RUN = Regex("\\d+")
private const val OPEN_UPPER = 999
private const val PERCENT = 100.0
private const val MILES_FACTOR = 1.609344
private const val BATTERY_KWH_PER_PCT = 0.75
private const val END_OF_DAY_HOUR = 23
private const val END_OF_DAY_MINUTE = 59
private const val END_OF_DAY_SECOND = 59
private const val END_OF_DAY_NANOS = 999_000_000
