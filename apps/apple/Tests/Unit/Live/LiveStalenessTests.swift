import XCTest
@testable import TeslaSync

/// Pure-logic tests for the live model: the 2-minute staleness policy, the
/// five-state presentation derivation, target → SSE path mapping, the Shared-free
/// event projection, and the `LiveStatus` snapshot. No framework/async needed.
final class LiveStalenessTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 10000)

    // MARK: Staleness policy

    func testFreshWithinWindow() {
        let policy = LiveStalenessPolicy.standard
        let recent = now.addingTimeInterval(-60)
        XCTAssertFalse(policy.isStale(now: now, lastActivityAt: recent, phase: .open))
    }

    func testStaleBeyondWindow() {
        let policy = LiveStalenessPolicy.standard
        let old = now.addingTimeInterval(-121)
        XCTAssertTrue(policy.isStale(now: now, lastActivityAt: old, phase: .open))
    }

    func testStalePhaseIsAlwaysStale() {
        let policy = LiveStalenessPolicy.standard
        XCTAssertTrue(policy.isStale(now: now, lastActivityAt: now, phase: .stale))
    }

    func testNeverActiveIsNotStale() {
        let policy = LiveStalenessPolicy.standard
        XCTAssertFalse(policy.isStale(now: now, lastActivityAt: nil, phase: .connecting))
        XCTAssertNil(policy.age(now: now, lastActivityAt: nil))
    }

    func testAgeIsClampedNonNegative() {
        let policy = LiveStalenessPolicy.standard
        let future = now.addingTimeInterval(30)
        XCTAssertEqual(policy.age(now: now, lastActivityAt: future), 0)
    }

    // MARK: Presentation derivation

    func testPresentationLoadingBeforeFirstConnect() {
        let presentation = LivePresentation.derive(
            hasContent: false, hasError: false, isStale: false, hasConnectedOnce: false
        )
        XCTAssertEqual(presentation, .loading)
    }

    func testPresentationEmptyAfterConnectNoContent() {
        let presentation = LivePresentation.derive(
            hasContent: false, hasError: false, isStale: false, hasConnectedOnce: true
        )
        XCTAssertEqual(presentation, .empty)
    }

    func testPresentationErrorWhenFailedNoContent() {
        let presentation = LivePresentation.derive(
            hasContent: false, hasError: true, isStale: false, hasConnectedOnce: true
        )
        XCTAssertEqual(presentation, .error)
    }

    func testPresentationContentTakesPriorityOverError() {
        let fresh = LivePresentation.derive(
            hasContent: true, hasError: true, isStale: false, hasConnectedOnce: true
        )
        XCTAssertEqual(fresh, .fresh)
        let stale = LivePresentation.derive(
            hasContent: true, hasError: false, isStale: true, hasConnectedOnce: true
        )
        XCTAssertEqual(stale, .stale)
    }

    // MARK: Targets

    func testTargetPathsArePrefixFree() {
        XCTAssertEqual(LiveStreamTarget.fleet.path, "/events")
        XCTAssertEqual(LiveStreamTarget.vehicle(id: 7).path, "/events")
        XCTAssertEqual(LiveStreamTarget.signals(vehicleID: 7, fields: []).path, "/events?vehicle_id=7")
        XCTAssertFalse(LiveStreamTarget.fleet.path.hasPrefix("/api/v1"))
    }

    func testTargetVehicleScope() {
        XCTAssertEqual(LiveStreamTarget.vehicle(id: 9).vehicleID, 9)
        XCTAssertNil(LiveStreamTarget.fleet.vehicleID)
    }

    func testTargetDiagnosticLabelHasNoVIN() {
        let label = LiveStreamTarget.signals(vehicleID: 3, fields: ["a", "b"]).diagnosticLabel
        XCTAssertTrue(label.contains("signals#3"))
    }

    // MARK: Event projection

    func testFleetEventKindAndVehicleScope() {
        let update = LiveFleetEvent.vehicleUpdate(vehicleID: 5, signals: ["x": .number(1)])
        XCTAssertEqual(update.kind, .vehicleUpdate)
        XCTAssertEqual(update.vehicleID, 5)
        XCTAssertTrue(update.isDataBearing)

        let heartbeat = LiveFleetEvent.heartbeat(time: nil)
        XCTAssertEqual(heartbeat.kind, .heartbeat)
        XCTAssertFalse(heartbeat.isDataBearing)
        XCTAssertNil(heartbeat.vehicleID)
    }

    func testScalarFormatting() {
        XCTAssertEqual(LiveScalar.number(80).displayValue, "80")
        XCTAssertEqual(LiveScalar.number(80.5).displayValue, "80.5")
        XCTAssertEqual(LiveScalar.bool(true).doubleValue, 1)
        XCTAssertEqual(LiveScalar.null.displayValue, "—")
        XCTAssertNil(LiveScalar.string("x").doubleValue)
    }

    func testDemoReducerFoldsUpdates() {
        let envelope = LiveEnvelope<LiveFleetEvent>(
            id: "1",
            kind: .vehicleUpdate,
            receivedAt: now,
            payload: .vehicleUpdate(vehicleID: 1, signals: ["soc": .number(73)])
        )
        let result = LiveDemoSnapshot.reduce(nil, envelope)
        XCTAssertEqual(result?.updateCount, 1)
        XCTAssertEqual(result?.lastField, "soc")
        XCTAssertEqual(result?.lastValue, "73")
    }

    // MARK: Status snapshot

    func testStatusIsLiveOnlyWhenOpenAndFresh() {
        let live = LiveStatus(phase: .open, presentation: .fresh, isActive: true, isStale: false, hasError: false)
        XCTAssertTrue(live.isLive)

        let stale = LiveStatus(phase: .stale, presentation: .stale, isActive: true, isStale: true, hasError: false)
        XCTAssertFalse(stale.isLive)
        XCTAssertEqual(LiveConnectionBadge.label(for: stale), "live.status.stale")
    }

    func testStatusConnectingLabel() {
        let connecting = LiveStatus(
            phase: .reconnecting, presentation: .loading, isActive: true, isStale: false, hasError: false
        )
        XCTAssertTrue(connecting.isConnecting)
        XCTAssertEqual(LiveConnectionBadge.label(for: connecting), "live.status.reconnecting")
    }
}
