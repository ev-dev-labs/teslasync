// Pure, framework-free model + projection for the analytics MileagePage surface — the native analogue of
// everything the web page derives via `useMemo` before it returns JSX
// (web/src/features/analytics/pages/MileagePage.tsx, the daily/monthly distance tracker). No Compose, no
// Android framework, no HTTP lives here: every type is exercised off-device in the
// `:app:testDebugUnitTest` gate, keeping the composable a thin render layer.
//
// The three feeds arrive as the raw verbatim server JSON the shared S8 AnalyticsStore already exposes
// (`GET /mileage/stats` ▸ mileageStats, `GET /mileage/daily` ▸ dailyMileage, `GET /mileage/monthly` ▸
// monthlyMileage). Distances are kilometres on the wire (the backend SELECT list already converted from
// SI metres), so this file owns the null-safe decode (web optional-chaining → guarded reads) plus the
// display-boundary km→display-unit conversion (Phase-48 SI-canonical rule; web `useUnits` +
// `convertDistanceFromSI`). The four summary metrics, the odometer area series, the daily-distance bar
// series, and the monthly-summary table rows are all projected here — exactly the web `useMemo` blocks.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/analytics — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path —
// exactly as the sibling admin + feature-view surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.mileage

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/** 1 km = 1000 m — scales the backend's kilometre rollups to SI metres for [convertDistanceFromSI]. */
private const val METERS_PER_KM = 1000.0

/** Rolling-month window the daily average is taken over (web `last_30d_km / 30`). */
private const val DAYS_PER_MONTH = 30.0

/** Days per year — the web annual projection `dailyAvgKm * 365`. */
private const val DAYS_PER_YEAR = 365.0

/** Integer metric precision (web `fmtInt`): total distance / drives / annual projection. */
private const val INT_DECIMALS = 0

/** One-decimal metric precision (web `fmtNumber` default): the daily average + table distances. */
private const val DECIMAL_DECIMALS = 1

/**
 * Canonical metadata for this surface. The web page is a top-level analytics route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG]
 * emitted with the one-shot `view.opened` event (P1/S11), and the fixed [DAILY_DAYS] window the web reads
 * (`useDailyMileage(activeId, 90)`).
 */
object MileagePageRegistration {
    /** The navigation destination id (Destinations.kt `page("mileage", "/mileage", …)`). */
    const val ROUTE_ID: String = "mileage"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/mileage"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MileagePage"

    /** Daily buckets requested — the web `useDailyMileage(activeId, 90)` window. */
    const val DAILY_DAYS: Int = 90
}

/**
 * The decoded `/mileage/stats` payload reduced to the three fields the web page reads (`lifetime_km`,
 * `last_30d_km`, `drive_count_lifetime`). Distances are kilometres on the wire; the daily-average +
 * annual projection happen in [MileageProjection]. Missing/JSON-null fields collapse to zero, exactly like
 * the web optional-chaining (`stats?.lifetime_km ?? 0`).
 */
data class MileageStatsData(
    val lifetimeKm: Double,
    val last30dKm: Double,
    val driveCountLifetime: Double,
) {
    companion object {
        /** The all-zero snapshot, surfaced for a null body / no resolved vehicle (web `stats: undefined`). */
        val EMPTY = MileageStatsData(lifetimeKm = 0.0, last30dKm = 0.0, driveCountLifetime = 0.0)
    }
}

/**
 * One decoded `/mileage/daily` bucket reduced to the three fields the web charts read: the [date]
 * ('YYYY-MM-DD'), the [totalKm] driven that day, and the optional [endOdometerKm] — null when no
 * qualifying drive recorded a final odometer reading (web filters those out of the odometer chart).
 */
data class DailyMileagePoint(
    val date: String,
    val totalKm: Double,
    val endOdometerKm: Double?,
)

/**
 * One decoded `/mileage/monthly` bucket reduced to the three fields the web table reads: the [yearMonth]
 * label ('YYYY-MM'), the month's [totalKm], and the [driveCount] (used for the per-drive distance column).
 */
data class MonthlyMileageRow(
    val yearMonth: String,
    val totalKm: Double,
    val driveCount: Double,
)

/**
 * The combined, decoded mileage payload the page renders — the native analogue of the web page's three
 * hook results folded together. Pure data (no Compose / Android types) so the projection is unit-tested
 * without a UI host.
 *
 * [vehicleResolved] mirrors the web `if (vehicleId == null) return <NoVehicleSelected />` guard: false when
 * the fleet is empty / no vehicle is selected, which drives the page-level empty surface. When false the
 * stats / daily / monthly collections are empty.
 */
data class MileageData(
    val vehicleResolved: Boolean,
    val stats: MileageStatsData,
    val daily: List<DailyMileagePoint>,
    val monthly: List<MonthlyMileageRow>,
) {
    /** Page-level empty gate: no resolvable vehicle ⇒ render the friendly empty surface, never a blank page. */
    val isEmpty: Boolean get() = !vehicleResolved

    companion object {
        /** The "no vehicle" snapshot, surfaced when the fleet is empty / nothing is selected. */
        val EMPTY =
            MileageData(
                vehicleResolved = false,
                stats = MileageStatsData.EMPTY,
                daily = emptyList(),
                monthly = emptyList(),
            )

        /**
         * Decodes the three raw feeds into a [MileageData]. Each is read null-safely (web optional-chaining):
         * a non-object stats body collapses to [MileageStatsData.EMPTY]; non-array daily/monthly bodies
         * collapse to empty lists (web `data ?? []`). [vehicleResolved] is threaded from the view-model so a
         * resolved-but-dataless vehicle still renders content (all-zero metrics + per-panel empty states),
         * distinct from the no-vehicle empty page.
         */
        fun from(
            statsJson: JsonElement?,
            dailyJson: JsonElement?,
            monthlyJson: JsonElement?,
            vehicleResolved: Boolean = true,
        ): MileageData =
            MileageData(
                vehicleResolved = vehicleResolved,
                stats = parseMileageStats(statsJson),
                daily = parseDailyMileage(dailyJson),
                monthly = parseMonthlyMileage(monthlyJson),
            )
    }
}

/** Decodes the raw `/mileage/stats` [json] (kilometre rollups, snake_case) into a [MileageStatsData]. */
fun parseMileageStats(json: JsonElement?): MileageStatsData {
    val obj = json as? JsonObject ?: return MileageStatsData.EMPTY
    return MileageStatsData(
        lifetimeKm = obj.double("lifetime_km"),
        last30dKm = obj.double("last_30d_km"),
        driveCountLifetime = obj.double("drive_count_lifetime"),
    )
}

/**
 * Decodes the raw `/mileage/daily` [json] — the `days` array the shared repository already unwraps — into a
 * list of [DailyMileagePoint]. A non-array input collapses to an empty list (web `data ?? []`); each entry
 * is read null-safely (`date` missing ⇒ "", `total_km` missing/JSON-null ⇒ 0.0, `end_odometer_km` JSON-null
 * stays null so the odometer chart can filter it out exactly like the web).
 */
fun parseDailyMileage(json: JsonElement?): List<DailyMileagePoint> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        (element as? JsonObject)?.let { obj ->
            DailyMileagePoint(
                date = obj.string("date"),
                totalKm = obj.double("total_km"),
                endOdometerKm = obj.doubleOrNull("end_odometer_km"),
            )
        }
    }
}

/**
 * Decodes the raw `/mileage/monthly` [json] — the `months` array the shared repository already unwraps —
 * into a list of [MonthlyMileageRow]. A non-array input collapses to an empty list (web `data ?? []`); each
 * entry is read null-safely (`year_month` missing ⇒ "", `total_km`/`drive_count` missing ⇒ 0).
 */
fun parseMonthlyMileage(json: JsonElement?): List<MonthlyMileageRow> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        (element as? JsonObject)?.let { obj ->
            MonthlyMileageRow(
                yearMonth = obj.string("year_month"),
                totalKm = obj.double("total_km"),
                driveCount = obj.double("drive_count"),
            )
        }
    }
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

/**
 * The localized labels the surface folds into its output — every visible literal the page renders. The pure
 * [MileageProjection] reads the table-column labels; the composable builds this from `stringResource`, while
 * tests pass a deterministic instance. Key names match the web `t(...)` keys (ADR-014).
 */
data class MileageStrings(
    val title: String,
    val subtitle: String,
    val totalDistance: String,
    val totalDrives: String,
    val dailyAvg: String,
    val annualProjection: String,
    val odometerOverTime: String,
    val odometer: String,
    val dailyDistance: String,
    val distance: String,
    val monthlySummary: String,
    val month: String,
    val drives: String,
    val distancePerDrive: String,
    val noEntries: String,
    val loadFailed: String,
    val retry: String,
)

/** Which leading glyph a summary metric card shows — mapped to an `ImageVector` at the Compose boundary. */
enum class MileageMetricIcon { Gauge, TrendingUp, Calendar, BarChart }

/** Which accent a summary metric card uses — mapped to a theme `Color` at the Compose boundary (ADR-005). */
enum class MileageMetricAccent { Cyan, Green, Purple }

/**
 * One projected, render-ready summary metric tile — the native analogue of a web `MetricCard`. Carries the
 * resolved [label], the already-formatted [value] (with its unit suffix), the [icon] marker, and the
 * [accent].
 */
data class MileageMetric(
    val label: String,
    val value: String,
    val icon: MileageMetricIcon,
    val accent: MileageMetricAccent,
)

/** One projected area-chart sample: a formatted x-axis [label] and the converted odometer [value]. */
data class OdometerSample(
    val label: String,
    val value: Double,
)

/** One projected bar-chart sample: a formatted x-axis [label] and the converted daily-distance [value]. */
data class DailyDistanceBar(
    val label: String,
    val value: Double,
)

/** One projected monthly-summary table row — every cell already formatted for display. */
data class MonthlySummaryRow(
    val month: String,
    val distance: String,
    val drives: String,
    val distancePerDrive: String,
)

/**
 * The fully projected, render-ready view of the page body — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. Carries the four summary metrics, the odometer area series, the daily-distance bar
 * series, the monthly-summary rows, and the per-panel empty gates.
 */
data class MileageDisplay(
    val metrics: List<MileageMetric>,
    val odometer: List<OdometerSample>,
    val daily: List<DailyDistanceBar>,
    val monthly: List<MonthlySummaryRow>,
    val distanceUnit: String,
    val odometerSeriesLabel: String,
    val dailySeriesLabel: String,
) {
    /** Web `odometerData.length === 0 ? <EmptyState /> : <chart />` — the odometer panel empty gate. */
    val hasOdometer: Boolean get() = odometer.isNotEmpty()

    /** Web `dailyData.length === 0 ? <EmptyState /> : <chart />` — the daily-distance panel empty gate. */
    val hasDaily: Boolean get() = daily.isNotEmpty()

    /** Whether the monthly-summary table has any rows (the DataTable shows its empty text otherwise). */
    val hasMonthly: Boolean get() = monthly.isNotEmpty()
}

/**
 * Pure projection from a decoded [MileageData] to the render-ready [MileageDisplay] — the native port of the
 * inline `useMemo` derivations + JSX formatting in the web source. SI kilometres are scaled to metres and
 * converted to the user's distance unit at this display boundary (web `fromKm` =
 * `convertDistanceFromSI(km * 1000, unit)`); numbers are formatted via the shared [ChartFormat] (web
 * `fmtNumber`/`fmtInt`). [locale] drives grouping/separators (tests pin [Locale.US]).
 */
object MileageProjection {
    /** Project [data] using the user's display [prefs] (distance unit), localized [strings], and [locale]. */
    fun project(
        data: MileageData,
        prefs: UnitPref,
        strings: MileageStrings,
        locale: Locale = Locale.US,
    ): MileageDisplay {
        val unit = prefs.distance
        val unitLabel = unit.label
        return MileageDisplay(
            metrics = metrics(data.stats, unit, unitLabel, strings, locale),
            odometer = odometerSamples(data.daily, unit, locale),
            daily = dailyBars(data.daily, unit, locale),
            monthly = monthlyRows(data.monthly, unit, locale),
            distanceUnit = unitLabel,
            odometerSeriesLabel = "${strings.odometer} ($unitLabel)",
            dailySeriesLabel = "${strings.distance} ($unitLabel)",
        )
    }

    /** Total lifetime distance in the user's display unit (web `fromKm(stats.lifetime_km)`). */
    fun totalDistanceDisplay(
        stats: MileageStatsData,
        unit: DistanceUnitPref,
    ): Double = fromKm(stats.lifetimeKm, unit)

    /** Daily average over the last 30 days in the user's display unit (web `fromKm(last_30d_km / 30)`). */
    fun dailyAvgDisplay(
        stats: MileageStatsData,
        unit: DistanceUnitPref,
    ): Double = fromKm(stats.last30dKm / DAYS_PER_MONTH, unit)

    /** Annual projection at the current daily average (web `fromKm((last_30d_km / 30) * 365)`). */
    fun annualProjectionDisplay(
        stats: MileageStatsData,
        unit: DistanceUnitPref,
    ): Double = fromKm((stats.last30dKm / DAYS_PER_MONTH) * DAYS_PER_YEAR, unit)

    private fun metrics(
        stats: MileageStatsData,
        unit: DistanceUnitPref,
        unitLabel: String,
        strings: MileageStrings,
        locale: Locale,
    ): List<MileageMetric> =
        listOf(
            MileageMetric(
                label = strings.totalDistance,
                value = "${ChartFormat.number(totalDistanceDisplay(stats, unit), INT_DECIMALS, locale)} $unitLabel",
                icon = MileageMetricIcon.Gauge,
                accent = MileageMetricAccent.Cyan,
            ),
            MileageMetric(
                label = strings.totalDrives,
                value = ChartFormat.number(stats.driveCountLifetime, INT_DECIMALS, locale),
                icon = MileageMetricIcon.TrendingUp,
                accent = MileageMetricAccent.Green,
            ),
            MileageMetric(
                label = strings.dailyAvg,
                value = "${ChartFormat.number(dailyAvgDisplay(stats, unit), DECIMAL_DECIMALS, locale)} $unitLabel",
                icon = MileageMetricIcon.Calendar,
                accent = MileageMetricAccent.Purple,
            ),
            MileageMetric(
                label = strings.annualProjection,
                value = "${ChartFormat.number(annualProjectionDisplay(stats, unit), INT_DECIMALS, locale)} $unitLabel",
                icon = MileageMetricIcon.BarChart,
                accent = MileageMetricAccent.Cyan,
            ),
        )

    /**
     * Odometer-over-time samples (web `odometerData`): days whose `end_odometer_km` is null are filtered out
     * so the line never dives to zero, then each surviving reading is converted to the display unit.
     */
    private fun odometerSamples(
        daily: List<DailyMileagePoint>,
        unit: DistanceUnitPref,
        locale: Locale,
    ): List<OdometerSample> =
        daily
            .filter { it.endOdometerKm != null }
            .map { point ->
                OdometerSample(label = formatDayLabel(point.date, locale), value = fromKm(point.endOdometerKm ?: 0.0, unit))
            }

    /** Daily-distance bars (web `dailyData`): each day's `total_km` converted to the display unit. */
    private fun dailyBars(
        daily: List<DailyMileagePoint>,
        unit: DistanceUnitPref,
        locale: Locale,
    ): List<DailyDistanceBar> =
        daily.map { point ->
            DailyDistanceBar(label = formatDayLabel(point.date, locale), value = fromKm(point.totalKm, unit))
        }

    /**
     * Monthly-summary rows (web `monthlyRows`): the month label, the converted distance, the drive count, and
     * the per-drive distance (`drives > 0 ? fromKm(total_km / drives) : 0`). Distance + per-drive are
     * formatted to one decimal (web `fmtNumber`); drives to a grouped integer (web `fmtInt`).
     */
    private fun monthlyRows(
        monthly: List<MonthlyMileageRow>,
        unit: DistanceUnitPref,
        locale: Locale,
    ): List<MonthlySummaryRow> =
        monthly.map { row ->
            val perDrive = if (row.driveCount > 0.0) fromKm(row.totalKm / row.driveCount, unit) else 0.0
            MonthlySummaryRow(
                month = row.yearMonth,
                distance = ChartFormat.number(fromKm(row.totalKm, unit), DECIMAL_DECIMALS, locale),
                drives = ChartFormat.number(row.driveCount, INT_DECIMALS, locale),
                distancePerDrive = ChartFormat.number(perDrive, DECIMAL_DECIMALS, locale),
            )
        }

    /**
     * Backend `/mileage/{stats,daily,monthly}` returns kilometres; the web page multiplies by 1000 before
     * calling `convertDistanceFromSI`, which expects metres. This reproduces that scaling exactly.
     */
    private fun fromKm(
        km: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(km * METERS_PER_KM, unit)
}

/**
 * Formats a 'YYYY-MM-DD' bucket key to its short display label (e.g. `"2026-04-04"` → `"Apr 4, 2026"`) — the
 * native port of the web `formatDate(d.date)`. A malformed key falls back to the raw input, so a bad row
 * never throws or blanks the axis.
 */
fun formatDayLabel(
    iso: String,
    locale: Locale = Locale.US,
): String =
    try {
        LocalDate.parse(iso).format(DateTimeFormatter.ofPattern("MMM d, yyyy", locale))
    } catch (_: DateTimeParseException) {
        iso
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no mileage payload. */
internal fun recordMileagePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MileagePageRegistration.SLUG))
}
