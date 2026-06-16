import Foundation

/// Pure display-boundary formatters for the Projected-Range surface — the SwiftUI port of the
/// web `fmtNumber` helper plus the page's verbatim "Wh/km" energy-intensity rendering. Numbers
/// that are unit-preference-independent (percentages, counts, the Wh/km intensity the matrix
/// title pins) format here; absolute distance / energy / speed / temperature convert through the
/// shared SI `Units` facade at the view boundary. Every helper returns an em dash for non-finite
/// input (never "nan").
public enum ProjectedRangePageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double?, decimals: Int) -> String {
        guard let value, value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `${fmtNumber(value, decimals)}%`.
    public static func percent(_ value: Double?, decimals: Int) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return "\(number(value, decimals: decimals))%"
    }

    /// The Battery card value (web `${fmtNumber(pct, 0)}%`).
    public static func batteryPercent(_ value: Double?) -> String {
        percent(value, decimals: 0)
    }

    /// The Health-Factor card value (web `${fmtNumber(health_factor * 100, 1)}%`).
    public static func healthFactorPercent(_ factor: Double?) -> String {
        percent((factor ?? 1) * 100, decimals: 1)
    }

    /// The signed factor-impact badge text (web `${impact >= 0 ? '+' : ''}${fmtNumber(impact, 1)}%`).
    public static func signedImpact(_ impactPct: Double) -> String {
        let sign = impactPct >= 0 ? "+" : ""
        return "\(sign)\(number(impactPct, decimals: 1))%"
    }

    /// The verbatim "Wh/km" energy-intensity (web `${fmtNumber(wh_km)} Wh/km`), derived from the
    /// SI Wh·m⁻¹. Pinned to Wh/km on this surface to match the matrix panel title.
    public static func efficiencyWhPerKm(_ whPerM: Double, decimals: Int = 0) -> String {
        "\(number(whPerM * 1000, decimals: decimals)) Wh/km"
    }

    /// The integer Wh/km a matrix cell shows (web `fmtNumber(bucket.wh_km, 0)`).
    public static func matrixCellWhPerKm(_ whPerM: Double) -> String {
        number(whPerM * 1000, decimals: 0)
    }
}
