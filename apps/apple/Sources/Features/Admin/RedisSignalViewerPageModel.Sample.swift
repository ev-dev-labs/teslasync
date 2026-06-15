import Foundation

// MARK: - Sample vehicle source (page / preview default)

/// A representative local seed used as the `RedisSignalViewerPage` / preview default until
/// the KMP-backed vehicles feed is injected at composition time. NOT production data — it
/// exists so the picker renders its populated state out of the box (mirroring the sibling
/// pages' sample sources). The third entry has no display name so the picker exercises the
/// VIN fallback in `RedisSignalVehicle.label`.
public struct SampleRedisSignalViewerVehicleSource: RedisSignalViewerVehicleSource {
    public init() {}

    public func loadVehicles() async throws -> [RedisSignalVehicle] {
        [
            RedisSignalVehicle(id: 1, displayName: "Model 3 Performance", vin: "5YJ3E1EA7KF000001"),
            RedisSignalVehicle(id: 2, displayName: "Model Y Long Range", vin: "7SAYGDEE9PF000002"),
            RedisSignalVehicle(id: 3, displayName: nil, vin: "5YJSA1E26HF000003")
        ]
    }
}

// MARK: - Sample redis store (page / preview default)

/// An in-memory `RedisSignalStore` seeded with a representative snapshot so the table renders
/// its populated state out of the box, and whose purge calls succeed. Production replaces this
/// with a store over the shared KMP dev-tools client (web `@/api/devtools`). The snapshot is
/// deterministic per vehicle id so previews/tests are stable, and it covers every category,
/// every value type, and a masked location signal.
public struct SampleRedisSignalStore: RedisSignalStore {
    public init() {}

    public func loadSignals(vehicleID: Int64) async throws -> RedisSignalsSnapshot {
        let rows = Self.rows(for: vehicleID)
        return RedisSignalsSnapshot(
            vehicleID: vehicleID,
            signalCount: rows.count,
            rows: rows,
            meta: RedisSignalsMeta(
                liveSignalStoreMode: "hybrid",
                redisKey: "vehicle:\(vehicleID):signals",
                redisFieldCount: rows.count,
                l1SignalCount: rows.count,
                l1LastSeenAt: Date().addingTimeInterval(-12),
                l2LastSeenAt: Date().addingTimeInterval(-9),
                vehicleVIN: "5YJ3E1EA7KF00000\(vehicleID)"
            )
        )
    }

    public func purge(vehicleID _: Int64) async throws -> RedisPurgeResult {
        RedisPurgeResult(purged: true)
    }

    public func purgeAll() async throws -> RedisPurgeAllResult {
        RedisPurgeAllResult(purged: 3, scanned: 3, limit: 1000, hasMore: false)
    }

    /// A small, realistic snapshot covering every category, every value type, and a masked
    /// location pair — so the table exercises the number/string/boolean cell colors, the
    /// masked-coordinate path, and each category badge.
    static func rows(for vehicleID: Int64) -> [RedisSignalRow] {
        let nudge = Double(vehicleID % 5)
        return [
            RedisSignalRow(name: "battery_level", value: .number(78 - nudge)),
            RedisSignalRow(name: "battery_range", value: .number(312 - nudge)),
            RedisSignalRow(name: "bms_state", value: .string("balancing")),
            RedisSignalRow(name: "charge_state", value: .string("Disconnected")),
            RedisSignalRow(name: "charger_power", value: .number(0)),
            RedisSignalRow(name: "dc_charging", value: .boolean(false)),
            RedisSignalRow(name: "vehicle_speed", value: .number(42 + nudge)),
            RedisSignalRow(name: "odometer", value: .number(18342 + nudge)),
            RedisSignalRow(name: "latitude", value: .number(37.422998)),
            RedisSignalRow(name: "longitude", value: .number(-122.084097)),
            RedisSignalRow(name: "inside_temp", value: .number(21.5)),
            RedisSignalRow(name: "hvac_on", value: .boolean(true)),
            RedisSignalRow(name: "locked", value: .boolean(true)),
            RedisSignalRow(name: "software_version", value: .string("2024.14.9"))
        ]
    }
}
