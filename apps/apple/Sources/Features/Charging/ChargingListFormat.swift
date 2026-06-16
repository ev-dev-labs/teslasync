import Foundation

/// Pure display-boundary formatters for the Charging Sessions list (web `fmtNumber` /
/// `fmtInt` / `fmtCompact` / `formatCurrency` / `formatDurationMinutes` / `formatDayKey` /
/// `formatHour`). Energy / power arrive SI (Wh / W); the kWh / kW conversions and all
/// number/locale formatting happen only here, never in the model (ADR-005). Every helper
/// returns an em dash for nil / non-finite input (never "nan").
public enum ChargingListFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    private static let enUS = Locale(identifier: "en_US")

    private static func decimalFormatter(_ digits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = enUS
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        return formatter
    }

    /// Web `fmtNumber(value, decimals)` — en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        return decimalFormatter(decimals).string(from: NSNumber(value: value))
            ?? String(format: "%.\(decimals)f", value)
    }

    /// Ungrouped, dot-decimal number for case-insensitive search haystacks (web
    /// `fmtNumber` inside `matchesTokens` text extraction).
    public static func plainNumber(_ value: Double) -> String {
        guard value.isFinite else { return "" }
        return String(format: "%.1f", value)
    }

    /// Web `fmtInt(value)` — grouped integer.
    public static func int(_ value: Double) -> String {
        number(value.rounded(), decimals: 0)
    }

    /// Web `fmtCompact(value)` — abbreviated for large magnitudes (k / M), full otherwise.
    public static func compact(_ value: Double) -> String {
        guard value.isFinite else { return emptyValue }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return number(value / 1_000_000, decimals: 1) + "M"
        case 10_000...:
            return number(value / 1000, decimals: 1) + "k"
        default:
            return int(value)
        }
    }

    /// Web `formatCurrency(value)` — currency symbol prefix + two fraction digits.
    public static func currency(_ value: Double, symbol: String, decimals: Int = 2) -> String {
        guard value.isFinite else { return emptyValue }
        return symbol + number(value, decimals: decimals)
    }

    /// Web overview `Energy (kWh)` card — SI Wh → kWh compact.
    public static func energyKwh(_ wattHours: Double) -> String {
        compact(wattHours / 1000)
    }

    /// Web `fmtNumber(kw)` — SI W → kW at one fraction digit; em dash for nil.
    public static func powerKw(_ watts: Double?) -> String {
        guard let watts, watts.isFinite else { return emptyValue }
        return number(watts / 1000, decimals: 1)
    }

    /// Web `avgRateKw != null ? fmtNumber(avgRateKw) : '—'` — already-kW value at one digit.
    public static func rateKw(_ kilowatts: Double?) -> String {
        guard let kilowatts, kilowatts.isFinite else { return emptyValue }
        return number(kilowatts, decimals: 1)
    }

    /// Web `formatDurationMinutes(min)` — "Xh Ym" / "Xh" / "Xm"; em dash for nil.
    public static func duration(minutes: Double?) -> String {
        guard let minutes, minutes.isFinite, minutes > 0 else { return emptyValue }
        if minutes < 60 { return "\(Int(minutes.rounded()))m" }
        let hours = Int(minutes / 60)
        let mins = Int((minutes - Double(hours) * 60).rounded())
        return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h"
    }

    // MARK: - Day labels (web `formatDayKey` / `formatRelativeDays`)

    private static func dayLabelFormatter(_ template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = enUS
        formatter.timeZone = ChargingAggregation.dayCalendar.timeZone
        formatter.dateFormat = template
        return formatter
    }

    /// Web `formatDayKey(key, { style: 'short' })` — e.g. "Apr 15".
    public static func dayShort(_ key: String) -> String {
        guard let date = ChargingAggregation.parseDay(key) else { return key }
        return dayLabelFormatter("MMM d").string(from: date)
    }

    /// Web `formatDayKey(key, { style: 'long' })` — e.g. "April 15, 2026".
    public static func dayLong(_ key: String) -> String {
        guard let date = ChargingAggregation.parseDay(key) else { return key }
        return dayLabelFormatter("MMMM d, yyyy").string(from: date)
    }

    /// Web `formatRelativeDays` — "Today" / "Yesterday" / "N days ago" relative to now.
    public static func relativeDays(_ key: String, now: Date = Date()) -> String {
        guard let date = ChargingAggregation.parseDay(key) else { return "" }
        let calendar = ChargingAggregation.dayCalendar
        let startOfDay = calendar.startOfDay(for: date)
        let startOfNow = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: startOfDay, to: startOfNow).day ?? 0
        switch days {
        case ..<0: return ""
        case 0: return String(localized: "charging.relative.today")
        case 1: return String(localized: "charging.relative.yesterday")
        default: return String(format: String(localized: "charging.relative.daysAgo"), days)
        }
    }

    /// Web `formatHour(h)` — "12 AM" / "9 AM" / "12 PM" / "7 PM".
    public static func hour(_ hour: Int) -> String {
        if hour == 0 { return "12 AM" }
        if hour == 12 { return "12 PM" }
        if hour < 12 { return "\(hour) AM" }
        return "\(hour - 12) PM"
    }
}
