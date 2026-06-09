//
//  FSMHealthPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  State-holder coverage for the FSMHealthPanel surface (`FSMHealthPanelModel`): the phase
//  across loading / loaded-healthy / loaded-alerts / failed, the derived alerts + the
//  exposed `flapIds` (web `computeFlapIds`), the P1/S11 `view.opened` telemetry (exactly
//  once), the stale auto-refresh (exactly once, re-armed on returning to live), offline
//  keeping the cached alerts, and the retry / stop plumbing. Driven through an in-memory
//  source with an injected fixed clock — no network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor final class FSMHealthPanelModelTests: XCTestCase {
    private let nowMs: Int64 = 1_700_000_400_000
    private var now: Date {
        Date(timeIntervalSince1970: Double(nowMs) / 1000)
    }

    /// A flap burst (six `vehicle` transitions in 50s) + a stuck `drive_session` (5h old).
    private var alertingTransitions: [FSMHealthTransitionInput] {
        var rows = (0 ..< 6).map { offset in
            FSMHealthTransitionInput(
                id: 1 + offset,
                vehicleId: 1,
                timestamp: now.addingTimeInterval(TimeInterval(-600 + offset * 10)),
                fsmName: "vehicle",
                toState: "online"
            )
        }
        rows.append(FSMHealthTransitionInput(
            id: 100, vehicleId: 1, timestamp: now.addingTimeInterval(-5 * 3600),
            fsmName: "drive_session", toState: "active"
        ))
        return rows
    }

    private var healthyTransitions: [FSMHealthTransitionInput] {
        [FSMHealthTransitionInput(
            id: 1, vehicleId: 1, timestamp: now.addingTimeInterval(-3600), fsmName: "vehicle", toState: "online"
        )]
    }

    private func makeModel(
        initial: FSMHealthPanelUpdate?,
        telemetry: FSMHealthPanelTelemetry = SpyFSMHealthPanelTelemetry()
    ) -> (FSMHealthPanelModel, InMemoryFSMHealthPanelSource) {
        let source = InMemoryFSMHealthPanelSource(initial: initial)
        let model = FSMHealthPanelModel(
            source: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US_POSIX"),
            now: { [now] in now }
        )
        return (model, source)
    }

    private func alertingUpdate(connection: FSMHealthConnection = .live) -> FSMHealthPanelUpdate {
        FSMHealthPanelUpdate(status: .loaded, transitions: alertingTransitions, connection: connection)
    }

    func testLoadedAlertsProjectsPhaseAndAlerts() {
        let (model, source) = makeModel(initial: alertingUpdate())
        model.start()
        XCTAssertEqual(model.phase, .alerts(model.alerts))
        XCTAssertEqual(model.alerts.map(\.kind), [.flap, .stuck])
        XCTAssertEqual(model.alerts.first?.count, 6)
        XCTAssertEqual(model.flapIds, [1, 2, 3, 4, 5, 6])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedHealthyResolvesHealthyPhase() {
        let (model, _) = makeModel(
            initial: FSMHealthPanelUpdate(status: .loaded, transitions: healthyTransitions)
        )
        model.start()
        XCTAssertEqual(model.phase, .healthy)
        XCTAssertTrue(model.alerts.isEmpty)
        XCTAssertTrue(model.flapIds.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: FSMHealthPanelUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: FSMHealthPanelUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyFSMHealthPanelTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FSMHealthPanelSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(alertingUpdate(connection: .stale))
        source.push(alertingUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(alertingUpdate(connection: .stale))
        source.push(alertingUpdate(connection: .live))
        source.push(alertingUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedAlertsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(alertingUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .alerts(model.alerts))
        XCTAssertEqual(model.alerts.map(\.kind), [.flap, .stuck])
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: FSMHealthPanelUpdate(status: .failed("x")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyFSMHealthPanelTelemetry: FSMHealthPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
