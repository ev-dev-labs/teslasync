// Pure, framework-free model + projections for the StatisticsPage analytics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/analytics/pages/StatisticsPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection and the shared-core Resource/units), so the composable stays a thin render layer and all of this
// is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the five raw SI JSON envelopes the page reads —
// the primary `/analytics/period-stats` totals, plus the secondary `/analytics/battery-health`, `/mileage/stats`,
// `/vehicle-states/summary` and `/analytics/fleet` feeds — into typed, null-safe models (web optional-chaining →
// null-safe reads); (2) the display-boundary unit + currency derivation from the `/settings` document
// ([StatisticsDisplayPrefs], web `useUnits`/`useFormatting`); and (3) the per-field formatting + derivations the
// panels call (distance SI→display conversion via the shared converter, Wh/km→Wh/mi efficiency scaling, currency,
// grouped numbers — web `fromKm`/`whPerKmToDisplay`/`fmtNumber`/`fmtInt`/`formatCurrency`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the period totals report distance in SI kilometres and
// efficiency in SI Wh/km (per the web page's own comment + internal/api/periodstats/handler.go), and the fleet
// comparison reports per-vehicle distance in SI kilometres; all of them are bridged to the SI base (metres) before
// conversion via the shared [convertDistanceFromSI] — exactly as the web `fromKm` does. Energy (kWh), cost, CO₂ (kg)
// and counts are raw on the wire and rendered verbatim, mirroring the web.
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web guards its body on the truthiness of
// the loaded period payload (`stats ?`) and each section on the truthiness of its own feed. The native surface instead
// routes an all-zero / absent payload to the empty surface (via the per-model `hasData`/emptiness gate) so each section
// shows its friendly empty-state composable rather than a grid of zeros — the same gate the sibling LifetimeStatsPage
// uses, and what makes the four declared data states genuinely reachable.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling LifetimeStatsPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.statistics

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.util.Locale

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency / number fraction digits (web `_globalPrecision` + `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance figures floor on before conversion (web `METERS_PER_KM`). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km — the Wh/km → Wh/mi scale the web `whPerKmToDisplay` applies for an imperial pref. */
private const val KM_PER_MILE = 1.609344

/** Per-cell minimum for a percentage denominator so an all-zero state set never divides by zero (web `Math.max(total, 1)`). */
private const val MIN_DENOMINATOR = 1.0

/** The 30-day window the mileage daily-average + yearly-projection derive from (web `last_30d_km / 30`). */
private const val DAYS_IN_WINDOW = 30.0

/** Days per year for the mileage yearly projection (web `* 365`). */
private const val DAYS_IN_YEAR = 365.0

/** Whole percent (web `* 100`). */
private const val PERCENT = 100.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `StatisticsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("statistics", "/statistics", …)`, so the host binds this surface to that destination (and its `/statistics`
 * deep link) without the nav module depending on it.
 */
object StatisticsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("statistics", "/statistics", …)`). */
    const val ROUTE_ID: String = "statistics"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/statistics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "StatisticsPage"
}

/**
 * The decoded `/analytics/period-stats` payload — the native analogue of the web `PeriodStats` interface the five
 * top cards + three averages read (internal/api/periodstats/handler.go). [totalDistanceKm] + [avgEfficiencyWhKm]
 * are SI (km, Wh/km); [energyUsedKwh], [totalCost] and [co2SavedKg] are raw on the wire. Missing / JSON-null fields
 * collapse to zero, exactly like the web optional reads.
 */
data class StatisticsPeriodStats(
    val totalDistanceKm: Double,
    val totalDrives: Double,
    val energyUsedKwh: Double,
    val avgEfficiencyWhKm: Double,
    val totalCost: Double,
    val co2SavedKg: Double,
) {
    /**
     * Whether any meaningful total has accrued. A brand-new / unselected vehicle with no drives, distance, energy or
     * cost routes to the friendly empty surface (web `noData`) rather than a grid of zeros.
     */
    val hasData: Boolean
        get() = totalDrives > 0.0 || totalDistanceKm > 0.0 || energyUsedKwh > 0.0 || totalCost > 0.0

    /** Average drive distance in SI km (web `total_distance / total_drives`, guarded against a zero divisor). */
    val avgDriveDistanceKm: Double
        get() = if (totalDrives > 0.0) totalDistanceKm / totalDrives else 0.0

    /** Cost per SI km, or `null` when no distance has accrued so the panel shows the em dash (web `> 0 ? … : '—'`). */
    val costPerKm: Double?
        get() = if (totalDistanceKm > 0.0) totalCost / totalDistanceKm else null

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: StatisticsPeriodStats = StatisticsPeriodStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * The decoded `/analytics/battery-health` payload the battery panel reads (web `BatteryHealthAnalytics`).
 * [estimatedCapacityKwh] is kWh, [degradationRateYr] is %/yr, [batteryAgeMonths] is whole months; [currentSoh] is a
 * 0–100 percentage feeding the radial gauge.
 */
data class StatisticsBatteryHealth(
    val currentSoh: Double,
    val estimatedCapacityKwh: Double,
    val degradationRateYr: Double,
    val totalCycles: Double,
    val batteryAgeMonths: Int,
) {
    /** Whether the analytics feed carries a usable battery snapshot (web renders the panel only for a truthy payload). */
    val hasData: Boolean
        get() = currentSoh > 0.0 || estimatedCapacityKwh > 0.0 || totalCycles > 0.0 || batteryAgeMonths > 0

    companion object {
        val EMPTY: StatisticsBatteryHealth = StatisticsBatteryHealth(0.0, 0.0, 0.0, 0.0, 0)
    }
}

/**
 * The decoded `/mileage/stats` payload the mileage panel reads (web `MileageStats`). [lifetimeKm] + [last30dKm] are
 * SI kilometres; [driveCountLifetime] is a count. The daily-average + yearly-projection are derived here exactly as
 * the web does.
 */
data class StatisticsMileage(
    val lifetimeKm: Double,
    val last30dKm: Double,
    val driveCountLifetime: Double,
) {
    /** SI km/day over the trailing window (web `(last_30d_km ?? 0) / 30`). */
    val dailyAvgKm: Double get() = last30dKm / DAYS_IN_WINDOW

    /** SI km projected over a year from the trailing daily average (web `((last_30d_km ?? 0) / 30) * 365`). */
    val yearlyProjectionKm: Double get() = dailyAvgKm * DAYS_IN_YEAR

    /** Whether any mileage has accrued (else the friendly empty surface, web `mileage ? … :` empty). */
    val hasData: Boolean get() = lifetimeKm > 0.0 || driveCountLifetime > 0.0 || last30dKm > 0.0

    companion object {
        val EMPTY: StatisticsMileage = StatisticsMileage(0.0, 0.0, 0.0)
    }
}

/** One decoded `/vehicle-states/summary` row (web `StateSummary`) — a [state] name + its accrued [totalMinutes]. */
data class StatisticsStateRow(
    val state: String,
    val totalMinutes: Double,
)

/**
 * One state-distribution slice ready to draw: the [state] name, its [percent] share (0–100, rounded like the web
 * `Math.round((min / total) * 100)`), and a stable palette [colorIndex] so the slice + legend agree.
 */
data class StatisticsStateShare(
    val state: String,
    val percent: Int,
    val colorIndex: Int,
)

/**
 * One decoded `/analytics/fleet` `vehicle_comparison` row (web `FleetAnalytics.vehicle_comparison[]`). [name] is the
 * display label, [distanceKm] is SI kilometres, [energyKwh] is kWh — both converted/formatted at the render boundary.
 */
data class StatisticsVehicleComparison(
    val name: String,
    val distanceKm: Double,
    val energyKwh: Double,
)

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] (distance figures + the derived efficiency unit), the
 * [currencySymbol] (blank → "$"), the currency/number [precision] (web `decimal_precision`/`_globalPrecision`,
 * floored & non-negative, else 2), and the [locale] used for grouped-number formatting.
 */
data class StatisticsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The efficiency unit, mirroring the web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    val efficiencyUnit: String get() = if (distanceUnit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI km → the user's display distance (web `fromKm`: `convertDistanceFromSI(km * 1000, unit)`). */
    fun fromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** SI Wh/km → the user's display efficiency (web `whPerKmToDisplay`: `* 1.609344` for miles, else identity). */
    fun whPerKmToDisplay(whPerKm: Double): Double =
        if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)` with no decimals override). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [decimals]-digit grouped number in the user's locale. Defaults to the configured [precision].
     */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, decimals.coerceAtLeast(0))

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: StatisticsDisplayPrefs =
            StatisticsDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): StatisticsDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringField(KEY_CURRENCY_SYMBOL)?.trim()
            return StatisticsDisplayPrefs(
                distanceUnit = unit.distance,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * Decodes the raw `/analytics/period-stats` [json] (SI, snake_case on the wire) into a [StatisticsPeriodStats]. A
 * non-object input, a missing field, or a JSON-null field all collapse to zero — reproducing the web optional reads.
 */
fun parsePeriodStats(json: JsonElement?): StatisticsPeriodStats {
    val obj = json as? JsonObject ?: return StatisticsPeriodStats.EMPTY
    return StatisticsPeriodStats(
        totalDistanceKm = obj.double("total_distance"),
        totalDrives = obj.double("total_drives"),
        energyUsedKwh = obj.double("energy_used"),
        avgEfficiencyWhKm = obj.double("avg_efficiency"),
        totalCost = obj.double("total_cost"),
        co2SavedKg = obj.double("co2_saved"),
    )
}

/** Decodes the raw `/analytics/battery-health` [json] into a [StatisticsBatteryHealth], null-safe per field. */
fun parseBatteryHealth(json: JsonElement?): StatisticsBatteryHealth {
    val obj = json as? JsonObject ?: return StatisticsBatteryHealth.EMPTY
    return StatisticsBatteryHealth(
        currentSoh = obj.double("current_soh"),
        estimatedCapacityKwh = obj.double("estimated_capacity"),
        degradationRateYr = obj.double("degradation_rate_yr"),
        totalCycles = obj.double("total_cycles"),
        batteryAgeMonths = obj.int("battery_age_months"),
    )
}

/** Decodes the raw `/mileage/stats` [json] into a [StatisticsMileage], null-safe per field. */
fun parseMileage(json: JsonElement?): StatisticsMileage {
    val obj = json as? JsonObject ?: return StatisticsMileage.EMPTY
    return StatisticsMileage(
        lifetimeKm = obj.double("lifetime_km"),
        last30dKm = obj.double("last_30d_km"),
        driveCountLifetime = obj.double("drive_count_lifetime"),
    )
}

/**
 * Decodes the raw `/vehicle-states/summary` [json] array into [StatisticsStateRow]s. The web reads each row's accrued
 * minutes from `totalMin` (legacy camelCase wrapper) falling back to `total_min` (snake wire) — this reproduces both
 * so the share math stays correct whichever shape a replacement endpoint emits.
 */
fun parseStateRows(json: JsonElement?): List<StatisticsStateRow> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val state = obj.stringField("state") ?: return@mapNotNull null
        val minutes = obj.doubleOrNull("totalMin") ?: obj.double("total_min")
        StatisticsStateRow(state = state, totalMinutes = minutes)
    }
}

/**
 * Projects decoded [rows] into the percentage [StatisticsStateShare]s the pie + legend draw — the web `stateData`
 * derivation: each slice's percent is its minutes over the (≥1-floored) total, rounded to a whole percent, and the
 * slice keeps a stable position-based palette index.
 */
fun stateShares(rows: List<StatisticsStateRow>): List<StatisticsStateShare> {
    if (rows.isEmpty()) return emptyList()
    val total = rows.sumOf { it.totalMinutes }.coerceAtLeast(MIN_DENOMINATOR)
    return rows.mapIndexed { index, row ->
        StatisticsStateShare(
            state = row.state,
            percent = Math.round((row.totalMinutes / total) * PERCENT).toInt(),
            colorIndex = index,
        )
    }
}

/**
 * Decodes the raw `/analytics/fleet` [json] object's `vehicle_comparison` array into [StatisticsVehicleComparison]s —
 * the web `compData` source. A missing name falls back to `Vehicle {id}` (web `v.name ?? `Vehicle ${v.id}``).
 */
fun parseVehicleComparison(json: JsonElement?): List<StatisticsVehicleComparison> {
    val obj = json as? JsonObject ?: return emptyList()
    val array = obj["vehicle_comparison"] as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val name = row.stringField("name")?.takeIf { it.isNotBlank() }
            ?: row.intOrNull("id")?.let { "Vehicle $it" }
            ?: return@mapNotNull null
        StatisticsVehicleComparison(
            name = name,
            distanceKm = row.double("distance"),
            energyKwh = row.double("energy"),
        )
    }
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.intOrNull(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [StatisticsPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page
 * calls it from its first composition. Carries no vehicle id, distance, cost or battery payload.
 */
fun recordStatisticsOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to StatisticsPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
