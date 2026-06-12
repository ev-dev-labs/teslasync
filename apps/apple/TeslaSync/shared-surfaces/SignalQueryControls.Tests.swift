//
//  SignalQueryControls.Tests.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  Logic-tier coverage for the SignalQueryControls surface: the pure decision logic (query
//  enablement, table render axis, empty hint, add-signal cap), the cached-inputs → projection map
//  (P4 acceptance: *adapter unit test (cached → projection)*), the time-range preset matcher, the
//  pagination + available-signal filter helpers, the VoiceOver summary seam, and the P1/S10 i18n
//  facade. Pure + view-free; per-state view rendering is covered by the #Preview blocks + the
//  dual-SDK typecheck, and the per-state behaviour by `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Decision logic (web component branches)

@MainActor final class SignalQueryLogicTests: XCTestCase {
    func testCanQueryRequiresSelection() {
        XCTAssertFalse(SignalQueryLogic.canQuery(selectedCount: 0))
        XCTAssertTrue(SignalQueryLogic.canQuery(selectedCount: 1))
    }

    func testQueryDisabled() {
        XCTAssertFalse(SignalQueryLogic.queryDisabled(selectedCount: 1, tableLoading: false, connection: .live))
        XCTAssertTrue(SignalQueryLogic.queryDisabled(selectedCount: 0, tableLoading: false, connection: .live))
        XCTAssertTrue(SignalQueryLogic.queryDisabled(selectedCount: 1, tableLoading: true, connection: .live))
        XCTAssertTrue(SignalQueryLogic.queryDisabled(selectedCount: 1, tableLoading: false, connection: .offline))
        XCTAssertFalse(SignalQueryLogic.queryDisabled(selectedCount: 1, tableLoading: false, connection: .stale))
    }

    func testCanAddSignalRespectsCap() {
        XCTAssertTrue(SignalQueryLogic.canAddSignal(selectedCount: 3, maxSignals: nil))
        XCTAssertTrue(SignalQueryLogic.canAddSignal(selectedCount: 2, maxSignals: 3))
        XCTAssertFalse(SignalQueryLogic.canAddSignal(selectedCount: 3, maxSignals: 3))
    }

    func testTableState() {
        XCTAssertEqual(SignalQueryLogic.tableState(loading: true, rowCount: 0, errorMessage: nil), .loading)
        XCTAssertEqual(
            SignalQueryLogic.tableState(loading: false, rowCount: 0, errorMessage: "boom"), .error("boom")
        )
        XCTAssertEqual(SignalQueryLogic.tableState(loading: false, rowCount: 0, errorMessage: nil), .empty)
        XCTAssertEqual(SignalQueryLogic.tableState(loading: false, rowCount: 5, errorMessage: nil), .rows)
        // Loading wins over a stale error.
        XCTAssertEqual(SignalQueryLogic.tableState(loading: true, rowCount: 5, errorMessage: "x"), .loading)
    }

    func testEmptyHint() {
        XCTAssertEqual(SignalQueryLogic.emptyHint(selectedCount: 0), .selectSignal)
        XCTAssertNil(SignalQueryLogic.emptyHint(selectedCount: 1))
    }
}

// MARK: - Projection (cached inputs → render decisions)

@MainActor final class SignalQueryProjectionTests: XCTestCase {
    private func make(
        available: SignalQueryAvailableSnapshot,
        result: SignalQueryResultSnapshot,
        selectedCount: Int
    ) -> SignalQueryProjection {
        let anchor = Date(timeIntervalSince1970: 1_000_000)
        let range = SignalTimeRange.range(hours: 24, anchor: anchor)
        return SignalQueryProjection.make(
            available: available, result: result, selectedCount: selectedCount, from: range.from, to: range.to
        )
    }

    func testReadyProjectionWithRows() {
        let projection = make(
            available: SignalQueryAvailableSnapshot(state: .loaded, signals: ["A"]),
            result: SignalQueryResultSnapshot(
                rows: [SignalLogEntry(createdAt: "t", signal: "A", valueNum: 1)],
                pagination: SignalHistoryPagination(page: 1, perPage: 50, total: 60, totalPages: 2)
            ),
            selectedCount: 1
        )
        XCTAssertTrue(projection.canQuery)
        XCTAssertFalse(projection.queryDisabled)
        XCTAssertEqual(projection.tableState, .rows)
        XCTAssertNil(projection.emptyHint)
        XCTAssertEqual(projection.activePresetHours, 24)
        XCTAssertTrue(projection.showsPager)
        XCTAssertFalse(projection.canGoPrevious)
        XCTAssertTrue(projection.canGoNext)
        XCTAssertEqual(projection.total, 60)
    }

    func testOfflineProjectionDisablesQueryAndHints() {
        let projection = make(
            available: SignalQueryAvailableSnapshot(state: .loaded, signals: ["A"], connection: .offline),
            result: SignalQueryResultSnapshot(),
            selectedCount: 0
        )
        XCTAssertTrue(projection.queryDisabled)
        XCTAssertEqual(projection.emptyHint, .selectSignal)
        XCTAssertEqual(projection.connection, .offline)
        XCTAssertEqual(projection.tableState, .empty)
        XCTAssertFalse(projection.showsPager)
    }

    func testErrorAndLoadingAxesProjected() {
        let loading = make(
            available: SignalQueryAvailableSnapshot(state: .loading),
            result: SignalQueryResultSnapshot(loading: true),
            selectedCount: 1
        )
        XCTAssertEqual(loading.availableState, .loading)
        XCTAssertEqual(loading.tableState, .loading)

        let errored = make(
            available: SignalQueryAvailableSnapshot(state: .error("down")),
            result: SignalQueryResultSnapshot(errorMessage: "timeout"),
            selectedCount: 1
        )
        XCTAssertEqual(errored.availableState, .error("down"))
        XCTAssertEqual(errored.tableState, .error("timeout"))
    }
}

// MARK: - Time range presets (web `matchTimeRangePreset`)

@MainActor final class SignalQueryTimeRangeTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_700_000_000)

    func testMatchesExactSpans() {
        for preset in SignalTimeRange.presets {
            let range = SignalTimeRange.range(hours: preset.hours, anchor: anchor)
            XCTAssertEqual(SignalTimeRange.matchPreset(from: range.from, to: range.to), preset.hours)
        }
    }

    func testMatchesWithinTolerance() {
        let to = anchor
        let from = anchor.addingTimeInterval(-24 * 3600 - 30) // 30s drift, inside ±60s
        XCTAssertEqual(SignalTimeRange.matchPreset(from: from, to: to), 24)
    }

    func testRejectsOutsideTolerance() {
        let to = anchor
        let from = anchor.addingTimeInterval(-24 * 3600 - 120) // 120s drift, outside ±60s
        XCTAssertNil(SignalTimeRange.matchPreset(from: from, to: to))
    }

    func testRejectsCustomSpan() {
        let to = anchor
        let from = anchor.addingTimeInterval(-2 * 3600) // 2h has no preset
        XCTAssertNil(SignalTimeRange.matchPreset(from: from, to: to))
    }

    func testPresetOrderAndValues() {
        XCTAssertEqual(SignalTimeRange.presets.map(\.label), ["1h", "6h", "24h", "7d", "30d"])
        XCTAssertEqual(SignalTimeRange.presets.map(\.hours), [1, 6, 24, 168, 720])
    }
}

// MARK: - Pagination + available-signal filter

@MainActor final class SignalQueryPagingTests: XCTestCase {
    func testRowNumber() {
        XCTAssertEqual(SignalPaging.rowNumber(index: 0, page: 1, perPage: 50), 1)
        XCTAssertEqual(SignalPaging.rowNumber(index: 4, page: 1, perPage: 50), 5)
        XCTAssertEqual(SignalPaging.rowNumber(index: 0, page: 3, perPage: 25), 51)
    }

    func testPagerEnablement() {
        XCTAssertFalse(SignalPaging.canGoPrevious(page: 1))
        XCTAssertTrue(SignalPaging.canGoPrevious(page: 2))
        XCTAssertTrue(SignalPaging.canGoNext(page: 2, totalPages: 3))
        XCTAssertFalse(SignalPaging.canGoNext(page: 3, totalPages: 3))
        XCTAssertFalse(SignalPaging.showsPager(totalPages: 1))
        XCTAssertTrue(SignalPaging.showsPager(totalPages: 2))
    }

    func testClampPage() {
        XCTAssertEqual(SignalPaging.clamp(page: 0, totalPages: 5), 1)
        XCTAssertEqual(SignalPaging.clamp(page: 9, totalPages: 5), 5)
        XCTAssertEqual(SignalPaging.clamp(page: 3, totalPages: 5), 3)
        XCTAssertEqual(SignalPaging.clamp(page: 4, totalPages: 0), 1)
    }

    func testPageSizes() {
        XCTAssertEqual(SignalPaging.pageSizes, [25, 50, 100])
    }

    func testFilterExcludesSelectedAndMatchesCaseInsensitively() {
        let available = ["VehicleSpeed", "Soc", "InsideTemp", "Odometer"]
        XCTAssertEqual(
            SignalAvailableFilter.filter(available: available, selected: ["Soc"], search: ""),
            ["VehicleSpeed", "InsideTemp", "Odometer"]
        )
        XCTAssertEqual(
            SignalAvailableFilter.filter(available: available, selected: [], search: "temp"),
            ["InsideTemp"]
        )
        XCTAssertEqual(
            SignalAvailableFilter.filter(available: available, selected: ["InsideTemp"], search: "  "),
            ["VehicleSpeed", "Soc", "Odometer"]
        )
    }

    func testVisibleCapsAtFiftyWithOverflow() {
        let many = (1 ... 60).map { "Signal\($0)" }
        let visible = SignalAvailableFilter.visible(many)
        XCTAssertEqual(visible.rows.count, 50)
        XCTAssertEqual(visible.overflow, 10)
        let few = SignalAvailableFilter.visible(["A", "B"])
        XCTAssertEqual(few.rows.count, 2)
        XCTAssertEqual(few.overflow, 0)
    }
}

// MARK: - Accessibility summary

@MainActor final class SignalQueryAccessibilityTests: XCTestCase {
    private let labels = SignalQueryAccessibility.Labels(
        title: "Signal Query",
        selectedSignals: "Signals",
        live: "Live",
        stale: "Stale",
        offline: "Offline",
        loadingResults: "Loading results",
        resultsError: "Couldn't load",
        records: "records",
        noResults: "No results"
    )

    func testSummaryLiveWithRecords() {
        let summary = SignalQueryAccessibility.summary(
            labels: labels, selectedCount: 2, connection: .live, tableState: .rows, total: 128
        )
        XCTAssertEqual(summary, "Signal Query. Signals: 2. Live. 128 records")
    }

    func testSummaryStaleLoading() {
        let summary = SignalQueryAccessibility.summary(
            labels: labels, selectedCount: 1, connection: .stale, tableState: .loading, total: 0
        )
        XCTAssertEqual(summary, "Signal Query. Signals: 1. Stale. Loading results")
    }

    func testSummaryOfflineEmpty() {
        let summary = SignalQueryAccessibility.summary(
            labels: labels, selectedCount: 0, connection: .offline, tableState: .empty, total: 0
        )
        XCTAssertEqual(summary, "Signal Query. Signals: 0. Offline. No results")
    }

    func testSummaryErrorMessage() {
        let summary = SignalQueryAccessibility.summary(
            labels: labels, selectedCount: 1, connection: .live, tableState: .error("timeout"), total: 0
        )
        XCTAssertEqual(summary, "Signal Query. Signals: 1. Live. Couldn't load timeout")
    }
}

// MARK: - i18n facade + surface identity

@MainActor final class SignalQueryStringsTests: XCTestCase {
    func testResolvesKeysToFallback() {
        XCTAssertEqual(SignalQueryControlsStrings.string("signalQuery.from", "From"), "From")
        XCTAssertEqual(SignalQueryControlsStrings.string("signalQuery.to", "To"), "To")
        XCTAssertEqual(SignalQueryControlsStrings.string("signalQuery.quickRange", "Quick Range"), "Quick Range")
        XCTAssertEqual(SignalQueryControlsStrings.string("signalQuery.query", "Query"), "Query")
        XCTAssertEqual(SignalQueryControlsStrings.string("signalQuery.rows", "Rows"), "Rows")
    }

    func testPresetAriaInterpolatesLabel() {
        XCTAssertEqual(SignalQueryControlsStrings.presetAria(label: "24h"), "24h time range")
        XCTAssertEqual(SignalQueryControlsStrings.presetAria(label: "7d"), "7d time range")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SignalQueryControlsSurface.slug, "SignalQueryControls")
        XCTAssertEqual(SignalQueryControls.surfaceSlug, "SignalQueryControls")
    }
}
