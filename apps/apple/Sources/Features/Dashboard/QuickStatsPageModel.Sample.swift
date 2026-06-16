import Foundation

/// A representative local seed used as the `QuickStatsPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (one online vehicle plus a populated 30-day summary) so the surface
/// renders its populated success state out of the box. `totalDistanceM` is metres and
/// `totalEnergyWh` watt-hours, exactly as the API delivers; the view converts at the render boundary.
public struct SampleQuickStatsPageDataSource: QuickStatsPageDataSource {
    public init() {}

    public func loadVehicles() async throws -> [QuickStatsPageVehicle] {
        [
            QuickStatsPageVehicle(id: 1, displayName: "Rocinante", model: "Model 3"),
            QuickStatsPageVehicle(id: 2, displayName: "Tachi", model: "Model Y")
        ]
    }

    public func loadSummary(days _: Int) async throws -> QuickStatsPageSummary {
        QuickStatsPageSummary(
            totalDistanceM: 12_500_000,
            totalDrives: 342,
            totalEnergyWh: 2_450_000,
            totalCost: 511
        )
    }

    public func loadState(vehicleID _: Int64) async throws -> QuickStatsPageVehicleState? {
        QuickStatsPageVehicleState(state: "online")
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose state is unreported + a zeroed summary — drives the
    /// subtitle's `offline` fallback and the metric cards' `?? 0` zeros while still rendering.
    public struct EmptyQuickStatsPageDataSource: QuickStatsPageDataSource {
        public init() {}

        public func loadVehicles() async throws -> [QuickStatsPageVehicle] {
            [QuickStatsPageVehicle(id: 1, displayName: "Rocinante", model: "Model 3")]
        }

        public func loadSummary(days _: Int) async throws -> QuickStatsPageSummary {
            .zero
        }

        public func loadState(vehicleID _: Int64) async throws -> QuickStatsPageVehicleState? {
            nil
        }
    }

    /// Preview/test seam with no vehicles — drives the no-vehicle empty card (web `!vehicle` →
    /// `GlassPanel` + `EmptyState`) while the metric cards still render from the loaded summary.
    public struct NoVehicleQuickStatsPageDataSource: QuickStatsPageDataSource {
        public init() {}

        public func loadVehicles() async throws -> [QuickStatsPageVehicle] {
            []
        }

        public func loadSummary(days _: Int) async throws -> QuickStatsPageSummary {
            QuickStatsPageSummary(totalDistanceM: 4_200_000, totalDrives: 88, totalEnergyWh: 760_000, totalCost: 143)
        }

        public func loadState(vehicleID _: Int64) async throws -> QuickStatsPageVehicleState? {
            nil
        }
    }

    /// Preview/test seam whose vehicle-list load fails — drives the error region (web
    /// `PageContainer error={vehiclesError || analyticsError}`).
    public struct FailingQuickStatsPageDataSource: QuickStatsPageDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [QuickStatsPageVehicle] {
            throw Failure()
        }

        public func loadSummary(days _: Int) async throws -> QuickStatsPageSummary {
            throw Failure()
        }

        public func loadState(vehicleID _: Int64) async throws -> QuickStatsPageVehicleState? {
            nil
        }
    }
#endif
