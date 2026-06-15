import Foundation

/// A representative local seed used as the `GlancePage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it
/// is an API-response-shaped fixture (an online, locked vehicle parked at home) so the
/// surface renders its populated success state out of the box. `ratedRangeM` is in metres
/// and `insideTempC` in Celsius, exactly as the API delivers; the view converts at the
/// render boundary.
public struct SampleGlanceDataSource: GlanceDataSource {
    public init() {}

    public func loadVehicles() async throws -> [GlanceVehicle] {
        [
            GlanceVehicle(id: 1, displayName: "Rocinante", model: "Model 3"),
            GlanceVehicle(id: 2, displayName: "Tachi", model: "Model Y")
        ]
    }

    public func loadState(vehicleID _: Int64) async throws -> GlanceVehicleState? {
        GlanceVehicleState(
            state: "online",
            batteryLevel: 72,
            ratedRangeM: 384_000,
            insideTempC: 21.5,
            isLocked: true,
            isClimateOn: false
        )
    }

    public func loadLocation(vehicleID _: Int64) async throws -> GlanceLocation? {
        GlanceLocation(
            locatedAtHome: true,
            locatedAtWork: false,
            locatedAtFavorite: false,
            destinationName: nil
        )
    }

    public func send(command _: GlanceCommand, vehicleID _: Int64) async throws {}
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose state + location are unreported — drives
    /// the page's per-metric em-dash fallbacks (web `?? '—'`) while still rendering.
    public struct EmptyGlanceDataSource: GlanceDataSource {
        public init() {}

        public func loadVehicles() async throws -> [GlanceVehicle] {
            [GlanceVehicle(id: 1, displayName: "Rocinante", model: "Model 3")]
        }

        public func loadState(vehicleID _: Int64) async throws -> GlanceVehicleState? {
            nil
        }

        public func loadLocation(vehicleID _: Int64) async throws -> GlanceLocation? {
            nil
        }

        public func send(command _: GlanceCommand, vehicleID _: Int64) async throws {}
    }

    /// Preview/test seam with no vehicles — drives the no-vehicle empty state (web
    /// `!vehicle` → `GlassPanel` + `EmptyState`).
    public struct NoVehicleGlanceDataSource: GlanceDataSource {
        public init() {}

        public func loadVehicles() async throws -> [GlanceVehicle] { [] }
        public func loadState(vehicleID _: Int64) async throws -> GlanceVehicleState? { nil }
        public func loadLocation(vehicleID _: Int64) async throws -> GlanceLocation? { nil }
        public func send(command _: GlanceCommand, vehicleID _: Int64) async throws {}
    }

    /// Preview/test seam whose vehicle-list load fails — drives the error region (web
    /// `PageContainer error={vehiclesError}`).
    public struct FailingGlanceDataSource: GlanceDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [GlanceVehicle] { throw Failure() }
        public func loadState(vehicleID _: Int64) async throws -> GlanceVehicleState? { nil }
        public func loadLocation(vehicleID _: Int64) async throws -> GlanceLocation? { nil }
        public func send(command _: GlanceCommand, vehicleID _: Int64) async throws {}
    }
#endif
