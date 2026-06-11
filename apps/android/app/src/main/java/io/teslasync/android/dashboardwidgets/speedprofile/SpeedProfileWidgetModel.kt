// File hosts the Speed Profile surface's framework-free model + projection + registry; named after the
// surface bundle (SpeedProfileWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.speedprofile

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the web `'—'` fallback). */
internal const val SPEED_PROFILE_EM_DASH: String = "\u2014"

/** The percent sign appended to the frequency stat / axis (web `%`). */
internal const val SPEED_PROFILE_PERCENT: String = "%"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` plus
 * the `isCompact` / `isWide` rules in `web/src/features/dashboard/widgets/SpeedProfileWidget.tsx`.
 */
data class SpeedProfileSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): summary stats only, no chart. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): the chart uses the larger axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for the Speed Profile surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/driving.ts` (`speed-profile`). A dashboard host
 * binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint constraints.
 */
object SpeedProfileRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "speed-profile"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SpeedProfileWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: SpeedProfileSize = SpeedProfileSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val MIN_SIZE: SpeedProfileSize = SpeedProfileSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: SpeedProfileSize = SpeedProfileSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: SpeedProfileSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SpeedProfileSize): SpeedProfileSize =
        SpeedProfileSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * One speed-distribution bucket from `GET /analytics/speed-profile` (web `SpeedBucket`), reduced to the
 * three fields the widget reads: the [speedBucket] range label, the [readings] count, and the average
 * power [avgPowerKw].
 *
 * Parity quirk preserved verbatim: the web reads `b.avg_power_kw ?? b.avgPowerKw`, but the backend emits
 * the SI-canonical `avg_power_w` key (see `internal/api/speedprofile/handler.go` — "the typed widget
 * falls back to 0 in the interim, which is the documented graceful-degradation path"). Neither web key
 * is present in the live payload, so [avgPowerKw] resolves to 0 from the feed and the efficiency overlay
 * is flat — exactly what the web renders. The `avg_power_w` key is intentionally NOT read here; doing so
 * would diverge from the web's observable output (a silent drift).
 */
data class SpeedProfileBucket(
    val speedBucket: String,
    val readings: Int,
    val avgPowerKw: Double,
)

/**
 * The parsed `GET /analytics/speed-profile` payload backing the widget (web `SpeedProfileData`), reduced
 * to exactly what the surface renders: the [distribution] buckets and the SI [optimalSpeedMps] used for
 * the "Sweet Spot" stat. Reads are null-tolerant so a partial body never throws (web treats them as
 * plain numbers with `?? 0` fallbacks). Speed stays SI; conversion is display-only (S5).
 */
data class SpeedProfileSnapshot(
    val distribution: List<SpeedProfileBucket>,
    val optimalSpeedMps: Double,
) {
    /** Total readings across all buckets (web `distribution.reduce((s, b) => s + (b.readings ?? 0), 0)`). */
    val totalReadings: Int get() = distribution.sumOf { it.readings }

    /**
     * True when there is nothing meaningful to chart — no buckets, or no readings at all (web
     * `hasData = chartData.length > 0 && chartData.some(d => d.frequency > 0)`, negated). Drives the
     * [io.teslasync.android.data.UiPhase.Empty] surface.
     */
    val isEmpty: Boolean get() = distribution.isEmpty() || totalReadings <= 0

    companion object {
        /** The empty snapshot (no buckets) — the projection basis before/without data. */
        val EMPTY: SpeedProfileSnapshot = SpeedProfileSnapshot(emptyList(), 0.0)

        /** Parses a `/analytics/speed-profile` body into a tolerant snapshot (web destructuring + `safeArray`). */
        fun fromJson(element: JsonElement?): SpeedProfileSnapshot {
            val obj = element as? JsonObject ?: return EMPTY
            return SpeedProfileSnapshot(
                distribution = parseDistribution(obj["distribution"]),
                // Web reads `data.optimalSpeedMps` (camelCased by the web client from the raw
                // `optimal_speed_mps`); the native repo sees the raw snake_case key, so both are read.
                optimalSpeedMps = obj.doubleAt(KEY_OPTIMAL_CAMEL) ?: obj.doubleAt(KEY_OPTIMAL_SNAKE) ?: 0.0,
            )
        }

        private fun parseDistribution(element: JsonElement?): List<SpeedProfileBucket> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toBucket() }
                ?: emptyList()

        private fun JsonObject.toBucket(): SpeedProfileBucket =
            SpeedProfileBucket(
                // Web `b.speed_bucket ?? b.speedBucket ?? ''`.
                speedBucket = stringAt(KEY_SPEED_BUCKET_SNAKE) ?: stringAt(KEY_SPEED_BUCKET_CAMEL) ?: "",
                readings = intAt(KEY_READINGS) ?: 0,
                // Web `b.avg_power_kw ?? b.avgPowerKw ?? 0` — see [SpeedProfileBucket] quirk note.
                avgPowerKw = doubleAt(KEY_AVG_POWER_KW_SNAKE) ?: doubleAt(KEY_AVG_POWER_KW_CAMEL) ?: 0.0,
            )

        private fun JsonObject.doubleAt(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

        private fun JsonObject.intAt(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

        private fun JsonObject.stringAt(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        private const val KEY_SPEED_BUCKET_SNAKE = "speed_bucket"
        private const val KEY_SPEED_BUCKET_CAMEL = "speedBucket"
        private const val KEY_READINGS = "readings"
        private const val KEY_AVG_POWER_KW_SNAKE = "avg_power_kw"
        private const val KEY_AVG_POWER_KW_CAMEL = "avgPowerKw"
        private const val KEY_OPTIMAL_CAMEL = "optimalSpeedMps"
        private const val KEY_OPTIMAL_SNAKE = "optimal_speed_mps"
    }
}

/**
 * One render-ready chart row — the native analogue of the flat objects the web builds in `buildChartData`:
 * the [bucket] label (already converted to the user's speed unit), the [frequency] percent plotted as a
 * column, and the [efficiency] plotted as the overlay line.
 */
data class SpeedChartDatum(
    val bucket: String,
    val frequency: Double,
    val efficiency: Double,
)

/** One summary stat chip — the native counterpart of the web `ChartSummaryStat` ({label, value, unit?}). */
data class SpeedProfileStat(
    val label: String,
    val value: String,
    val unit: String? = null,
)

/** Localized stat labels, resolved by the view from the P1/S10 i18n catalog. */
data class SpeedProfileStatLabels(
    val mostCommon: String,
    val peakFreq: String,
    val sweetSpot: String,
)

/**
 * The fully projected, render-ready view of the speed profile for one footprint + unit preference — the
 * native analogue of everything the web component computes before returning JSX: the converted
 * [chartData], the [peakBucket] / [sweetSpot] / [peakFreq] summary values, the [hasData] gate, the
 * resolved [speedUnit] label, and the compact / wide layout flags. Pure data so it is unit-tested directly.
 */
data class SpeedProfileDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val chartData: List<SpeedChartDatum>,
    val peakBucket: String,
    val sweetSpot: String,
    val peakFreq: Double,
    val speedUnit: String,
) {
    /** The x-axis bucket labels for the chart, in source order. */
    val bucketLabels: List<String> get() = chartData.map { it.bucket }

    /** The plotted frequency series (percent), in source order. */
    val frequencyValues: List<Double> get() = chartData.map { it.frequency }

    /** The plotted efficiency series, in source order (flat at 0 from the live feed — see the bucket quirk). */
    val efficiencyValues: List<Double> get() = chartData.map { it.efficiency }
}

/**
 * The unit preference this surface re-derives from the live settings document — only the speed unit is
 * needed (web `useUnits().unitPrefs.speed`). Kept as a tiny value so the cached → projection adapter is
 * deterministic in tests.
 */
data class SpeedProfilePrefs(
    val speed: SpeedUnitPref,
) {
    companion object {
        /** Metric default used before settings load (web default `km/h`). */
        val DEFAULT: SpeedProfilePrefs = SpeedProfilePrefs(UnitPreferences.fromSettings(null).speed)

        /** Resolves the speed unit preference from one `/settings` document (web `useUnits`). */
        fun from(settings: JsonElement?): SpeedProfilePrefs = SpeedProfilePrefs(UnitPreferences.fromSettings(settings).speed)
    }
}

/**
 * Pure projection from a parsed [SpeedProfileSnapshot] to the render-ready [SpeedProfileDisplay] and the
 * summary stat chips — the Android port of the web `buildChartData`, `sweetSpot`, `peakFreq`, `peakBucket`
 * and `stats` `useMemo` work plus the compact branch. Framework-free so the gate unit-tests it without a
 * device; SI speed is converted to the user's unit here (S5) via the shared [convertSpeedFromSI].
 */
object SpeedProfileProjection {
    /** Frequency stat / peak precision (web `fmtNumber(peakFreq, 1)`). */
    const val FREQUENCY_DECIMALS: Int = 1

    /** Bucket-label + sweet-spot precision (web `fmtInt`). */
    const val SPEED_DECIMALS: Int = 0

    /**
     * Projects [snapshot] for [size] + [prefs] into the render-ready display (web `chartData` + the
     * `sweetSpot` / `peakFreq` / `peakBucket` memos + `hasData` + `isCompact`).
     */
    fun project(
        snapshot: SpeedProfileSnapshot,
        size: SpeedProfileSize,
        prefs: SpeedProfilePrefs,
        locale: Locale = Locale.getDefault(),
    ): SpeedProfileDisplay {
        val toSpeedDisplay = { value: Double -> convertSpeedFromSI(value, prefs.speed) }
        val chartData = buildChartData(snapshot, toSpeedDisplay, locale)
        val peakFreq = peakFrequency(chartData)
        return SpeedProfileDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            // Web `hasData = chartData.length > 0 && chartData.some(d => d.frequency > 0)`.
            hasData = chartData.isNotEmpty() && chartData.any { it.frequency > 0.0 },
            chartData = chartData,
            peakBucket = peakBucket(chartData, peakFreq),
            sweetSpot = sweetSpot(snapshot.optimalSpeedMps, chartData, toSpeedDisplay, locale),
            peakFreq = peakFreq,
            speedUnit = prefs.speed.label,
        )
    }

    /**
     * The native port of the web `buildChartData`: converts each bucket label to the user's speed unit,
     * derives the per-bucket frequency percent from its share of total readings, and reads the (web-keyed)
     * average power as the efficiency overlay.
     */
    fun buildChartData(
        snapshot: SpeedProfileSnapshot,
        toSpeedDisplay: (Double) -> Double,
        locale: Locale = Locale.getDefault(),
    ): List<SpeedChartDatum> {
        val total = snapshot.totalReadings
        return snapshot.distribution.map { bucket ->
            val frequency = if (total > 0) bucket.readings * PERCENT_SCALE / total else 0.0
            SpeedChartDatum(
                bucket = formatBucketLabel(bucket.speedBucket, toSpeedDisplay, locale),
                frequency = frequency,
                efficiency = bucket.avgPowerKw,
            )
        }
    }

    /**
     * Convert a bucket label to the user's speed unit — the native port of the web `formatBucketLabel`.
     * A `"lo-hi"` range converts both bounds; an `"80+"` style bucket converts the leading number. The
     * web feeds these (mph-magnitude) bucket numerics straight into `convertSpeedFromSI` (whose parameter
     * is SI m/s), and that exact behaviour is reproduced verbatim via the shared converter.
     */
    fun formatBucketLabel(
        bucket: String,
        toSpeedDisplay: (Double) -> Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val parts = bucket.split("-")
        val lo = parts.getOrNull(0)?.let(::jsParseFloat)
        val hi = parts.getOrNull(1)?.let(::jsParseFloat)
        return when {
            parts.size == 2 && lo != null && hi != null ->
                "${fmtInt(toSpeedDisplay(lo), locale)}-${fmtInt(toSpeedDisplay(hi), locale)}"
            else -> {
                val num = jsParseFloat(bucket)
                if (num != null) "${fmtInt(toSpeedDisplay(num), locale)}+" else bucket
            }
        }
    }

    /** Find the bucket with the best (lowest positive) efficiency — the native port of web `findSweetSpot`. */
    fun findSweetSpot(chartData: List<SpeedChartDatum>): String {
        val withEff = chartData.filter { it.efficiency > 0.0 }
        if (withEff.isEmpty()) return SPEED_PROFILE_EM_DASH
        var best = withEff.first()
        for (datum in withEff) {
            if (datum.efficiency < best.efficiency) best = datum
        }
        return best.bucket
    }

    /**
     * The "Sweet Spot" stat — the native port of the web memo: the converted optimal speed when the API
     * supplies a positive SI value, otherwise the lowest-power bucket label (or an em dash).
     */
    fun sweetSpot(
        optimalSpeedMps: Double,
        chartData: List<SpeedChartDatum>,
        toSpeedDisplay: (Double) -> Double,
        locale: Locale = Locale.getDefault(),
    ): String =
        if (optimalSpeedMps > 0.0) {
            fmtInt(toSpeedDisplay(optimalSpeedMps), locale)
        } else {
            findSweetSpot(chartData)
        }

    /** The peak frequency across the chart rows (web `peakFreq` memo). */
    fun peakFrequency(chartData: List<SpeedChartDatum>): Double {
        var max = 0.0
        for (datum in chartData) {
            if (datum.frequency > max) max = datum.frequency
        }
        return max
    }

    /** The label of the first bucket whose frequency equals the peak (web `peakBucket` memo), else an em dash. */
    fun peakBucket(
        chartData: List<SpeedChartDatum>,
        peakFreq: Double,
    ): String = chartData.firstOrNull { it.frequency == peakFreq }?.bucket ?: SPEED_PROFILE_EM_DASH

    /**
     * Builds the summary stat chips exactly as the web does: the compact (1-col) layout shows Most Common +
     * Sweet Spot; the standard layout inserts the Peak Freq percent between them. Returns an empty list when
     * there is no data (the web renders the empty state instead of stats). [labels] come from the i18n facade.
     */
    fun stats(
        display: SpeedProfileDisplay,
        labels: SpeedProfileStatLabels,
        locale: Locale = Locale.getDefault(),
    ): List<SpeedProfileStat> {
        if (!display.hasData) return emptyList()
        return buildList {
            add(SpeedProfileStat(labels.mostCommon, display.peakBucket, display.speedUnit))
            if (!display.isCompact) {
                add(
                    SpeedProfileStat(
                        labels.peakFreq,
                        "${ChartFormat.number(display.peakFreq, FREQUENCY_DECIMALS, locale)}$SPEED_PROFILE_PERCENT",
                    ),
                )
            }
            add(SpeedProfileStat(labels.sweetSpot, display.sweetSpot, display.speedUnit))
        }
    }

    /** Integer-format a converted speed (web `fmtInt`): grouped, zero fraction digits. */
    private fun fmtInt(
        value: Double,
        locale: Locale,
    ): String = ChartFormat.number(value, SPEED_DECIMALS, locale)

    private const val PERCENT_SCALE = 100.0
}

/**
 * The leading-number parse of [text] using JavaScript `parseFloat` semantics — parses an optional sign,
 * an integer/decimal/exponent prefix, and ignores any trailing non-numeric characters (e.g. `"80+"` → 80,
 * `"abc"` → null). Reproduces the web `parseFloat` used by `formatBucketLabel` so bucket labels convert
 * identically; `null` is the Kotlin analogue of the web `NaN` guard. The regex-validated numeric token is
 * parsed to a Double via the JDK to keep the conversion explicit.
 */
internal fun jsParseFloat(text: String): Double? {
    val token = LEADING_NUMBER.find(text.trimStart())?.value ?: return null
    return runCatching { java.lang.Double.parseDouble(token) }.getOrNull()
}

private val LEADING_NUMBER = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")

/** The mutually-exclusive surface drawn for a given [UiState] phase (web WidgetShell branches). */
enum class SpeedProfileSurface { Loading, Error, Empty, Content }

/** Maps a [UiState] onto the surface to render. Stale/offline stay Content/Empty + a freshness chip. */
fun speedProfileSurface(state: UiState<*>): SpeedProfileSurface =
    when (state.phase) {
        UiPhase.Loading -> SpeedProfileSurface.Loading
        UiPhase.Error -> SpeedProfileSurface.Error
        UiPhase.Empty -> SpeedProfileSurface.Empty
        UiPhase.Content -> SpeedProfileSurface.Content
    }

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun speedProfileErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )
