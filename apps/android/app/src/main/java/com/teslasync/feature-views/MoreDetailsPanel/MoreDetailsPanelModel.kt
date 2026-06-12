// The pure, framework-free model + projection for the MoreDetailsPanel feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the drive-detail page, via useDriveDetailData) fetches
// the drive, computes the per-row aggregate `stats`, and passes `drive` + `stats` down. From those it renders two
// responsive grids inside one GlassPanel: a six-cell primary grid (Odometer, Range, Elevation Summary, Energy
// Consumed, Energy Recovered, Consumption) and, below a divider, a four-to-six-cell secondary grid (Avg Power,
// Avg Outside Temp + Avg Inside Temp — each gated on a non-null average — Min Speed, Battery Used, Net
// Consumption). Distance/range/odometer, speed and temperature convert from SI at render via `useUnits`; energy is
// shown as raw Wh or kWh; elevation as metres; power as raw kW; the battery delta as a plain percentage.
//
// This file owns the parts the web component expresses from those props: the SI-canonical slice of the inputs it
// reads ([MoreDetailsSnapshot]), the display preferences resolved from one `/settings` document (the native union
// of the web `useUnits` distance/speed/temperature reads plus the global `fmtNumber` precision + locale,
// [MoreDetailsDisplayPrefs]), the lifecycle projection onto the shared cache-then-network [UiState] (so the
// surface renders every state the P1/S8 layer can carry), the ordered primary + secondary cell lists reproducing
// each web `t()`/conversion/format/guard exactly, and the PII-safe `view.opened` diagnostic (P1/S11).
//
// Following the sibling DriveStatCards port, every user-preference-converted figure is carried in its SI canonical
// unit (metres, m/s, °C) and converted at this boundary via the shared `convert*FromSI` helpers — the source is
// never pre-baked into a display unit (Phase-48 SI-canonical rule; ADR-013 keeps the cache SI). Figures with no
// user preference (energy Wh, power kW, elevation m, battery %) are carried in the unit the web `stats` exposes.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/MoreDetailsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.moredetailspanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonElement
import java.util.Locale
import kotlin.math.floor

/** 1 kWh = 1000 Wh (the snapshot carries SI watt-hours; the web shows kWh once a figure exceeds the threshold). */
private const val WH_PER_KWH = 1000.0

/** Metres per kilometre — the web `energyWh / (distanceM / 1000)` consumption denominator. */
private const val METERS_PER_KM = 1000.0

/**
 * 1 mile = 1.609344 km, the web `toEfficiencyDisplay` factor: Wh/km × this = Wh/mi (a mile is longer, so it
 * consumes more Wh). Mirrors the inline `whPerKm * 1.609344` the web applies only when the distance unit is miles.
 */
private const val KM_PER_MILE = 1.609344

/** Web `energyWh > 1000` / `regenWh > 1000` / `(energyWh - regenWh) > 1000` kWh-vs-Wh switch (strictly greater). */
private const val KWH_THRESHOLD_WH = 1000.0

/** Web `fmtInt` precision (0 decimals) for the Min Speed value. */
private const val INT_DECIMALS = 0

/** Web default `fmtNumber`/`fmtWithUnit` precision fallback (the global `decimal_precision`, default 2). */
private const val DEFAULT_PRECISION = 2

/** Web hard-coded `'kW'` unit on the Avg Power value (no power-unit preference is applied). */
private const val KW_UNIT = "kW"

/** Web hard-coded `'Wh'` unit on the sub-kWh energy values. */
private const val WH_UNIT = "Wh"

/** Web hard-coded `'kWh'` unit on the energy values that exceed [KWH_THRESHOLD_WH]. */
private const val KWH_UNIT = "kWh"

/** Web hard-coded `' m'` metre unit on the elevation values. */
private const val METERS_UNIT = "m"

/** Web `Wh/km` efficiency unit (distance unit ≠ miles). */
private const val EFFICIENCY_WH_KM = "Wh/km"

/** Web `Wh/mi` efficiency unit (distance unit = miles). */
private const val EFFICIENCY_WH_MI = "Wh/mi"

/** Web `%` suffix on the Battery Used delta. */
private const val PERCENT = "%"

/** Web odometer/range connector `→` (U+2192) between the start and end figures. */
private const val ARROW = "\u2192"

/** Web Elevation `ArrowUpRight` glyph (U+2197) for the gain line — language-neutral in the a11y announcement. */
private const val UP_ARROW = "\u2197"

/** Web Elevation `ArrowDownRight` glyph (U+2198) for the loss line — language-neutral in the a11y announcement. */
private const val DOWN_ARROW = "\u2198"

/** Web `'?'` shown for a missing range end when the start is present (`endRange != null ? … : '?'`). */
private const val UNKNOWN = "?"

/** Em dash (U+2014) shown for an absent odometer/range/consumption value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** A single space joining a value to its trailing unit/segment (web template `${a} ${b}`). */
private const val SPACE = " "

/** Number-grouping locale fallback (web `fmtNumber` global locale default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

/**
 * The SI-canonical slice of the web `drive` + `stats` props this surface reads. Odometer/range/distance come off
 * the web `stats`/`DriveDetail` as SI metres (carried here so the display unit is applied at this boundary, never
 * pre-baked); the speeds off `DriveStats` as the SI minimum-moving m/s; the temperatures as the SI Celsius means
 * (mean-then-convert equals the web's convert-then-mean because the conversion is affine); energy/power/elevation
 * off `DriveStats` (`energyWh`/`regenWh` Wh, `avgPower` kW, `elevGain`/`elevLoss` metres); the battery
 * percentages off `DriveDetail`.
 *
 * Odometer figures are non-null with a `0` "absent" sentinel (web `stats.odometerStart`/`odometerEnd` are
 * `number` defaulting to 0, and the panel gates on their truthiness); range/temperature figures are nullable to
 * mirror the web `number | null` guards (`startRange != null`, `avgOutsideTemp !== null`); the battery
 * percentages are nullable to mirror `drive.startBatteryPct != null && drive.endBatteryPct != null`.
 *
 * @property odometerStartM odometer at the first sample, SI metres, 0 = absent (web `stats.odometerStart`).
 * @property odometerEndM odometer at the last sample, SI metres, 0 = absent (web `stats.odometerEnd`).
 * @property startRangeM rated/ideal range at the first sample, SI metres, or null (web `stats.startRange`).
 * @property endRangeM rated/ideal range at the last sample, SI metres, or null (web `stats.endRange`).
 * @property elevGainM cumulative elevation gain, metres (web `stats.elevGain`).
 * @property elevLossM cumulative elevation loss, metres (web `stats.elevLoss`).
 * @property energyWh energy used, SI watt-hours (web `stats.energyWh`).
 * @property regenWh energy recovered via regen, SI watt-hours (web `stats.regenWh`).
 * @property distanceM drive distance, SI metres (web `drive.distanceM`); the consumption denominator.
 * @property avgPowerKw average power in kW (web `stats.avgPower`, shown as raw kW with no unit preference).
 * @property avgOutsideTempC mean outside temperature, SI Celsius, or null (web `stats.avgOutsideTemp` source).
 * @property avgInsideTempC mean inside temperature, SI Celsius, or null (web `stats.avgInsideTemp` source).
 * @property minSpeedMps minimum moving speed, SI metres per second (web `stats.minSpd` source; 0 = no movement).
 * @property startBatteryPct battery percentage at drive start, or null (web `drive.startBatteryPct`).
 * @property endBatteryPct battery percentage at drive end, or null (web `drive.endBatteryPct`).
 */
data class MoreDetailsSnapshot(
    val odometerStartM: Double,
    val odometerEndM: Double,
    val startRangeM: Double?,
    val endRangeM: Double?,
    val elevGainM: Double,
    val elevLossM: Double,
    val energyWh: Double,
    val regenWh: Double,
    val distanceM: Double,
    val avgPowerKw: Double,
    val avgOutsideTempC: Double?,
    val avgInsideTempC: Double?,
    val minSpeedMps: Double,
    val startBatteryPct: Double?,
    val endBatteryPct: Double?,
)

/**
 * The display preferences this surface resolves from the live `/settings` document — the native union of the web
 * `useUnits` (distance/speed/temperature display units, via [UnitPreferences.fromSettings]) and the global
 * `fmtNumber` precision + locale (`decimal_precision` + `locale`, also derived from `useSettings`). Resolved once
 * at the Compose boundary and threaded into the pure projection.
 *
 * @property units the SI -> display unit preferences (distance/speed/temperature labels + locale + precision).
 * @property precision the default fraction digits the web `fmtNumber` applies when no per-call override is given.
 * @property locale the BCP-47 locale driving number grouping/separators (web `fmtNumber` global locale).
 */
data class MoreDetailsDisplayPrefs(
    val units: UnitPref,
    val precision: Int,
    val locale: Locale,
) {
    companion object {
        /** The metric / 2-dp / en-US defaults applied before settings load (web cold-start defaults). */
        val DEFAULT: MoreDetailsDisplayPrefs = from(null)

        /** Resolves the unit + precision + locale preferences from one `/settings` document. */
        fun from(settings: JsonElement?): MoreDetailsDisplayPrefs {
            val units = UnitPreferences.fromSettings(settings)
            return MoreDetailsDisplayPrefs(
                units = units,
                precision = units.precision ?: DEFAULT_PRECISION,
                locale = localeFor(units.locale),
            )
        }
    }
}

/**
 * The twelve detail cells the web component renders, in source order: the six-cell primary grid followed by the
 * up-to-six-cell secondary grid. Identity only — labels/accents resolve at the Compose boundary, keeping this
 * enum free of any Android or i18n dependency.
 */
enum class MoreDetail {
    Odometer,
    Range,
    Elevation,
    EnergyConsumed,
    EnergyRecovered,
    Consumption,
    AvgPower,
    AvgOutsideTemp,
    AvgInsideTemp,
    MinSpeed,
    BatteryUsed,
    NetConsumption,
}

/**
 * One cell's render-ready value. Most cells render a single value (with an optional trailing unit shown smaller
 * and muted, the web `<span class="text-xs text-muted">{unit}</span>`); the Elevation cell renders two arrowed
 * lines (gain ↗ and loss ↘). [announce] is the flat accessibility/assertion text.
 */
sealed interface MoreDetailValue {
    /** Flat text for the TalkBack announcement and the off-device assertions. */
    val announce: String

    /**
     * A value string plus an optional [unit] rendered smaller and muted. When [unit] is blank the cell's unit is
     * already baked into [value] (the web energy/temperature/min-speed/battery cells) or absent.
     */
    data class Measure(
        val value: String,
        val unit: String = "",
    ) : MoreDetailValue {
        override val announce: String get() = if (unit.isBlank()) value else "$value$SPACE$unit"
    }

    /** The Elevation cell: a gain line (web `ArrowUpRight`) and a loss line (web `ArrowDownRight`). */
    data class Elevation(
        val gain: String,
        val loss: String,
    ) : MoreDetailValue {
        override val announce: String get() = "$UP_ARROW$SPACE$gain, $DOWN_ARROW$SPACE$loss"
    }
}

/**
 * One fully resolved cell — the native analogue of a single web `<div class="text-center">`. Pure data (no
 * Compose types) so the whole projection is asserted off-device. [label] is already localized (resolved from the
 * i18n catalog at the Compose boundary and handed in via [MoreDetailsStrings]).
 */
data class MoreDetailRow(
    val detail: MoreDetail,
    val label: String,
    val value: MoreDetailValue,
)

/**
 * The localized strings the composable resolves once (P1/S10) and threads into the projection so the render-ready
 * cells carry no English literal. Keys map 1:1 to the web `t('driveDetail.*')` calls; [noData] backs the friendly
 * empty state and [title] backs the panel header.
 */
data class MoreDetailsStrings(
    val title: String,
    val odometer: String,
    val rangeStartEnd: String,
    val elevSummary: String,
    val energyConsumed: String,
    val energyRecovered: String,
    val consumptionRate: String,
    val avgPower: String,
    val avgOutsideTemp: String,
    val avgInsideTemp: String,
    val minSpeed: String,
    val batteryUsed: String,
    val netEnergy: String,
    val noData: String,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's per-cell
 * branches, conversions, and formats. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings + accents and draws what these return.
 */
object MoreDetailsProjection {
    /**
     * Maps the surface's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: MoreDetailsSnapshot?,
        isLoading: Boolean,
    ): UiState<MoreDetailsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The six primary-grid cells (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-7`), in source order. Always all
     * six present, reproducing the web markup which renders no conditional cell in this grid.
     */
    fun primaryRows(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        strings: MoreDetailsStrings,
    ): List<MoreDetailRow> {
        val units = prefs.units
        val locale = prefs.locale
        val distanceLabel = units.distance.label
        return listOf(
            MoreDetailRow(MoreDetail.Odometer, strings.odometer, odometerValue(snapshot, prefs, distanceLabel)),
            MoreDetailRow(MoreDetail.Range, strings.rangeStartEnd, rangeValue(snapshot, prefs, distanceLabel)),
            MoreDetailRow(MoreDetail.Elevation, strings.elevSummary, elevationValue(snapshot, prefs)),
            MoreDetailRow(MoreDetail.EnergyConsumed, strings.energyConsumed, energyValue(snapshot.energyWh, prefs)),
            MoreDetailRow(MoreDetail.EnergyRecovered, strings.energyRecovered, energyValue(snapshot.regenWh, prefs)),
            MoreDetailRow(MoreDetail.Consumption, strings.consumptionRate, consumptionValue(snapshot, prefs)),
        )
    }

    /**
     * The secondary-grid cells (web `grid-cols-2 sm:grid-cols-4`), in source order. Avg Outside Temp and Avg
     * Inside Temp are appended only when their SI mean is non-null, reproducing the web
     * `{stats.avgOutsideTemp !== null && …}` / `{stats.avgInsideTemp !== null && …}` guards, so the grid carries
     * four to six cells.
     */
    fun secondaryRows(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        strings: MoreDetailsStrings,
    ): List<MoreDetailRow> {
        val rows = mutableListOf<MoreDetailRow>()
        rows += MoreDetailRow(MoreDetail.AvgPower, strings.avgPower, avgPowerValue(snapshot, prefs))
        if (snapshot.avgOutsideTempC != null) {
            rows += MoreDetailRow(MoreDetail.AvgOutsideTemp, strings.avgOutsideTemp, tempValue(snapshot.avgOutsideTempC, prefs))
        }
        if (snapshot.avgInsideTempC != null) {
            rows += MoreDetailRow(MoreDetail.AvgInsideTemp, strings.avgInsideTemp, tempValue(snapshot.avgInsideTempC, prefs))
        }
        rows += MoreDetailRow(MoreDetail.MinSpeed, strings.minSpeed, minSpeedValue(snapshot, prefs))
        rows += MoreDetailRow(MoreDetail.BatteryUsed, strings.batteryUsed, batteryUsedValue(snapshot))
        rows += MoreDetailRow(MoreDetail.NetConsumption, strings.netEnergy, netConsumptionValue(snapshot, prefs))
        return rows
    }

    /**
     * Web Odometer: `stats.odometerStart && stats.odometerEnd ? \`${fmtNumber(start)} → ${fmtNumber(end)}\` : '—'`
     * with an always-shown distance-unit span. Both figures must be non-zero (truthy) to show the arrow string.
     */
    private fun odometerValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        distanceLabel: String,
    ): MoreDetailValue.Measure {
        val value =
            if (snapshot.odometerStartM > 0 && snapshot.odometerEndM > 0) {
                val start = num(convertDistanceFromSI(snapshot.odometerStartM, prefs.units.distance), prefs)
                val end = num(convertDistanceFromSI(snapshot.odometerEndM, prefs.units.distance), prefs)
                "$start$SPACE$ARROW$SPACE$end"
            } else {
                EM_DASH
            }
        return MoreDetailValue.Measure(value, distanceLabel)
    }

    /**
     * Web Range: `stats.startRange != null ? \`${fmtNumber(start)} → ${end != null ? fmtNumber(end) : '?'}\` : '—'`
     * with an always-shown distance-unit span.
     */
    private fun rangeValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
        distanceLabel: String,
    ): MoreDetailValue.Measure {
        val start = snapshot.startRangeM
        val value =
            if (start != null) {
                val startText = num(convertDistanceFromSI(start, prefs.units.distance), prefs)
                val endText =
                    snapshot.endRangeM?.let { num(convertDistanceFromSI(it, prefs.units.distance), prefs) } ?: UNKNOWN
                "$startText$SPACE$ARROW$SPACE$endText"
            } else {
                EM_DASH
            }
        return MoreDetailValue.Measure(value, distanceLabel)
    }

    /** Web Elevation Summary: a green `↗ ${fmtNumber(elevGain)} m` line over a red `↘ ${fmtNumber(elevLoss)} m`. */
    private fun elevationValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Elevation =
        MoreDetailValue.Elevation(
            gain = "${num(snapshot.elevGainM, prefs)}$SPACE$METERS_UNIT",
            loss = "${num(snapshot.elevLossM, prefs)}$SPACE$METERS_UNIT",
        )

    /** Web energy cell: `wh > 1000 ? fmtWithUnit(wh / 1000, 'kWh') : \`${fmtNumber(wh)} Wh\``. */
    private fun energyValue(
        wh: Double,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure {
        val text =
            if (wh > KWH_THRESHOLD_WH) {
                "${num(wh / WH_PER_KWH, prefs)}$SPACE$KWH_UNIT"
            } else {
                "${num(wh, prefs)}$SPACE$WH_UNIT"
            }
        return MoreDetailValue.Measure(text)
    }

    /**
     * Web Consumption: `stats.consumptionWhKm > 0 ? fmtNumber(toEfficiencyDisplay(consumptionWhKm)) : '—'` with an
     * always-shown efficiency-unit span. `consumptionWhKm = distanceM > 0 ? energyWh / (distanceM / 1000) : 0`;
     * `toEfficiencyDisplay` multiplies by [KM_PER_MILE] only when the distance unit is miles.
     */
    private fun consumptionValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure {
        val isMiles = prefs.units.distance == DistanceUnitPref.MI
        val unit = if (isMiles) EFFICIENCY_WH_MI else EFFICIENCY_WH_KM
        val consumptionWhKm =
            if (snapshot.distanceM > 0) snapshot.energyWh / (snapshot.distanceM / METERS_PER_KM) else 0.0
        val value =
            if (consumptionWhKm > 0) {
                val display = if (isMiles) consumptionWhKm * KM_PER_MILE else consumptionWhKm
                num(display, prefs)
            } else {
                EM_DASH
            }
        return MoreDetailValue.Measure(value, unit)
    }

    /** Web Avg Power: `${fmtNumber(stats.avgPower)} <span>kW</span>`. */
    private fun avgPowerValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure = MoreDetailValue.Measure(num(snapshot.avgPowerKw, prefs), KW_UNIT)

    /** Web Avg Outside/Inside Temp: `${fmtNumber(avgTemp)}${tempUnit}` (no space; the SI Celsius converts here). */
    private fun tempValue(
        celsius: Double,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure {
        val display = convertTempFromSI(celsius, prefs.units.temperature)
        return MoreDetailValue.Measure("${num(display, prefs)}${prefs.units.temperature.label}")
    }

    /** Web Min Speed: `${fmtInt(stats.minSpd)} {speedUnit}` (unit baked in, same secondary style). */
    private fun minSpeedValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure {
        val display = convertSpeedFromSI(snapshot.minSpeedMps, prefs.units.speed)
        return MoreDetailValue.Measure("${fmtInt(display, prefs.locale)}$SPACE${prefs.units.speed.label}")
    }

    /**
     * Web Battery Used: `drive.startBatteryPct != null && drive.endBatteryPct != null ? \`${start - end}%\` : '—'`.
     * The delta is rendered as a plain number (integer when whole, like JS `${20}`), never via `fmtNumber`.
     */
    private fun batteryUsedValue(snapshot: MoreDetailsSnapshot): MoreDetailValue.Measure {
        val start = snapshot.startBatteryPct
        val end = snapshot.endBatteryPct
        val value = if (start != null && end != null) "${plainNumber(start - end)}$PERCENT" else EM_DASH
        return MoreDetailValue.Measure(value)
    }

    /** Web Net Consumption: `(energyWh - regenWh) > 1000 ? fmtWithUnit(net / 1000, 'kWh') : \`${fmtNumber(net)} Wh\``. */
    private fun netConsumptionValue(
        snapshot: MoreDetailsSnapshot,
        prefs: MoreDetailsDisplayPrefs,
    ): MoreDetailValue.Measure = energyValue(snapshot.energyWh - snapshot.regenWh, prefs)

    /** Web `fmtNumber(v)` at the global precision: a locale-grouped number with the `safeNumber` non-finite→0 guard. */
    private fun num(
        value: Double,
        prefs: MoreDetailsDisplayPrefs,
    ): String = fmt(value, prefs.precision, prefs.locale)

    /** Web `fmtInt(v)` = `fmtNumber(safeNumber(v), 0)`: a null/non-finite value renders as `0`. */
    private fun fmtInt(
        value: Double,
        locale: Locale,
    ): String = fmt(value, INT_DECIMALS, locale)

    /**
     * Web `fmtNumber(value, decimals)` — a locale-grouped number including the web `safeNumber` guard (a
     * non-finite value renders as `0`, never the [ChartFormat] em dash, matching the web output).
     */
    private fun fmt(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals.coerceAtLeast(0), locale)

    /**
     * Renders a finite double the way JS string interpolation does for the battery delta: an integer when the
     * value is whole (`${20}` -> "20"), otherwise its shortest decimal form. Non-finite values render as `0`.
     */
    private fun plainNumber(value: Double): String =
        when {
            !value.isFinite() -> "0"
            value == floor(value) -> value.toLong().toString()
            else -> value.toString()
        }

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a distance,
 * range, elevation, energy, power, temperature, speed, battery, or cost figure — so a diagnostics line can never
 * leak a drive's route, economics, or vehicle identity.
 */
object MoreDetailsPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MoreDetailsPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
private fun localeFor(tag: String?): Locale = Locale.forLanguageTag(tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG)
