import Foundation

/// A representative local seed used as the `PeriodComparePage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with per-day rates scaled across the requested
/// window) so the surface renders its populated comparison out of the box (mirroring the sibling
/// pages' sample sources). All measurements are SI canonical (meters, watt-hours, Wh/km); the
/// view converts at the display boundary.
public struct SamplePeriodCompareDataSource: PeriodCompareDataSource {
    public init() {}

    public func loadVehicles() async throws -> [PeriodCompareVehicle] {
        [
            PeriodCompareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            PeriodCompareVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            PeriodCompareVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadPeriodStats(vehicleID: Int64, days: Int) async throws -> PeriodStats? {
        // "All time" (days == 0) is modeled as a long, fixed two-year span.
        let span = Double(days == 0 ? 730 : days)
        let rate = Self.dailyRate(for: vehicleID)
        return PeriodStats(
            totalDistanceM: rate.distanceM * span,
            totalDrives: Int((rate.drives * span).rounded()),
            energyUsedWh: rate.energyWh * span,
            avgEfficiencyWhKm: rate.efficiencyWhKm,
            totalCost: rate.cost * span,
            co2SavedKg: rate.co2Kg * span
        )
    }

    /// Per-day SI rates per vehicle; the window-scaled totals make A (e.g. 30d) vs B (e.g. 90d)
    /// a meaningful comparison.
    private static func dailyRate(for vehicleID: Int64) -> DailyRate {
        switch vehicleID {
        case 1:
            DailyRate(distanceM: 40000, drives: 2.0, energyWh: 8000, efficiencyWhKm: 152, cost: 2.5, co2Kg: 3.0)
        case 2:
            DailyRate(distanceM: 32000, drives: 1.6, energyWh: 6800, efficiencyWhKm: 168, cost: 2.1, co2Kg: 2.4)
        default:
            DailyRate(distanceM: 55000, drives: 2.7, energyWh: 11400, efficiencyWhKm: 174, cost: 3.3, co2Kg: 4.1)
        }
    }

    private struct DailyRate {
        let distanceM: Double
        let drives: Double
        let energyWh: Double
        let efficiencyWhKm: Double
        let cost: Double
        let co2Kg: Double
    }
}

#if DEBUG
    /// Preview/test seam yielding no vehicles — drives the empty state (web `!a || !b` with no
    /// active vehicle → EmptyState).
    public struct EmptyPeriodCompareDataSource: PeriodCompareDataSource {
        public init() {}

        public func loadVehicles() async throws -> [PeriodCompareVehicle] {
            []
        }

        public func loadPeriodStats(vehicleID _: Int64, days _: Int) async throws -> PeriodStats? {
            nil
        }
    }

    /// Preview/test seam whose period-stats load fails — drives the error state (web
    /// `statsA.error ?? statsB.error`). The vehicle list still loads so a vehicle is selected.
    public struct FailingPeriodCompareDataSource: PeriodCompareDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [PeriodCompareVehicle] {
            [
                PeriodCompareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
                PeriodCompareVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
            ]
        }

        public func loadPeriodStats(vehicleID _: Int64, days _: Int) async throws -> PeriodStats? {
            throw Failure()
        }
    }
#endif
