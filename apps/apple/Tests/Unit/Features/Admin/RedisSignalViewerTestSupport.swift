import Foundation
@testable import TeslaSync

// Shared test doubles + fixtures for the Redis Signal Viewer suites (the state-machine suite
// and the purge suite). Kept in one place so neither suite duplicates the seams or builders.

/// Stub vehicles feed (web `useVehicles`) — yields a fixed list or fails on demand.
struct StubRedisVehicleSource: RedisSignalViewerVehicleSource {
    var vehicles: [RedisSignalVehicle] = []
    var fails = false

    func loadVehicles() async throws -> [RedisSignalVehicle] {
        if fails { throw RedisStubError() }
        return vehicles
    }
}

/// Stub Redis store (web `@/api/devtools`) — returns a fixed snapshot / purge results, or fails.
struct StubRedisStore: RedisSignalStore {
    var snapshot: RedisSignalsSnapshot?
    var loadFails = false
    var purgeResult = RedisPurgeResult(purged: true)
    var purgeAllResult = RedisPurgeAllResult(purged: 3, scanned: 3, limit: 1000, hasMore: false)
    var purgeFails = false

    func loadSignals(vehicleID: Int64) async throws -> RedisSignalsSnapshot {
        if loadFails { throw RedisStubError() }
        return snapshot ?? RedisSignalsSnapshot(vehicleID: vehicleID, signalCount: 0, rows: [])
    }

    func purge(vehicleID _: Int64) async throws -> RedisPurgeResult {
        if purgeFails { throw RedisStubError() }
        return purgeResult
    }

    func purgeAll() async throws -> RedisPurgeAllResult {
        if purgeFails { throw RedisStubError() }
        return purgeAllResult
    }
}

struct RedisStubError: Error {}

/// Fixture builders shared by the suites.
enum RedisFixtures {
    static func vehicles() -> [RedisSignalVehicle] {
        [
            RedisSignalVehicle(id: 1, displayName: "Model 3", vin: "VIN1"),
            RedisSignalVehicle(id: 2, displayName: nil, vin: "VIN2")
        ]
    }

    static func snapshot(vehicleID: Int64 = 1) -> RedisSignalsSnapshot {
        let rows = [
            RedisSignalRow(name: "battery_level", value: .number(78)),
            RedisSignalRow(name: "charge_state", value: .string("Disconnected")),
            RedisSignalRow(name: "locked", value: .boolean(true)),
            RedisSignalRow(name: "latitude", value: .number(37.42)),
            RedisSignalRow(name: "inside_temp", value: .number(21.5))
        ]
        return RedisSignalsSnapshot(
            vehicleID: vehicleID,
            signalCount: rows.count,
            rows: rows,
            meta: RedisSignalsMeta(
                liveSignalStoreMode: "hybrid",
                redisKey: "vehicle:\(vehicleID):signals",
                vehicleVIN: "VIN1"
            )
        )
    }

    @MainActor
    static func model(
        vehicles list: [RedisSignalVehicle]? = nil,
        vehiclesFail: Bool = false,
        snapshot snap: RedisSignalsSnapshot? = nil,
        loadFails: Bool = false,
        purgeResult: RedisPurgeResult = RedisPurgeResult(purged: true),
        purgeAllResult: RedisPurgeAllResult = RedisPurgeAllResult(purged: 3, scanned: 3, limit: 1000, hasMore: false),
        purgeFails: Bool = false
    ) -> RedisSignalViewerPageModel {
        RedisSignalViewerPageModel(
            vehicleSource: StubRedisVehicleSource(vehicles: list ?? vehicles(), fails: vehiclesFail),
            store: StubRedisStore(
                snapshot: snap,
                loadFails: loadFails,
                purgeResult: purgeResult,
                purgeAllResult: purgeAllResult,
                purgeFails: purgeFails
            )
        )
    }
}
