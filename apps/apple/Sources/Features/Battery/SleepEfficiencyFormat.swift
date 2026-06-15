import Foundation

/// Pure display-boundary formatters for the Sleep Efficiency surface (web `fmtNumber` /
/// `fmtInt`, the inline `${value}%` / `${value}%/hr` / `${value} kWh` / `${value}h`
/// formatting, the `formatCurrency` helper, and the `convertTempFromSI` temperature
/// conversion). Percentages, rates, energy, and counts are unit-preference-independent
/// so they format here directly; the absolute temperature converts through the shared SI
/// `Units` facade (ADR-005); currency mirrors the web `useFormatting().formatCurrency`
/// exactly (`currencySymbol + fmtNumber(amount, decimals)`, NOT locale-currency). Every
/// helper returns an em dash for non-finite input (never "nan").
public enum SleepEfficiencyFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision
    /// preference (web `userPrecision`, default 2).
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

    /// Web `${fmtNumber(value)}%` — a percentage at the user's default precision.
    public static func percent(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs)))%"
    }

    /// Web `${fmtNumber(value)}%/hr` — a per-hour percentage drain rate.
    public static func percentPerHour(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs)))%/hr"
    }

    /// Web `${fmtInt(time_to_sleep_avg_min)} min` — an integer-minute value with the unit.
    public static func minutes(_ value: Double) -> String {
        "\(integer(value)) min"
    }

    /// Web `${fmtNumber(sentry_extra_monthly_kwh)} kWh` — a kWh value at default precision.
    public static func kilowattHours(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs))) kWh"
    }

    /// Web `${fmtNumber(event.duration_hours)}h` — an hours value with the `h` suffix.
    public static func durationHours(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs)))h"
    }

    /// Web `formatCurrency(amount)` → `${currencySymbol}${fmtNumber(amount, decimals)}`
    /// (a symbol prefix + en-US grouped number), at the user's default precision.
    public static func currency(_ amount: Double, _ prefs: UnitPreferences, symbol: String) -> String {
        guard amount.isFinite else { return emptyValue }
        return "\(symbol)\(number(amount, decimals: defaultDecimals(prefs)))"
    }

    /// Web `${fmtNumber(convertTempFromSI(celsius, tempUnit))}${tempUnit}` — SI Celsius
    /// converted to the user's temperature unit (via the shared facade) with the unit
    /// label appended, at default precision. `nil` renders an em dash (web `'—'`).
    public static func temperature(_ celsius: Double?, _ prefs: UnitPreferences) -> String {
        guard let celsius, celsius.isFinite else { return emptyValue }
        let display = Units.convertTemperature(celsius, prefs)
        return "\(number(display, decimals: defaultDecimals(prefs)))\(prefs.temperature)"
    }

    /// Web `formatDateShort(raw)` — a medium calendar date for the drain-events table.
    /// Parses an ISO-8601 or `yyyy-MM-dd` wire timestamp; unparseable strings pass
    /// through unchanged (never "nan"/blank).
    public static func dateShort(_ raw: String) -> String {
        guard let date = parse(raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// Web `formatTime(raw)` — the short clock time shown beside the date.
    public static func time(_ raw: String) -> String {
        guard let date = parse(raw) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func parse(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = day.date(from: raw) { return date }
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: raw)
    }
}
