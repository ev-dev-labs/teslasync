import Foundation

/// Pure display-boundary formatters for the Battery Cells surface (web `fmtNumber`
/// + the inline voltage / millivolt / temperature-spread formatting). Voltages and
/// millivolts are unit-preference-independent, so they format here directly; the
/// absolute temperatures convert through the shared SI `Units` facade at the view
/// boundary, and only the temperature *spread* (a delta, which the shared absolute
/// converter would offset incorrectly) is scaled here. Every helper returns an em
/// dash for non-finite input (never "nan").
public enum BatteryCellsFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

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

    /// Web `${fmtNumber(value, 0)}` — integer grouping.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `${fmtNumber(voltage, decimals)} V` — a volts value with its unit.
    public static func voltage(_ value: Double, decimals: Int) -> String {
        "\(number(value, decimals: decimals)) V"
    }

    /// Web `${fmtNumber(mv, 1)} mV` — a millivolt value with its unit.
    public static func millivolts(_ value: Double, decimals: Int = 1) -> String {
        "\(number(value, decimals: decimals)) mV"
    }

    /// Web `${mv >= 0 ? '+' : ''}${fmtNumber(mv, 1)}` — the signed delta in millivolts
    /// (no unit; used inside the table's Delta column).
    public static func signedMillivolts(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        let sign = value >= 0 ? "+" : ""
        return "\(sign)\(number(value, decimals: decimals))"
    }

    /// Web `${fmtNumber(tempUnit === '°F' ? spread * 1.8 : spread, 1)}${tempUnit}` —
    /// a temperature *spread* (delta). A Celsius delta scales by 9/5 for Fahrenheit
    /// with no 32° offset, then carries the unit label.
    public static func temperatureSpread(_ celsiusDelta: Double, fahrenheit: Bool, unitLabel: String) -> String {
        let value = fahrenheit ? celsiusDelta * 1.8 : celsiusDelta
        return "\(number(value, decimals: 1))\(unitLabel)"
    }

    /// Web `formatDateTime(timestamp).split(',')[0]` — the date portion used for the
    /// time-series axis labels (medium date, no time component).
    public static func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
