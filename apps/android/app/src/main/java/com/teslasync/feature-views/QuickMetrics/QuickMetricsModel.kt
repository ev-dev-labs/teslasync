// Pure, framework-free model + projection for the QuickMetrics feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/QuickMetrics.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// QuickMetrics is a presentational surface — the web component takes a single `stats: ChargingStats | null`
// prop from the owning Charging List page (which owns the TanStack query over the charging-session history
// and computes the summary via `computeStats`), and its only data hook is `useTranslation` (labels, P1/S10).
// As in the committed SummaryStatsRow / StatusHeader ports, the cache-then-network states (loading / stale /
// offline / fetch-error) live on that owning page, not here; the two branches the web source defines —
// `stats` present (the six-cell metrics grid) and `stats` absent (a friendly EmptyState, never a blank box) —
// are the complete state set this presentational surface renders.
//
// The web reads seven `ChargingStats` fields and formats them with its shared helpers: the three charger-type
// counts via `AnimatedNumber` (`fmtNumber(_, 0)`), the total duration via `formatDurationMinutes`, a monthly
// average via `<Currency value={totalCost / 12} precision={0} />`, and a per-session energy via
// `fmtWithUnit(totalEnergy / count, 'kWh')`. The `totalEnergy` field is already in kWh on the prop (the page's
// `computeStats` converts it from SI before passing it down), so this surface appends the `kWh` glyph verbatim
// exactly as the web source does, never converting again.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/QuickMetrics — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quickmetrics

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val QUICK_METRICS_SLUG: String = "QuickMetrics"

/** Em dash shown for an unrenderable statistic — the native mirror of the web `'—'` fallback. */
internal const val QUICK_METRICS_EM_DASH: String = "\u2014"

/** Default currency symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank. */
internal const val QUICK_METRICS_DEFAULT_CURRENCY: String = "$"

/** Default decimal precision — the web `numberFormat` global default before settings load (`_globalPrecision`). */
internal const val QUICK_METRICS_DEFAULT_PRECISION: Int = 2

/** Energy unit glyph appended verbatim by the web source (`fmtWithUnit(_, 'kWh')`); standard in every locale. */
internal const val QUICK_METRICS_ENERGY_UNIT: String = "kWh"

private const val MONTHS_PER_YEAR: Double = 12.0
private const val MINUTES_PER_HOUR: Double = 60.0
private const val MONTHLY_AVG_DECIMALS: Int = 0
private const val COUNT_DECIMALS: Int = 0

/**
 * The slice of the web `ChargingStats` that QuickMetrics actually reads off its `stats` prop — the native
 * grouping of the seven fields the web component renders. The owning Charging List page computes these from
 * the session history (web `computeStats`) and threads them in; this surface performs no fetch and no unit
 * math beyond the per-session / monthly-average divisions the web source itself performs.
 *
 * @property homeCount sessions at a home / AC charger (web `stats.homeCount`).
 * @property scCount sessions at a Supercharger (web `stats.scCount`).
 * @property dcCount sessions at a non-Supercharger DC fast charger (web `stats.dcCount`).
 * @property totalDurationMinutes summed charging duration in minutes (web `stats.totalDuration`).
 * @property totalCost summed charging cost in the user's currency (web `stats.totalCost`).
 * @property totalEnergyKwh summed energy added, already in kWh on the prop (web `stats.totalEnergy`).
 * @property count total session count, used as the per-session divisor (web `stats.count`, always >= 1 when
 *   `stats` is non-null because the page's `computeStats` returns null for an empty history).
 */
data class ChargingMetrics(
    val homeCount: Int,
    val scCount: Int,
    val dcCount: Int,
    val totalDurationMinutes: Double,
    val totalCost: Double,
    val totalEnergyKwh: Double,
    val count: Int,
)

/**
 * The display-formatting context QuickMetrics resolves once at the Compose boundary — the native projection
 * of the web `useFormatting` result (currency symbol) plus the `numberFormat` global locale + precision the
 * shared formatters read. Resolved from the shared settings store (P1/S8) so the pure projection stays free
 * of any store or Android dependency.
 *
 * @property currencySymbol the user's preferred symbol (web `useFormatting().currencySymbol`).
 * @property precision the per-session decimal precision (web `_globalPrecision`, default 2).
 * @property locale drives grouping + decimal separators (web `_globalLocale`).
 */
data class QuickMetricsFormatting(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. The three counts stay numeric so the composable can count them up via the shared
 * `AnimatedNumber` (web `<AnimatedNumber>`); the three derived figures arrive pre-formatted so the projection
 * is fully unit-tested off-device.
 *
 * @property homeCount the home / AC session count, rendered by the emerald count-up cell.
 * @property scCount the Supercharger session count, rendered by the rose count-up cell.
 * @property dcCount the DC-fast session count, rendered by the amber count-up cell.
 * @property totalTime the summed duration, formatted "Xh Ym" / "Ym" (web `formatDurationMinutes`).
 * @property monthlyAvg the monthly-average cost, formatted "{symbol}{amount}" (web `Currency`, precision 0).
 * @property perSession the per-session energy, formatted "{amount} kWh" (web `fmtWithUnit`).
 */
data class QuickMetricsDisplay(
    val homeCount: Int,
    val scCount: Int,
    val dcCount: Int,
    val totalTime: String,
    val monthlyAvg: String,
    val perSession: String,
)

/**
 * Pure projection from the surface's `stats` prop to its render-ready [QuickMetricsDisplay] — a 1:1 port of
 * the formatting the web component performs. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized labels, glyphs, and design-token accents and
 * draws what these functions return.
 */
object QuickMetricsProjection {
    /**
     * Project the surface's `stats` prop onto its render-ready view, or `null` when `stats` is absent (the web
     * `stats ? … : <EmptyState/>` guard — `null` selects the empty branch). [formatting] supplies the currency
     * symbol, locale, and precision resolved from settings at the Compose boundary.
     */
    fun project(
        stats: ChargingMetrics?,
        formatting: QuickMetricsFormatting,
    ): QuickMetricsDisplay? {
        if (stats == null) return null
        return QuickMetricsDisplay(
            homeCount = stats.homeCount,
            scCount = stats.scCount,
            dcCount = stats.dcCount,
            totalTime = formatTotalTime(stats.totalDurationMinutes),
            monthlyAvg = formatMonthlyAvg(stats.totalCost, formatting.currencySymbol, formatting.locale),
            perSession =
                formatPerSession(stats.totalEnergyKwh, stats.count, formatting.precision, formatting.locale),
        )
    }

    /**
     * Web `safeNumber` (`@/lib/numberFormat`): a finite number passes through, anything else (NaN, ±∞, null)
     * becomes `0` so a sparse field never renders `NaN`.
     */
    fun safeNumber(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /**
     * Web `fmtNumber(v, decimals)` — `safeNumber(v).toLocaleString(locale, {min/maxFractionDigits})`. Groups
     * thousands and rounds half away from zero so the output matches ECMAScript `Intl.NumberFormat`
     * (`halfExpand`) rather than Java's default banker's rounding (HALF_EVEN).
     */
    fun formatNumber(
        value: Double?,
        decimals: Int,
        locale: Locale,
    ): String =
        NumberFormat
            .getNumberInstance(locale)
            .apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                isGroupingUsed = true
                roundingMode = RoundingMode.HALF_UP
            }.format(safeNumber(value))

    /** Web `<AnimatedNumber value={count} />` static rendering — `fmtNumber(count, 0)` with locale grouping. */
    fun formatCount(
        value: Int,
        locale: Locale,
    ): String = formatNumber(value * 1.0, COUNT_DECIMALS, locale)

    /**
     * Web `formatDurationMinutes(minutes)` (`@/lib/dateFormat`, called via the `formatDuration` re-export):
     * a non-finite or negative input renders the em dash, otherwise the duration is whole hours + whole
     * minutes ("Xh Ym" when there is an hour component, else "Ym"). The minute remainder is rounded half-up
     * exactly as the web `formatRoundedInt` does; the output is locale-independent like the web source.
     */
    fun formatTotalTime(minutes: Double?): String {
        if (minutes == null || !minutes.isFinite() || minutes < 0.0) return QUICK_METRICS_EM_DASH
        val hours = floor(minutes / MINUTES_PER_HOUR).toLong()
        val remainderMinutes = (minutes % MINUTES_PER_HOUR).roundToLong()
        return if (hours > 0) "${hours}h ${remainderMinutes}m" else "${remainderMinutes}m"
    }

    /**
     * Web `<Currency value={totalCost / 12} precision={0} />`: the monthly average is the total cost over a
     * year, rendered as the user's currency symbol followed by the grouped integer amount. A non-finite
     * quotient renders the em dash (web `Currency` fallback when the value is not finite).
     */
    fun formatMonthlyAvg(
        totalCost: Double?,
        currencySymbol: String,
        locale: Locale,
    ): String {
        val monthly = safeNumber(totalCost) / MONTHS_PER_YEAR
        if (!monthly.isFinite()) return QUICK_METRICS_EM_DASH
        return currencySymbol + formatNumber(monthly, MONTHLY_AVG_DECIMALS, locale)
    }

    /**
     * Web `fmtWithUnit(totalEnergy / count, 'kWh')`: the average energy per session, grouped to [precision]
     * fraction digits with a trailing `kWh` glyph. The division goes through `safeNumber` (web `fmtNumber`
     * coerces a non-finite quotient — e.g. a zero divisor — to `0`), so it never renders `NaN`.
     */
    fun formatPerSession(
        totalEnergyKwh: Double?,
        count: Int,
        precision: Int,
        locale: Locale,
    ): String {
        val perSession = safeNumber(safeNumber(totalEnergyKwh) / count)
        return formatNumber(perSession, precision, locale) + " " + QUICK_METRICS_ENERGY_UNIT
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a count,
 * a cost, an energy, or a duration — so a diagnostics line can never leak the fleet's charging behaviour.
 */
object QuickMetricsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = QUICK_METRICS_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
