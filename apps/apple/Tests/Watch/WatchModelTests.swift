import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Behavioural tests for the watch model: hydration, payload ingestion, honest
/// freshness, command gating/relay, and reachability — all without the live
/// WatchConnectivity layer.
@MainActor
final class WatchModelTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeModel(
        cacheDefaults: UserDefaults,
        snapStore: WidgetSnapshotStore,
        reload: @escaping () -> Void,
        messenger: FakeWatchMessenger
    ) -> WatchModel {
        WatchModel(
            cache: WatchCacheStore(defaults: cacheDefaults),
            snapshotStore: snapStore,
            policy: .standard,
            now: { [now = self.now] in now },
            reloadComplications: reload,
            makeMessenger: { _ in messenger }
        )
    }

    func testStartRequestsRefresh() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        XCTAssertEqual(messenger.refreshRequestCount, 1)
    }

    func testIngestUpdatesStateAndPersists() {
        let cacheDefaults = makeEphemeralDefaults()
        let snap = makeTempSnapshotStore()
        var reloads = 0
        let model = makeModel(
            cacheDefaults: cacheDefaults,
            snapStore: snap,
            reload: { reloads += 1 },
            messenger: FakeWatchMessenger()
        )
        let payload = makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            settings: WatchSyncSettings(measurementSystem: .imperial),
            isAuthenticated: true,
            generatedAt: now
        )
        model.didReceivePayload(payload)

        XCTAssertNotNil(model.snapshot?.vehicle)
        XCTAssertTrue(model.isAuthenticated)
        XCTAssertEqual(model.lastUpdated, now)
        XCTAssertEqual(model.settings.measurementSystem, .imperial)
        XCTAssertEqual(model.freshness, .fresh)
        XCTAssertEqual(WatchCacheStore(defaults: cacheDefaults).load(), payload)
        XCTAssertNotNil(snap.load()?.vehicle)
        XCTAssertEqual(reloads, 1)
    }

    func testOlderPayloadIsIgnored() {
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: FakeWatchMessenger()
        )
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        ))
        model.didReceivePayload(makePayload(
            snapshot: nil,
            isAuthenticated: false,
            generatedAt: now.addingTimeInterval(-100)
        ))
        XCTAssertNotNil(model.snapshot?.vehicle, "a stale, older payload must not overwrite newer data")
        XCTAssertTrue(model.isAuthenticated)
    }

    func testStaleFreshness() {
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: FakeWatchMessenger()
        )
        let age = now.addingTimeInterval(-600)
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: age),
            isAuthenticated: true,
            generatedAt: age
        ))
        XCTAssertEqual(model.freshness, .stale)
    }

    func testOfflineFreshness() {
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: FakeWatchMessenger()
        )
        let age = now.addingTimeInterval(-4000)
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: age),
            isAuthenticated: true,
            generatedAt: age
        ))
        XCTAssertEqual(model.freshness, .offline)
    }

    func testCommandNeedsAuth() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: false,
            generatedAt: now
        ))
        let before = messenger.messages.count
        model.perform(.lockDoors)
        XCTAssertEqual(model.errorKey, "command.outcome.needsAuth")
        XCTAssertNil(model.pendingActionID)
        XCTAssertEqual(messenger.messages.count, before, "no command may be relayed without a session")
    }

    func testAuthedCommandRelaysAndPends() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        ))
        model.perform(.lockDoors)
        XCTAssertEqual(messenger.lastCommandRequest?.action, .lockDoors)
        XCTAssertEqual(messenger.lastCommandRequest?.id, model.pendingActionID)
    }

    func testCommandFailureSurfacedAndClearsPending() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        ))
        model.perform(.wake)
        let id = try? XCTUnwrap(model.pendingActionID)
        model.didReceiveCommandResult(WatchCommandResult(
            requestID: id ?? "",
            success: false,
            outcomeKey: "command.outcome.unavailable"
        ))
        XCTAssertNil(model.pendingActionID)
        XCTAssertEqual(model.lastOutcomeKey, "command.outcome.unavailable")
        XCTAssertEqual(model.errorKey, "command.outcome.unavailable")
    }

    func testCommandSuccessRequestsRefresh() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        ))
        model.perform(.flashLights)
        let id = model.pendingActionID ?? ""
        let before = messenger.refreshRequestCount
        model.didReceiveCommandResult(WatchCommandResult(
            requestID: id,
            success: true,
            outcomeKey: "command.outcome.success"
        ))
        XCTAssertNil(model.pendingActionID)
        XCTAssertNil(model.errorKey)
        XCTAssertEqual(messenger.refreshRequestCount, before + 1)
    }

    func testReachabilityTriggersRefresh() {
        let messenger = FakeWatchMessenger()
        let model = makeModel(
            cacheDefaults: makeEphemeralDefaults(),
            snapStore: makeTempSnapshotStore(),
            reload: {},
            messenger: messenger
        )
        model.start()
        let before = messenger.refreshRequestCount
        model.reachabilityDidChange(true)
        XCTAssertTrue(model.isReachable)
        XCTAssertEqual(messenger.refreshRequestCount, before + 1)
    }

    func testHydrateFromCacheDoesNotReload() {
        let cacheDefaults = makeEphemeralDefaults()
        let payload = makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        )
        WatchCacheStore(defaults: cacheDefaults).save(payload)
        var reloads = 0
        let model = makeModel(
            cacheDefaults: cacheDefaults,
            snapStore: makeTempSnapshotStore(),
            reload: { reloads += 1 },
            messenger: FakeWatchMessenger()
        )
        XCTAssertNotNil(model.snapshot?.vehicle)
        XCTAssertEqual(model.lastUpdated, now)
        XCTAssertTrue(model.isAuthenticated)
        XCTAssertEqual(reloads, 0)
    }

    func testClearCache() {
        let cacheDefaults = makeEphemeralDefaults()
        var reloads = 0
        let model = makeModel(
            cacheDefaults: cacheDefaults,
            snapStore: makeTempSnapshotStore(),
            reload: { reloads += 1 },
            messenger: FakeWatchMessenger()
        )
        model.didReceivePayload(makePayload(
            snapshot: makeVehicleSnapshot(generatedAt: now),
            isAuthenticated: true,
            generatedAt: now
        ))
        let reloadsAfterIngest = reloads
        model.clearCache()
        XCTAssertNil(model.snapshot)
        XCTAssertNil(model.lastUpdated)
        XCTAssertNil(WatchCacheStore(defaults: cacheDefaults).load())
        XCTAssertEqual(reloads, reloadsAfterIngest + 1)
    }
}
