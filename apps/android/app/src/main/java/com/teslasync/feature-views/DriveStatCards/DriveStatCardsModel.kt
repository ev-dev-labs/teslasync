// The pure, framework-free model + projection for the DriveStatCards feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drive-detail/DriveStatCards.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the drive-detail page, via useDriveDetailData)
// fetches the drive, computes the per-row aggregate `stats`, and passes `drive` + `stats` down. From those it
// renders eight always-on IconStatCards (Distance, Duration, Max Speed, Avg Speed, SOC, Max Power, Elev. Gain,
// Elev. Loss) plus two cost cards gated on `stats.energyWh > 0` (Trip Cost) and additionally `drive.distanceM
// > 0` (Cost / {unit}). Distance is converted from SI metres at render via `useUnits`; the speeds arrive on
// `stats` already in the user's display unit (the parent converts `drive.maxSpeedMps`/`avgSpeedMps` with
// `convertSpeedFromSI`); power is shown as raw kW; elevation as whole metres; the two cost cards use
// `useFormatting` (currency symbol + cost-per-kWh + precision).
//
// This file owns the parts the web component expresses from those props: the SI-canonical slice of the inputs
// it reads ([DriveStatCardsSnapshot]), the display preferences resolved from one `/settings` document (the
// native union of the web `useUnits` + `useFormatting` reads, [DriveStatDisplayPrefs]), the lifecycle
// projection onto the shared cache-then-network [UiState] (so the surface renders every state the P1/S8 layer
// can carry), the ordered ten-tile value list reproducing each web `t()`/conversion/format call exactly, the
// web `formatDuration` "Xh Ym" helper, and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/DriveStatCards — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivestatcards

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** 1 kWh = 1000 Wh (the snapshot carries SI watt-hours; the cost math is per kWh, web `energyWh / 1000`). */
private const val WH_PER_KWH = 1000.0

/** Seconds per minute — the web `drive.durationS / 60` conversion feeding `formatDuration`. */
private const val SECONDS_PER_MINUTE = 60.0

/** Minutes per hour — the web `formatDuration` split of total minutes into hours + minutes. */
private const val MINUTES_PER_HOUR = 60.0

/** Web `AnimatedNumber decimals={1}` for the Distance tile. */
private const val DISTANCE_DECIMALS = 1

/** Web `AnimatedNumber` default (`decimals = 0`) for the Max/Avg Speed tiles. */
private const val SPEED_DECIMALS = 0

/** Web elevation values are pre-rounded with `Math.round` and shown at 0 decimals. */
private const val ELEV_DECIMALS = 0

/** Web `formatCurrency(..., 3)` precision for the Cost / {unit} tile. */
private const val COST_PER_UNIT_DECIMALS = 3

/** Web `fmtInt` precision (0 decimals) for the SOC start/end percentages. */
private const val INT_DECIMALS = 0

/** Web hard-coded `'kW'` unit on the Max Power tile (no power-unit preference is applied). */
private const val KW_UNIT = "kW"

/** Web `%` suffix on each SOC percentage. */
private const val PERCENT = "%"

/** Web SOC connector `→` (U+2192) between the start and end percentages. */
private const val SOC_ARROW = "\u2192"

/** Web Elev. Gain suffix `" m ↑"` (metres, up arrow U+2191). */
private const val ELEV_GAIN_SUFFIX = " m \u2191"

/** Web Elev. Loss suffix `" m ↓"` (metres, down arrow U+2193). */
private const val ELEV_LOSS_SUFFIX = " m \u2193"

/** Leading space joining a converted number to its unit label (web ``suffix={` ${unit}`}``). */
private const val UNIT_SPACE = " "

/** Web `useFormatting` `currency_symbol` settings key (blank/whitespace falls back to `$`). */
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

/** Web `useFormatting` `base_cost_per_kwh` settings key. */
private const val KEY_COST_PER_KWH = "base_cost_per_kwh"

/** Web `useFormatting` currency fallback when `currency_symbol` is blank/whitespace. */
private const val DEFAULT_CURRENCY = "$"

/** Web `useFormatting` `costPerKwh = settings.base_cost_per_kwh ?? 0.12` default. */
private const val DEFAULT_COST_PER_KWH = 0.12

/** Web `useFormatting` `userPrecision` fallback (2 decimals) when no decimal precision is set. */
private const val DEFAULT_PRECISION = 2

/** Number-grouping locale fallback (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

/**
 * The SI-canonical slice of the web `drive` + `stats` props this surface reads. Distance/duration come off the
 * web `DriveDetail` (`distanceM` metres, `durationS` seconds); the battery percentages off `DriveDetail`
 * (`startBatteryPct`/`endBatteryPct`); the speeds off the web `DriveStats` as the SI `maxSpeedMps`/`avgSpeedMps`
 * the parent fed `convertSpeedFromSI` (carried as SI here so the display unit is applied at this boundary, never
 * pre-baked); power/elevation/energy off `DriveStats` (`powerMax` kW, `elevGain`/`elevLoss` metres, `energyWh`).
 *
 * Speeds are nullable to mirror the web `drive.maxSpeedMps != null ? toSpeedDisplay(...) : 0` guard; the
 * percentages are nullable to mirror the web `fmtInt` `safeNumber` (a null renders `0`). The remaining figures
 * are pre-aggregated finite doubles; the formatters still apply the web `safeNumber` non-finite to 0 guard.
 *
 * @property distanceM drive distance, SI metres (web `drive.distanceM`).
 * @property durationS drive duration, SI seconds (web `drive.durationS`).
 * @property maxSpeedMps max speed, SI metres per second, or null (web `drive.maxSpeedMps`).
 * @property avgSpeedMps average speed, SI metres per second, or null (web `drive.avgSpeedMps`).
 * @property startBatteryPct battery percentage at drive start, or null (web `drive.startBatteryPct`).
 * @property endBatteryPct battery percentage at drive end, or null (web `drive.endBatteryPct`).
 * @property powerMaxKw peak power in kW (web `stats.powerMax`, shown as raw kW).
 * @property elevGainM cumulative elevation gain, metres (web `stats.elevGain`).
 * @property elevLossM cumulative elevation loss, metres (web `stats.elevLoss`).
 * @property energyWh energy used, SI watt-hours (web `stats.energyWh`); gates the two cost tiles.
 */
data class DriveStatCardsSnapshot(
    val distanceM: Double,
    val durationS: Double,
    val maxSpeedMps: Double?,
    val avgSpeedMps: Double?,
    val startBatteryPct: Double?,
    val endBatteryPct: Double?,
    val powerMaxKw: Double,
    val elevGainM: Double,
    val elevLossM: Double,
    val energyWh: Double,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the
 * web `useUnits` (distance + speed display units, via [UnitPreferences.fromSettings]) and `useFormatting`
 * (currency symbol + cost-per-kWh + precision) reads, which both derive from `useSettings`. Resolved once at the
 * Compose boundary and threaded into the pure projection.
 *
 * @property units the SI -> display unit preferences (distance/speed labels + locale + precision).
 * @property currencySymbol the resolved currency symbol with the web blank/whitespace to `$` fallback applied.
 * @property costPerKwh the per-kWh energy price the cost tiles multiply by (web `costPerKwh`, default 0.12).
 * @property precision the default fraction digits (web `useFormatting` `userPrecision`).
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class DriveStatDisplayPrefs(
    val units: UnitPref,
    val currencySymbol: String,
    val costPerKwh: Double,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The `$`/0.12/2-dp/en-US metric defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: DriveStatDisplayPrefs = from(null)

        /** Resolves the unit + currency + cost-per-kWh + precision + locale preferences from one `/settings` doc. */
        fun from(settings: JsonElement?): DriveStatDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = obj.stringOrNull(KEY_CURRENCY_SYMBOL)
            return DriveStatDisplayPrefs(
                units = units,
                currencySymbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY,
                costPerKwh = obj.doubleOrNull(KEY_COST_PER_KWH) ?: DEFAULT_COST_PER_KWH,
                precision = units.precision ?: DEFAULT_PRECISION,
                locale = localeFor(units.locale),
            )
        }
    }
}

/**
 * The ten stat tiles the web component renders, in source order. Identity only — labels/glyphs/accents resolve
 * at the Compose boundary, keeping this enum free of any Android or i18n dependency.
 */
enum class DriveStat {
    Distance,
    Duration,
    MaxSpeed,
    AvgSpeed,
    Soc,
    MaxPower,
    ElevGain,
    ElevLoss,
    TripCost,
    CostPerUnit,
}

/**
 * One tile's render-ready value. The web wraps five tiles in `<AnimatedNumber>` (a count-up over a numeric
 * value with a unit suffix) and renders the rest as plain strings; [Animated] carries the numeric parts the
 * count-up needs plus the final formatted [text] (used for the reduced-motion/static render, the accessibility
 * label, and the off-device assertions), while [Static] carries only the pre-formatted [text].
 */
sealed interface DriveStatValue {
    /** The final formatted string (number + unit/suffix), identical to the count-up's last frame. */
    val text: String

    /**
     * A web `<AnimatedNumber value decimals suffix />` tile: count up to [value] at [decimals] fraction digits
     * and append [suffix]; [text] is the equivalent final string for the static/reduced-motion render.
     */
    data class Animated(
        override val text: String,
        val value: Double,
        val decimals: Int,
        val suffix: String,
    ) : DriveStatValue

    /** A plain-string tile (web non-`AnimatedNumber` value: duration, SOC, power, the two costs). */
    data class Static(
        override val text: String,
    ) : DriveStatValue
}

/**
 * One fully resolved tile — the native analogue of a single web `<IconStatCard>` invocation. Pure data (no
 * Compose types) so the whole projection is asserted off-device. [label] is already localized (resolved from
 * the i18n catalog at the Compose boundary and handed in via [DriveStatCardsStrings]).
 */
data class DriveStatTile(
    val stat: DriveStat,
    val label: String,
    val value: DriveStatValue,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the
 * render-ready tiles carry no English literal. Keys map 1:1 to the web `t('driveDetail.*')` calls;
 * [costPerUnitTemplate] is the raw `Cost / %1$s` resource into which the projection substitutes the distance
 * unit (web `t('driveDetail.costPerUnit', { unit })`); [noData] backs the friendly empty state.
 */
data class DriveStatCardsStrings(
    val distance: String,
    val duration: String,
    val maxSpeed: String,
    val avgSpeed: String,
    val soc: String,
    val maxPower: String,
    val elevGain: String,
    val elevLoss: String,
    val tripCost: String,
    val costPerUnitTemplate: String,
    val noData: String,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's per-card
 * branches, conversions, and formats. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, glyphs, and accents and draws what these return.
 */
object DriveStatCardsProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: DriveStatCardsSnapshot?,
        isLoading: Boolean,
    ): UiState<DriveStatCardsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The tiles in web source order, each value formatted for [prefs]. The first eight are always present; the
     * Trip Cost tile is appended only when `energyWh > 0` and the Cost / {unit} tile only when additionally
     * `distanceM > 0`, reproducing the web `{stats.energyWh > 0 && ...}` / `{... && drive.distanceM > 0 && ...}`
     * guards. Distance/speed convert SI -> display here (web `convertDistanceFromSI` / `convertSpeedFromSI`);
     * power/elevation/SOC/duration/cost mirror the matching web format calls.
     */
    fun tiles(
        snapshot: DriveStatCardsSnapshot,
        prefs: DriveStatDisplayPrefs,
        strings: DriveStatCardsStrings,
    ): List<DriveStatTile> {
        val units = prefs.units
        val locale = prefs.locale
        val distanceLabel = units.distance.label
        val speedSuffix = UNIT_SPACE + units.speed.label
        val distance = convertDistanceFromSI(snapshot.distanceM, units.distance)
        val maxSpeed = snapshot.maxSpeedMps?.let { convertSpeedFromSI(it, units.speed) } ?: 0.0
        val avgSpeed = snapshot.avgSpeedMps?.let { convertSpeedFromSI(it, units.speed) } ?: 0.0
        // Resolve each tile's value once, mirroring the matching web call, then assemble the grid below.
        val distanceValue = animated(distance, DISTANCE_DECIMALS, UNIT_SPACE + distanceLabel, locale)
        val durationValue = DriveStatValue.Static(formatDriveDuration(snapshot.durationS / SECONDS_PER_MINUTE))
        val maxSpeedValue = animated(maxSpeed, SPEED_DECIMALS, speedSuffix, locale)
        val avgSpeedValue = animated(avgSpeed, SPEED_DECIMALS, speedSuffix, locale)
        val socValue = DriveStatValue.Static(socText(snapshot, locale))
        val powerValue = DriveStatValue.Static(withUnit(snapshot.powerMaxKw, KW_UNIT, prefs.precision, locale))
        val elevGainValue = animated(roundWhole(snapshot.elevGainM), ELEV_DECIMALS, ELEV_GAIN_SUFFIX, locale)
        val elevLossValue = animated(roundWhole(snapshot.elevLossM), ELEV_DECIMALS, ELEV_LOSS_SUFFIX, locale)
        val tiles =
            mutableListOf(
                DriveStatTile(DriveStat.Distance, strings.distance, distanceValue),
                DriveStatTile(DriveStat.Duration, strings.duration, durationValue),
                DriveStatTile(DriveStat.MaxSpeed, strings.maxSpeed, maxSpeedValue),
                DriveStatTile(DriveStat.AvgSpeed, strings.avgSpeed, avgSpeedValue),
                DriveStatTile(DriveStat.Soc, strings.soc, socValue),
                DriveStatTile(DriveStat.MaxPower, strings.maxPower, powerValue),
                DriveStatTile(DriveStat.ElevGain, strings.elevGain, elevGainValue),
                DriveStatTile(DriveStat.ElevLoss, strings.elevLoss, elevLossValue),
            )
        if (snapshot.energyWh > 0) {
            val kwh = snapshot.energyWh / WH_PER_KWH
            val cost = DriveStatValue.Static(formatEnergyCost(kwh, prefs, locale))
            tiles += DriveStatTile(DriveStat.TripCost, strings.tripCost, cost)
        }
        if (snapshot.energyWh > 0 && snapshot.distanceM > 0) {
            val kwh = snapshot.energyWh / WH_PER_KWH
            val perUnit = costPerDistanceUnit(kwh, snapshot.distanceM, prefs) ?: 0.0
            val label = String.format(locale, strings.costPerUnitTemplate, distanceLabel)
            val perUnitValue = DriveStatValue.Static(prefs.currencySymbol + fmt(perUnit, COST_PER_UNIT_DECIMALS, locale))
            tiles += DriveStatTile(DriveStat.CostPerUnit, label, perUnitValue)
        }
        return tiles
    }

    /** Web `formatDuration(min)`: `${h}h ${m}m` when there is an hour part, else `${m}m`. */
    fun formatDriveDuration(minutes: Double): String {
        val hours = floor(minutes / MINUTES_PER_HOUR).toInt()
        val mins = (minutes % MINUTES_PER_HOUR).roundToInt()
        return if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
    }

    /** Builds the web SOC string ``${fmtInt(start)}% → ${fmtInt(end)}%`` with locale-grouped integers. */
    private fun socText(
        snapshot: DriveStatCardsSnapshot,
        locale: Locale,
    ): String {
        val start = fmtInt(snapshot.startBatteryPct, locale)
        val end = fmtInt(snapshot.endBatteryPct, locale)
        return "$start$PERCENT $SOC_ARROW $end$PERCENT"
    }

    /** Web `useFormatting().formatEnergyCost(kwh)` = `${currencySymbol}${fmtNumber(kwh * costPerKwh, precision)}`. */
    private fun formatEnergyCost(
        kwh: Double,
        prefs: DriveStatDisplayPrefs,
        locale: Locale,
    ): String = prefs.currencySymbol + fmt(kwh * prefs.costPerKwh, prefs.precision, locale)

    /**
     * Web `useFormatting().costPerDistanceUnit(kwh, distanceM)`: `null` when the distance is non-positive,
     * otherwise the energy cost divided by the distance converted to the user's display unit (or `null` when
     * that conversion is non-positive). The Cost / {unit} tile substitutes `0` for a `null` (web `?? 0`).
     */
    private fun costPerDistanceUnit(
        kwh: Double,
        distanceM: Double,
        prefs: DriveStatDisplayPrefs,
    ): Double? {
        if (distanceM <= 0) return null
        val cost = kwh * prefs.costPerKwh
        val distance = convertDistanceFromSI(distanceM, prefs.units.distance)
        return if (distance > 0) cost / distance else null
    }

    /** A web `<AnimatedNumber>` tile value: the final string plus the numeric parts the count-up animates over. */
    private fun animated(
        value: Double,
        decimals: Int,
        suffix: String,
        locale: Locale,
    ): DriveStatValue.Animated =
        DriveStatValue.Animated(text = fmt(value, decimals, locale) + suffix, value = value, decimals = decimals, suffix = suffix)

    /** Web `fmtInt(v)` = `fmtNumber(safeNumber(v), 0)`: a null/non-finite value renders as `0`. */
    private fun fmtInt(
        value: Double?,
        locale: Locale,
    ): String = fmt(safe(value), INT_DECIMALS, locale)

    /** Web `fmtWithUnit(v, unit, d)` = `${fmtNumber(v, d)} ${unit}`. */
    private fun withUnit(
        value: Double,
        unit: String,
        decimals: Int,
        locale: Locale,
    ): String = fmt(value, decimals, locale) + UNIT_SPACE + unit

    /**
     * Web `fmtNumber(value, decimals)` — a locale-grouped number including the web `safeNumber` guard (a
     * non-finite value renders as `0`, never the [ChartFormat] em dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals.coerceAtLeast(0), locale)

    /** Web `Math.round` (ties toward positive infinity) returned as a whole double for the elevation tiles. */
    private fun roundWhole(value: Double): Double = if (value.isFinite()) value.roundToLong() * 1.0 else 0.0

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a distance,
 * speed, battery level, power, elevation, energy, or cost figure — so a diagnostics line can never leak a
 * drive's route, economics, or vehicle identity.
 */
object DriveStatCardsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DriveStatCards"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject?.doubleOrNull(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull
