// Pure, framework-free model + projection for the WeekOverWeekSummary feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// WeekOverWeekSummary is a presentational surface — the web component takes a single `metrics: DigestMetrics`
// prop from the Weekly Digest page (which owns the TanStack queries over drives / charging / alerts via
// `useWeeklyDigest`), so this surface binds no data hooks. As in the sibling SummaryStatsRow port, the
// cache-then-network states (loading skeleton, fetch error, empty "no data", stale / offline) live on the
// owning page (web `useWeeklyDigest` `isLoading` / `error` / `hasData`, rendered by WeeklyDigestPage as
// `DigestSkeleton` / `PageContainer` error / `EmptyState`), NOT here. The one branch the web source defines
// — the resolved six-card comparison grid — is the complete state set this presentational surface renders,
// with the always-present empty contract: every card always renders (zeros format as "0" / "$0.00", never a
// blank box). A host `loading` flag is threaded so the six cards can show their own StatCard skeleton while
// the page's queries are in flight, the lifecycle chrome the host's load implies.
//
// The web renders six StatCards in order: total distance (`fmtNumber(_, 1)` km), drive count (`fmtInt`),
// energy used (`fmtNumber(_, 1)` kWh, inverted trend — more is worse), charging cost
// (`formatCurrency(_, 2)`, inverted), average efficiency (`fmtNumber(_, 1)` Wh/km, inverted), and CO2 saved
// (`fmtNumber(_, 1)` kg). Each card's trend is the web `trendFor(current, previous, invertPositive?)` helper:
// a flat / up / down arrow, a signed percentage string, and a good/bad tone (inverted for the metrics where
// an increase is undesirable). The unit symbols are rendered verbatim from the web source's hardcoded
// `unit=` literals (the metrics arrive pre-aggregated from the backend in km / kWh / Wh-km, matching the web
// `Drive` / `ChargingSession` shapes), so they are not routed through i18n — only the six card labels are.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WeekOverWeekSummary — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.weekoverweeksummary

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Cost-card fraction digits — the web `formatCurrency(metrics.chargingCost, 2)` literal precision. */
internal const val COST_DECIMALS: Int = 2

/** Distance / energy / efficiency / CO2 fraction digits — the web `fmtNumber(_, 1)` literal precision. */
internal const val VALUE_DECIMALS: Int = 1

/** Trend-percentage fraction digits — the web `fmtNumber(pct, 1)` inside `trendFor`. */
internal const val TREND_DECIMALS: Int = 1

/** Whole-number (count) fraction digits — the web `fmtInt` (`fmtNumber(v, 0)`). */
private const val COUNT_DECIMALS: Int = 0

/** Below this absolute delta the web `trendFor` reports a flat "0%" change (web `Math.abs(diff) < 0.01`). */
private const val FLAT_EPSILON: Double = 0.01

/** The percentage the web `pctChange` returns when the previous value is zero and the current is positive. */
private const val FULL_PERCENT: Double = 100.0

/** Unit symbol for the distance card — the web StatCard `unit="km"` literal. */
internal const val UNIT_KM: String = "km"

/** Unit symbol for the energy card — the web StatCard `unit="kWh"` literal. */
internal const val UNIT_KWH: String = "kWh"

/** Unit symbol for the efficiency card — the web StatCard `unit="Wh/km"` literal. */
internal const val UNIT_WH_KM: String = "Wh/km"

/** Unit symbol for the CO2 card — the web StatCard `unit="kg"` literal. */
internal const val UNIT_KG: String = "kg"

/**
 * The direction of a week-over-week change — a 1:1 port of the web `trendFor` `direction` field
 * (`'up' | 'down' | 'flat'`). The composable maps each onto the shared StatCard's `DeltaArrow` glyph.
 */
enum class TrendDirection { Up, Down, Flat }

/**
 * The six comparison cards this surface renders, in web source order. The composable resolves each one's
 * localized label (P1/S10) and design-token icon (P1/S9) from this identity, keeping the projection pure.
 */
enum class WeekMetric { Distance, Drives, Energy, Cost, Efficiency, Co2 }

/**
 * A fully resolved trend chip — the native analogue of the web `trendFor(...)` return value.
 *
 * @property direction the arrow direction (web `direction`).
 * @property text the pre-formatted signed percentage (web `value`, e.g. `"+12.3%"`, `"-5.0%"`, `"0%"`).
 * @property positive whether the change reads as good (green) rather than bad (red) — already inverted for
 *   the metrics where an increase is undesirable (web `positive`, with `invertPositive` applied).
 */
data class WeekTrend(
    val direction: TrendDirection,
    val text: String,
    val positive: Boolean,
)

/**
 * One render-ready comparison card — the native analogue of a single web `<StatCard ... />`.
 *
 * @property metric the card identity, which the composable maps to a localized label + token icon.
 * @property value the already-formatted primary value (web `fmtNumber` / `fmtInt` / `formatCurrency`).
 * @property unit the trailing unit symbol, or `null` for the unitless drive-count and cost cards.
 * @property trend the resolved week-over-week trend chip.
 */
data class WeekMetricTile(
    val metric: WeekMetric,
    val value: String,
    val unit: String?,
    val trend: WeekTrend,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning page's queries are still in flight; each card renders its StatCard
 *   skeleton while true (the lifecycle chrome the host's load implies — the web page shows `DigestSkeleton`).
 * @property tiles the six comparison cards in web source order; always present (the always-render contract),
 *   formatting zeros rather than hiding a card when a value is absent.
 */
data class WeekOverWeekSummaryDisplay(
    val loading: Boolean,
    val tiles: List<WeekMetricTile>,
)

/**
 * One week-over-week comparison — this week's value against the prior week's, the pair every trend chip is
 * computed from. Values use the web `number` type (counts arrive as whole numbers), so a Double models them
 * faithfully and lets the drive-count card share the same shape as the decimal cards.
 *
 * @property current this week's value (web `metrics.total*` / `metrics.*`).
 * @property previous last week's value (web `metrics.prev*`).
 */
data class WeekComparison(
    val current: Double,
    val previous: Double,
) {
    companion object {
        /** A zero-vs-zero comparison — the empty-week contract building block. */
        val ZERO: WeekComparison = WeekComparison(0.0, 0.0)
    }
}

/**
 * The six week-over-week comparisons the Weekly Digest page threads into this surface — the native grouping
 * of the `metrics: DigestMetrics` field pairs the web component reads (`totalDistance` / `prevDistance`,
 * `totalDrives` / `prevDriveCount`, …). The full web `DigestMetrics` carries more, consumed by sibling
 * sections; this surface needs only these six current-vs-previous pairs.
 *
 * @property distance total drive distance in km (web `totalDistance` / `prevDistance`).
 * @property drives drive count (web `totalDrives` / `prevDriveCount`).
 * @property energy energy used in kWh (web `energyUsed` / `prevEnergy`).
 * @property cost charging cost (web `chargingCost` / `prevChargingCost`).
 * @property efficiency average efficiency in Wh/km (web `avgEfficiency` / `prevAvgEfficiency`).
 * @property co2 CO2 saved in kg (web `co2Saved` / `prevCo2`).
 */
data class WeekOverWeekMetrics(
    val distance: WeekComparison,
    val drives: WeekComparison,
    val energy: WeekComparison,
    val cost: WeekComparison,
    val efficiency: WeekComparison,
    val co2: WeekComparison,
) {
    companion object {
        /** All-zero metrics — the empty-week contract (every card renders "0" / "$0.00", never a blank box). */
        val EMPTY: WeekOverWeekMetrics =
            WeekOverWeekMetrics(
                distance = WeekComparison.ZERO,
                drives = WeekComparison.ZERO,
                energy = WeekComparison.ZERO,
                cost = WeekComparison.ZERO,
                efficiency = WeekComparison.ZERO,
                co2 = WeekComparison.ZERO,
            )
    }
}

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the cost card formats with the
 * literal 2-digit precision (web `formatCurrency(metrics.chargingCost, 2)`), so the user's
 * `decimal_precision` does not apply here.
 *
 * @property currencySymbol the symbol prefixed to the cost value (web `settings.currency_symbol`, `'$'`).
 */
data class WeekDigestCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The default ($) preference used for previews / cold start before settings load. */
        val DEFAULT: WeekDigestCurrencyPrefs = WeekDigestCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): WeekDigestCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return WeekDigestCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * Pure projection from the surface's props to its render-ready [WeekOverWeekSummaryDisplay] — a 1:1 port of
 * the derivations the web component performs inline: the six `fmtNumber` / `fmtInt` / `formatCurrency`
 * values, the per-card `trendFor(...)` comparison (with `invertPositive` for energy / cost / efficiency),
 * and the hardcoded unit symbols. The card labels and icons are resolved in the composable from each tile's
 * [WeekMetric] identity against the i18n catalog and the design-token glyphs.
 */
object WeekOverWeekSummaryProjection {
    /**
     * Select the render-ready view for the given [metrics], resolved [currency], and host [loading] flag.
     * [locale] pins the number grouping / decimal separators (the composable passes the device locale; tests
     * pass a fixed locale for deterministic output).
     */
    fun project(
        metrics: WeekOverWeekMetrics,
        currency: WeekDigestCurrencyPrefs,
        loading: Boolean,
        locale: Locale,
    ): WeekOverWeekSummaryDisplay =
        WeekOverWeekSummaryDisplay(
            loading = loading,
            tiles =
                listOf(
                    WeekMetricTile(
                        metric = WeekMetric.Distance,
                        value = formatNumber(metrics.distance.current, VALUE_DECIMALS, locale),
                        unit = UNIT_KM,
                        trend = trendFor(metrics.distance.current, metrics.distance.previous, false, locale),
                    ),
                    WeekMetricTile(
                        metric = WeekMetric.Drives,
                        value = formatCount(metrics.drives.current, locale),
                        unit = null,
                        trend = trendFor(metrics.drives.current, metrics.drives.previous, false, locale),
                    ),
                    WeekMetricTile(
                        metric = WeekMetric.Energy,
                        value = formatNumber(metrics.energy.current, VALUE_DECIMALS, locale),
                        unit = UNIT_KWH,
                        trend = trendFor(metrics.energy.current, metrics.energy.previous, true, locale),
                    ),
                    WeekMetricTile(
                        metric = WeekMetric.Cost,
                        value = formatCurrency(metrics.cost.current, currency.currencySymbol, COST_DECIMALS, locale),
                        unit = null,
                        trend = trendFor(metrics.cost.current, metrics.cost.previous, true, locale),
                    ),
                    WeekMetricTile(
                        metric = WeekMetric.Efficiency,
                        value = formatNumber(metrics.efficiency.current, VALUE_DECIMALS, locale),
                        unit = UNIT_WH_KM,
                        trend = trendFor(metrics.efficiency.current, metrics.efficiency.previous, true, locale),
                    ),
                    WeekMetricTile(
                        metric = WeekMetric.Co2,
                        value = formatNumber(metrics.co2.current, VALUE_DECIMALS, locale),
                        unit = UNIT_KG,
                        trend = trendFor(metrics.co2.current, metrics.co2.previous, false, locale),
                    ),
                ),
        )

    /**
     * Percent change from [previous] to [current] — a verbatim port of the web `pctChange`: a zero previous
     * yields 100 when the current is positive and 0 otherwise, else the signed relative change against the
     * magnitude of [previous].
     */
    fun pctChange(
        current: Double,
        previous: Double,
    ): Double {
        if (previous == 0.0) return if (current > 0.0) FULL_PERCENT else 0.0
        return ((current - previous) / kotlin.math.abs(previous)) * FULL_PERCENT
    }

    /**
     * Resolve a [WeekTrend] for the move from [previous] to [current] — a 1:1 port of the web `trendFor`:
     * an absolute delta under [FLAT_EPSILON] is a flat "0%" (web `positive: true`); otherwise the arrow
     * follows the sign of the delta, the text is the signed `fmtNumber(pct, 1)%` (with a leading `+` only
     * when rising), and [invertPositive] flips the good/bad tone for the metrics where an increase is
     * undesirable (energy, cost, efficiency).
     */
    fun trendFor(
        current: Double,
        previous: Double,
        invertPositive: Boolean,
        locale: Locale,
    ): WeekTrend {
        val diff = current - previous
        if (kotlin.math.abs(diff) < FLAT_EPSILON) {
            return WeekTrend(TrendDirection.Flat, "0%", positive = true)
        }
        val isUp = diff > 0.0
        val pctText = formatNumber(pctChange(current, previous), TREND_DECIMALS, locale)
        val sign = if (isUp) "+" else ""
        return WeekTrend(
            direction = if (isUp) TrendDirection.Up else TrendDirection.Down,
            text = "$sign$pctText%",
            positive = if (invertPositive) !isUp else isUp,
        )
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`:
     * a non-finite value is coerced to 0 (web `safeNumber`), then grouped with the locale separators and the
     * exact [decimals] fraction digits, rounding half away from zero to match `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals.coerceAtLeast(0), locale)

    /**
     * Locale-aware grouped integer formatting — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`).
     * Takes the count as a Double (the web `number` type) to match the [WeekComparison] shape.
     */
    fun formatCount(
        value: Double,
        locale: Locale,
    ): String = formatNumber(value, COUNT_DECIMALS, locale)

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safeNumber`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${formatNumber(amount, decimals, locale)}"

    /** Coerces a non-finite value to 0, the native mirror of the web `safeNumber`. */
    fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * distance, cost, energy, or any week metric — so a diagnostics line can never leak the user's driving data.
 */
object WeekOverWeekSummaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "WeekOverWeekSummary"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
