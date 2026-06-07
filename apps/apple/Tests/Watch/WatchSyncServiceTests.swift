import Foundation
import XCTest
@testable import TeslaSyncWatch

/// Verifies the phone-side coordinator's context mirroring and command relay using
/// the fake messenger — no live WatchConnectivity required.
@MainActor
final class WatchSyncServiceTests: XCTestCase {
    func testStartPushesContext() {
        let messenger = FakeWatchMessenger()
        let service = PhoneWatchSyncService(makeMessenger: { _ in messenger })
        service.start()
        XCTAssertEqual(messenger.contexts.count, 1)
        XCTAssertNotNil(WatchSyncEnvelope.payload(from: messenger.contexts.last ?? [:]))
    }

    func testUpdatePushesSnapshotAndSettings() {
        let messenger = FakeWatchMessenger()
        let service = PhoneWatchSyncService(makeMessenger: { _ in messenger })
        service.start()
        let snap = makeVehicleSnapshot(generatedAt: Date(timeIntervalSince1970: 1_700_000_000))
        service.update(
            snapshot: snap,
            settings: WatchSyncSettings(measurementSystem: .imperial),
            isAuthenticated: true
        )
        let payload = WatchSyncEnvelope.payload(from: messenger.contexts.last ?? [:])
        XCTAssertEqual(payload?.snapshot?.vehicle?.batteryDisplay, "72%")
        XCTAssertEqual(payload?.settings.measurementSystem, .imperial)
        XCTAssertEqual(payload?.isAuthenticated, true)
    }

    func testRefreshRequestPushesContext() {
        let messenger = FakeWatchMessenger()
        let service = PhoneWatchSyncService(makeMessenger: { _ in messenger })
        service.start()
        let before = messenger.contexts.count
        service.didReceiveRefreshRequest()
        XCTAssertEqual(messenger.contexts.count, before + 1)
    }

    func testOpenOnPhoneInvokesRoute() {
        var opened: WatchDeepLink?
        let service = PhoneWatchSyncService(
            openRoute: { opened = $0 },
            makeMessenger: { _ in FakeWatchMessenger() }
        )
        service.start()
        service.didReceiveCommandRequest(WatchCommandRequest(action: .openOnPhone))
        XCTAssertEqual(opened, .dashboard)
    }

    func testVehicleCommandRunsHandlerAndRelaysResult() async {
        let messenger = FakeWatchMessenger()
        let service = PhoneWatchSyncService(
            commandHandler: { request in
                WatchCommandResult(requestID: request.id, success: true, outcomeKey: "command.outcome.success")
            },
            makeMessenger: { _ in messenger }
        )
        service.start()
        let request = WatchCommandRequest(id: "abc", action: .lockDoors, requestedAt: Date(timeIntervalSince1970: 1))
        service.didReceiveCommandRequest(request)

        // The relay runs in a detached main-actor Task; let it complete.
        for _ in 0 ..< 200 where messenger.messages.isEmpty {
            await Task.yield()
        }
        let result = WatchSyncEnvelope.commandResult(from: messenger.messages.last ?? [:])
        XCTAssertEqual(result?.requestID, "abc")
        XCTAssertEqual(result?.success, true)
        XCTAssertEqual(result?.outcomeKey, "command.outcome.success")
    }
}
