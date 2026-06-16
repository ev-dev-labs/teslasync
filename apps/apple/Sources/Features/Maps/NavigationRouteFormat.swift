import Foundation

/// Pure display-boundary formatters for the Navigation & Route surface (web `fmtNumber` +
/// `convertDistanceFromSI` / `convertSpeedFromSI` + `formatDuration` + `headingToCardinal` +
/// `formatDateTime`). SI values come from the model; conversion to the user's unit preference happens
/// here via the shared KMP `Units` facade (P1/S5) — never in the model. Each numeric helper returns an
/// em dash for non-finite input (never "nan").
public enum NavigationRouteFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    // MARK: - Numbers (web `fmtNumber(value, decimals)`)

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

    // MARK: - Distance (web `convertDistanceFromSI` + `distanceUnit`)

    /// Web `distanceUnit = unitPrefs.distance` (`"km"` / `"mi"`).
    public static func distanceUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance
    }

    /// SI meters → the user's distance unit value (web `convertDistanceFromSI`).
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// Web `${fmtNumber(convertDistanceFromSI(m), 1)} ${distanceUnit}`.
    public static func distance(_ meters: Double, _ prefs: UnitPreferences, decimals: Int = 1) -> String {
        "\(number(distanceValue(meters, prefs), decimals: decimals)) \(distanceUnit(prefs))"
    }

    // MARK: - Speed (web `convertSpeedFromSI` + `speedUnit`)

    /// Web `speedUnit = unitPrefs.speed` (`"km/h"` / `"mph"`).
    public static func speedUnit(_ prefs: UnitPreferences) -> String {
        prefs.speed
    }

    /// SI m/s → the user's speed unit value (web `convertSpeedFromSI`).
    public static func speedValue(_ mps: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertSpeed(mps, prefs)
    }

    /// Web `${fmtNumber(convertSpeedFromSI(mps), 1)} ${speedUnit}`.
    public static func speed(_ mps: Double, _ prefs: UnitPreferences, decimals: Int = 1) -> String {
        "\(number(speedValue(mps, prefs), decimals: decimals)) \(speedUnit(prefs))"
    }

    // MARK: - Duration (web `useUnits().formatDuration(seconds)`)

    /// Web `formatDuration(seconds)` — the shared SI duration formatter.
    public static func duration(_ seconds: Double, _ prefs: UnitPreferences) -> String {
        Units.formatDuration(seconds, prefs)
    }

    // MARK: - ETA minutes (web `${fmtNumber(minutes, 0)} min`)

    /// Web ETA `${fmtNumber(minutes, 0)}` — the integer minute count (the unit word is appended via the
    /// `nav.minutes` string at the call site).
    public static func minutes(_ minutes: Double) -> String {
        number(minutes, decimals: 0)
    }

    // MARK: - Heading (web `headingToCardinal`)

    private static let cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

    /// Web `headingToCardinal(deg)` — the 8-point compass label, em dash when nil.
    public static func headingCardinal(_ degrees: Double?) -> String {
        guard let degrees else { return emptyValue }
        let index = Int((degrees / 45).rounded()) % cardinals.count
        let safeIndex = (index % cardinals.count + cardinals.count) % cardinals.count
        return cardinals[safeIndex]
    }

    /// Web heading status value `{{cardinal}} ({{degrees}}°)` via the `nav.headingValue` catalog format.
    public static func heading(_ degrees: Double?) -> String {
        guard let degrees, degrees.isFinite else { return emptyValue }
        let cardinal = headingCardinal(degrees)
        let rounded = Int64(degrees.rounded())
        return String(format: String(localized: "nav.headingValue"), cardinal, rounded)
    }

    // MARK: - Coordinates (web `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`)

    /// Web current-location value `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`.
    public static func coordinate(latitude: Double?, longitude: Double?) -> String? {
        guard let latitude, let longitude, latitude != 0 || longitude != 0 else { return nil }
        return "\(number(latitude, decimals: 4)), \(number(longitude, decimals: 4))"
    }

    /// Web history-table lat/lon cell `${fmtNumber(v, 6)}` (em dash for nil/zero).
    public static func coordinateComponent(_ value: Double?) -> String {
        guard let value, value != 0 else { return emptyValue }
        return number(value, decimals: 6)
    }

    // MARK: - Dates (web `formatDateTime`)

    /// Web `formatDateTime(value)` — an abbreviated date + short time.
    public static func dateTime(_ date: Date?) -> String {
        guard let date else { return emptyValue }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web chart x-axis tick (`time.split(',').pop()` ≈ the time component).
    public static func timeOnly(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    // MARK: - Traffic delay variant (web `TrafficDelayBadge` thresholds)

    /// Web `TrafficDelayBadge` tone: success < 300 s, warning ≤ 900 s, else danger.
    public static func trafficDelayTone(_ seconds: Double) -> TSTone {
        switch seconds {
        case ..<300: .success
        case ...900: .warning
        default: .danger
        }
    }

    /// Web Route-Traffic-Delay headline tint: success at 0 s, warning ≤ 300 s, else danger.
    public static func trafficDelayHeadlineTone(_ seconds: Double) -> TSTone {
        if seconds == 0 { return .success }
        return seconds <= 300 ? .warning : .danger
    }
}
