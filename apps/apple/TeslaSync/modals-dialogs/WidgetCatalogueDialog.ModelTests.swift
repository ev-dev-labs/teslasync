//
//  WidgetCatalogueDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  State-holder coverage for `WidgetCatalogueModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a cached catalogue survives a failed reload), the grouped sections + counts, the search
//  filter (by name / category label / no-match) with the result-count + search-empty derivation and the
//  clear-search reset, the added-state lookup, the add seam (guarded for already-added) + the close seam,
//  the stale auto-refresh (once, re-armed on return to live), offline keeping the cached catalogue, and
//  the interpolated subtitle / result-count copy. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyWidgetCatalogueTelemetry: WidgetCatalogueTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

/// Records the add / close action seam calls.
private final class RecordingWidgetCatalogueActions: WidgetCatalogueActions, @unchecked Sendable {
    private let lock = NSLock()
    private var adds: [String] = []
    private var closes = 0

    func add(widgetID: String) {
        lock.lock(); adds.append(widgetID); lock.unlock()
    }

    func close() {
        lock.lock(); closes += 1; lock.unlock()
    }

    var addCalls: [String] {
        lock.lock(); defer { lock.unlock() }
        return adds
    }

    var closeCount: Int {
        lock.lock(); defer { lock.unlock() }
        return closes
    }
}

private enum ModelSample {
    static func entry(
        _ id: String,
        _ name: String,
        _ category: WidgetCatalogueCategory,
        _ description: String
    ) -> WidgetCatalogueEntry {
        WidgetCatalogueEntry(id: id, name: name, category: category, iconSystemName: "circle", description: description)
    }

    static let entries: [WidgetCatalogueEntry] = [
        entry("battery-gauge", "Battery Level", .battery, "Battery percentage radial gauge"),
        entry("range-estimate", "Range Estimate", .battery, "Rated and ideal range"),
        entry("vehicle-hero", "Vehicle Card", .vehicle, "Name, model, state"),
        entry("location-map", "Location Map", .maps, "Where the car is")
    ]

    static func update(
        status: WidgetCatalogueLoadStatus = .loaded,
        connection: WidgetCatalogueConnection = .live,
        entries: [WidgetCatalogueEntry] = entries,
        active: [String] = ["battery-gauge"]
    ) -> WidgetCatalogueUpdate {
        WidgetCatalogueUpdate(
            status: status,
            entries: entries,
            activeWidgetIDs: active,
            connection: connection
        )
    }
}

@MainActor
final class WidgetCatalogueModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryWidgetCatalogueSource,
        telemetry: SpyWidgetCatalogueTelemetry = SpyWidgetCatalogueTelemetry(),
        actions: RecordingWidgetCatalogueActions = RecordingWidgetCatalogueActions()
    ) -> WidgetCatalogueModel {
        WidgetCatalogueModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyWidgetCatalogueTelemetry()
        let model = makeModel(
            source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["WidgetCatalogueDialog"])
    }

    // MARK: Phase

    func testLoadingWithoutEntriesIsLoadingPhase() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(
            initial: ModelSample.update(status: .loading, entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithEntriesIsPopulated() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.phase, .populated)
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testLoadedWithoutEntriesIsEmpty() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(
            initial: ModelSample.update(status: .loaded, entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutEntriesIsError() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(
            initial: ModelSample.update(status: .failed("boom"), entries: [])
        ))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedReloadWithEntriesKeepsCatalogueAndShowsInlineError() {
        let source = InMemoryWidgetCatalogueSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("reload failed")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    // MARK: Counts + grouping

    func testCountsAndGroupOrder() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.totalCount, 4)
        XCTAssertEqual(model.addedCount, 1)
        XCTAssertEqual(model.groups.map(\.category), [.vehicle, .battery, .maps])
    }

    func testIsAddedReflectsActiveSet() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        XCTAssertTrue(model.isAdded("battery-gauge"))
        XCTAssertFalse(model.isAdded("vehicle-hero"))
    }

    // MARK: Search

    func testSearchFiltersByName() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        model.setQuery("Range Estimate")
        XCTAssertTrue(model.isFiltering)
        XCTAssertEqual(model.visibleCount, 1)
        XCTAssertEqual(model.groups.flatMap { $0.entries.map(\.id) }, ["range-estimate"])
        XCTAssertFalse(model.isSearchEmpty)
    }

    func testSearchByCategoryLabelKeepsWholeCategory() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        model.setQuery("battery")
        // "battery" hits the "Battery & Range" category label → both battery widgets retained.
        let battery = model.groups.first { $0.category == .battery }
        XCTAssertEqual(battery?.entries.count, 2)
        XCTAssertEqual(model.visibleCount, 2)
    }

    func testSearchNoMatchIsSearchEmpty() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        model.setQuery("zzzznope")
        XCTAssertTrue(model.isSearchEmpty)
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertEqual(model.visibleCount, 0)
    }

    func testClearSearchRestoresCatalogue() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        model.setQuery("zzzznope")
        model.clearSearch()
        XCTAssertEqual(model.query, "")
        XCTAssertFalse(model.isSearchEmpty)
        XCTAssertEqual(model.groups.count, 3)
    }

    func testInterpolatedCopy() {
        let model = makeModel(source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()))
        model.start()
        XCTAssertTrue(model.subtitleText.contains("1 of 4"))
        model.setQuery("estimate")
        XCTAssertEqual(model.resultCountText, "1 of 4 widgets match")
    }

    // MARK: Add / close seams

    func testAddCommitsAddableWidgetAndReportsTrue() {
        let actions = RecordingWidgetCatalogueActions()
        let model = makeModel(
            source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        XCTAssertTrue(model.add("vehicle-hero"))
        XCTAssertEqual(actions.addCalls, ["vehicle-hero"])
    }

    func testAddIsNoOpForAlreadyAddedWidget() {
        let actions = RecordingWidgetCatalogueActions()
        let model = makeModel(
            source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        XCTAssertFalse(model.add("battery-gauge"))
        XCTAssertTrue(actions.addCalls.isEmpty)
    }

    func testCloseRecordsIntent() {
        let actions = RecordingWidgetCatalogueActions()
        let model = makeModel(
            source: InMemoryWidgetCatalogueSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.close()
        XCTAssertEqual(actions.closeCount, 1)
    }

    // MARK: Auto-refresh

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let source = InMemoryWidgetCatalogueSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .live))
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryWidgetCatalogueSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testStopStopsSource() {
        let source = InMemoryWidgetCatalogueSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
