import Foundation

/// Pure display-boundary formatters for the Trip Planner surface (web `toDistanceDisplay` +
/// `.toFixed(0)`, the custom `formatDuration` h/m helper, `formatEnergy(wh, { precision: 1 })`,
/// `formatCurrency`, and `fmtNumber(efficiency_factor, 2)`). SI values come from the model; conversion
/// to the user's unit preference happens here via the shared KMP `Units` facade (P1/S5) — never in the
/// model. Each numeric helper returns an em dash for non-finite input (never "nan").
public enum TripPlannerFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision preference
    /// (web `userPrecision`, default 2).
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

    // MARK: - Distance (web `toDistanceDisplay(total_distance_m).toFixed(0) + ' ' + distanceUnit`)

    /// Web Distance stat: SI meters → the user's distance unit, rounded to a whole number (`.toFixed(0)`,
    /// no grouping) with the unit label appended (`612 km`).
    public static func distance(_ meters: Double, _ prefs: UnitPreferences) -> String {
        let display = Units.convertDistance(meters, prefs)
        guard display.isFinite else { return emptyValue }
        return "\(String(format: "%.0f", display)) \(prefs.distance)"
    }

    // MARK: - Duration (web `formatDuration(minutes)` — the page's own h/m helper, NOT the SI facade)

    /// Web `formatDuration(seconds / 60)`: `Math.floor(minutes/60)` hours + `Math.round(minutes%60)`
    /// minutes, shown as `${m}m` when under an hour else `${h}h ${m}m`. Ported verbatim (SI seconds in).
    public static func duration(seconds: Double) -> String {
        guard seconds.isFinite else { return emptyValue }
        let minutes = seconds / 60
        let hours = Int((minutes / 60).rounded(.down))
        let mins = Int((minutes.truncatingRemainder(dividingBy: 60)).rounded())
        if hours == 0 { return "\(mins)m" }
        return "\(hours)h \(mins)m"
    }

    // MARK: - Energy (web `formatEnergy(total_energy_wh, { precision: 1 })`)

    /// Web Energy stat via the shared facade (SI Wh in → the user's energy unit + label) at the web's
    /// per-call precision of 1 fraction digit.
    public static func energy(_ wattHours: Double, _ prefs: UnitPreferences) -> String {
        var oneDecimal = prefs
        oneDecimal.precision = 1
        return Units.formatEnergy(wattHours, oneDecimal)
    }

    // MARK: - Cost (web `formatCurrency(estimated_cost)`)

    /// Web `formatCurrency(amount)` → `${currencySymbol}${fmtNumber(amount, userPrecision)}` (a symbol
    /// prefix + en-US grouped number), at the user's default precision.
    public static func currency(_ amount: Double, _ prefs: UnitPreferences, symbol: String) -> String {
        guard amount.isFinite else { return emptyValue }
        return "\(symbol)\(number(amount, decimals: defaultDecimals(prefs)))"
    }

    // MARK: - Weather factor (web `fmtNumber(weather.efficiency_factor, 2)`)

    /// Web `${fmtNumber(efficiency_factor, 2)}` — the multiplier shown in the weather-impact note,
    /// fixed at 2 fraction digits.
    public static func weatherFactor(_ factor: Double) -> String {
        number(factor, decimals: 2)
    }
}
