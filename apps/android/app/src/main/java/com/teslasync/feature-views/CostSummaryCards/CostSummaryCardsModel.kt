// Pure, framework-free model + projection for the CostSummaryCards feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// CostSummaryCards is a presentational surface — the web component takes `coreStats: CoreStats | null`,
// `gasPrice`, `distanceUnit` and `isMiles` as props from the owning CostAnalysisPage (which owns the charging
// query and computes the stats in `useCostAnalysisData`), and reads three context hooks for display:
// `useTranslation` (labels, P1/S10), `useFormatting` (the currency symbol + precision, the native binding of
// the S8 SettingsStore) and `useSettings` (the gas-unit label). It renders six StatBox tiles in a responsive
// 2 / 3 / 6-column grid: Total Cost, Avg $/kWh, Cost Per {Mile|km}, Total Energy, Gas Savings $, Savings %.
//
// Following the sibling SummaryHeroCards port, the owning page threads the computed stats in through the
// shared cache-then-network state-holder layer (P1/S8) as a [UiState]; the [projectUiState] adapter lets the
// composable render every lifecycle state that layer can carry — a loading skeleton grid, a hard error with
// retry, a friendly empty state (the web `!sessions` branch), content, and stale/offline "last known" —
// without ever fetching. The content branch reproduces the web StatBox grid exactly, including the per-card
// glow and icon accent and the composed subtitles.
//
// Number + currency formatting goes through the golden-pinned shared [ChartFormat.number], the native mirror
// of the web `fmtNumber` / `fmtInt` / `fmtWithUnit` (including the web `safeNumber` non-finite to 0 guard).
// The nine `t('costAnalysis.stats.*')` calls resolve from the i18n catalog (P1/S10) at the Compose boundary
// and arrive here as [CostSummaryStrings]. The web source also renders a handful of inline connector/unit
// literals that carry NO i18n key on any platform (the "per " and "vs " connectors, the "gal equiv" / "kWh"
// unit suffixes, the "Mile" / "km" distance words and the "gal" / "L" gas-unit label, the "%" sign and the
// "/" separator); adding catalog keys is outside this surface's allowed-files scope, so — exactly as the
// sibling SummaryHeroCards port composes its symbol-only subtitle from constants — they are reproduced
// verbatim here from documented web-parity constants, never an ad-hoc English string in the view.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CostSummaryCards — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costsummarycards

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

// ── Web-parity constants ────────────────────────────────────────────────────────────────────────────

/** Web `formatCurrency(totalCost, 2)` / `formatCurrency(savings, 2)` precision (two fraction digits). */
private const val COST_DECIMALS = 2

/** Web `formatCurrency(avgCostPerKwh, 3)` / `formatCurrency(costPerDist, 3)` precision (three fraction digits). */
private const val RATE_DECIMALS = 3

/** Web `fmtWithUnit(totalEnergy, 'kWh', 1)` / `fmtWithUnit(gallonsEquiv, 'gal equiv', 1)` precision. */
private const val ENERGY_DECIMALS = 1

/** Web `fmtNumber(savingsPercent, 1)` precision (one fraction digit). */
private const val PERCENT_DECIMALS = 1

/** Web `fmtInt(count)` precision (zero fraction digits, locale grouping). */
private const val INT_DECIMALS = 0

/** Energy unit suffix the web source hard-codes (`fmtWithUnit(totalEnergy, 'kWh', 1)`), not converted. */
private const val ENERGY_UNIT = "kWh"

/** Gasoline-equivalent unit suffix the web source hard-codes (`fmtWithUnit(gallonsEquiv, 'gal equiv', 1)`). */
private const val GAL_EQUIV_UNIT = "gal equiv"

/** Trailing percent sign appended to the Savings % value (web `${fmtNumber(savingsPercent, 1)}%`). */
private const val PERCENT_SIGN = "%"

/** Leading connector of the Cost-Per-distance subtitle (web `per ${distanceUnit}`). Trailing space intended. */
private const val PER_PREFIX = "per "

/** Leading connector of the Gas-Savings subtitle (web `vs ${formatCurrency(gasPrice, 2)}/…`). Trailing space. */
private const val VS_PREFIX = "vs "

/** Separator between the gas price and its unit in the Gas-Savings subtitle (web `…/${gasUnitLabel}`). */
private const val PER_UNIT_SEPARATOR = "/"

/** Web `unit: isMiles ? 'Mile' : 'km'` — the imperial distance word substituted into the Cost-Per label. */
private const val MILE_WORD = "Mile"

/** Web `unit: isMiles ? 'Mile' : 'km'` — the metric distance word substituted into the Cost-Per label. */
private const val KM_WORD = "km"

/** Web `settings.gas_unit` document key, read for the gas-unit label. */
private const val KEY_GAS_UNIT = "gas_unit"

/** Web `settings.gas_unit === 'liter'` sentinel value. */
private const val GAS_UNIT_LITER = "liter"

/** Web `settings.gas_unit === 'liter' ? 'L' : 'gal'` — the litre gas-unit label. */
private const val GAS_LABEL_LITER = "L"

/** Web `settings.gas_unit === 'liter' ? 'L' : 'gal'` — the (default) gallon gas-unit label. */
private const val GAS_LABEL_GALLON = "gal"

private const val DEFAULT_CURRENCY = "$"
private const val DEFAULT_PRECISION = 2
private const val DEFAULT_LOCALE_TAG = "en-US"
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The eight `CoreStats` fields the web CostSummaryCards reads off its `coreStats` prop — the subset of the
 * larger web `CoreStats` type (web/src/features/charging/components/cost-analysis/types.ts) that THIS surface
 * renders. All monetary/ratio figures are doubles mirroring the web `number` shape; [count] is the integer
 * session count (web `coreStats.count`, rendered with `fmtInt`). The owning page computes them as finite sums,
 * and the formatters additionally apply the web `safeNumber` non-finite to 0 guard.
 *
 * @property totalCost summed session cost (web `coreStats.totalCost`).
 * @property count number of charging sessions (web `coreStats.count`).
 * @property avgCostPerKwh blended cost per kWh (web `coreStats.avgCostPerKwh`).
 * @property costPerDist cost per user-preferred distance unit (web `coreStats.costPerDist`).
 * @property totalEnergy total energy added, kWh (web `coreStats.totalEnergy`).
 * @property gallonsEquiv gasoline-gallon energy equivalent (web `coreStats.gallonsEquiv`).
 * @property savings money saved versus gasoline (web `coreStats.savings`).
 * @property savingsPercent savings as a percentage of the gas cost (web `coreStats.savingsPercent`).
 */
data class CostSummaryStats(
    val totalCost: Double,
    val count: Int,
    val avgCostPerKwh: Double,
    val costPerDist: Double,
    val totalEnergy: Double,
    val gallonsEquiv: Double,
    val savings: Double,
    val savingsPercent: Double,
)

/**
 * The full prop bundle the owning page threads into this surface — the web component's `coreStats` plus the
 * `gasPrice`, `distanceUnit` and `isMiles` props, grouped so the host has a single value to carry through the
 * [UiState].
 *
 * @property stats the eight figures the six cards render (web `coreStats`, non-null in the content state).
 * @property gasPrice the gas price the Savings subtitle compares against (web `gasPrice`).
 * @property distanceUnit the user's distance-unit abbreviation, `mi` or `km` (web `distanceUnit`).
 * @property isMiles whether the user prefers miles, selecting the Cost-Per label's distance word (web `isMiles`).
 */
data class CostSummarySnapshot(
    val stats: CostSummaryStats,
    val gasPrice: Double,
    val distanceUnit: String,
    val isMiles: Boolean,
)

// ── Render-ready projection types ──────────────────────────────────────────────────────────────────

/** The web StatBox `glow` prop — tints the panel border accent (web GlassPanel glow). */
enum class CostStatGlow { Cyan, Green, None }

/** The web icon color (`text-{color}-400`) applied as the tile glyph tint. */
enum class CostStatIconTone { Cyan, Yellow, Blue, Green, Red, Emerald }

/** Which authored lucide glyph a tile carries (web `icon`), resolved to an ImageVector in the composable. */
enum class CostStatIcon { Dollar, Zap, Car, Fuel, TrendingDown }

/**
 * One fully resolved StatBox tile — the native analogue of a single web `<StatBox>` invocation. Pure data (no
 * Compose types) so the whole projection is asserted off-device. The [label] is already localized (resolved
 * from the i18n catalog at the Compose boundary and handed in via [CostSummaryStrings]); the [sub] is the
 * composed secondary line.
 *
 * @property label the localized tile label (web `label`).
 * @property value the formatted primary value, unit/symbol included (web `value`).
 * @property sub the secondary line, or `null` when the web omits it (web `sub`).
 * @property glow the panel border accent (web `glow`).
 * @property iconTone the glyph tint (web icon `text-{color}-400`).
 * @property icon the glyph slot (web `icon`).
 */
data class CostSummaryCard(
    val label: String,
    val value: String,
    val sub: String?,
    val glow: CostStatGlow,
    val iconTone: CostStatIconTone,
    val icon: CostStatIcon,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready cards carry no English literal. Keys map 1:1 to the web `t('costAnalysis.stats.*')` calls;
 * [costPerDistTemplate] is the raw "Cost Per %1$s" resource into which the projection substitutes the
 * distance word.
 */
data class CostSummaryStrings(
    val totalCost: String,
    val sessions: String,
    val avgPerKwh: String,
    val blendedRate: String,
    val costPerDistTemplate: String,
    val totalEnergy: String,
    val gasSavings: String,
    val savingsPercent: String,
    val vsGasoline: String,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useFormatting` reads (currency symbol + precision), the `fmtNumber` global locale, and the
 * `useSettings` gas-unit label. Resolved from one settings document, mirroring the web hooks which all derive
 * from `useSettings`.
 *
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace to "$" fallback applied.
 * @property precision the default fraction digits (web `useFormatting` `userPrecision`); the cards override it
 *   with explicit decimals per the web calls, so this is the cold-start default only.
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 * @property gasUnitLabel the gas-unit label, `gal` or `L` (web `settings.gas_unit === 'liter' ? 'L' : 'gal'`).
 */
data class CostSummaryDisplayPrefs(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
    val gasUnitLabel: String,
) {
    companion object {
        /** The "$", 2-dp, en-US, "gal" defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: CostSummaryDisplayPrefs = from(null)

        /** Resolves the currency + precision + locale + gas-unit preferences from one `/settings` document. */
        fun from(settings: JsonElement?): CostSummaryDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = obj.stringOrNull(KEY_CURRENCY_SYMBOL)
            return CostSummaryDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = unitPref.precision ?: DEFAULT_PRECISION,
                locale = localeFor(unitPref.locale),
                gasUnitLabel = if (obj.stringOrNull(KEY_GAS_UNIT) == GAS_UNIT_LITER) GAS_LABEL_LITER else GAS_LABEL_GALLON,
            )
        }

        private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
    }
}

// ── Projection ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's prop + display preferences to its render-ready cards — a 1:1 port of the
 * derivations the web component performs. The composable resolves [CostSummaryStrings] and
 * [CostSummaryDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object CostSummaryCardsProjection {
    /**
     * Maps the host's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] — the native expression of the web `if (!sessions || sessions.length === 0)`
     * empty branch (no charging data, so no `coreStats`). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error, which the composable renders too.
     */
    fun projectUiState(
        snapshot: CostSummarySnapshot?,
        isLoading: Boolean,
    ): UiState<CostSummarySnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six StatBox tiles in web source order. Each value/subtitle reproduces the matching web call — the
     * `formatCurrency` costs, the `fmtWithUnit` energy, the `fmtNumber` percentage, the composed
     * `${fmtInt(count)} sessions` / `per ${distanceUnit}` / `vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`
     * subtitles — formatted for [prefs] (locale grouping + the user's currency + gas-unit label), with the
     * verbatim glow and icon accent the web hard-codes per tile.
     */
    fun cards(
        snapshot: CostSummarySnapshot,
        prefs: CostSummaryDisplayPrefs,
        strings: CostSummaryStrings,
    ): List<CostSummaryCard> {
        val s = snapshot.stats
        val locale = prefs.locale
        return listOf(
            CostSummaryCard(
                label = strings.totalCost,
                value = formatCurrency(s.totalCost, prefs, COST_DECIMALS),
                sub = fmt(s.count.toDouble(), INT_DECIMALS, locale) + " " + strings.sessions, // parity:allow Int to Double widening
                glow = CostStatGlow.Cyan,
                iconTone = CostStatIconTone.Cyan,
                icon = CostStatIcon.Dollar,
            ),
            CostSummaryCard(
                label = strings.avgPerKwh,
                value = formatCurrency(s.avgCostPerKwh, prefs, RATE_DECIMALS),
                sub = strings.blendedRate,
                glow = CostStatGlow.None,
                iconTone = CostStatIconTone.Yellow,
                icon = CostStatIcon.Zap,
            ),
            CostSummaryCard(
                label = costPerDistanceLabel(strings.costPerDistTemplate, snapshot.isMiles, locale),
                value = formatCurrency(s.costPerDist, prefs, RATE_DECIMALS),
                sub = PER_PREFIX + snapshot.distanceUnit,
                glow = CostStatGlow.None,
                iconTone = CostStatIconTone.Blue,
                icon = CostStatIcon.Car,
            ),
            CostSummaryCard(
                label = strings.totalEnergy,
                value = withUnit(s.totalEnergy, ENERGY_UNIT, ENERGY_DECIMALS, locale),
                sub = withUnit(s.gallonsEquiv, GAL_EQUIV_UNIT, ENERGY_DECIMALS, locale),
                glow = CostStatGlow.Green,
                iconTone = CostStatIconTone.Green,
                icon = CostStatIcon.Zap,
            ),
            CostSummaryCard(
                label = strings.gasSavings,
                value = formatCurrency(s.savings, prefs, COST_DECIMALS),
                sub = gasSavingsSub(snapshot.gasPrice, prefs),
                glow = CostStatGlow.Green,
                iconTone = CostStatIconTone.Red,
                icon = CostStatIcon.Fuel,
            ),
            CostSummaryCard(
                label = strings.savingsPercent,
                value = fmt(s.savingsPercent, PERCENT_DECIMALS, locale) + PERCENT_SIGN,
                sub = strings.vsGasoline,
                glow = CostStatGlow.Green,
                iconTone = CostStatIconTone.Emerald,
                icon = CostStatIcon.TrendingDown,
            ),
        )
    }

    /**
     * The Gas-Savings subtitle — the web `vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`: the "vs "
     * connector, the gas price at two decimals, the "/" separator and the resolved gas-unit label.
     */
    fun gasSavingsSub(
        gasPrice: Double,
        prefs: CostSummaryDisplayPrefs,
    ): String = VS_PREFIX + formatCurrency(gasPrice, prefs, COST_DECIMALS) + PER_UNIT_SEPARATOR + prefs.gasUnitLabel

    /**
     * The Cost-Per tile label — the web `t('costAnalysis.stats.costPerDist', { unit: isMiles ? 'Mile' : 'km' })`.
     * Substitutes the imperial/metric distance word into the raw "Cost Per %1$s" [template] using [locale] so a
     * locale-specific format string still resolves correctly.
     */
    fun costPerDistanceLabel(
        template: String,
        isMiles: Boolean,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, template, if (isMiles) MILE_WORD else KM_WORD)

    /**
     * Formats a currency [amount] the way the web `useFormatting().formatCurrency` does — the resolved
     * [CostSummaryDisplayPrefs.currencySymbol] followed by a grouped number via the shared [ChartFormat.number].
     * [decimals] defaults to the user's precision; the cards pass explicit decimals per the web calls.
     */
    fun formatCurrency(
        amount: Double,
        prefs: CostSummaryDisplayPrefs,
        decimals: Int = prefs.precision,
        locale: Locale = prefs.locale,
    ): String = prefs.currencySymbol + fmt(amount, decimals, locale)

    /**
     * A grouped number at [decimals] fraction digits — the web `fmtNumber`, including its `safeNumber` guard
     * (a non-finite value renders as 0 rather than the [ChartFormat] em-dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)

    /** A grouped number with a trailing [unit] (web `fmtWithUnit`): `${fmtNumber(value, decimals)} ${unit}`. */
    private fun withUnit(
        value: Double,
        unit: String,
        decimals: Int,
        locale: Locale,
    ): String = fmt(value, decimals, locale) + " " + unit
}

// ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a cost,
 * energy, savings, session count, or gas-price figure — so a diagnostics line can never leak fleet usage or
 * charging economics.
 */
object CostSummaryCardsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "CostSummaryCards"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helper (web blank/whitespace → "$" parity) ────────────────────────────────────────────

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
