// Pure, framework-free model + analyzers + classifier + diagnostics for the InsightsEngine shared
// surface — the native analogue of web/src/components/data-display/InsightsEngine.tsx together with
// the one hook it reads, web/src/hooks/useFormatting.ts (`useFormatting().formatCurrency`). No
// Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source actually is (and therefore the COMPLETE behaviour this surface reproduces):
// `InsightsEngine` is a "smart insights" panel. It takes a caller-supplied `data: InsightData`
// (drives, charging sessions, energy stats, a battery report, vampire-drain stats), runs eight pure
// analyzers over it (charging cost, efficiency trend, battery health, optimal charging, vampire
// drain, driving patterns, EV cost savings, range optimization), and renders one card per produced
// insight (icon + title + trend arrow + description), or NOTHING when no analyzer fires. The only
// async dependency it has is the user's currency / precision preference (`useFormatting`), which
// flows in through the shared settings state holder as [InsightsFormatting] — exactly the dependency
// shape the accepted sibling `Delta` surface binds.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent):
//   * The web returns `null` when there are zero insights. P3 forbids a hidden surface, so the empty
//     branch renders a friendly [InsightsSurface.Empty] instead (the documented adaptation the
//     sibling Delta / VisuallyHidden ports also take).
//   * The web component itself fetches nothing, so it has no loading / error / stale / offline state
//     of its own — those belong to the feed-backed parent that computes `data`. To honour the P3
//     "every state renders" contract WITHOUT fabricating web behaviour, the surface accepts the
//     parent's [InsightsFeedStatus] alongside the data (default [InsightsFeedStatus.Ready], which
//     reproduces the pure web content/empty behaviour) and folds it onto the loading / content /
//     empty / failed branches here. This mirrors how the web parent threads its query lifecycle into
//     the panel; the surface still performs NO fetching.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/InsightsEngine — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

// ─── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────

/** Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). */
const val INSIGHTS_ENGINE_SLUG: String = "InsightsEngine"

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [INSIGHTS_ENGINE_SLUG]
 * (P1/S11) — never a drive, session, vehicle id, or any computed insight text, so a diagnostics line
 * can never leak the operator's fleet state. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordInsightsOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to INSIGHTS_ENGINE_SLUG))
}

// ─── Display-formatting context (the native `useFormatting`) ──────────────────────────────────

/** Fallback currency glyph when settings carry none (web `useFormatting` `: '$'`). */
private const val DEFAULT_CURRENCY_SYMBOL: String = "$"

/** Default decimal precision when settings specify none (web `useFormatting` `?? 2`). */
private const val DEFAULT_PRECISION: Int = 2

/** Settings key carrying the user's currency glyph (web `settings.currency_symbol`). */
private const val CURRENCY_SYMBOL_KEY: String = "currency_symbol"

/** Settings key carrying the user's default decimal precision (web `settings.decimal_precision`). */
private const val DECIMAL_PRECISION_KEY: String = "decimal_precision"

/** Settings key carrying the user's BCP-47 locale tag (number grouping / separators). */
private const val LOCALE_KEY: String = "locale"

/**
 * The resolved display-formatting context an [InsightsEngine] renders against — the native
 * consolidation of web `useFormatting().currencySymbol` + the user precision + the locale used for
 * `fmtNumber`. The source maps the live settings document into this so a currency / precision change
 * re-renders every insight without the view knowing how the preference is stored.
 *
 * @property currencySymbol the user's currency glyph (web `useFormatting().currencySymbol`), `$` when
 *   unset.
 * @property precision the user's default decimal precision (web `useFormatting` user precision).
 * @property localeTag the BCP-47 tag used for grouping / separators; `null` ⇒ en-US (web default).
 */
data class InsightsFormatting(
    val currencySymbol: String = DEFAULT_CURRENCY_SYMBOL,
    val precision: Int = DEFAULT_PRECISION,
    val localeTag: String? = null,
) {
    /** The JVM [Locale] for grouping / separators; en-US when no tag is set (web default). */
    val locale: Locale get() = resolveLocale(localeTag)

    /** Locale-aware number formatting — the native mirror of web `fmtNumber(value, decimals)`. */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /**
     * The native mirror of web `useFormatting().formatCurrency(amount, decimals?)`: the currency
     * glyph immediately followed by the formatted magnitude. Defaults to the user [precision].
     */
    fun formatCurrency(
        amount: Double,
        decimals: Int = precision,
    ): String = "$currencySymbol${number(amount, decimals)}"

    companion object {
        /** The metric-default context for previews / cold start before settings load (web defaults). */
        val DEFAULT: InsightsFormatting = InsightsFormatting()

        /**
         * Builds an [InsightsFormatting] from the raw `/settings` document — the native mirror of the
         * web `useFormatting` derivation: the currency glyph, the floored non-negative precision
         * (`?? 2`), and the grouping locale.
         */
        fun fromSettings(settings: JsonElement?): InsightsFormatting {
            val obj = settings as? JsonObject
            return InsightsFormatting(
                currencySymbol = parseCurrencySymbol(obj),
                precision = parsePrecision(obj),
                localeTag = parseString(obj, LOCALE_KEY),
            )
        }

        private fun parseCurrencySymbol(obj: JsonObject?): String {
            val raw = parseString(obj, CURRENCY_SYMBOL_KEY)
            return if (!raw.isNullOrBlank()) raw else DEFAULT_CURRENCY_SYMBOL
        }

        private fun parsePrecision(obj: JsonObject?): Int {
            val raw = (obj?.get(DECIMAL_PRECISION_KEY) as? JsonPrimitive)?.doubleOrNull
            return if (raw != null && raw.isFinite() && raw >= 0.0) floor(raw).toInt() else DEFAULT_PRECISION
        }

        private fun parseString(
            obj: JsonObject?,
            key: String,
        ): String? = (obj?.get(key) as? JsonPrimitive)?.contentOrNull
    }
}

/** Resolves a BCP-47 [tag] to a JVM [Locale] for grouping / separators; en-US when blank (web default). */
fun resolveLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

// ─── Caller-supplied input (the web `InsightData` prop) ───────────────────────────────────────

/**
 * One drive the analyzers read (web `Drive`). [distanceM] is SI metres (web `distance_m`),
 * [energyUsedWh] SI watt-hours or `null` (web `energy_used_wh`), [startTsMillis] the drive start as
 * epoch milliseconds (web `start_ts`, fed through `new Date(...)`).
 */
data class InsightDrive(
    val distanceM: Double,
    val energyUsedWh: Double?,
    val startTsMillis: Long,
)

/**
 * One charging session the analyzers read (web `ChargingSession`). [cost] is the session cost or
 * `null` (web `cost`), [chargeEnergyAddedKwh] the energy added in kWh (web `charge_energy_added`),
 * [fastChargerType] the non-empty Supercharger type string or `null`/blank for home (web
 * `fast_charger_type`), [endBatteryLevelPct] the ending charge level or `null` (web
 * `end_battery_level`).
 */
data class InsightChargingSession(
    val cost: Double?,
    val chargeEnergyAddedKwh: Double,
    val fastChargerType: String?,
    val endBatteryLevelPct: Double?,
)

/**
 * Aggregate energy stats the analyzers read (web `EnergyStats`): total energy consumed (kWh), total
 * distance (km), total cost, CO₂ saved (kg), and average efficiency (Wh/km).
 */
data class InsightEnergyStats(
    val totalEnergyUsedKwh: Double,
    val totalDistanceKm: Double,
    val totalCost: Double,
    val co2SavedKg: Double,
    val avgEfficiencyWhKm: Double,
)

/** One point of the battery monthly-capacity trend (web `BatteryReport.monthly_trend[i].capacity_pct`). */
data class InsightBatteryTrendPoint(
    val capacityPct: Double,
)

/**
 * The battery health report the analyzer reads (web `BatteryReport`). [healthScore] gates the insight
 * (web `if (!report.health_score)`), [currentCapacityPct] / [degradationPct] drive the body, the
 * [monthlyTrend] derives the yearly degradation rate, and the optional rated / current range
 * estimates feed the range-optimization analyzer.
 */
data class InsightBatteryReport(
    val healthScore: Double?,
    val currentCapacityPct: Double,
    val degradationPct: Double,
    val monthlyTrend: List<InsightBatteryTrendPoint>,
    val estimatedRangeNewKm: Double?,
    val estimatedRangeCurrentKm: Double?,
)

/**
 * Vampire-drain stats the analyzer reads (web `VampireDrainStats`): the event count gate, the average
 * Sentry / no-Sentry hourly drains, the overall drain rate (%/hr), and the total range lost.
 */
data class InsightVampireDrainStats(
    val eventCount: Int,
    val avgSentryDrain: Double,
    val avgNoSentryDrain: Double,
    val avgDrainRate: Double,
    val totalRangeLost: Double,
)

/**
 * The caller-supplied analysis inputs — the native analogue of the web `InsightData` prop. Every
 * field is optional / possibly-empty exactly as in the web type; an absent feed simply suppresses the
 * analyzers that depend on it.
 */
data class InsightData(
    val drives: List<InsightDrive> = emptyList(),
    val chargingSessions: List<InsightChargingSession> = emptyList(),
    val energyStats: InsightEnergyStats? = null,
    val batteryReport: InsightBatteryReport? = null,
    val vampireDrainStats: InsightVampireDrainStats? = null,
)

// ─── Produced insight model ───────────────────────────────────────────────────────────────────

/** The card icon for an insight — the render boundary maps each onto a concrete `ImageVector`. */
enum class InsightIcon { DollarSign, Efficiency, Battery, BatteryCharging, Shield, Car, Leaf, Clock }

/** The directional arrow glyph for an insight (web `TREND_ICON` key). */
enum class InsightTrend { Up, Down, Neutral }

/** The card accent severity (web `Severity`); the render boundary maps it onto the theme palette. */
enum class InsightSeverity { Info, Success, Warning, Alert }

/** The localized card title key — the render boundary maps each onto a `translation_insights_*` string. */
enum class InsightTitleKey {
    ChargingCost,
    EfficiencyTrend,
    BatteryHealth,
    OptimalCharging,
    VampireDrain,
    DrivingPatterns,
    CostSavings,
    RangeOptimization,
}

/**
 * The localized body / phrase key — the render boundary maps each onto a `translation_insights_*`
 * string. Body keys take positional arguments; the leaf phrase keys (aging quality, day names,
 * range advice) are nested arguments resolved by the view and substituted into a body key.
 */
enum class InsightBodyKey {
    ChargingCostAvg,
    ChargingCostHomeSavings,
    ChargingCostHomeHigher,
    EfficiencyImproved,
    EfficiencyDecreased,
    BatteryHealthBody,
    BatteryAgingExpected,
    BatteryAgingWorse,
    BatteryAgingBetter,
    OptimalChargingAvg,
    OptimalChargingExceed,
    OptimalChargingIdeal,
    VampireSentry,
    VampireSummary,
    DrivingPatternsBody,
    DaySunday,
    DayMonday,
    DayTuesday,
    DayWednesday,
    DayThursday,
    DayFriday,
    DaySaturday,
    CostSavingsBody,
    RangeOptimizationBody,
    RangeAdviceImprove,
    RangeAdviceGood,
}

/**
 * One argument substituted into a localized body segment. [Raw] is an already-formatted number /
 * string (the analyzer formatted it through [InsightsFormatting]); [Res] is a nested localized phrase
 * the view resolves from the catalog before substituting (the aging-quality, day-name, range-advice
 * phrases the web embeds mid-sentence).
 */
sealed interface InsightArg {
    /** A pre-formatted, locale-correct literal substituted verbatim. */
    data class Raw(
        val text: String,
    ) : InsightArg

    /** A nested catalog phrase the view resolves (no positional args) before substituting. */
    data class Res(
        val key: InsightBodyKey,
    ) : InsightArg
}

/**
 * One localized segment of an insight's description — a [key] plus its positional [args]. The view
 * resolves the key against the catalog with the resolved args; the full description is the segments
 * joined by a space, mirroring the web `description +=` concatenation.
 */
data class InsightSegment(
    val key: InsightBodyKey,
    val args: List<InsightArg> = emptyList(),
)

/**
 * A produced insight — the native analogue of the web `Insight`. [tone] is the pre-computed color
 * intent for the trend arrow (folding the web `trendGood` + `trendColor` quirk), so the view only
 * maps it onto a theme color; [body] is the localized, formatted description.
 */
data class Insight(
    val id: String,
    val icon: InsightIcon,
    val titleKey: InsightTitleKey,
    val body: List<InsightSegment>,
    val trend: InsightTrend,
    val tone: DeltaTone,
    val severity: InsightSeverity,
)

/**
 * The render-ready color intent for a [trend] arrow — the faithful fold of the web coloring rule:
 * when `trendGood`, an up arrow is good (green) and a down arrow is bad (red) (web `TREND_ICON`);
 * when NOT `trendGood`, the web overrides with `trendColor` which INVERTS (up → bad, down → good).
 * Both collapse to: an up arrow is good exactly when it is the "good" direction, i.e. `up == good`.
 * Neutral is always muted.
 */
fun insightTone(
    trend: InsightTrend,
    trendGood: Boolean,
): DeltaTone =
    when {
        trend == InsightTrend.Neutral -> DeltaTone.Muted
        (trend == InsightTrend.Up) == trendGood -> DeltaTone.Good
        else -> DeltaTone.Bad
    }

// ─── Analyzers (faithful ports of the web analysis helpers) ───────────────────────────────────

/** Minimum cost-bearing sessions before the charging-cost insight fires (web `< 2`). */
private const val MIN_CHARGING_SESSIONS: Int = 2

/** Minimum valid drives before the efficiency-trend insight fires (web `< 4`). */
private const val MIN_EFFICIENCY_DRIVES: Int = 4

/** Minimum sessions with an end level before the optimal-charging insight fires (web `< 3`). */
private const val MIN_OPTIMAL_SESSIONS: Int = 3

/** Minimum drives before the driving-patterns insight fires (web `< 3`). */
private const val MIN_PATTERN_DRIVES: Int = 3

/** Watt-hours-per-metre → Wh/km scale (web `* 1000`). */
private const val WH_PER_M_TO_WH_PER_KM: Double = 1000.0
private const val PERCENT: Double = 100.0
private const val DEGRADATION_WORSE_PCT: Double = 10.0
private const val DEGRADATION_BETTER_PCT: Double = 5.0
private const val DEGRADATION_TREND_PCT: Double = 8.0
private const val MONTHS_PER_YEAR: Double = 12.0
private const val OPTIMAL_HIGH_PCT: Double = 80.0
private const val OPTIMAL_MAJORITY_PCT: Double = 50.0
private const val SENTRY_SIGNIFICANT_PCT: Double = 20.0
private const val HOURS_PER_DAY: Double = 24.0
private const val MS_PER_DAY: Double = 86_400_000.0
private const val METERS_PER_KM: Double = 1000.0
private const val DAYS_IN_WEEK: Int = 7
private const val HOURS_IN_DAY: Int = 24

/** Gasoline-equivalent litres per 100 km for the cost-savings comparison (web `8.5`). */
private const val GAS_L_PER_100KM: Double = 8.5

/** Gasoline price per litre for the cost-savings comparison (web `1.50`). */
private const val GAS_PRICE_PER_L: Double = 1.50
private const val PER_100KM: Double = 100.0

/** Nominal rated consumption (Wh/km) baseline for range optimization (web `150`). */
private const val RATED_EFFICIENCY_WH_KM: Double = 150.0

/** Fallback rated range (km) when the battery report carries none (web `?? 500`). */
private const val FALLBACK_RATED_RANGE_KM: Double = 500.0
private const val RANGE_EXCELLENT_PCT: Double = 90.0
private const val RANGE_GOOD_PCT: Double = 85.0
private const val RANGE_OK_PCT: Double = 80.0

private const val CURRENCY_DECIMALS: Int = 2
private const val ONE_DECIMAL: Int = 1
private const val NO_DECIMALS: Int = 0
private const val DRAIN_DECIMALS: Int = 2

/** Web `analyzeChargingCost`: average $/kWh and an optional home-vs-Supercharger comparison. */
private fun analyzeChargingCost(
    sessions: List<InsightChargingSession>,
    formatting: InsightsFormatting,
): Insight? {
    val withCost = sessions.filter { it.cost != null && it.chargeEnergyAddedKwh > 0.0 }
    if (withCost.size < MIN_CHARGING_SESSIONS) return null

    val home = withCost.filter { it.fastChargerType.isNullOrEmpty() }
    val supercharger = withCost.filter { !it.fastChargerType.isNullOrEmpty() }
    val overall = avgCostPerKwh(withCost)
    val homeCost = if (home.isNotEmpty()) avgCostPerKwh(home) else null
    val scCost = if (supercharger.isNotEmpty()) avgCostPerKwh(supercharger) else null

    val body =
        mutableListOf(
            InsightSegment(InsightBodyKey.ChargingCostAvg, listOf(InsightArg.Raw(formatting.formatCurrency(overall, CURRENCY_DECIMALS)))),
        )
    var trend = InsightTrend.Neutral
    var trendGood = true
    if (homeCost != null && scCost != null && scCost > 0.0) {
        val savings = ((scCost - homeCost) / scCost) * PERCENT
        if (savings > 0.0) {
            body += InsightSegment(InsightBodyKey.ChargingCostHomeSavings, listOf(InsightArg.Raw(formatting.number(savings, NO_DECIMALS))))
            trend = InsightTrend.Up
        } else {
            body += InsightSegment(InsightBodyKey.ChargingCostHomeHigher)
            trend = InsightTrend.Down
            trendGood = false
        }
    }
    return Insight(
        id = "charging-cost",
        icon = InsightIcon.DollarSign,
        titleKey = InsightTitleKey.ChargingCost,
        body = body,
        trend = trend,
        tone = insightTone(trend, trendGood),
        severity = InsightSeverity.Info,
    )
}

private fun avgCostPerKwh(sessions: List<InsightChargingSession>): Double {
    val totalCost = sessions.sumOf { it.cost ?: 0.0 }
    val totalEnergy = sessions.sumOf { it.chargeEnergyAddedKwh }
    return if (totalEnergy > 0.0) totalCost / totalEnergy else 0.0
}

/** Web `analyzeEfficiencyTrend`: recent-half vs older-half Wh/km change. */
@Suppress("ReturnCount")
private fun analyzeEfficiencyTrend(
    drives: List<InsightDrive>,
    formatting: InsightsFormatting,
): Insight? {
    val valid = drives.filter { it.distanceM > 0.0 && it.energyUsedWh != null }
    if (valid.size < MIN_EFFICIENCY_DRIVES) return null

    val half = valid.size / 2
    val recent = efficiencyWhKm(valid.subList(0, half))
    val older = efficiencyWhKm(valid.subList(half, valid.size))
    if (older == 0.0) return null

    val changePct = ((older - recent) / older) * PERCENT
    val improved = changePct > 0.0
    val magnitude = formatting.number(abs(changePct), ONE_DECIMAL)
    val bodyKey = if (improved) InsightBodyKey.EfficiencyImproved else InsightBodyKey.EfficiencyDecreased
    val trend = if (improved) InsightTrend.Up else InsightTrend.Down
    val severity = if (improved) InsightSeverity.Success else InsightSeverity.Warning
    return Insight(
        "efficiency-trend",
        InsightIcon.Efficiency,
        InsightTitleKey.EfficiencyTrend,
        listOf(InsightSegment(bodyKey, listOf(InsightArg.Raw(magnitude)))),
        trend,
        insightTone(trend, improved),
        severity,
    )
}

private fun efficiencyWhKm(drives: List<InsightDrive>): Double {
    val totalDist = drives.sumOf { it.distanceM }
    val totalEnergy = drives.sumOf { it.energyUsedWh ?: 0.0 }
    return if (totalDist > 0.0) (totalEnergy / totalDist) * WH_PER_M_TO_WH_PER_KM else 0.0
}

/** Web `analyzeBatteryHealth`: current health, yearly degradation rate, and aging quality. */
private fun analyzeBatteryHealth(
    report: InsightBatteryReport,
    formatting: InsightsFormatting,
): Insight? {
    if (report.healthScore == null || report.healthScore == 0.0) return null

    val degradation = report.degradationPct
    val agingKey =
        when {
            degradation > DEGRADATION_WORSE_PCT -> InsightBodyKey.BatteryAgingWorse
            degradation < DEGRADATION_BETTER_PCT -> InsightBodyKey.BatteryAgingBetter
            else -> InsightBodyKey.BatteryAgingExpected
        }
    val severity = if (degradation > DEGRADATION_WORSE_PCT) InsightSeverity.Warning else InsightSeverity.Success
    val yearlyRate = yearlyDegradationRate(report.monthlyTrend, degradation)
    val trend = if (degradation > DEGRADATION_TREND_PCT) InsightTrend.Down else InsightTrend.Up
    return Insight(
        "battery-health",
        InsightIcon.Battery,
        InsightTitleKey.BatteryHealth,
        listOf(
            InsightSegment(
                InsightBodyKey.BatteryHealthBody,
                listOf(
                    InsightArg.Raw(formatting.number(report.currentCapacityPct, ONE_DECIMAL)),
                    InsightArg.Raw(formatting.number(yearlyRate, ONE_DECIMAL)),
                    InsightArg.Res(agingKey),
                ),
            ),
        ),
        trend,
        insightTone(trend, degradation <= DEGRADATION_TREND_PCT),
        severity,
    )
}

private fun yearlyDegradationRate(
    trend: List<InsightBatteryTrendPoint>,
    fallback: Double,
): Double {
    if (trend.size < 2) return fallback
    val first = trend.first().capacityPct
    val last = trend.last().capacityPct
    val months = trend.size
    return if (months > 0) ((first - last) / months) * MONTHS_PER_YEAR else fallback
}

/** Web `analyzeOptimalCharging`: average end level and the share of charges above 80%. */
private fun analyzeOptimalCharging(
    sessions: List<InsightChargingSession>,
    formatting: InsightsFormatting,
): Insight? {
    val withEnd = sessions.filter { it.endBatteryLevelPct != null }
    if (withEnd.size < MIN_OPTIMAL_SESSIONS) return null

    val avgEndLevel = withEnd.sumOf { it.endBatteryLevelPct ?: 0.0 } / withEnd.size
    val above80 = withEnd.count { (it.endBatteryLevelPct ?: 0.0) > OPTIMAL_HIGH_PCT }
    val above80Pct = above80 * PERCENT / withEnd.size

    val body =
        mutableListOf(
            InsightSegment(InsightBodyKey.OptimalChargingAvg, listOf(InsightArg.Raw(formatting.number(avgEndLevel, NO_DECIMALS)))),
        )
    val trendGood: Boolean
    val severity: InsightSeverity
    if (above80Pct > OPTIMAL_MAJORITY_PCT) {
        body += InsightSegment(InsightBodyKey.OptimalChargingExceed, listOf(InsightArg.Raw(formatting.number(above80Pct, NO_DECIMALS))))
        severity = InsightSeverity.Warning
        trendGood = false
    } else {
        body += InsightSegment(InsightBodyKey.OptimalChargingIdeal)
        severity = InsightSeverity.Success
        trendGood = true
    }
    val trend = if (trendGood) InsightTrend.Up else InsightTrend.Down
    return Insight(
        id = "optimal-charging",
        icon = InsightIcon.BatteryCharging,
        titleKey = InsightTitleKey.OptimalCharging,
        body = body,
        trend = trend,
        tone = insightTone(trend, trendGood),
        severity = severity,
    )
}

/** Web `analyzeVampireDrain`: Sentry-mode drain penalty or an overall idle-drain summary. */
@Suppress("ReturnCount")
private fun analyzeVampireDrain(
    stats: InsightVampireDrainStats,
    formatting: InsightsFormatting,
): Insight? {
    val sentryDrain = stats.avgSentryDrain
    val noSentryDrain = stats.avgNoSentryDrain
    if (stats.eventCount < 1 || (sentryDrain <= 0.0 && noSentryDrain <= 0.0)) return null

    val diffPct = if (noSentryDrain > 0.0) ((sentryDrain - noSentryDrain) / noSentryDrain) * PERCENT else 0.0
    val significant = diffPct > SENTRY_SIGNIFICANT_PCT
    val segment =
        if (significant) {
            InsightSegment(
                InsightBodyKey.VampireSentry,
                listOf(
                    InsightArg.Raw(formatting.number(diffPct, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(sentryDrain * HOURS_PER_DAY, ONE_DECIMAL)),
                ),
            )
        } else {
            InsightSegment(
                InsightBodyKey.VampireSummary,
                listOf(
                    InsightArg.Raw(formatting.number(stats.avgDrainRate, DRAIN_DECIMALS)),
                    InsightArg.Raw(formatting.number(stats.totalRangeLost, ONE_DECIMAL)),
                    InsightArg.Raw(stats.eventCount.toString()),
                ),
            )
        }
    val trend = if (significant) InsightTrend.Down else InsightTrend.Neutral
    val severity = if (significant) InsightSeverity.Warning else InsightSeverity.Info
    return Insight(
        id = "vampire-drain",
        icon = InsightIcon.Shield,
        titleKey = InsightTitleKey.VampireDrain,
        body = listOf(segment),
        trend = trend,
        tone = insightTone(trend, !significant),
        severity = severity,
    )
}

/** Web `analyzeDrivingPatterns`: daily average, busiest weekday, and peak driving hour. */
private fun analyzeDrivingPatterns(
    drives: List<InsightDrive>,
    formatting: InsightsFormatting,
    zone: ZoneId,
): Insight? {
    if (drives.size < MIN_PATTERN_DRIVES) return null

    val totalDist = drives.sumOf { it.distanceM }
    val zoned = drives.map { Instant.ofEpochMilli(it.startTsMillis).atZone(zone) }
    val daySpan =
        if (zoned.size > 1) {
            (zoned.first().toInstant().toEpochMilli() - zoned.last().toInstant().toEpochMilli()) / MS_PER_DAY
        } else {
            1.0
        }
    val avgDaily = if (daySpan > 0.0) totalDist / max(daySpan, 1.0) else totalDist

    val dayCounts = IntArray(DAYS_IN_WEEK)
    val hourCounts = IntArray(HOURS_IN_DAY)
    zoned.forEach {
        dayCounts[it.dayOfWeek.value % DAYS_IN_WEEK]++
        hourCounts[it.hour]++
    }
    val busiestDay = dayKeyFor(indexOfMax(dayCounts))
    val peakHour = indexOfMax(hourCounts)
    val peakEnd = (peakHour + 1) % HOURS_IN_DAY

    return Insight(
        "driving-patterns",
        InsightIcon.Car,
        InsightTitleKey.DrivingPatterns,
        listOf(
            InsightSegment(
                InsightBodyKey.DrivingPatternsBody,
                listOf(
                    InsightArg.Raw(formatting.number(avgDaily / METERS_PER_KM, ONE_DECIMAL)),
                    InsightArg.Res(busiestDay),
                    InsightArg.Raw(peakHour.toString()),
                    InsightArg.Raw(peakEnd.toString()),
                ),
            ),
        ),
        InsightTrend.Neutral,
        DeltaTone.Muted,
        InsightSeverity.Info,
    )
}

/** JS `getDay()` order (Sunday = 0) → the day-name catalog key. */
private fun dayKeyFor(index: Int): InsightBodyKey =
    when (index) {
        0 -> InsightBodyKey.DaySunday
        1 -> InsightBodyKey.DayMonday
        2 -> InsightBodyKey.DayTuesday
        3 -> InsightBodyKey.DayWednesday
        4 -> InsightBodyKey.DayThursday
        5 -> InsightBodyKey.DayFriday
        else -> InsightBodyKey.DaySaturday
    }

/** First index holding the maximum value (web `arr.indexOf(Math.max(...arr))`). */
private fun indexOfMax(counts: IntArray): Int {
    var bestIndex = 0
    for (i in counts.indices) {
        if (counts[i] > counts[bestIndex]) bestIndex = i
    }
    return bestIndex
}

/** Web `analyzeCostSavings`: EV cost vs a gasoline-equivalent estimate. */
@Suppress("ReturnCount")
private fun analyzeCostSavings(
    energy: InsightEnergyStats,
    formatting: InsightsFormatting,
): Insight? {
    val gasEquivalent = (energy.totalDistanceKm / PER_100KM) * GAS_L_PER_100KM * GAS_PRICE_PER_L
    val savings = gasEquivalent - energy.totalCost
    if (energy.totalEnergyUsedKwh <= 0.0 || savings <= 0.0) return null

    return Insight(
        "cost-savings",
        InsightIcon.Leaf,
        InsightTitleKey.CostSavings,
        listOf(
            InsightSegment(
                InsightBodyKey.CostSavingsBody,
                listOf(
                    InsightArg.Raw(formatting.formatCurrency(savings, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(energy.totalEnergyUsedKwh, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(energy.totalDistanceKm, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(energy.co2SavedKg, NO_DECIMALS)),
                ),
            ),
        ),
        InsightTrend.Up,
        insightTone(InsightTrend.Up, true),
        InsightSeverity.Success,
    )
}

/** Web `analyzeRangeOptimization`: effective range vs rated range at the user's efficiency. */
private fun analyzeRangeOptimization(
    energy: InsightEnergyStats,
    battery: InsightBatteryReport?,
    formatting: InsightsFormatting,
): Insight? {
    if (energy.avgEfficiencyWhKm <= 0.0) return null

    val effWhKm = energy.avgEfficiencyWhKm
    val ratedRange = battery?.estimatedRangeNewKm ?: FALLBACK_RATED_RANGE_KM
    val currentRange = battery?.estimatedRangeCurrentKm ?: ratedRange
    val effectiveRange = (RATED_EFFICIENCY_WH_KM / effWhKm) * currentRange
    val rangePct = if (currentRange > 0.0) (effectiveRange / currentRange) * PERCENT else PERCENT

    val adviceKey = if (rangePct < RANGE_GOOD_PCT) InsightBodyKey.RangeAdviceImprove else InsightBodyKey.RangeAdviceGood
    val trend =
        when {
            rangePct >= RANGE_EXCELLENT_PCT -> InsightTrend.Up
            rangePct >= RANGE_OK_PCT -> InsightTrend.Neutral
            else -> InsightTrend.Down
        }
    val severity =
        when {
            rangePct >= RANGE_EXCELLENT_PCT -> InsightSeverity.Success
            rangePct >= RANGE_OK_PCT -> InsightSeverity.Info
            else -> InsightSeverity.Warning
        }
    return Insight(
        "range-optimization",
        InsightIcon.Clock,
        InsightTitleKey.RangeOptimization,
        listOf(
            InsightSegment(
                InsightBodyKey.RangeOptimizationBody,
                listOf(
                    InsightArg.Raw(formatting.number(effWhKm, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(effectiveRange, NO_DECIMALS)),
                    InsightArg.Raw(formatting.number(rangePct, NO_DECIMALS)),
                ),
            ),
            InsightSegment(adviceKey),
        ),
        trend,
        insightTone(trend, rangePct >= RANGE_OK_PCT),
        severity,
    )
}

/**
 * Runs every analyzer over [data] in the web's order and collects the insights that fire — the native
 * mirror of the component's `useMemo` body. Pure: [formatting] supplies the currency / number
 * formatting (web `useFormatting`), and [zone] the wall-clock zone for the weekday / hour histogram
 * (web `new Date(...).getDay()/getHours()`, which use the local zone), injected for deterministic
 * tests and defaulted to the device zone in production.
 */
fun buildInsights(
    data: InsightData,
    formatting: InsightsFormatting,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Insight> {
    val results = mutableListOf<Insight>()
    if (data.chargingSessions.isNotEmpty()) analyzeChargingCost(data.chargingSessions, formatting)?.let(results::add)
    if (data.drives.isNotEmpty()) analyzeEfficiencyTrend(data.drives, formatting)?.let(results::add)
    data.batteryReport?.let { analyzeBatteryHealth(it, formatting)?.let(results::add) }
    if (data.chargingSessions.isNotEmpty()) analyzeOptimalCharging(data.chargingSessions, formatting)?.let(results::add)
    data.vampireDrainStats?.let { analyzeVampireDrain(it, formatting)?.let(results::add) }
    if (data.drives.isNotEmpty()) analyzeDrivingPatterns(data.drives, formatting, zone)?.let(results::add)
    data.energyStats?.let { analyzeCostSavings(it, formatting)?.let(results::add) }
    data.energyStats?.let { analyzeRangeOptimization(it, data.batteryReport, formatting)?.let(results::add) }
    return results
}

// ─── Surface classification (the P3 state vocabulary) ─────────────────────────────────────────

/**
 * The feed lifecycle the parent threads into the surface alongside the data (the web parent's query
 * status). [Ready] is the default and reproduces the pure web content / empty behaviour; the others
 * drive the loading / stale / offline / error chrome the P3 contract requires.
 */
enum class InsightsFeedStatus { Loading, Ready, Stale, Error, Offline }

/** The freshness tier of a resolved content surface — drives the stale / offline chip. */
enum class InsightsFreshness { Fresh, Stale, Offline }

/**
 * The render-ready classification of the surface — a closed set of mutually-exclusive branches the
 * view switches on, so every state is exhaustively covered and unit-tested off-device. Maps the
 * feed status + the produced insights onto the P3 loading / content / empty / error contract; the
 * stale / offline states are content branches carrying a freshness chip.
 */
sealed interface InsightsSurface {
    /** The feed is still loading with nothing to show yet — skeleton chrome (the loading state). */
    data object Loading : InsightsSurface

    /**
     * Resolved with at least one insight — the grid. [freshness] picks the optional stale / offline
     * chip (the stale / offline states render as content with a chip, never a hidden surface).
     */
    data class Content(
        val insights: List<Insight>,
        val freshness: InsightsFreshness,
    ) : InsightsSurface

    /** Resolved with zero insights — a friendly empty state (web `return null`, P3-adapted). */
    data object Empty : InsightsSurface

    /** Failed with nothing cached — a QueryError-equivalent with retry; [offline] picks the copy. */
    data class Failed(
        val offline: Boolean,
    ) : InsightsSurface
}

/**
 * Selects the render-ready [InsightsSurface] for [data] under [status]. Pure: [formatting] supplies
 * the number / currency formatting and [zone] the histogram zone, both injectable for deterministic
 * tests. Loading short-circuits before any analysis; otherwise the analyzers run and the result is
 * folded with the feed status:
 *   * [InsightsFeedStatus.Ready]   → content (fresh) or empty;
 *   * [InsightsFeedStatus.Stale]   → content (stale) or empty;
 *   * [InsightsFeedStatus.Offline] → content (offline) or a hard offline failure;
 *   * [InsightsFeedStatus.Error]   → cached content (flagged stale) or a hard failure.
 */
fun classifyInsights(
    data: InsightData,
    status: InsightsFeedStatus,
    formatting: InsightsFormatting,
    zone: ZoneId = ZoneId.systemDefault(),
): InsightsSurface {
    if (status == InsightsFeedStatus.Loading) return InsightsSurface.Loading

    val insights = buildInsights(data, formatting, zone)
    val hasContent = insights.isNotEmpty()
    return when (status) {
        InsightsFeedStatus.Loading -> InsightsSurface.Loading
        InsightsFeedStatus.Ready ->
            if (hasContent) InsightsSurface.Content(insights, InsightsFreshness.Fresh) else InsightsSurface.Empty
        InsightsFeedStatus.Stale ->
            if (hasContent) InsightsSurface.Content(insights, InsightsFreshness.Stale) else InsightsSurface.Empty
        InsightsFeedStatus.Offline ->
            if (hasContent) InsightsSurface.Content(insights, InsightsFreshness.Offline) else InsightsSurface.Failed(offline = true)
        InsightsFeedStatus.Error ->
            if (hasContent) InsightsSurface.Content(insights, InsightsFreshness.Stale) else InsightsSurface.Failed(offline = false)
    }
}

/**
 * Builds the merged accessibility description for an insight card from already-localized parts (the
 * view reads the title then the description as one block). Kept pure so TalkBack-label presence is
 * unit-tested without a Compose host.
 */
fun insightCardAccessibilityLabel(
    title: String,
    description: String,
): String = "$title. $description"
