import Foundation

// Pure display formatters for the Map Overview page — the SwiftUI render boundary where SI
// values become the user's units (ADR-005). Kept free of view code so they unit-test directly,
// mirroring the sibling `*Format` enums. Speed / distance go through the shared `Units` engine
// so every platform shows identical numbers; the unit suffix resolves from the web i18n keys
// `mapOverview.speedUnitValue` / `mapOverview.distanceUnitValue`.

public enum MapOverviewFormat {
    private static let grouped: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.usesGroupingSeparator = true
        return formatter
    }()

    /// Web `fmtNumber(value, decimals)` — grouped, fixed-fraction decimal text.
    public static func number(_ value: Double, decimals: Int) -> String {
        grouped.minimumFractionDigits = decimals
        grouped.maximumFractionDigits = decimals
        return grouped.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// A single coordinate component, fixed decimals without grouping (web table / cards).
    public static func coordinate(_ value: Double, decimals: Int) -> String {
        String(format: "%.\(decimals)f", value)
    }

    /// The "lat, lon" metric-card value, or the em-dash when the fix is missing/null-island.
    public static func coordinatePair(_ position: MapOverviewPosition?, decimals: Int) -> String {
        guard let position, position.hasValidLocation else { return "—" }
        return "\(coordinate(position.latitude, decimals: decimals)), "
            + coordinate(position.longitude, decimals: decimals)
    }

    /// Web `formatDateTime` — abbreviated date + short time.
    public static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Short time of day for the history table's Time column.
    public static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// Compass heading in degrees (web `${heading}°`), or the em-dash when absent.
    public static func heading(_ degrees: Double?) -> String {
        guard let degrees else { return "—" }
        return "\(number(degrees, decimals: 0))°"
    }

    /// The unit suffix for speed, resolved from the web i18n key with the active unit label.
    public static func speedUnitLabel(_ units: UnitPreferences) -> String {
        String(format: String(localized: "mapOverview.speedUnitValue"), units.speed)
    }

    /// The unit suffix for distance, resolved from the web i18n key with the active unit label.
    public static func distanceUnitLabel(_ units: UnitPreferences) -> String {
        String(format: String(localized: "mapOverview.distanceUnitValue"), units.distance)
    }

    /// SI m/s → "<value> <unit>" in the user's speed unit (web current-speed + table cell).
    public static func speed(_ mps: Double?, units: UnitPreferences) -> String {
        let converted = Units.convertSpeed(mps ?? 0, units)
        return "\(number(converted, decimals: 1)) \(speedUnitLabel(units))"
    }

    /// SI metres → "<value> <unit>" in the user's distance unit (web odometer row).
    public static func odometer(_ meters: Double?, units: UnitPreferences) -> String {
        guard let meters else { return "—" }
        let converted = Units.convertDistance(meters, units)
        return "\(number(converted, decimals: 1)) \(distanceUnitLabel(units))"
    }
}
