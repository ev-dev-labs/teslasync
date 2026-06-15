import Foundation

/// A representative local seed used as the `SleepEfficiencyPage` / preview default until
/// the KMP-backed source is injected at composition time. It is NOT production telemetry —
/// it is an API-response-shaped fixture (a healthy sleeper with a five-state distribution,
/// a Sentry on/off comparison, and six recent drain events) so the surface renders its
/// populated success state out of the box. Efficiency / rates / battery-lost are raw
/// percents, `outsideTempC` is SI Celsius, energy is kWh, cost is a currency amount; the
/// view converts at the render boundary.
public struct SampleSleepEfficiencyDataSource: SleepEfficiencyDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadSleep(vehicleID _: Int64, days _: Int) async throws -> SleepEfficiencyData? {
        SleepEfficiencyData(
            sleepEfficiencyPct: 78.5,
            timeToSleepAvgMin: 22,
            sentryOnDrainRate: 1.8,
            sentryOffDrainRate: 0.4,
            sentryMonthlyCost: 12.40,
            sentryMonthlyKwh: 31.5,
            sentryExtraDrainRate: 1.4,
            sentryExtraMonthlyKwh: 24.8,
            sentryExtraMonthlyCost: 9.90,
            stateDistribution: [
                SleepStateShare(state: "asleep", totalMinutes: 18000),
                SleepStateShare(state: "online", totalMinutes: 4200),
                SleepStateShare(state: "driving", totalMinutes: 2600),
                SleepStateShare(state: "charging", totalMinutes: 1500),
                SleepStateShare(state: "suspended", totalMinutes: 900)
            ],
            sentryComparison: [
                SleepSentryComparison(sentryMode: true, avgDrainRate: 1.8, avgBatteryLost: 6.2),
                SleepSentryComparison(sentryMode: false, avgDrainRate: 0.4, avgBatteryLost: 1.1)
            ],
            recentEvents: SampleSleepEfficiencyDataSource.sampleEvents()
        )
    }

    /// Six recent drain events spanning Sentry on/off and warm/cold nights.
    static func sampleEvents() -> [SleepDrainEvent] {
        let rows: [EventSample] = [
            EventSample(id: 1, date: "2025-08-12T22:14:00Z", hours: 9.5, lost: 5.8, rate: 1.9, sentry: true, temp: 24),
            EventSample(id: 2, date: "2025-08-11T23:02:00Z", hours: 8.1, lost: 1.2, rate: 0.4, sentry: false, temp: 18),
            EventSample(id: 3, date: "2025-08-10T21:48:00Z", hours: 10.2, lost: 6.4, rate: 1.7, sentry: true, temp: 27),
            EventSample(id: 4, date: "2025-08-09T22:36:00Z", hours: 7.4, lost: 0.9, rate: 0.3, sentry: false, temp: 15),
            EventSample(id: 5, date: "2025-08-08T23:20:00Z", hours: 9.0, lost: 1.5, rate: 0.5, sentry: false, temp: -3),
            EventSample(id: 6, date: "2025-08-07T22:05:00Z", hours: 8.8, lost: 5.2, rate: 1.6, sentry: true, temp: 21)
        ]
        return rows.map { row in
            SleepDrainEvent(
                id: row.id,
                startDate: row.date,
                durationHours: row.hours,
                batteryLost: row.lost,
                drainRate: row.rate,
                sentryMode: row.sentry,
                outsideTempC: row.temp
            )
        }
    }

    /// One seeded drain-event row (a named shape, not a wide tuple).
    private struct EventSample {
        let id: Int64
        let date: String
        let hours: Double
        let lost: Double
        let rate: Double
        let sentry: Bool
        let temp: Double?
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose sleep snapshot is nil — drives the
    /// page's no-data empty state (web `!sleep`).
    public struct EmptySleepEfficiencyDataSource: SleepEfficiencyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSleep(vehicleID _: Int64, days _: Int) async throws -> SleepEfficiencyData? {
            nil
        }
    }

    /// Preview/test seam yielding a snapshot whose three collections are empty — drives
    /// every per-section empty state (donut, comparison bars, drain-events table) while
    /// the page itself is `.ready`.
    public struct EmptySectionsSleepEfficiencyDataSource: SleepEfficiencyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSleep(vehicleID _: Int64, days _: Int) async throws -> SleepEfficiencyData? {
            SleepEfficiencyData(
                sleepEfficiencyPct: 0,
                timeToSleepAvgMin: 0,
                sentryOnDrainRate: 0,
                sentryOffDrainRate: 0,
                sentryMonthlyCost: 0,
                sentryMonthlyKwh: 0,
                sentryExtraDrainRate: 0,
                sentryExtraMonthlyKwh: 0,
                sentryExtraMonthlyCost: 0,
                stateDistribution: [],
                sentryComparison: [],
                recentEvents: []
            )
        }
    }

    /// Preview/test seam whose sleep load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingSleepEfficiencyDataSource: SleepEfficiencyDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSleep(vehicleID _: Int64, days _: Int) async throws -> SleepEfficiencyData? {
            throw Failure()
        }
    }
#endif
