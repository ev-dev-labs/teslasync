//
//  LiveSignalsTable.Tests.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  Unit coverage for the LiveSignalsTable surface:
//    • Adapter (cached → projection) — `LiveSignalsTableFormat` + `…Builder`
//      parity with the web `renderValue` / `rowFromEntry` / sort + filter `useMemo`s.
//    • State holder — `LiveSignalsTableModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry, the
//      `useSortToggle` behaviour, and the live filter.
//    • Accessibility — the VoiceOver grid summary + row labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLiveSignalsTableSource`. The pure
//  adapter subset is additionally proven by an executed host harness (gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: value rendering + timestamp parsing (web `renderValue`)

@MainActor
final class LiveSignalsTableFormatTests: XCTestCase {
    func testJsNumberMatchesTemplateLiteral() {
        XCTAssertEqual(LiveSignalsTableFormat.jsNumber(320), "320")
        XCTAssertEqual(LiveSignalsTableFormat.jsNumber(320.5), "320.5")
        XCTAssertEqual(LiveSignalsTableFormat.jsNumber(-12), "-12")
        XCTAssertEqual(LiveSignalsTableFormat.jsNumber(0), "0")
        XCTAssertEqual(LiveSignalsTableFormat.jsNumber(78.5), "78.5")
    }

    func testRenderValueCoercesEveryKind() {
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.null), "null")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.absent), "—")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.string("Drive")), "Drive")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.string("")), "")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.number(42)), "42")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.bool(true)), "true")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.bool(false)), "false")
        XCTAssertEqual(LiveSignalsTableFormat.renderValue(.compound("{\"lat\":1}")), "{\"lat\":1}")
    }

    func testParseTimestampHandlesIsoVariantsAndJunk() {
        XCTAssertNotNil(LiveSignalsTableFormat.parseTimestamp("2026-06-07T19:00:00Z"))
        XCTAssertNotNil(LiveSignalsTableFormat.parseTimestamp("2026-06-07T19:00:00.500Z"))
        XCTAssertNil(LiveSignalsTableFormat.parseTimestamp(nil))
        XCTAssertNil(LiveSignalsTableFormat.parseTimestamp(""))
        XCTAssertNil(LiveSignalsTableFormat.parseTimestamp("not-a-date"))
    }

    func testRelativeIsLocaleAwareAndPast() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let twoMinAgo = now.addingTimeInterval(-120)
        let relative = LiveSignalsTableFormat.relative(from: twoMinAgo, to: now, locale: Locale(identifier: "en_US"))
        XCTAssertTrue(relative.localizedCaseInsensitiveContains("min"), "expected a minutes phrase, got \(relative)")
    }
}

// MARK: - Adapter: rowFromEntry + projection + filter + sort

@MainActor
final class LiveSignalsTableBuilderTests: XCTestCase {
    func testRowFromEnvelopeCarriesValueAndTimestamp() {
        let entry = LiveSignalEntry(
            name: "speed",
            payload: .envelope(value: .number(42), timestamp: "2026-06-07T19:00:00Z")
        )
        let row = LiveSignalsTableBuilder.row(from: entry)
        XCTAssertEqual(row.name, "speed")
        XCTAssertEqual(row.valueText, "42")
        XCTAssertEqual(row.timestampRaw, "2026-06-07T19:00:00Z")
        XCTAssertNotNil(row.timestamp)
    }

    func testRowFromBareHasNoTimestamp() {
        let row = LiveSignalsTableBuilder.row(from: LiveSignalEntry(name: "locked", payload: .bare(.bool(true))))
        XCTAssertEqual(row.valueText, "true")
        XCTAssertNil(row.timestampRaw)
        XCTAssertNil(row.timestamp)
    }

    func testBuildProjectionDefaultsToNameAscending() {
        let projection = LiveSignalsTableBuilder.buildProjection(from: [
            LiveSignalEntry(name: "zebra", payload: .bare(.number(1))),
            LiveSignalEntry(name: "alpha", payload: .bare(.number(2))),
            LiveSignalEntry(name: "mike", payload: .bare(.number(3)))
        ])
        XCTAssertEqual(projection.rows.map(\.name), ["alpha", "mike", "zebra"])
        XCTAssertTrue(projection.hasData)
    }

    func testEmptyProjectionHasNoData() {
        XCTAssertFalse(LiveSignalsTableBuilder.buildProjection(from: []).hasData)
        XCTAssertEqual(LiveSignalsTableProjection.empty.rows, [])
    }

    func testFilterIsTrimmedCaseInsensitiveSubstring() {
        let rows = sampleRows()
        XCTAssertEqual(LiveSignalsTableBuilder.filter(rows, query: "bat").map(\.name), ["battery_level"])
        XCTAssertEqual(LiveSignalsTableBuilder.filter(rows, query: "  SPEED ").map(\.name), ["vehicle_speed"])
        XCTAssertEqual(LiveSignalsTableBuilder.filter(rows, query: "").count, rows.count)
        XCTAssertTrue(LiveSignalsTableBuilder.filter(rows, query: "zzz").isEmpty)
    }

    func testSortByNameRespectsDirection() {
        let rows = sampleRows()
        let asc = LiveSignalsTableBuilder.sort(rows, key: .name, direction: .ascending).map(\.name)
        XCTAssertEqual(asc, ["battery_level", "charging_state", "vehicle_speed"])
        let desc = LiveSignalsTableBuilder.sort(rows, key: .name, direction: .descending).map(\.name)
        XCTAssertEqual(desc, ["vehicle_speed", "charging_state", "battery_level"])
    }

    func testSortByTimestampPutsMissingFirstAscending() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let rows = [
            LiveSignalRow(name: "b", valueText: "2", timestampRaw: "t", timestamp: now),
            LiveSignalRow(name: "a", valueText: "1", timestampRaw: nil, timestamp: nil),
            LiveSignalRow(name: "c", valueText: "3", timestampRaw: "t", timestamp: now.addingTimeInterval(60))
        ]
        let asc = LiveSignalsTableBuilder.sort(rows, key: .timestamp, direction: .ascending).map(\.name)
        XCTAssertEqual(asc, ["a", "b", "c"])
        let desc = LiveSignalsTableBuilder.sort(rows, key: .timestamp, direction: .descending).map(\.name)
        XCTAssertEqual(desc, ["c", "b", "a"])
    }

    private func sampleRows() -> [LiveSignalRow] {
        [
            LiveSignalRow(name: "vehicle_speed", valueText: "42", timestampRaw: nil, timestamp: nil),
            LiveSignalRow(name: "battery_level", valueText: "78.5", timestampRaw: nil, timestamp: nil),
            LiveSignalRow(name: "charging_state", valueText: "Charging", timestampRaw: nil, timestamp: nil)
        ]
    }
}

// MARK: - State holder: phases + telemetry + filter/sort wiring

@MainActor
final class LiveSignalsTableModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveSignalsTableUpdate,
        telemetry: LiveSignalsTableTelemetry = OSLogLiveSignalsTableTelemetry()
    ) -> (LiveSignalsTableModel, InMemoryLiveSignalsTableSource) {
        let source = InMemoryLiveSignalsTableSource(initial: update)
        let model = LiveSignalsTableModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func entries() -> [LiveSignalEntry] {
        [
            LiveSignalEntry(name: "vehicle_speed", payload: .bare(.number(42))),
            LiveSignalEntry(name: "battery_level", payload: .bare(.number(78.5))),
            LiveSignalEntry(name: "charging_state", payload: .bare(.string("Charging")))
        ]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(LiveSignalsTableUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isFetching)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(LiveSignalsTableUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LiveSignalsTableUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(LiveSignalsTableUpdate(status: .loading, entries: entries()))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(LiveSignalsTableUpdate(status: .failed("net"), entries: entries()))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLiveSignalsTableTelemetry()
        let (model, source) = makeModel(LiveSignalsTableUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveSignalsTable.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(LiveSignalsTableUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LiveSignalsTableUpdate(status: .loading))
        model.start()
        source.push(LiveSignalsTableUpdate(
            status: .loaded,
            connection: .offline,
            entries: entries(),
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 3)
        XCTAssertFalse(model.isFetching)
    }

    func testFilterNarrowsDisplayedRows() {
        let (model, _) = makeModel(LiveSignalsTableUpdate(status: .loaded, entries: entries()))
        model.start()
        model.filterText = "speed"
        XCTAssertEqual(model.displayedRows.map(\.name), ["vehicle_speed"])
    }

    func testToggleSortFollowsUseSortToggleSemantics() {
        let (model, _) = makeModel(LiveSignalsTableUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertEqual(model.sortKey, .name)
        XCTAssertEqual(model.sortDirection, .ascending)
        model.toggleSort(.name)
        XCTAssertEqual(model.sortDirection, .descending)
        XCTAssertEqual(model.displayedRows.map(\.name), ["vehicle_speed", "charging_state", "battery_level"])
        model.toggleSort(.timestamp)
        XCTAssertEqual(model.sortKey, .timestamp)
        XCTAssertEqual(model.sortDirection, .ascending)
    }
}

// MARK: - Accessibility

@MainActor
final class LiveSignalsTableAccessibilityTests: XCTestCase {
    func testGridSummaryFallsBackToEmptyTitle() {
        XCTAssertEqual(LiveSignalsTableAccessibility.gridSummary(rowCount: 0), LiveSignalsTableStrings.emptyTitle)
    }

    func testGridSummaryIncludesCount() {
        XCTAssertTrue(LiveSignalsTableAccessibility.gridSummary(rowCount: 3).contains("3"))
    }

    func testRowLabelIncludesNameValueAndTime() {
        let row = LiveSignalRow(name: "vehicle_speed", valueText: "42", timestampRaw: "t", timestamp: Date())
        let label = LiveSignalsTableAccessibility.rowLabel(for: row, relative: "2 minutes ago")
        XCTAssertTrue(label.contains("vehicle_speed"))
        XCTAssertTrue(label.contains("42"))
        XCTAssertTrue(label.contains("2 minutes ago"))
    }

    func testRowLabelFallsBackWhenNoTimestamp() {
        let row = LiveSignalRow(name: "locked", valueText: "true", timestampRaw: nil, timestamp: nil)
        let label = LiveSignalsTableAccessibility.rowLabel(for: row, relative: nil)
        XCTAssertTrue(label.contains(LiveSignalsTableStrings.noTimestamp))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveSignalsTableTelemetry: LiveSignalsTableTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
