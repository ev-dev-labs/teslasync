import Foundation

/// The full cached payload the app writes for the widgets: one envelope holding
/// every widget's summary plus the time the app generated it. A single read of
/// this envelope feeds all six widgets, so the timeline provider touches the store
/// once per refresh.
public struct TeslaSyncWidgetSnapshot: Codable, Equatable, Sendable {
    /// Schema version of the payload. A reader that finds a newer version it does
    /// not understand falls back to the empty/offline state instead of misreading.
    public let schemaVersion: Int
    /// When the app produced this snapshot (drives the envelope-level freshness).
    public let generatedAt: Date

    public let vehicle: VehicleStatusSummary?
    public let charging: ChargingSummary?
    public let recentDrive: RecentDriveSummary?
    public let alerts: AlertSummary?
    public let energy: EnergySummary?
    public let systemHealth: SystemHealthSummary?
    public let climateSecurity: ClimateSecuritySummary?

    /// The schema version this build writes and can read.
    public static let currentSchemaVersion = 1

    public init(
        schemaVersion: Int = TeslaSyncWidgetSnapshot.currentSchemaVersion,
        generatedAt: Date,
        vehicle: VehicleStatusSummary? = nil,
        charging: ChargingSummary? = nil,
        recentDrive: RecentDriveSummary? = nil,
        alerts: AlertSummary? = nil,
        energy: EnergySummary? = nil,
        systemHealth: SystemHealthSummary? = nil,
        climateSecurity: ClimateSecuritySummary? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.vehicle = vehicle
        self.charging = charging
        self.recentDrive = recentDrive
        self.alerts = alerts
        self.energy = energy
        self.systemHealth = systemHealth
        self.climateSecurity = climateSecurity
    }

    /// Whether this build can read the payload (same or older schema).
    public var isReadable: Bool {
        schemaVersion <= TeslaSyncWidgetSnapshot.currentSchemaVersion
    }

    /// An empty envelope (nothing cached yet) generated at `date`. Widgets render
    /// their honest empty/offline state from this — never a blank panel.
    public static func empty(generatedAt date: Date) -> TeslaSyncWidgetSnapshot {
        TeslaSyncWidgetSnapshot(generatedAt: date)
    }
}

public extension TeslaSyncWidgetSnapshot {
    /// A representative, non-personal sample used for previews and the WidgetKit
    /// gallery. Deterministic relative to `reference` so previews are stable.
    static func sample(reference: Date = Date(timeIntervalSince1970: 1_700_000_000)) -> TeslaSyncWidgetSnapshot {
        TeslaSyncWidgetSnapshot(
            generatedAt: reference,
            vehicle: VehicleStatusSummary(
                vehicleName: "Model 3",
                batteryFraction: 0.72,
                batteryDisplay: "72%",
                rangeDisplay: "243 km",
                isCharging: false,
                isPluggedIn: false,
                locationLabel: "Home",
                sampledAt: reference.addingTimeInterval(-90)
            ),
            charging: ChargingSummary(
                isActive: true,
                batteryFraction: 0.72,
                batteryDisplay: "72%",
                powerDisplay: "11.0 kW",
                addedDisplay: "18.4 kWh",
                finishBy: reference.addingTimeInterval(45 * 60),
                sampledAt: reference.addingTimeInterval(-30)
            ),
            recentDrive: RecentDriveSummary(
                title: "Work",
                distanceDisplay: "27.4 km",
                durationDisplay: "32 min",
                efficiencyDisplay: "148 Wh/km",
                endedAt: reference.addingTimeInterval(-2 * 3600),
                sampledAt: reference.addingTimeInterval(-2 * 3600)
            ),
            alerts: AlertSummary(
                openCount: 2,
                criticalCount: 1,
                latestTitle: "Tire pressure low",
                sampledAt: reference.addingTimeInterval(-300)
            ),
            energy: EnergySummary(
                usedDisplay: "8.6 kWh",
                efficiencyDisplay: "152 Wh/km",
                costDisplay: "$1.42",
                chargedFraction: 0.64,
                sampledAt: reference.addingTimeInterval(-600)
            ),
            systemHealth: SystemHealthSummary(
                level: .operational,
                healthyServices: 8,
                totalServices: 8,
                sampledAt: reference.addingTimeInterval(-45)
            ),
            climateSecurity: sampleClimateSecurity(reference: reference)
        )
    }

    private static func sampleClimateSecurity(reference: Date) -> ClimateSecuritySummary {
        ClimateSecuritySummary(
            isLocked: true,
            isClimateOn: false,
            isSentryOn: true,
            insideTempDisplay: "21°",
            sampledAt: reference.addingTimeInterval(-90)
        )
    }
}
