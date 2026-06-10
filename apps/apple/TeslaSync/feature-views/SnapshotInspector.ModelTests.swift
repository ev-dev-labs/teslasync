//
//  SnapshotInspector.ModelTests.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  State-holder coverage for `SnapshotInspectorModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / snapshot / no-selection /
//  outside-window / failed (incl. the cached-detail survival), the diff-mode toggle (web
//  `useState`), the jump-to-last seam (web `onJumpToLast`), the error-state retry, the
//  stale auto-refresh (once, re-armed on return to live), offline keeping the cached
//  detail, and the per-phase VoiceOver summary. Driven through the in-memory source — no
//  network.
//
//  Gated on `canImport(XCTest)` for the same app-target / test-bundle membership reason as
//  the adapter tests.
//

#if canImport(XCTest)
    import Foundation
    import XCTest
    @testable import TeslaSync

    /// Identity localizer so assertions read the real copy / templates without a bundle.
    private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

    private enum SampleModelData {
        static let lastTS = "2024-05-29T18:24:00Z"

        static var now: Date {
            let formatter = ISO8601DateFormatter()
            return (formatter.date(from: lastTS) ?? Date()).addingTimeInterval(300)
        }

        static func transition(from: String = "online", to: String = "driving") -> SnapshotTransition {
            SnapshotTransition(
                id: 1, vehicleID: 1, ts: lastTS, fsmName: "vehicle",
                fromState: from, toState: to, trigger: "shift_state=D",
                details: .object([SnapshotMember("duration_in_state_ms", .number(8421))])
            )
        }

        static func snapshot(shift: String) -> SnapshotSignalSet {
            SnapshotSignalSet(
                vehicleID: 1,
                at: lastTS,
                signals: ["shift_state": SnapshotSignalEntry(value: .string(shift), source: .l1, ageMs: 120)]
            )
        }

        static func selectedInput() -> SnapshotInspectorInput {
            SnapshotInspectorInput(
                fsmType: "vehicle",
                transition: transition(),
                snapshot: snapshot(shift: "D"),
                previousSnapshot: snapshot(shift: "P"),
                inWindowCount: 4
            )
        }

        static func outsideWindowInput() -> SnapshotInspectorInput {
            SnapshotInspectorInput(fsmType: "vehicle", lastTransition: transition(), inWindowCount: 0)
        }
    }

    /// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
    /// telemetry seam under Swift 6 strict concurrency.
    private final class SpySnapshotInspectorTelemetry: SnapshotInspectorTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var storage: [String] = []

        func viewOpened(surface: String) {
            lock.lock()
            storage.append(surface)
            lock.unlock()
        }

        var surfaces: [String] {
            lock.lock()
            defer { lock.unlock() }
            return storage
        }
    }

    @MainActor final class SnapshotInspectorModelTests: XCTestCase {
        private func makeModel(
            source: InMemorySnapshotInspectorSource,
            telemetry: SpySnapshotInspectorTelemetry = SpySnapshotInspectorTelemetry()
        ) -> SnapshotInspectorModel {
            SnapshotInspectorModel(
                source: source,
                telemetry: telemetry,
                localize: passthroughLocalize,
                locale: Locale(identifier: "en_US"),
                now: { SampleModelData.now }
            )
        }

        func testStartEmitsViewOpenedOnceAndIsIdempotent() {
            let spy = SpySnapshotInspectorTelemetry()
            let source = InMemorySnapshotInspectorSource()
            let model = makeModel(source: source, telemetry: spy)
            model.start()
            model.start()
            XCTAssertEqual(spy.surfaces, ["SnapshotInspector"])
            XCTAssertEqual(source.startCount, 1)
        }

        func testLoadingThenSnapshot() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(
                    status: .loading, input: SnapshotInspectorInput(fsmType: "vehicle")
                )
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .loading)
            source.push(SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput()))
            XCTAssertEqual(model.content?.fromState, "online")
            XCTAssertEqual(model.content?.rows.count, 1)
            XCTAssertEqual(model.content?.rows.first?.changed, true)
        }

        func testLoadedNoSelectionResolvesNoSelection() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(
                    status: .loaded, input: SnapshotInspectorInput(fsmType: "vehicle", inWindowCount: 3)
                )
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .noSelection)
            XCTAssertNil(model.content)
        }

        func testLoadedEmptyWindowResolvesOutsideWindow() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.outsideWindowInput())
            )
            let model = makeModel(source: source)
            model.start()
            guard case .outsideWindow = model.phase else { return XCTFail("expected outsideWindow") }
        }

        func testFailedNoSelectionResolvesError() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(
                    status: .failed("timeout"), input: SnapshotInspectorInput(fsmType: "vehicle")
                )
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.phase, .error("timeout"))
        }

        func testFailedWithSelectionKeepsSnapshot() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput())
            )
            let model = makeModel(source: source)
            model.start()
            source.push(SnapshotInspectorUpdate(status: .failed("stale read"), input: SampleModelData.selectedInput()))
            XCTAssertNotNil(model.content)
        }

        func testDiffModeToggle() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput())
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertFalse(model.diffMode)
            model.diffMode = true
            XCTAssertTrue(model.diffMode)
        }

        func testJumpToLastRoutesThroughSeam() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.outsideWindowInput())
            )
            let model = makeModel(source: source)
            model.start()
            model.jumpToLastTransition()
            XCTAssertEqual(source.jumpCount, 1)
        }

        func testRefreshCallsSeam() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(
                    status: .failed("boom"), input: SnapshotInspectorInput(fsmType: "vehicle")
                )
            )
            let model = makeModel(source: source)
            model.start()
            model.refresh()
            XCTAssertEqual(source.refreshCount, 1)
        }

        func testStaleAutoRefreshesOnceThenReArms() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput())
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(source.refreshCount, 0)
            source.push(SnapshotInspectorUpdate(
                status: .loaded, input: SampleModelData.selectedInput(), connection: .stale
            ))
            source.push(SnapshotInspectorUpdate(
                status: .loaded, input: SampleModelData.selectedInput(), connection: .stale
            ))
            XCTAssertEqual(source.refreshCount, 1)
            source.push(SnapshotInspectorUpdate(
                status: .loaded, input: SampleModelData.selectedInput(), connection: .live
            ))
            source.push(SnapshotInspectorUpdate(
                status: .loaded, input: SampleModelData.selectedInput(), connection: .stale
            ))
            XCTAssertEqual(source.refreshCount, 2)
        }

        func testOfflineKeepsContentAndDoesNotRefresh() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput())
            )
            let model = makeModel(source: source)
            model.start()
            source.push(SnapshotInspectorUpdate(
                status: .loaded, input: SampleModelData.selectedInput(), connection: .offline
            ))
            XCTAssertEqual(model.connection, .offline)
            XCTAssertNotNil(model.content)
            XCTAssertEqual(source.refreshCount, 0)
        }

        func testAccessibilitySummaryPerPhase() {
            let source = InMemorySnapshotInspectorSource(
                initial: SnapshotInspectorUpdate(
                    status: .loading, input: SnapshotInspectorInput(fsmType: "vehicle")
                )
            )
            let model = makeModel(source: source)
            model.start()
            XCTAssertEqual(model.accessibilitySummary, "Loading…")

            source.push(SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.selectedInput()))
            XCTAssertEqual(model.accessibilitySummary, "Transition snapshot, online to driving")

            source.push(SnapshotInspectorUpdate(status: .loaded, input: SampleModelData.outsideWindowInput()))
            XCTAssertEqual(
                model.accessibilitySummary,
                "Nothing in the current window. Last transition 5m ago."
            )

            source.push(SnapshotInspectorUpdate(
                status: .failed("boom"), input: SnapshotInspectorInput(fsmType: "vehicle")
            ))
            XCTAssertEqual(model.accessibilitySummary, "Couldn't load the snapshot: boom")
        }
    }
#endif
