//
//  SignalDiffTable.ModelTests.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  State-holder + accessibility coverage for the SignalDiffTable surface (split
//  from SignalDiffTable.Tests.swift to keep each file focused): the
//  `SignalDiffTableModel` phase resolution, the P1/S11 `view.opened` telemetry,
//  the multi-selection, the optimistic pin float, the sort toggle, and the
//  VoiceOver grid summary / row labels / Δ description. Driven by
//  `InMemorySignalDiffTableSource`; no network, no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - State holder: phases + telemetry + selection/pin/sort

@MainActor final class SignalDiffTableModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalDiffTableUpdate,
        telemetry: SignalDiffTableTelemetry = OSLogSignalDiffTableTelemetry()
    ) -> (SignalDiffTableModel, InMemorySignalDiffTableSource) {
        let source = InMemorySignalDiffTableSource(initial: update)
        let model = SignalDiffTableModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func entries() -> [SignalDiffEntry] {
        [
            SignalDiffEntry(name: "aaa", valueA: .number(1), valueB: .number(2)),
            SignalDiffEntry(name: "bbb", valueA: .number(3), valueB: .number(1)),
            SignalDiffEntry(name: "ccc", valueA: .string("x"), valueB: .string("y"))
        ]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isFetching)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(SignalDiffTableUpdate(status: .loading, entries: entries()))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SignalDiffTableUpdate(status: .failed("net"), entries: entries()))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalDiffTableTelemetry()
        let (model, source) = makeModel(SignalDiffTableUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalDiffTableModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(SignalDiffTableUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testConnectionFilterVehicleAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SignalDiffTableUpdate(status: .loading))
        model.start()
        source.push(SignalDiffTableUpdate(
            status: .loaded,
            connection: .offline,
            entries: entries(),
            filterActive: true,
            vehicleId: 7,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 3)
        XCTAssertTrue(model.filterActive)
        XCTAssertEqual(model.vehicleId, 7)
        XCTAssertEqual(model.pinContext, "signal-diff:vehicle:7")
        XCTAssertFalse(model.isFetching)
    }

    func testToggleSelectionAddsAndRemoves() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertFalse(model.isSelected("aaa"))
        model.toggleSelection("aaa")
        model.toggleSelection("bbb")
        XCTAssertTrue(model.isSelected("aaa"))
        XCTAssertTrue(model.isSelected("bbb"))
        model.toggleSelection("aaa")
        XCTAssertFalse(model.isSelected("aaa"))
        model.setSelection(["ccc"])
        XCTAssertEqual(model.selectedSignals, ["ccc"])
    }

    func testSelectionIsPrunedToExistingRowsOnUpdate() {
        let (model, source) = makeModel(SignalDiffTableUpdate(status: .loaded, entries: entries()))
        model.start()
        model.toggleSelection("aaa")
        model.toggleSelection("bbb")
        source.push(SignalDiffTableUpdate(
            status: .loaded,
            entries: [SignalDiffEntry(name: "aaa", valueA: .number(1), valueB: .number(9))]
        ))
        XCTAssertEqual(model.selectedSignals, ["aaa"])
    }

    func testTogglePinFloatsRowAndPersistsUntilUntoggled() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertEqual(model.displayedRows.map(\.name), ["aaa", "bbb", "ccc"])
        model.togglePin("ccc")
        XCTAssertTrue(model.isPinned("ccc"))
        XCTAssertEqual(model.displayedRows.first?.name, "ccc")
        model.togglePin("ccc")
        XCTAssertFalse(model.isPinned("ccc"))
        XCTAssertEqual(model.displayedRows.map(\.name), ["aaa", "bbb", "ccc"])
    }

    func testToggleSortFollowsHeaderSemantics() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertEqual(model.sortKey, .name)
        XCTAssertEqual(model.sortDirection, .ascending)
        model.toggleSort(.name)
        XCTAssertEqual(model.sortDirection, .descending)
        XCTAssertEqual(model.displayedRows.map(\.name), ["ccc", "bbb", "aaa"])
        model.toggleSort(.delta)
        XCTAssertEqual(model.sortKey, .delta)
        XCTAssertEqual(model.sortDirection, .ascending)
    }

    func testPinnedSeededFromUpdate() {
        let (model, _) = makeModel(SignalDiffTableUpdate(status: .loaded, entries: entries(), pinned: ["bbb"]))
        model.start()
        XCTAssertTrue(model.isPinned("bbb"))
        XCTAssertEqual(model.displayedRows.first?.name, "bbb")
    }
}

// MARK: - Accessibility

@MainActor final class SignalDiffTableAccessibilityTests: XCTestCase {
    func testGridSummaryFallsBackToEmptyMessage() {
        XCTAssertEqual(SignalDiffTableAccessibility.gridSummary(rowCount: 0), SignalDiffTableStrings.tableEmpty)
    }

    func testGridSummaryIncludesCount() {
        XCTAssertTrue(SignalDiffTableAccessibility.gridSummary(rowCount: 3).contains("3"))
    }

    func testDeltaDescriptionVariants() {
        XCTAssertEqual(SignalDiffTableAccessibility.deltaDescription(for: .none), SignalDiffTableStrings.noChangeLabel)
        XCTAssertEqual(
            SignalDiffTableAccessibility.deltaDescription(for: .changed),
            SignalDiffTableStrings.deltaChanged
        )
        let numeric = SignalDiffTableAccessibility.deltaDescription(
            for: .numeric(delta: 4, percent: 5.1),
            locale: enUS
        )
        XCTAssertTrue(numeric.contains(SignalDiffTableStrings.deltaChangeLabel))
        XCTAssertTrue(numeric.contains("+4.00"))
    }

    func testRowLabelIncludesNameWindowsSourcesAndPinned() {
        let row = SignalDiffTableBuilder.row(
            from: SignalDiffEntry(
                name: "battery_level",
                valueA: .number(78),
                valueB: .number(82),
                sourceA: .l1,
                sourceB: .stale
            ),
            pinned: true,
            locale: enUS
        )
        let label = SignalDiffTableAccessibility.rowLabel(for: row, locale: enUS)
        XCTAssertTrue(label.contains("battery_level"))
        XCTAssertTrue(label.contains("78.00"))
        XCTAssertTrue(label.contains("82.00"))
        XCTAssertTrue(label.contains("L1"))
        XCTAssertTrue(label.contains("STALE"))
        XCTAssertTrue(label.contains(SignalDiffTableStrings.pinnedLabel))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalDiffTableTelemetry: SignalDiffTableTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
