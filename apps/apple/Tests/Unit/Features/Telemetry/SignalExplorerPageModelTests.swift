//
//  SignalExplorerPageModelTests.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalExplorer (Apple)
//
//  Pure-logic tests for `SignalExplorerPageModel`: the useSignals catalog
//  lifecycle + its four phases, the five-signal selection cap, the manual Explore
//  run that populates the historical rows + stats, the Live toggle, the AI-draft
//  apply mapping (web `handleApplyAiDraft`), and the pagination clamp. No view is
//  rendered; the model is driven against its built-in shared-core seam doubles.
//

import XCTest
@testable import TeslaSync

@MainActor
final class SignalExplorerPageModelTests: XCTestCase {
    func testLoadPopulatesVehiclesAndCatalogSuccess() async {
        let model = SignalExplorerPageModel()
        await model.load()

        XCTAssertFalse(model.vehicles.isEmpty)
        XCTAssertGreaterThan(model.selectedVehicleID, 0)
        XCTAssertFalse(model.availableSignals.isEmpty)
        XCTAssertEqual(model.catalogPhase, .success)
        XCTAssertNotNil(model.aiFilterModel)
    }

    func testCatalogEmptyWhenNoVehicle() async {
        let model = SignalExplorerPageModel()
        // No vehicle selected: the catalog source projects the empty phase.
        await model.reloadCatalog()

        XCTAssertEqual(model.catalogPhase, .empty)
        XCTAssertTrue(model.availableSignals.isEmpty)
    }

    func testToggleSignalEnforcesFiveCap() async {
        let model = SignalExplorerPageModel()
        await model.load()

        for signal in model.availableSignals.prefix(7) {
            model.toggleSignal(signal)
        }
        XCTAssertEqual(model.selectedSignals.count, SignalExplorerPageModel.maxSignals)
        XCTAssertTrue(model.isAtCapacity)

        let first = model.selectedSignals[0]
        model.toggleSignal(first)
        XCTAssertFalse(model.selectedSignals.contains(first))
        XCTAssertFalse(model.isAtCapacity)
    }

    func testExploreRunsHistoricalQuery() async {
        let model = SignalExplorerPageModel()
        await model.load()
        model.toggleSignal(model.availableSignals[0])
        model.toggleSignal(model.availableSignals[1])

        XCTAssertTrue(model.canExplore)
        XCTAssertTrue(model.showsRestingEmpty)

        await model.explore()

        XCTAssertTrue(model.hasHistorical)
        XCTAssertFalse(model.showsRestingEmpty)
        XCTAssertFalse(model.historyRows.isEmpty)
        XCTAssertFalse(model.historyStats.isEmpty)
        XCTAssertFalse(model.historicalLoading)
        XCTAssertEqual(model.page, 1)
    }

    func testPaginationClampsToBounds() async {
        let model = SignalExplorerPageModel()
        await model.load()
        model.toggleSignal(model.availableSignals[0])
        model.setPerPage(25)
        await model.explore()

        model.setPage(-5)
        XCTAssertEqual(model.page, 1)

        model.setPage(9_999)
        XCTAssertEqual(model.page, model.totalPages)
        XCTAssertGreaterThanOrEqual(model.totalPages, 1)
    }

    func testApplyAiDraftCopiesCappedSignalsAndPerPage() async {
        let model = SignalExplorerPageModel()
        await model.load()

        let draft = SignalExplorerFilterDraft(
            vehicleID: model.selectedVehicleID,
            signals: ["A", "B", "C", "D", "E", "F"],
            rangePreset: "24h",
            perPage: 100
        )
        model.applyAiDraft(draft)

        XCTAssertEqual(model.selectedSignals.count, SignalExplorerPageModel.maxSignals)
        XCTAssertEqual(model.selectedSignals, ["A", "B", "C", "D", "E"])
        XCTAssertEqual(model.perPage, 100)
        XCTAssertEqual(model.page, 1)
    }

    func testToggleLiveStartsAndStops() async {
        let model = SignalExplorerPageModel()
        await model.load()
        model.toggleSignal(model.availableSignals[0])

        model.toggleLive()
        XCTAssertTrue(model.isLive)

        model.toggleLive()
        XCTAssertFalse(model.isLive)
        XCTAssertFalse(model.liveConnected)
    }

    func testVehicleChangeClearsSelectionAndHistory() async {
        let model = SignalExplorerPageModel()
        await model.load()
        model.toggleSignal(model.availableSignals[0])
        await model.explore()
        XCTAssertTrue(model.hasHistorical)

        await model.onVehicleChange()
        XCTAssertTrue(model.selectedSignals.isEmpty)
        XCTAssertFalse(model.hasHistorical)
        XCTAssertTrue(model.historyRows.isEmpty)
    }
}
