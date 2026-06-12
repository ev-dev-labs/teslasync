// Pure, framework-free model + projection for the Charging Speed Trend chart feature view — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Charging Curve page) passes the loaded
// `ChargingSession[]` down. From that prop the web `monthlyTrend` memo derives, per calendar month, the
// average DC and AC charge rate in kW: it groups sessions by `started_at[0:7]`, classifies each as DC vs
// AC (`isDcSession`), converts `peak_power_w` SI watts to kW, averages each group, and rounds to one
// decimal (`Math.round(avg * 10) / 10`). This file owns that derivation plus the `ChartContainer`
// `data`/`dataColumns` accessible-table projection. Months are emitted in ascending order (web
// `entries().sort(([a],[b]) => a.localeCompare(b))`), so the native line chart and its fallback table read
// left-to-right in the same order.
//
// SI boundary (ADR / unit-conversion instructions): `peak_power_w` is stored in SI watts; the only
// transform here is the fixed W→kW scale the web applies via `convertPowerFromSI(w, 'kW')` (a presentation
// scale, not a user-preference unit conversion), so no `useUnits()` preference is involved — kW is the
// fixed axis unit the web hardcodes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SpeedTrendChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedtrendchart

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.floor

/** First characters of an ISO timestamp that form the `YYYY-MM` month key — web `started_at.slice(0, 7)`. */
internal const val MONTH_KEY_LENGTH: Int = 7

/** Watts per kilowatt — the fixed W→kW scale the web applies via `convertPowerFromSI(w, 'kW')`. */
internal const val WATTS_PER_KW: Double = 1000.0

/**
 * DC-classification power threshold, in watts — the web `isDcSession` `peak_power_w > 20_000` branch. A
 * session above this rate (or carrying any `charger_type`) is treated as DC fast charging.
 */
internal const val DC_POWER_THRESHOLD_W: Double = 20_000.0

/** kW display precision — the web `Math.round(avg * 10) / 10` one-decimal rounding. */
internal const val KW_DECIMALS: Int = 1

/** Decimal scale for one-place half-up rounding (`* 10` / `/ 10`), matching the web `Math.round(x * 10) / 10`. */
private const val ROUND_SCALE: Double = 10.0

/** Half-up rounding bias added before `floor`, reproducing JS `Math.round` for the non-negative kW domain. */
private const val ROUND_HALF: Double = 0.5

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SpeedTrendChartRegistration {
    /** Stable surface id. */
    const val ID: String = "speed-trend-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SpeedTrendChart"
}

/**
 * One charging session, reduced to the three fields the web `SpeedTrendChart` + `isDcSession` read from the
 * web `ChargingSession` — the native mirror of that prop slice. The rest of the web type (energy, SOC,
 * odometer, …) belongs to the sibling charging surfaces and is intentionally omitted.
 *
 * @property startedAt the ISO-8601 start timestamp; its first [MONTH_KEY_LENGTH] characters form the month
 *   bucket key (web `(s.started_at ?? '').slice(0, 7)`). `null`/blank degrades to the empty-month bucket.
 * @property peakPowerW the session's peak power in SI watts (web `peak_power_w`); `null` is treated as 0.
 * @property chargerType the charger label (web `charger_type`); any non-empty value classifies the session
 *   as DC, mirroring the web `!!(s.charger_type || …)` truthiness.
 */
data class ChargingSpeedSession(
    val startedAt: String?,
    val peakPowerW: Double?,
    val chargerType: String?,
)

/**
 * One month's average DC/AC charge rate — the native mirror of the web `MonthlySpeed`
 * (`{ month: string; dcAvgKw: number; acAvgKw: number }`). [month] is the `YYYY-MM` key (the chart X
 * label), [dcAvgKw]/[acAvgKw] are the one-decimal kW averages for that month's DC and AC sessions (0 when
 * the month had none of that kind, exactly like the web `avg([])` → 0).
 */
data class MonthlySpeed(
    val month: String,
    val dcAvgKw: Double,
    val acAvgKw: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `charging.curve.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 *
 * @property title the panel title (web `charging.curve.speedTrend`).
 * @property subtitle the panel subtitle (web `charging.curve.speedTrendDesc`).
 * @property ariaLabel the chart's screen-reader description (web `charging.curve.speedTrend.aria`).
 * @property avgKwLabel the Y-axis label (web `charging.curve.avgKw`).
 * @property monthColumn / dcColumn / acColumn the accessible data-table headers (web `dataColumns`).
 * @property dcSeriesLabel / acSeriesLabel the tooltip series names (web `<Line name=… />`).
 * @property dcLegendLabel / acLegendLabel the legend swatch labels (web `DC Fast` / `AC / Home`).
 */
data class SpeedTrendChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val avgKwLabel: String,
    val monthColumn: String,
    val dcColumn: String,
    val acColumn: String,
    val dcSeriesLabel: String,
    val acSeriesLabel: String,
    val dcLegendLabel: String,
    val acLegendLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's
 * `monthlyTrend` memo plus the `ChartContainer` `data`/`dataColumns` props. Pure data (no Compose types) so
 * the projection is unit-tested without a UI host: the composable wraps [dcValues]/[acValues] into two
 * `ChartSeries`, feeds [months] to the line chart's bottom axis, and renders [tableRows] as the accessible
 * fallback table (`Month`, `DC Avg kW`, `AC Avg kW`).
 */
data class SpeedTrendChartProjectionResult(
    val months: List<String>,
    val dcValues: List<Double?>,
    val acValues: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's `monthlyTrend` memo and
 * its chart/table bindings. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate; the composable only resolves localized strings, palette colors, and freshness chrome.
 */
object SpeedTrendChartProjection {
    /**
     * Classifies a session as DC fast charging — a verbatim port of the web `isDcSession`
     * (`!!(s.charger_type || (s.peak_power_w && s.peak_power_w > 20_000))`): any non-blank charger type, or
     * a peak power above [DC_POWER_THRESHOLD_W], is DC; everything else is AC / home. A non-empty charger
     * type (even whitespace) is DC, mirroring JS string truthiness — only `null`/`""` falls through.
     */
    fun isDcSession(session: ChargingSpeedSession): Boolean =
        !session.chargerType.isNullOrEmpty() || (session.peakPowerW ?: 0.0) > DC_POWER_THRESHOLD_W

    /** Arithmetic mean, or 0 for an empty list — the web `avg` helper (`length ? sum / length : 0`). */
    fun avg(values: List<Double>): Double = if (values.isEmpty()) 0.0 else values.sum() / values.size

    /**
     * One-decimal half-up rounding — the web `Math.round(value * 10) / 10`. Implemented as
     * `floor(value * 10 + 0.5) / 10`, which reproduces JS `Math.round` exactly over this surface's
     * non-negative kW domain (both operate on the same IEEE-754 `value * 10`).
     */
    fun roundKw(value: Double): Double = floor(value * ROUND_SCALE + ROUND_HALF) / ROUND_SCALE

    /**
     * Groups [sessions] into ascending-by-month [MonthlySpeed] rows — the verbatim port of the web
     * `monthlyTrend` memo. No sessions yields no rows (web `if (!sessions.length) return []`). Each
     * session's `peak_power_w` is scaled W→kW, routed to the month's DC or AC bucket by [isDcSession], then
     * each bucket is averaged and rounded to one decimal; a bucket with no sessions averages to 0.
     */
    fun monthlyTrend(sessions: List<ChargingSpeedSession>): List<MonthlySpeed> {
        if (sessions.isEmpty()) return emptyList()
        val byMonth = LinkedHashMap<String, Pair<MutableList<Double>, MutableList<Double>>>()
        for (session in sessions) {
            val month = monthKey(session.startedAt)
            val group = byMonth.getOrPut(month) { mutableListOf<Double>() to mutableListOf() }
            val powerKw = (session.peakPowerW ?: 0.0) / WATTS_PER_KW
            if (isDcSession(session)) group.first += powerKw else group.second += powerKw
        }
        return byMonth.entries
            .sortedBy { it.key }
            .map { (month, groups) ->
                MonthlySpeed(
                    month = month,
                    dcAvgKw = roundKw(avg(groups.first)),
                    acAvgKw = roundKw(avg(groups.second)),
                )
            }
    }

    /**
     * Projects [sessions] into render-ready chart inputs. [months] feed the X axis (raw `YYYY-MM` keys, as
     * the web `<XAxis dataKey="month" />`), [dcValues]/[acValues] become the two line series, and each
     * month contributes one accessible-table row (`[month, formatKw(dcAvgKw), formatKw(acAvgKw)]`,
     * mirroring the web `dataColumns`). Injecting [formatValue] keeps the projection locale-deterministic
     * for tests; the composable supplies the real localized one-decimal formatter.
     */
    fun project(
        sessions: List<ChargingSpeedSession>,
        formatValue: (kw: Double) -> String,
    ): SpeedTrendChartProjectionResult {
        val trend = monthlyTrend(sessions)
        return SpeedTrendChartProjectionResult(
            months = trend.map { it.month },
            dcValues = trend.map { it.dcAvgKw },
            acValues = trend.map { it.acAvgKw },
            tableRows = trend.map { listOf(it.month, formatValue(it.dcAvgKw), formatValue(it.acAvgKw)) },
            isEmpty = trend.isEmpty(),
        )
    }

    /**
     * Locale-aware one-decimal kW formatting (e.g. `11.5`) for the Y-axis ticks and the accessible table —
     * the grouped, half-up analogue of the web number rendering. Values are already rounded to one decimal
     * by [roundKw]; this only renders them with the locale's separators.
     */
    fun formatKw(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val pattern = "#,##0." + "0".repeat(KW_DECIMALS)
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)
    }

    /** First [MONTH_KEY_LENGTH] chars of the timestamp — web `(s.started_at ?? '').slice(0, 7)`. */
    private fun monthKey(startedAt: String?): String = (startedAt ?: "").take(MONTH_KEY_LENGTH)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SpeedTrendChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a month, rate, or charger type — so a diagnostics line can never
 * leak the fleet's charging habits. Kept free of Compose so it is unit-tested with a recording [Logger];
 * the composable calls it from its first-composition effect.
 */
fun recordSpeedTrendChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SpeedTrendChartRegistration.SLUG))
}
