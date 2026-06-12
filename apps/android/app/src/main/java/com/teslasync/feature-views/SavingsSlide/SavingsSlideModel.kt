// Pure, framework-free model + projection for the SavingsSlide feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/SavingsSlide.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SavingsSlide is one slide of the Year-in-Review slideshow. The web component is purely presentational —
// it takes a `data: YearReview` prop from the slideshow page (which owns the TanStack query over
// `/analytics/year-review`) and reads exactly two fields, `gas_savings` and `total_charging_cost`. So this
// surface binds NO data hook of its own (its only data source is `useTranslation`). As in the sibling
// AchievementBadge / SummaryStatsRow ports, the cache-then-network lifecycle (loading / error / stale /
// offline) lives on the owning page, not here; modelling those states would invent behaviour the spec does
// not have (drift). The branches the web source actually defines — the resolved data render and the
// `gasCostEquiv > 0 ? … : '0%'` bar-width guard — are the complete state set this surface renders, and each
// is projected here. The all-zero payload is the natural "empty" rendering ($0 / $0 / 0 cups, never a blank
// box), reproduced verbatim.
//
// [SavingsData] mirrors the slice of the web `YearReview` interface this slide reads, with snake_case wire
// names via @SerialName and every field defaulted, so the projection runs straight off the cached
// `/analytics/year-review` JSON (a decoder ignoring unknown keys skips the dozens of other YearReview
// columns).
//
// Formatting parity (deliberate, non-silent asymmetry — pinned by SavingsSlideProjectionTest): the small
// comparison-bar amounts reproduce the web template literal `$${Math.round(value)}` — a bare integer with no
// locale grouping (so `$12000`, never `$12,000`). The headline savings, by contrast, goes through the web
// `<AnimatedNumber>` (→ `fmtNumber`, locale-grouped); that grouping is applied at the render boundary by the
// composable's count-up (shared `ChartFormat`), so the projection exposes the raw
// [SavingsSlideDisplay.gasSavings] and the composable formats it. Rounding uses [roundToLong]/[roundToInt],
// whose ties round towards positive infinity — matching JavaScript `Math.round` — and a non-finite value is
// coerced to 0 (web `safeNumber`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SavingsSlide — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AchievementBadge / SummaryStatsRow surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.savingsslide

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** The currency prefix the web hard-codes as a literal `$` (never i18n), mirroring `prefix="$"`. */
internal const val CURRENCY_PREFIX: String = "$"

/**
 * The slice of the web `YearReview` payload this slide reads — `gas_savings` (the headline, dollars saved vs
 * a gas car) and `total_charging_cost` (the electricity actually spent). Both keep their snake_case wire
 * names via @SerialName and default to 0.0, so the projection decodes straight off the cached
 * `/analytics/year-review` JSON even though that object carries dozens of other columns.
 *
 * @property gasSavings web `data.gas_savings` — dollars saved versus driving a gas car.
 * @property totalChargingCost web `data.total_charging_cost` — dollars actually spent on electricity.
 */
@Serializable
data class SavingsData(
    @SerialName("gas_savings") val gasSavings: Double = 0.0,
    @SerialName("total_charging_cost") val totalChargingCost: Double = 0.0,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property gasSavings the raw headline value (web `data.gas_savings`), fed to the composable's count-up
 *   which applies the locale grouping the web `<AnimatedNumber>` does (grouping is a render-boundary concern,
 *   so it is not pre-formatted here).
 * @property gasCostText the "gas would cost" figure, `$` + `Math.round(gasSavings + totalChargingCost)` as a
 *   bare (un-grouped) integer string — web `$${Math.round(gasCostEquiv)}`.
 * @property electricCostText the "electric cost" figure, `$` + `Math.round(totalChargingCost)`, bare — web
 *   `$${Math.round(data.total_charging_cost)}`.
 * @property electricBarPercent the electric bar's width as a whole-number percent of the gas-cost total
 *   (web `Math.round((total_charging_cost / gasCostEquiv) * 100)`, `0` when the total is non-positive); the
 *   composable divides by 100 (clamped to 0..1) for the fill fraction.
 * @property cupsOfCoffee the playful "cups of coffee" count, `Math.round(gas_savings / 5)`, interpolated into
 *   the savings-note string by the composable.
 */
data class SavingsSlideDisplay(
    val gasSavings: Double,
    val gasCostText: String,
    val electricCostText: String,
    val electricBarPercent: Int,
    val cupsOfCoffee: Long,
)

/**
 * Pure projection from a decoded [SavingsData] to its render-ready [SavingsSlideDisplay] — a 1:1 port of the
 * derivations the web component performs (`gasCostEquiv`, the two `Math.round` cost figures, the bar-width
 * percent, and the `cupsOfCoffee` count) before returning JSX.
 */
object SavingsSlideProjection {
    /** Web `data.gas_savings / 5`: the playful "a coffee costs ~$5" divisor behind the cups-of-coffee count. */
    const val COFFEE_PRICE: Double = 5.0

    private const val PERCENT_SCALE: Double = 100.0

    /** Select the render-ready view for [data]. */
    fun project(data: SavingsData): SavingsSlideDisplay {
        val equiv = gasCostEquiv(data)
        return SavingsSlideDisplay(
            gasSavings = data.gasSavings,
            gasCostText = dollars(equiv),
            electricCostText = dollars(data.totalChargingCost),
            electricBarPercent = electricBarPercent(data.totalChargingCost, equiv),
            cupsOfCoffee = cupsOfCoffee(data.gasSavings),
        )
    }

    /**
     * The hypothetical gas-car total — web `data.gas_savings + data.total_charging_cost`. This is what gas
     * would have cost (the savings plus what was actually spent on electricity), and the denominator of the
     * electric-bar fraction.
     */
    fun gasCostEquiv(data: SavingsData): Double = data.gasSavings + data.totalChargingCost

    /**
     * The web template-literal money string `$${Math.round(value)}` — a `$` prefix and a bare, un-grouped,
     * rounded integer (so `$12000`, not `$12,000`; the grouped figure is the headline's job, not the bars').
     * [roundToLong] rounds ties towards positive infinity to match JavaScript `Math.round`; a non-finite
     * value is coerced to 0, mirroring the web `safeNumber` guard.
     */
    fun dollars(value: Double): String = CURRENCY_PREFIX + roundHalfUp(value)

    /**
     * The electric bar's width as a whole-number percent of the gas-cost total — web
     * `gasCostEquiv > 0 ? Math.round((total_charging_cost / gasCostEquiv) * 100) : 0`. A non-positive total
     * yields 0 (the web's explicit `: 0` branch, and the guard that avoids a divide-by-zero / NaN width).
     */
    fun electricBarPercent(
        totalChargingCost: Double,
        gasCostEquiv: Double,
    ): Int {
        if (gasCostEquiv <= 0.0) return 0
        return roundHalfUpToInt(totalChargingCost / gasCostEquiv * PERCENT_SCALE)
    }

    /**
     * The playful cups-of-coffee count — web `Math.round(data.gas_savings / 5)`. Ties round towards positive
     * infinity (JS `Math.round`); a non-finite value is coerced to 0 (web `safeNumber`).
     */
    fun cupsOfCoffee(gasSavings: Double): Long = roundHalfUp(gasSavings / COFFEE_PRICE)

    private fun roundHalfUp(value: Double): Long = if (value.isFinite()) value.roundToLong() else 0L

    private fun roundHalfUpToInt(value: Double): Int = if (value.isFinite()) value.roundToInt() else 0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * savings amount, charging cost, or coffee count — so a diagnostics line can never leak a user's spend.
 */
object SavingsSlideDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SavingsSlide"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
