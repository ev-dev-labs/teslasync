import Foundation

/// Pure display-boundary formatters for the Battery Degradation surface (web
/// `fmtNumber` / `fmtInt` + the inline `${value}%` / `${value} kWh` formatting and
/// the `ageLabel` helper). Percentages, scores, and cycle counts are
/// unit-preference-independent, so they format here directly; the absolute
/// distances convert through the shared SI `Units` facade at the view boundary.
/// Every helper returns an em dash for non-finite input (never "nan").
public enum BatteryDegradationFormat {
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

    /// Web `${fmtNumber(value)} kWh` — a kWh value at the user's default precision.
    public static func kilowattHours(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs))) kWh"
    }

    /// Web `${fmtNumber(degradation_rate_yr)}%/yr` — an annual percentage rate.
    public static func percentPerYear(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: defaultDecimals(prefs)))%/yr"
    }

    /// Web `${fmtNumber(fromKm(km))} ${distanceUnit}` — SI kilometres converted to the
    /// user's distance unit (via metres) with the unit label, at default precision.
    public static func distanceFromKm(_ kilometres: Double, _ prefs: UnitPreferences) -> String {
        let display = Units.convertDistance(kilometres * 1000, prefs)
        return "\(number(display, decimals: defaultDecimals(prefs))) \(prefs.distance)"
    }

    /// Web `ageLabel(months)`: `< 12` → "{{count}} months"; whole years → "{{y}} years";
    /// otherwise "{{y}}y {{m}}m". Keys are ported verbatim from the web i18n catalog and
    /// resolved here, substituting the i18next `{{…}}` tokens at runtime.
    public static func ageLabel(months: Int) -> String {
        if months < 12 {
            let template = String(localized: "{{count}} months", defaultValue: "{{count}} months")
            return template.replacingOccurrences(of: "{{count}}", with: "\(months)")
        }
        let years = months / 12
        let remainder = months % 12
        if remainder > 0 {
            let template = String(localized: "{{y}}y {{m}}m", defaultValue: "{{y}}y {{m}}m")
            return template
                .replacingOccurrences(of: "{{y}}", with: "\(years)")
                .replacingOccurrences(of: "{{m}}", with: "\(remainder)")
        }
        let template = String(localized: "{{y}} years", defaultValue: "{{y}} years")
        return template.replacingOccurrences(of: "{{y}}", with: "\(years)")
    }

    /// Web `formatDate(raw)` — a medium date label for the chart/table axes. Parses an
    /// ISO-8601 or `yyyy-MM-dd` wire date; non-date strings (already-formatted backend
    /// projection labels) pass through unchanged.
    public static func dateLabel(_ raw: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.dateFormat = "yyyy-MM-dd"
        guard let date = iso.date(from: raw) ?? day.date(from: raw) else { return raw }
        let medium = DateFormatter()
        medium.locale = Locale(identifier: "en_US")
        medium.dateStyle = .medium
        medium.timeStyle = .none
        return medium.string(from: date)
    }
}
