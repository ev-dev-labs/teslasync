import Foundation

/// A representative local seed used as the page / preview default until the KMP-backed source is
/// injected at composition time. It is NOT production telemetry — it is an API-response-shaped fixture
/// (a fleet of three vehicles with two weeks of drives / charging / alerts) so the surface renders its
/// populated success state out of the box, mirroring the sibling pages' sample sources. Values are in
/// the digest's display units (km, kWh, currency, minutes, %). Dates are anchored to the injected
/// clock so the fixture always populates the current + previous week.
public struct SampleWeeklyDigestDataSource: WeeklyDigestDataSource {
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
    }

    public func loadVehicles() async throws -> [DigestVehicle] {
        SampleWeeklyDigestFixture.vehicles
    }

    public func loadActivity(vehicleID _: String) async throws -> DigestActivity {
        SampleWeeklyDigestFixture.activity(now: now())
    }
}

#if DEBUG
    /// Preview/test seam that loads a vehicle but no activity — drives the page's empty state
    /// (web `!hasData` → `EmptyState`).
    public struct EmptyWeeklyDigestDataSource: WeeklyDigestDataSource {
        public init() {}

        public func loadVehicles() async throws -> [DigestVehicle] {
            [SampleWeeklyDigestFixture.vehicles[0]]
        }

        public func loadActivity(vehicleID _: String) async throws -> DigestActivity {
            .empty
        }
    }

    /// Preview/test seam whose load fails — drives the error state (web `PageContainer error`).
    public struct FailingWeeklyDigestDataSource: WeeklyDigestDataSource {
        public struct Failure: Error {}

        public init() {}

        public func loadVehicles() async throws -> [DigestVehicle] {
            throw Failure()
        }

        public func loadActivity(vehicleID _: String) async throws -> DigestActivity {
            throw Failure()
        }
    }
#endif

/// The shared digest fixture, assembled so the populated state exercises every section — the hero
/// trend chips, both daily charts, the driving/charging stats, the battery pills, the alert pie, and
/// the week-over-week comparison — across the current + previous week.
public enum SampleWeeklyDigestFixture {
    public static let vehicles = [
        DigestVehicle(id: "1", name: "Rocinante"),
        DigestVehicle(id: "2", name: "Tachi"),
        DigestVehicle(id: "3", name: "Razorback")
    ]

    /// Two weeks of activity anchored to `now`, placed at local noon each day so it buckets cleanly.
    public static func activity(now: Date) -> DigestActivity {
        let calendar = Calendar.current
        let noonToday = calendar.date(
            bySettingHour: 12, minute: 0, second: 0, of: calendar.startOfDay(for: now)
        ) ?? now

        func day(_ daysBack: Int) -> Date {
            calendar.date(byAdding: .day, value: -daysBack, to: noonToday) ?? noonToday
        }

        let drives: [DigestDrive] = (0 ..< 14).map { back in
            let distance = Double(20 + (back * 7) % 80)
            let efficiency = Double(150 + (back * 5) % 50)
            return DigestDrive(
                id: 1000 + back,
                startDate: day(back),
                distanceKm: distance,
                durationMin: (distance * 1.2).rounded(),
                efficiencyWhKm: efficiency,
                energyUsedKwh: (distance * efficiency / 1000).rounded(toPlaces: 2)
            )
        }

        let charging: [DigestCharge] = stride(from: 0, to: 14, by: 2).map { back in
            let energy = Double(8 + (back * 3) % 40)
            let start = Double(30 + (back * 5) % 40)
            return DigestCharge(
                id: 2000 + back,
                startTs: day(back),
                energyAddedKwh: energy,
                cost: (energy * 0.15).rounded(toPlaces: 2),
                durationMin: (energy * 4).rounded(),
                startBatteryPct: start,
                endBatteryPct: min(start + 40, 95)
            )
        }

        let severities = ["info", "warning", "info", "critical", "warning"]
        let alerts: [DigestAlert] = severities.enumerated().map { index, severity in
            DigestAlert(id: 3000 + index, severity: severity, createdAt: day(index))
        }

        return DigestActivity(drives: drives, charging: charging, alerts: alerts)
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10.0, Double(places))
        return (self * factor).rounded() / factor
    }
}
