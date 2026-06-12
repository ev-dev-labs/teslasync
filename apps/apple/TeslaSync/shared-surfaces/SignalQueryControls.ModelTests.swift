//
//  SignalQueryControls.ModelTests.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  State-holder coverage: `SignalQueryControlsModel` wiring — the P1/S11 `view.opened` telemetry, the
//  initial-snapshot apply, the multi-select add/remove (cap + dedupe), the preset range apply, the
//  selection-gated "Query" submit + the optimistic loading flag + the forwarded request body, the
//  page navigation (clamped), the stale auto-refresh, the offline disable, and the result-snapshot →
//  table-state mapping. Driven entirely by `InMemorySignalQueryControlsSource`; no network.
//

import XCTest
@testable import TeslaSync

@MainActor final class SignalQueryControlsModelTests: XCTestCase {
    private let fixedAnchor = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeModel(
        available: SignalQueryAvailableSnapshot = SignalQueryAvailableSnapshot(state: .loaded, signals: ["A", "B"]),
        result: SignalQueryResultSnapshot? = nil,
        selected: [String] = [],
        maxSignals: Int? = nil,
        telemetry: SignalQueryControlsTelemetry = OSLogSignalQueryControlsTelemetry()
    ) -> (SignalQueryControlsModel, InMemorySignalQueryControlsSource) {
        let source = InMemorySignalQueryControlsSource(available: available, result: result)
        let model = SignalQueryControlsModel(
            vehicleID: 42,
            source: source,
            telemetry: telemetry,
            selected: selected,
            maxSignals: maxSignals,
            anchor: fixedAnchor
        )
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndStartsSource() {
        let spy = SpySignalQueryTelemetry()
        let (model, source) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalQueryControlsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStartAppliesInitialSnapshots() {
        let (model, _) = makeModel(
            available: SignalQueryAvailableSnapshot(state: .loaded, signals: ["VehicleSpeed", "Soc"]),
            result: SignalQueryResultSnapshot(
                rows: [SignalLogEntry(createdAt: "t", signal: "Soc", valueNum: 80)],
                pagination: SignalHistoryPagination(page: 1, perPage: 50, total: 1, totalPages: 1)
            )
        )
        model.start()
        XCTAssertEqual(model.availableSignals, ["VehicleSpeed", "Soc"])
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.tableState, .rows)
    }

    func testInitialRangeMatchesTwentyFourHourPreset() {
        let (model, _) = makeModel()
        model.start()
        XCTAssertEqual(model.activePresetHours, 24)
    }

    func testAddSignalDedupesAndRespectsCap() {
        let (model, _) = makeModel(selected: [], maxSignals: 2)
        model.start()
        model.addSignal("A")
        model.addSignal("A") // dedupe
        XCTAssertEqual(model.selected, ["A"])
        model.addSignal("B")
        model.addSignal("C") // over the cap of 2 → ignored
        XCTAssertEqual(model.selected, ["A", "B"])
    }

    func testRemoveSignal() {
        let (model, _) = makeModel(selected: ["A", "B"])
        model.start()
        model.removeSignal("A")
        XCTAssertEqual(model.selected, ["B"])
    }

    func testApplyPresetSetsMatchingRange() {
        let (model, _) = makeModel()
        model.start()
        model.applyPreset(hours: 168, anchor: fixedAnchor)
        XCTAssertEqual(model.activePresetHours, 168)
    }

    func testRunQueryIsNoOpWithoutSelection() {
        let (model, source) = makeModel(selected: [])
        model.start()
        model.runQuery()
        XCTAssertEqual(source.runQueryCount, 0)
        XCTAssertFalse(model.result.loading)
    }

    func testRunQuerySubmitsRequestAndSetsOptimisticLoading() {
        let (model, source) = makeModel(selected: ["Odometer", "Soc"])
        model.start()
        model.runQuery()
        XCTAssertEqual(source.runQueryCount, 1)
        XCTAssertEqual(source.lastRequest?.signals, ["Odometer", "Soc"])
        XCTAssertEqual(source.lastRequest?.page, 1)
        XCTAssertEqual(source.lastRequest?.perPage, 50)
        XCTAssertTrue(model.result.loading)
        XCTAssertEqual(model.tableState, .loading)
    }

    func testGoToPageClampsAndRequests() {
        let (model, source) = makeModel(
            result: SignalQueryResultSnapshot(
                rows: [SignalLogEntry(createdAt: "t", signal: "A", valueNum: 1)],
                pagination: SignalHistoryPagination(page: 1, perPage: 50, total: 130, totalPages: 3)
            ),
            selected: ["A"]
        )
        model.start()
        model.goToPage(2)
        XCTAssertEqual(source.lastRequest?.page, 2)
        model.goToPage(99) // clamps to totalPages (3)
        XCTAssertEqual(source.lastRequest?.page, 3)
        model.goToPage(0) // clamps to 1
        XCTAssertEqual(source.lastRequest?.page, 1)
    }

    func testRetryQueryReRunsLastRequest() {
        let (model, source) = makeModel(selected: ["A"])
        model.start()
        model.retryQuery() // nothing queried yet → no-op
        XCTAssertEqual(source.runQueryCount, 0)
        model.runQuery()
        model.retryQuery()
        XCTAssertEqual(source.runQueryCount, 2)
        XCTAssertEqual(source.lastRequest?.signals, ["A"])
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel()
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.pushAvailable(SignalQueryAvailableSnapshot(state: .loaded, signals: ["A"], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.pushAvailable(SignalQueryAvailableSnapshot(state: .loaded, signals: ["A"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDisablesQueryWithoutAutoRefresh() {
        let (model, source) = makeModel(selected: ["A"])
        model.start()
        source.pushAvailable(SignalQueryAvailableSnapshot(state: .loaded, signals: ["A"], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.queryDisabled)
    }

    func testResultSnapshotDrivesTableState() {
        let (model, source) = makeModel(selected: ["A"])
        model.start()
        source.pushResult(SignalQueryResultSnapshot(loading: true))
        XCTAssertEqual(model.tableState, .loading)
        source.pushResult(SignalQueryResultSnapshot(rows: [], errorMessage: "boom"))
        XCTAssertEqual(model.tableState, .error("boom"))
        source.pushResult(SignalQueryResultSnapshot(rows: []))
        XCTAssertEqual(model.tableState, .empty)
        source.pushResult(SignalQueryResultSnapshot(
            rows: [SignalLogEntry(createdAt: "t", signal: "A", valueNum: 1)]
        ))
        XCTAssertEqual(model.tableState, .rows)
    }

    func testPushHistoryAdaptsRowsThroughAdapter() {
        let (model, source) = makeModel(selected: ["Odometer"])
        model.start()
        let resp = SignalHistoryResp(
            signal: "Odometer",
            data: [
                SignalHistoryPoint(ts: "2026-05-13T01:04:51.177284Z", kind: "ValueKindDouble", value: .number(42))
            ]
        )
        source.pushHistory(resp: resp, page: 1, perPage: 50, total: 1)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.rows.first?.valueNum, 42)
        XCTAssertEqual(model.pagination.totalPages, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel()
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArmsWithoutReemittingTelemetry() {
        let spy = SpySignalQueryTelemetry()
        let (model, source) = makeModel(telemetry: spy)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces, [SignalQueryControlsSurface.slug])
    }

    func testFilteredAvailableExcludesSelected() {
        let (model, _) = makeModel(
            available: SignalQueryAvailableSnapshot(state: .loaded, signals: ["A", "B", "C"]),
            selected: ["B"]
        )
        model.start()
        XCTAssertEqual(model.filteredAvailable(search: ""), ["A", "C"])
        XCTAssertEqual(model.filteredAvailable(search: "c"), ["C"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalQueryTelemetry: SignalQueryControlsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
