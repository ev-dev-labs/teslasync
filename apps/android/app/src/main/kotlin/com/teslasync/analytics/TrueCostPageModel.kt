// Pure, framework-free model + projections for the TrueCostPage analytics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/analytics/pages/TrueCostPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection helpers, the shared-core Resource/units, and the shared ChartFormat), so the composable stays a
// thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the raw `/analytics/tco` envelope into a typed
// [CostBreakdown] (web optional-chaining → null-safe reads); (2) the display-boundary unit + currency derivation from
// the `/settings` document ([TrueCostDisplayPrefs], web `useUnits`/`useFormatting`/`useSettings`); and (3) the
// per-field formatting helpers the panels call (currency, grouped numbers, SI watt-hour energy, SI-metre→display
// distance — web `formatCurrency`/`fmtNumber`/`fmtInt`/`formatEnergy`/`convertDistanceFromSI`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the cost envelope reports SI on the wire (watt-hours,
// kilometres, raw fiat). Energy + distance are converted ONLY at the display boundary via the shared
// [formatEnergy]/[convertDistanceFromSI]; nothing is stored or computed in non-SI units. The per-km figures are an
// already-derived rate the backend emits, rendered verbatim like the web (no native re-derivation).
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web guards its body on the truthiness of
// the loaded payload (`tco ?`) and shows its `noData` panel ("Start charging to see your cost analysis") when the
// query has resolved with no envelope (no vehicle selected, or an all-zero account). The native surface routes a
// no-vehicle / all-zero payload to UiPhase.Empty (via [CostBreakdown.hasData]) so the four declared data states are
// genuinely reachable — the same gate the sibling CostBreakdownWidget uses. When real data is present the full body
// renders, and the three charts each fall back to their own per-chart empty sub-state on an empty `monthly_breakdown`
// (web `monthlyBreakdown.length > 0`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling LifetimeStats page does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.truecost

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance figure floors on before conversion (web `total_km * 1000`). */
private const val METERS_PER_KM = 1000.0

/** The web `settings.gas_unit ?? 'gallon'` default — gallons unless the user picked litres. */
private const val DEFAULT_GAS_UNIT = "gallon"

/** The web `gasUnit === 'liter'` sentinel that swaps the gallon label for the litre label. */
private const val GAS_UNIT_LITER = "liter"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TrueCostPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("trueCost", "/tco", …)`, so the host binds this surface to that destination (and its `/analytics/tco` deep
 * link via the route table) without the nav module depending on it.
 */
object TrueCostPageRegistration {
    /** The navigation destination id (Destinations.kt `page("trueCost", "/tco", …)`). */
    const val ROUTE_ID: String = "trueCost"

    /** The web route this surface mirrors (deep-link target; the route table maps `/analytics/tco` here too). */
    const val WEB_PATH: String = "/tco"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "TrueCostPage"
}

/**
 * One month of the TCO breakdown — the native mirror of the web `MonthlyCostEntry` the charts iterate
 * (`monthly_breakdown[]`). [month] is the `YYYY-MM` label; the three figures are SI/raw fiat. [energyWh] is decoded
 * for shape-completeness even though the page's charts read only the cost + cumulative-savings fields.
 */
data class MonthlyCostEntry(
    val month: String,
    val evCost: Double,
    val equivGasCost: Double,
    val cumulativeSavings: Double,
    val energyWh: Double,
)

/**
 * The decoded `/analytics/tco` payload — the native analogue of the web `CostBreakdown` interface every panel reads.
 * All numerics are SI/raw on the wire (watt-hours, kilometres, raw fiat, derived per-km rates, counts); display
 * conversion happens in [TrueCostDisplayPrefs]. Missing / JSON-null fields collapse to their zero / empty default,
 * exactly like the web optional-chaining (`data?.x ?? 0`).
 */
data class CostBreakdown(
    val totalChargingCost: Double,
    val totalWh: Double,
    val totalSessions: Double,
    val totalKm: Double,
    val firstDate: String,
    val lastDate: String,
    val equivalentGasCost: Double,
    val totalSavings: Double,
    val monthlySavings: Double,
    val costPerKmEv: Double,
    val costPerKmIce: Double,
    val maintenanceSavingsEstimate: Double,
    val monthsOfOwnership: Double,
    val gasPrice: Double,
    val gasEfficiencyMpg: Double,
    val monthlyBreakdown: List<MonthlyCostEntry>,
) {
    /**
     * Whether the envelope carries any meaningful cost history. A no-vehicle / brand-new account (no sessions, no
     * charging cost, no distance, no months) routes to the friendly empty surface (web `noData`) rather than a grid of
     * zeros — mirroring the sibling CostBreakdownWidget `hasData` gate and making the four data states reachable.
     */
    val hasData: Boolean
        get() = totalSessions > 0.0 || totalChargingCost > 0.0 || totalKm > 0.0 || monthlyBreakdown.isNotEmpty()

    /** Web `tco.total_savings + tco.maintenance_savings_estimate` — the Savings-Breakdown total tile. */
    val totalEstimatedSavings: Double get() = totalSavings + maintenanceSavingsEstimate

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload or no resolved vehicle. */
        val EMPTY: CostBreakdown =
            CostBreakdown(
                totalChargingCost = 0.0,
                totalWh = 0.0,
                totalSessions = 0.0,
                totalKm = 0.0,
                firstDate = "",
                lastDate = "",
                equivalentGasCost = 0.0,
                totalSavings = 0.0,
                monthlySavings = 0.0,
                costPerKmEv = 0.0,
                costPerKmIce = 0.0,
                maintenanceSavingsEstimate = 0.0,
                monthsOfOwnership = 0.0,
                gasPrice = 0.0,
                gasEfficiencyMpg = 0.0,
                monthlyBreakdown = emptyList(),
            )
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` +
 * `useSettings` reads from the `/settings` document: the full [unit] preference (distance figure + the SI watt-hour
 * energy format), the [currencySymbol] (blank → "$"), the currency [precision] (web `decimal_precision`, floored &
 * non-negative, else 2), the [locale] for grouped-number formatting, and the [gasUnit] (`gallon`/`liter`) that selects
 * the gas-price denominator label.
 */
data class TrueCostDisplayPrefs(
    val unit: UnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
    val gasUnit: String,
) {
    /** The distance unit the Savings-Breakdown total tile renders in (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unit.distance

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = unit.distance.label

    /** Web `gasUnit === 'liter'` — drives the gallon-vs-litre label choice at the display boundary. */
    val isLiterGasUnit: Boolean get() = gasUnit.equals(GAS_UNIT_LITER, ignoreCase = true)

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [decimals]-digit grouped number in the user's locale. Defaults to the configured [precision] (web prop default).
     */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, decimals.coerceAtLeast(0))

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** SI watt-hours → the user's energy unit + label (web `useUnits().formatEnergy(total_wh)`). */
    fun energy(wh: Double): String = formatEnergy(wh, unit)

    /** SI kilometres → the user's display distance numeric (web `convertDistanceFromSI(total_km * 1000, unit)`). */
    fun distanceDisplay(totalKm: Double): Double = convertDistanceFromSI(totalKm * METERS_PER_KM, unit.distance)

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_GAS_UNIT = "gas_unit"

        /** Metric + `$` + 2dp + en-US + gallons defaults used before settings load (matches the web defaults). */
        val DEFAULT: TrueCostDisplayPrefs =
            TrueCostDisplayPrefs(
                unit = UnitPreferences.fromSettings(null),
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
                gasUnit = DEFAULT_GAS_UNIT,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`/`useSettings`). */
        fun fromSettings(settings: JsonElement?): TrueCostDisplayPrefs {
            val obj = settings as? JsonObject
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = obj?.string(KEY_CURRENCY_SYMBOL)?.trim()
            val rawGasUnit = obj?.string(KEY_GAS_UNIT)?.trim()
            return TrueCostDisplayPrefs(
                unit = unit,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
                gasUnit = if (!rawGasUnit.isNullOrEmpty()) rawGasUnit else DEFAULT_GAS_UNIT,
            )
        }
    }
}

/**
 * Decodes the raw `/analytics/tco` [json] (SI, snake_case on the wire) into a [CostBreakdown]. A non-object input, a
 * missing field, or a JSON-null field all collapse to zero / empty — reproducing the web optional-chaining
 * (`data?.x ?? 0`, `data?.monthly_breakdown ?? []`). The monthly rows are decoded null-safely too.
 */
fun parseCostBreakdown(json: JsonElement?): CostBreakdown {
    val obj = json as? JsonObject ?: return CostBreakdown.EMPTY
    return CostBreakdown(
        totalChargingCost = obj.double("total_charging_cost"),
        totalWh = obj.double("total_wh"),
        totalSessions = obj.double("total_sessions"),
        totalKm = obj.double("total_km"),
        firstDate = obj.string("first_date") ?: "",
        lastDate = obj.string("last_date") ?: "",
        equivalentGasCost = obj.double("equivalent_gas_cost"),
        totalSavings = obj.double("total_savings"),
        monthlySavings = obj.double("monthly_savings"),
        costPerKmEv = obj.double("cost_per_km_ev"),
        costPerKmIce = obj.double("cost_per_km_ice"),
        maintenanceSavingsEstimate = obj.double("maintenance_savings_estimate"),
        monthsOfOwnership = obj.double("months_of_ownership"),
        gasPrice = obj.double("gas_price"),
        gasEfficiencyMpg = obj.double("gas_efficiency_mpg"),
        monthlyBreakdown = obj.monthlyBreakdown(),
    )
}

private fun JsonObject.monthlyBreakdown(): List<MonthlyCostEntry> =
    (this["monthly_breakdown"] as? JsonArray)
        ?.mapNotNull { (it as? JsonObject)?.toMonthlyEntry() }
        ?: emptyList()

private fun JsonObject.toMonthlyEntry(): MonthlyCostEntry =
    MonthlyCostEntry(
        month = string("month") ?: "",
        evCost = double("ev_cost"),
        equivGasCost = double("equiv_gas_cost"),
        cumulativeSavings = double("cumulative_savings"),
        energyWh = double("energy_wh"),
    )

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → CostBreakdown` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TrueCostPageRegistration.SLUG] (P1/S11). Kept free
 * of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition. Carries
 * no vehicle id, cost, or savings payload.
 */
fun recordTrueCostOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TrueCostPageRegistration.SLUG))
}
