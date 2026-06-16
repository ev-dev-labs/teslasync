import Foundation

/// Pure display-boundary formatters for the Energy surface — the SwiftUI port of the web
/// `fmtNumber` / `fmtInt` / `fmtPercent` helpers, the `formatCurrency` from `useFormatting`,
/// and the efficiency-unit logic. Numbers that are unit-preference-independent (percentages,
/// counts, currency) format here directly; absolute distance / energy / power convert through
/// the shared SI `Units` facade at the view boundary. Every helper returns an em dash for
/// non-finite input (never "nan").
public enum EnergyFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision (web
    /// `_globalPrecision`, default 2).
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

    /// Web `fmtPercent(value, decimals)` → `${fmtNumber(value, decimals)}%`.
    public static func percent(_ value: Double, decimals: Int) -> String {
        "\(number(value, decimals: decimals))%"
    }

    /// Web `formatCurrency(amount)` (default USD). Matches the shared `TSCurrency` rendering
    /// so the table cells and inline currencies agree.
    public static func currency(_ amount: Double?, code: String = "USD", fractionDigits: Int? = nil) -> String {
        guard let amount, amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        if let fractionDigits {
            formatter.minimumFractionDigits = fractionDigits
            formatter.maximumFractionDigits = fractionDigits
        }
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }

    /// Web `efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `toEfficiencyDisplay(whPerM)` — SI watt-hours-per-metre to Wh per displayed
    /// distance unit (`* 1609.344` for miles, `* 1000` for kilometres).
    public static func efficiencyDisplay(_ whPerM: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerM * 1609.344 : whPerM * 1000
    }

    /// Web `formatDateShort(raw)` — a short date label for the sessions table. Parses an
    /// ISO-8601 wire date; non-date strings pass through unchanged.
    public static func dateShort(_ raw: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let isoFractional = ISO8601DateFormatter()
        isoFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: raw) ?? isoFractional.date(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
