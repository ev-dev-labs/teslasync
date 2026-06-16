import Foundation

/// Pure display-boundary formatters for the Route Efficiency surface (web `fmtNumber` / `fmtInt` +
/// `convertDistanceFromSI` + the `efficiencyUnit` / `toEfficiencyDisplay` helpers + `efficiencyVariant`).
/// SI/analytics values come from the model; conversion to the user's unit preference happens here via
/// the shared KMP `Units` facade (P1/S5) — never in the model. Each numeric helper returns an em dash
/// for non-finite input (never "nan").
public enum RouteEfficiencyFormat {
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

    // MARK: - Distance (web `fmtNumber(toDistanceDisplay(m))` + `distanceUnit`)

    /// Web `distanceUnit = unitPrefs.distance` (`"km"` / `"mi"`).
    public static func distanceUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance
    }

    /// SI meters → the user's distance unit value (web `toDistanceDisplay = convertDistanceFromSI`).
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// Web `${fmtNumber(toDistanceDisplay(m))} ${distanceUnit}` (route-card "avg" distance).
    public static func distance(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(distanceValue(meters, prefs), decimals: defaultDecimals(prefs))) \(distanceUnit(prefs))"
    }

    // MARK: - Efficiency (web `efficiencyUnit` + `toEfficiencyDisplay`)

    /// Web `efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `toEfficiencyDisplay`: `Wh/km` stays as-is for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `${fmtInt(toEfficiencyDisplay(whPerKm))} ${efficiencyUnit}` (badge + stat values).
    public static func efficiencyInt(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(efficiencyValue(whPerKm, prefs))) \(efficiencyUnit(prefs))"
    }

    /// Web `Math.round(toEfficiencyDisplay(whPerKm))` — the rounded display number (chart values).
    public static func efficiencyRounded(_ whPerKm: Double, _ prefs: UnitPreferences) -> Int {
        let value = efficiencyValue(whPerKm, prefs)
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    // MARK: - Efficiency variant (web `efficiencyVariant`)

    /// Web `efficiencyVariant(eff)`: success < 140, info < 180, warning < 220, else danger — keyed on
    /// the raw `Wh/km` value (not the display value), exactly as the web does.
    public static func variant(_ whPerKm: Double) -> TSTone {
        switch whPerKm {
        case ..<140: .success
        case ..<180: .info
        case ..<220: .warning
        default: .danger
        }
    }

    // MARK: - Route label (web `${start.substring(0,10)}→${end.substring(0,10)}`)

    /// Web chart name: each endpoint truncated to its first ten characters, joined with an arrow.
    public static func chartLabel(start: String, end: String) -> String {
        "\(truncated(start))→\(truncated(end))"
    }

    private static func truncated(_ value: String) -> String {
        String(value.prefix(10))
    }
}
