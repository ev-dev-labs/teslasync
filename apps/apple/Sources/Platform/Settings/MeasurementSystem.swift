import Foundation

/// The user's preferred measurement system. Kept deliberately **Shared-free**: it
/// only describes which SI display labels the rendering layer should use, so the
/// settings layer never imports the KMP `Shared` framework. The facade bootstrap
/// maps this onto the shared core's `UnitPref` at the display boundary (ADR-016) —
/// the database and API stay SI regardless.
public enum MeasurementSystem: String, CaseIterable, Codable, Sendable, Identifiable {
    case metric
    case imperial

    public var id: String {
        rawValue
    }

    public var titleKey: String {
        "settings.units.\(rawValue)"
    }

    /// Display unit labels for this system (SI labels the shared converters
    /// round-trip through). Order: distance, speed, temperature, pressure, energy,
    /// duration, power.
    public var distanceLabel: String {
        self == .metric ? "km" : "mi"
    }

    public var speedLabel: String {
        self == .metric ? "km/h" : "mph"
    }

    public var temperatureLabel: String {
        self == .metric ? "°C" : "°F"
    }

    public var pressureLabel: String {
        self == .metric ? "kPa" : "psi"
    }

    public var energyLabel: String {
        self == .metric ? "Wh" : "kWh"
    }

    public var durationLabel: String {
        self == .metric ? "h" : "min"
    }

    public var powerLabel: String {
        self == .metric ? "W" : "kW"
    }
}
