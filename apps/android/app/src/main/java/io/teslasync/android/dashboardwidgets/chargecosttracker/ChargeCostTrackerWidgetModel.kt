// File hosts the Charge Cost Tracker surface's pure model + projection + registry; named after the
// surface bundle (ChargeCostTrackerWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.chargecosttracker

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.util.Locale
import kotlin.math.floor

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val CHARGE_COST_EM_DASH: String = "\u2014"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`
 * plus the `isCompact` / `isTall` logic in
 * `web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx`.
 */
data class ChargeCostTrackerSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single 1×1 cell (web `isCompact`): show the big total-cost number. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1

    /** True at two or more rows (web `isTall`): add the cost-per-distance + gas-savings tiles. */
    val isTall: Boolean get() = rows >= TALL_ROWS

    private companion object {
        const val TALL_ROWS = 2
    }
}

/**
 * Canonical registry metadata for the Charge Cost Tracker surface — the native mirror of the web
 * registry entry in `web/src/features/dashboard/widgets/registry/charging.ts` (`charge-cost-tracker`).
 * A dashboard host binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE]
 * footprint constraints.
 */
object ChargeCostTrackerRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "charge-cost-tracker"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargeCostTrackerWidget"

    /** The trailing window the surface summarises, mirroring the web query's `start = 30 days ago`. */
    const val WINDOW_DAYS: Int = 30

    /** The page size the web query caps at (`limit=100`). */
    const val MAX_SESSIONS: Int = 100

    /** Default footprint: 2 columns × 2 rows. */
    val DEFAULT_SIZE: ChargeCostTrackerSize = ChargeCostTrackerSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: ChargeCostTrackerSize = ChargeCostTrackerSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: ChargeCostTrackerSize = ChargeCostTrackerSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: ChargeCostTrackerSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargeCostTrackerSize): ChargeCostTrackerSize =
        ChargeCostTrackerSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** The unit the gasoline price is quoted in (web `settings.gas_unit`). */
enum class ChargeCostGasUnit {
    /** Price per US gallon (the web default). */
    GALLON,

    /** Price per litre — gallons are converted before applying the price. */
    LITER,
}

/**
 * The user's monetary + fuel display preferences the surface needs to price energy — the native
 * analogue of the web `useFormatting` inputs derived from `useSettings` (web/src/hooks/useFormatting.ts):
 * the per-kWh electricity rate, currency symbol, decimal precision, and the gasoline-comparison inputs.
 */
data class ChargeCostSettings(
    val costPerKwh: Double = DEFAULT_COST_PER_KWH,
    val currencySymbol: String = DEFAULT_CURRENCY,
    val precision: Int = DEFAULT_PRECISION,
    val gasEfficiencyMpg: Double = 0.0,
    val gasPricePerUnit: Double = 0.0,
    val gasUnit: ChargeCostGasUnit = ChargeCostGasUnit.GALLON,
) {
    /** The currency symbol with the web's blank/whitespace → "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { DEFAULT_CURRENCY }

    /** The decimal precision floored at zero (web `Math.floor`, non-negative). */
    val resolvedPrecision: Int get() = if (precision < 0) 0 else precision

    companion object {
        /** Default electricity rate when settings carry none (web `?? 0.12`). */
        const val DEFAULT_COST_PER_KWH: Double = 0.12

        /** Default fraction digits (web `?? 2`). */
        const val DEFAULT_PRECISION: Int = 2

        /** Default currency symbol (web blank → "$"). */
        const val DEFAULT_CURRENCY: String = "$"

        /** The all-default preference bundle ($0.12/kWh, "$", 2 dp, no gas comparison). */
        val DEFAULT: ChargeCostSettings = ChargeCostSettings()

        /**
         * Derives the cost preferences from the raw `/settings` document — the Kotlin port of the
         * web `useFormatting` reads. Mirrors the web verbatim: `base_cost_per_kwh ?? 0.12`, blank
         * `currency_symbol` → "$", finite-&-non-negative `decimal_precision` floored (else 2),
         * `gas_efficiency_mpg`/`gas_price_per_unit ?? 0`, `gas_unit == "liter"` → litre (else gallon).
         */
        fun from(settings: JsonElement?): ChargeCostSettings {
            val obj = settings as? JsonObject ?: return DEFAULT
            val rawSymbol = obj.stringAt(KEY_CURRENCY_SYMBOL)
            return ChargeCostSettings(
                costPerKwh = obj.doubleAt(KEY_BASE_COST_PER_KWH) ?: DEFAULT_COST_PER_KWH,
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = obj.precisionAt(KEY_DECIMAL_PRECISION) ?: DEFAULT_PRECISION,
                gasEfficiencyMpg = obj.doubleAt(KEY_GAS_EFFICIENCY_MPG) ?: 0.0,
                gasPricePerUnit = obj.doubleAt(KEY_GAS_PRICE_PER_UNIT) ?: 0.0,
                gasUnit =
                    if (obj.stringAt(KEY_GAS_UNIT) == GAS_UNIT_LITER) {
                        ChargeCostGasUnit.LITER
                    } else {
                        ChargeCostGasUnit.GALLON
                    },
            )
        }

        private const val KEY_BASE_COST_PER_KWH = "base_cost_per_kwh"
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_DECIMAL_PRECISION = "decimal_precision"
        private const val KEY_GAS_EFFICIENCY_MPG = "gas_efficiency_mpg"
        private const val KEY_GAS_PRICE_PER_UNIT = "gas_price_per_unit"
        private const val KEY_GAS_UNIT = "gas_unit"
        private const val GAS_UNIT_LITER = "liter"
    }
}

/**
 * The display preferences this surface re-derives from the live settings document — the cost
 * [settings] (web `useFormatting`) plus the unit [units] preference (web `useUnits`).
 */
data class ChargeCostPrefs(
    val settings: ChargeCostSettings,
    val units: UnitPref,
) {
    companion object {
        /** Metric + all-default cost preferences used before settings load (matches the web defaults). */
        val DEFAULT: ChargeCostPrefs = ChargeCostPrefs(ChargeCostSettings.DEFAULT, UnitPreferences.fromSettings(null))

        /** Resolves both the cost preferences and the unit preference from one `/settings` document. */
        fun from(settings: JsonElement?): ChargeCostPrefs =
            ChargeCostPrefs(ChargeCostSettings.from(settings), UnitPreferences.fromSettings(settings))
    }
}

/**
 * One charging session reduced to the two fields the web `computeMetrics` reads: the SI energy added
 * and the optional recorded cost. The wire `cost` field the web component reads is NOT part of the
 * API contract (per-session cost is serialised under `cost_decimal`, which this widget — like the web
 * — does not read), so [cost] is always `null` from the live feed and the kWh-rate estimate path runs,
 * matching the web's observable totals. The branch is preserved verbatim, never silently "fixed".
 */
data class ChargeCostSession(
    val energyAddedWh: Double,
    val cost: Double?,
)

/**
 * The aggregated 30-day cost figures — the native port of the web `CostMetrics` computed by
 * `computeMetrics`. [costPerDistance] and [gasSavings] are nullable to mirror the web's "—" /
 * "configure gas price" branches.
 */
data class ChargeCostMetrics(
    val totalKwh: Double,
    val totalCost: Double,
    val costPerDistance: Double?,
    val gasSavings: Double?,
    val sessionCount: Int,
    val totalDistanceMi: Double,
) {
    /** True when at least one in-window session was summed (web `hasData`). */
    val hasData: Boolean get() = sessionCount > 0

    companion object {
        /** An all-zero, no-session snapshot — the projection basis before any data resolves. */
        val EMPTY: ChargeCostMetrics = ChargeCostMetrics(0.0, 0.0, null, null, 0, 0.0)
    }
}

/**
 * Pure projection from raw charging sessions to the cost figures — the Android port of the web
 * `computeMetrics` plus the `useFormatting` cost helpers in
 * `web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx`. Framework-free so the gate
 * unit-tests it without a device; SI energy/distance is converted to the user's unit here (S5).
 */
object ChargeCostTrackerProjection {
    /** Rough efficiency the web reuses to back-derive distance from energy (web `AVG_MI_PER_KWH`). */
    const val AVG_MI_PER_KWH: Double = 3.5

    /** Litres per US gallon (web `FUEL.GALLONS_TO_LITERS`). */
    const val GALLONS_TO_LITERS: Double = 3.78541

    /** kWh tile precision (web `fmtNumber(totalKwh, 1)`). */
    const val KWH_DECIMALS: Int = 1

    /** Cost-per-distance precision (web `formatCurrency(costPerDistance, 3)`). */
    const val COST_PER_DISTANCE_DECIMALS: Int = 3

    /** Compact big-number precision (web `formatCurrency(totalCost, 0)`). */
    const val COMPACT_DECIMALS: Int = 0

    /**
     * Aggregate [sessions] into the 30-day cost figures — the native port of the web `computeMetrics`.
     * The list is already windowed by the query's `start=` filter (web parity), so no re-filtering is
     * done here. The recorded session [ChargeCostSession.cost] is preferred when present, otherwise the
     * cost is estimated from energy × the per-kWh rate (the web `s.cost != null ? s.cost : …` branch).
     */
    fun computeMetrics(
        sessions: List<ChargeCostSession>,
        settings: ChargeCostSettings,
        distanceUnit: DistanceUnitPref,
    ): ChargeCostMetrics {
        var totalKwh = 0.0
        var totalCost = 0.0
        for (session in sessions) {
            val energy = convertEnergyFromSI(session.energyAddedWh, EnergyUnitPref.KWH)
            totalKwh += energy
            totalCost += session.cost ?: (energy * settings.costPerKwh)
        }

        // Rough distance estimate (~3.5 mi/kWh). Web parity: this miles-magnitude value is then fed to
        // helpers whose parameter is SI metres, so convertDistanceFromSI treats it as metres. The quirk
        // is reproduced verbatim — see costPerDistanceUnit / estimateGasCost.
        val totalDistanceMi = totalKwh * AVG_MI_PER_KWH
        val costPerDistance = costPerDistanceUnit(totalKwh, totalDistanceMi, settings, distanceUnit)
        val gasCost = estimateGasCost(totalDistanceMi, settings)
        val gasSavings = gasCost?.let { it - totalCost }

        return ChargeCostMetrics(
            totalKwh = totalKwh,
            totalCost = totalCost,
            costPerDistance = costPerDistance,
            gasSavings = gasSavings,
            sessionCount = sessions.size,
            totalDistanceMi = totalDistanceMi,
        )
    }

    /**
     * Cost per the user's display-distance unit — the native port of `useFormatting.costPerDistanceUnit`.
     * Web parity: [distanceMValue] is the miles-magnitude estimate passed straight into the SI-metres
     * parameter, so it is converted as though it were metres (the web's behaviour).
     */
    fun costPerDistanceUnit(
        kwh: Double,
        distanceMValue: Double,
        settings: ChargeCostSettings,
        distanceUnit: DistanceUnitPref,
    ): Double? {
        if (distanceMValue <= 0.0) return null
        val cost = kwh * settings.costPerKwh
        val distance = convertDistanceFromSI(distanceMValue, distanceUnit)
        return if (distance > 0.0) cost / distance else null
    }

    /**
     * Estimated gasoline cost — the native port of `useFormatting.estimateGasCost`. Returns `null` when
     * mpg, price, or distance is non-positive. Web parity: [distanceMValue] is the miles-magnitude
     * estimate converted to miles as though it were metres.
     */
    fun estimateGasCost(
        distanceMValue: Double,
        settings: ChargeCostSettings,
    ): Double? {
        val mpg = settings.gasEfficiencyMpg
        val gasPrice = settings.gasPricePerUnit
        if (mpg <= 0.0 || gasPrice <= 0.0 || distanceMValue <= 0.0) return null
        val distanceMi = convertDistanceFromSI(distanceMValue, DistanceUnitPref.MI)
        val gallonsUsed = distanceMi / mpg
        return if (settings.gasUnit == ChargeCostGasUnit.LITER) {
            gallonsUsed * GALLONS_TO_LITERS * gasPrice
        } else {
            gallonsUsed * gasPrice
        }
    }

    /** Format a currency amount — the native port of `useFormatting.formatCurrency`. */
    fun formatCurrency(
        amount: Double,
        settings: ChargeCostSettings,
        decimals: Int? = null,
        locale: Locale = Locale.getDefault(),
    ): String {
        val digits = (decimals ?: settings.resolvedPrecision).coerceAtLeast(0)
        return "${settings.resolvedSymbol}${ChartFormat.number(amount, digits, locale)}"
    }

    /** Format an energy figure in kWh (web `fmtNumber(totalKwh, 1)`). */
    fun formatKwh(
        kwh: Double,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(kwh, KWH_DECIMALS, locale)
}

/** The mutually-exclusive surface drawn for a given [UiState] phase (web WidgetShell branches). */
enum class ChargeCostSurface { Loading, Error, Empty, Content }

/** Maps a [UiState] onto the surface to render. Stale/offline stay Content/Empty + a freshness chip. */
fun chargeCostSurface(state: UiState<*>): ChargeCostSurface =
    when (state.phase) {
        UiPhase.Loading -> ChargeCostSurface.Loading
        UiPhase.Error -> ChargeCostSurface.Error
        UiPhase.Empty -> ChargeCostSurface.Empty
        UiPhase.Content -> ChargeCostSurface.Content
    }

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun chargeCostErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Projects a cache-then-network [UiState] of raw [ChargingSession]s onto a [UiState] of the computed
 * [ChargeCostMetrics] for [prefs], preserving the phase + freshness flags. Pure (no Compose, no
 * timestamps read) so the cached → projection adapter is unit-tested off-device. Only
 * [ChargingSession.totalEnergyAddedWh] is read (web `?? 0`); the absent wire `cost` collapses to the
 * estimate path inside [ChargeCostTrackerProjection.computeMetrics].
 */
fun UiState<List<ChargingSession>>.toMetricsState(prefs: ChargeCostPrefs): UiState<ChargeCostMetrics> {
    val metrics =
        data?.let { sessions ->
            ChargeCostTrackerProjection.computeMetrics(
                sessions.map { ChargeCostSession(energyAddedWh = it.totalEnergyAddedWh ?: 0.0, cost = null) },
                prefs.settings,
                prefs.units.distance,
            )
        }
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

/** ISO-8601 instant string for [days] before [nowMillis] (web `d.setDate(d.getDate() - 30)`). */
fun isoDaysAgo(
    nowMillis: Long,
    days: Int,
): String = Instant.ofEpochMilli(nowMillis - days.toLong() * MILLIS_PER_DAY).toString()

private const val MILLIS_PER_DAY: Long = 86_400_000L

private fun JsonObject.doubleAt(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.stringAt(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.precisionAt(key: String): Int? {
    val value = (this[key] as? JsonPrimitive)?.doubleOrNull ?: return null
    return if (value.isFinite() && value >= 0.0) floor(value).toInt() else null
}
