import Foundation

/// Pure display-boundary helpers for the Charging Patterns surface (web `fmtNumber` / `fmtInt`
/// plus the hard-coded `kWh` / `min` suffixes). The page stores SI watt-hours and seconds; the
/// view converts each to the page's fixed display units — kWh and minutes, exactly the units
/// the web forces here regardless of the user's preference (web `convertEnergyFromSI(_, 'kWh')`
/// and `durationMinutes`) — through the shared SI engine at the render boundary using the
/// `kwhPreferences` / `minutesPreferences` below. Number/integer formatting matches the web's
/// en-US grouped `Intl.NumberFormat`; every helper returns an em dash for non-finite input
/// (never "nan").
public enum ChargingHeatmapFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The total-energy unit suffix (web stat card `… kWh`).
    public static let energyUnit = "kWh"

    /// The average-duration unit suffix (web stat card `… min`).
    public static let durationUnit = "min"

    /// Forces the kWh energy display unit at the render boundary regardless of the user's
    /// preference, matching the web page's hard-coded `convertEnergyFromSI(_, 'kWh')`. Passed to
    /// the shared `Units.convertEnergy` so the watt-hour → kWh conversion runs through the same
    /// golden-tested engine every platform shares (ADR-005).
    public static let kwhPreferences: UnitPreferences = {
        var preferences = UnitPreferences.metric
        preferences.energy = "kWh"
        return preferences
    }()

    /// Forces the minute duration display unit at the render boundary, matching the web's
    /// `durationMinutes` (seconds → minutes). Passed to the shared `Units.convertDuration`.
    public static let minutesPreferences: UnitPreferences = {
        var preferences = UnitPreferences.metric
        preferences.duration = "min"
        return preferences
    }()

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits. A non-finite
    /// value renders an em dash.
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

    /// Web `fmtInt(value)` = `fmtNumber(value, 0)`: a grouped, rounded integer. A non-finite
    /// value renders an em dash.
    public static func int(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `favHour.toString().padStart(2, '0') + ':00'` — the favorite hour as `HH:00`.
    public static func hourLabel(_ hour: Int) -> String {
        String(format: "%02d:00", hour)
    }
}
