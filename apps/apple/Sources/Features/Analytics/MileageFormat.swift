import Foundation

/// Pure display-boundary formatters for the Mileage surface (web `fmtNumber` / `fmtInt` +
/// `useUnits`/`fromKm`). SI meters come from the model; conversion to the user's distance unit
/// happens here via the shared KMP `Units` facade (P1/S5) — never in the model. Each returns an em
/// dash for non-finite input (never "nan").
public enum MileageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision preference
    /// (web `_globalPrecision`, default 2).
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

    // MARK: - Distance (web `fromKm(meters)` → converted display value)

    /// SI meters → the user's distance unit as a raw `Double` (web `fromKm(m)`), for chart Y values.
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// SI meters → the user's distance unit, integer digits, with the unit label (web
    /// `${fmtInt(fromKm(m))} ${distanceUnit}` — Total-Distance, Annual-Projection cards).
    public static func distanceIntLabel(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(distanceValue(meters, prefs), decimals: 0)) \(prefs.distance)"
    }

    /// SI meters → the user's distance unit, default precision, with the unit label (web
    /// `${fmtNumber(fromKm(m))} ${distanceUnit}` — Daily-Avg card).
    public static func distanceLabel(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(distanceValue(meters, prefs), decimals: defaultDecimals(prefs))) \(prefs.distance)"
    }

    /// SI meters → the user's distance unit, default precision, WITHOUT the unit label (web
    /// `fmtNumber(r.distance)` — the monthly table's Distance + Distance-per-Drive cells, whose unit
    /// lives in the column header instead).
    public static func distanceNumber(_ meters: Double, _ prefs: UnitPreferences) -> String {
        number(distanceValue(meters, prefs), decimals: defaultDecimals(prefs))
    }

    // MARK: - Dates (web `formatDate(d.date)` → "Apr 4, 2026")

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()

    /// Web `formatDate(d.date)` — "MMM d, yyyy" calendar date used for the chart X-axis labels.
    public static func dayLabel(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }
}
