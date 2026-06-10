//
//  SignalCompareControls.ModelTests.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  State-holder coverage for `SignalCompareControlsModel`, split from
//  SignalCompareControls.Tests.swift for the lint length budget. Drives the model
//  through `InMemorySignalCompareSource` and the spies below (same XCTest target):
//  phase resolution across each status (so every rendered state is exercised), the
//  P1/S11 `view.opened` telemetry (once), the control intents (windows / preset /
//  search / category) forwarding to the change sink, the stale auto-refresh, offline
//  behavior, and adopting the host's pushed selection. No network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor final class SignalCompareControlsModelTests: XCTestCase {
    private struct Harness {
        let model: SignalCompareControlsModel
        let source: InMemorySignalCompareSource
        let telemetry: SpySignalCompareTelemetry
        let sink: SpySignalCompareChangeSink
    }

    private let utc = TimeZone.gmt
    private let fixedNow = SignalCompareModelFixtures.now

    private func makeHarness(initial: SignalCompareUpdate?) -> Harness {
        let telemetry = SpySignalCompareTelemetry()
        let sink = SpySignalCompareChangeSink()
        let source = InMemorySignalCompareSource(initial: initial)
        let now = fixedNow
        let model = SignalCompareControlsModel(
            source: source,
            selection: initial?.selection ?? SignalCompareSelection(),
            telemetry: telemetry,
            changeSink: sink,
            timeZone: utc,
            clock: { now }
        )
        return Harness(model: model, source: source, telemetry: telemetry, sink: sink)
    }

    private func loaded(
        connection: SignalCompareConnection = .live,
        selection: SignalCompareSelection = SignalCompareSelection()
    ) -> SignalCompareUpdate {
        SignalCompareUpdate(
            status: .loaded,
            selection: selection,
            availableSignals: ["battery_level", "vehicle_speed"],
            connection: connection
        )
    }

    // MARK: Lifecycle + phase

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces, ["SignalCompareControls"])
        XCTAssertEqual(harness.source.startCount, 1)
        XCTAssertEqual(harness.model.phase, .content)
    }

    func testPhasesAcrossStatuses() {
        let content = makeHarness(initial: loaded())
        content.model.start()
        XCTAssertEqual(content.model.phase, .content)

        let empty = makeHarness(initial: SignalCompareUpdate(status: .loaded))
        empty.model.start()
        XCTAssertEqual(empty.model.phase, .empty)

        let loading = makeHarness(initial: SignalCompareUpdate(status: .loading))
        loading.model.start()
        XCTAssertEqual(loading.model.phase, .loading)

        let failed = makeHarness(initial: SignalCompareUpdate(status: .failed("boom")))
        failed.model.start()
        XCTAssertEqual(failed.model.phase, .error("boom"))
    }

    // MARK: Control intents

    func testSetWindowsForwardToSink() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.setWindowA("2026-06-09T08:30")
        XCTAssertEqual(harness.model.selection.atA, "2026-06-09T08:30")
        harness.model.setWindowB("2026-06-09T09:45")
        XCTAssertEqual(harness.model.selection.atB, "2026-06-09T09:45")
        XCTAssertEqual(harness.sink.last?.atB, "2026-06-09T09:45")
    }

    func testApplyPresetSetsBothWindowsFromClock() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.applyPreset(.nowVs1h)
        XCTAssertEqual(harness.model.selection.atA, "2026-06-09T11:00")
        XCTAssertEqual(harness.model.selection.atB, "2026-06-09T12:00")
        XCTAssertEqual(harness.sink.last?.atA, "2026-06-09T11:00")
    }

    func testSetSearchForwardsToSink() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.setSearch("sentry")
        XCTAssertEqual(harness.model.selection.search, "sentry")
        XCTAssertEqual(harness.sink.last?.search, "sentry")
    }

    func testToggleCategorySelectsThenClears() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.toggleCategory("battery")
        XCTAssertEqual(harness.model.selection.category, "battery")
        XCTAssertEqual(harness.model.selectedCategory?.id, "battery")
        harness.model.toggleCategory("battery")
        XCTAssertNil(harness.model.selection.category)
    }

    func testClearCategoryClearsWhenSetAndNoOpsWhenNil() {
        let harness = makeHarness(initial: loaded(selection: SignalCompareSelection(category: "drive")))
        harness.model.start()
        harness.model.clearCategory()
        XCTAssertNil(harness.model.selection.category)
        let changeCount = harness.sink.changes.count
        harness.model.clearCategory()
        XCTAssertEqual(harness.sink.changes.count, changeCount)
    }

    func testMatchingSignalsReflectActiveFilter() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.toggleCategory("battery")
        XCTAssertEqual(harness.model.matchingSignals, ["battery_level"])
    }

    // MARK: Freshness

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.source.push(loaded(connection: .live))
        harness.source.push(loaded(connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedSignalsAndDoesNotRefresh() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(connection: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
        XCTAssertEqual(harness.model.connection, .offline)
        XCTAssertEqual(harness.model.phase, .content)
    }

    func testApplyAdoptsHostPushedSelection() {
        let harness = makeHarness(initial: nil)
        harness.model.start()
        harness.source.push(loaded(selection: SignalCompareSelection(search: "tpms", category: "tire")))
        XCTAssertEqual(harness.model.selection.search, "tpms")
        XCTAssertEqual(harness.model.selection.category, "tire")
    }

    func testStopAllowsTelemetryToReArm() {
        let harness = makeHarness(initial: loaded())
        harness.model.start()
        harness.model.stop()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces.count, 2)
        XCTAssertEqual(harness.source.stopCount, 1)
    }

    func testSurfaceSlugMatchesDiagnosticsContract() {
        XCTAssertEqual(SignalCompareControls.surfaceSlug, "SignalCompareControls")
    }
}

// MARK: - Fixtures

private enum SignalCompareModelFixtures {
    /// A fixed "now" (2026-06-09 12:00 UTC) so the preset windows are deterministic.
    static let now: Date = {
        var components = DateComponents()
        components.year = 2026
        components.month = 6
        components.day = 9
        components.hour = 12
        components.minute = 0
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }()
}

// MARK: - Test doubles

final class SpySignalCompareTelemetry: SignalCompareTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

final class SpySignalCompareChangeSink: SignalCompareChangeSink, @unchecked Sendable {
    private(set) var changes: [SignalCompareSelection] = []
    var last: SignalCompareSelection? {
        changes.last
    }

    func selectionChanged(_ selection: SignalCompareSelection) {
        changes.append(selection)
    }
}
