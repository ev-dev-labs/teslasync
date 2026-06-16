import Foundation

/// Pure display-boundary formatters for the Charging detail surface (web `fmtNumber`,
/// `fmtPercent`, and the inline `value ?? '—'` fallbacks). Unit-bearing values (energy,
/// power, distance, temperature) are formatted by the SI-aware `Units` facade / `TS*`
/// formatter components in the view; this enum only covers the unit-free numbers the web
/// renders with fixed precision plus the em-dash sentinel, so it stays SwiftUI-free and
/// fully unit-tested. Every helper returns an em dash for `nil` / non-finite input (never
/// "nan"), matching the web `'—'` sentinel.
public enum ChargingDetailFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `value != null ? fmtNumber(value, decimals) : '—'`.
    public static func numberOrDash(_ value: Double?, decimals: Int = 1) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return number(value, decimals: decimals)
    }

    /// Web `fmtPercent(value)`: a rounded integer percent, or the em dash when absent.
    public static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return "\(number(value, decimals: 0))%"
    }

    /// Web `${fmtNumber(start ?? 0, 0)}–${fmtNumber(end ?? 0, 0)}` — the SoC-range label.
    public static func socRange(start: Double?, end: Double?) -> String {
        "\(number(start ?? 0, decimals: 0))–\(number(end ?? 0, decimals: 0))"
    }

    /// Web `(end ?? 0) - (start ?? 0)` rendered as a whole-number percentage (SoC gained).
    public static func socGained(start: Double?, end: Double?) -> String {
        "\(number((end ?? 0) - (start ?? 0), decimals: 0))%"
    }

    /// The display-time fallback charge price (web `useFormatting().costPerKwh` default)
    /// used to estimate a session's cost / per-kWh rate when the session has no recorded
    /// `cost_decimal`. Surfaced with the `fromSettings` / `atRate` sublabels, exactly as the
    /// web cost cards annotate an estimated value.
    public static let defaultCostPerKwh = 0.13

    /// The display-time fallback currency symbol paired with `defaultCostPerKwh`.
    public static let defaultCurrencySymbol = "$"
}
