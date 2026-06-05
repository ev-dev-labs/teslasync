// SI-floor unit conversion + formatting (shared core).
//
// 1:1 port of the web app's SI-canonical block (web/src/lib/unitConversion.ts,
// the non-deprecated SI surface). The backend stores SI; producers deliver SI;
// renderers convert at the display boundary by the user's UnitPref. There is NO
// runtime fallback that "guesses the input unit" — that anti-pattern hid bugs in
// the legacy (deprecated) code, which is intentionally NOT ported (Phase-48).
//
// Authoritative SI baseline (mirrors the web module):
//   distance    -> meters (m)
//   speed       -> meters per second (m/s)
//   temperature -> degrees Celsius (deg C)
//   pressure    -> kilopascals (kPa)
//   energy      -> watt-hours (Wh)
//   duration    -> seconds (s)
//   power       -> watts (W)
//
// The string formatters reproduce the web's `Intl.NumberFormat` behaviour for the
// frontend display contract: fixed (min == max) fraction digits, en-US grouping,
// and ECMAScript `halfExpand` rounding applied to the shortest decimal
// representation of the value. Golden vectors (apps/shared/spec/units-golden.json)
// pin every result to the web truth so the future C# port is provably identical.

package io.teslasync.shared.core.units

import kotlin.math.abs

// ---------------------------------------------------------------------------
// SI canonical baseline (informational; renderers reference this so the
// canonical input contract is discoverable from a single export).
// ---------------------------------------------------------------------------

/** Canonical SI input units this module accepts (mirrors the web `SI` map). */
public object SI {
    public const val DISTANCE: String = "m"
    public const val SPEED: String = "m/s"
    public const val TEMPERATURE: String = "\u00B0C"
    public const val PRESSURE: String = "kPa"
    public const val ENERGY: String = "Wh"
    public const val DURATION: String = "s"
    public const val POWER: String = "W"
}

// ---------------------------------------------------------------------------
// User display preference bag (mirrors the web string-literal unions).
// ---------------------------------------------------------------------------

/** Distance display unit (target of [formatDistance]). */
public enum class DistanceUnitPref(
    public val label: String,
) {
    KM("km"),
    MI("mi"),
    FT("ft"),
    ;

    public companion object {
        public fun fromLabel(label: String): DistanceUnitPref = entries.first { it.label == label }
    }
}

/** Speed display unit (target of [formatSpeed]). */
public enum class SpeedUnitPref(
    public val label: String,
) {
    KMH("km/h"),
    MPH("mph"),
    ;

    public companion object {
        public fun fromLabel(label: String): SpeedUnitPref = entries.first { it.label == label }
    }
}

/** Temperature display unit (target of [formatTemperature]). */
public enum class TemperatureUnitPref(
    public val label: String,
) {
    CELSIUS("\u00B0C"),
    FAHRENHEIT("\u00B0F"),
    ;

    public companion object {
        public fun fromLabel(label: String): TemperatureUnitPref = entries.first { it.label == label }
    }
}

/** Pressure display unit (target of [formatPressure]). */
public enum class PressureUnitPref(
    public val label: String,
) {
    KPA("kPa"),
    PSI("psi"),
    BAR("bar"),
    ;

    public companion object {
        public fun fromLabel(label: String): PressureUnitPref = entries.first { it.label == label }
    }
}

/** Energy display unit (target of [formatEnergy]). */
public enum class EnergyUnitPref(
    public val label: String,
) {
    WH("Wh"),
    KWH("kWh"),
    ;

    public companion object {
        public fun fromLabel(label: String): EnergyUnitPref = entries.first { it.label == label }
    }
}

/** Duration display unit (target of [formatDuration]). */
public enum class DurationUnitPref(
    public val label: String,
) {
    SECONDS("s"),
    MINUTES("min"),
    HOURS("h"),
    DAYS("d"),
    ;

    public companion object {
        public fun fromLabel(label: String): DurationUnitPref = entries.first { it.label == label }
    }
}

/** Power display unit (target of [formatPower]). */
public enum class PowerUnitPref(
    public val label: String,
) {
    W("W"),
    KW("kW"),
    ;

    public companion object {
        public fun fromLabel(label: String): PowerUnitPref = entries.first { it.label == label }
    }
}

/**
 * Aggregates the user's per-quantity display preference plus locale + precision
 * hints. Callers compute one [UnitPref] per render and pass it to each `formatX`
 * call. There is intentionally no module-level cache — the caller owns the
 * preference lifecycle.
 *
 * @property locale BCP-47 locale tag. Only "en-US" grouping/separators are
 *   reproduced by the shared formatter (the web display contract); null = en-US.
 * @property precision default `maximumFractionDigits` when a `formatX` call has
 *   no per-call override.
 * @property emptyDisplay display fallback when a `formatX` receives
 *   null/NaN/non-finite input. Default em dash.
 */
public data class UnitPref(
    val distance: DistanceUnitPref,
    val speed: SpeedUnitPref,
    val temperature: TemperatureUnitPref,
    val pressure: PressureUnitPref,
    val energy: EnergyUnitPref,
    val duration: DurationUnitPref,
    val power: PowerUnitPref,
    val locale: String? = null,
    val precision: Int? = null,
    val emptyDisplay: String? = null,
)

// ---------------------------------------------------------------------------
// Conversion factors (NIST-grade where applicable). Each converter is a pure
// unidirectional function: SI input -> display unit.
// ---------------------------------------------------------------------------

/** 1 mile = 1609.344 m exactly (international yard, NIST). */
private const val METERS_PER_MILE = 1609.344

/** 1 km = 1000 m exactly. */
private const val METERS_PER_KM = 1000.0

/** 1 ft = 0.3048 m exactly (international foot, NIST). */
private const val METERS_PER_FOOT = 0.3048

/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
private const val KPA_PER_PSI = 6.894757

/** 1 bar = 100 kPa (BIPM definition). */
private const val KPA_PER_BAR = 100.0

/** Seconds in a minute / hour / day. */
private const val SECONDS_PER_MINUTE = 60.0
private const val SECONDS_PER_HOUR = 3600.0
private const val SECONDS_PER_DAY = 86400.0

// ---------------------------------------------------------------------------
// Pure SI -> display numeric converters. Every fn assumes SI input.
// ---------------------------------------------------------------------------

/** Convert distance from SI meters to the user's display unit. */
public fun convertDistanceFromSI(
    meters: Double,
    to: DistanceUnitPref,
): Double =
    when (to) {
        DistanceUnitPref.KM -> meters / METERS_PER_KM
        DistanceUnitPref.MI -> meters / METERS_PER_MILE
        DistanceUnitPref.FT -> meters / METERS_PER_FOOT
    }

/** Convert speed from SI meters-per-second to the user's display unit. */
public fun convertSpeedFromSI(
    mps: Double,
    to: SpeedUnitPref,
): Double =
    when (to) {
        SpeedUnitPref.KMH -> mps * SECONDS_PER_HOUR / METERS_PER_KM
        SpeedUnitPref.MPH -> mps * SECONDS_PER_HOUR / METERS_PER_MILE
    }

/** Convert temperature from SI Celsius to the user's display unit. */
public fun convertTempFromSI(
    celsius: Double,
    to: TemperatureUnitPref,
): Double =
    when (to) {
        TemperatureUnitPref.CELSIUS -> celsius
        TemperatureUnitPref.FAHRENHEIT -> celsius * 9 / 5 + 32
    }

/** Convert pressure from SI kilopascals to the user's display unit. */
public fun convertPressureFromSI(
    kpa: Double,
    to: PressureUnitPref,
): Double =
    when (to) {
        PressureUnitPref.KPA -> kpa
        PressureUnitPref.PSI -> kpa / KPA_PER_PSI
        PressureUnitPref.BAR -> kpa / KPA_PER_BAR
    }

/** Convert energy from SI watt-hours to the user's display unit. */
public fun convertEnergyFromSI(
    wh: Double,
    to: EnergyUnitPref,
): Double =
    when (to) {
        EnergyUnitPref.WH -> wh
        EnergyUnitPref.KWH -> wh / 1000.0
    }

/** Convert duration from SI seconds to the user's display unit. */
public fun convertDurationFromSI(
    seconds: Double,
    to: DurationUnitPref,
): Double =
    when (to) {
        DurationUnitPref.SECONDS -> seconds
        DurationUnitPref.MINUTES -> seconds / SECONDS_PER_MINUTE
        DurationUnitPref.HOURS -> seconds / SECONDS_PER_HOUR
        DurationUnitPref.DAYS -> seconds / SECONDS_PER_DAY
    }

/** Convert power from SI watts to the user's display unit. */
public fun convertPowerFromSI(
    watts: Double,
    to: PowerUnitPref,
): Double =
    when (to) {
        PowerUnitPref.W -> watts
        PowerUnitPref.KW -> watts / 1000.0
    }

// ---------------------------------------------------------------------------
// Locale-aware string formatters. Each fn returns the empty fallback (or
// pref.emptyDisplay) for null / NaN / non-finite inputs and never throws.
// ---------------------------------------------------------------------------

/** Default fallback string for nullish / NaN inputs (em dash). */
private const val DEFAULT_EMPTY_DISPLAY = "\u2014"

/** Default precision per quantity when `pref.precision` is unset. */
private const val PRECISION_DISTANCE = 1
private const val PRECISION_SPEED = 0
private const val PRECISION_TEMPERATURE = 1
private const val PRECISION_PRESSURE = 1
private const val PRECISION_ENERGY = 2
private const val PRECISION_DURATION = 0
private const val PRECISION_POWER = 2

private fun isFiniteNumber(v: Double?): Boolean = v != null && v.isFinite()

private fun resolveEmpty(pref: UnitPref): String = pref.emptyDisplay ?: DEFAULT_EMPTY_DISPLAY

private fun resolvePrecision(
    pref: UnitPref,
    override: Int?,
    fallback: Int,
): Int {
    if (override != null && override >= 0) return override
    val p = pref.precision
    if (p != null && p >= 0) return p
    return fallback
}

/** Format an SI-meters distance for display. null/NaN/non-finite -> fallback. */
public fun formatDistance(
    meters: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(meters)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_DISTANCE)
    val value = convertDistanceFromSI(meters!!, pref.distance)
    return "${formatNumber(value, pref.locale, digits)} ${pref.distance.label}"
}

/** Format an SI m/s speed for display. null/NaN/non-finite -> fallback. */
public fun formatSpeed(
    mps: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(mps)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_SPEED)
    val value = convertSpeedFromSI(mps!!, pref.speed)
    return "${formatNumber(value, pref.locale, digits)} ${pref.speed.label}"
}

/** Format an SI Celsius temperature for display. null/NaN/non-finite -> fallback. */
public fun formatTemperature(
    celsius: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(celsius)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_TEMPERATURE)
    val value = convertTempFromSI(celsius!!, pref.temperature)
    // No space between number and the degree unit (typographic convention).
    return "${formatNumber(value, pref.locale, digits)}${pref.temperature.label}"
}

/** Format an SI kilopascal pressure for display. null/NaN/non-finite -> fallback. */
public fun formatPressure(
    kpa: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(kpa)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_PRESSURE)
    val value = convertPressureFromSI(kpa!!, pref.pressure)
    return "${formatNumber(value, pref.locale, digits)} ${pref.pressure.label}"
}

/** Format an SI watt-hours energy for display. null/NaN/non-finite -> fallback. */
public fun formatEnergy(
    wh: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(wh)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_ENERGY)
    val value = convertEnergyFromSI(wh!!, pref.energy)
    return "${formatNumber(value, pref.locale, digits)} ${pref.energy.label}"
}

/** Format an SI seconds duration for display. null/NaN/non-finite -> fallback. */
public fun formatDuration(
    seconds: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(seconds)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_DURATION)
    val value = convertDurationFromSI(seconds!!, pref.duration)
    return "${formatNumber(value, pref.locale, digits)} ${pref.duration.label}"
}

/** Format SI watts for display. null/NaN/non-finite -> fallback. */
public fun formatPower(
    watts: Double?,
    pref: UnitPref,
    precision: Int? = null,
): String {
    if (!isFiniteNumber(watts)) return resolveEmpty(pref)
    val digits = resolvePrecision(pref, precision, PRECISION_POWER)
    val value = convertPowerFromSI(watts!!, pref.power)
    return "${formatNumber(value, pref.locale, digits)} ${pref.power.label}"
}

// ---------------------------------------------------------------------------
// Number formatting: reproduces `Intl.NumberFormat(locale, { min == max ==
// digits })` for the en-US display contract. ECMAScript rounds the SHORTEST
// decimal representation of the value with the default `halfExpand` mode
// (round half away from zero), then groups the integer part in threes.
// ---------------------------------------------------------------------------

private fun formatNumber(
    value: Double,
    locale: String?,
    fractionDigits: Int,
): String {
    // Only the en-US grouping/separator contract is reproduced here (the web
    // display contract). `locale` is accepted for API parity; non-en-US locales
    // still receive deterministic en-US grouping rather than throwing.
    val negative = value < 0.0 || (value == 0.0 && 1.0 / value < 0.0)
    val (intDigits, fracDigits) = roundHalfExpand(abs(value), fractionDigits)
    val grouped = groupThousands(intDigits)
    val body = if (fractionDigits > 0) "$grouped.$fracDigits" else grouped
    return if (negative) "-$body" else body
}

/**
 * Rounds the magnitude [absValue] to [digits] fractional digits using
 * ECMAScript `halfExpand` applied to the value's shortest decimal form.
 * Returns (integerDigits, fractionalDigits) as zero-padded decimal strings.
 */
private fun roundHalfExpand(
    absValue: Double,
    digits: Int,
): Pair<String, String> {
    val plain = toPlainDecimal(absValue)
    val dot = plain.indexOf('.')
    val intPart = if (dot < 0) plain else plain.substring(0, dot)
    val fracPart = if (dot < 0) "" else plain.substring(dot + 1)

    val keptFrac =
        if (fracPart.length >= digits) {
            fracPart.substring(0, digits)
        } else {
            fracPart + "0".repeat(digits - fracPart.length)
        }
    // halfExpand: round away from zero when the first dropped digit is >= 5.
    val roundUp = fracPart.length > digits && fracPart[digits] >= '5'

    var combined = intPart + keptFrac
    if (roundUp) combined = incrementDecimal(combined)

    val fracOut = if (digits == 0) "" else combined.substring(combined.length - digits)
    val intOut = if (digits == 0) combined else combined.substring(0, combined.length - digits)
    val intNormalized = intOut.trimStart('0').ifEmpty { "0" }
    return intNormalized to fracOut
}

/** Increments an unsigned decimal digit string by one, growing it if needed. */
private fun incrementDecimal(digits: String): String {
    val chars = digits.toCharArray()
    var i = chars.size - 1
    while (i >= 0) {
        if (chars[i] == '9') {
            chars[i] = '0'
            i--
        } else {
            chars[i] = chars[i] + 1
            return chars.concatToString()
        }
    }
    return "1" + chars.concatToString()
}

/** Groups an unsigned integer digit string with en-US thousands commas. */
private fun groupThousands(intDigits: String): String {
    if (intDigits.length <= 3) return intDigits
    val sb = StringBuilder()
    val firstGroup = intDigits.length % 3
    var idx = 0
    if (firstGroup > 0) {
        sb.append(intDigits, 0, firstGroup)
        idx = firstGroup
    }
    while (idx < intDigits.length) {
        if (sb.isNotEmpty()) sb.append(',')
        sb.append(intDigits, idx, idx + 3)
        idx += 3
    }
    return sb.toString()
}

/**
 * Expands a non-negative finite [value] to a plain (non-exponential) decimal
 * string using the platform's shortest round-trip [Double.toString]. The
 * shortest decimal matches the value ECMAScript rounds, keeping the shared
 * formatter aligned with the web's `Intl.NumberFormat`.
 */
private fun toPlainDecimal(value: Double): String {
    val s = value.toString()
    val eIdx = s.indexOfFirst { it == 'e' || it == 'E' }
    if (eIdx < 0) return s

    val mantissa = s.substring(0, eIdx)
    val exp = s.substring(eIdx + 1).toInt()
    val pointIdx = mantissa.indexOf('.')
    val mantInt = if (pointIdx < 0) mantissa else mantissa.substring(0, pointIdx)
    val mantFrac = if (pointIdx < 0) "" else mantissa.substring(pointIdx + 1)
    val combined = mantInt + mantFrac
    val pointPos = mantInt.length + exp
    return when {
        pointPos <= 0 -> "0." + "0".repeat(-pointPos) + combined
        pointPos >= combined.length -> combined + "0".repeat(pointPos - combined.length)
        else -> combined.substring(0, pointPos) + "." + combined.substring(pointPos)
    }
}
