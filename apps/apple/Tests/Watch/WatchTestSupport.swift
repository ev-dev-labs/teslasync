import Foundation
import XCTest
@testable import TeslaSyncWatch

/// A `WatchMessenger` double that records what the model sends, so the live
/// WatchConnectivity layer never has to run in a unit test.
@MainActor
final class FakeWatchMessenger: WatchMessenger {
    var reachable = false
    private(set) var contexts: [[String: Any]] = []
    private(set) var messages: [[String: Any]] = []

    var isReachable: Bool {
        reachable
    }

    func updateContext(_ context: [String: Any]) {
        contexts.append(context)
    }

    func sendMessage(_ message: [String: Any]) {
        messages.append(message)
    }

    var refreshRequestCount: Int {
        messages.count(where: { WatchSyncEnvelope.isRefreshRequest($0) })
    }

    var lastCommandRequest: WatchCommandRequest? {
        messages.compactMap { WatchSyncEnvelope.commandRequest(from: $0) }.last
    }
}

/// An isolated `UserDefaults` suite per test so cache reads/writes never collide.
func makeEphemeralDefaults() -> UserDefaults {
    let suite = "watch-tests-" + UUID().uuidString
    return UserDefaults(suiteName: suite) ?? .standard
}

/// A snapshot store pointed at a throwaway temp directory.
func makeTempSnapshotStore() -> WidgetSnapshotStore {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("watch-snap-" + UUID().uuidString, isDirectory: true)
    return WidgetSnapshotStore(directory: dir)
}

/// Builds a vehicle snapshot with explicit climate/security for deterministic tests.
func makeVehicleSnapshot(
    generatedAt: Date,
    isCharging: Bool = false,
    isPluggedIn: Bool = false,
    finishBy: Date? = nil,
    isLocked: Bool? = true,
    isClimateOn: Bool? = false,
    isSentryOn: Bool? = true,
    insideTemp: String? = "21°"
) -> TeslaSyncWidgetSnapshot {
    TeslaSyncWidgetSnapshot(
        generatedAt: generatedAt,
        vehicle: VehicleStatusSummary(
            vehicleName: "Model 3",
            batteryFraction: 0.72,
            batteryDisplay: "72%",
            rangeDisplay: "243 km",
            isCharging: isCharging,
            isPluggedIn: isPluggedIn,
            locationLabel: "Home",
            sampledAt: generatedAt
        ),
        charging: finishBy.map { finish in
            ChargingSummary(
                isActive: true,
                batteryFraction: 0.72,
                batteryDisplay: "72%",
                powerDisplay: "11 kW",
                addedDisplay: "18 kWh",
                finishBy: finish,
                sampledAt: generatedAt
            )
        },
        climateSecurity: (isLocked == nil && isClimateOn == nil && isSentryOn == nil)
            ? nil
            : ClimateSecuritySummary(
                isLocked: isLocked ?? false,
                isClimateOn: isClimateOn ?? false,
                isSentryOn: isSentryOn ?? false,
                insideTempDisplay: insideTemp,
                sampledAt: generatedAt
            )
    )
}

func makePayload(
    snapshot: TeslaSyncWidgetSnapshot?,
    settings: WatchSyncSettings = .default,
    isAuthenticated: Bool,
    generatedAt: Date
) -> WatchSyncPayload {
    WatchSyncPayload(
        snapshot: snapshot,
        settings: settings,
        isAuthenticated: isAuthenticated,
        generatedAt: generatedAt
    )
}
