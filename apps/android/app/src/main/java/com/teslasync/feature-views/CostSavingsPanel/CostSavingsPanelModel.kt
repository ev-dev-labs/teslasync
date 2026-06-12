// Pure, framework-free model + projection for the CostSavingsPanel feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// CostSavingsPanel is a presentational drive-detail surface — the web component takes `drive: DriveDetail`
// and `stats: DriveStats` props from the owning DriveDetail page (which owns the drive query), and reads four
// context hooks for display: `useTranslation` (the five labels, P1/S10), and `useSettings` / `useFormatting`
// / `useUnits`, all of which derive from one `/settings` document — mapped here onto the live S8 SettingsStore
// for the currency symbol, decimal precision, locale, cost-per-kWh rate, gas economy / price / unit, and the
// distance preference. Following the sibling CostSummaryCards port, the owning page threads the computed drive
// + stats in through the shared cache-then-network state-holder layer (P1/S8) as a [UiState]; the
// [projectUiState] adapter lets the composable render every lifecycle state that layer can carry — a loading
// skeleton, a hard error with retry, a friendly empty state (no drive resolved), content, and stale/offline
// "last known" — without ever fetching.
//
// The web renders up to five centered tiles inside an outer GlassPanel: Trip Cost (always; the energy cost at
// `formatEnergyCost`, with an "at {symbol}{rate}/kWh" subline), Cost / {mi|km} (when the drive has distance;
// `formatCurrency(costPerDistanceUnit, 3)`), and — only when the gasoline comparison yields a positive saving
// — Gas Cost (equiv) (`formatCurrency(gasCost)`, with an "at {mpg} MPG" subline), vs Gas Savings
// (`formatCurrency(savings)`) and Savings % (`fmtNumber((savings / gasCost) * 100, 0)%`). Each cost derivation
// (the EV energy cost, the gasoline-equivalent cost via the meters→miles bridge, the per-distance cost) is
// reproduced verbatim from the web `useFormatting` hook; number + currency formatting goes through the
// golden-pinned shared [ChartFormat.number], the native mirror of the web `fmtNumber` (including the web
// `safeNumber` non-finite→0 guard).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CostSavingsPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costsavingspanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

// ── Web-parity constants ──────────────────────────────────────────────────────────────────────────────

/** Web `useFormatting`: `settings.base_cost_per_kwh ?? 0.12` — the cold-start cost-per-kWh rate. */
private const val DEFAULT_COST_PER_KWH = 0.12

/** Web `useSettings` defaults: `gas_efficiency_mpg: 25` — the cold-start gasoline economy (miles per gallon). */
private const val DEFAULT_GAS_MPG = 25.0

/** Web `useSettings` defaults: `gas_price_per_unit: 0` — no gas comparison until the user configures a price. */
private const val DEFAULT_GAS_PRICE = 0.0

/** Web `useFormatting` `userPrecision` fallback (`decimal_precision … : 2`) — the default currency precision. */
private const val DEFAULT_PRECISION = 2

/** Web `useFormatting`: `settings.currency_symbol …: '$'` — the blank/whitespace currency-symbol fallback. */
private const val DEFAULT_CURRENCY = "$"

/** Web `lib/constants` `FUEL.GALLONS_TO_LITERS` — litres per US gallon, used when the gas unit is litres. */
private const val GALLONS_TO_LITERS = 3.78541

/** Watt-hours per kilowatt-hour — the web `stats.energyWh / 1000` SI→kWh bridge feeding every cost figure. */
private const val WH_PER_KWH = 1000.0

/** Web `formatCurrency(costPerDistanceUnit(...) ?? 0, 3)` precision — three fraction digits for the per-distance cost. */
private const val COST_PER_DIST_DECIMALS = 3

/** Web `fmtNumber((savings / gasCost) * 100, 0)` precision — zero fraction digits for the savings percentage. */
private const val SAVINGS_PCT_DECIMALS = 0

/** Multiplier turning the savings ratio into a percentage (web `… * 100`). */
private const val PERCENT_SCALE = 100.0

/** Trailing percent sign appended to the Savings % value (web `${fmtNumber(...)}%`). */
private const val PERCENT_SIGN = "%"

/** Max fraction digits when echoing a raw configured number (rate / mpg) — enough to render any user value. */
private const val RAW_MAX_FRACTION = 6

private const val KEY_BASE_COST_PER_KWH = "base_cost_per_kwh"
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
private const val KEY_GAS_EFFICIENCY_MPG = "gas_efficiency_mpg"
private const val KEY_GAS_PRICE_PER_UNIT = "gas_price_per_unit"
private const val KEY_GAS_UNIT = "gas_unit"

/** Web `settings.gas_unit === 'liter'` sentinel — switches the gas-cost math to litres. */
private const val GAS_UNIT_LITER = "liter"

private const val DEFAULT_LOCALE_TAG = "en-US"

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The single `DriveDetail` field the web CostSavingsPanel reads off its `drive` prop — the SI trip distance
 * in metres (web `drive.distanceM`). The owning page resolves the full drive; this surface renders only the
 * distance, so it is the only field carried (the web source — THE spec — reads no other `drive` field).
 *
 * @property distanceM the SI trip distance in metres (web `drive.distanceM`); `0` or negative disables the
 *   per-distance and gasoline tiles, mirroring the web `drive.distanceM > 0` / `distanceM <= 0` guards.
 */
data class DriveCostInputs(
    val distanceM: Double,
)

/**
 * The single `DriveStats` field the web CostSavingsPanel reads off its `stats` prop — the SI energy used for
 * the trip, in watt-hours (web `stats.energyWh`). Every cost figure derives from `stats.energyWh / 1000` kWh.
 *
 * @property energyWh the SI energy used for the trip, in watt-hours (web `stats.energyWh`).
 */
data class DriveCostStats(
    val energyWh: Double,
)

/**
 * The full prop bundle the owning page threads into this surface — the web component's `drive` + `stats`
 * props, grouped so the host has a single value to carry through the [UiState].
 *
 * @property drive the drive distance the per-distance + gasoline math reads (web `drive`).
 * @property stats the trip energy every cost figure reads (web `stats`).
 */
data class CostSavingsSnapshot(
    val drive: DriveCostInputs,
    val stats: DriveCostStats,
)

// ── Render-ready projection types ───────────────────────────────────────────────────────────────────────

/**
 * A tile's semantic accent — the design-token (P1/S9) mapping of the web Tailwind value color. Trip Cost and
 * the savings tiles are web `text-green-400` / `text-emerald-400` → [Success]; the per-distance cost is web
 * `text-cyan-400` → [Info]; the gasoline-equivalent cost is web `text-red-400` → [Danger]. Mapping to semantic
 * tokens (rather than hard hues) keeps light / dark / high-contrast consistent.
 */
enum class CostTileTone { Success, Info, Danger }

/**
 * One fully resolved tile — the native analogue of a single web `<div>` cost cell. Pure data (no Compose
 * types) so the whole projection is asserted off-device. The [label] is already localized (resolved from the
 * i18n catalog at the Compose boundary and handed in via [CostSavingsStrings]); the [sub] is the optional
 * composed secondary line.
 *
 * @property label the localized tile label (web `<p>` heading).
 * @property value the formatted primary value, currency symbol / percent included (web bold `<p>`).
 * @property sub the secondary line, or `null` when the web omits it (web muted `<p>`).
 * @property tone the value's semantic accent (web `text-{color}-400`).
 */
data class CostSavingsTile(
    val label: String,
    val value: String,
    val sub: String?,
    val tone: CostTileTone,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready tiles carry no English literal. Keys map 1:1 to the web `t('driveDetail.*')` calls;
 * [atRateTemplate] / [costPerUnitTemplate] / [atMpgTemplate] are the raw positional resources into which the
 * projection substitutes the currency symbol + rate, the distance word, and the gas economy respectively.
 */
data class CostSavingsStrings(
    val title: String,
    val tripCost: String,
    val atRateTemplate: String,
    val costPerUnitTemplate: String,
    val gasCostEquiv: String,
    val atMpgTemplate: String,
    val gasSavings: String,
    val savingsPct: String,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useSettings` / `useFormatting` / `useUnits` reads, all of which derive from the one settings document.
 * Resolved once at the Compose boundary and threaded into the pure projection.
 *
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace→"$" fallback applied.
 * @property precision the default currency fraction digits (web `useFormatting` `userPrecision`).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 * @property costPerKwh the cost-per-kWh rate (web `settings.base_cost_per_kwh ?? 0.12`).
 * @property gasEfficiencyMpg the gasoline economy in MPG (web `settings.gas_efficiency_mpg`, default 25).
 * @property gasPricePerUnit the gasoline price per unit (web `settings.gas_price_per_unit ?? 0`).
 * @property gasUnitIsLiter whether the gas unit is litres (web `settings.gas_unit === 'liter'`).
 * @property distancePref the user's distance preference (web `useUnits().unitPrefs.distance`, `mi` or `km`).
 */
data class CostSavingsDisplayPrefs(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
    val costPerKwh: Double,
    val gasEfficiencyMpg: Double,
    val gasPricePerUnit: Double,
    val gasUnitIsLiter: Boolean,
    val distancePref: DistanceUnitPref,
) {
    /** The user-facing distance abbreviation the per-distance tile label substitutes (web `unitPrefs.distance`). */
    val distanceLabel: String get() = distancePref.label

    companion object {
        /** The "$", 2-dp, en-US, 0.12/kWh, 25 MPG, $0 gas, gallon, km defaults applied before settings load. */
        val DEFAULT: CostSavingsDisplayPrefs = from(null)

        /** Resolves the currency + precision + locale + cost/gas/distance preferences from one `/settings` document. */
        fun from(settings: JsonElement?): CostSavingsDisplayPrefs {
            val unitPref = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = obj.stringOrNull(KEY_CURRENCY_SYMBOL)
            return CostSavingsDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                precision = unitPref.precision ?: DEFAULT_PRECISION,
                locale = localeFor(unitPref.locale),
                costPerKwh = obj.doubleOrNull(KEY_BASE_COST_PER_KWH) ?: DEFAULT_COST_PER_KWH,
                gasEfficiencyMpg = obj.doubleOrNull(KEY_GAS_EFFICIENCY_MPG) ?: DEFAULT_GAS_MPG,
                gasPricePerUnit = obj.doubleOrNull(KEY_GAS_PRICE_PER_UNIT) ?: DEFAULT_GAS_PRICE,
                gasUnitIsLiter = obj.stringOrNull(KEY_GAS_UNIT) == GAS_UNIT_LITER,
                distancePref = unitPref.distance,
            )
        }

        private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
    }
}

// ── Projection ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from the surface's prop + display preferences to its render-ready tiles — a 1:1 port of the
 * derivations the web component performs. The composable resolves [CostSavingsStrings] and
 * [CostSavingsDisplayPrefs] from the i18n catalog and the live settings, then hands them here.
 */
object CostSavingsPanelProjection {
    /**
     * Maps the host's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] — the native expression of "no drive resolved", so the surface shows a friendly
     * empty state instead of a blank box. The host's stateful binding can additionally carry
     * refreshing/stale/offline/error, which the composable renders too.
     */
    fun projectUiState(
        snapshot: CostSavingsSnapshot?,
        isLoading: Boolean,
    ): UiState<CostSavingsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The up-to-five tiles in web source order, applying the web render guards exactly: Trip Cost is always
     * present; the per-distance Cost tile is appended only when `drive.distanceM > 0`; and the gasoline trio
     * (Gas Cost equiv, vs Gas Savings, Savings %) is appended only when the gasoline comparison yields a
     * positive saving (`savings != null && savings > 0`). Every value reproduces the matching web call.
     */
    fun tiles(
        snapshot: CostSavingsSnapshot,
        prefs: CostSavingsDisplayPrefs,
        strings: CostSavingsStrings,
    ): List<CostSavingsTile> {
        val distanceM = snapshot.drive.distanceM
        val energyWh = snapshot.stats.energyWh
        val result = mutableListOf<CostSavingsTile>()

        result +=
            CostSavingsTile(
                label = strings.tripCost,
                value = formatCurrency(evCost(energyWh, prefs), prefs),
                sub = atRate(strings.atRateTemplate, prefs),
                tone = CostTileTone.Success,
            )

        if (distanceM > 0) {
            result +=
                CostSavingsTile(
                    label = costPerUnitLabel(strings.costPerUnitTemplate, prefs),
                    value = formatCurrency(costPerDistanceUnit(energyWh, distanceM, prefs) ?: 0.0, prefs, COST_PER_DIST_DECIMALS),
                    sub = null,
                    tone = CostTileTone.Info,
                )
        }

        val gasCost = gasCost(distanceM, prefs)
        val savings = if (gasCost != null) gasCost - evCost(energyWh, prefs) else null
        if (savings != null && gasCost != null && savings > 0) {
            result +=
                CostSavingsTile(
                    label = strings.gasCostEquiv,
                    value = formatCurrency(gasCost, prefs),
                    sub = atMpg(strings.atMpgTemplate, prefs),
                    tone = CostTileTone.Danger,
                )
            result +=
                CostSavingsTile(
                    label = strings.gasSavings,
                    value = formatCurrency(savings, prefs),
                    sub = null,
                    tone = CostTileTone.Success,
                )
            result +=
                CostSavingsTile(
                    label = strings.savingsPct,
                    value = fmt(savings / gasCost * PERCENT_SCALE, SAVINGS_PCT_DECIMALS, prefs.locale) + PERCENT_SIGN,
                    sub = null,
                    tone = CostTileTone.Success,
                )
        }
        return result
    }

    /**
     * The EV energy cost for the trip — the web `formatEnergyCost(stats.energyWh / 1000)` figure:
     * `(energyWh / 1000) kWh × costPerKwh`. Feeds the Trip Cost tile and the gasoline-savings delta.
     */
    fun evCost(
        energyWh: Double,
        prefs: CostSavingsDisplayPrefs,
    ): Double = energyWh / WH_PER_KWH * prefs.costPerKwh

    /**
     * The estimated gasoline cost for the SI distance — a 1:1 port of the web `estimateGasCost(distanceM)`:
     * `null` when the economy, price, or distance is non-positive (no comparison possible); otherwise the
     * meters→miles bridge gives the gallons used (`distanceMi / mpg`), scaled by the gas price (× litres-per-
     * gallon first when the gas unit is litres).
     */
    fun gasCost(
        distanceM: Double,
        prefs: CostSavingsDisplayPrefs,
    ): Double? {
        val mpg = prefs.gasEfficiencyMpg
        val gasPrice = prefs.gasPricePerUnit
        if (mpg <= 0 || gasPrice <= 0 || distanceM <= 0) return null
        val distanceMi = convertDistanceFromSI(distanceM, DistanceUnitPref.MI)
        val gallonsUsed = distanceMi / mpg
        return if (prefs.gasUnitIsLiter) gallonsUsed * GALLONS_TO_LITERS * gasPrice else gallonsUsed * gasPrice
    }

    /**
     * The cost per user-preferred distance unit — a 1:1 port of the web `costPerDistanceUnit(kwh, distanceM)`:
     * `null` for a non-positive distance; otherwise the EV cost divided by the converted distance (also `null`
     * when the converted distance is non-positive). The Cost / {unit} tile renders `… ?? 0`.
     */
    fun costPerDistanceUnit(
        energyWh: Double,
        distanceM: Double,
        prefs: CostSavingsDisplayPrefs,
    ): Double? {
        if (distanceM <= 0) return null
        val cost = energyWh / WH_PER_KWH * prefs.costPerKwh
        val distance = convertDistanceFromSI(distanceM, prefs.distancePref)
        return if (distance > 0) cost / distance else null
    }

    /**
     * Formats a currency [amount] the way the web `useFormatting().formatCurrency` / `formatEnergyCost` do —
     * the resolved [CostSavingsDisplayPrefs.currencySymbol] followed by a grouped number via the shared
     * [ChartFormat.number]. [decimals] defaults to the user's precision; callers pass explicit decimals where
     * the web does (3 for the per-distance cost).
     */
    fun formatCurrency(
        amount: Double,
        prefs: CostSavingsDisplayPrefs,
        decimals: Int = prefs.precision,
    ): String = prefs.currencySymbol + fmt(amount, decimals, prefs.locale)

    /**
     * The Trip Cost subline — the web `t('driveDetail.atRate', { currencySymbol, costPerKwh })`. Substitutes
     * the currency symbol and the echoed rate into the raw "at %1$s%2$s/kWh" [template]; the rate is echoed via
     * [rawNumber] so a value like `0.12` renders as `0.12` (matching the web's raw interpolation).
     */
    fun atRate(
        template: String,
        prefs: CostSavingsDisplayPrefs,
    ): String = String.format(prefs.locale, template, prefs.currencySymbol, rawNumber(prefs.costPerKwh, prefs.locale))

    /**
     * The Gas Cost subline — the web `t('driveDetail.atMpg', { mpg: settings.gas_efficiency_mpg })`.
     * Substitutes the echoed economy into the raw "at %1$s MPG" [template].
     */
    fun atMpg(
        template: String,
        prefs: CostSavingsDisplayPrefs,
    ): String = String.format(prefs.locale, template, rawNumber(prefs.gasEfficiencyMpg, prefs.locale))

    /**
     * The per-distance tile label — the web `t('driveDetail.costPerUnit', { unit: distanceUnit })`.
     * Substitutes the user's distance abbreviation into the raw "Cost / %1$s" [template].
     */
    fun costPerUnitLabel(
        template: String,
        prefs: CostSavingsDisplayPrefs,
    ): String = String.format(prefs.locale, template, prefs.distanceLabel)

    /**
     * Build the merged TalkBack label for a tile — "<label>: <value>" plus ", <detail>" when a subline is
     * present. Pure string join so the accessible reading of every tile is verifiable off-device.
     */
    fun accessibilityLabel(
        label: String,
        value: String,
        detail: String?,
    ): String = if (detail.isNullOrBlank()) "$label: $value" else "$label: $value, $detail"

    /**
     * A grouped number at [decimals] fraction digits — the web `fmtNumber`, including its `safeNumber` guard
     * (a non-finite value renders as 0 rather than the [ChartFormat] em-dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(if (value.isFinite()) value else 0.0, decimals.coerceAtLeast(0), locale)

    /**
     * Echoes a raw configured number (the kWh rate, the MPG) the way the web's i18next interpolation does —
     * the value with its natural fraction digits and no forced trailing zeros (`0.12` → `0.12`, `25` → `25`).
     * Grouping is disabled so the echoed value matches the raw setting; a non-finite value is coerced to 0.
     */
    private fun rawNumber(
        value: Double,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                isGroupingUsed = false
                minimumFractionDigits = 0
                maximumFractionDigits = RAW_MAX_FRACTION
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe)
    }
}

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a cost,
 * energy, distance, savings, or gas-price figure — so a diagnostics line can never leak fleet behavior or
 * charging economics.
 */
object CostSavingsPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "CostSavingsPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── JSON decode helpers (web blank/whitespace → "$" + numeric coercion parity) ──────────────────────────

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject?.doubleOrNull(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull
