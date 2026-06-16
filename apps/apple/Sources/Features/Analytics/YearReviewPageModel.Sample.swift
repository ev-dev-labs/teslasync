import Foundation

/// A representative local seed used as the `YearReviewPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a full annual roll-up) so the story renders
/// its populated success state out of the box (mirroring the sibling page's sample source). All
/// measurements are SI canonical (meters, watt-hours, seconds, Wh/km); the view converts at the
/// boundary.
public struct SampleYearReviewDataSource: YearReviewDataSource {
    public init() {}

    public func loadVehicles() async throws -> [YearReviewStoryVehicle] {
        [
            YearReviewStoryVehicle(id: 1, displayName: "Rocinante", model: "Model 3"),
            YearReviewStoryVehicle(id: 2, displayName: "Tachi", model: "Model Y"),
            YearReviewStoryVehicle(id: 3, displayName: "Razorback", model: "Model S")
        ]
    }

    public func loadYearReview(year: Int, vehicleID: Int64) async throws -> YearReview? {
        let vehicle = try await (loadVehicles()).first { $0.id == vehicleID }
            ?? YearReviewStoryVehicle(id: vehicleID, displayName: "Rocinante", model: "Model 3")
        let scale = scaleFactor(for: vehicleID)
        return Self.review(year: year, vehicle: vehicle, scale: scale)
    }

    private func scaleFactor(for vehicleID: Int64) -> Double {
        switch vehicleID {
        case 2: 0.86
        case 3: 1.24
        default: 1
        }
    }

    static func review(year: Int, vehicle: YearReviewStoryVehicle, scale: Double) -> YearReview {
        YearReview(
            year: year,
            vehicle: vehicle,
            totalDrives: Int(1240 * scale),
            totalDistanceM: 18_400_000 * scale,
            totalEnergyWh: 3_180_000 * scale,
            totalChargeSessions: Int(92 * scale),
            totalChargingCost: 540 * scale,
            gasSavings: 1450 * scale,
            co2OffsetKg: 2680 * scale,
            longestDrive: YearReviewDriveHighlight(
                driveID: 4821,
                date: "Aug 14, \(year)",
                distanceM: 540_000,
                durationS: 23400,
                startAddress: "San Francisco, CA",
                endAddress: "Los Angeles, CA",
                efficiencyWhKm: 168
            ),
            mostEfficientDrive: YearReviewDriveHighlight(
                driveID: 5190,
                date: "May 2, \(year)",
                distanceM: 82000,
                durationS: 4800,
                startAddress: "Palo Alto, CA",
                endAddress: "San Jose, CA",
                efficiencyWhKm: 132
            ),
            monthlyStats: monthly(scale: scale),
            mostActiveDayOfWeek: "Saturday",
            mostActiveHour: 17,
            avgDrivesPerWeek: 23.8 * scale,
            avgDistancePerDriveM: 14800,
            avgEfficiencyWhKm: 162,
            superchargerPct: 38,
            dcFastPct: 12,
            acOtherPct: 50,
            avgChargeStartSoc: 42,
            comparisons: comparisons
        )
    }

    private static func monthly(scale: Double) -> [YearReviewMonthStat] {
        let base = [82, 74, 96, 105, 118, 124, 131, 140, 122, 109, 88, 71]
        return base.enumerated().map { index, drives in
            YearReviewMonthStat(month: index + 1, drives: Int(Double(drives) * scale))
        }
    }

    private static let comparisons: [YearReviewComparison] = [
        YearReviewComparison(label: "Everest climbs", value: "2.1× the elevation gained", emoji: "🏔️"),
        YearReviewComparison(label: "Coffees saved", value: "290 cups vs. gas", emoji: "☕"),
        YearReviewComparison(label: "Phone charges", value: "≈ 318,000 full charges", emoji: "🔋"),
        YearReviewComparison(label: "Marathons", value: "436 marathons of distance", emoji: "🏃")
    ]
}

#if DEBUG
    /// Preview/test seam yielding one vehicle whose review has no driving data — drives the page's
    /// no-data empty (web `total_drives === 0 && total_charge_sessions === 0`).
    public struct EmptyYearReviewDataSource: YearReviewDataSource {
        public init() {}

        public func loadVehicles() async throws -> [YearReviewStoryVehicle] {
            [YearReviewStoryVehicle(id: 1, displayName: "Rocinante", model: "Model 3")]
        }

        public func loadYearReview(year: Int, vehicleID: Int64) async throws -> YearReview? {
            YearReview(
                year: year,
                vehicle: YearReviewStoryVehicle(id: vehicleID, displayName: "Rocinante", model: "Model 3"),
                totalDrives: 0,
                totalDistanceM: 0,
                totalEnergyWh: 0,
                totalChargeSessions: 0,
                totalChargingCost: 0,
                gasSavings: 0,
                co2OffsetKg: 0,
                longestDrive: nil,
                mostEfficientDrive: nil,
                monthlyStats: [],
                mostActiveDayOfWeek: "",
                mostActiveHour: 0,
                avgDrivesPerWeek: 0,
                avgDistancePerDriveM: 0,
                avgEfficiencyWhKm: 0,
                superchargerPct: 0,
                dcFastPct: 0,
                acOtherPct: 0,
                avgChargeStartSoc: 0,
                comparisons: []
            )
        }
    }

    /// Preview/test seam whose review load fails — drives the error state (web query error).
    public struct FailingYearReviewDataSource: YearReviewDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [YearReviewStoryVehicle] {
            [YearReviewStoryVehicle(id: 1, displayName: "Rocinante", model: "Model 3")]
        }

        public func loadYearReview(year _: Int, vehicleID _: Int64) async throws -> YearReview? {
            throw Failure()
        }
    }
#endif
