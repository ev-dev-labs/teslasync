import Foundation

// MARK: - Sample vehicle source (page / preview default)

/// A representative local seed used as the `LiveSignalInspectorPage` / preview default
/// until the KMP-backed vehicles feed is injected at composition time. It is NOT
/// production data — it exists so the picker renders its populated state out of the box
/// (mirroring the sibling pages' sample sources). The third entry has no display name so
/// the picker exercises the VIN fallback in `InspectorVehicle.label`.
public struct SampleLiveSignalInspectorVehicleSource: LiveSignalInspectorVehicleSource {
    public init() {}

    public func load() async throws -> [InspectorVehicle] {
        [
            InspectorVehicle(id: 1, displayName: "Model 3 Performance", vin: "5YJ3E1EA7KF000001"),
            InspectorVehicle(id: 2, displayName: "Model Y Long Range", vin: "7SAYGDEE9PF000002"),
            InspectorVehicle(id: 3, displayName: nil, vin: "5YJSA1E26HF000003")
        ]
    }
}

// MARK: - Sample live-signals factory (page / preview default)

/// Builds an in-memory `LiveSignalsTableModel` seeded with a representative snapshot so
/// the snapshot panel renders its populated state out of the box. Production replaces
/// this with a factory over the shared live signal store (web `useVehicleLiveSignals`).
/// The snapshot is deterministic per vehicle id so previews/tests are stable.
public struct SampleLiveSignalInspectorLiveSignalsFactory: LiveSignalInspectorLiveSignalsFactory {
    public init() {}

    @MainActor
    public func make(vehicleID: Int64) -> LiveSignalsTableModel {
        let source = InMemoryLiveSignalsTableSource(
            initial: LiveSignalsTableUpdate(
                status: .loaded,
                connection: .live,
                entries: Self.entries(for: vehicleID),
                updatedAt: Date()
            )
        )
        return LiveSignalsTableModel(source: source)
    }

    /// A small, realistic live snapshot covering each `LiveSignalCellValue` arm the web
    /// `renderValue` coerces (number / string / bool / compound / null) plus a bare
    /// scalar with no timestamp — so the embedded table exercises every cell path.
    static func entries(for vehicleID: Int64) -> [LiveSignalEntry] {
        let nudge = Double(vehicleID % 7)
        return [
            LiveSignalEntry(
                name: "vehicle_speed",
                payload: .envelope(value: .number(42 + nudge), timestamp: iso(secondsAgo: 3))
            ),
            LiveSignalEntry(
                name: "battery_level",
                payload: .envelope(value: .number(78), timestamp: iso(secondsAgo: 11))
            ),
            LiveSignalEntry(
                name: "charging_state",
                payload: .envelope(value: .string("Disconnected"), timestamp: iso(secondsAgo: 28))
            ),
            LiveSignalEntry(name: "locked", payload: .bare(.bool(true))),
            LiveSignalEntry(
                name: "est_battery_range_m",
                payload: .envelope(
                    value: .compound("{\"value\":312000,\"unit\":\"m\"}"),
                    timestamp: iso(secondsAgo: 64)
                )
            ),
            LiveSignalEntry(
                name: "tpms_pressure_fl",
                payload: .envelope(value: .null, timestamp: iso(secondsAgo: 6))
            )
        ]
    }

    private static func iso(secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }
}
