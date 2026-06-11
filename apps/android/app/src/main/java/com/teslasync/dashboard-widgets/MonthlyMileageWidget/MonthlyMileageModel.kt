// Pure, framework-free model + projection for the Monthly Mileage dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx). No Compose, no Android view types, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The widget composes three feeds — the enrolled-vehicle list (only to
// resolve the default vehicle, web `vehicles?.[0]?.id`), the per-vehicle `/mileage/monthly` buckets
// (web `useMonthlyMileage`, an array of `{year_month, total_km}`), and the settings document
// (web `useUnits`, for the distance unit). This file owns the array decode (web optional-chaining →
// null-safe reads), the trailing-12-month slice + current-month flag, the display-boundary km→display
// distance conversion (Phase-48 SI-canonical rule; web `convertDistanceFromSI`), and the bar/stat
// projection. Distances stay in kilometres until the projection converts them.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MonthlyMileageWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.monthlymileage

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Clock
import java.time.YearMonth
import java.util.Locale

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test that drops the bar chart and renders the
 * summary stats only; [isWide] mirrors the web `size.cols >= 3` axis-tick toggle (Vico subsumes the
 * tick-density tuning, so it carries no separate native branch but is preserved for parity/clarity).
 */
data class MonthlyMileageSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): summary stats only, no chart. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three+ columns (web `size.cols >= 3`): the web widens the axis ticks. */
    val isWide: Boolean get() = cols >= 3
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`monthly-mileage`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object MonthlyMileageRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "monthly-mileage"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "MonthlyMileageWidget"

    /** Trailing window the chart covers: 12 months (web `items.slice(-12)`). */
    const val MAX_MONTHS = 12

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = MonthlyMileageSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize = MonthlyMileageSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = MonthlyMileageSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: MonthlyMileageSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MonthlyMileageSize): MonthlyMileageSize =
        MonthlyMileageSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from
 * the `/settings` document: just the [distanceUnit], which selects the SI metres→km/mi/ft conversion
 * and the unit label shown beside each stat / in the chart tooltip.
 */
data class MonthlyMileageDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** Metric default used before settings load (matches the web metric default). */
        val METRIC_DEFAULT = MonthlyMileageDisplayPrefs(DistanceUnitPref.KM)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): MonthlyMileageDisplayPrefs =
            MonthlyMileageDisplayPrefs(distanceUnit = UnitPreferences.fromSettings(settings).distance)
    }
}

/**
 * Localized labels the surface folds into its output — the five web `t('widget.monthlyMileage.…')` keys
 * the component reads. The pure [MonthlyMileageProjection] reads these to assemble each visible string;
 * the composable builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class MonthlyMileageStrings(
    val title: String,
    val noData: String,
    val thisMonth: String,
    val total12m: String,
    val distance: String,
)

/**
 * One decoded `/mileage/monthly` bucket reduced to the two fields the web component reads from each
 * entry: the [yearMonth] label ('YYYY-MM') and the month's [totalKm] driven distance (kilometres on the
 * wire). The other bucket fields (`drive_count`, `total_wh_consumed`, `avg_efficiency_wh_per_km`) are
 * not rendered by this surface, so — like the web — they are intentionally not decoded.
 */
data class MonthlyMileageBucket(
    val yearMonth: String,
    val totalKm: Double,
)

/**
 * The decoded monthly-mileage payload — the native analogue of the web `data` array. Pure data (no
 * Compose / Android types) so the projection is unit-tested without a UI host. [recentBuckets] is the
 * trailing-12 slice the web renders (web `items.slice(-12)`); [hasData] mirrors the web gate
 * `chartData.length > 0 && chartData.some(d => d.distance > 0)` — at least one of the last twelve
 * months recorded distance. The km→display conversion is monotonic in sign, so this gate is checked on
 * the raw kilometres and stays unit-independent.
 */
data class MonthlyMileageData(
    val buckets: List<MonthlyMileageBucket>,
) {
    /** The trailing-12-month window the chart + stats render (web `items.slice(-12)`). */
    val recentBuckets: List<MonthlyMileageBucket> get() = buckets.takeLast(MonthlyMileageRegistration.MAX_MONTHS)

    /** Web `hasData` — any of the last twelve months recorded a positive distance. */
    val hasData: Boolean get() = recentBuckets.any { it.totalKm > 0.0 }

    companion object {
        /** The empty snapshot, surfaced before data arrives or when no vehicle / no buckets resolve. */
        val EMPTY = MonthlyMileageData(emptyList())
    }
}

/**
 * One projected, render-ready chart bar — the native analogue of a web `BarDatum`. [month] is the short
 * three-letter label, [distance] is already converted to the user's unit, and [isCurrent] flags the
 * current calendar month (the web cyan highlight; every other bar renders faint).
 */
data class MileageBar(
    val month: String,
    val distance: Double,
    val isCurrent: Boolean,
)

/** A projected summary stat tile: a [label], an already-formatted [value], and its [unit] suffix. */
data class MileageStat(
    val label: String,
    val value: String,
    val unit: String,
)

/**
 * The fully projected, render-ready view of the widget body for one footprint — the native analogue of
 * everything the web component computes before returning JSX (`chartData`, `totalDistance`,
 * `currentMonthDistance`, the two `WidgetChartSummary` stats, and the `hasData` gate). Pure data (no
 * Compose types) so the projection is unit-tested without a UI host.
 */
data class MonthlyMileageDisplay(
    val hasData: Boolean,
    val bars: List<MileageBar>,
    val stats: List<MileageStat>,
    val currentMonthDistance: Double,
    val totalDistance: Double,
    val distanceUnit: String,
    val emptyMessage: String,
)

/**
 * The current calendar month key ('YYYY-MM') in the system default zone — the native port of the web
 * `currentMonthKey()` (`new Date()` → `${year}-${month}`). A [clock] seam lets tests pin a deterministic
 * "now"; production uses the system clock.
 */
fun currentMonthKey(clock: Clock = Clock.systemDefaultZone()): String = YearMonth.now(clock).toString()

/**
 * Formats a 'YYYY-MM' key to its short month label (e.g. `"2026-04"` → `"Apr"`) — the native port of the
 * web `shortMonth`. A malformed key (no month segment, or an out-of-range month) falls back to the raw
 * input, exactly like the web.
 */
fun shortMonth(iso: String): String {
    val index =
        iso
            .split('-')
            .getOrNull(1)
            ?.toIntOrNull()
            ?.minus(1)
    return if (index == null) iso else MONTH_NAMES.getOrNull(index) ?: iso
}

private val MONTH_NAMES =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/**
 * Decodes the raw `/mileage/monthly` [json] (the `months` array the shared repository already unwraps,
 * SI/snake_case on the wire) into a [MonthlyMileageData]. A non-array input (absent / JSON-null /
 * unexpected object) collapses to [MonthlyMileageData.EMPTY] (web `data ?? []`); each entry is read
 * null-safely (`year_month` missing ⇒ "", `total_km` missing or JSON-null ⇒ 0.0, reproducing web `?? 0`).
 */
fun parseMonthlyMileage(json: JsonElement?): MonthlyMileageData {
    val array = json as? JsonArray ?: return MonthlyMileageData.EMPTY
    return MonthlyMileageData(array.mapNotNull { element -> (element as? JsonObject)?.toBucket() })
}

private fun JsonObject.toBucket(): MonthlyMileageBucket =
    MonthlyMileageBucket(
        yearMonth = (this["year_month"] as? JsonPrimitive)?.contentOrNull ?: "",
        totalKm = (this["total_km"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
    )

/**
 * Pure projection from a decoded [MonthlyMileageData] to the render-ready [MonthlyMileageDisplay] — the
 * native port of the inline `useMemo` derivations + JSX formatting in the web source. Each month's
 * kilometres are turned into SI metres (web `total_km * 1000`) and converted to the user's display unit
 * via [convertDistanceFromSI]; the per-month total and the trailing-12 total are summed in display
 * units, and both stats are formatted as grouped integers (web `fmtInt`). [currentMonth] is the
 * 'YYYY-MM' key that flags the highlighted bar; [locale] drives the grouping/separators (tests pin
 * [Locale.US]).
 */
object MonthlyMileageProjection {
    /** Web `fmtInt(...)` — the stat values render as grouped integers (zero fraction digits). */
    const val STAT_DECIMALS = 0

    /** Web `total_km * 1000` — kilometres → SI metres for [convertDistanceFromSI]. */
    const val METERS_PER_KM = 1000.0

    /** Project [data] for the user's [prefs], localized [strings], and the current month key. */
    fun project(
        data: MonthlyMileageData,
        prefs: MonthlyMileageDisplayPrefs,
        strings: MonthlyMileageStrings,
        currentMonth: String = currentMonthKey(),
        locale: Locale = Locale.US,
    ): MonthlyMileageDisplay {
        val bars =
            data.recentBuckets.map { bucket ->
                MileageBar(
                    month = shortMonth(bucket.yearMonth),
                    distance = convertDistanceFromSI(bucket.totalKm * METERS_PER_KM, prefs.distanceUnit),
                    isCurrent = bucket.yearMonth.isNotEmpty() && bucket.yearMonth == currentMonth,
                )
            }
        val currentMonthDistance = bars.firstOrNull { it.isCurrent }?.distance ?: 0.0
        val totalDistance = bars.sumOf { it.distance }
        val unitLabel = prefs.distanceUnit.label
        val stats =
            if (data.hasData) {
                listOf(
                    MileageStat(strings.thisMonth, ChartFormat.number(currentMonthDistance, STAT_DECIMALS, locale), unitLabel),
                    MileageStat(strings.total12m, ChartFormat.number(totalDistance, STAT_DECIMALS, locale), unitLabel),
                )
            } else {
                emptyList()
            }
        return MonthlyMileageDisplay(
            hasData = data.hasData,
            bars = bars,
            stats = stats,
            currentMonthDistance = currentMonthDistance,
            totalDistance = totalDistance,
            distanceUnit = unitLabel,
            emptyMessage = strings.noData,
        )
    }
}
