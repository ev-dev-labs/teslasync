// Pure, framework-free model + projection for the HeroGauges feature view — the native analogue of every
// value the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/HeroGauges.tsx). No Compose, no Android UI, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// HeroGauges is a presentational surface — the web component takes `data: FleetAnalytics | undefined` as a
// prop from the owning Analytics page (which owns the TanStack `useFleetAnalytics` query) and reads three
// context hooks for display: `useTranslation` (labels), `useUnits` (distance unit), and `useFormatting`
// (currency symbol + precision). It defines exactly two render branches: `!data` -> six MetricSkeleton tiles
// (loading), and the resolved payload -> six MetricCards. The cards always render — an absent value flows
// through the web `?? 0` / `safe(...)` guards to a formatted zero, never a blank box — so "empty" is the
// all-zero resolved grid, not a hidden surface. As in the sibling SummaryStatsRow port, the cache-then-network
// states (stale / offline / fetch-error) live on the owning page, not on this presentational surface; the two
// branches above are the complete state set the web source renders, reproduced verbatim here.
//
// Unit handling floors on SI exactly as the web source does: the backend serves `total_distance_km` (SI km),
// which is bridged to metres and converted through the shared [convertDistanceFromSI] — the conversion factor
// lives in the shared units lib, never here. The gas-savings and CO2 heuristics are tied to kilometres
// regardless of the display unit (web parity), so their dollar/kg outputs stay stable for the same trip. All
// numeric rendering goes through [ChartFormat.number], the native mirror of the web `fmtNumber`/`fmtInt`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HeroGauges — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.max

// ── Web-parity constants ──────────────────────────────────────────────────────────────────────────

/** 1 km = 1000 m exactly (web `totalDistKm * 1000` bridge to SI metres). */
private const val METERS_PER_KM = 1000.0

/** km per mile — the web `KM_PER_MILE` used to convert Wh/km into Wh/mi (Wh/mi = Wh/km * km/mi). */
private const val KM_PER_MILE = 1.609344

/** Gas-savings heuristic: assumed kWh consumed per km (web `totalDistKm * 0.085 * ...`). */
private const val GAS_SAVINGS_KWH_PER_KM = 0.085

/** Gas-savings heuristic: assumed $/kWh-equivalent gas price multiplier (web `... * 1.5`). */
private const val GAS_SAVINGS_PRICE_PER_KWH = 1.5

/** CO2 heuristic: assumed kg CO2 offset per km (web `totalDistKm * 0.12`). */
private const val CO2_KG_PER_KM = 0.12

private const val DISTANCE_DECIMALS = 1
private const val DRIVES_DECIMALS = 0
private const val ENERGY_DECIMALS = 1
private const val EFFICIENCY_DECIMALS = 1
private const val GAS_SAVINGS_DECIMALS = 0
private const val CO2_DECIMALS = 0

private const val ENERGY_UNIT = "kWh"
private const val CO2_UNIT = "kg"
private const val EFFICIENCY_UNIT_MI = "Wh/mi"
private const val EFFICIENCY_UNIT_KM = "Wh/km"

private const val DEFAULT_CURRENCY = "$"
private const val DEFAULT_PRECISION = 2
private const val DEFAULT_LOCALE_TAG = "en-US"

private const val KEY_TOTAL_DISTANCE_KM = "total_distance_km"
private const val KEY_TOTAL_COST = "total_cost"
private const val KEY_AVG_EFFICIENCY_WH_KM = "avg_efficiency_wh_km"
private const val KEY_TOTAL_DRIVES = "total_drives"
private const val KEY_TOTAL_ENERGY_KWH = "total_energy_kwh"
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
private const val KEY_DECIMAL_PRECISION = "decimal_precision"

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The five `/analytics/fleet` fields the web HeroGauges reads off its `FleetAnalytics` prop, decoded from
 * the SI, snake_case wire payload. Every field defaults to `0.0` when missing or JSON-null, reproducing the
 * web optional-chaining guards (`total_distance_km ?? 0`, `safe(total_cost)`, `avg_efficiency_wh_km ?? 0`,
 * and the `fmtInt`/`fmtNumber` `safeNumber` coercion on the remaining two).
 *
 * @property totalDistanceKm SI kilometres driven in the window (web `total_distance_km`).
 * @property totalCost recorded charging cost in the window (web `total_cost`).
 * @property avgEfficiencyWhKm SI energy intensity, watt-hours per km (web `avg_efficiency_wh_km`).
 * @property totalDrives drive count in the window (web `total_drives`).
 * @property totalEnergyKwh energy used in the window, already kWh on the wire (web `total_energy_kwh`).
 */
data class FleetAnalyticsSummary(
    val totalDistanceKm: Double,
    val totalCost: Double,
    val avgEfficiencyWhKm: Double,
    val totalDrives: Double,
    val totalEnergyKwh: Double,
) {
    public companion object {
        /**
         * Decodes the raw `/analytics/fleet` [json] into a [FleetAnalyticsSummary], or `null` when the
         * payload is absent. `null` and a JSON-null collapse to `null` (the web `!data` loading branch); any
         * JSON object — including an empty `{}` or one with all-zero totals — decodes to a summary, because
         * the web `!data` guard only catches `undefined`, so a populated (even empty) object renders the
         * resolved grid. A missing or JSON-null field collapses to `0.0` (web `?? 0` / `safe`).
         */
        public fun fromJson(json: JsonElement?): FleetAnalyticsSummary? {
            val obj = json as? JsonObject ?: return null
            return FleetAnalyticsSummary(
                totalDistanceKm = obj.double(KEY_TOTAL_DISTANCE_KM),
                totalCost = obj.double(KEY_TOTAL_COST),
                avgEfficiencyWhKm = obj.double(KEY_AVG_EFFICIENCY_WH_KM),
                totalDrives = obj.double(KEY_TOTAL_DRIVES),
                totalEnergyKwh = obj.double(KEY_TOTAL_ENERGY_KWH),
            )
        }
    }
}

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useUnits` read (distance unit + locale) and the web `useFormatting` reads (currency symbol +
 * precision). Resolving both from one settings document mirrors the web hooks, which both derive from
 * `useSettings`.
 *
 * @property distanceUnit the user's distance unit (web `unitPrefs.distance`); selects the Distance card unit
 *   and the Wh/mi-vs-Wh/km efficiency branch.
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace -> "$" fallback applied
 *   (web `useFormatting` `currencySymbol`).
 * @property precision the default fraction digits for [HeroGaugesProjection.formatCurrency] when a call omits
 *   its own (web `useFormatting` `userPrecision`: finite, non-negative, floored, else 2).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class HeroGaugesDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    public companion object {
        /** The metric, "$", 2-dp, en-US defaults applied before settings load (web cold-start defaults). */
        public val DEFAULT: HeroGaugesDisplayPrefs = from(null)

        /** Resolves the unit + currency + precision + locale preferences from one `/settings` document. */
        public fun from(settings: JsonElement?): HeroGaugesDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = obj.stringOrNull(KEY_CURRENCY_SYMBOL)
            return HeroGaugesDisplayPrefs(
                distanceUnit = unitPref.distance,
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = obj.precisionOrNull(KEY_DECIMAL_PRECISION) ?: DEFAULT_PRECISION,
                locale = localeFor(unitPref.locale),
            )
        }

        private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
    }
}

/**
 * The six localized card labels the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready [HeroGaugeCard.label]s carry no English literal. Keys map 1:1 to the web `t('analytics.hero.*')`
 * calls.
 */
data class HeroGaugesStrings(
    val distance: String,
    val drives: String,
    val energy: String,
    val efficiency: String,
    val gasSavings: String,
    val co2Saved: String,
)

/** Which authored/shared glyph a card carries — kept Compose-free so the projection is unit-tested off-device. */
enum class HeroGaugeIcon { Distance, Drives, Energy, Efficiency, GasSavings, Co2 }

/** Which design-token accent a card carries (web MetricCard `color`), resolved to a Color in the composable. */
enum class HeroGaugeAccent { Info, Power, Success, Warning }

/**
 * One fully resolved hero tile — the native analogue of a single web `<MetricCard>` invocation. Pure data
 * (no Compose types) so the whole projection is asserted off-device.
 *
 * @property label the localized card label.
 * @property value the formatted primary value (already grouped + rounded for the locale).
 * @property subtitle the unit/secondary line, or `null` when the web card omits its `subtitle`.
 * @property icon the glyph slot.
 * @property accent the design-token accent slot.
 */
data class HeroGaugeCard(
    val label: String,
    val value: String,
    val subtitle: String?,
    val icon: HeroGaugeIcon,
    val accent: HeroGaugeAccent,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. [loading] true reproduces the web `!data` branch (the composable renders six skeleton
 * tiles and ignores [cards]); otherwise [cards] holds the six resolved tiles in web order.
 */
data class HeroGaugesDisplay(
    val loading: Boolean,
    val cards: List<HeroGaugeCard>,
)

/**
 * Pure projection from the surface's prop + display preferences to its render-ready [HeroGaugesDisplay] — a
 * 1:1 port of the derivations the web component performs. The composable resolves [HeroGaugesStrings] and
 * [HeroGaugesDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object HeroGaugesProjection {
    /** The fixed number of hero tiles (web `Array.from({ length: 6 })` skeletons / six MetricCards). */
    const val CARD_COUNT: Int = 6

    /**
     * Selects the render-ready view for the given [data] (the owning page's `FleetAnalytics` prop; `null`
     * while the query is in flight), the resolved display [prefs], and the localized [strings]. Reproduces the
     * web derivations verbatim: the SI-floored distance conversion, the km-tied gas-savings (clamped at zero)
     * and CO2 heuristics, the Wh/mi-vs-Wh/km efficiency branch, and the raw kWh energy / drive count.
     */
    fun project(
        data: FleetAnalyticsSummary?,
        prefs: HeroGaugesDisplayPrefs,
        strings: HeroGaugesStrings,
    ): HeroGaugesDisplay {
        if (data == null) return HeroGaugesDisplay(loading = true, cards = emptyList())

        val locale = prefs.locale
        val isMiles = prefs.distanceUnit == DistanceUnitPref.MI
        val totalDist = convertDistanceFromSI(data.totalDistanceKm * METERS_PER_KM, prefs.distanceUnit)
        val gasSavings = data.totalDistanceKm * GAS_SAVINGS_KWH_PER_KM * GAS_SAVINGS_PRICE_PER_KWH - data.totalCost
        val co2Saved = data.totalDistanceKm * CO2_KG_PER_KM
        val avgEffDisplay = if (isMiles) data.avgEfficiencyWhKm * KM_PER_MILE else data.avgEfficiencyWhKm
        val efficiencyUnit = if (isMiles) EFFICIENCY_UNIT_MI else EFFICIENCY_UNIT_KM

        return HeroGaugesDisplay(
            loading = false,
            cards =
                listOf(
                    HeroGaugeCard(
                        label = strings.distance,
                        value = ChartFormat.number(totalDist, DISTANCE_DECIMALS, locale),
                        subtitle = prefs.distanceUnit.label,
                        icon = HeroGaugeIcon.Distance,
                        accent = HeroGaugeAccent.Info,
                    ),
                    HeroGaugeCard(
                        label = strings.drives,
                        value = ChartFormat.number(data.totalDrives, DRIVES_DECIMALS, locale),
                        subtitle = null,
                        icon = HeroGaugeIcon.Drives,
                        accent = HeroGaugeAccent.Power,
                    ),
                    HeroGaugeCard(
                        label = strings.energy,
                        value = ChartFormat.number(data.totalEnergyKwh, ENERGY_DECIMALS, locale),
                        subtitle = ENERGY_UNIT,
                        icon = HeroGaugeIcon.Energy,
                        accent = HeroGaugeAccent.Success,
                    ),
                    HeroGaugeCard(
                        label = strings.efficiency,
                        value = ChartFormat.number(avgEffDisplay, EFFICIENCY_DECIMALS, locale),
                        subtitle = efficiencyUnit,
                        icon = HeroGaugeIcon.Efficiency,
                        accent = HeroGaugeAccent.Warning,
                    ),
                    HeroGaugeCard(
                        label = strings.gasSavings,
                        value = formatCurrency(max(gasSavings, 0.0), prefs, GAS_SAVINGS_DECIMALS),
                        subtitle = null,
                        icon = HeroGaugeIcon.GasSavings,
                        accent = HeroGaugeAccent.Success,
                    ),
                    HeroGaugeCard(
                        label = strings.co2Saved,
                        value = ChartFormat.number(co2Saved, CO2_DECIMALS, locale),
                        subtitle = CO2_UNIT,
                        icon = HeroGaugeIcon.Co2,
                        accent = HeroGaugeAccent.Success,
                    ),
                ),
        )
    }

    /**
     * Formats a currency [amount] the way the web `useFormatting().formatCurrency` does — the resolved
     * [HeroGaugesDisplayPrefs.currencySymbol] followed by a grouped number via the shared [ChartFormat.number].
     * [decimals] defaults to the user's [HeroGaugesDisplayPrefs.precision] (web `decimals ?? userPrecision`);
     * the HeroGauges gas-savings card overrides it with 0, matching the web `formatCurrency(..., 0)` call.
     */
    fun formatCurrency(
        amount: Double,
        prefs: HeroGaugesDisplayPrefs,
        decimals: Int = prefs.precision,
        locale: Locale = prefs.locale,
    ): String = prefs.currencySymbol + ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a distance,
 * cost, efficiency, drive count, or any other fleet figure — so a diagnostics line can never leak fleet usage.
 */
object HeroGaugesDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "HeroGauges"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helpers (web `?? 0` / optional-chaining parity) ─────────────────────────────────────

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject?.precisionOrNull(key: String): Int? {
    val value = (this?.get(key) as? JsonPrimitive)?.doubleOrNull ?: return null
    return if (value.isFinite() && value >= 0) value.toInt() else null
}
