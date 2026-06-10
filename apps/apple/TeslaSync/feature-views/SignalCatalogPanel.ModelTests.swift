//
//  SignalCatalogPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  State-holder coverage for `SignalCatalogPanelModel`: phase resolution across
//  loading / empty / error / content, the P1/S11 `view.opened` telemetry, the
//  search + filter-mode + sort-mode wiring, and the optional chip selection (with
//  its max cap). Driven by `InMemorySignalCatalogPanelSource` with an injected
//  clock — no network, no real store. (Split from SignalCatalogPanel.Tests.swift
//  to respect the 400-line house file length.)
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func iso(_ secondsAgo: TimeInterval) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: fixedNow.addingTimeInterval(-secondsAgo))
}

// MARK: - State holder: phases + telemetry + wiring + selection

@MainActor
final class SignalCatalogPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalCatalogPanelUpdate,
        telemetry: SignalCatalogPanelTelemetry = OSLogSignalCatalogPanelTelemetry(),
        selection: SignalCatalogPanelSelectionConfig? = nil
    ) -> (SignalCatalogPanelModel, InMemorySignalCatalogPanelSource) {
        let source = InMemorySignalCatalogPanelSource(initial: update)
        let model = SignalCatalogPanelModel(
            source: source,
            telemetry: telemetry,
            selection: selection,
            now: { fixedNow }
        )
        return (model, source)
    }

    private func entries() -> [SignalCatalogPanelEntry] {
        [
            SignalCatalogPanelEntry(name: "vehicle_speed", payload: .envelope(value: .number(42), timestamp: iso(5))),
            SignalCatalogPanelEntry(
                name: "battery_level",
                payload: .envelope(value: .number(78.5), timestamp: iso(600))
            ),
            SignalCatalogPanelEntry(name: "locked", payload: .bare(.bool(true)))
        ]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isFetching)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.summary, .zero)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhenFailed() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .failed("net"), entries: entries()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.summary.total, 3)
        XCTAssertEqual(model.summary.active, 1)
        XCTAssertEqual(model.summary.stale, 1)
        XCTAssertEqual(model.summary.never, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySignalCatalogPanelTelemetry()
        let (model, source) = makeModel(SignalCatalogPanelUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalCatalogPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(SignalCatalogPanelUpdate(status: .loaded))
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
        let (model, source) = makeModel(SignalCatalogPanelUpdate(status: .loading))
        model.start()
        source.push(SignalCatalogPanelUpdate(
            status: .loaded,
            connection: .offline,
            entries: entries(),
            updatedAt: fixedNow
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 3)
        XCTAssertFalse(model.isFetching)
    }

    func testSearchAndSortDriveDisplayedRows() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loaded, entries: entries()))
        model.start()
        // Default sort is staleness-descending: never (locked) first.
        XCTAssertEqual(model.displayedRows.first?.name, "locked")
        model.search = "speed"
        XCTAssertEqual(model.displayedRows.map(\.name), ["vehicle_speed"])
        model.search = ""
        model.setSortMode(.alpha)
        XCTAssertEqual(model.displayedRows.map(\.name), ["battery_level", "locked", "vehicle_speed"])
    }

    func testFilterModeHidesRowsAndFlagsHidden() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loaded, entries: entries()))
        model.start()
        model.setFilterMode(.active)
        XCTAssertEqual(model.displayedRows.map(\.name), ["vehicle_speed"])
        model.search = "nonexistent"
        XCTAssertTrue(model.displayedRows.isEmpty)
        XCTAssertTrue(model.hasHiddenRows)
    }

    func testSelectionTogglesRespectMaxCap() {
        var toggled: [String] = []
        let selection = SignalCatalogPanelSelectionConfig(selected: [], max: 2, onToggle: { toggled.append($0) })
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loaded, entries: entries()), selection: selection)
        model.start()
        XCTAssertTrue(model.selectionEnabled)
        model.toggleSelection("vehicle_speed")
        model.toggleSelection("battery_level")
        XCTAssertEqual(model.selectedSignals, ["vehicle_speed", "battery_level"])
        XCTAssertFalse(model.canToggleSelection("locked"))
        model.toggleSelection("locked")
        XCTAssertFalse(model.isSelected("locked"))
        model.toggleSelection("vehicle_speed")
        XCTAssertFalse(model.isSelected("vehicle_speed"))
        XCTAssertTrue(model.canToggleSelection("locked"))
        XCTAssertEqual(toggled, ["vehicle_speed", "battery_level", "vehicle_speed"])
    }

    func testSelectionDisabledWhenNoConfig() {
        let (model, _) = makeModel(SignalCatalogPanelUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertFalse(model.selectionEnabled)
        XCTAssertTrue(model.canToggleSelection("vehicle_speed"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalCatalogPanelTelemetry: SignalCatalogPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
