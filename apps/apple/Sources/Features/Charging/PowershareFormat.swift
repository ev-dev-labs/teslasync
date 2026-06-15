import Foundation

/// Pure display-boundary formatters for the Powershare surface (web `fmtNumber` + the
/// inline `value ?? '—'` fallbacks). Power and remaining-runtime arrive in their display
/// units (kW, hours) from the signal itself, so they format here with the same fixed
/// precision the web uses — `fmtNumber(powerKw, 2)` and `fmtNumber(hoursLeft, 1)` — with
/// en-US grouping. Text values (status, type, stop reason) render verbatim, falling back
/// to an em dash. Every helper returns an em dash for `nil` / non-finite input
/// (never "nan"), matching the web `'—'` sentinel.
public enum PowershareFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The instantaneous-power unit suffix (web StatCard `unit="kW"`).
    public static let powerUnit = "kW"

    /// The remaining-runtime unit suffix (web StatCard `unit="h"`).
    public static let hoursUnit = "h"

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

    /// Web `powerKw != null ? fmtNumber(powerKw, 2) : '—'` — instantaneous power at two
    /// fraction digits. `nil` / non-finite renders an em dash.
    public static func power(_ value: Double?) -> String {
        guard let value else { return emptyValue }
        return number(value, decimals: 2)
    }

    /// Web `hoursLeft != null ? fmtNumber(hoursLeft, 1) : '—'` — remaining runtime at one
    /// fraction digit. `nil` / non-finite renders an em dash.
    public static func hours(_ value: Double?) -> String {
        guard let value else { return emptyValue }
        return number(value, decimals: 1)
    }

    /// Web `shareType ?? '—'` — a verbatim text value with the em-dash fallback.
    public static func text(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return emptyValue }
        return value
    }
}
