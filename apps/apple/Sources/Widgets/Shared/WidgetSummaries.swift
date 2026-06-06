import Foundation

// Glanceable, **already display-formatted** summaries the app caches for the
// widgets. The app owns the unit preferences and SI→display conversion (ADR-016),
// so it writes ready-to-render strings plus the raw `0...1` fractions the widgets
// need for gauges. The widgets never convert units and never see SI internals.
//
// Every type here is deliberately free of precise location, VIN, or token data:
// privacy redaction is structural (there is simply no field to leak) plus the
// `WidgetRedaction` helpers the publisher applies on the way in.

/// Vehicle status: battery, range, and a coarse location label.
public struct VehicleStatusSummary: Codable, Equatable, Sendable {
    /// Short, human display name (never a VIN). Redacted by the publisher.
    public let vehicleName: String
    /// Battery state of charge as a fraction, clamped to `0...1`.
    public let batteryFraction: Double
    /// Display SoC, e.g. `"72%"`.
    public let batteryDisplay: String
    /// Display range in the user's units, e.g. `"243 km"`.
    public let rangeDisplay: String
    public let isCharging: Bool
    public let isPluggedIn: Bool
    /// Coarse place label only (e.g. `"Home"`, `"San Jose"`) — never coordinates.
    public let locationLabel: String?
    /// When the underlying vehicle data was sampled (drives per-field freshness).
    public let sampledAt: Date

    public init(
        vehicleName: String,
        batteryFraction: Double,
        batteryDisplay: String,
        rangeDisplay: String,
        isCharging: Bool,
        isPluggedIn: Bool,
        locationLabel: String?,
        sampledAt: Date
    ) {
        self.vehicleName = vehicleName
        self.batteryFraction = batteryFraction.clampedUnitInterval
        self.batteryDisplay = batteryDisplay
        self.rangeDisplay = rangeDisplay
        self.isCharging = isCharging
        self.isPluggedIn = isPluggedIn
        self.locationLabel = locationLabel
        self.sampledAt = sampledAt
    }
}

/// Charging progress for an active or recent session.
public struct ChargingSummary: Codable, Equatable, Sendable {
    public let isActive: Bool
    public let batteryFraction: Double
    public let batteryDisplay: String
    /// Display charge power, e.g. `"11.0 kW"`. `nil` when idle.
    public let powerDisplay: String?
    /// Display energy added this session, e.g. `"18.4 kWh"`.
    public let addedDisplay: String?
    /// Estimated completion time, for a self-updating countdown. `nil` when idle.
    public let finishBy: Date?
    public let sampledAt: Date

    public init(
        isActive: Bool,
        batteryFraction: Double,
        batteryDisplay: String,
        powerDisplay: String?,
        addedDisplay: String?,
        finishBy: Date?,
        sampledAt: Date
    ) {
        self.isActive = isActive
        self.batteryFraction = batteryFraction.clampedUnitInterval
        self.batteryDisplay = batteryDisplay
        self.powerDisplay = powerDisplay
        self.addedDisplay = addedDisplay
        self.finishBy = finishBy
        self.sampledAt = sampledAt
    }
}

/// The latest completed drive at a glance.
public struct RecentDriveSummary: Codable, Equatable, Sendable {
    /// Coarse destination label only (e.g. `"Work"`), never coordinates.
    public let title: String
    public let distanceDisplay: String
    public let durationDisplay: String
    public let efficiencyDisplay: String
    /// When the drive ended.
    public let endedAt: Date
    public let sampledAt: Date

    public init(
        title: String,
        distanceDisplay: String,
        durationDisplay: String,
        efficiencyDisplay: String,
        endedAt: Date,
        sampledAt: Date
    ) {
        self.title = title
        self.distanceDisplay = distanceDisplay
        self.durationDisplay = durationDisplay
        self.efficiencyDisplay = efficiencyDisplay
        self.endedAt = endedAt
        self.sampledAt = sampledAt
    }
}

/// Count of open alerts, split by severity.
public struct AlertSummary: Codable, Equatable, Sendable {
    public let openCount: Int
    public let criticalCount: Int
    /// Short title of the most recent open alert, if any (already localized/redacted).
    public let latestTitle: String?
    public let sampledAt: Date

    public init(openCount: Int, criticalCount: Int, latestTitle: String?, sampledAt: Date) {
        self.openCount = max(0, openCount)
        self.criticalCount = max(0, criticalCount)
        self.latestTitle = latestTitle
        self.sampledAt = sampledAt
    }
}

/// Energy use snapshot for the current day.
public struct EnergySummary: Codable, Equatable, Sendable {
    public let usedDisplay: String
    public let efficiencyDisplay: String
    public let costDisplay: String?
    /// Fraction of the day's energy that came from charging (for a small bar).
    public let chargedFraction: Double
    public let sampledAt: Date

    public init(
        usedDisplay: String,
        efficiencyDisplay: String,
        costDisplay: String?,
        chargedFraction: Double,
        sampledAt: Date
    ) {
        self.usedDisplay = usedDisplay
        self.efficiencyDisplay = efficiencyDisplay
        self.costDisplay = costDisplay
        self.chargedFraction = chargedFraction.clampedUnitInterval
        self.sampledAt = sampledAt
    }
}

/// Overall TeslaSync service health, mirroring `/system/health`.
public struct SystemHealthSummary: Codable, Equatable, Sendable {
    public enum Level: String, Codable, Equatable, Sendable {
        case operational, degraded, down
    }

    public let level: Level
    public let healthyServices: Int
    public let totalServices: Int
    public let sampledAt: Date

    public init(level: Level, healthyServices: Int, totalServices: Int, sampledAt: Date) {
        self.level = level
        self.healthyServices = max(0, healthyServices)
        self.totalServices = max(0, totalServices)
        self.sampledAt = sampledAt
    }
}

extension Double {
    /// Clamps any value into the `0...1` unit interval, mapping NaN/∞ to `0`.
    var clampedUnitInterval: Double {
        guard isFinite else { return 0 }
        return Swift.min(1, Swift.max(0, self))
    }
}
