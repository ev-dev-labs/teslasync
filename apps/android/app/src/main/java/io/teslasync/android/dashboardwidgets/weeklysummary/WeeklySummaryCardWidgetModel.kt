// File hosts the Weekly Summary surface's pure model + projection + registry; named after the
// surface bundle (WeeklySummaryCardWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.weeklysummary

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** The em-dash shown wherever a change is undefined (matches the shared fallback + the web `'—'`). */
internal const val WEEKLY_SUMMARY_EM_DASH: String = "\u2014"

/** The flat-trend marker the web renders when the change rounds toward zero (`'~0%'`). */
internal const val WEEKLY_SUMMARY_NEAR_ZERO: String = "~0%"

/** The energy tile unit (web literal `"kWh"`). */
internal const val WEEKLY_SUMMARY_ENERGY_UNIT: String = "kWh"

/** Efficiency unit when the user prefers kilometres (web `"Wh/km"`). */
internal const val WEEKLY_SUMMARY_EFFICIENCY_UNIT_KM: String = "Wh/km"

/** Efficiency unit when the user prefers miles (web `"Wh/mi"`). */
internal const val WEEKLY_SUMMARY_EFFICIENCY_UNIT_MI: String = "Wh/mi"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`
 * plus the `isCompact` / `isWide` / `isTall` flags in
 * `web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx`.
 */
data class WeeklySummaryCardSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single 1×1 cell (web `isCompact`): show the big distance number. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1

    /** True at three or more columns (web `isWide`): lay the four tiles out in one row. */
    val isWide: Boolean get() = cols >= WIDE_COLS

    /** True at two or more rows (web `isTall`): add the cost + efficiency tiles. */
    val isTall: Boolean get() = rows >= TALL_ROWS

    private companion object {
        const val WIDE_COLS = 3
        const val TALL_ROWS = 2
    }
}

/**
 * Canonical registry metadata for the Weekly Summary surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/analytics.ts` (`weekly-summary-card`). A
 * dashboard host binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE]
 * footprint constraints.
 */
object WeeklySummaryCardRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "weekly-summary-card"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WeeklySummaryCardWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: WeeklySummaryCardSize = WeeklySummaryCardSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: WeeklySummaryCardSize = WeeklySummaryCardSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: WeeklySummaryCardSize = WeeklySummaryCardSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: WeeklySummaryCardSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: WeeklySummaryCardSize): WeeklySummaryCardSize =
        WeeklySummaryCardSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The monetary display preferences the surface needs to price the weekly cost — the native analogue
 * of the web `useFormatting` reads derived from `useSettings` (web/src/hooks/useFormatting.ts): the
 * currency symbol and the decimal precision. (`formatCurrency` is the only `useFormatting` member
 * this widget uses.)
 */
data class WeeklySummaryFormatting(
    val currencySymbol: String = DEFAULT_CURRENCY,
    val precision: Int = DEFAULT_PRECISION,
) {
    /** The currency symbol with the web's blank/whitespace → "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { DEFAULT_CURRENCY }

    /** The decimal precision floored at zero (web non-negative `Math.floor`). */
    val resolvedPrecision: Int get() = if (precision < 0) 0 else precision

    /**
     * Format a currency amount — the native port of `useFormatting.formatCurrency`:
     * `${symbol}${fmtNumber(amount, decimals ?? userPrecision)}`.
     */
    fun formatCurrency(
        amount: Double,
        decimals: Int? = null,
        locale: Locale = Locale.getDefault(),
    ): String {
        val digits = (decimals ?: resolvedPrecision).coerceAtLeast(0)
        return "$resolvedSymbol${ChartFormat.number(amount, digits, locale)}"
    }

    companion object {
        /** Default fraction digits (web `?? 2`). */
        const val DEFAULT_PRECISION: Int = 2

        /** Default currency symbol (web blank → "$"). */
        const val DEFAULT_CURRENCY: String = "$"

        /** The all-default monetary preferences ("$", 2 dp). */
        val DEFAULT: WeeklySummaryFormatting = WeeklySummaryFormatting()

        /**
         * Derives the monetary preferences from the raw `/settings` document — the Kotlin port of the
         * web `useFormatting` reads: blank `currency_symbol` → "$", finite-&-non-negative
         * `decimal_precision` floored (else 2).
         */
        fun from(settings: JsonElement?): WeeklySummaryFormatting {
            val obj = settings as? JsonObject ?: return DEFAULT
            val rawSymbol = obj.stringAt(KEY_CURRENCY_SYMBOL)
            return WeeklySummaryFormatting(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = obj.precisionAt(KEY_DECIMAL_PRECISION) ?: DEFAULT_PRECISION,
            )
        }

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_DECIMAL_PRECISION = "decimal_precision"
    }
}

/**
 * The display preferences this surface re-derives from the live settings document — the unit [units]
 * preference (web `useUnits`) plus the monetary [formatting] (web `useFormatting`).
 */
data class WeeklySummaryPrefs(
    val units: UnitPref,
    val formatting: WeeklySummaryFormatting,
) {
    /** The user's display distance unit (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = units.distance

    /** True when the user prefers miles (web `unitPrefs.distance === 'mi'`). */
    val isMiles: Boolean get() = units.distance == DistanceUnitPref.MI

    /** The distance unit label shown on the tiles (web `distanceUnit`). */
    val distanceUnitLabel: String get() = distanceUnit.label

    /** The efficiency unit label (web `'Wh/mi'` for miles else `'Wh/km'`). */
    val efficiencyUnit: String get() = if (isMiles) WEEKLY_SUMMARY_EFFICIENCY_UNIT_MI else WEEKLY_SUMMARY_EFFICIENCY_UNIT_KM

    companion object {
        /** Metric + all-default monetary preferences used before settings load (matches the web defaults). */
        val DEFAULT: WeeklySummaryPrefs = WeeklySummaryPrefs(UnitPreferences.fromSettings(null), WeeklySummaryFormatting.DEFAULT)

        /** Resolves both the unit preference and the monetary preferences from one `/settings` document. */
        fun from(settings: JsonElement?): WeeklySummaryPrefs =
            WeeklySummaryPrefs(UnitPreferences.fromSettings(settings), WeeklySummaryFormatting.from(settings))
    }
}

/**
 * One week's raw figures from `GET /vehicles/{id}/weekly-digest`, in the units the endpoint serves
 * (km, kWh, currency, Wh/km — NOT SI; the endpoint pre-divides). Mirrors the web `WeeklyDigestData`
 * fields read with `?? 0`.
 */
data class WeekStats(
    val drives: Double,
    val distanceKm: Double,
    val energyKwh: Double,
    val cost: Double,
    val efficiencyWhKm: Double,
) {
    /** True when the week recorded any activity — drives the friendly empty state (web `No weekly data`). */
    val hasData: Boolean get() = drives > 0.0 || distanceKm > 0.0 || energyKwh > 0.0 || cost > 0.0

    companion object {
        /** An all-zero week (the projection basis before any data resolves / a quiet week). */
        val ZERO: WeekStats = WeekStats(0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * The weekly digest split into the current week and the prior week to compare against — the native
 * shape of the `/vehicles/{id}/weekly-digest` payload (web `WeeklyDigestData`).
 */
data class WeeklyDigest(
    val current: WeekStats,
    val previous: WeekStats,
) {
    /** True when the current week recorded activity (web `metrics` content vs the empty state). */
    val hasData: Boolean get() = current.hasData

    companion object {
        /** An all-zero digest (both weeks quiet). */
        val EMPTY: WeeklyDigest = WeeklyDigest(WeekStats.ZERO, WeekStats.ZERO)

        /**
         * Parses the cached digest [json] — snake_case on the wire (`distance_km`, `energy_kwh`,
         * `prev_*`), camelCase tolerated. Every field collapses to zero exactly like the web `?? 0`.
         */
        fun from(json: JsonElement?): WeeklyDigest {
            val obj = json as? JsonObject ?: return EMPTY
            return WeeklyDigest(
                current =
                    WeekStats(
                        drives = obj.numberAt("drives") ?: 0.0,
                        distanceKm = obj.numberAt("distance_km", "distanceKm") ?: 0.0,
                        energyKwh = obj.numberAt("energy_kwh", "energyKwh") ?: 0.0,
                        cost = obj.numberAt("cost") ?: 0.0,
                        efficiencyWhKm = obj.numberAt("efficiency") ?: 0.0,
                    ),
                previous =
                    WeekStats(
                        drives = obj.numberAt("prev_drives", "prevDrives") ?: 0.0,
                        distanceKm = obj.numberAt("prev_distance_km", "prevDistanceKm") ?: 0.0,
                        energyKwh = obj.numberAt("prev_energy_kwh", "prevEnergyKwh") ?: 0.0,
                        cost = obj.numberAt("prev_cost", "prevCost") ?: 0.0,
                        efficiencyWhKm = obj.numberAt("prev_efficiency", "prevEfficiency") ?: 0.0,
                    ),
            )
        }
    }
}

/** A single display metric with its current value and the previous-week value the trend compares to. */
data class WeeklyMetric(
    val current: Double,
    val previous: Double,
) {
    companion object {
        /** A zeroed metric (no change). */
        val ZERO: WeeklyMetric = WeeklyMetric(0.0, 0.0)
    }
}

/**
 * The display-ready projection of the weekly digest — the native port of the web component's
 * `metrics` memo. Each [WeeklyMetric] carries the current + previous values already converted into
 * the user's display unit, so the view only formats and computes trends.
 */
data class WeeklySummaryMetrics(
    val distance: WeeklyMetric,
    val energy: WeeklyMetric,
    val cost: WeeklyMetric,
    val efficiency: WeeklyMetric,
    val drives: WeeklyMetric,
) {
    companion object {
        /** An all-zero snapshot — the projection basis for the empty/loading surfaces. */
        val EMPTY: WeeklySummaryMetrics =
            WeeklySummaryMetrics(WeeklyMetric.ZERO, WeeklyMetric.ZERO, WeeklyMetric.ZERO, WeeklyMetric.ZERO, WeeklyMetric.ZERO)
    }
}

/**
 * Pure projection from the raw [WeeklyDigest] to the display [WeeklySummaryMetrics] plus the trend
 * helper — the Android port of the web component's `metrics` memo and `trendOf`. Framework-free so
 * the gate unit-tests it without a device.
 *
 * The web's display path is reproduced VERBATIM, including its SI-cutover quirks (the
 * km→miles-magnitude value is fed into `convertDistanceFromSI`, whose parameter is SI metres, and the
 * Wh/km efficiency is multiplied twice for the miles branch). These are NOT "fixed" — parity with the
 * web's observable output is the contract (same precedent as `ChargeCostTrackerProjection`).
 */
object WeeklySummaryProjection {
    /** Kilometres → miles factor (web `UNITS.KM_TO_MI`). */
    const val KM_TO_MI: Double = 0.621371

    /** Miles → kilometres factor (web `UNITS.MI_TO_KM`). */
    const val MI_TO_KM: Double = 1.60934

    /** The literal the web `toEfficiencyDisplay` multiplies by for the miles branch. */
    const val EFFICIENCY_MI_FACTOR: Double = 1.609344

    /** Below this absolute percent change the web renders the flat `~0%` marker. */
    const val NEAR_ZERO_PERCENT: Double = 1.0

    /** Trend percent precision (web `fmtPercent(…, 0)`). */
    const val TREND_DECIMALS: Int = 0

    /** Compact big-number precision (web `fmtNumber(distance, 0)`). */
    const val DISTANCE_COMPACT_DECIMALS: Int = 0

    /** Distance tile precision (web `fmtNumber(distance, 1)`). */
    const val DISTANCE_DECIMALS: Int = 1

    /** Energy tile precision (web `fmtNumber(energy, 1)`). */
    const val ENERGY_DECIMALS: Int = 1

    /** Efficiency tile precision (web `fmtNumber(efficiency, 0)`). */
    const val EFFICIENCY_DECIMALS: Int = 0

    private const val PERCENT = 100.0

    /**
     * Projects [digest] into the display metrics for [prefs] — the native port of the web `metrics`
     * memo. Distances and efficiency are converted to the user's unit; the web's double-conversion
     * quirks are reproduced (see the class KDoc).
     */
    fun computeMetrics(
        digest: WeeklyDigest,
        prefs: WeeklySummaryPrefs,
    ): WeeklySummaryMetrics {
        val unit = prefs.distanceUnit
        val isMiles = prefs.isMiles
        return WeeklySummaryMetrics(
            distance =
                WeeklyMetric(
                    current = displayDistance(digest.current.distanceKm, unit),
                    previous = displayDistance(digest.previous.distanceKm, unit),
                ),
            energy = WeeklyMetric(digest.current.energyKwh, digest.previous.energyKwh),
            cost = WeeklyMetric(digest.current.cost, digest.previous.cost),
            efficiency =
                WeeklyMetric(
                    current = displayEfficiency(digest.current.efficiencyWhKm, isMiles),
                    previous = displayEfficiency(digest.previous.efficiencyWhKm, isMiles),
                ),
            drives = WeeklyMetric(digest.current.drives, digest.previous.drives),
        )
    }

    /**
     * Web parity: `convertDistanceFromSI(distanceKm * KM_TO_MI, unit)`. The km→miles magnitude is fed
     * straight into the SI-metres parameter, so it is divided as though it were metres. Reproduced
     * verbatim — never silently corrected.
     */
    fun displayDistance(
        distanceKm: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(distanceKm * KM_TO_MI, unit)

    /**
     * Web parity: `effWhMi = efficiencyWhKm * MI_TO_KM`, then `isMiles ? effWhMi * 1.609344 : effWhMi`.
     * The miles branch multiplies twice. Reproduced verbatim — never silently corrected.
     */
    fun displayEfficiency(
        efficiencyWhKm: Double,
        isMiles: Boolean,
    ): Double {
        val effWhMi = efficiencyWhKm * MI_TO_KM
        return if (isMiles) effWhMi * EFFICIENCY_MI_FACTOR else effWhMi
    }

    /**
     * The trend chip for a [metric] — the native port of the web `trendOf`. A zero previous value
     * yields a flat em-dash; a change under [NEAR_ZERO_PERCENT] yields the flat `~0%` marker; else an
     * up/down arrow with the rounded percent and a [StatTrend.positive] tone. When [lowerIsPositive]
     * a decrease is the good (green) direction (web cost / efficiency).
     */
    fun trendOf(
        metric: WeeklyMetric,
        lowerIsPositive: Boolean = false,
        locale: Locale = Locale.getDefault(),
    ): StatTrend {
        val previous = metric.previous
        if (previous == 0.0) {
            return StatTrend(direction = DeltaArrow.Flat, text = WEEKLY_SUMMARY_EM_DASH, positive = null)
        }
        val pct = (metric.current - previous) / abs(previous) * PERCENT
        return if (abs(pct) < NEAR_ZERO_PERCENT) {
            StatTrend(direction = DeltaArrow.Flat, text = WEEKLY_SUMMARY_NEAR_ZERO, positive = null)
        } else {
            val direction = if (pct > 0.0) DeltaArrow.Up else DeltaArrow.Down
            val positive = if (lowerIsPositive) pct < 0.0 else pct > 0.0
            StatTrend(direction = direction, text = formatPercent(abs(pct), locale), positive = positive)
        }
    }

    /** Formats a percentage the way the web `fmtPercent(value, 0)` does: rounded integer + `%`. */
    fun formatPercent(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "${ChartFormat.number(value, TREND_DECIMALS, locale)}%"
}

/** The mutually-exclusive surface drawn for a given [UiState] phase (web `WidgetShell` branches). */
enum class WeeklySummarySurface { Loading, Error, Empty, Content }

/** Maps a [UiState] onto the surface to render. Stale/offline stay Content/Empty + a freshness chip. */
fun weeklySummarySurface(state: UiState<*>): WeeklySummarySurface =
    when (state.phase) {
        UiPhase.Loading -> WeeklySummarySurface.Loading
        UiPhase.Error -> WeeklySummarySurface.Error
        UiPhase.Empty -> WeeklySummarySurface.Empty
        UiPhase.Content -> WeeklySummarySurface.Content
    }

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun weeklySummaryErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/** Web `metrics ? content : EmptyState` — a week with no recorded activity surfaces the empty state. */
fun weeklyDigestHasData(json: JsonElement?): Boolean = WeeklyDigest.from(json).hasData

/**
 * Builds the compact-state accessibility label from its parts — extracted as a pure function so the
 * TalkBack announcement ("{value} {unit} {this week}") is verified in the JVM gate without a device.
 */
fun weeklySummaryCompactContentDescription(
    value: String,
    unit: String,
    thisWeek: String,
): String = "$value $unit $thisWeek"

/**
 * Projects a cache-then-network [UiState] of the raw digest [JsonElement] onto a [UiState] of the
 * computed [WeeklySummaryMetrics] for [prefs], preserving the phase + freshness flags. Pure (no
 * Compose, no timestamps read) so the cached → projection adapter is unit-tested off-device.
 */
fun UiState<JsonElement>.toMetricsState(prefs: WeeklySummaryPrefs): UiState<WeeklySummaryMetrics> {
    val metrics = data?.let { WeeklySummaryProjection.computeMetrics(WeeklyDigest.from(it), prefs) }
    return UiState(
        phase = phase,
        data = metrics,
        fetchedAt = fetchedAt,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
        httpStatus = httpStatus,
    )
}

private fun JsonObject.numberAt(vararg keys: String): Double? =
    keys.firstNotNullOfOrNull { key -> (this[key] as? JsonPrimitive)?.doubleOrNull }

private fun JsonObject.stringAt(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.precisionAt(key: String): Int? {
    val value = (this[key] as? JsonPrimitive)?.doubleOrNull ?: return null
    return if (value.isFinite() && value >= 0.0) floor(value).toInt() else null
}
