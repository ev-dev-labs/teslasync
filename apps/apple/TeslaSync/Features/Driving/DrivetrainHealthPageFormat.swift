import Foundation

/// Pure display-boundary formatters for the Drivetrain Health surface (web `fmtNumber` / `fmtInt` +
/// `convertTempFromSI` / `convertDistanceFromSI` / `convertSpeedFromSI` + `formatTemperature` /
/// `formatEnergy`). SI values come from the model; conversion to the user's unit preference happens here
/// via the shared KMP `Units` facade (P1/S5) — never in the model. Each numeric helper returns an em
/// dash for nil/non-finite input (never "nan").
public enum DrivetrainHealthPageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision (web default 2).
    public static func defaultDecimals(_ prefs: UnitPreferences) -> Int {
        prefs.precision ?? 2
    }

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    // MARK: - Unit labels

    public static func temperatureUnit(_ prefs: UnitPreferences) -> String { prefs.temperature }
    public static func distanceUnit(_ prefs: UnitPreferences) -> String { prefs.distance }
    public static func speedUnit(_ prefs: UnitPreferences) -> String { prefs.speed }

    // MARK: - Temperature (web `toTemperatureDisplay` / `formatTemperature` / `displayTemp`)

    /// SI °C → the user's temperature-unit numeric (web `toTemperatureDisplay`) — gauges + chart axes.
    public static func temperatureValue(_ celsius: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertTemperature(celsius, prefs)
    }

    /// Web `${fmtNumber(toTemperatureDisplay(°C))} ${tempUnit}` (live motor metrics).
    public static func temperatureWithUnit(_ celsius: Double, _ prefs: UnitPreferences) -> String {
        "\(number(temperatureValue(celsius, prefs), decimals: defaultDecimals(prefs))) \(prefs.temperature)"
    }

    /// Web `fmtNumber(toTemperatureDisplay(°C), 0)${tempUnit}` (gauge "Max" caption — no space).
    public static func temperatureMax(_ celsius: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(temperatureValue(celsius, prefs)))\(prefs.temperature)"
    }

    /// Web `displayTemp(°C, formatTemperature)` — the formatted reading or `'—'` when missing.
    public static func temperature(_ celsius: Double?, _ prefs: UnitPreferences) -> String {
        guard let celsius else { return emptyValue }
        return Units.formatTemperature(celsius, prefs)
    }

    // MARK: - Distance / speed (web `toDistanceDisplay` / `toSpeedDisplay`)

    /// SI meters → `${fmtInt(toDistanceDisplay(m))} ${distanceUnit}` (drive-statistics total).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(Units.convertDistance(meters, prefs))) \(prefs.distance)"
    }

    /// SI m/s → `${fmtNumber(toSpeedDisplay(mps), 1)} ${speedUnit}` (avg / top speed).
    public static func speed(_ metersPerSecond: Double, _ prefs: UnitPreferences) -> String {
        "\(number(Units.convertSpeed(metersPerSecond, prefs), decimals: 1)) \(prefs.speed)"
    }

    // MARK: - Power / torque / rpm (web kW / Nm / RPM — no unit preference)

    /// Web `${fmtInt(peakPower)} kW` or `'—'` when not positive.
    public static func powerInt(_ kilowatts: Double) -> String {
        kilowatts > 0 ? "\(integer(kilowatts)) kW" : emptyValue
    }

    /// Web `${fmtNumber(avgPowerMax, 1)} kW` or `'—'` when not positive.
    public static func powerDecimal(_ kilowatts: Double) -> String {
        kilowatts > 0 ? "\(number(kilowatts, decimals: 1)) kW" : emptyValue
    }

    /// Web live `${fmtNumber(power_kw)} kW` (global precision).
    public static func powerLive(_ kilowatts: Double?, _ prefs: UnitPreferences) -> String {
        guard let kilowatts else { return emptyValue }
        return "\(number(kilowatts, decimals: defaultDecimals(prefs))) kW"
    }

    /// Web `${fmtNumber(torque_nm)} Nm`.
    public static func torque(_ newtonMeters: Double?, _ prefs: UnitPreferences) -> String {
        guard let newtonMeters else { return emptyValue }
        return "\(number(newtonMeters, decimals: defaultDecimals(prefs))) Nm"
    }

    /// Web `${fmtInt(motor_rpm)} RPM`.
    public static func rpm(_ value: Double?) -> String {
        guard let value else { return emptyValue }
        return "\(integer(value)) RPM"
    }

    /// Web HV isolation `${fmtNumber(isolationResistance)} kΩ` (positive only).
    public static func isolation(_ kiloOhms: Double?, _ prefs: UnitPreferences) -> String {
        guard let kiloOhms, kiloOhms > 0 else { return emptyValue }
        return "\(number(kiloOhms, decimals: defaultDecimals(prefs))) kΩ"
    }

    // MARK: - Ratios / energy / CO₂

    /// Web `${fmtNumber(value * 100, 1)}%` (regen ratio).
    public static func percent(_ fraction: Double, decimals: Int = 1) -> String {
        "\(number(fraction * 100, decimals: decimals))%"
    }

    /// Web `${fmtNumber((value / max) * 100, 0)}% ${'of max'}` numeric (sensor card subtitle).
    public static func percentOfMax(_ value: Double, _ maxValue: Double) -> String {
        guard maxValue > 0 else { return emptyValue }
        return "\(integer((value / maxValue) * 100))%"
    }

    /// Web `formatEnergy(wh)` via the shared facade (SI Wh in → the user's energy unit + label).
    public static func energy(_ wattHours: Double, _ prefs: UnitPreferences) -> String {
        Units.formatEnergy(wattHours, prefs)
    }

    /// Web CO₂ label `${fmtNumber(co2SavedKg, 1)} kg`.
    public static func co2(_ kilograms: Double) -> String {
        "\(number(kilograms, decimals: 1)) kg"
    }

    // MARK: - Dates (web `formatDateShort` / `formatTime`)

    /// Web `formatDateShort(iso)`: localized `MMM d` (e.g. "Jan 5").
    public static func dateShort(_ date: Date) -> String {
        dateShortFormatter.string(from: date)
    }

    /// Web `formatTime(iso)`: localized short time (e.g. "3:45 PM").
    public static func timeShort(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }

    private static let dateShortFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}
