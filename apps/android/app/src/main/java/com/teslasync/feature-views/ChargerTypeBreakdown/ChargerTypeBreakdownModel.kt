// Pure, framework-free model + projection for the ChargerTypeBreakdown feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ChargerTypeBreakdown is purely presentational: the Cost-Analysis page passes it an already-aggregated,
// cost-descending `ChargerTypeData[]` plus the lifetime `totalCost`, and it draws a donut of the per-charger
// cost share alongside a per-charger breakdown (cost · sessions, energy kWh, cost/kWh, and the share %). Its
// only web hooks are `useTranslation` (mapped to the i18n catalog) and `useFormatting` (mapped to the shared
// settings holder for the currency symbol). This file owns exactly the value derivations the web render
// performs: the share-of-total percentage (web `(entry.cost / totalCost) * 100`), the proportional pie sweep
// (web `<Pie dataKey="cost">`, whose denominator is the sum of the charted costs), the per-row cost·sessions /
// energy / cost-per-kWh / percent strings, and the per-charger color resolution (web `CHARGER_COLORS[name] ??
// CHART_COLORS[4]`). Row order is preserved as supplied so the donut, legend, and breakdown all read alike.
//
// SI on the wire, display units at the boundary: the energy field is already kWh (the page converts the SI
// watt-hours via `convertEnergyFromSI` before constructing the datum, exactly as the web component receives
// kWh in its `ChargerTypeData.energy`), so this file performs no unit math — it only formats. The currency
// symbol is the single `useFormatting` input the component needs (both `formatCurrency` call sites pass
// explicit decimals, so the user's decimal-precision default never applies here).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargerTypeBreakdown — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ChargerTypeChart / ChargingBreakdownSlide
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargertypebreakdown

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Middot separating the cost and the session count in a breakdown summary — the web `·` literal. */
internal const val MIDDOT: String = "\u00B7"

/** Em dash shown for an undefined cost-per-kWh (web `'—'`) and for an unknown freshness age. */
internal const val EM_DASH: String = "\u2014"

/** Energy unit suffix — the web `fmtWithUnit(entry.energy, 'kWh', 1)` literal. Units are never localized. */
internal const val KWH_UNIT: String = "kWh"

/** Cost-per-kWh suffix — the web `${formatCurrency(...)}/kWh` literal. */
internal const val PER_KWH_SUFFIX: String = "/kWh"

/** Percent sign appended to the share value — the web `{fmtNumber(pct, 1)}%`. */
internal const val PERCENT_SUFFIX: String = "%"

/** Fraction digits for a cost amount (web `formatCurrency(entry.cost, 2)`). */
internal const val COST_DECIMALS: Int = 2

/** Fraction digits for the cost-per-kWh rate (web `formatCurrency(entry.cost / entry.energy, 3)`). */
internal const val RATE_DECIMALS: Int = 3

/** Fraction digits for the energy figure (web `fmtWithUnit(entry.energy, 'kWh', 1)`). */
internal const val ENERGY_DECIMALS: Int = 1

/** Fraction digits for the share percentage (web `fmtNumber(pct, 1)`). */
internal const val PERCENT_DECIMALS: Int = 1

/** Percent scale — the web `* 100`. */
private const val PERCENT_SCALE: Double = 100.0

/**
 * The charger category a breakdown row belongs to — the stable, locale-independent key the Cost-Analysis page
 * assigns when it builds `ChargerTypeData` (`categorizeCharger` returns the English display name and
 * `CHARGER_COLORS[name]` maps it to a hue). Kept as an enum so the swatch / pie / bar color is resolved from
 * design tokens at the render boundary (P1/S9) rather than carrying a raw hex through the model, while the
 * grouping stays correct across locales.
 */
enum class ChargerColorRole {
    /** Tesla Supercharger (web `CHARGER_COLORS['Supercharger']` = `#ef4444`). */
    Supercharger,

    /** Non-Tesla public DC fast charging (web `CHARGER_COLORS['Public DC']` = `#a855f7`). */
    PublicDc,

    /** Workplace / Level-2 AC charging (web `CHARGER_COLORS['Work / L2']` = `#f59e0b`). */
    WorkL2,

    /** Home charging (web `CHARGER_COLORS['Home']` = `#10b981`). */
    Home,

    /** Any other category — the web `?? CHART_COLORS[4]` fallback (`#56B4E9`). */
    Fallback,
}

/**
 * One charger-type row supplied by the host — the native mirror of the web `ChargerTypeData`, minus the
 * pre-computed `color` (recomputed identically from [name] at the render boundary so no raw hex enters the
 * model). [cost] is the lifetime spend for the category in the user's currency, [energyKwh] the energy added
 * in kWh (already converted from SI by the page, web `ChargerTypeData.energy`), and [sessions] the count.
 */
data class ChargerTypeDatum(
    val name: String,
    val cost: Double,
    val energyKwh: Double,
    val sessions: Long,
)

/**
 * The two web props bundled as one host-supplied value so the surface can carry them through a single
 * cache-then-network [io.teslasync.android.data.UiState]. [data] is the cost-descending charger rows (web
 * `data`) and [totalCost] the lifetime total the share percentages divide by (web `totalCost`).
 */
data class ChargerTypeBreakdownInput(
    val data: List<ChargerTypeDatum>,
    val totalCost: Double,
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test — the
 * native analogue of the web `useFormatting.formatCurrency` + `fmtInt` / `fmtWithUnit` / `fmtNumber` calls.
 * [currency] formats a monetary amount with an explicit fraction-digit count (web `formatCurrency(amount,
 * decimals)`); [count] formats a session count with grouping (web `fmtInt`); [energy] formats the kWh figure
 * (web `fmtWithUnit(_, 'kWh', 1)`); [percent] formats the share value to one fraction digit (web
 * `fmtNumber(pct, 1)`), with the `%` sign appended by the projection.
 */
data class ChargerTypeBreakdownFormatters(
    val currency: (amount: Double, decimals: Int) -> String,
    val count: (Long) -> String,
    val energy: (Double) -> String,
    val percent: (Double) -> String,
)

/**
 * One render-ready breakdown row — the native analogue of the web per-entry block (the colored swatch, the
 * name, the "{cost} · {sessions} sessions" line, the share bar, and the "{energy} / {rate} / {pct}" footer).
 * Pure strings + numbers (no Compose types) so the projection is unit-tested without a UI host. [pct] drives
 * the bar width (web `width: ${pct}%`) and [pieFraction] the donut sweep (web `<Pie dataKey="cost">`).
 */
data class ChargerTypeBreakdownRow(
    val name: String,
    val colorRole: ChargerColorRole,
    val pct: Double,
    val pieFraction: Double,
    val costSessionsText: String,
    val energyText: String,
    val rateText: String,
    val percentText: String,
    val accessibilityText: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. [rows] are the per-charger breakdown rows in supplied order; [isEmpty] mirrors the web
 * `data.length > 0 ? … : <noData>` branch so the composable shows the friendly empty state instead of a blank
 * panel.
 */
data class ChargerTypeBreakdownResult(
    val rows: List<ChargerTypeBreakdownRow>,
    val isEmpty: Boolean,
)

/**
 * Pure projection from the host inputs to the render-ready [ChargerTypeBreakdownResult] — a 1:1 port of the
 * derivations the web component performs per entry. Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate.
 */
object ChargerTypeBreakdownProjection {
    /**
     * Resolves a charger [name] to its [ChargerColorRole], mirroring the web `CHARGER_COLORS[name] ??
     * CHART_COLORS[4]` lookup: the four Cost-Analysis display names map to their dedicated hues and anything
     * else folds to the categorical fallback. The name is trimmed before matching so incidental padding never
     * defeats the lookup.
     */
    fun colorRole(name: String): ChargerColorRole =
        when (name.trim()) {
            "Supercharger" -> ChargerColorRole.Supercharger
            "Public DC" -> ChargerColorRole.PublicDc
            "Work / L2" -> ChargerColorRole.WorkL2
            "Home" -> ChargerColorRole.Home
            else -> ChargerColorRole.Fallback
        }

    /**
     * Projects the cost-descending [data] + [totalCost] into render-ready rows via the injected [formatters],
     * preserving order. Mirrors the web per-entry derivations: the share `(cost / totalCost) * 100` (0 when
     * `totalCost <= 0`), the proportional pie sweep `cost / Σcost` (0 when the charted total is non-positive),
     * the "{cost} · {sessions} {sessionsLabel}" line, the "{energy} kWh" figure, the "{cost/energy}/kWh" rate
     * (em dash when energy is non-positive, web `entry.energy > 0 ? … : '—'`), and the "{pct}%" share text.
     */
    fun project(
        data: List<ChargerTypeDatum>,
        totalCost: Double,
        formatters: ChargerTypeBreakdownFormatters,
        sessionsLabel: String,
    ): ChargerTypeBreakdownResult {
        if (data.isEmpty()) return ChargerTypeBreakdownResult(rows = emptyList(), isEmpty = true)
        val costSum = data.sumOf { it.cost }
        val rows =
            data.map { datum ->
                val pct = if (totalCost > 0.0) (datum.cost / totalCost) * PERCENT_SCALE else 0.0
                val pieFraction = if (costSum > 0.0) datum.cost / costSum else 0.0
                val costSessions =
                    "${formatters.currency(datum.cost, COST_DECIMALS)} " +
                        "$MIDDOT ${formatters.count(datum.sessions)} $sessionsLabel"
                val energyText = formatters.energy(datum.energyKwh)
                val rateText =
                    if (datum.energyKwh > 0.0) {
                        "${formatters.currency(datum.cost / datum.energyKwh, RATE_DECIMALS)}$PER_KWH_SUFFIX"
                    } else {
                        EM_DASH
                    }
                val percentText = "${formatters.percent(pct)}$PERCENT_SUFFIX"
                ChargerTypeBreakdownRow(
                    name = datum.name,
                    colorRole = colorRole(datum.name),
                    pct = pct,
                    pieFraction = pieFraction,
                    costSessionsText = costSessions,
                    energyText = energyText,
                    rateText = rateText,
                    percentText = percentText,
                    accessibilityText = "${datum.name}, $costSessions, $energyText, $rateText, $percentText",
                )
            }
        return ChargerTypeBreakdownResult(rows = rows, isEmpty = false)
    }
}

/**
 * The single `useFormatting` input this surface needs — the currency [symbol], derived from the shared
 * `/settings` document exactly as the web `useFormatting` does (`currency_symbol`, blank → "$"). The decimal
 * precision is intentionally not modeled: both web `formatCurrency` call sites in the component pass explicit
 * decimals (2 for a cost, 3 for a rate), so the user's precision default never participates here.
 */
data class ChargerCurrencySettings(
    val symbol: String = DEFAULT_SYMBOL,
) {
    /** The symbol with the web blank/whitespace → "$" fallback applied. */
    val resolvedSymbol: String get() = symbol.ifBlank { DEFAULT_SYMBOL }

    companion object {
        /** Default currency symbol (web blank → "$"). */
        const val DEFAULT_SYMBOL: String = "$"

        /** The all-default preferences ("$"), for previews / cold start before settings load. */
        val DEFAULT: ChargerCurrencySettings = ChargerCurrencySettings()

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /**
         * Derives the currency preference from the raw `/settings` document — the Kotlin port of the web
         * `useFormatting` currency read: a non-blank `currency_symbol` wins, otherwise "$".
         */
        fun from(settings: JsonElement?): ChargerCurrencySettings {
            val obj = settings as? JsonObject ?: return DEFAULT
            val raw = (obj[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull
            return ChargerCurrencySettings(symbol = if (!raw.isNullOrBlank()) raw else DEFAULT_SYMBOL)
        }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a cost, an
 * energy figure, or a session count — so a diagnostics line can never leak a user's charging spend.
 */
object ChargerTypeBreakdownDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "charger-type-breakdown"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ChargerTypeBreakdown"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
