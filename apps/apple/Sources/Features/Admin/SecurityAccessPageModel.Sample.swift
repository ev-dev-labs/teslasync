import Foundation

/// Sample security-access source — returns a representative, cohesive report so the
/// composed page renders its populated state out of the box. This is NOT production
/// telemetry; it mirrors the sibling admin pages' sample defaults
/// (`SampleDiskForecastDataSource`, `SystemPageSampleSources`). The live KMP-backed
/// source (the security-event history + latest queries and the vehicle list) is
/// injected at registration / in tests.
public struct SampleSecurityAccessDataSource: SecurityAccessDataSource {
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
    }

    public func load(vehicleID _: String?) async throws -> SecurityAccessReport {
        SecurityAccessSampleData.report(now: now())
    }
}

/// The cohesive sample dataset the page composes from. One representative scenario — a
/// locked, sentry-armed vehicle whose front-driver window is vented (so the vehicle is
/// not fully secure: the web `!isSecure` alert banner renders) — plus a few days of
/// security history so the sentry chart, statistics, history table, and timeline all
/// render meaningful, internally-consistent values.
public enum SecurityAccessSampleData {
    /// The two sample vehicles the `VehicleSelect` picker lists.
    public static func vehicles() -> [SecurityAccessVehicle] {
        [
            SecurityAccessVehicle(id: "1", displayName: "Model Y · Long Range"),
            SecurityAccessVehicle(id: "2", displayName: "Model 3 · Performance")
        ]
    }

    /// The latest reading: locked + sentry armed, doors closed, but the front-driver
    /// window is vented — the "mostly secure, one window open" state that surfaces the
    /// not-secure alert while still populating the twin + every status section.
    public static func latest(now: Date = Date()) -> SecurityReading {
        SecurityReading(
            locked: true,
            sentryMode: .text("On"),
            doorState: .text("Closed"),
            frontDriverWindow: .text("Vent"),
            frontPassengerWindow: .text("Closed"),
            rearDriverWindow: .text("Closed"),
            rearPassengerWindow: .text("Closed"),
            homelinkNearby: true,
            guestMode: false,
            lightsHazardsActive: false,
            lightsHighBeams: false,
            lightsTurnSignal: .text("Off"),
            driverSeatOccupied: false,
            pairedPhoneKeyCount: 2,
            valetModeEnabled: false,
            serviceMode: false,
            speedLimitMode: .bool(false),
            homelinkDeviceCount: 1,
            centerDisplay: .text("Off"),
            createdAt: now.addingTimeInterval(-120)
        )
    }

    /// One scripted history record before it is materialized into a `SecurityEventInput`.
    private struct SampleRecord {
        let agoHours: Double
        let locked: Bool
        let sentryOn: Bool
        let door: String
        let frontDriverWindow: String
    }

    /// A few days of security history (newest first), spanning three calendar days so the
    /// sentry buckets, statistics, and timeline all have multi-day, mixed-state content.
    public static func history(now: Date = Date()) -> [SecurityEventInput] {
        let records: [SampleRecord] = [
            SampleRecord(agoHours: 0.03, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Vent"),
            SampleRecord(agoHours: 1, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 4, locked: false, sentryOn: false, door: "Open", frontDriverWindow: "Open"),
            SampleRecord(agoHours: 9, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 26, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 30, locked: false, sentryOn: false, door: "Open", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 33, locked: true, sentryOn: false, door: "Closed", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 50, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Closed"),
            SampleRecord(agoHours: 54, locked: true, sentryOn: true, door: "Closed", frontDriverWindow: "Vent"),
            SampleRecord(agoHours: 58, locked: false, sentryOn: false, door: "Open", frontDriverWindow: "Closed")
        ]
        return records.enumerated().map { index, record in
            SecurityEventInput(
                id: "sample-\(index)",
                createdAt: iso(now.addingTimeInterval(-record.agoHours * 3600)),
                locked: .bool(record.locked),
                sentryMode: .bool(record.sentryOn),
                doorState: .string(record.door),
                fdWindow: .string(record.frontDriverWindow),
                fpWindow: .string("Closed"),
                rdWindow: .string("Closed"),
                rpWindow: .string("Closed")
            )
        }
    }

    /// The full report (web latest + history + vehicles).
    public static func report(now: Date = Date()) -> SecurityAccessReport {
        SecurityAccessReport(vehicles: vehicles(), latest: latest(now: now), history: history(now: now))
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
