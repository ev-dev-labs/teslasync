// Pure, framework-free model + projections for the TemperatureImpactPage maps surface (P3/A7) — the native
// analogue of everything web/src/features/maps/pages/TemperatureImpactPage.tsx derives before composing its panels.
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared SI
// converters + the framework-free ChartFormat number helper + the kotlinx-serialization JSON model), so the
// composable stays a thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page reads one backend source — `GET /analytics/temperature-impact?vehicle_id={id}` whose `points[]`
// carry `outside_temp` (°C SI), `efficiency_wh_km` (Wh/km) and `distance_km` (km) — then folds it into the four
// summary metric cards, the temperature-vs-efficiency scatter, the per-bucket efficiency line, the optimal-range
// analysis, and the contextual tips. This file ports the JSON decode ([parseTemperatureImpact]) and the verbatim
// `useMemo` derivations ([deriveTemperatureStats] / [scatterPoints] / [temperatureTips]) plus the pure scatter
// geometry ([computeScatterLayout]) the Canvas renders from.
//
// SI boundary (unit-conversion.instructions): the aggregation stays SI end to end (°C, Wh/km); the only display
// conversion lives in the explicit [TemperatureDisplayPrefs] helpers used at the render boundary
// (`convertTempFromSI` for temperature, the inline `KM_PER_MILE` factor for Wh/km → Wh/mi — there is no
// `convertEfficiencyFromSI` helper, exactly as the web page notes), so the SI source is never stored converted
// (Phase-48 SI-canonical rule; ADR-013 keeps the cache SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.maps.temperatureimpact

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TemperatureImpactPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("temperatureImpact", "/temperature-impact", NavGroup.Maps)`, so [io.teslasync.android.navigation.PageHosts]
 * binds this surface to that destination (and its `/temperature-impact` deep link) without the nav module depending
 * on it.
 */
object TemperatureImpactPageRegistration {
    /** The navigation destination id (Destinations.kt `page("temperatureImpact", "/temperature-impact", …)`). */
    const val ROUTE_ID: String = "temperatureImpact"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/temperature-impact"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "TemperatureImpactPage"
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/**
 * Wh/km → Wh/mi conversion factor (1 mile = 1.609344 km). There is no `convertEfficiencyFromSI` helper in the
 * shared units module, so — exactly as the web page keeps an inline `KM_PER_MILE` factor — we keep it here and apply
 * it only at the display boundary in [TemperatureDisplayPrefs.toDisplayEff].
 */
private const val KM_PER_MILE = 1.609344

/** The five SI (°C) temperature buckets the web page colours drives by (`TEMP_BUCKETS_C`). */
val TEMP_BUCKETS_C: List<TemperatureBucket> =
    listOf(
        TemperatureBucket(minC = -50.0, maxC = 0.0),
        TemperatureBucket(minC = 0.0, maxC = 10.0),
        TemperatureBucket(minC = 10.0, maxC = 20.0),
        TemperatureBucket(minC = 20.0, maxC = 30.0),
        TemperatureBucket(minC = 30.0, maxC = 60.0),
    )

/** One SI temperature bucket — a half-open `[minC, maxC)` interval (web `TEMP_BUCKETS_C` row). */
data class TemperatureBucket(
    val minC: Double,
    val maxC: Double,
)

/**
 * The bucket index an SI [tempC] falls into (web `getTempBucketIndex`): the first half-open `[min, max)` interval
 * that contains it, defaulting to index 2 (the 10–20 °C mild bucket) when nothing matches — verbatim with the web
 * `idx >= 0 ? idx : 2` guard.
 */
fun tempBucketIndex(tempC: Double): Int {
    val idx = TEMP_BUCKETS_C.indexOfFirst { tempC >= it.minC && tempC < it.maxC }
    return if (idx >= 0) idx else 2
}

/* ------------------------------------------------------------------ */
/*  Backend points (GET /analytics/temperature-impact)                */
/* ------------------------------------------------------------------ */

/**
 * One decoded `points[]` row from `/analytics/temperature-impact` — the native analogue of the web
 * `TempEfficiencyPoint`. Every figure is raw SI on the wire ([outsideTemp] °C, [efficiencyWhKm] Wh/km,
 * [distanceKm] km); display conversion happens only at the render boundary via [TemperatureDisplayPrefs].
 */
data class TempEfficiencyPoint(
    val outsideTemp: Double,
    val efficiencyWhKm: Double,
    val distanceKm: Double,
    val driveDate: String,
)

/**
 * Decodes the raw `/analytics/temperature-impact` [json] into its `points[]` list (web `res.points ?? []`). A
 * non-object input, a missing/empty object (the synthetic no-vehicle payload), or a missing/non-array `points`
 * field all yield an empty list, so the surface routes to its friendly empty state rather than a grid of zeros.
 */
fun parseTemperatureImpact(json: JsonElement?): List<TempEfficiencyPoint> {
    val obj = json as? JsonObject ?: return emptyList()
    val points = obj["points"] as? JsonArray ?: return emptyList()
    return points.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        TempEfficiencyPoint(
            outsideTemp = row.double("outside_temp"),
            efficiencyWhKm = row.double("efficiency_wh_km"),
            distanceKm = row.double("distance_km"),
            driveDate = row.string("drive_date"),
        )
    }
}

/* ------------------------------------------------------------------ */
/*  Display preferences (useUnits)                                    */
/* ------------------------------------------------------------------ */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the
 * `/settings` document: the temperature unit (axis + bucket labels) and the distance unit (which selects the
 * Wh/km vs Wh/mi efficiency label + factor), plus the locale + precision used by the grouped-number formatter. The
 * backend stores and serves SI; this is the single place a preference becomes a display unit so the SI source is
 * never stored converted (Phase-48; ADR-013 keeps the cache SI).
 */
data class TemperatureDisplayPrefs(
    val unitPref: UnitPref,
) {
    /** The user's locale for grouped-number formatting (web `_globalLocale`, en-US fallback). */
    val locale: Locale =
        runCatching { Locale.forLanguageTag(unitPref.locale ?: DEFAULT_LOCALE) }.getOrDefault(Locale.US)

    /** The user's default fraction digits (web `_globalPrecision`, floored & non-negative, else 2). */
    val precision: Int = unitPref.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION

    /** The temperature unit preference (web `unitPrefs.temperature`). */
    val temperatureUnit: TemperatureUnitPref get() = unitPref.temperature

    /** The temperature unit's display label, e.g. "°C" / "°F" (web `tempUnit`). */
    val temperatureLabel: String get() = unitPref.temperature.label

    /** Whether the user reads distance in miles (web `unitPrefs.distance === 'mi'`), selecting the Wh/mi label. */
    val isMiles: Boolean get() = unitPref.distance == DistanceUnitPref.MI

    /** The efficiency unit label — "Wh/mi" when the user prefers miles, else "Wh/km" (web `effLabel`). */
    val efficiencyLabel: String get() = if (isMiles) EFF_LABEL_MI else EFF_LABEL_KM

    /** SI °C → the user's display temperature (web `toTemperatureDisplay` / `convertTempFromSI`). */
    fun toTemperatureDisplay(celsius: Double): Double = convertTempFromSI(celsius, unitPref.temperature)

    /** Wh/km → the user's display efficiency: Wh/mi when the user prefers miles, else unchanged (web `toDispEff`). */
    fun toDisplayEff(whKm: Double): Double = if (isMiles) whKm * KM_PER_MILE else whKm

    /** Grouped number in the user's locale (web `fmtNumber(value)`); defaults to the user's precision. */
    fun number(
        value: Double,
        decimals: Int = precision,
    ): String = ChartFormat.number(value, decimals, locale)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: TemperatureDisplayPrefs = TemperatureDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): TemperatureDisplayPrefs =
            TemperatureDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/**
 * The display label for the bucket at [index] (web `bucketLabel`): `< {max}{unit}` for the first (coldest) bucket,
 * `> {min}{unit}` for the last (hottest), and `{min}–{max}{unit}` for the inner buckets. Bounds are rounded after
 * conversion to the user's temperature unit via [prefs], exactly as the web rounds `toTemperatureDisplay`.
 */
fun bucketLabel(
    index: Int,
    prefs: TemperatureDisplayPrefs,
): String {
    val bucket = TEMP_BUCKETS_C[index]
    val unit = prefs.temperatureLabel
    val min = prefs.toTemperatureDisplay(bucket.minC).roundToInt()
    val max = prefs.toTemperatureDisplay(bucket.maxC).roundToInt()
    return when (index) {
        0 -> "< $max$unit"
        TEMP_BUCKETS_C.lastIndex -> "> $min$unit"
        else -> "$min\u2013$max$unit"
    }
}

/* ------------------------------------------------------------------ */
/*  Derived stats (web stats useMemo)                                 */
/* ------------------------------------------------------------------ */

/** One row in the per-bucket efficiency line + the optimal-analysis badges — the web `bucketAvgs[]` row. */
data class BucketAvg(
    val label: String,
    /** The bucket's average efficiency in the user's display unit (Wh/km or Wh/mi). */
    val avg: Double,
    /** The number of drives that fell into this bucket (web `count`); 0 buckets render a zero point. */
    val count: Int,
    /** The SI bucket ordinal (0=coldest … 4=hottest) used to resolve the bucket colour at the render boundary. */
    val bucketIndex: Int,
)

/**
 * The summary statistics the four metric cards, the per-bucket line, and the optimal-analysis panel read — the
 * native analogue of the web `stats` memo. [best]/[worst] are the lowest/highest-average buckets among those that
 * actually have drives (web `withData`), or null when no bucket has data.
 */
data class TemperatureStats(
    val avgEff: Double,
    val bucketAvgs: List<BucketAvg>,
    val best: BucketAvg?,
    val worst: BucketAvg?,
    val total: Int,
)

/**
 * Folds the decoded [points] into the page's summary stats (web `stats` useMemo): the overall average efficiency,
 * the per-bucket averages (all five buckets, zero-count buckets included so the line still draws a point), and the
 * best/worst buckets among those with data. Returns null for an empty input (the web `!points?.length` guard) so
 * the surface shows its empty state. All display conversion happens here via [prefs] — the SI source is untouched.
 */
fun deriveTemperatureStats(
    points: List<TempEfficiencyPoint>,
    prefs: TemperatureDisplayPrefs,
): TemperatureStats? {
    if (points.isEmpty()) return null

    val avgEffSi = points.sumOf { it.efficiencyWhKm } / points.size

    val bucketValues = HashMap<Int, MutableList<Double>>()
    for (point in points) {
        val idx = tempBucketIndex(point.outsideTemp)
        bucketValues.getOrPut(idx) { mutableListOf() }.add(point.efficiencyWhKm)
    }

    val bucketAvgs =
        TEMP_BUCKETS_C.indices.map { idx ->
            val values = bucketValues[idx] ?: emptyList()
            val avgSi = if (values.isEmpty()) 0.0 else values.sum() / values.size
            BucketAvg(
                label = bucketLabel(idx, prefs),
                avg = prefs.toDisplayEff(avgSi),
                count = values.size,
                bucketIndex = idx,
            )
        }

    val withData = bucketAvgs.filter { it.count > 0 }
    return TemperatureStats(
        avgEff = prefs.toDisplayEff(avgEffSi),
        bucketAvgs = bucketAvgs,
        best = withData.minByOrNull { it.avg },
        worst = withData.maxByOrNull { it.avg },
        total = points.size,
    )
}

/* ------------------------------------------------------------------ */
/*  Scatter projection + geometry (web scatterData + ReferenceLine)   */
/* ------------------------------------------------------------------ */

/** One plotted drive in the temperature-vs-efficiency scatter — the web `scatterData[]` row (display units). */
data class ScatterPoint(
    val tempDisplay: Double,
    val effDisplay: Double,
    val bucketIndex: Int,
)

/**
 * Projects the decoded [points] into the scatter's display-unit rows (web `scatterData` useMemo): each drive's
 * temperature + efficiency converted to the user's units via [prefs], coloured by the bucket of its *original* SI
 * temperature (web `TEMP_BUCKETS_C[getTempBucketIndex(p.outside_temp)].color`).
 */
fun scatterPoints(
    points: List<TempEfficiencyPoint>,
    prefs: TemperatureDisplayPrefs,
): List<ScatterPoint> =
    points.map { point ->
        ScatterPoint(
            tempDisplay = prefs.toTemperatureDisplay(point.outsideTemp),
            effDisplay = prefs.toDisplayEff(point.efficiencyWhKm),
            bucketIndex = tempBucketIndex(point.outsideTemp),
        )
    }

/** One positioned scatter dot — fractions in `[0,1]` of the plot box ([yFraction] 0 = bottom, 1 = top). */
data class ScatterDot(
    val xFraction: Float,
    val yFraction: Float,
    val bucketIndex: Int,
)

/**
 * The pure layout the scatter Canvas renders: every dot as a `[0,1]×[0,1]` fraction of the plot box plus the
 * average-efficiency reference line's y-fraction (web `<ReferenceLine y={avgEff} />`). [hasData] is false for an
 * empty input so the chart shows its empty state rather than an unscaled blank plot.
 */
data class ScatterLayout(
    val dots: List<ScatterDot>,
    val avgFraction: Float?,
    val hasData: Boolean,
)

/**
 * Computes the scatter [ScatterLayout] from the display-unit [points] and the average-efficiency reference value
 * [avgEff], all in the same display unit. The x-axis spans the temperature range and the y-axis the efficiency
 * range, both widened to include [avgEff] so the reference line is always visible; a degenerate (single-value)
 * axis is expanded by one unit so its dots centre instead of dividing by zero. Pure (no Compose), so the geometry
 * is locked by JVM unit tests off-device.
 */
fun computeScatterLayout(
    points: List<ScatterPoint>,
    avgEff: Double?,
): ScatterLayout {
    if (points.isEmpty()) return ScatterLayout(emptyList(), null, hasData = false)

    val xs = points.map { it.tempDisplay }
    val ys = points.map { it.effDisplay }
    val (minX, maxX) = expandIfFlat(xs.min(), xs.max())
    val rawMinY = minOf(ys.min(), avgEff ?: ys.min())
    val rawMaxY = maxOf(ys.max(), avgEff ?: ys.max())
    val (minY, maxY) = expandIfFlat(rawMinY, rawMaxY)

    val dots =
        points.map { point ->
            ScatterDot(
                xFraction = fraction(point.tempDisplay, minX, maxX),
                yFraction = fraction(point.effDisplay, minY, maxY),
                bucketIndex = point.bucketIndex,
            )
        }
    val avgFraction = avgEff?.let { fraction(it, minY, maxY) }
    return ScatterLayout(dots, avgFraction, hasData = true)
}

private fun expandIfFlat(
    min: Double,
    max: Double,
): Pair<Double, Double> = if (max - min < EPSILON) (min - 1.0) to (max + 1.0) else min to max

private fun fraction(
    value: Double,
    min: Double,
    max: Double,
): Float {
    val span = max - min
    if (span <= 0.0) return HALF
    return ((value - min) / span).toFloat().coerceIn(0f, 1f)
}

/* ------------------------------------------------------------------ */
/*  Contextual tips (web tips useMemo)                                */
/* ------------------------------------------------------------------ */

/** The three contextual tip dispositions the web page can surface (`tipOptimal` / `tipCold` / `tipHot`). */
enum class TemperatureTipKind { Optimal, Cold, Hot }

/**
 * One contextual recommendation row (web `tips[]`). [range] carries the best-bucket label for the optimal tip's
 * `{{range}}` interpolation; it is null for the cold/hot tips, which are static strings.
 */
data class TemperatureTip(
    val kind: TemperatureTipKind,
    val range: String? = null,
)

/**
 * Builds the contextual tips from the derived [stats] (web `tips` useMemo): the optimal-range tip when a best
 * bucket exists, the cold-weather tip when the coldest bucket has drives, and the hot-weather tip when the hottest
 * bucket has drives — in that order. An absent [stats] yields no tips, surfacing the empty state.
 */
fun temperatureTips(stats: TemperatureStats?): List<TemperatureTip> {
    if (stats == null) return emptyList()
    val tips = mutableListOf<TemperatureTip>()
    stats.best?.let { tips.add(TemperatureTip(TemperatureTipKind.Optimal, range = it.label)) }
    val cold = stats.bucketAvgs.firstOrNull()
    if (cold != null && cold.count > 0) tips.add(TemperatureTip(TemperatureTipKind.Cold))
    val hot = stats.bucketAvgs.lastOrNull()
    if (hot != null && hot.count > 0) tips.add(TemperatureTip(TemperatureTipKind.Hot))
    return tips
}

/* ------------------------------------------------------------------ */
/*  Diagnostics + Resource mapping                                    */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TemperatureImpactPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no vehicle id, temperature, or efficiency payload.
 */
fun recordTemperatureImpactPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TemperatureImpactPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The
 * cached value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both
 * transformed; the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

private const val DEFAULT_LOCALE = "en-US"
private const val DEFAULT_PRECISION = 2
private const val EFF_LABEL_KM = "Wh/km"
private const val EFF_LABEL_MI = "Wh/mi"
private const val EPSILON = 1e-9
private const val HALF = 0.5f
