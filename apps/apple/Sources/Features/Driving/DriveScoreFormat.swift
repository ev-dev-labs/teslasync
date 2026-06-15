import Foundation

/// Pure display-boundary formatters for the Drive Score surface (web `fmtNumber` / `fmtInt` /
/// `fmtWithUnit` + `convertDistanceFromSI` / `convertSpeedFromSI` + `formatDateShort` /
/// `formatDurationMinutes`). SI values come from the model; conversion to the user's unit preference
/// happens here via the shared KMP `Units` facade (P1/S5) — never in the model. Each numeric helper
/// returns an em dash for nil/non-finite input (never "nan").
public enum DriveScoreFormat {
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

    // MARK: - Distance (web `fmtWithUnit(toDistanceDisplay(m), distanceUnit)`)

    /// SI meters → the user's distance unit + label (web `fmtWithUnit(toDistanceDisplay(m), unit)`).
    public static func distance(_ meters: Double, _ prefs: UnitPreferences) -> String {
        let value = Units.convertDistance(meters, prefs)
        return "\(number(value, decimals: defaultDecimals(prefs))) \(prefs.distance)"
    }

    // MARK: - Speed (web `fmtWithUnit(toSpeedDisplay(mps), speedUnit)`)

    /// SI m/s → the user's speed unit + label (web `fmtWithUnit(toSpeedDisplay(mps), speedUnit)`).
    public static func speed(_ metersPerSecond: Double, _ prefs: UnitPreferences) -> String {
        let value = Units.convertSpeed(metersPerSecond, prefs)
        return "\(number(value, decimals: defaultDecimals(prefs))) \(prefs.speed)"
    }

    // MARK: - Efficiency (web `whPerKmToDisplay` + efficiencyUnit)

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `toEfficiencyDisplay`: Wh/km stays as-is for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `fmtWithUnit(toEfficiencyDisplay(whPerKm), efficiencyUnit)` at default precision.
    public static func efficiency(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(number(efficiencyValue(whPerKm, prefs), decimals: defaultDecimals(prefs))) \(efficiencyUnit(prefs))"
    }

    /// Web `${fmtInt(toEfficiencyDisplay(whPerKm))} ${efficiencyUnit}` (best/worst consumption rows).
    public static func efficiencyInt(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(efficiencyValue(whPerKm, prefs))) \(efficiencyUnit(prefs))"
    }

    // MARK: - Power (web `fmtWithUnit(avgPowerKw, 'kW')`)

    /// Kilowatts → `${fmtNumber(kw)} kW` (web smoothness power-range row; the value is already kW).
    public static func powerKw(_ kilowatts: Double, _ prefs: UnitPreferences) -> String {
        "\(number(kilowatts, decimals: defaultDecimals(prefs))) kW"
    }

    // MARK: - Duration (web `formatDurationMinutes`)

    /// Web `formatDurationMinutes(minutes)`: `${h}h ${m}m` when ≥ 1 hour else `${m}m`; em dash for
    /// negative / non-finite input.
    public static func durationMinutes(_ minutes: Double) -> String {
        guard minutes.isFinite, minutes >= 0 else { return emptyValue }
        let hours = Int(minutes / 60)
        let mins = Int((minutes.truncatingRemainder(dividingBy: 60)).rounded())
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Web `formatDurationMinutes(durationS / 60)` for a drive's SI seconds.
    public static func durationSeconds(_ seconds: Double) -> String {
        durationMinutes(seconds / 60)
    }

    // MARK: - Dates (web `formatDateShort`)

    /// Web `formatDateShort(iso)`: localized `MMM d` (e.g. "Jan 5").
    public static func dateShort(_ date: Date) -> String {
        dateShortFormatter.string(from: date)
    }

    private static let dateShortFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter
    }()
}
