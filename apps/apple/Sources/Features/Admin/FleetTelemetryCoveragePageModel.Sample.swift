import Foundation

/// A representative local seed used as the `FleetTelemetryCoveragePage` / preview default
/// until the KMP-backed source is injected at composition time. It is NOT production
/// telemetry — it is a package-derived-shaped routing snapshot so the surface renders its
/// populated state out of the box (mirroring the sibling pages' sample sources). The
/// per-destination totals follow the runtime fan-out: dual-write fields are counted under
/// both their primary destination and `signal_log`. The categories are split into static
/// builders so each stays small and focused.
public struct SampleFleetTelemetryCoverageDataSource: FleetTelemetryCoverageDataSource {
    public init() {}

    public func load() async throws -> FleetTelemetryCoverageResponse {
        FleetTelemetryCoverageResponse(
            categories: [Self.drive, Self.charging, Self.climate, Self.location, Self.battery],
            destinationTotals: [
                "drives": 3,
                "charging_sessions": 3,
                "positions": 2,
                "signal_log": 11
            ],
            orphanFields: ["LegacyChargeAmps", "DeprecatedRangeField"]
        )
    }

    private static let drive = FleetTelemetryCategoryCoverage(
        category: "Drive",
        totalFields: 4,
        destinations: ["drives": 3, "signal_log": 2],
        fields: [
            FleetTelemetryFieldCoverage(
                field: "VehicleSpeed",
                destination: "drives",
                column: "speed_mps",
                alsoSignalLog: true,
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(
                field: "Odometer",
                destination: "drives",
                column: "odometer_m",
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(field: "Gear", destination: "drives", column: "gear", subscribed: true),
            FleetTelemetryFieldCoverage(field: "DriveRail", destination: "signal_log", subscribed: false)
        ]
    )

    private static let charging = FleetTelemetryCategoryCoverage(
        category: "Charging",
        totalFields: 4,
        destinations: ["charging_sessions": 3, "signal_log": 2],
        fields: [
            FleetTelemetryFieldCoverage(
                field: "DetailedChargeState",
                destination: "charging_sessions",
                column: "charge_state",
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(
                field: "ChargerPower",
                destination: "charging_sessions",
                column: "charger_power_w",
                alsoSignalLog: true,
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(
                field: "ACChargingEnergyIn",
                destination: "charging_sessions",
                column: "energy_added_wh",
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(field: "ChargeRateMilePerHour", destination: "signal_log", subscribed: true)
        ]
    )

    private static let climate = FleetTelemetryCategoryCoverage(
        category: "Climate",
        totalFields: 3,
        destinations: ["signal_log": 3],
        fields: [
            FleetTelemetryFieldCoverage(field: "InsideTemp", destination: "signal_log", subscribed: true),
            FleetTelemetryFieldCoverage(field: "OutsideTemp", destination: "signal_log", subscribed: true),
            FleetTelemetryFieldCoverage(field: "HvacACEnabled", destination: "signal_log", subscribed: false)
        ]
    )

    private static let location = FleetTelemetryCategoryCoverage(
        category: "Location",
        totalFields: 2,
        destinations: ["positions": 2, "signal_log": 1],
        fields: [
            FleetTelemetryFieldCoverage(
                field: "Location",
                destination: "positions",
                column: "point",
                alsoSignalLog: true,
                subscribed: true
            ),
            FleetTelemetryFieldCoverage(
                field: "GpsHeading",
                destination: "positions",
                column: "heading_deg",
                subscribed: false
            )
        ]
    )

    private static let battery = FleetTelemetryCategoryCoverage(
        category: "Battery",
        totalFields: 3,
        destinations: ["signal_log": 3],
        fields: [
            FleetTelemetryFieldCoverage(field: "Soc", destination: "signal_log", subscribed: true),
            FleetTelemetryFieldCoverage(field: "BatteryLevel", destination: "signal_log", subscribed: true),
            FleetTelemetryFieldCoverage(field: "EstBatteryRange", destination: "signal_log", subscribed: false)
        ]
    )
}
