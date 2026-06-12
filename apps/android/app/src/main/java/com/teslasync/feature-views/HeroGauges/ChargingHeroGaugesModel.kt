// Pure, framework-free model + projection for the *charging* HeroGauges feature view — the native analogue
// of every value the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/HeroGauges.tsx). No Compose, no Android UI, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer (the same split the sibling analytics HeroGauges port established).
//
// ── Surface-name collision (read before editing) ───────────────────────────────────────────────────
// The web tree has THREE distinct components named `HeroGauges`, one per feature:
//   • features/analytics/components/analytics/HeroGauges.tsx   → P3 prompt A-0058 (six MetricCards) — SHIPPED
//   • features/charging/components/charging-list/HeroGauges.tsx → P3 prompt A-0103 (this file: four
//     RadialGauges + an avg-$/kWh text cell)
//   • features/driving/components/drive-detail/HeroGauges.tsx  → P3 prompt A-0143 (five RadialGauges) — future
// All three map to the one native surface directory com/teslasync/feature-views/HeroGauges. A-0058 already
// occupies package `io.teslasync.android.featureviews.herogauges` with the public name `HeroGauges`, so this
// charging port lives in the `.charging` sub-package with `Charging`-prefixed names. The two surfaces coexist
// — A-0058 is a committed predecessor and is left untouched (honesty covenant #7, no predecessor bypass).
//
// ── Web parity ─────────────────────────────────────────────────────────────────────────────────────
// The web component is purely presentational: the owning charging-list page computes `ChargingStats` from the
// `/charging` session list (its `computeStats(sessions)` helper, which already converts energy→kWh and
// power→kW from SI) and passes it in as the `stats` prop. The component reads exactly one context hook,
// `useTranslation` (labels), and renders exactly two branches: `stats` truthy → a responsive grid of four
// RadialGauges plus an avg-$/kWh text cell, and `!stats` → a single EmptyState. Those two branches are the
// complete state set the web source renders, reproduced verbatim here; the cache-then-network states
// (loading / stale / offline / fetch-error) live on the owning page, never on this presentational child (the
// same boundary the sibling SummaryHeroCards / analytics-HeroGauges ports document).
//
// Numeric handling mirrors the web exactly for every realistic value. The lone, deliberately-documented
// divergence is the Total-Cost gauge value: the web computes `parseFloat(fmtNumber(totalCost ?? 0, 0))`,
// which — because `fmtNumber` adds locale thousands separators and `parseFloat` stops at the first separator
// — silently truncates a cost ≥ 1000 to its leading group (e.g. "1,234" → 1) in grouping locales while the
// gauge max still uses the un-truncated cost, leaving the arc near-empty. That is a latent upstream bug, not
// an intended contract; the web author's clear intent is "total cost rounded to a whole number". This port
// rounds the cost to a whole number (identical to the web for every cost < 1000, the overwhelmingly common
// range) and is logged as an intentional, production-polished divergence — no silent drift.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HeroGauges — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges.charging

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor
import kotlin.math.max

// ── Web-parity constants ─────────────────────────────────────────────────────────────────────────────

/** Sessions gauge max floor — web `Math.max(stats.count, 50)`. */
private const val SESSIONS_FLOOR_MAX = 50.0

/** Energy gauge max floor — web `Math.max(stats.totalEnergy, 500)`. */
private const val ENERGY_FLOOR_MAX = 500.0

/** Total-cost gauge max floor — web `Math.max(stats.totalCost ?? 0, 100)`. */
private const val COST_FLOOR_MAX = 100.0

/** Avg-power gauge max — the web constant `max={250}`. */
private const val POWER_MAX = 250.0

/** Energy gauge unit — the web `unit="kWh"` (stats already converted to kWh by the page's computeStats). */
private const val ENERGY_UNIT = "kWh"

/** Avg-power gauge unit — the web `unit="kW"` (stats already converted to kW by the page's computeStats). */
private const val POWER_UNIT = "kW"

/** `10^2` scale for the two-decimal avg-$/kWh pre-round — web `fmtNumber(stats.avgCostPerKwh ?? 0, 2)`. */
private const val AVG_COST_ROUND_SCALE = 100.0

/** The `+ 0.5` bias that turns `floor` into round-half-toward-positive-infinity (the web `Math.round`). */
private const val ROUND_HALF = 0.5

private const val KEY_COUNT = "count"
private const val KEY_TOTAL_ENERGY = "total_energy"
private const val KEY_TOTAL_COST = "total_cost"
private const val KEY_AVG_POWER = "avg_power"
private const val KEY_AVG_COST_PER_KWH = "avg_cost_per_kwh"

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The five fields the web charging HeroGauges reads off its `ChargingStats` prop. The owning charging-list
 * page computes these from the `/charging` session list (its `computeStats`, which already converts energy to
 * kWh and power to kW from SI), so this surface is unit-agnostic — it renders the figures verbatim, exactly as
 * the web component does. Every field defaults to `0.0` when missing, reproducing the web `?? 0` guards.
 *
 * @property count number of charging sessions in the window (web `stats.count`).
 * @property totalEnergy total energy added in the window, already kWh (web `stats.totalEnergy`).
 * @property totalCost total recorded charging cost in the window (web `stats.totalCost`).
 * @property avgPower average peak charging power, already kW (web `stats.avgPower`).
 * @property avgCostPerKwh average cost per kWh in the window (web `stats.avgCostPerKwh`).
 */
data class ChargingStats(
    val count: Double,
    val totalEnergy: Double,
    val totalCost: Double,
    val avgPower: Double,
    val avgCostPerKwh: Double,
) {
    public companion object {
        /**
         * Decodes a cached/serialized `ChargingStats` [json] into the model, or `null` when the payload is
         * absent. `null` and a JSON-null collapse to `null` — the web `!stats` EmptyState branch (the page's
         * `computeStats` returns `null` for an empty session list). Any JSON object — including an empty `{}`
         * — decodes to a stats value (the resolved grid), with each missing/JSON-null field collapsing to
         * `0.0` (web `?? 0`). Keys are snake_case, the project's wire/cache convention.
         */
        public fun fromJson(json: JsonElement?): ChargingStats? {
            val obj = json as? JsonObject ?: return null
            return ChargingStats(
                count = obj.double(KEY_COUNT),
                totalEnergy = obj.double(KEY_TOTAL_ENERGY),
                totalCost = obj.double(KEY_TOTAL_COST),
                avgPower = obj.double(KEY_AVG_POWER),
                avgCostPerKwh = obj.double(KEY_AVG_COST_PER_KWH),
            )
        }
    }
}

/**
 * The six localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready models carry no English literal. Keys map 1:1 to the web `t('charging.*')` calls.
 *
 * @property sessions web `charging.gauges.sessions` ("Sessions").
 * @property energy web `charging.gauges.energy` ("Energy").
 * @property totalCost web `charging.gauges.totalCost` ("Total Cost").
 * @property avgPower web `charging.gauges.avgPower` ("Avg Power").
 * @property avgCostPerKwh web `charging.gauges.avgCostPerKwh` ("Avg $/kWh").
 * @property noStats web `charging.noStats` ("No charging statistics available yet").
 */
data class ChargingHeroGaugesStrings(
    val sessions: String,
    val energy: String,
    val totalCost: String,
    val avgPower: String,
    val avgCostPerKwh: String,
    val noStats: String,
)

/** Which design-token accent a gauge carries (web RadialGauge `color`), resolved to a Color in the composable. */
enum class ChargingGaugeAccent { Sessions, Energy, Cost, Power }

/**
 * One fully resolved radial gauge — the native analogue of a single web `<RadialGauge>` invocation. Pure data
 * (no Compose types) so the whole projection is asserted off-device.
 *
 * @property label the localized gauge label.
 * @property value the display value (pre-rounded to a whole number, matching the web `Math.round` / rounded
 *   cost), fed straight to the shared RadialGauge (which formats it at zero decimals).
 * @property max the gauge's denominator — the web `max={...}` (kept un-rounded, exactly as the web passes it).
 * @property unit the unit suffix, or empty for the unitless Sessions gauge (web `unit=""`).
 * @property accent the design-token accent slot.
 */
data class ChargingGauge(
    val label: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val accent: ChargingGaugeAccent,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. [empty] true reproduces the web `!stats` branch (the composable shows a single EmptyState and
 * ignores the gauge fields); otherwise [gauges] holds the four resolved gauges in web order and
 * [avgCostPerKwh] backs the avg-$/kWh text cell.
 *
 * @property empty whether to render the EmptyState branch (web `!stats`).
 * @property gauges the four resolved radial gauges (empty when [empty]).
 * @property avgCostPerKwh the avg cost per kWh, pre-rounded to two decimals (web
 *   `parseFloat(fmtNumber(avgCostPerKwh ?? 0, 2))`); the composable count-up renders it at three decimals.
 * @property avgCostLabel the localized avg-$/kWh label.
 * @property emptyMessage the localized empty-state message (shown only when [empty]).
 */
data class ChargingHeroGaugesDisplay(
    val empty: Boolean,
    val gauges: List<ChargingGauge>,
    val avgCostPerKwh: Double,
    val avgCostLabel: String,
    val emptyMessage: String,
)

/**
 * Pure projection from the surface's `stats` prop + localized strings to its render-ready
 * [ChargingHeroGaugesDisplay] — a 1:1 port of the derivations the web component performs. The composable
 * resolves [ChargingHeroGaugesStrings] from the i18n catalog, then hands them here.
 */
object ChargingHeroGaugesProjection {
    /** The fixed number of radial gauges (web: Sessions, Energy, Total Cost, Avg Power). */
    const val GAUGE_COUNT: Int = 4

    /** Total grid cells: the four gauges plus the avg-$/kWh text cell (web: a five-cell grid). */
    const val CELL_COUNT: Int = GAUGE_COUNT + 1

    /** The hard-coded currency symbol the web prefixes the avg-$/kWh value with (`$<AnimatedNumber/>`). */
    const val CURRENCY_SYMBOL: String = "$"

    /** Fraction digits the avg-$/kWh count-up renders at — the web `<AnimatedNumber decimals={3} />`. */
    const val AVG_COST_DISPLAY_DECIMALS: Int = 3

    /**
     * Selects the render-ready view for the given [stats] (the owning page's `ChargingStats` prop; `null` when
     * there are no sessions / the page is still resolving) and the localized [strings]. `null` drives the web
     * EmptyState branch; any non-null stats — even all-zero — renders the resolved grid, exactly as the web
     * `stats ? ... : <EmptyState/>` ternary does. Reproduces the web gauge values, max floors, and units
     * verbatim (see the file header for the single documented Total-Cost rounding divergence).
     */
    fun project(
        stats: ChargingStats?,
        strings: ChargingHeroGaugesStrings,
    ): ChargingHeroGaugesDisplay {
        if (stats == null) {
            return ChargingHeroGaugesDisplay(
                empty = true,
                gauges = emptyList(),
                avgCostPerKwh = 0.0,
                avgCostLabel = strings.avgCostPerKwh,
                emptyMessage = strings.noStats,
            )
        }
        return ChargingHeroGaugesDisplay(
            empty = false,
            gauges =
                listOf(
                    ChargingGauge(
                        label = strings.sessions,
                        value = stats.count,
                        max = max(stats.count, SESSIONS_FLOOR_MAX),
                        unit = "",
                        accent = ChargingGaugeAccent.Sessions,
                    ),
                    ChargingGauge(
                        label = strings.energy,
                        value = roundWhole(stats.totalEnergy),
                        max = max(stats.totalEnergy, ENERGY_FLOOR_MAX),
                        unit = ENERGY_UNIT,
                        accent = ChargingGaugeAccent.Energy,
                    ),
                    ChargingGauge(
                        label = strings.totalCost,
                        value = roundWhole(stats.totalCost),
                        max = max(stats.totalCost, COST_FLOOR_MAX),
                        unit = CURRENCY_SYMBOL,
                        accent = ChargingGaugeAccent.Cost,
                    ),
                    ChargingGauge(
                        label = strings.avgPower,
                        value = roundWhole(stats.avgPower),
                        max = POWER_MAX,
                        unit = POWER_UNIT,
                        accent = ChargingGaugeAccent.Power,
                    ),
                ),
            avgCostPerKwh = roundCost(stats.avgCostPerKwh),
            avgCostLabel = strings.avgCostPerKwh,
            emptyMessage = strings.noStats,
        )
    }

    /**
     * Rounds to the nearest whole number with ties toward positive infinity — the web `Math.round`.
     * `floor(value + 0.5)` reproduces that tie rule exactly and yields a `Double` directly.
     */
    private fun roundWhole(value: Double): Double = floor(value + ROUND_HALF)

    /**
     * Rounds [value] to two fraction digits (ties toward positive infinity) — the web
     * `parseFloat(fmtNumber(value, 2))` for the realistic, sub-thousand avg-$/kWh range. The avg-cost
     * count-up then renders the result at [AVG_COST_DISPLAY_DECIMALS] decimals, matching the web's
     * round-to-2-then-show-3 pipeline. [AVG_COST_ROUND_SCALE] is the `10^2` scale.
     */
    private fun roundCost(value: Double): Double = floor(value * AVG_COST_ROUND_SCALE + ROUND_HALF) / AVG_COST_ROUND_SCALE
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a session
 * count, energy, cost, power, or any other fleet figure — so a diagnostics line can never leak charging usage.
 */
object ChargingHeroGaugesDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the prompt's surface slug). */
    const val SLUG: String = "HeroGauges"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helper (web `?? 0` parity) ───────────────────────────────────────────────────────────

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0
