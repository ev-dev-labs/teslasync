// Pure, framework-free model + derivations for the PeriodComparePage analytics surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/analytics/pages/PeriodComparePage.tsx, the two-period comparison surface). No Compose, no
// Android UI, no HTTP lives here: the surface binds the shared S8 `VehiclesStore.vehicles()` feed (the web
// `useVehicles` port, GET /vehicles) for the vehicle picker and reads the canonical period-stats envelope
// (GET /analytics/period-stats?vehicle_id&days) for the two selected windows. This file owns only the
// client-side derivations the web component does inline: the six-metric roll-up with its SI display conversions
// (web `convertDistanceFromSI` + the Wh/km -> Wh/mi efficiency conversion), the signed percent-change fold
// (web `pctChange`), the locale-grouped number formatting (web `fmtNumber`), and the one PII-safe `view.opened`
// diagnostic. Backend period-stats arrive in display units (km, kWh, Wh/km, kg); distance and efficiency are
// converted to the user's `UnitPref` at this model boundary (S5) so the chart/table/cards match the unit label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located helpers and value types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.periodcompare

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

/**
 * Canonical metadata for this surface. The web page is a top-level analytics route, so this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already present
 * in Destinations.kt) and the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11). The
 * [FLEET_COMPARE_URI] is the disambiguation banner's deep-link target (web `<Link to="/vehicle-comparison">`).
 */
object PeriodComparePageRegistration {
    /** The navigation destination id (Destinations.kt `page("periodCompare", "/period-compare", …)`). */
    const val ROUTE_ID: String = "periodCompare"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/period-compare"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "PeriodComparePage"

    /** Deep-link URI for the fleet-comparison disambiguation banner CTA (web `/vehicle-comparison`). */
    const val FLEET_COMPARE_URI: String = "teslasync://app/vehicle-comparison"
}

/** Em dash used as the universal "no value" marker, matching the web `'—'` percent-change fallback. */
internal const val EM_DASH: String = "\u2014"

/** The web display-precision default (`numberFormat._globalPrecision`) used when settings carry none. */
private const val DEFAULT_DECIMALS: Int = 2

/** The web display-locale default (`numberFormat._globalLocale`) used when settings carry no locale. */
private const val DEFAULT_LOCALE: String = "en-US"

/** 1 km = 1000 m exactly — backend period-stats `total_distance` is km, converted to SI metres before display. */
private const val METERS_PER_KM: Double = 1000.0

/** 1 mile = 1.609344 km — folds an SI Wh/km efficiency into Wh/mi for mile-unit users (web `KM_PER_MILE`). */
private const val KM_PER_MILE: Double = 1.609344

/**
 * The trailing-window choices the two period selectors offer (web `PERIOD_VALUES`). [raw] is the wire/url token
 * the web uses (`'7'|'30'|'90'|'365'|'0'`); [days] is the `?days=` query value, where `0` means "all time"
 * (no date filter), matching the canonical `/analytics/period-stats?days=0` contract.
 */
enum class PeriodValue(
    val raw: String,
    val days: Int,
) {
    LAST_7("7", 7),
    LAST_30("30", 30),
    LAST_90("90", 90),
    LAST_YEAR("365", 365),
    ALL_TIME("0", 0),
    ;

    companion object {
        /** Default Period A (web initial `period_a` = 30 days). */
        val DEFAULT_A: PeriodValue = LAST_30

        /** Default Period B (web initial `period_b` = 90 days). */
        val DEFAULT_B: PeriodValue = LAST_90

        /** Resolves a wire token back to its [PeriodValue], falling back to [LAST_30] (web `PERIOD_DAYS` guard). */
        fun fromRaw(raw: String): PeriodValue = entries.firstOrNull { it.raw == raw } ?: LAST_30
    }
}

/** The six comparison metrics the web page rolls up, in display order (web `metrics`). */
enum class MetricKind { Distance, Drives, Energy, Efficiency, Cost, Co2 }

/**
 * The canonical period-stats envelope (`GET /analytics/period-stats`), the exact shape the web page consumes and
 * the Go `periodstats.PeriodStats` handler serves. Numbers are display units (km, kWh, Wh/km, kg); distance and
 * efficiency are converted to the user's unit at the model boundary. Fields default to zero so a sparse window
 * (a vehicle with no drives/charges) decodes to an all-zero envelope rather than failing.
 */
@Serializable
data class PeriodStats(
    @SerialName("total_distance") val totalDistance: Double = 0.0,
    @SerialName("total_drives") val totalDrives: Int = 0,
    @SerialName("energy_used") val energyUsed: Double = 0.0,
    @SerialName("avg_efficiency") val avgEfficiency: Double = 0.0,
    @SerialName("total_cost") val totalCost: Double = 0.0,
    @SerialName("co2_saved") val co2Saved: Double = 0.0,
)

/** A signed, formatted percent change (web `pctChange` return): the rendered [text] and its [positive] sign. */
data class PctChange(
    val text: String,
    val positive: Boolean,
) {
    companion object {
        /** The web `b === 0` fallback: an em dash treated as a non-negative change. */
        val NONE: PctChange = PctChange(EM_DASH, true)
    }
}

/**
 * One fully-derived comparison metric (web `metrics[i]` + its table row): the display-converted [a]/[b] numbers
 * for the chart, their locale-formatted [aText]/[bText], the [unit] symbol, the absolute [change] + [changeText],
 * and the signed [pct]. The i18n label is resolved at the render boundary from [kind].
 */
data class MetricValue(
    val kind: MetricKind,
    val a: Double,
    val b: Double,
    val unit: String,
    val aText: String,
    val bText: String,
    val change: Double,
    val changeText: String,
    val pct: PctChange,
)

/**
 * The fully-derived comparison the page renders when both period windows have loaded: the six [metrics] (cards +
 * chart + table) and the three insight percent-changes (web `insights`), computed on the raw SI-domain values so
 * the ratios are unit-independent. [EMPTY] gates the native Empty phase (web `!a || !b` empty-state).
 */
data class PeriodComparison(
    val metrics: List<MetricValue>,
    val insightDistance: PctChange,
    val insightEfficiency: PctChange,
    val insightCost: PctChange,
) {
    companion object {
        val EMPTY: PeriodComparison = PeriodComparison(emptyList(), PctChange.NONE, PctChange.NONE, PctChange.NONE)
    }
}

/**
 * Locale-grouped fixed-precision formatting (web `fmtNumber` ▸ `Number.toLocaleString(locale, {min==max})`):
 * en-US-style grouping with [decimals] fraction digits and half-away-from-zero rounding to match the web
 * `Intl.NumberFormat` `halfExpand` contract. A non-finite value formats as zero, matching the web `safeNumber`.
 */
fun formatNumber(
    value: Double,
    locale: String,
    decimals: Int,
): String {
    val safe = if (value.isFinite()) value else 0.0
    val format =
        NumberFormat.getNumberInstance(Locale.forLanguageTag(locale)).apply {
            minimumFractionDigits = decimals
            maximumFractionDigits = decimals
            roundingMode = RoundingMode.HALF_UP
        }
    return format.format(safe)
}

/**
 * The signed percent change of [a] relative to [b] (web `pctChange`): a zero baseline yields [PctChange.NONE]
 * (the em dash, treated as non-negative); otherwise the value is `((a-b)/b)*100` with a leading `+` for a
 * positive change and one fraction digit, and [PctChange.positive] is `pct >= 0`.
 */
fun pctChange(
    a: Double,
    b: Double,
    locale: String,
): PctChange {
    if (b == 0.0) return PctChange.NONE
    val pct = ((a - b) / b) * 100.0
    val sign = if (pct > 0.0) "+" else ""
    return PctChange("$sign${formatNumber(pct, locale, 1)}%", pct >= 0.0)
}

/**
 * Builds the six display metrics from the two period envelopes and the user's [prefs] (web `metrics` memo):
 * `total_distance` (km) becomes SI metres then the user's distance unit; `avg_efficiency` (Wh/km) folds to Wh/mi
 * for mile users; drives/energy/cost/CO₂ pass through with their fixed unit symbols. Every value is formatted at
 * the resolved display precision so the cards, chart, and table agree with the unit label.
 */
fun buildComparison(
    a: PeriodStats,
    b: PeriodStats,
    prefs: UnitPref,
): PeriodComparison {
    val decimals = (prefs.precision ?: DEFAULT_DECIMALS).coerceIn(0, 20)
    val locale = prefs.locale ?: DEFAULT_LOCALE
    val isMiles = prefs.distance == DistanceUnitPref.MI
    val distanceUnit = prefs.distance.label
    val efficiencyUnit = if (isMiles) "Wh/mi" else "Wh/km"

    val distA = convertDistanceFromSI(a.totalDistance * METERS_PER_KM, prefs.distance)
    val distB = convertDistanceFromSI(b.totalDistance * METERS_PER_KM, prefs.distance)
    val effA = if (isMiles) a.avgEfficiency * KM_PER_MILE else a.avgEfficiency
    val effB = if (isMiles) b.avgEfficiency * KM_PER_MILE else b.avgEfficiency

    val metrics =
        listOf(
            metricOf(MetricKind.Distance, distA, distB, distanceUnit, locale, decimals),
            metricOf(MetricKind.Drives, a.totalDrives * 1.0, b.totalDrives * 1.0, "", locale, decimals),
            metricOf(MetricKind.Energy, a.energyUsed, b.energyUsed, "kWh", locale, decimals),
            metricOf(MetricKind.Efficiency, effA, effB, efficiencyUnit, locale, decimals),
            metricOf(MetricKind.Cost, a.totalCost, b.totalCost, "$", locale, decimals),
            metricOf(MetricKind.Co2, a.co2Saved, b.co2Saved, "kg", locale, decimals),
        )

    return PeriodComparison(
        metrics = metrics,
        insightDistance = pctChange(a.totalDistance, b.totalDistance, locale),
        insightEfficiency = pctChange(a.avgEfficiency, b.avgEfficiency, locale),
        insightCost = pctChange(a.totalCost, b.totalCost, locale),
    )
}

private fun metricOf(
    kind: MetricKind,
    a: Double,
    b: Double,
    unit: String,
    locale: String,
    decimals: Int,
): MetricValue {
    val change = a - b
    return MetricValue(
        kind = kind,
        a = a,
        b = b,
        unit = unit,
        aText = formatNumber(a, locale, decimals),
        bText = formatNumber(b, locale, decimals),
        change = change,
        changeText = formatNumber(abs(change), locale, decimals),
        pct = pctChange(a, b, locale),
    )
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PeriodComparePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, period window, or metric value.
 */
fun recordPeriodComparePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PeriodComparePageRegistration.SLUG))
}
