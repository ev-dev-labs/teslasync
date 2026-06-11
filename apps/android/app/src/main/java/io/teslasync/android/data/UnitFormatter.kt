package io.teslasync.android.data

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatDuration
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatPower
import io.teslasync.shared.core.units.formatPressure
import io.teslasync.shared.core.units.formatSpeed
import io.teslasync.shared.core.units.formatTemperature
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Resolves the user's display [UnitPref] from the raw `/settings` document — the Kotlin port of the
 * web `useUnits` derivation (web/src/hooks/useUnits.ts). The backend stores and serves SI; this is the
 * single place a settings preference becomes a display unit, so the SI source is never stored
 * converted (Phase-48 SI-canonical rule; ADR-013 keeps the cache itself SI).
 *
 * Derivation mirrors the web verbatim: `unit_of_length == "mi"` -> miles + mph (else km + km/h),
 * `unit_of_temp == "F"` -> Fahrenheit (else Celsius), `unit_of_pressure == "psi"` -> psi (else bar),
 * `locale` non-blank else en-US, `decimal_precision` finite & >= 0 else default. Energy/duration/power
 * have no settings field yet, so they take the same kWh / hours / kW defaults the web hook applies.
 */
object UnitPreferences {
    private const val UNIT_OF_LENGTH = "unit_of_length"
    private const val UNIT_OF_TEMP = "unit_of_temp"
    private const val UNIT_OF_PRESSURE = "unit_of_pressure"
    private const val LOCALE = "locale"
    private const val DECIMAL_PRECISION = "decimal_precision"
    private const val DEFAULT_LOCALE = "en-US"

    /** Builds a [UnitPref] from the settings document, falling back to metric defaults when absent. */
    fun fromSettings(settings: JsonElement?): UnitPref {
        val obj = settings as? JsonObject
        val length = obj.string(UNIT_OF_LENGTH)
        val temp = obj.string(UNIT_OF_TEMP)
        val pressure = obj.string(UNIT_OF_PRESSURE)
        return UnitPref(
            distance = if (length == "mi") DistanceUnitPref.MI else DistanceUnitPref.KM,
            speed = if (length == "mi") SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = if (temp == "F") TemperatureUnitPref.FAHRENHEIT else TemperatureUnitPref.CELSIUS,
            pressure = if (pressure == "psi") PressureUnitPref.PSI else PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = obj.localeOrDefault(),
            precision = obj.precisionOrNull(),
        )
    }

    private fun JsonObject?.string(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

    private fun JsonObject?.localeOrDefault(): String {
        val raw = string(LOCALE)
        return if (raw != null && raw.isNotBlank()) raw else DEFAULT_LOCALE
    }

    private fun JsonObject?.precisionOrNull(): Int? {
        val value = (this?.get(DECIMAL_PRECISION) as? JsonPrimitive)?.doubleOrNull ?: return null
        return if (value.isFinite() && value >= 0) value.toInt() else null
    }
}

/**
 * The display-boundary formatter a screen uses to render SI values in the user's units. It is a thin
 * wrapper over the shared `formatX` functions bound to one resolved [prefs]; the `DataContainer`
 * exposes it as a `StateFlow` derived from the live settings, so a units change re-renders every
 * screen without any screen knowing how the preference is stored. It performs NO unit math itself (the
 * shared lib owns every factor) and never mutates the SI source.
 */
class UnitFormatter(
    val prefs: UnitPref,
) {
    /** Formats SI meters. */
    fun distance(
        meters: Double?,
        precision: Int? = null,
    ): String = formatDistance(meters, prefs, precision)

    /** Formats SI metres-per-second. */
    fun speed(
        metersPerSecond: Double?,
        precision: Int? = null,
    ): String = formatSpeed(metersPerSecond, prefs, precision)

    /** Formats SI degrees Celsius. */
    fun temperature(
        celsius: Double?,
        precision: Int? = null,
    ): String = formatTemperature(celsius, prefs, precision)

    /** Formats SI kilopascals. */
    fun pressure(
        kilopascals: Double?,
        precision: Int? = null,
    ): String = formatPressure(kilopascals, prefs, precision)

    /** Formats SI watt-hours. */
    fun energy(
        wattHours: Double?,
        precision: Int? = null,
    ): String = formatEnergy(wattHours, prefs, precision)

    /** Formats SI seconds. */
    fun duration(
        seconds: Double?,
        precision: Int? = null,
    ): String = formatDuration(seconds, prefs, precision)

    /** Formats SI watts. */
    fun power(
        watts: Double?,
        precision: Int? = null,
    ): String = formatPower(watts, prefs, precision)

    companion object {
        /** A formatter with the default (metric) preferences, for previews / cold start before settings load. */
        fun default(): UnitFormatter = UnitFormatter(UnitPreferences.fromSettings(null))
    }
}
