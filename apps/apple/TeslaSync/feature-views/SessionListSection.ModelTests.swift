//
//  SessionListSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  State-holder coverage for `SessionListModel`, split from
//  SessionListSection.Tests.swift for the lint length budget. Drives the model
//  through `InMemorySessionListSource` and the spies defined alongside the adapter
//  tests (same XCTest target): phase resolution, the P1/S11 `view.opened` telemetry,
//  the control intents (search / charger filter / sort / pagination), selection +
//  bulk delete, export, the stale auto-refresh, offline behavior, and selection
//  pruning on refresh. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder

@MainActor
final class SessionListModelTests: XCTestCase {
    private func sampleItems() -> [SessionListItem] {
        let base = Date(timeIntervalSince1970: 1_000_000)
        return [
            SessionListItem(
                id: 1, startedAt: base, endedAt: base.addingTimeInterval(2700),
                startSocPct: 24, endSocPct: 78, energyAddedWh: 41000, peakPowerW: 150_000,
                costDecimal: 12, chargerType: "Supercharger", startPlace: "Gilroy"
            ),
            SessionListItem(
                id: 2, startedAt: base.addingTimeInterval(-86400), endedAt: base.addingTimeInterval(-83000),
                startSocPct: 40, endSocPct: 90, energyAddedWh: 30000, costDecimal: 0,
                chargerType: "Home AC", startPlace: "Home"
            )
        ]
    }

    private func makeModel(
        initial: SessionListUpdate?,
        telemetry: SessionListTelemetry = SpySessionListTelemetry(),
        exporter: SessionListExporter = SpySessionListExporter(),
        deleter: (any SessionListDeleter)? = nil
    ) -> (SessionListModel, InMemorySessionListSource) {
        let source = InMemorySessionListSource(initial: initial)
        let model = SessionListModel(
            source: source, telemetry: telemetry, exporter: exporter, deleter: deleter
        )
        return (model, source)
    }

    func testLoadedContentProjectsRows() {
        let (model, source) = makeModel(initial: SessionListUpdate(status: .loaded, items: sampleItems()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalCount, 2)
        XCTAssertEqual(model.filteredCount, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: []))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(initial: SessionListUpdate(status: .loading, items: []))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(initial: SessionListUpdate(status: .failed("boom"), items: []))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySessionListTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SessionListSurface.slug])
    }

    func testSearchFiltersAndResetsPage() {
        let (model, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: sampleItems()))
        model.start()
        model.setPage(2)
        model.setSearchQuery("home")
        XCTAssertEqual(model.filteredCount, 1)
        XCTAssertEqual(model.pagedItems.map(\.id), [2])
        XCTAssertEqual(model.page, 1)
    }

    func testChargerFilterAndNoMatches() {
        let (model, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: sampleItems()))
        model.start()
        model.setChargerFilter(.dc)
        XCTAssertEqual(model.filteredCount, 0)
        XCTAssertTrue(model.hasNoMatches)
    }

    func testSelectSortTogglesDirection() {
        let (model, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: sampleItems()))
        model.start()
        XCTAssertEqual(model.sortKey, .date)
        XCTAssertTrue(model.sortDescending)
        model.selectSort(.date)
        XCTAssertFalse(model.sortDescending)
        model.selectSort(.energy)
        XCTAssertEqual(model.sortKey, .energy)
        XCTAssertTrue(model.sortDescending)
    }

    func testActiveFilterChips() {
        let (model, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: sampleItems()))
        model.start()
        model.setSearchQuery("gil")
        model.setChargerFilter(.supercharger)
        XCTAssertEqual(model.activeFilterChips.map(\.kind), [.search, .charger])
        model.clearAllFilters()
        XCTAssertTrue(model.activeFilterChips.isEmpty)
        XCTAssertEqual(model.chargerFilter, .all)
        XCTAssertTrue(model.searchQuery.isEmpty)
    }

    func testSelectionAndBulkDelete() async {
        let deleter = SpySessionListDeleter()
        let (model, _) = makeModel(
            initial: SessionListUpdate(status: .loaded, items: sampleItems()), deleter: deleter
        )
        model.start()
        XCTAssertTrue(model.supportsBulkActions)
        model.toggleSelection(id: 1, on: true)
        model.toggleSelection(id: 2, on: true)
        model.toggleSelection(id: 2, on: false)
        XCTAssertEqual(model.selectedCount, 1)
        await model.deleteSelected()
        XCTAssertEqual(deleter.deleted, [[1]])
        XCTAssertFalse(model.hasSelection)
    }

    func testDeleteConfirmTitlePluralizes() {
        let deleter = SpySessionListDeleter()
        let (model, _) = makeModel(
            initial: SessionListUpdate(status: .loaded, items: sampleItems()), deleter: deleter
        )
        model.start()
        model.toggleSelection(id: 1, on: true)
        XCTAssertEqual(model.deleteConfirmTitle, "Delete 1 charging session?")
        model.toggleSelection(id: 2, on: true)
        XCTAssertEqual(model.deleteConfirmTitle, "Delete 2 charging sessions?")
    }

    func testPaginationNextPreviousAndPageSize() {
        let many = (1 ... 25).map { id in
            SessionListItem(id: id, startedAt: Date(timeIntervalSince1970: TimeInterval(id)))
        }
        let (model, _) = makeModel(initial: SessionListUpdate(status: .loaded, items: many))
        model.start()
        XCTAssertEqual(model.pageWindow.pageCount, 3)
        XCTAssertEqual(model.pagedItems.count, 10)
        model.nextPage()
        XCTAssertEqual(model.page, 2)
        model.previousPage()
        XCTAssertEqual(model.page, 1)
        model.setPageSize(50)
        XCTAssertEqual(model.pageSize, 50)
        XCTAssertEqual(model.pagedItems.count, 25)
        XCTAssertEqual(model.page, 1)
    }

    func testExportInvokesExporterWithRequestPath() {
        let exporter = SpySessionListExporter()
        let update = SessionListUpdate(
            status: .loaded, items: sampleItems(),
            exportContext: SessionExportContext(startDate: "2026-01-01", endDate: "2026-06-01", vehicleID: 7)
        )
        let (model, _) = makeModel(initial: update, exporter: exporter)
        model.start()
        model.export(.csv)
        XCTAssertEqual(exporter.requests.count, 1)
        XCTAssertEqual(exporter.requests.first?.format, .csv)
        XCTAssertEqual(
            exporter.requests.first?.request,
            "/api/v1/export/charging?format=csv&start=2026-01-01&end=2026-06-01&vehicle_id=7"
        )
    }

    func testStaleAutoRefreshesExactlyOnceAndReArms() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SessionListUpdate(status: .loaded, items: sampleItems(), connection: .stale))
        source.push(SessionListUpdate(status: .loaded, items: sampleItems(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SessionListUpdate(status: .loaded, items: sampleItems(), connection: .live))
        source.push(SessionListUpdate(status: .loaded, items: sampleItems(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedRowsWithoutRefetch() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SessionListUpdate(status: .loaded, items: sampleItems(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.filteredCount, 2)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshPrunesStaleSelection() {
        let deleter = SpySessionListDeleter()
        let (model, source) = makeModel(
            initial: SessionListUpdate(status: .loaded, items: sampleItems()), deleter: deleter
        )
        model.start()
        model.toggleSelection(id: 1, on: true)
        model.toggleSelection(id: 2, on: true)
        source.push(SessionListUpdate(status: .loaded, items: [sampleItems()[1]]))
        XCTAssertEqual(model.selectedIDs, [2])
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
