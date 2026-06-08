//
//  WindowStatusDetail.Tests.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  Unit coverage for the WindowStatusDetail surface:
//    • Adapter — `parseWindowState` parity across every wire variant (string / "0" /
//      vent / open / boolean / absent), the cell derivation, the closed/open summary,
//      and the render-phase resolution.
//    • State holder — the `WindowStatusModel` wiring, the P1/S11 `view.opened`
//      telemetry, and the stale→auto-refresh / offline / live-reset behavior.
//    • Accessibility — the VoiceOver cell summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryWindowStatusSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection: parseWindowState (port of web parseWindowState)

@MainActor
final class WindowStatusParseTests: XCTestCase {
    func testClosedVariants() {
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("Closed")), .closed)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("closed")), .closed)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("0")), .closed)
    }

    func testVentingMatchesSubstring() {
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("Vented")), .venting)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("vent")), .venting)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("PartiallyVented")), .venting)
    }

    func testOpenVariants() {
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("Open")), .open)
        // Faithful to the web ladder: any non-empty value that is not closed/"0"/vent
        // falls through `lower !== '0'` to Open (the trailing Unknown is unreachable here).
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("ajar")), .open)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("1")), .open)
    }

    func testUnknownForEmptyBooleanAndAbsent() {
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.string("")), .unknown)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.bool(true)), .unknown)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.bool(false)), .unknown)
        XCTAssertEqual(WindowStatusProjection.parseWindowState(.absent), .unknown)
    }
}

// MARK: - Projection: cells / phase / summary

@MainActor
final class WindowStatusProjectionTests: XCTestCase {
    func testNilEventYieldsFourUnknownCellsInOrder() {
        let cells = WindowStatusProjection.cells(from: nil)
        XCTAssertEqual(cells.map(\.position), [.fd, .fp, .rd, .rp])
        XCTAssertTrue(cells.allSatisfy { $0.state == .unknown })
    }

    func testCellsDeriveStatePerPosition() {
        let event = WindowStatusEvent(
            frontDriver: .string("Closed"),
            frontPassenger: .string("Vented"),
            rearDriver: .string("Open"),
            rearPassenger: .absent
        )
        let cells = WindowStatusProjection.cells(from: event)
        XCTAssertEqual(cells.map(\.state), [.closed, .venting, .open, .unknown])
    }

    func testResolvePhaseAcrossStatuses() {
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.loading, hasEvent: false), .loading)
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.loading, hasEvent: true), .loading)
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.failed("boom"), hasEvent: true), .error("boom"))
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.empty, hasEvent: false), .empty)
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.loaded, hasEvent: false), .empty)
        XCTAssertEqual(WindowStatusProjection.resolvePhase(.loaded, hasEvent: true), .data)
    }

    func testAllClosedAndNotClosedCount() {
        let allShut = WindowStatusProjection.cells(from: WindowStatusEvent(
            frontDriver: .string("Closed"),
            frontPassenger: .string("0"),
            rearDriver: .string("closed"),
            rearPassenger: .string("Closed")
        ))
        XCTAssertTrue(WindowStatusProjection.allClosed(allShut))
        XCTAssertEqual(WindowStatusProjection.notClosedCount(allShut), 0)

        let mixed = WindowStatusProjection.cells(from: WindowStatusEvent(
            frontDriver: .string("Closed"),
            frontPassenger: .string("Vented"),
            rearDriver: .string("Open"),
            rearPassenger: .absent
        ))
        XCTAssertFalse(WindowStatusProjection.allClosed(mixed))
        // fp (venting) + rd (open) + rp (unknown) are all not Closed.
        XCTAssertEqual(WindowStatusProjection.notClosedCount(mixed), 3)
    }

    func testAllClosedFalseForEmpty() {
        XCTAssertFalse(WindowStatusProjection.allClosed([]))
    }
}

// MARK: - State holder: wiring + telemetry + freshness

@MainActor
final class WindowStatusModelTests: XCTestCase {
    private func makeModel(
        _ input: WindowStatusInput,
        telemetry: WindowStatusTelemetry = OSLogWindowStatusTelemetry()
    ) -> (WindowStatusModel, InMemoryWindowStatusSource) {
        let source = InMemoryWindowStatusSource(initial: input)
        let model = WindowStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func closedEvent() -> WindowStatusEvent {
        WindowStatusEvent(
            frontDriver: .string("Closed"),
            frontPassenger: .string("Closed"),
            rearDriver: .string("Closed"),
            rearPassenger: .string("Closed")
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyWindowStatusTelemetry()
        let (model, source) = makeModel(
            WindowStatusInput(status: .loaded, event: closedEvent(), connection: .live),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cells.count, 4)
        XCTAssertTrue(model.allClosed)
        XCTAssertEqual(model.notClosedCount, 0)
        XCTAssertEqual(spy.surfaces, [WindowStatusDetail.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testEmptyWhenLoadedWithoutEvent() {
        let (model, _) = makeModel(WindowStatusInput(status: .loaded, event: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cells.count, 4)
        XCTAssertTrue(model.cells.allSatisfy { $0.state == .unknown })
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WindowStatusInput(status: .loaded, event: closedEvent()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(WindowStatusInput(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        let event = WindowStatusEvent(
            frontDriver: .string("Closed"),
            frontPassenger: .string("Open"),
            rearDriver: .string("Vented"),
            rearPassenger: .string("Closed")
        )
        source.push(WindowStatusInput(status: .loaded, event: event, connection: .live))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cells.map(\.state), [.closed, .open, .venting, .closed])
        XCTAssertEqual(model.notClosedCount, 2)
    }

    func testStaleTriggersOneGuardedAutoRefreshAndLiveResets() {
        let (model, source) = makeModel(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot must not re-trigger the guarded auto-refresh.
        source.push(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Returning live resets the guard so a later stale episode refreshes once more.
        source.push(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .live))
        source.push(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .live))
        model.start()
        source.push(WindowStatusInput(status: .loaded, event: closedEvent(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility summary content

@MainActor
final class WindowStatusAccessibilityTests: XCTestCase {
    func testCellSummaryCombinesPositionAndState() {
        let summary = WindowStatusAccessibility.cellSummary(positionLabel: "Front Driver", stateLabel: "Closed")
        XCTAssertEqual(summary, "Front Driver, Closed")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWindowStatusTelemetry: WindowStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
