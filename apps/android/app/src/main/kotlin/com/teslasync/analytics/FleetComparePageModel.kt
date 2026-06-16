// Pure, framework-free model + projections for the FleetComparePage analytics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/analytics/pages/FleetComparePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// units + serialization), so the composable stays a thin render layer and this logic is exercised off-device in
// the :app:testDebugUnitTest gate.
//
// The web page owns the concerns this file ports: (1) the local interaction state — the two selected vehicles +
// the persisted disambiguation-banner dismissal (web `useState`); (2) the raw `/drives/stats`, `/analytics/tco`
// and `/mileage/monthly` JSON decode (web optional-chaining → null-safe reads); (3) the lifetime comparison-table
// rows with the per-metric winner semantics (web `comparisonRows` + `getWinner`); (4) the overlaid monthly
// distance + drives-per-month chart series merged by year-month (web `monthlyChartData` / `drivesChartData`);
// (5) the per-vehicle current-status card projection (web `VehicleStatusCard`); and (6) the four key-highlight
// stat values. SI values stay SI until the display boundary converts them via the shared converters (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.fleetcompare

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatTemperature
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `FleetComparePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("fleetCompare", "/vehicle-comparison", …)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/vehicle-comparison` deep link) without the nav module depending on it.
 */
object FleetComparePageRegistration {
    /** The navigation destination id (Destinations.kt `page("fleetCompare", "/vehicle-comparison", …)`). */
    const val ROUTE_ID: String = "fleetCompare"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/vehicle-comparison"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "FleetComparePage"
}

// ── Interaction snapshot ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The page's local interaction snapshot — the union of the web component's `useState` cells: the two selected
 * vehicle ids (web `vehicleIdA` / `vehicleIdB`, carried as the raw string ids the selectors bind) and the
 * disambiguation banner's visibility (web `bannerVisible`, persisted-dismissed). Empty ids mean "not yet
 * resolved"; the view-model fills them from the first two enrolled vehicles, exactly like the web auto-select.
 */
data class FleetCompareInteraction(
    val vehicleIdA: String = "",
    val vehicleIdB: String = "",
    val bannerVisible: Boolean = true,
) {
    /** The numeric id behind [vehicleIdA], or 0 when nothing is selected (web `vehicleA?.id ?? 0`). */
    val numericIdA: Long get() = vehicleIdA.toLongOrNull() ?: 0L

    /** The numeric id behind [vehicleIdB], or 0 when nothing is selected (web `vehicleB?.id ?? 0`). */
    val numericIdB: Long get() = vehicleIdB.toLongOrNull() ?: 0L
}

// ── Display preferences ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting`
 * reads from the `/settings` document: the resolved SI→display [unit] bag (distance / speed / energy), the
 * currency [symbol] (blank → "$"), the currency/number [precision] (web `decimal_precision`, floored &
 * non-negative, else 2), and the [locale] used for digit grouping (web global locale).
 */
data class FleetCompareDisplayPrefs(
    val unit: UnitPref,
    val symbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance display unit + its label (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unit.distance

    /** The speed display unit + its label (web `unitPrefs.speed`). */
    val speedUnit: SpeedUnitPref get() = unit.speed

    /** The energy-intensity unit label, `Wh/mi` for miles else `Wh/km` (web `efficiencyUnit`). */
    val efficiencyUnitLabel: String get() = if (unit.distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    companion object {
        private const val DEFAULT_CURRENCY = "$"
        private const val DEFAULT_PRECISION = 2
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val DEFAULT_LOCALE_TAG = "en-US"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT: FleetCompareDisplayPrefs = fromSettings(null)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` / `useFormatting`). */
        fun fromSettings(settings: JsonElement?): FleetCompareDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            val tag = unit.locale?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG
            return FleetCompareDisplayPrefs(
                unit = unit,
                symbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = Locale.forLanguageTag(tag),
            )
        }
    }
}

// ── Raw payload decode ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decoded `/drives/stats` payload reduced to the fields the comparison table reads (web `DrivingStats`,
 * exposed snake_case on the wire). All numerics are SI/raw; missing or JSON-null fields collapse to zero,
 * reproducing the web optional-chaining (`ds?.x ?? 0`). The km / (km·h⁻¹) / (Wh·km⁻¹) values stay in those units
 * until the projection converts them at the display boundary.
 */
data class DrivingStatsData(
    val totalDrives: Double,
    val totalDistanceKm: Double,
    val avgEfficiencyWhKm: Double,
    val avgSpeedKmh: Double,
    val topSpeedKmh: Double,
    val regenRatio: Double,
    val co2SavedKg: Double,
) {
    companion object {
        /** The all-zero snapshot, surfaced for a null payload or before a vehicle's stats load. */
        val EMPTY = DrivingStatsData(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * Decodes the raw `/drives/stats` [json] (SI, snake_case on the wire) into a [DrivingStatsData]. A non-object
 * input or absent/JSON-null fields all collapse to zero — reproducing the web `ds?.field ?? 0`.
 */
fun parseDrivingStats(json: JsonElement?): DrivingStatsData {
    val obj = json as? JsonObject ?: return DrivingStatsData.EMPTY
    return DrivingStatsData(
        totalDrives = obj.double("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km"),
        avgSpeedKmh = obj.double("avg_speed_kmh"),
        topSpeedKmh = obj.double("top_speed_kmh"),
        regenRatio = obj.double("regen_ratio"),
        co2SavedKg = obj.double("co2_saved_kg"),
    )
}

/**
 * The decoded `/analytics/tco` payload reduced to the three fields the comparison table reads (web
 * `total_charging_cost`, `total_wh`, `total_sessions`). SI/raw on the wire; missing fields collapse to zero
 * (web `cost?.field ?? 0`).
 */
data class CostSummaryData(
    val totalChargingCost: Double,
    val totalWh: Double,
    val totalSessions: Double,
) {
    companion object {
        /** The all-zero snapshot, surfaced for a null payload or before a vehicle's cost loads. */
        val EMPTY = CostSummaryData(0.0, 0.0, 0.0)
    }
}

/** Decodes the raw `/analytics/tco` [json] into a [CostSummaryData]; missing fields collapse to zero. */
fun parseCostSummary(json: JsonElement?): CostSummaryData {
    val obj = json as? JsonObject ?: return CostSummaryData.EMPTY
    return CostSummaryData(
        totalChargingCost = obj.double("total_charging_cost"),
        totalWh = obj.double("total_wh"),
        totalSessions = obj.double("total_sessions"),
    )
}

/**
 * One decoded `/mileage/monthly` bucket reduced to the fields the comparison charts read: the [yearMonth] label
 * ('YYYY-MM'), the month's [totalKm] driven distance (km on the wire), and the [driveCount] for that month.
 */
data class MonthlyBucket(
    val yearMonth: String,
    val totalKm: Double,
    val driveCount: Double,
)

/**
 * Decodes the raw `/mileage/monthly` [json] (the unwrapped `months` array, SI/snake_case) into a list of
 * [MonthlyBucket]. A non-array input collapses to an empty list (web `data ?? []`); each entry is read
 * null-safely (`year_month` missing ⇒ "", numeric fields missing/JSON-null ⇒ 0.0).
 */
fun parseMonthlyBuckets(json: JsonElement?): List<MonthlyBucket> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        (element as? JsonObject)?.let { obj ->
            MonthlyBucket(
                yearMonth = (obj["year_month"] as? JsonPrimitive)?.contentOrNull ?: "",
                totalKm = obj.double("total_km"),
                driveCount = obj.double("drive_count"),
            )
        }
    }
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

// ── Overlaid monthly chart series (web `monthlyChartData` / `drivesChartData`) ────────────────────────────────

/**
 * One merged month across both vehicles — the native analogue of a web `monthlyChartData` datum: the
 * [month] label and the per-vehicle distance ([distA]/[distB], km) + drive counts ([drivesA]/[drivesB]).
 */
data class MonthlyComparePoint(
    val month: String,
    val distA: Double,
    val distB: Double,
    val drivesA: Double,
    val drivesB: Double,
)

/**
 * Merges the two vehicles' monthly buckets keyed by year-month and sorts ascending — the native port of the web
 * `monthlyChartData` `Map` merge + `localeCompare` sort. A month present for only one vehicle keeps zeros for the
 * other (web's `existing ?? {…, 0, 0}` fill), so the overlay always aligns on a shared x axis.
 */
fun mergeMonthly(
    a: List<MonthlyBucket>,
    b: List<MonthlyBucket>,
): List<MonthlyComparePoint> {
    val merged = LinkedHashMap<String, MonthlyComparePoint>()
    for (m in a) {
        merged[m.yearMonth] = MonthlyComparePoint(m.yearMonth, distA = m.totalKm, distB = 0.0, drivesA = m.driveCount, drivesB = 0.0)
    }
    for (m in b) {
        val existing = merged[m.yearMonth]
        merged[m.yearMonth] =
            if (existing != null) {
                existing.copy(distB = m.totalKm, drivesB = m.driveCount)
            } else {
                MonthlyComparePoint(m.yearMonth, distA = 0.0, distB = m.totalKm, drivesA = 0.0, drivesB = m.driveCount)
            }
    }
    return merged.values.sortedBy { it.month }
}

// ── Lifetime comparison table (web `comparisonRows` + `getWinner`) ────────────────────────────────────────────

/** The semantic that decides which side "wins" a comparison row (web `WinnerSemantic`). */
enum class WinnerSemantic { Higher, Lower, Neutral }

/** Which vehicle wins a row, or a tie (web `'a' | 'b' | 'tie'`). */
enum class WinnerSide { A, B, Tie }

/**
 * One projected comparison-table row — the native analogue of a web `ComparisonRow`. Carries the localized
 * [metric] label, the already-formatted per-vehicle [valueA]/[valueB] strings, the raw [rawA]/[rawB] sort keys,
 * and the [winner] semantic. [winnerSide] recomputes the winning side from the raw values + semantic so the
 * render layer only decides which cell to mark.
 */
data class ComparisonRow(
    val metric: String,
    val valueA: String,
    val valueB: String,
    val rawA: Double,
    val rawB: Double,
    val winner: WinnerSemantic,
) {
    /** The winning side for this row (web `getWinner(rawA, rawB, winner)`). */
    val winnerSide: WinnerSide get() = computeWinner(rawA, rawB, winner)
}

/**
 * Decides which side wins given the two raw values + the [semantic] — the native port of the web `getWinner`:
 * a neutral semantic or equal values is a tie; `higher` picks the larger, `lower` the smaller.
 */
fun computeWinner(
    a: Double,
    b: Double,
    semantic: WinnerSemantic,
): WinnerSide =
    when {
        semantic == WinnerSemantic.Neutral || a == b -> WinnerSide.Tie
        semantic == WinnerSemantic.Higher -> if (a > b) WinnerSide.A else WinnerSide.B
        else -> if (a < b) WinnerSide.A else WinnerSide.B
    }

/**
 * The ten localized metric labels the comparison table renders down its first column (web
 * `t('comparison.…')`). Bundled so the pure [comparisonRows] projection assembles each row's label without a
 * Compose dependency; the composable builds this from `stringResource`, tests pass a deterministic instance.
 */
data class ComparisonLabels(
    val totalDrives: String,
    val totalDistance: String,
    val avgEfficiency: String,
    val avgSpeed: String,
    val topSpeed: String,
    val regenRatio: String,
    val co2Saved: String,
    val chargingCost: String,
    val totalEnergy: String,
    val chargeSessions: String,
)

/** 1 mile = 1.609344 km — used to convert Wh/km efficiency to Wh/mi (web `KM_PER_MILE`). */
private const val KM_PER_MILE = 1.609344

/** Web `fmtNumber` percent multiplier + the explicit 1-fraction-digit the regen-ratio row uses. */
private const val PERCENT_SCALE = 100.0
private const val REGEN_DECIMALS = 1

/** Web charging-cost / charge-sessions tiles render at zero currency fraction digits (`formatCurrency(x, 0)`). */
private const val CURRENCY_DECIMALS = 0

/** km → SI metres for the distance converter (web `fromKm` multiplies by 1000 before `convertDistanceFromSI`). */
private const val METERS_PER_KM = 1000.0

/** km·h⁻¹ → SI m·s⁻¹ for the speed converter (web `(kmh * 1000) / 3600`). */
private const val MPS_PER_KMH = 1000.0 / 3600.0

/** Convert a km value to the user's display distance (web `fromKm`). */
fun toDisplayDistance(
    km: Double,
    prefs: FleetCompareDisplayPrefs,
): Double = convertDistanceFromSI(km * METERS_PER_KM, prefs.distanceUnit)

/** Convert a km·h⁻¹ value to the user's display speed (web `fromKmh`). */
fun toDisplaySpeed(
    kmh: Double,
    prefs: FleetCompareDisplayPrefs,
): Double = convertSpeedFromSI(kmh * MPS_PER_KMH, prefs.speedUnit)

/** Convert a Wh/km efficiency to the user's display unit — Wh/mi for miles else Wh/km (web `whPerKmToDisplay`). */
fun toDisplayEfficiency(
    whPerKm: Double,
    prefs: FleetCompareDisplayPrefs,
): Double = if (prefs.distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

/** Format a currency [amount] as web `formatCurrency`: the user's symbol then a [decimals]-digit grouped number. */
fun formatCurrency(
    amount: Double,
    prefs: FleetCompareDisplayPrefs,
    decimals: Int = prefs.precision,
): String = "${prefs.symbol}${ChartFormat.number(amount, decimals.coerceAtLeast(0), prefs.locale)}"

/** Format a plain number at the user's precision + locale grouping (web `fmtNumber`). */
fun formatNumber(
    value: Double,
    prefs: FleetCompareDisplayPrefs,
    decimals: Int = prefs.precision,
): String = ChartFormat.number(value, decimals.coerceAtLeast(0), prefs.locale)

/**
 * Builds the ten lifetime comparison rows from the two vehicles' decoded stats + cost — the native port of the
 * web `comparisonRows` `useMemo`. Each value is formatted at the display boundary (distance/speed/efficiency
 * converted from SI, currency + energy via the shared formatters), and each row carries the web's exact winner
 * semantic (higher / lower / neutral). [co2Unit] is the localized "kg" suffix the CO₂ row appends.
 */
fun comparisonRows(
    statsA: DrivingStatsData,
    statsB: DrivingStatsData,
    costA: CostSummaryData,
    costB: CostSummaryData,
    prefs: FleetCompareDisplayPrefs,
    labels: ComparisonLabels,
    co2Unit: String,
): List<ComparisonRow> {
    val distanceLabel = prefs.distanceUnit.label
    val speedLabel = prefs.speedUnit.label
    val efficiencyLabel = prefs.efficiencyUnitLabel
    return listOf(
        ComparisonRow(
            metric = labels.totalDrives,
            valueA = formatNumber(statsA.totalDrives, prefs),
            valueB = formatNumber(statsB.totalDrives, prefs),
            rawA = statsA.totalDrives,
            rawB = statsB.totalDrives,
            winner = WinnerSemantic.Higher,
        ),
        ComparisonRow(
            metric = labels.totalDistance,
            valueA = "${formatNumber(toDisplayDistance(statsA.totalDistanceKm, prefs), prefs)} $distanceLabel",
            valueB = "${formatNumber(toDisplayDistance(statsB.totalDistanceKm, prefs), prefs)} $distanceLabel",
            rawA = statsA.totalDistanceKm,
            rawB = statsB.totalDistanceKm,
            winner = WinnerSemantic.Higher,
        ),
        ComparisonRow(
            metric = labels.avgEfficiency,
            valueA = "${formatNumber(toDisplayEfficiency(statsA.avgEfficiencyWhKm, prefs), prefs)} $efficiencyLabel",
            valueB = "${formatNumber(toDisplayEfficiency(statsB.avgEfficiencyWhKm, prefs), prefs)} $efficiencyLabel",
            rawA = statsA.avgEfficiencyWhKm,
            rawB = statsB.avgEfficiencyWhKm,
            winner = WinnerSemantic.Lower,
        ),
        ComparisonRow(
            metric = labels.avgSpeed,
            valueA = "${formatNumber(toDisplaySpeed(statsA.avgSpeedKmh, prefs), prefs)} $speedLabel",
            valueB = "${formatNumber(toDisplaySpeed(statsB.avgSpeedKmh, prefs), prefs)} $speedLabel",
            rawA = statsA.avgSpeedKmh,
            rawB = statsB.avgSpeedKmh,
            winner = WinnerSemantic.Neutral,
        ),
        ComparisonRow(
            metric = labels.topSpeed,
            valueA = "${formatNumber(toDisplaySpeed(statsA.topSpeedKmh, prefs), prefs)} $speedLabel",
            valueB = "${formatNumber(toDisplaySpeed(statsB.topSpeedKmh, prefs), prefs)} $speedLabel",
            rawA = statsA.topSpeedKmh,
            rawB = statsB.topSpeedKmh,
            winner = WinnerSemantic.Neutral,
        ),
        ComparisonRow(
            metric = labels.regenRatio,
            valueA = "${formatNumber(statsA.regenRatio * PERCENT_SCALE, prefs, REGEN_DECIMALS)}%",
            valueB = "${formatNumber(statsB.regenRatio * PERCENT_SCALE, prefs, REGEN_DECIMALS)}%",
            rawA = statsA.regenRatio,
            rawB = statsB.regenRatio,
            winner = WinnerSemantic.Higher,
        ),
        ComparisonRow(
            metric = labels.co2Saved,
            valueA = "${formatNumber(statsA.co2SavedKg, prefs)} $co2Unit",
            valueB = "${formatNumber(statsB.co2SavedKg, prefs)} $co2Unit",
            rawA = statsA.co2SavedKg,
            rawB = statsB.co2SavedKg,
            winner = WinnerSemantic.Higher,
        ),
        ComparisonRow(
            metric = labels.chargingCost,
            valueA = formatCurrency(costA.totalChargingCost, prefs, CURRENCY_DECIMALS),
            valueB = formatCurrency(costB.totalChargingCost, prefs, CURRENCY_DECIMALS),
            rawA = costA.totalChargingCost,
            rawB = costB.totalChargingCost,
            winner = WinnerSemantic.Lower,
        ),
        ComparisonRow(
            metric = labels.totalEnergy,
            valueA = formatEnergy(costA.totalWh, prefs.unit),
            valueB = formatEnergy(costB.totalWh, prefs.unit),
            rawA = costA.totalWh,
            rawB = costB.totalWh,
            winner = WinnerSemantic.Neutral,
        ),
        ComparisonRow(
            metric = labels.chargeSessions,
            valueA = formatNumber(costA.totalSessions, prefs),
            valueB = formatNumber(costB.totalSessions, prefs),
            rawA = costA.totalSessions,
            rawB = costB.totalSessions,
            winner = WinnerSemantic.Neutral,
        ),
    )
}

// ── Key-highlight stat values (web `StatCard` value strings) ──────────────────────────────────────────────────

/** The em-dash a highlight shows for a vehicle whose state has not loaded (web `?? '—'`). */
private const val EM_DASH = "\u2014"

/** The battery-level highlight pair, `{a}% vs {b}%`, with em-dash for an absent state (web `batteryDiff`). */
fun batteryHighlightValue(
    stateA: VehicleState?,
    stateB: VehicleState?,
): String {
    val a = stateA?.batteryLevel?.toString() ?: EM_DASH
    val b = stateB?.batteryLevel?.toString() ?: EM_DASH
    return "$a% vs $b%"
}

/** The efficiency highlight pair, `{a} vs {b}` in the display efficiency unit (web `efficiencyDiff`). */
fun efficiencyHighlightValue(
    statsA: DrivingStatsData,
    statsB: DrivingStatsData,
    prefs: FleetCompareDisplayPrefs,
): String =
    "${formatNumber(toDisplayEfficiency(statsA.avgEfficiencyWhKm, prefs), prefs)} vs " +
        formatNumber(toDisplayEfficiency(statsB.avgEfficiencyWhKm, prefs), prefs)

/** The charging-cost highlight pair, `{a} vs {b}` at zero fraction digits (web `costDiff`). */
fun costHighlightValue(
    costA: CostSummaryData,
    costB: CostSummaryData,
    prefs: FleetCompareDisplayPrefs,
): String =
    "${formatCurrency(costA.totalChargingCost, prefs, CURRENCY_DECIMALS)} vs " +
        formatCurrency(costB.totalChargingCost, prefs, CURRENCY_DECIMALS)

/** The CO₂-saved highlight pair, `{a} vs {b}` (web `co2Diff`); the "kg" unit is rendered by the StatCard. */
fun co2HighlightValue(
    statsA: DrivingStatsData,
    statsB: DrivingStatsData,
    prefs: FleetCompareDisplayPrefs,
): String = "${formatNumber(statsA.co2SavedKg, prefs)} vs ${formatNumber(statsB.co2SavedKg, prefs)}"

// ── Per-vehicle current-status card (web `VehicleStatusCard`) ─────────────────────────────────────────────────

/**
 * The render-ready current-status view for one vehicle — the native analogue of everything the web
 * `VehicleStatusCard` computes before returning JSX. Built only when a vehicle is selected; the loading / empty
 * branches are the composable's job (web's `isLoading` / `!vehicle` short-circuits). All SI values are already
 * converted to the user's units.
 *
 * @property name the display name, falling back to the VIN (web `vehicle.display_name || vehicle.vin`).
 * @property subtitle the model + optional trim line, or `null` when neither is known (web `model · trim`).
 * @property online whether the last-known connection state is "online" (web `vehicle.state === 'online'`).
 * @property hasState whether a decodable state loaded (web `state` truthiness); gates the battery bar + security.
 * @property batteryLevel the SoC percentage, or `null` with no state (web `state?.battery_level`).
 * @property rangeText the formatted rated range, or em-dash with no state (web `range != null ? … : '—'`).
 * @property tempText the inside/outside temperature pair, or em-dash with no state.
 * @property isLocked whether the vehicle is locked (web `state.is_locked`); only meaningful when [hasState].
 * @property sentryMode whether Sentry mode is on (web `state.sentry_mode`).
 * @property rawStatus the connection-state token, or `null` (web `vehicle.state`); the composable folds the
 *   unknown fallback so it stays localized.
 */
data class VehicleStatusModel(
    val name: String,
    val subtitle: String?,
    val online: Boolean,
    val hasState: Boolean,
    val batteryLevel: Long?,
    val rangeText: String,
    val tempText: String,
    val isLocked: Boolean,
    val sentryMode: Boolean,
    val rawStatus: String?,
)

/** Battery-bar tone bands — green > 50, amber > 20, else red (web `batteryLevel > 50 ? … : … : …`). */
enum class BatteryTone { Good, Warning, Critical }

/** Maps an SoC percentage to its bar tone (web's `> 50` / `> 20` thresholds). */
fun batteryTone(level: Long): BatteryTone =
    when {
        level > BATTERY_GOOD_THRESHOLD -> BatteryTone.Good
        level > BATTERY_WARN_THRESHOLD -> BatteryTone.Warning
        else -> BatteryTone.Critical
    }

private const val BATTERY_GOOD_THRESHOLD = 50L
private const val BATTERY_WARN_THRESHOLD = 20L

/** The web battery-bar width clamp (`Math.min(batteryLevel, 100)`), as a 0..1 fill fraction. */
fun batteryFillFraction(level: Long): Float = level.coerceIn(0L, 100L).toFloat() / 100f

/**
 * Projects a selected [vehicle] + its (possibly absent) [envelope] state into the [VehicleStatusModel] — the
 * native port of the web `VehicleStatusCard` body derivation. Range + temperature are formatted from SI here so
 * the composable only draws; the em-dash fallbacks mirror the web `?? '—'` / null guards. The connection state
 * is read from the state envelope (the native `Vehicle` carries no connection field), matching the envelope's
 * `?? 'offline'` contract.
 */
fun vehicleStatus(
    vehicle: Vehicle,
    envelope: VehicleStateEnvelope?,
    prefs: FleetCompareDisplayPrefs,
): VehicleStatusModel {
    val state = envelope?.state
    val name = vehicle.displayName.ifBlank { vehicle.vin }
    val subtitle = buildSubtitle(vehicle.model, vehicle.trimLevel)
    val rawStatus = state?.state
    val rangeText = if (state != null) formatDistance(state.ratedRange, prefs.unit) else EM_DASH
    val tempText =
        if (state != null) {
            "${formatTemperature(state.insideTemp, prefs.unit)} / ${formatTemperature(state.outsideTemp, prefs.unit)}"
        } else {
            EM_DASH
        }
    return VehicleStatusModel(
        name = name,
        subtitle = subtitle,
        online = rawStatus == ONLINE_STATE,
        hasState = state != null,
        batteryLevel = state?.batteryLevel,
        rangeText = rangeText,
        tempText = tempText,
        isLocked = state?.isLocked ?: false,
        sentryMode = state?.sentryMode ?: false,
        rawStatus = rawStatus,
    )
}

private const val ONLINE_STATE = "online"

/** Web `vehicle.model {trim_badging ? '· ' + trim : ''}` — joins the model + trim into one muted subtitle line. */
private fun buildSubtitle(
    model: String?,
    trim: String?,
): String? {
    val modelPart = model?.takeIf { it.isNotBlank() }
    val trimPart = trim?.takeIf { it.isNotBlank() }
    return when {
        modelPart != null && trimPart != null -> "$modelPart \u00B7 $trimPart"
        modelPart != null -> modelPart
        trimPart != null -> "\u00B7 $trimPart"
        else -> null
    }
}

// ── Resource / UiState re-shaping (the per-panel content/empty split) ─────────────────────────────────────────

/**
 * Projects a parent [UiState] onto a derived slice for one panel, recomputing only the content/empty split from
 * the mapped value while preserving the loading / hard-error / refreshing / stale / offline lifecycle. This is
 * how a single feed (e.g. the merged monthly buckets) drives a panel's own content/empty independently of the
 * page's other panels — a still-loading or failed parent stays loading/error, but a loaded-yet-empty payload
 * resolves to the empty state rather than a blank region.
 *
 * @param transform maps the parent payload to this slice's payload.
 * @param isEmpty decides whether the mapped slice is empty (the per-panel emptiness rule).
 */
fun <T, R> UiState<T>.deriveData(
    transform: (T) -> R,
    isEmpty: (R) -> Boolean,
): UiState<R> {
    val mapped = data?.let(transform)
    val derivedPhase =
        when {
            isLoading -> UiPhase.Loading
            isError -> UiPhase.Error
            mapped == null -> UiPhase.Empty
            isEmpty(mapped) -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(
        phase = derivedPhase,
        data = mapped,
        fetchedAt = fetchedAt,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
        httpStatus = httpStatus,
    )
}

// ── Diagnostics ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FleetComparePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, name, or metric value.
 */
fun recordFleetComparePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FleetComparePageRegistration.SLUG))
}
