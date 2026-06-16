import Foundation

/// Pure display-boundary formatters for the Energy Products surface — the SwiftUI port of the
/// page's local `fmtEnergy` / `fmtPower` helpers, the `fmtNumber` grouping, and the
/// `formatDateTime` from `@/lib/dateFormat`. These mirror the web page exactly: it shows pack /
/// nameplate energy in kWh and nameplate power in kW (auto-scaling from the SI watt-hour / watt
/// inputs), independent of the user's unit preference. The model stays SI; this only converts at
/// the render boundary. Every helper returns an em dash for missing / non-finite input.
public enum EnergyProductsFormat {
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

    /// Web `fmtEnergy(wh)`: `≥ 1000` ⇒ `{wh/1000, 1dp} kWh`, else `{wh, 0dp} Wh`; em dash for nil.
    public static func energy(_ wh: Double?) -> String {
        guard let wh, wh.isFinite else { return emptyValue }
        if wh >= 1000 { return "\(number(wh / 1000, decimals: 1)) kWh" }
        return "\(number(wh, decimals: 0)) Wh"
    }

    /// Web `fmtPower(w)`: `≥ 1000` ⇒ `{w/1000, 1dp} kW`, else `{w, 0dp} W`; em dash for nil.
    public static func power(_ watts: Double?) -> String {
        guard let watts, watts.isFinite else { return emptyValue }
        if watts >= 1000 { return "\(number(watts / 1000, decimals: 1)) kW" }
        return "\(number(watts, decimals: 0)) W"
    }

    /// Web `${fmtNumber(value, 1)}%`, em dash when the value is missing (web `'—'`).
    public static func percent(_ value: Double?, decimals: Int = 1) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return "\(number(value, decimals: decimals))%"
    }

    /// Web integer count rendered verbatim (battery count); em dash for nil.
    public static func count(_ value: Int?) -> String {
        guard let value else { return emptyValue }
        return number(Double(value), decimals: 0)
    }

    /// Web `formatDateTime(raw)` — a medium date + short time label for the "fetched" stamps.
    /// Parses an ISO-8601 wire timestamp (with or without fractional seconds); non-date strings
    /// pass through unchanged, a nil/empty input yields the em dash.
    public static func dateTime(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return emptyValue }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let isoFractional = ISO8601DateFormatter()
        isoFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: raw) ?? isoFractional.date(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Humanizes a raw `site_info.components` key for a badge label (web `key.replace(/_/g, ' ')`).
    /// The result is data, shown verbatim (the web does not translate these keys).
    public static func humanizeComponent(_ key: String) -> String {
        key.replacingOccurrences(of: "_", with: " ")
    }
}
