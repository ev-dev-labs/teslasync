// Pure, framework-free model + projection for the Charge Status Live dashboard widget — the native
// analogue of the data the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The values arrive SI from the typed shared API models and are
// converted at this display boundary exactly as the web does (energy Wh -> kWh, charge-rate metres ->
// the user's distance unit), while charger_power and time_to_full_charge are read verbatim the way the
// web reads them (kW and hours) so the native surface reproduces the web's observable output.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargeStatusLiveWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargestatuslive

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

private const val EM_DASH = "\u2014"
private const val COMMA_SPACE = ", "
private const val MINUTES_PER_HOUR = 60

/**
 * The widget's grid footprint (columns x rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isTall` logic in the web source: a single 1x1 cell renders the compact hero, otherwise
 * the full view, and two-or-more rows add the Rate + Battery row.
 */
data class ChargeStatusLiveSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single 1x1 cell (web `size.cols <= 1 && size.rows <= 1`): show the compact hero. */
    val isCompact: Boolean get() = cols <= 1 && rows <= 1

    /** True at two or more rows (web `size.rows >= 2`): the full charging view adds the Rate + Battery row. */
    val isTall: Boolean get() = rows >= 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`charge-status-live`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object ChargeStatusLiveRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "charge-status-live"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ChargeStatusLiveWidget"

    /** Page size the web hook requests (`useChargingSessionsPaginated(id, { limit: 1 })`). */
    const val SESSION_LIMIT = 1

    /** Default footprint: 2 columns x 2 rows. */
    val defaultSize = ChargeStatusLiveSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column x 2 rows. */
    val minSize = ChargeStatusLiveSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns x 40 rows. */
    val maxSize = ChargeStatusLiveSize(cols = 3, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ChargeStatusLiveSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargeStatusLiveSize): ChargeStatusLiveSize =
        ChargeStatusLiveSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Glyph family for a metric-cell / hero icon; mapped to a concrete `ImageVector` at the render boundary. */
enum class ChargeStatusLiveGlyph { Zap, BatteryCharging, Plug, Timer, Gauge }

/**
 * The combined live-charge snapshot the view-model projects — the native union of the two web queries
 * the component composes: the live vehicle [state] (primary, drives every charging metric and the
 * freshness/error chrome) plus the best-effort newest [latestSession] (supplementary, may be `null`).
 * A `null` [state] models the web `stateData?.state` being undefined (the surface shows its empty
 * state). Pure data so the projection is unit-tested without a UI host.
 */
data class ChargeStatusLiveSnapshot(
    val state: VehicleState?,
    val latestSession: ChargingSession?,
)

/**
 * One small metric cell — the native counterpart of the web `MetricCell` (a leading glyph, a localized
 * label and a pre-formatted value, plus a TalkBack name folding the two). Pure data — no Compose types.
 */
data class ChargeStatusLiveCell(
    val glyph: ChargeStatusLiveGlyph,
    val label: String,
    val value: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the live charge surface for one footprint + unit
 * preference — the native analogue of everything the web component computes before returning JSX (the
 * derived `metrics`, the `formatTime` string, the unit-converted energy/rate strings, and the compact /
 * charging / idle composition flags). Pure data so the projection is unit-tested without a UI host.
 */
data class ChargeStatusLiveDisplay(
    val isCharging: Boolean,
    val isCompact: Boolean,
    val isTall: Boolean,
    val hasSession: Boolean,
    val powerValue: Double,
    val powerSuffix: String,
    val powerText: String,
    val batteryPercentText: String,
    val chargingBadgeLabel: String,
    val notChargingText: String,
    val voltage: ChargeStatusLiveCell,
    val current: ChargeStatusLiveCell,
    val timeLeft: ChargeStatusLiveCell,
    val added: ChargeStatusLiveCell,
    val rate: ChargeStatusLiveCell,
    val battery: ChargeStatusLiveCell,
    val lastSessionLabel: String,
    val lastSessionValue: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [ChargeStatusLiveProjection] reads the metric labels + charging/notCharging/lastSession words; the
 * composable chrome additionally reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel] /
 * [formatRelative]. The composable builds this from `stringResource`; tests pass a deterministic
 * instance. Keeping i18n out of the projection lets the projection stay a pure, locale-stable function.
 */
data class ChargeStatusLiveStrings(
    val title: String,
    val emptyMessage: String,
    val charging: String,
    val notCharging: String,
    val voltage: String,
    val current: String,
    val timeLeft: String,
    val added: String,
    val rate: String,
    val battery: String,
    val lastSession: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * Pure projection from a decoded [VehicleState] (+ best-effort [ChargingSession]) to the
 * [ChargeStatusLiveDisplay] — the native port of the web component's `metrics` memo, its `formatTime`
 * helper and its compact / charging / idle branches. Energy is always rendered in kWh (the web
 * hard-codes `convertEnergyFromSI(..., 'kWh')`); the charge rate honours the user's distance preference
 * (web `convertDistanceFromSI(..., unitPrefs.distance)`); voltage and current are always the em-dash
 * fallback because the web hard-codes them to `null`; charger power is read verbatim as kW and time as
 * hours, exactly as the web reads them.
 */
object ChargeStatusLiveProjection {
    /** Power readout suffix (web `AnimatedNumber suffix=" kW"`). */
    const val POWER_SUFFIX = " kW"

    /** Power readout fraction digits (web `AnimatedNumber decimals={1}`). */
    const val POWER_PRECISION = 1

    /** Energy readout fraction digits (web `fmtNumber(..., 1)`). */
    const val ENERGY_PRECISION = 1

    /** Charge-rate readout fraction digits (web `fmtNumber(..., 0)`). */
    const val RATE_PRECISION = 0

    /** Project [state] (+ optional [session]) for [size] + [units] using the localized [strings]. */
    fun project(
        state: VehicleState,
        session: ChargingSession?,
        size: ChargeStatusLiveSize,
        units: UnitPref,
        strings: ChargeStatusLiveStrings,
    ): ChargeStatusLiveDisplay {
        // Web parity: derive the same `metrics` the component memoises.
        val power = safe(state.chargerPower)
        val energyAddedWh = safe(session?.totalEnergyAddedWh ?: 0.0)
        val timeToFull = safe(state.timeToFullCharge)
        val chargeRate = safe(state.chargeRate)
        val batteryPercent = "${state.batteryLevel}%"

        val powerText = formatNumber(power, POWER_PRECISION) + POWER_SUFFIX
        val energyText = formatEnergyKwh(energyAddedWh)

        val voltage = cell(ChargeStatusLiveGlyph.Gauge, strings.voltage, EM_DASH)
        val current = cell(ChargeStatusLiveGlyph.Zap, strings.current, EM_DASH)
        val timeLeft = cell(ChargeStatusLiveGlyph.Timer, strings.timeLeft, formatTime(timeToFull))
        val added = cell(ChargeStatusLiveGlyph.Zap, strings.added, energyText)
        val rate = cell(ChargeStatusLiveGlyph.Gauge, strings.rate, formatRate(chargeRate, units))
        val battery = cell(ChargeStatusLiveGlyph.BatteryCharging, strings.battery, batteryPercent)

        val compactDescription =
            if (state.isCharging) {
                "$powerText$COMMA_SPACE$batteryPercent"
            } else {
                "${strings.notCharging}$COMMA_SPACE$batteryPercent"
            }

        return ChargeStatusLiveDisplay(
            isCharging = state.isCharging,
            isCompact = size.isCompact,
            isTall = size.isTall,
            hasSession = session != null,
            powerValue = power,
            powerSuffix = POWER_SUFFIX,
            powerText = powerText,
            batteryPercentText = batteryPercent,
            chargingBadgeLabel = strings.charging,
            notChargingText = strings.notCharging,
            voltage = voltage,
            current = current,
            timeLeft = timeLeft,
            added = added,
            rate = rate,
            battery = battery,
            lastSessionLabel = strings.lastSession,
            lastSessionValue = "+$energyText",
            compactContentDescription = compactDescription,
        )
    }

    /**
     * Format an hours-to-full value exactly as the web `formatTime`: non-positive -> em dash, otherwise
     * a compact "Hh Mm" (dropping the hour when zero and the minute when zero), the minute rounded the
     * same way (`Math.round((hours - h) * 60)`), reproduced verbatim — including its no-carry edge.
     */
    fun formatTime(hours: Double): String {
        if (!hours.isFinite() || hours <= 0.0) return EM_DASH
        val h = floor(hours).toInt()
        val m = ((hours - h) * MINUTES_PER_HOUR).roundToInt()
        return when {
            h == 0 -> "${m}m"
            m == 0 -> "${h}h"
            else -> "${h}h ${m}m"
        }
    }

    /** Format SI watt-hours as the web does — kWh to one fraction digit (web `convertEnergyFromSI(..., 'kWh')`). */
    fun formatEnergyKwh(wh: Double): String {
        val kwh = convertEnergyFromSI(safe(wh), EnergyUnitPref.KWH)
        return "${formatNumber(kwh, ENERGY_PRECISION)} ${EnergyUnitPref.KWH.label}"
    }

    /** Format an SI range-added rate as "{value} {distanceUnit}/h" honouring the user's distance preference. */
    fun formatRate(
        meters: Double,
        units: UnitPref,
    ): String {
        val display = convertDistanceFromSI(safe(meters), units.distance)
        return "${formatNumber(display, RATE_PRECISION)} ${units.distance.label}/h"
    }

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): en-US grouping + fixed fraction digits with
     * round-half-up, matching `Intl.NumberFormat` / the shared `ChartFormat.number` the animated power
     * readout uses, so the projected strings are deterministic regardless of device locale.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = String.format(Locale.US, "%,.${decimals}f", value)

    private fun cell(
        glyph: ChargeStatusLiveGlyph,
        label: String,
        value: String,
    ): ChargeStatusLiveCell = ChargeStatusLiveCell(glyph, label, value, "$label $value")

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}
