//
//  FSMStateDiagram.ModelTests.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  Unit coverage for the FSMStateDiagram view-model wiring (P1/S8 + P1/S11):
//    • start emits the `view.opened` diagnostics event + starts the source (idempotent).
//    • stop / refresh delegate to the source.
//    • a pushed snapshot re-resolves the projection (empty / data / latest state).
//    • the stale transition fires exactly one auto-refresh (and not again while stale).
//    • the web-prop convenience init resolves to data without the shared core.
//
//  Driven by the in-memory source + a Sendable telemetry spy; no network, no real store.
//

import Foundation
import XCTest
@testable import TeslaSync

@MainActor final class FSMStateDiagramModelTests: XCTestCase {
    /// Records the surfaces reported through the P1/S11 telemetry seam.
    private final class SpyTelemetry: FSMStateDiagramTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var storage: [String] = []

        var surfaces: [String] {
            lock.withLock { storage }
        }

        func viewOpened(surface: String) {
            lock.withLock { storage.append(surface) }
        }
    }

    func testStartEmitsTelemetryAndIsIdempotent() {
        let spy = SpyTelemetry()
        let source = InMemoryFSMStateDiagramSource(initial: FSMStateDiagramInput(fsmType: "vehicle"))
        let model = FSMStateDiagramModel(source: source, telemetry: spy)

        model.start()
        XCTAssertEqual(spy.surfaces, ["FSMStateDiagram"])
        XCTAssertEqual(source.startCount, 1)

        model.start()
        XCTAssertEqual(source.startCount, 1, "start must be idempotent")
        XCTAssertEqual(spy.surfaces, ["FSMStateDiagram"])
    }

    func testStopAndRefreshDelegateToSource() {
        let source = InMemoryFSMStateDiagramSource()
        let model = FSMStateDiagramModel(source: source)

        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testPushedSnapshotReResolves() {
        let source = InMemoryFSMStateDiagramSource()
        let model = FSMStateDiagramModel(source: source)
        XCTAssertEqual(model.phase, .loading)

        source.push(FSMStateDiagramInput(fsmType: "all"))
        XCTAssertEqual(model.phase, .empty)

        source.push(FSMStateDiagramInput(
            fsmType: "vehicle",
            transitions: [
                FSMTransition(
                    id: 1,
                    vehicleID: 1,
                    ts: "2026-01-01T00:00:00Z",
                    fsmName: "vehicle",
                    fromState: "online",
                    toState: "driving"
                )
            ]
        ))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.latestState, "driving")
    }

    func testStaleTransitionFiresOneShotAutoRefresh() {
        let source = InMemoryFSMStateDiagramSource()
        let model = FSMStateDiagramModel(source: source)

        source.push(FSMStateDiagramInput(fsmType: "vehicle", connection: .live))
        XCTAssertEqual(source.refreshCount, 0)

        source.push(FSMStateDiagramInput(fsmType: "vehicle", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(FSMStateDiagramInput(fsmType: "vehicle", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "must not re-fire while staying stale")
        XCTAssertEqual(model.connection, .stale)
    }

    func testWebPropInitResolvesData() {
        let model = FSMStateDiagramModel(input: FSMStateDiagramInput(fsmType: "alert_cooldown"))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.nodes.count, 3)
    }
}
