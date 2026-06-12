// Pure, framework-free model + projection for the Savings-Calculator feature view — the native analogue of
// everything the web component reads from its props (and the parent `useCostAnalysisData` memo computes)
// before returning JSX (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx). No Compose,
// no Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web component is purely presentational: its parent (the Cost Analysis page) holds the three user
// assumptions (gas price, MPG, electricity rate) and computes a `GasComparison` from the charging sessions +
// those assumptions, then passes the comparison + assumptions + change callbacks down. A self-contained native
// feature view owns its own assumptions (local UI state with the web defaults) and recomputes the comparison
// from a base-stats feed (the slice of the web `coreStats` the comparison reads) so the inputs are live, not
// dead chrome. This file owns exactly that derivation: the web `useCostAnalysisData` gasComparison formula
// ([computeComparison]), the per-card display projection ([projectCards] — note the EV card shows the ACTUAL
// recorded cost, never the theoretical `evCost`, exactly as the web does), the `Number(value) || fallback`
// input coercion ([coerceAssumption]), the locale-aware currency formatting ([savingsCurrencyFormatter] —
// the native `fmtNumber` + literal "$"), and the pure top-level surface classifier the composable switches on.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SavingsCalculator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.savingscalculator

import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SavingsCalculatorRegistration {
    /** Stable surface id. */
    const val ID: String = "savings-calculator"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SavingsCalculator"
}

/** Default gas price ($/gal) — verbatim web cost-analysis `constants.ts` `DEFAULT_GAS_PRICE`. */
const val DEFAULT_GAS_PRICE: Double = 3.5

/** Default gas-car fuel economy (MPG) — verbatim web `DEFAULT_MPG`. */
const val DEFAULT_MPG: Double = 30.0

/** Default electricity rate ($/kWh) — verbatim web `DEFAULT_ELECTRICITY_RATE`. */
const val DEFAULT_ELECTRICITY_RATE: Double = 0.13

/** The "$" marker prefixed to every formatted amount — the web literal "$" before `fmtNumber`. */
const val CURRENCY_PREFIX: String = "\$"

/** Unit suffix shown inside the gas-price field — the web `<Input suffix="$/gal">` (a symbol, not microcopy). */
const val SUFFIX_GAS_PRICE: String = "\$/gal"

/** Unit suffix shown inside the MPG field — the web `<Input suffix="mpg">`. */
const val SUFFIX_MPG: String = "mpg"

/** Unit suffix shown inside the electricity-rate field — the web `<Input suffix="$/kWh">`. */
const val SUFFIX_ELECTRICITY_RATE: String = "\$/kWh"

/** Fraction digits for the headline amounts — web `fmtNumber(x, 2)`. */
const val AMOUNT_FRACTION_DIGITS: Int = 2

/** Fraction digits for the per-distance rate sub-labels — web `fmtNumber(x, 3)`. */
const val RATE_FRACTION_DIGITS: Int = 3

/** Fraction digits for the yearly-savings estimate — web `fmtNumber(x, 0)`. */
const val YEARLY_FRACTION_DIGITS: Int = 0

/** Months per year — the web `monthlySavings * 12` annualization factor. */
const val MONTHS_PER_YEAR: Int = 12

/** The fallback a falsy MPG input coerces to — web `Number(e.target.value) || 1`. */
const val MPG_FALLBACK: Double = 1.0

/** The fallback a falsy gas-price / electricity-rate input coerces to — web `Number(...) || 0`. */
const val ZERO_FALLBACK: Double = 0.0

/**
 * The three user assumptions the calculator is parameterized by — the web `gasPrice` / `mpg` /
 * `electricityRate` props. [DEFAULTS] is the "Reset Defaults" target (the web `DEFAULT_*` constants).
 */
data class SavingsAssumptions(
    val gasPrice: Double,
    val mpg: Double,
    val electricityRate: Double,
) {
    companion object {
        /** The web reset target: `DEFAULT_GAS_PRICE` / `DEFAULT_MPG` / `DEFAULT_ELECTRICITY_RATE`. */
        val DEFAULTS: SavingsAssumptions =
            SavingsAssumptions(DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE)
    }
}

/**
 * The slice of the web `coreStats` the comparison reads — the payload the shared P1/S8 feed delivers. All SI
 * unit concerns are resolved upstream: [totalEnergyKwh] is the period energy in kWh (web
 * `coreStats.totalEnergy`), [totalCost] the actual recorded charging cost, [totalDistanceDisplay] the period
 * distance already in the user's display unit (web `toDistanceDisplay(totalDistanceM / 1609.344)`), and
 * [monthCount] the number of distinct months (web `monthlyData.length`) used to annualize.
 */
data class SavingsBaseStats(
    val totalEnergyKwh: Double,
    val totalCost: Double,
    val totalDistanceDisplay: Double,
    val monthCount: Int,
)

/**
 * The computed comparison — the native mirror of the web `GasComparison`. [evCost] is the THEORETICAL EV cost
 * (energy × rate) the web uses only inside [monthlySavings]; the "EV Cost (actual)" card displays [actualCost]
 * (the real recorded cost), never [evCost] — reproduced faithfully. [costPerDistanceGas] / [costPerDistanceEV]
 * are the web `costPerMileGas` / `costPerMileEV` (per the user's display distance unit, not necessarily miles).
 */
data class GasComparison(
    val gasCost: Double,
    val evCost: Double,
    val actualCost: Double,
    val savings: Double,
    val monthlySavings: Double,
    val yearlySavings: Double,
    val costPerDistanceGas: Double,
    val costPerDistanceEV: Double,
)

/** One render-ready comparison card — a formatted headline [value] over a formatted [sub] line. */
data class SavingsCardContent(
    val value: String,
    val sub: String,
)

/** The four render-ready comparison cards — the web 2×2 grid (Gas / EV / Total / Monthly). */
data class SavingsComparisonCards(
    val gas: SavingsCardContent,
    val ev: SavingsCardContent,
    val total: SavingsCardContent,
    val monthly: SavingsCardContent,
)

/**
 * The three mutually-exclusive top-level surfaces the comparison region renders. The presentational web
 * component has only "has comparison" vs "not enough data"; [Loading] and [Error] are the lifecycle chrome the
 * shared feature-view contract (P1/S8) carries, reproduced for full state coverage and never faked.
 */
enum class SavingsSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [SavingsSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready comparison). Kept framework-free so
 * each branch is asserted off-device.
 */
fun savingsSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): SavingsSurfaceState =
    when {
        isLoading -> SavingsSurfaceState.Loading
        isError -> SavingsSurfaceState.Error
        else -> SavingsSurfaceState.Ready
    }

/**
 * Coerces a typed assumption [raw] the way the web `Number(e.target.value) || fallbackWhenFalsy` does: a value
 * that parses to a finite, non-zero number is kept; a blank, non-numeric, zero, or non-finite input falls back.
 * The MPG field falls back to [MPG_FALLBACK] (web `|| 1`); the gas-price and electricity-rate fields to
 * [ZERO_FALLBACK] (web `|| 0`).
 */
fun coerceAssumption(
    raw: String,
    fallbackWhenFalsy: Double,
): Double {
    val parsed = runCatching { java.lang.Double.parseDouble(raw.trim()) }.getOrNull()
    return if (parsed == null || parsed == 0.0 || !parsed.isFinite()) fallbackWhenFalsy else parsed
}

/**
 * Builds the numeric [SavingsAssumptions] from the three raw field strings, applying the web per-field falsy
 * fallbacks (MPG → 1, the other two → 0).
 */
fun assumptionsFromInput(
    gasPriceRaw: String,
    mpgRaw: String,
    electricityRateRaw: String,
): SavingsAssumptions =
    SavingsAssumptions(
        gasPrice = coerceAssumption(gasPriceRaw, ZERO_FALLBACK),
        mpg = coerceAssumption(mpgRaw, MPG_FALLBACK),
        electricityRate = coerceAssumption(electricityRateRaw, ZERO_FALLBACK),
    )

/**
 * The text shown in an assumption field for a default [value]: a whole number renders without a trailing
 * `.0` (30.0 → "30") so the "Reset Defaults" affordance restores the same compact text the web numeric input
 * shows; a fractional value renders verbatim (3.5 → "3.5", 0.13 → "0.13").
 */
fun defaultAssumptionText(value: Double): String =
    if (value.isFinite() && value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/**
 * The pure projection the composable renders — the native mirror of the web parent's gasComparison memo and
 * the component's per-card reads. Stateless and side-effect-free so it is fully covered by the off-device gate.
 */
object SavingsCalculatorProjection {
    /**
     * Computes the [GasComparison] exactly as the web `useCostAnalysisData` memo does: a `null` [stats]
     * (the web `if (!coreStats) return null`, i.e. no charging sessions) yields `null` so the composable shows
     * the friendly "not enough data" empty state. Otherwise the gallons the gas car would burn over the period
     * are derived from the display distance and MPG, priced at the gas price; the theoretical EV cost is the
     * energy at the electricity rate; the monthly figure annualizes the gas-vs-theoretical-EV delta over the
     * month count; and the per-distance rates divide by the display distance (0 when there is no distance).
     * The intentional web quirks are preserved: `savings` compares gas cost to the ACTUAL cost while
     * `monthlySavings` uses the theoretical EV cost, and `costPerDistanceEV` uses the actual cost.
     */
    fun computeComparison(
        stats: SavingsBaseStats?,
        assumptions: SavingsAssumptions,
    ): GasComparison? {
        if (stats == null) return null
        val distance = stats.totalDistanceDisplay
        val gallonsNeeded = if (assumptions.mpg != 0.0) distance / assumptions.mpg else 0.0
        val gasCost = gallonsNeeded * assumptions.gasPrice
        val evCost = stats.totalEnergyKwh * assumptions.electricityRate
        val monthlySavings =
            if (stats.monthCount > 0) (gasCost - evCost) / max(stats.monthCount, 1) else 0.0
        return GasComparison(
            gasCost = gasCost,
            evCost = evCost,
            actualCost = stats.totalCost,
            savings = gasCost - stats.totalCost,
            monthlySavings = monthlySavings,
            yearlySavings = monthlySavings * MONTHS_PER_YEAR,
            costPerDistanceGas = if (distance > 0.0) gasCost / distance else 0.0,
            costPerDistanceEV = if (distance > 0.0) stats.totalCost / distance else 0.0,
        )
    }

    /**
     * Projects a [comparison] into the four render-ready cards via the injected [currency] formatter (kept
     * injectable so the projection stays locale-deterministic under test), reproducing every web card read:
     * Gas Cost (`gasCost`, sub `costPerDistanceGas`/unit), EV Cost (the ACTUAL `actualCost`, sub
     * `costPerDistanceEV`/unit), Total Savings (`savings`, sub [overPeriodLabel]), and Monthly Savings
     * (`monthlySavings`, sub `~`+`yearlySavings`+[perYearLabel]).
     */
    fun projectCards(
        comparison: GasComparison,
        distanceUnit: String,
        currency: (Double, Int) -> String,
        overPeriodLabel: String,
        perYearLabel: String,
    ): SavingsComparisonCards =
        SavingsComparisonCards(
            gas =
                SavingsCardContent(
                    value = currency(comparison.gasCost, AMOUNT_FRACTION_DIGITS),
                    sub = "${currency(comparison.costPerDistanceGas, RATE_FRACTION_DIGITS)}/$distanceUnit",
                ),
            ev =
                SavingsCardContent(
                    value = currency(comparison.actualCost, AMOUNT_FRACTION_DIGITS),
                    sub = "${currency(comparison.costPerDistanceEV, RATE_FRACTION_DIGITS)}/$distanceUnit",
                ),
            total =
                SavingsCardContent(
                    value = currency(comparison.savings, AMOUNT_FRACTION_DIGITS),
                    sub = overPeriodLabel,
                ),
            monthly =
                SavingsCardContent(
                    value = currency(comparison.monthlySavings, AMOUNT_FRACTION_DIGITS),
                    sub = "~${currency(comparison.yearlySavings, YEARLY_FRACTION_DIGITS)} $perYearLabel",
                ),
        )

    /**
     * Folds a card's [label] + [content] into a single TalkBack content description ("<label>: <value>, <sub>")
     * so each card reads as one node; the composable applies it via `clearAndSetSemantics`.
     */
    fun cardDescription(
        label: String,
        content: SavingsCardContent,
    ): String = "$label: ${content.value}, ${content.sub}"
}

/**
 * Builds the locale-aware currency formatter the cards use — the native `fmtNumber` / `toLocaleString(locale,
 * { minimumFractionDigits, maximumFractionDigits })` with a literal "$" prefix. A non-finite value is coerced
 * to `0`, matching the web `safeNumber` guard (so a card reads "$0.00", never "$NaN"). Pure (java.text only)
 * so the formatting is unit-tested deterministically with a fixed [locale].
 */
fun savingsCurrencyFormatter(locale: Locale): (Double, Int) -> String =
    { value, fractionDigits ->
        val safe = if (value.isFinite()) value else 0.0
        val format = NumberFormat.getNumberInstance(locale)
        format.isGroupingUsed = true
        format.minimumFractionDigits = fractionDigits
        format.maximumFractionDigits = fractionDigits
        CURRENCY_PREFIX + format.format(safe)
    }

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — every
 * `costAnalysis.calculator.*` key the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (loading / error / retry / offline / freshness) are resolved inline at the Compose boundary, so this holder
 * stays a thin content carrier.
 */
data class SavingsCalculatorStrings(
    val title: String,
    val inputsTitle: String,
    val gasPriceLabel: String,
    val mpgLabel: String,
    val electricityRateLabel: String,
    val resetLabel: String,
    val comparisonTitle: String,
    val gasCostLabel: String,
    val evCostLabel: String,
    val totalSavingsLabel: String,
    val overPeriodLabel: String,
    val monthlySavingsLabel: String,
    val perYearLabel: String,
    val noDataLabel: String,
)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SavingsCalculatorRegistration.SLUG]
 * (P1/S11) — never a VIN, location, cost, or charging value. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordSavingsCalculatorOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SavingsCalculatorRegistration.SLUG))
}
