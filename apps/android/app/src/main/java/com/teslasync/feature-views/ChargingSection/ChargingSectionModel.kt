// Pure, framework-free model + projection for the ChargingSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/analytics/components/weekly-digest/ChargingSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Weekly Digest page's `useWeeklyDigest` hook)
// computes the `metrics` summary and the seven-day `dailyEnergyData` series and passes them down. From those
// props the component renders one charging panel: a daily-energy bar chart, a four-tile stat row (session
// count, total energy added, average charge rate, total cost), and a week-over-week energy badge. This file
// owns the parts the web expresses inline: the slice of `DigestMetrics` the panel reads, the seven-day
// series, the `useFormatting` currency contract (`currencySymbol + fmtNumber`), the four formatted stat
// strings, the bar-chart series projection, the `pctChange` week-over-week delta with its success/warning
// tone, and the lifecycle projection onto the shared cache-then-network [UiState] (so the surface renders
// every state the P1/S8 layer can carry). `fmtNumber`/`fmtInt` mirror the web `Intl.NumberFormat`
// half-away-from-zero rounding rather than Java's default banker's rounding.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingsection

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** Em dash shown for an absent week-over-week delta — the web `—` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Energy fraction digits — the web `fmtNumber(metrics.chargeEnergyAdded, 1)` precision. */
internal const val ENERGY_DECIMALS: Int = 1

/** Charge-rate fraction digits — the web `fmtNumber(metrics.avgChargeRate, 1)` precision. */
internal const val RATE_DECIMALS: Int = 1

/** Cost fraction digits — the web `formatCurrency(metrics.chargingCost, 2)` literal precision. */
internal const val COST_DECIMALS: Int = 2

/** Week-over-week percent fraction digits — the web `fmtNumber(pctChange(...), 1)` precision. */
internal const val TREND_DECIMALS: Int = 1

/** Energy unit symbol appended to the total-energy stat — the web literal `kWh`. */
internal const val UNIT_KWH: String = "kWh"

/** Power unit symbol appended to the charge-rate stat — the web literal `kW`. */
internal const val UNIT_KW: String = "kW"

/** Percent scale for the week-over-week delta (web `* 100`). */
private const val PERCENT_FULL: Double = 100.0

/**
 * The slice of the web `DigestMetrics` this charging panel reads (web `types.ts`). The five fields are the
 * exact ones the web `ChargingSection` consumes; the rest of `DigestMetrics` (distance, drives, alerts, …)
 * belongs to the sibling digest sections and is intentionally omitted.
 *
 * @property chargeEnergyAdded total energy added across the week, in kWh (web `metrics.chargeEnergyAdded`).
 * @property prevChargeEnergy the previous week's energy added, in kWh — the week-over-week baseline (web
 *   `metrics.prevChargeEnergy`).
 * @property avgChargeRate average charge rate across the week's sessions, in kW (web `metrics.avgChargeRate`).
 * @property chargingCost total charging cost across the week, in the user's currency (web
 *   `metrics.chargingCost`).
 * @property chargingSessionCount number of charging sessions in the week (web `metrics.chargingSessionCount`).
 */
data class ChargingDigestMetrics(
    val chargeEnergyAdded: Double,
    val prevChargeEnergy: Double,
    val avgChargeRate: Double,
    val chargingCost: Double,
    val chargingSessionCount: Long,
) {
    companion object {
        /** The all-zero metrics — the empty-week outcome (every stat reads zero, the delta reads "—"). */
        val ZERO: ChargingDigestMetrics =
            ChargingDigestMetrics(
                chargeEnergyAdded = 0.0,
                prevChargeEnergy = 0.0,
                avgChargeRate = 0.0,
                chargingCost = 0.0,
                chargingSessionCount = 0L,
            )
    }
}

/**
 * One day's energy-added bar — the native mirror of a web `DailyEnergyEntry` (`{ day: string; energy:
 * number }`). [day] is the localized weekday label (the chart X axis) and [energy] is the kWh added that
 * day (the bar height).
 */
data class DailyEnergyPoint(
    val day: String,
    val energy: Double,
)

/**
 * The decoded charging slice this section renders — the native projection of the two web props
 * (`metrics`, `dailyEnergyData`). Built by a host that already holds the computed weekly digest, or via
 * [ChargingSectionProjection.parse] from a raw digest document.
 */
data class ChargingDigestData(
    val metrics: ChargingDigestMetrics,
    val dailyEnergy: List<DailyEnergyPoint>,
) {
    companion object {
        /** The empty-week value — zeroed metrics and no daily bars (each region shows its empty affordance). */
        val EMPTY: ChargingDigestData = ChargingDigestData(ChargingDigestMetrics.ZERO, emptyList())
    }
}

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the total-cost stat formats with
 * the literal 2-digit precision (web `formatCurrency(x, 2)`), so the user's `decimal_precision` does not
 * apply here.
 */
data class ChargingCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: ChargingCurrencyPrefs = ChargingCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): ChargingCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return ChargingCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * The four already-formatted stat-row values, in web source order — the native mirror of the web `MiniStat`
 * value props. [sessions] is the grouped session count (web `fmtInt`); [totalEnergyAdded] and
 * [avgChargeRate] are the grouped 1-decimal values with their `kWh`/`kW` unit suffixes; [totalCost] is the
 * currency-formatted cost (web `formatCurrency(_, 2)`).
 */
data class ChargingStatValues(
    val sessions: String,
    val totalEnergyAdded: String,
    val avgChargeRate: String,
    val totalCost: String,
)

/**
 * The bar-chart inputs, preserving the received (chronological) day order — the native analogue of the web
 * `<BarChart data={dailyEnergyData}>` binding. [labels] are the weekday X-axis labels; [values] are the
 * per-day kWh added (each normalized to a finite number so a gap never renders as `NaN`). [isEmpty] mirrors
 * the web series guard so the chart region shows its empty message instead of a blank plot.
 */
data class ChargingBarData(
    val labels: List<String>,
    val values: List<Double?>,
    val isEmpty: Boolean,
)

/**
 * The week-over-week energy badge — the native projection of the web `<Badge>` content. [text] is the
 * signed percent change (web `${fmtNumber(pctChange(...), 1)}%`) or the em dash when there is no prior-week
 * baseline (web `metrics.prevChargeEnergy > 0 ? … : '—'`). [positive] selects the badge tone: the web
 * `success` (this week ≥ last week) versus `warning` (this week down), resolved to a palette accent at the
 * Compose boundary.
 */
data class EnergyTrend(
    val text: String,
    val positive: Boolean,
)

/**
 * Pure projection from the section's inputs to its render state — a 1:1 port of the web component's inline
 * derivations and value formatting. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, glyphs, accents, and colors and draws what
 * these return.
 */
object ChargingSectionProjection {
    /**
     * Maps the section's `(data, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8).
     * The web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence:
     *  - loading → [UiPhase.Loading];
     *  - not loading + data present → [UiPhase.Content] (the panel renders the chart, stats, and badge);
     *  - not loading + no data → [UiPhase.Empty] (the panel still renders, with zeroed stats, an empty
     *    chart, and a "—" delta — never a blank box).
     */
    fun projectUiState(
        data: ChargingDigestData?,
        isLoading: Boolean,
    ): UiState<ChargingDigestData> =
        when {
            isLoading -> UiState.loading()
            data != null -> UiState(phase = UiPhase.Content, data = data)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The four formatted stat-row values — the native mirror of the web `MiniStat` value expressions:
     * `fmtInt(chargingSessionCount)`, `${fmtNumber(chargeEnergyAdded, 1)} kWh`,
     * `${fmtNumber(avgChargeRate, 1)} kW`, and `formatCurrency(chargingCost, 2)`. [locale] drives the
     * grouping/decimal separators; [currency] supplies the cost symbol.
     */
    fun statValues(
        metrics: ChargingDigestMetrics,
        currency: ChargingCurrencyPrefs,
        locale: Locale,
    ): ChargingStatValues =
        ChargingStatValues(
            sessions = formatInt(maxOf(metrics.chargingSessionCount, 0L), locale),
            totalEnergyAdded = "${fmtNumber(metrics.chargeEnergyAdded, ENERGY_DECIMALS, locale)} $UNIT_KWH",
            avgChargeRate = "${fmtNumber(metrics.avgChargeRate, RATE_DECIMALS, locale)} $UNIT_KW",
            totalCost = formatCurrency(metrics.chargingCost, currency.currencySymbol, COST_DECIMALS, locale),
        )

    /**
     * The bar-chart inputs in received (chronological) order — the native analogue of the web `<BarChart
     * data={dailyEnergyData}>` binding. Each energy sample is normalized via [safe] so a non-finite value
     * never plots as `NaN`. [ChargingBarData.isEmpty] is the web series guard (no days → empty message).
     */
    fun barData(dailyEnergy: List<DailyEnergyPoint>): ChargingBarData =
        ChargingBarData(
            labels = dailyEnergy.map { it.day },
            values = dailyEnergy.map { safe(it.energy) },
            isEmpty = dailyEnergy.isEmpty(),
        )

    /**
     * The week-over-week energy badge — a verbatim port of the web `<Badge>` content and variant. The tone
     * is `success` when this week's energy is at least last week's, else `warning` (web
     * `chargeEnergyAdded >= prevChargeEnergy ? 'success' : 'warning'`); the text is the signed percent
     * change, or the em dash when there is no prior-week baseline (web `prevChargeEnergy > 0 ? … : '—'`).
     */
    fun energyTrend(
        metrics: ChargingDigestMetrics,
        locale: Locale,
    ): EnergyTrend {
        val current = safe(metrics.chargeEnergyAdded)
        val previous = safe(metrics.prevChargeEnergy)
        val text =
            if (previous > 0.0) {
                "${fmtNumber(pctChange(current, previous), TREND_DECIMALS, locale)}%"
            } else {
                EM_DASH
            }
        return EnergyTrend(text = text, positive = current >= previous)
    }

    /**
     * Percent change of [current] over [previous] — a verbatim port of the web `pctChange` helper
     * (weekly-digest/helpers.ts): a zero baseline yields 100 when there is any current value, else 0;
     * otherwise `((current - previous) / |previous|) * 100`.
     */
    fun pctChange(
        current: Double,
        previous: Double,
    ): Double {
        if (previous == 0.0) return if (current > 0.0) PERCENT_FULL else 0.0
        return (current - previous) / abs(previous) * PERCENT_FULL
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits). Groups thousands and rounds half away from
     * zero so the output matches ECMAScript's `halfExpand` rather than Java's default banker's rounding. A
     * non-finite value is coerced to 0 (web `safeNumber`).
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceAtLeast(0)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe(value))
    }

    /**
     * Locale-aware grouped integer formatting — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`).
     * Delegates to [fmtNumber] at 0 decimals so the half-away-from-zero rounding and grouping match the web.
     */
    fun formatInt(
        value: Long,
        locale: Locale,
    ): String = fmtNumber(value + 0.0, 0, locale)

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safeNumber`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${fmtNumber(amount, decimals, locale)}"

    /**
     * Decodes a raw weekly-digest document into the typed [ChargingDigestData] this section reads — the
     * native port of the web prop wiring (`metrics`, `dailyEnergyData`). The metrics may sit under a
     * `metrics` object or at the document root; either way any missing/malformed branch degrades to a zero /
     * empty value so the section never throws on a partial payload, and day order is preserved.
     */
    fun parse(digestDoc: JsonElement?): ChargingDigestData {
        val root = digestDoc as? JsonObject ?: return ChargingDigestData.EMPTY
        val metricsObj = root.obj(KEY_METRICS) ?: root
        val metrics =
            ChargingDigestMetrics(
                chargeEnergyAdded = metricsObj.double(KEY_CHARGE_ENERGY_ADDED),
                prevChargeEnergy = metricsObj.double(KEY_PREV_CHARGE_ENERGY),
                avgChargeRate = metricsObj.double(KEY_AVG_CHARGE_RATE),
                chargingCost = metricsObj.double(KEY_CHARGING_COST),
                chargingSessionCount = metricsObj.long(KEY_CHARGING_SESSION_COUNT),
            )
        val daily =
            root.array(KEY_DAILY_ENERGY).mapNotNull { element ->
                val obj = element as? JsonObject ?: return@mapNotNull null
                DailyEnergyPoint(day = obj.string(KEY_DAY), energy = obj.double(KEY_ENERGY))
            }
        return ChargingDigestData(metrics = metrics, dailyEnergy = daily)
    }

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0 — so a chart never plots `NaN`. */
    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

    private fun JsonObject.array(key: String): JsonArray = this[key] as? JsonArray ?: JsonArray(emptyList())

    private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

    private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

    private fun JsonObject.long(key: String): Long {
        val primitive = this[key] as? JsonPrimitive ?: return 0L
        return primitive.longOrNull ?: primitive.doubleOrNull?.roundToLong() ?: 0L
    }

    private const val KEY_METRICS = "metrics"
    private const val KEY_DAILY_ENERGY = "dailyEnergyData"
    private const val KEY_CHARGE_ENERGY_ADDED = "chargeEnergyAdded"
    private const val KEY_PREV_CHARGE_ENERGY = "prevChargeEnergy"
    private const val KEY_AVG_CHARGE_RATE = "avgChargeRate"
    private const val KEY_CHARGING_COST = "chargingCost"
    private const val KEY_CHARGING_SESSION_COUNT = "chargingSessionCount"
    private const val KEY_DAY = "day"
    private const val KEY_ENERGY = "energy"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * energy, cost, rate, or session count — so a diagnostics line can never leak the fleet's charging habits
 * or spend.
 */
object ChargingSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ChargingSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
