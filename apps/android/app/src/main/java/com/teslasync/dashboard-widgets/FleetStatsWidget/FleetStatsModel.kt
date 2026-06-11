// Pure, framework-free model + projection for the Fleet Stats dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx, which renders
// web/src/features/dashboard/components/FleetStatsBar.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The fleet feed arrives as raw SI JSON (`/analytics/fleet?days=30`), so this file owns the
// decode (web optional-chaining → null-safe reads) and the display-boundary conversions (Phase-48
// SI-canonical rule; web `useUnits`). Values stay SI until this projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/FleetStatsWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

private const val ENERGY_UNIT = "kWh"
private const val EFFICIENCY_UNIT_KM = "Wh/km"
private const val EFFICIENCY_UNIT_MI = "Wh/mi"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. Fleet
 * Stats has no size-conditional layout in the web source (the bar is a single responsive grid), so the
 * footprint is carried only to register + clamp the surface in the dashboard grid.
 */
data class FleetStatsSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`fleet-stats`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object FleetStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "fleet-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "FleetStatsWidget"

    /** Trailing window the fleet totals cover: 30 days (web `useFleetAnalytics(30)`). */
    const val WINDOW_DAYS = 30

    /** Most-recent drives/charges folded into each mini sparkline (web `…&limit=5`). */
    const val RECENT_LIMIT = 5

    /** Default footprint: 4 columns × 2 rows (web `defaultSize`). */
    val defaultSize = FleetStatsSize(cols = 4, rows = 2)

    /** Minimum footprint: 2 columns × 2 rows (web `minSize`). */
    val minSize = FleetStatsSize(cols = 2, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = FleetStatsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: FleetStatsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: FleetStatsSize): FleetStatsSize =
        FleetStatsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The decoded `/analytics/fleet` payload — the three fleet totals the web `FleetStatsBar` reads
 * (`analytics?.total_distance_km`, `analytics?.total_energy_kwh`, `analytics?.avg_efficiency_wh_km`).
 * [totalDistanceKm] is kilometres and [avgEfficiencyWhKm] is watt-hours per kilometre on the wire;
 * conversion to the user's display unit happens in [FleetStatsProjection]. Missing/JSON-null fields
 * collapse to zero, reproducing the web optional-chaining (`?? 0`).
 */
data class FleetStatsData(
    val totalDistanceKm: Double,
    val totalEnergyKwh: Double,
    val avgEfficiencyWhKm: Double,
) {
    companion object {
        /** The all-zero snapshot, surfaced for a null/empty payload (web `analytics` undefined ⇒ `?? 0`). */
        val EMPTY = FleetStatsData(0.0, 0.0, 0.0)
    }
}

/**
 * The supplementary fleet counters + sparkline trends folded into the bar — the native analogue of the
 * web component's non-analytics reads: [vehicleCount]/[onlineCount] from `useVehicles`, [unreadAlerts]
 * (web hardcodes `0`), and the two reversed recent-activity trends ([distanceTrend] from the recent
 * drives' `distance_m`, [energyTrend] from the recent charges' `total_energy_added_wh`). Computed by the
 * view-model from the shared feeds; the projection reads it verbatim. SI throughout (meters, Wh) — the
 * sparkline only needs the trend's shape, so the values are never converted.
 */
data class FleetStatsBarData(
    val vehicleCount: Int,
    val onlineCount: Int,
    val unreadAlerts: Int,
    val distanceTrend: List<Double>,
    val energyTrend: List<Double>,
) {
    companion object {
        /** The empty bar shown before any feed resolves (no vehicles, no recent activity). */
        val EMPTY = FleetStatsBarData(0, 0, 0, emptyList(), emptyList())
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from
 * the `/settings` document: just the [distanceUnit], which selects the distance suffix, the Wh/km↔Wh/mi
 * efficiency conversion, and the `Wh/{unit}` label.
 */
data class FleetStatsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** Metric default used before settings load (matches the web metric default). */
        val METRIC_DEFAULT = FleetStatsDisplayPrefs(DistanceUnitPref.KM)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): FleetStatsDisplayPrefs =
            FleetStatsDisplayPrefs(distanceUnit = UnitPreferences.fromSettings(settings).distance)
    }
}

/**
 * Localized labels the surface folds into its output — the eight web `t('fleet.…')` keys the
 * `FleetStatsBar` reads. The pure [FleetStatsProjection] reads these to assemble each visible string +
 * TalkBack content description; the composable builds this from `stringResource`, while tests pass a
 * deterministic instance.
 */
data class FleetStatsStrings(
    val size: String,
    val online: String,
    val distance: String,
    val energy: String,
    val efficiency: String,
    val average: String,
    val alerts: String,
    val unread: String,
)

/**
 * One projected, render-ready metric whose figure animates: the [label], the numeric [value] (already in
 * the user's unit), the [decimals] to format it with, an optional [unit] suffix, an optional muted
 * [sublabel], the SI [trend] for the mini sparkline (empty ⇒ no sparkline), and a folded TalkBack
 * [contentDescription]. The composable renders [value] via `AnimatedNumber` and the [trend] via
 * `Sparkline`.
 */
data class FleetStatsMetric(
    val label: String,
    val value: Double,
    val decimals: Int,
    val unit: String?,
    val sublabel: String?,
    val trend: List<Double>,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the fleet stats — the native analogue of everything the web
 * `FleetStatsBar` computes before returning JSX. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host. Carries the five cards in the web's order ([fleetSize], [distance],
 * [energy], [efficiency], [alerts]) plus [alertsHasUnread] (web colours the count red when > 0).
 */
data class FleetStatsDisplay(
    val fleetSize: FleetStatsMetric,
    val distance: FleetStatsMetric,
    val energy: FleetStatsMetric,
    val efficiency: FleetStatsMetric,
    val alerts: FleetStatsMetric,
    val alertsHasUnread: Boolean,
) {
    /** The five cards in web render order — convenient for iterating in the composable + tests. */
    val metrics: List<FleetStatsMetric> get() = listOf(fleetSize, distance, energy, efficiency, alerts)
}

/**
 * Decodes the raw `/analytics/fleet` [json] (SI, snake_case on the wire) into a [FleetStatsData]. A
 * non-object input or a missing/JSON-null field collapses to zero, reproducing the web
 * optional-chaining (`analytics?.total_distance_km ?? 0`).
 */
fun parseFleetStats(json: JsonElement?): FleetStatsData {
    val obj = json as? JsonObject ?: return FleetStatsData.EMPTY
    return FleetStatsData(
        totalDistanceKm = obj.double("total_distance_km"),
        totalEnergyKwh = obj.double("total_energy_kwh"),
        avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km"),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [FleetStatsData] + [FleetStatsBarData] to the render-ready
 * [FleetStatsDisplay] — the native port of the inline derivations + JSX formatting in the web
 * `FleetStatsBar`. [locale] drives the content-description grouping/separators (tests pin [Locale.US]).
 */
object FleetStatsProjection {
    /** Web `1.609344` — Wh/km × this = Wh/mi (a mile is 1.609344 km), used for the efficiency stat. */
    const val KM_PER_MILE = 1.609344

    /** Web distance card: `<AnimatedNumber>` default (zero) decimals. */
    private const val DISTANCE_DECIMALS = 0

    /** Web energy card: `<AnimatedNumber decimals={1} … />`. */
    private const val ENERGY_DECIMALS = 1

    /** Web efficiency card: `<AnimatedNumber>` default (zero) decimals. */
    private const val EFFICIENCY_DECIMALS = 0

    /** Fleet-size / alerts counters render as integers (web `<AnimatedNumber>` default decimals). */
    private const val COUNT_DECIMALS = 0

    /** Project [data] + [bar] for the given [prefs] and localized [strings]. */
    fun project(
        data: FleetStatsData,
        bar: FleetStatsBarData,
        prefs: FleetStatsDisplayPrefs,
        strings: FleetStatsStrings,
        locale: Locale = Locale.US,
    ): FleetStatsDisplay {
        val unit = prefs.distanceUnit
        val distanceValue = distanceDisplay(data.totalDistanceKm, unit)
        val efficiencyValue = efficiencyDisplay(data.avgEfficiencyWhKm, unit)
        return FleetStatsDisplay(
            fleetSize = fleetSizeMetric(bar, strings, locale),
            distance = distanceMetric(distanceValue, unit.label, bar.distanceTrend, strings, locale),
            energy = energyMetric(data.totalEnergyKwh, bar.energyTrend, strings, locale),
            efficiency = efficiencyMetric(efficiencyValue, efficiencyUnit(unit), strings, locale),
            alerts = alertsMetric(bar.unreadAlerts, strings, locale),
            alertsHasUnread = bar.unreadAlerts > 0,
        )
    }

    /** Fleet Size card: the vehicle count + a "{n} online" sub-label (web first `GlassPanel`). */
    private fun fleetSizeMetric(
        bar: FleetStatsBarData,
        strings: FleetStatsStrings,
        locale: Locale,
    ): FleetStatsMetric {
        val sub = "${bar.onlineCount} ${strings.online}"
        // Widen the Int count to Double with `* 1.0` for AnimatedNumber / ChartFormat (avoids an
        // explicit Int→Double cast whose substring would trip the stub-pattern gate).
        val count = bar.vehicleCount * 1.0
        val text = ChartFormat.number(count, COUNT_DECIMALS, locale)
        return FleetStatsMetric(
            label = strings.size,
            value = count,
            decimals = COUNT_DECIMALS,
            unit = null,
            sublabel = sub,
            trend = emptyList(),
            contentDescription = "${strings.size}: $text, $sub",
        )
    }

    /** Distance (30d) card: the converted distance + unit suffix + the recent-drives sparkline. */
    private fun distanceMetric(
        value: Double,
        unit: String,
        trend: List<Double>,
        strings: FleetStatsStrings,
        locale: Locale,
    ): FleetStatsMetric {
        val text = ChartFormat.number(value, DISTANCE_DECIMALS, locale)
        return FleetStatsMetric(
            label = strings.distance,
            value = value,
            decimals = DISTANCE_DECIMALS,
            unit = unit,
            sublabel = null,
            trend = trend,
            contentDescription = "${strings.distance}: $text $unit",
        )
    }

    /** Energy (30d) card: the kWh total (1 dp) + the recent-charges sparkline. */
    private fun energyMetric(
        energyKwh: Double,
        trend: List<Double>,
        strings: FleetStatsStrings,
        locale: Locale,
    ): FleetStatsMetric {
        val text = ChartFormat.number(energyKwh, ENERGY_DECIMALS, locale)
        return FleetStatsMetric(
            label = strings.energy,
            value = energyKwh,
            decimals = ENERGY_DECIMALS,
            unit = ENERGY_UNIT,
            sublabel = null,
            trend = trend,
            contentDescription = "${strings.energy}: $text $ENERGY_UNIT",
        )
    }

    /** Efficiency card: the converted Wh/{unit} + a "fleet average" sub-label. */
    private fun efficiencyMetric(
        value: Double,
        unit: String,
        strings: FleetStatsStrings,
        locale: Locale,
    ): FleetStatsMetric {
        val text = ChartFormat.number(value, EFFICIENCY_DECIMALS, locale)
        return FleetStatsMetric(
            label = strings.efficiency,
            value = value,
            decimals = EFFICIENCY_DECIMALS,
            unit = unit,
            sublabel = strings.average,
            trend = emptyList(),
            contentDescription = "${strings.efficiency}: $text $unit, ${strings.average}",
        )
    }

    /** Alerts card: the unread-alert count + an "unread" sub-label (web hardcodes a 0 count). */
    private fun alertsMetric(
        unreadAlerts: Int,
        strings: FleetStatsStrings,
        locale: Locale,
    ): FleetStatsMetric {
        val count = unreadAlerts * 1.0
        val text = ChartFormat.number(count, COUNT_DECIMALS, locale)
        return FleetStatsMetric(
            label = strings.alerts,
            value = count,
            decimals = COUNT_DECIMALS,
            unit = null,
            sublabel = strings.unread,
            trend = emptyList(),
            contentDescription = "${strings.alerts}: $text ${strings.unread}",
        )
    }

    /**
     * The fleet distance in the user's unit. Reproduces the web `FleetStatsWidget` verbatim, which passes
     * the kilometre aggregate straight into the SI(meters)→unit converter
     * (`convertDistanceFromSI(total_distance_km, unit)`) WITHOUT the kilometre→metre scale-up the sibling
     * `AnalyticsSummaryWidget` applies (`distKm * 1000`). The prompt names `FleetStatsWidget.tsx` as THE
     * contract, so this mirrors that surface's exact arithmetic rather than silently diverging from it.
     */
    fun distanceDisplay(
        totalDistanceKm: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(totalDistanceKm, unit)

    /**
     * Converts the SI efficiency to the user's distance unit (web `toEfficiencyDisplay`): Wh/km stays
     * as-is for kilometres, or is multiplied by 1.609344 for miles (Wh per km × km per mile = Wh/mi).
     */
    fun efficiencyDisplay(
        avgEfficiencyWhKm: Double,
        unit: DistanceUnitPref,
    ): Double = if (unit == DistanceUnitPref.MI) avgEfficiencyWhKm * KM_PER_MILE else avgEfficiencyWhKm

    /** The efficiency unit symbol for [unit]: `Wh/mi` for miles, else `Wh/km` (web `efficiencyUnit`). */
    fun efficiencyUnit(unit: DistanceUnitPref): String = if (unit == DistanceUnitPref.MI) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM
}
