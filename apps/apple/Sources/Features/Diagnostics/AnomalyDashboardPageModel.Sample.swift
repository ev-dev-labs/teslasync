import Foundation

/// A representative local seed used as the `AnomalyDashboardPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// `useAnomalies`-response-shaped fixture (3 vehicles, each with its own anomaly list, system-health
/// roll-up, and rolling counts) so the surface renders its populated success state out of the box
/// (mirroring the sibling page sample sources). Timestamps are anchored to "now" so the relative
/// `TimeStamp` chips read naturally in previews.
public struct SampleAnomalyDashboardDataSource: AnomalyDashboardDataSource {
    public init() {}

    public func loadVehicles() async throws -> [AnomalyVehicle] {
        [
            AnomalyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            AnomalyVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            AnomalyVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadAnomalies(vehicleID: Int64, days _: Int) async throws -> AnomalyData? {
        switch vehicleID {
        case 1: Self.rocinante
        case 2: Self.tachi
        default: Self.razorback
        }
    }

    /// ISO-8601 instant `hours` before now, so relative timestamps stay current in previews/tests.
    static func ago(hours: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-hours * 3600))
    }

    private static var rocinante: AnomalyData {
        AnomalyData(
            anomalies: [
                AnomalyEntry(
                    signal: "battery_voltage",
                    type: "z_score",
                    severity: AnomalySeverity(raw: "critical"),
                    value: 402.6,
                    baseline: 388.1,
                    zScore: 3.4,
                    detectedAt: ago(hours: 2),
                    message: "Pack voltage spiked 3.4σ above the rolling baseline."
                ),
                AnomalyEntry(
                    signal: "tire_pressure_fl",
                    type: "range",
                    severity: AnomalySeverity(raw: "warning"),
                    value: 2.4,
                    baseline: 2.9,
                    zScore: 2.1,
                    detectedAt: ago(hours: 9),
                    message: "Front-left tire pressure dropped below the safe range."
                ),
                AnomalyEntry(
                    signal: "motor_temp_rear",
                    type: "trend",
                    severity: AnomalySeverity(raw: "warning"),
                    value: 78.5,
                    baseline: 64.2,
                    zScore: 1.8,
                    detectedAt: ago(hours: 26),
                    message: "Rear motor temperature trending up across the last 12 drives."
                ),
                AnomalyEntry(
                    signal: "battery_voltage",
                    type: "range",
                    severity: AnomalySeverity(raw: "info"),
                    value: 391.0,
                    baseline: 388.1,
                    zScore: 0,
                    detectedAt: ago(hours: 50),
                    message: "Pack voltage briefly touched the upper advisory band."
                )
            ],
            healthCategories: [
                AnomalyHealthCategory(category: "battery", status: "critical"),
                AnomalyHealthCategory(category: "tires", status: "warning"),
                AnomalyHealthCategory(category: "motors", status: "warning"),
                AnomalyHealthCategory(category: "hvac", status: "normal"),
                AnomalyHealthCategory(category: "charging", status: "normal")
            ],
            signalsMonitored: 48,
            anomaliesLast7d: 12,
            anomaliesLast24h: 3
        )
    }

    private static var tachi: AnomalyData {
        AnomalyData(
            anomalies: [
                AnomalyEntry(
                    signal: "cabin_temp",
                    type: "trend",
                    severity: AnomalySeverity(raw: "warning"),
                    value: 41.2,
                    baseline: 33.0,
                    zScore: 1.6,
                    detectedAt: ago(hours: 5),
                    message: "Cabin temperature climbing faster than the HVAC can offset."
                ),
                AnomalyEntry(
                    signal: "charge_rate",
                    type: "z_score",
                    severity: AnomalySeverity(raw: "info"),
                    value: 7.1,
                    baseline: 11.4,
                    zScore: 1.2,
                    detectedAt: ago(hours: 30),
                    message: "Charge rate dipped modestly below the learned baseline."
                )
            ],
            healthCategories: [
                AnomalyHealthCategory(category: "battery", status: "normal"),
                AnomalyHealthCategory(category: "tires", status: "normal"),
                AnomalyHealthCategory(category: "motors", status: "normal"),
                AnomalyHealthCategory(category: "hvac", status: "warning"),
                AnomalyHealthCategory(category: "charging", status: "normal")
            ],
            signalsMonitored: 46,
            anomaliesLast7d: 4,
            anomaliesLast24h: 1
        )
    }

    private static var razorback: AnomalyData {
        AnomalyData(
            anomalies: [
                AnomalyEntry(
                    signal: "motor_temp_front",
                    type: "z_score",
                    severity: AnomalySeverity(raw: "critical"),
                    value: 96.3,
                    baseline: 71.8,
                    zScore: 4.1,
                    detectedAt: ago(hours: 1),
                    message: "Front motor temperature exceeded the critical threshold."
                ),
                AnomalyEntry(
                    signal: "motor_temp_front",
                    type: "trend",
                    severity: AnomalySeverity(raw: "warning"),
                    value: 88.0,
                    baseline: 71.8,
                    zScore: 2.3,
                    detectedAt: ago(hours: 14),
                    message: "Front motor temperature trending toward the critical band."
                ),
                AnomalyEntry(
                    signal: "battery_current",
                    type: "range",
                    severity: AnomalySeverity(raw: "critical"),
                    value: 612.0,
                    baseline: 410.0,
                    zScore: 3.9,
                    detectedAt: ago(hours: 20),
                    message: "Pack discharge current outside the safe operating range."
                )
            ],
            healthCategories: [
                AnomalyHealthCategory(category: "battery", status: "critical"),
                AnomalyHealthCategory(category: "tires", status: "normal"),
                AnomalyHealthCategory(category: "motors", status: "critical"),
                AnomalyHealthCategory(category: "hvac", status: "normal"),
                AnomalyHealthCategory(category: "charging", status: "warning")
            ],
            signalsMonitored: 52,
            anomaliesLast7d: 21,
            anomaliesLast24h: 6
        )
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose anomaly query returns no payload — drives the
    /// page's top-level no-data empty (web query disabled / `data` undefined).
    public struct EmptyAnomalyDashboardDataSource: AnomalyDashboardDataSource {
        public init() {}

        public func loadVehicles() async throws -> [AnomalyVehicle] {
            [AnomalyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnomalies(vehicleID _: Int64, days _: Int) async throws -> AnomalyData? {
            nil
        }
    }

    /// Preview/test seam yielding a payload with no anomalies and no health buckets — drives every
    /// per-section empty inside the ready state (web `noAnomalies` / `noHealth` / `noFrequency`).
    public struct QuietAnomalyDashboardDataSource: AnomalyDashboardDataSource {
        public init() {}

        public func loadVehicles() async throws -> [AnomalyVehicle] {
            [AnomalyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnomalies(vehicleID _: Int64, days _: Int) async throws -> AnomalyData? {
            AnomalyData(
                anomalies: [],
                healthCategories: [],
                signalsMonitored: 48,
                anomaliesLast7d: 0,
                anomaliesLast24h: 0
            )
        }
    }

    /// Preview/test seam whose anomaly load fails — drives the error region (web `error` prop).
    public struct FailingAnomalyDashboardDataSource: AnomalyDashboardDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [AnomalyVehicle] {
            [AnomalyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadAnomalies(vehicleID _: Int64, days _: Int) async throws -> AnomalyData? {
            throw Failure()
        }
    }
#endif
