// Pure, framework-free model + projection for the ChargingTab feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/ChargingTab.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the analytics page) computes the
// `FleetAnalytics` and passes it down as the single `data` prop. This file owns the parts the web
// component expresses from that prop: the six summary-metric value strings (with the web `fmtInt` /
// `fmtNumber` / `formatCurrency` formatting and the `powerStats ? … : '—'` fallbacks), the donut /
// bar / combo chart projections (the data the web Recharts `PieChart` / `BarChart` / `ComposedChart`
// plot, plus the screen-reader fallback rows), the lifecycle projection onto the shared
// cache-then-network [UiState] (P1/S8), and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingTab — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingtab

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or
 * actor, so a diagnostics line can never leak vehicle identity or owner movement from this panel.
 */
const val CHARGING_TAB_SLUG: String = "ChargingTab"

/** Em dash shown for an absent statistic — the native mirror of the web `'—'` fallback. */
const val CHARGING_EM_DASH: String = "\u2014"

/** Default currency symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank. */
const val CHARGING_DEFAULT_CURRENCY: String = "$"

// The fixed unit symbols the web component hard-codes as `subtitle` literals (not i18n strings): they
// are SI/standard unit glyphs that read identically in every locale, exactly as the web renders them.
const val CHARGING_UNIT_KWH: String = "kWh"
const val CHARGING_UNIT_KW: String = "kW"
const val CHARGING_UNIT_PERCENT: String = "%"

/** One charger-type slice — the native mirror of the web `charging_analytics.charger_types[]`. */
data class ChargerTypeSlice(
    val type: String,
    val count: Double,
)

/** One start-battery bucket — the native mirror of the web `charging_analytics.start_battery_dist[]`. */
data class StartBatteryBucket(
    val range: String,
    val count: Double,
)

/** One hourly-pattern point — the native mirror of the web `charging_analytics.hourly_pattern[]`. */
data class HourlyChargePoint(
    val hour: Int,
    val charges: Double,
    val energy: Double,
)

/**
 * The render-ready content payload — the native projection of the slice of `FleetAnalytics` the web
 * `ChargingTab` reads. The host (P1/S8) builds this from the analytics feed; the surface never fetches.
 *
 * The three averages are nullable to reproduce the web `powerStats ? … : '—'` guard exactly: `null`
 * means the corresponding `*_stats` object was absent (render an em dash), whereas a present-but-NaN
 * average renders `"0"` like the web `safe(stats.avg)`.
 */
data class ChargingTabData(
    val totalSessions: Double?,
    val totalEnergyKwh: Double?,
    val totalCost: Double?,
    val powerAvg: Double?,
    val durationAvg: Double?,
    val efficiencyAvg: Double?,
    val chargerTypes: List<ChargerTypeSlice>,
    val startBatteryDist: List<StartBatteryBucket>,
    val hourlyPattern: List<HourlyChargePoint>,
)

/**
 * The six summary tiles the web component renders, in source order. Identity only — the localized label,
 * the line glyph, the accent color, and any unit subtitle are resolved at the Compose boundary, keeping
 * this enum free of any Android or i18n dependency so it stays unit-testable off-device.
 */
enum class ChargingMetric {
    Sessions,
    TotalEnergy,
    TotalCost,
    AvgPower,
    AvgDuration,
    ChargeEfficiency,
}

/** One render-ready tile: its [metric] identity and the already-formatted [value] string. */
data class ChargingMetricValue(
    val metric: ChargingMetric,
    val value: String,
)

/** One render-ready donut slice: the data [type]/[count], its [fraction] of the whole, and labels. */
data class ChargingDonutSlice(
    val type: String,
    val count: Double,
    val fraction: Double,
    val countLabel: String,
    val percentLabel: String,
)

/** The donut projection: the ordered [slices] plus an [isEmpty] flag for the per-chart empty state. */
data class ChargingDonutModel(
    val slices: List<ChargingDonutSlice>,
    val isEmpty: Boolean,
)

/**
 * A single-series bar projection (start-battery distribution): the bucket [xLabels], the bar [values]
 * (nullable for the chart layer's gap contract), the accessible [tableRows], and [isEmpty].
 */
data class ChargingBarModel(
    val xLabels: List<String>,
    val values: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The hourly combo projection: the hour [xLabels], the [charges] columns + [energy] trend line (both
 * nullable per the chart layer's gap contract), the accessible [tableRows], and [isEmpty]. The native
 * counterpart of the web dual-axis `ComposedChart`.
 */
data class ChargingHourlyModel(
    val xLabels: List<String>,
    val charges: List<Double?>,
    val energy: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's value
 * formatting and chart-data shaping. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings, glyphs, accents, and colors and
 * draws what these return.
 */
object ChargingTabProjection {
    /**
     * Maps the panel's `(data, isLoading)` onto the shared cache-then-network [UiState] (P1/S8). Unlike
     * the web component (whose parent owns the spinner), the native surface owns its lifecycle, so the
     * mapping is: loading → [UiPhase.Loading]; data present → [UiPhase.Content]; data absent →
     * [UiPhase.Empty]. The host's stateful binding can additionally carry refreshing/stale/offline/error;
     * the composable renders those too. Note the surface renders the same full scaffold for Content and
     * Empty (zeroed tiles + per-chart empty states), exactly like the web component renders with an
     * `undefined` `data` prop — it never collapses to a single blank box.
     */
    fun projectUiState(
        data: ChargingTabData?,
        isLoading: Boolean,
    ): UiState<ChargingTabData> =
        when {
            isLoading -> UiState.loading()
            data != null -> UiState(phase = UiPhase.Content, data = data)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six tile values in web source order, each formatted with the matching web rule:
     *  - Sessions       → `fmtInt(total_charging_sessions)`;
     *  - Total Energy   → `fmtNumber(total_energy_kwh, 1)`;
     *  - Total Cost     → `formatCurrency(total_cost ?? 0, 2)` (the [currencySymbol] prefix + grouped);
     *  - Avg Power      → `powerStats ? fmtNumber(safe(avg), 1) : '—'`;
     *  - Avg Duration   → `durStats ? fmtNumber(safe(avg), 0) : '—'`;
     *  - Charge Eff.    → `effStats ? fmtNumber(safe(avg), 1) : '—'`.
     *
     * [locale] drives the grouping/decimal symbols; a `null` [data] yields the web's `safeNumber → 0`
     * outputs for the three plain tiles and an em dash for the three stat averages.
     */
    fun metricValues(
        data: ChargingTabData?,
        currencySymbol: String,
        locale: Locale,
    ): List<ChargingMetricValue> =
        listOf(
            ChargingMetricValue(ChargingMetric.Sessions, formatInt(data?.totalSessions, locale)),
            ChargingMetricValue(ChargingMetric.TotalEnergy, formatNumber(data?.totalEnergyKwh, ENERGY_DECIMALS, locale)),
            ChargingMetricValue(
                ChargingMetric.TotalCost,
                formatCurrency(data?.totalCost, currencySymbol, CURRENCY_DECIMALS, locale),
            ),
            ChargingMetricValue(ChargingMetric.AvgPower, formatStatAvg(data?.powerAvg, POWER_DECIMALS, locale)),
            ChargingMetricValue(ChargingMetric.AvgDuration, formatStatAvg(data?.durationAvg, DURATION_DECIMALS, locale)),
            ChargingMetricValue(
                ChargingMetric.ChargeEfficiency,
                formatStatAvg(data?.efficiencyAvg, EFFICIENCY_DECIMALS, locale),
            ),
        )

    /**
     * The donut projection — the data the web `PieChart`/`Pie` plots (`dataKey="count"`,
     * `nameKey="type"`). Each slice carries its share [fraction] (0–1, of the summed counts) plus a
     * grouped count label and an integer percent label for the legend, the accessible data table, and
     * the TalkBack summary. [isEmpty] is the web `chargerTypes.length > 0` guard, inverted.
     */
    fun donut(
        data: ChargingTabData?,
        locale: Locale,
    ): ChargingDonutModel {
        val types = data?.chargerTypes.orEmpty()
        val total = types.sumOf { safeNumber(it.count) }
        val slices =
            types.map { slice ->
                val count = safeNumber(slice.count)
                val fraction = if (total > 0.0) count / total else 0.0
                ChargingDonutSlice(
                    type = slice.type,
                    count = count,
                    fraction = fraction,
                    countLabel = formatInt(count, locale),
                    percentLabel = formatInt(fraction * PERCENT_SCALE, locale) + CHARGING_UNIT_PERCENT,
                )
            }
        return ChargingDonutModel(slices = slices, isEmpty = slices.isEmpty())
    }

    /**
     * The start-battery distribution bar projection — the data the web `BarChart` plots over
     * `dataKey="range"` / `dataKey="count"`. The accessible table mirrors it as `(range, sessions)` rows.
     */
    fun startBatteryBars(
        data: ChargingTabData?,
        locale: Locale,
    ): ChargingBarModel {
        val buckets = data?.startBatteryDist.orEmpty()
        return ChargingBarModel(
            xLabels = buckets.map { it.range },
            values = buckets.map { safeNumber(it.count) },
            tableRows = buckets.map { listOf(it.range, formatInt(it.count, locale)) },
            isEmpty = buckets.isEmpty(),
        )
    }

    /**
     * The hourly-pattern combo projection — the data the web dual-axis `ComposedChart` plots: the
     * `charges` columns (left axis) and the `energy` trend line (right axis), keyed by `hour`. The hour
     * is formatted `"{h}:00"` like the web `tickFormatter`. The accessible table mirrors all three.
     */
    fun hourlyPattern(
        data: ChargingTabData?,
        locale: Locale,
    ): ChargingHourlyModel {
        val points = data?.hourlyPattern.orEmpty()
        return ChargingHourlyModel(
            xLabels = points.map { hourLabel(it.hour) },
            charges = points.map { safeNumber(it.charges) },
            energy = points.map { safeNumber(it.energy) },
            tableRows =
                points.map {
                    listOf(
                        hourLabel(it.hour),
                        formatInt(it.charges, locale),
                        formatNumber(it.energy, ENERGY_DECIMALS, locale),
                    )
                },
            isEmpty = points.isEmpty(),
        )
    }

    /** Web `tickFormatter={(h) => `${h}:00`}` — formats an hour-of-day as a wall-clock tick. */
    fun hourLabel(hour: Int): String = "$hour:00"

    /**
     * Web `safe` (`@/components/charts`) / `safeNumber` (`@/lib/numberFormat`): a finite number passes
     * through, anything else (NaN, ±∞, null) becomes `0` so a sparse field never renders `NaN`.
     */
    fun safeNumber(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /**
     * Web `fmtNumber(v, decimals)` — `safeNumber(v).toLocaleString(locale, {min/maxFractionDigits})`.
     * Groups thousands and rounds half away from zero so the output matches ECMAScript
     * `Intl.NumberFormat` (`halfExpand`) rather than Java's default banker's rounding (HALF_EVEN).
     */
    fun formatNumber(
        value: Double?,
        decimals: Int,
        locale: Locale,
    ): String =
        NumberFormat
            .getNumberInstance(locale)
            .apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                isGroupingUsed = true
                roundingMode = RoundingMode.HALF_UP
            }.format(safeNumber(value))

    /** Web `fmtInt(v)` = `fmtNumber(v, 0)`. */
    fun formatInt(
        value: Double?,
        locale: Locale,
    ): String = formatNumber(value, 0, locale)

    /** Web `formatCurrency(amount, decimals)` = `${currencySymbol}${fmtNumber(amount, decimals)}`. */
    fun formatCurrency(
        value: Double?,
        currencySymbol: String,
        decimals: Int,
        locale: Locale,
    ): String = currencySymbol + formatNumber(value, decimals, locale)

    /**
     * The web `stats ? fmtNumber(safe(avg), decimals) : '—'` tile rule: a `null` average (the `*_stats`
     * object was absent) renders the em dash; otherwise the average is `safe`-guarded and grouped.
     */
    fun formatStatAvg(
        avg: Double?,
        decimals: Int,
        locale: Locale,
    ): String = if (avg == null) CHARGING_EM_DASH else formatNumber(avg, decimals, locale)

    private const val ENERGY_DECIMALS = 1
    private const val CURRENCY_DECIMALS = 2
    private const val POWER_DECIMALS = 1
    private const val DURATION_DECIMALS = 0
    private const val EFFICIENCY_DECIMALS = 1
    private const val PERCENT_SCALE = 100.0
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CHARGING_TAB_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordChargingTabOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CHARGING_TAB_SLUG))
}
