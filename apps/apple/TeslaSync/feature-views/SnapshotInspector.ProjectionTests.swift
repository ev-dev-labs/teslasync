//
//  SnapshotInspector.ProjectionTests.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  Pure projection coverage for the SnapshotInspector surface — the faithful render-decision
//  port checks for features/system/components/state-machine/SnapshotInspector.tsx:
//    • `SnapshotInspectorProjection.rows` — the sorted rows + the diff `changed` decision.
//    • `SnapshotInspectorProjection.durationText` — the `${fmtInt(ms) ?? '—'} ms` cell.
//    • `SnapshotInspectorProjection.copyPayload` — the `{ transition, snapshot, at }` dump.
//    • `SnapshotInspectorProjection.resolvePhase` — every render branch incl. the widenings.
//    • `SnapshotRelativeTime` — the `formatRelative` just-now / m / h / d ladder.
//  Value-model + a11y coverage live in SnapshotInspector.Tests.swift. Pure, bundle-free.
//
//  Gated on `canImport(XCTest)` for the same app-target / test-bundle membership reason as
//  the other adapter tests.
//

#if canImport(XCTest)
    import Foundation
    import XCTest
    @testable import TeslaSync

    /// Identity localizer so assertions read the real copy / templates without a bundle.
    private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

    private enum SampleSnapshot {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)
        static let enUS = Locale(identifier: "en_US")

        static func transition(
            from: String = "online",
            to: String = "driving",
            trigger: String = "shift_state=D",
            durationMs: Double? = 8421
        ) -> SnapshotTransition {
            let details = durationMs.map { SnapshotValue.object([SnapshotMember("duration_in_state_ms", .number($0))]) }
            return SnapshotTransition(
                id: 1, vehicleID: 1, ts: "2024-05-29T18:24:00Z", fsmName: "vehicle",
                fromState: from, toState: to, trigger: trigger, details: details
            )
        }

        static func snapshot(
            at: String? = "2024-05-29T18:24:00Z",
            signals: [String: SnapshotSignalEntry]
        ) -> SnapshotSignalSet {
            SnapshotSignalSet(vehicleID: 1, at: at, signals: signals)
        }
    }

    // MARK: - Projection: rows (web `rows` useMemo)

    @MainActor final class SnapshotInspectorRowsTests: XCTestCase {
        func testNoSnapshotYieldsNoRows() {
            XCTAssertTrue(SnapshotInspectorProjection.rows(snapshot: nil, previousSnapshot: nil).isEmpty)
        }

        func testRowsSortedByName() {
            let snapshot = SampleSnapshot.snapshot(signals: [
                "zeta": SnapshotSignalEntry(value: .number(1)),
                "alpha": SnapshotSignalEntry(value: .number(2)),
                "mid": SnapshotSignalEntry(value: .number(3))
            ])
            let names = SnapshotInspectorProjection.rows(snapshot: snapshot, previousSnapshot: nil).map(\.name)
            XCTAssertEqual(names, ["alpha", "mid", "zeta"])
        }

        func testChangedFalseWithoutPreviousSnapshot() {
            let snapshot = SampleSnapshot.snapshot(signals: ["a": SnapshotSignalEntry(value: .number(1))])
            let rows = SnapshotInspectorProjection.rows(snapshot: snapshot, previousSnapshot: nil)
            XCTAssertFalse(rows[0].changed)
            XCTAssertNil(rows[0].previousDisplay)
        }

        func testChangedReflectsValueDifference() {
            let current = SampleSnapshot.snapshot(signals: [
                "shift": SnapshotSignalEntry(value: .string("D")),
                "soc": SnapshotSignalEntry(value: .number(82))
            ])
            let previous = SampleSnapshot.snapshot(signals: [
                "shift": SnapshotSignalEntry(value: .string("P")),
                "soc": SnapshotSignalEntry(value: .number(82))
            ])
            let rows = SnapshotInspectorProjection.rows(snapshot: current, previousSnapshot: previous)
            let byName = Dictionary(uniqueKeysWithValues: rows.map { ($0.name, $0) })
            XCTAssertEqual(byName["shift"]?.changed, true)
            XCTAssertEqual(byName["shift"]?.previousDisplay, "P")
            XCTAssertEqual(byName["soc"]?.changed, false)
            XCTAssertEqual(byName["soc"]?.previousDisplay, "82")
        }

        func testValueDisplayUsesFormatValue() {
            let snapshot = SampleSnapshot.snapshot(signals: [
                "flag": SnapshotSignalEntry(value: .bool(true), source: .l1, ageMs: 120)
            ])
            let row = SnapshotInspectorProjection.rows(snapshot: snapshot, previousSnapshot: nil)[0]
            XCTAssertEqual(row.valueDisplay, "true")
            XCTAssertEqual(row.source, .l1)
            XCTAssertEqual(row.ageMs, 120)
        }
    }

    // MARK: - Projection: duration + copy payload

    @MainActor final class SnapshotInspectorDetailTests: XCTestCase {
        func testDurationGroupedWithUnit() {
            let text = SnapshotInspectorProjection.durationText(
                ms: 842_137, localize: passthroughLocalize, locale: SampleSnapshot.enUS
            )
            XCTAssertEqual(text, "842,137 ms")
        }

        func testDurationAbsentRendersDashUnit() {
            let text = SnapshotInspectorProjection.durationText(
                ms: nil, localize: passthroughLocalize, locale: SampleSnapshot.enUS
            )
            XCTAssertEqual(text, "— ms")
        }

        func testCopyPayloadEmptyWithoutSnapshot() {
            XCTAssertEqual(
                SnapshotInspectorProjection.copyPayload(transition: SampleSnapshot.transition(), snapshot: nil),
                ""
            )
        }

        func testCopyPayloadIsValidJSONWithExpectedFields() throws {
            let snapshot = SampleSnapshot.snapshot(signals: [
                "soc": SnapshotSignalEntry(value: .number(82), source: .l1, ageMs: 240)
            ])
            let payload = SnapshotInspectorProjection.copyPayload(
                transition: SampleSnapshot.transition(), snapshot: snapshot
            )
            let data = try XCTUnwrap(payload.data(using: .utf8))
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let root = try XCTUnwrap(object)
            XCTAssertEqual(root["at"] as? String, "2024-05-29T18:24:00Z")
            let transition = try XCTUnwrap(root["transition"] as? [String: Any])
            XCTAssertEqual(transition["from_state"] as? String, "online")
            XCTAssertEqual(transition["to_state"] as? String, "driving")
            let signals = try XCTUnwrap(root["snapshot"] as? [String: Any])
            let soc = try XCTUnwrap(signals["soc"] as? [String: Any])
            XCTAssertEqual(soc["value"] as? Double, 82)
            XCTAssertEqual(soc["source"] as? String, "l1")
        }

        func testCopyPayloadOmitsAtWhenAbsent() {
            let snapshot = SampleSnapshot.snapshot(at: nil, signals: [:])
            let payload = SnapshotInspectorProjection.copyPayload(
                transition: SampleSnapshot.transition(), snapshot: snapshot
            )
            XCTAssertFalse(payload.contains("\"at\""))
        }
    }

    // MARK: - Projection: resolvePhase (every render branch)

    @MainActor final class SnapshotInspectorPhaseTests: XCTestCase {
        private func resolve(
            status: SnapshotInspectorLoadStatus,
            input: SnapshotInspectorInput
        ) -> SnapshotInspectorPhase {
            SnapshotInspectorProjection.resolvePhase(
                status: status, input: input, now: SampleSnapshot.now,
                localize: passthroughLocalize, locale: SampleSnapshot.enUS
            )
        }

        func testTransitionSelectedResolvesSnapshot() {
            let phase = resolve(
                status: .loaded,
                input: SnapshotInspectorInput(fsmType: "vehicle", transition: SampleSnapshot.transition())
            )
            guard case let .snapshot(content) = phase else { return XCTFail("expected snapshot, got \(phase)") }
            XCTAssertEqual(content.fromState, "online")
            XCTAssertEqual(content.toState, "driving")
            XCTAssertEqual(content.triggerText, "shift_state=D")
        }

        func testEmptyTriggerRendersDash() {
            let phase = resolve(
                status: .loaded,
                input: SnapshotInspectorInput(
                    fsmType: "vehicle", transition: SampleSnapshot.transition(trigger: "")
                )
            )
            guard case let .snapshot(content) = phase else { return XCTFail("expected snapshot, got \(phase)") }
            XCTAssertEqual(content.triggerText, "—")
        }

        func testLoadingWithoutSelectionIsLoading() {
            XCTAssertEqual(resolve(status: .loading, input: SnapshotInspectorInput(fsmType: "vehicle")), .loading)
        }

        func testFailedWithoutSelectionIsError() {
            XCTAssertEqual(
                resolve(status: .failed("boom"), input: SnapshotInspectorInput(fsmType: "vehicle")),
                .error("boom")
            )
        }

        func testLoadedNoSelectionWithInWindowIsNoSelection() {
            XCTAssertEqual(
                resolve(status: .loaded, input: SnapshotInspectorInput(fsmType: "vehicle", inWindowCount: 4)),
                .noSelection
            )
        }

        func testLoadedEmptyWindowWithLastTransitionIsOutsideWindow() {
            let phase = resolve(
                status: .loaded,
                input: SnapshotInspectorInput(
                    fsmType: "vehicle",
                    lastTransition: SampleSnapshot.transition(),
                    inWindowCount: 0
                )
            )
            guard case .outsideWindow = phase else { return XCTFail("expected outsideWindow, got \(phase)") }
        }

        func testSelectionWinsOverFailure() {
            let phase = resolve(
                status: .failed("ignored"),
                input: SnapshotInspectorInput(fsmType: "vehicle", transition: SampleSnapshot.transition())
            )
            guard case .snapshot = phase else { return XCTFail("expected cached snapshot, got \(phase)") }
        }
    }

    // MARK: - Relative time (web `formatRelative`)

    @MainActor final class SnapshotRelativeTimeTests: XCTestCase {
        private let now = Date(timeIntervalSince1970: 2_000_000)

        private func relative(secondsAgo: TimeInterval?) -> String {
            let iso = secondsAgo.map {
                ISO8601DateFormatter().string(from: now.addingTimeInterval(-$0))
            }
            return SnapshotRelativeTime.relative(fromISO: iso, now: now, localize: passthroughLocalize)
        }

        func testNilIsDash() {
            XCTAssertEqual(SnapshotRelativeTime.relative(fromISO: nil, now: now, localize: passthroughLocalize), "—")
        }

        func testUnparseableIsDash() {
            XCTAssertEqual(
                SnapshotRelativeTime.relative(fromISO: "not-a-date", now: now, localize: passthroughLocalize),
                "—"
            )
        }

        func testJustNow() {
            XCTAssertEqual(relative(secondsAgo: 12), "just now")
        }

        func testMinutes() {
            XCTAssertEqual(relative(secondsAgo: 300), "5m ago")
        }

        func testHours() {
            XCTAssertEqual(relative(secondsAgo: 3 * 3600), "3h ago")
        }

        func testDays() {
            XCTAssertEqual(relative(secondsAgo: 2 * 86400), "2d ago")
        }
    }
#endif
