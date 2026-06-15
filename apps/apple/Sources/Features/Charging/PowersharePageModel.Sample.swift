import Foundation

/// A representative local seed used as the `PowersharePage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it
/// is an API-response-shaped fixture (a vehicle actively sharing power to a home) so the
/// surface renders its populated success state out of the box. `powerKw` is in kW and
/// `hoursLeft` in hours, exactly as the signals are delivered; the view formats at the
/// render boundary.
public struct SamplePowershareDataSource: PowershareDataSource {
    public init() {}

    public func loadVehicles() async throws -> [PowershareVehicle] {
        [
            PowershareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            PowershareVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadSnapshot(vehicleID _: Int64) async throws -> PowershareSnapshot {
        PowershareSnapshot(
            status: "Active",
            shareType: "Home",
            stopReason: "None",
            hoursLeft: 8.5,
            powerKw: 7.4
        )
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose every signal is unreported — drives the
    /// page's per-section empty states (web `hasData === false` / `stopReason == null`).
    public struct EmptyPowershareDataSource: PowershareDataSource {
        public init() {}

        public func loadVehicles() async throws -> [PowershareVehicle] {
            [PowershareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSnapshot(vehicleID _: Int64) async throws -> PowershareSnapshot {
            .empty
        }
    }

    /// Preview/test seam whose snapshot load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingPowershareDataSource: PowershareDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [PowershareVehicle] {
            [PowershareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSnapshot(vehicleID _: Int64) async throws -> PowershareSnapshot {
            throw Failure()
        }
    }
#endif
