// Render-boundary formatting + SI→display conversion for the AnalyticsPage surface (P1/S5). This is the single
// place the verbatim-SI [FleetAnalytics] model becomes display numbers + strings in the user's units — the
// native analogue of the web page's `useUnits()` / `useFormatting()` / `convertXFromSI` / `fmtNumber` calls
// scattered across the analytics sub-components. It performs NO unit math of its own: every conversion delegates
// to the shared `convertXFromSI` factors (apps/shared `units`), and number grouping delegates to the shared
// [ChartFormat]. The model never sees a converted value; only this boundary does.
//
// Currency mirrors the web `useFormatting().formatCurrency` = `${currencySymbol}${fmtNumber(amount, decimals)}`,
// where the web `currencySymbol` falls back to `'$'` when the settings document omits it. The Android settings
// document the unit formatter is derived from carries no currency field yet, so this boundary uses that same
// `'$'` fallback — honest and identical to a web install with no custom currency symbol.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import java.util.Locale

/** 1 mile = 1.609344 km exactly — the factor the web sub-components apply to scale Wh/km → Wh/mi. */
private const val KM_PER_MILE = 1.609344

/** Meters per kilometer / seconds per hour, used to lift the backend's km / km·h⁻¹ stats onto the SI floor. */
private const val METERS_PER_KM = 1000.0
private const val SECONDS_PER_HOUR = 3600.0

/** The web default currency symbol when `settings.currency_symbol` is unset (web `useFormatting`). */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/**
 * The display boundary a composable uses to turn SI [FleetAnalytics] values into the user's units + locale
 * strings. It wraps the live [UnitFormatter] (whose [UnitFormatter.prefs] carry the distance/speed/temperature
 * preferences) plus the device [locale] for number grouping. Construct one per render from the collected
 * `LocalDataContainer.unitFormatter` + the composition locale; it holds no mutable state.
 */
class AnalyticsFormat(
    private val units: UnitFormatter,
    private val locale: Locale,
    private val currencySymbol: String = DEFAULT_CURRENCY_SYMBOL,
) {
    private val distanceUnit get() = units.prefs.distance
    private val speedUnit get() = units.prefs.speed
    private val temperatureUnit get() = units.prefs.temperature
    private val energyUnit get() = units.prefs.energy

    /** The distance unit label for card subtitles + axis units (web `unitPrefs.distance`, e.g. `km` / `mi`). */
    val distanceLabel: String get() = distanceUnit.label

    /** The speed unit label (web `unitPrefs.speed`, e.g. `km/h` / `mph`). */
    val speedLabel: String get() = speedUnit.label

    /** The temperature unit label (web `unitPrefs.temperature`, e.g. `°C` / `°F`). */
    val temperatureLabel: String get() = temperatureUnit.label

    /** The efficiency unit label (web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyLabel: String get() = if (distanceUnit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    // ── Locale number / currency strings (web `fmtNumber` / `fmtInt` / `formatCurrency`) ─────────────────────

    /** Web `fmtNumber(value, decimals)` — locale-grouped fixed decimals, em-dash for null/non-finite. */
    fun number(value: Double?, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Web `fmtInt(value)` — locale-grouped integer, em-dash for null/non-finite. */
    fun int(value: Double?): String = ChartFormat.number(value, 0, locale)

    /** Web `formatCurrency(amount, decimals)` — `${symbol}${fmtNumber(amount, decimals)}`. */
    fun currency(value: Double?, decimals: Int = 2): String {
        if (value == null || !value.isFinite()) return EM_DASH
        return currencySymbol + ChartFormat.number(value, decimals, locale)
    }

    /** Web BatteryTab `formatEnergy(capacity_wh, { precision })` — SI watt-hours → the user's energy unit + label. */
    fun energy(wattHours: Double?, precision: Int? = null): String = units.energy(wattHours, precision)

    // ── SI → display numbers (for cards + chart series; converters owned by the shared units lib) ────────────

    /** Convert a backend SI-km distance to the display unit number (web `convertDistanceFromSI(km*1000, unit)`). */
    fun distanceFromKm(km: Double): Double = convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)

    /** Convert a backend km·h⁻¹ speed (SI floor m/s) to the display unit number (web `fromKmh`). */
    fun speedFromKmh(kmh: Double): Double = convertSpeedFromSI(kmh * METERS_PER_KM / SECONDS_PER_HOUR, speedUnit)

    /** Convert a backend °C temperature to the display unit number (web `convertTempFromSI`). */
    fun tempFromC(celsius: Double): Double = convertTempFromSI(celsius, temperatureUnit)

    /** Convert a backend SI-watt-hours capacity to the display energy unit number (web chart `capacity_wh`). */
    fun energyNumberFromWh(wattHours: Double): Double = convertEnergyFromSI(wattHours, energyUnit)

    /** Scale a backend Wh/km efficiency to the display unit (web `eff * KM_PER_MILE` when miles, else `eff`). */
    fun efficiencyDisplay(whPerKm: Double): Double =
        if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm
}
