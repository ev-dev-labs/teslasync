import Foundation

/// A representative local seed used as the `VehicleListPageModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004). It is an API-response-shaped fixture
/// set (four vehicles across the FSM states — charging, driving, low-battery parked, and an offline
/// vehicle whose state does not resolve — plus one pinned row) so the fleet summary, the battery
/// panel, and the vehicle cards all render their populated success state out of the box. Every
/// measurement is SI (metres, watts, m/s); the views convert at the render boundary.
public struct SampleVehicleListDataSource: VehicleListDataSource {
    public init() {}

    public func loadVehicles() async throws -> [VehicleListItem] {
        Self.vehicles
    }

    public func fetchVehicleState(vehicleID: Int64) async throws -> VehicleStateSnapshot? {
        Self.states[vehicleID]
    }

    public func usePinned(type _: String, context _: String?) async throws -> [VehicleListPin] {
        // The low-battery "Track Toy" (id 3) is pinned to the top of the fleet list.
        [VehicleListPin(itemID: "3", position: 0)]
    }

    public func syncVehicles() async throws -> Int {
        Self.vehicles.count
    }

    public func deleteVehicle(id _: Int64) async throws {}

    public func togglePin(vehicleID _: Int64, pinned _: Bool) async throws {}

    // MARK: Fixtures (SI)

    private static let vehicles: [VehicleListItem] = [
        VehicleListItem(id: 1, vin: "5YJSA1E26HF000111", displayName: "Garage Rocket",
                        model: "Model S", trimBadging: "Plaid"),
        VehicleListItem(id: 2, vin: "5YJ3E1EA7KF000222", displayName: "Daily Driver",
                        model: "Model 3", trimBadging: "Long Range"),
        VehicleListItem(id: 3, vin: "7SAYGDEE9PF000333", displayName: "Track Toy",
                        model: "Model Y", trimBadging: "Performance"),
        VehicleListItem(id: 4, vin: "7SAXCBE60PF000444", displayName: "Road Tripper",
                        model: "Model X", trimBadging: "Long Range")
    ]

    /// Per-vehicle live state. Id 4 is absent → `fetchVehicleState` returns `nil`, exercising the
    /// offline card + the "state did not resolve" exclusion from the fleet aggregates.
    private static let states: [Int64: VehicleStateSnapshot] = [
        1: VehicleStateSnapshot(
            state: "charging", batteryLevel: 78,
            ratedRangeM: 480_000, odometerM: 23_450_000, chargerPowerW: 11_000,
            speedMps: 0, isCharging: true, isLocked: true, sentryMode: true
        ),
        2: VehicleStateSnapshot(
            state: "online", batteryLevel: 52,
            ratedRangeM: 268_000, odometerM: 51_900_000, chargerPowerW: 0,
            speedMps: 27.3, isCharging: false, isLocked: true, sentryMode: false
        ),
        3: VehicleStateSnapshot(
            state: "online", batteryLevel: 19,
            ratedRangeM: 71_000, odometerM: 8_120_000, chargerPowerW: 0,
            speedMps: 0, isCharging: false, isLocked: true, sentryMode: true
        )
    ]
}

#if DEBUG
    /// Preview/test seam yielding no vehicles — drives the web empty state
    /// (`vehicleList.length === 0` → the "No vehicles yet" EmptyState).
    public struct EmptyVehicleListDataSource: VehicleListDataSource {
        public init() {}

        public func loadVehicles() async throws -> [VehicleListItem] { [] }
        public func fetchVehicleState(vehicleID _: Int64) async throws -> VehicleStateSnapshot? { nil }
        public func usePinned(type _: String, context _: String?) async throws -> [VehicleListPin] { [] }
        public func syncVehicles() async throws -> Int { 0 }
        public func deleteVehicle(id _: Int64) async throws {}
        public func togglePin(vehicleID _: Int64, pinned _: Bool) async throws {}
    }

    /// Preview/test seam whose vehicle load fails — drives the retryable error region.
    public struct FailingVehicleListDataSource: VehicleListDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [VehicleListItem] { throw Failure() }
        public func fetchVehicleState(vehicleID _: Int64) async throws -> VehicleStateSnapshot? { nil }
        public func usePinned(type _: String, context _: String?) async throws -> [VehicleListPin] { [] }
        public func syncVehicles() async throws -> Int { throw Failure() }
        public func deleteVehicle(id _: Int64) async throws { throw Failure() }
        public func togglePin(vehicleID _: Int64, pinned _: Bool) async throws { throw Failure() }
    }
#endif
