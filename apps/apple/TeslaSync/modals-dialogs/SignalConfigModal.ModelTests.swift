//
//  SignalConfigModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  State-holder coverage for `SignalConfigModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a cached catalog survives a failed reload), the draft build (catalog flatten +
//  initial selection + default cadence + seeded master interval / expanded set), the edit-preserving
//  rebuild rule (a freshness flip keeps edits; a catalog change rebuilds), the per-signal /
//  per-category / master / preset mutators, the search filter + in-list search-empty, the
//  expand / collapse, the submit guard + payload, the cancel seam, the stale auto-refresh (once,
//  re-armed on return to live), and offline keeping the cached catalog. Driven through the in-memory
//  source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpySignalConfigTelemetry: SignalConfigTelemetry, @unchecked Sendable {
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

/// Records the subscribe / cancel action seam calls + the last submitted payload.
private final class RecordingSignalConfigActions: SignalConfigActions, @unchecked Sendable {
    private let lock = NSLock()
    private var subscribes: [[SignalConfigSubscription]] = []
    private var cancels = 0

    func subscribe(_ subscriptions: [SignalConfigSubscription]) {
        lock.lock(); subscribes.append(subscriptions); lock.unlock()
    }

    func cancel() {
        lock.lock(); cancels += 1; lock.unlock()
    }

    var subscribeCalls: [[SignalConfigSubscription]] {
        lock.lock(); defer { lock.unlock() }
        return subscribes
    }

    var cancelCount: Int {
        lock.lock(); defer { lock.unlock() }
        return cancels
    }
}

private enum ModelSample {
    static func catalog() -> [SignalConfigCategoryCatalog] {
        [
            SignalConfigCategoryCatalog(category: "Driving", fields: ["Speed", "Gear"]),
            SignalConfigCategoryCatalog(category: "Charging", fields: ["Soc", "Volts"])
        ]
    }

    static func update(
        status: SignalConfigLoadStatus = .loaded,
        connection: SignalConfigConnection = .live,
        catalog: [SignalConfigCategoryCatalog]? = catalog(),
        selected: [String] = ["Speed"],
        interval: Int = 10
    ) -> SignalConfigUpdate {
        SignalConfigUpdate(
            status: status,
            catalog: catalog ?? [],
            initialSelected: selected,
            initialInterval: interval,
            connection: connection
        )
    }
}

@MainActor
final class SignalConfigModelTests: XCTestCase {
    private func makeModel(
        source: InMemorySignalConfigSource,
        telemetry: SpySignalConfigTelemetry = SpySignalConfigTelemetry(),
        actions: RecordingSignalConfigActions = RecordingSignalConfigActions()
    ) -> SignalConfigModel {
        SignalConfigModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpySignalConfigTelemetry()
        let source = InMemorySignalConfigSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SignalConfigModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Phases + draft build

    func testLoadingThenPopulatedBuildsDraft() {
        let source = InMemorySignalConfigSource(initial: SignalConfigUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ModelSample.update())
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.totalCount, 4)
        XCTAssertEqual(model.selectedCount, 1)
        XCTAssertEqual(model.globalInterval, 10)
        XCTAssertEqual(model.expandedCategories, ["Driving", "Charging"])
    }

    func testLoadedEmptyCatalogPhase() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update(catalog: nil))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.totalCount, 0)
    }

    func testFailedNoCatalogPhaseError() {
        let source = InMemorySignalConfigSource(
            initial: ModelSample.update(status: .failed("timeout"), catalog: nil)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithCachedCatalogKeepsPopulatedAndInlineError() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("stale read")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Draft preservation vs rebuild

    func testFreshnessFlipPreservesEdits() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.toggleSignal("Speed") // deselect the pre-selected row
        XCTAssertEqual(model.selectedCount, 0)
        // Same catalog, just a freshness flip → edits survive.
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(model.selectedCount, 0)
        XCTAssertEqual(model.connection, .stale)
    }

    func testCatalogChangeRebuildsDraft() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.toggleSignal("Speed")
        XCTAssertEqual(model.selectedCount, 0)
        // A different catalog (extra field) → rebuild from the new snapshot's initial selection.
        let bigger = [
            SignalConfigCategoryCatalog(category: "Driving", fields: ["Speed", "Gear", "Pedal"]),
            SignalConfigCategoryCatalog(category: "Charging", fields: ["Soc", "Volts"])
        ]
        source.push(ModelSample.update(catalog: bigger, selected: ["Speed"]))
        XCTAssertEqual(model.totalCount, 5)
        XCTAssertEqual(model.selectedCount, 1) // rebuilt: Speed selected again
    }

    // MARK: Mutators

    func testToggleSignalAndInterval() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: []))
        let model = makeModel(source: source)
        model.start()
        model.toggleSignal("Gear")
        XCTAssertEqual(model.selectedCount, 1)
        model.setSignalInterval("Gear", interval: 1)
        XCTAssertEqual(model.rows.first { $0.name == "Gear" }?.interval, 1)
    }

    func testToggleAllAndGlobalInterval() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: []))
        let model = makeModel(source: source)
        model.start()
        XCTAssertFalse(model.allSelected)
        model.toggleAll()
        XCTAssertTrue(model.allSelected)
        model.setGlobalInterval(60)
        XCTAssertEqual(model.globalInterval, 60)
        XCTAssertTrue(model.rows.allSatisfy { $0.interval == 60 })
    }

    func testToggleCategoryAndCategoryInterval() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: []))
        let model = makeModel(source: source)
        model.start()
        model.toggleCategory("Charging")
        XCTAssertEqual(model.categoryState("Charging"), .all)
        model.setCategoryInterval("Charging", interval: 5)
        XCTAssertTrue(model.rows.filter { $0.category == "Charging" }.allSatisfy { $0.interval == 5 })
        XCTAssertTrue(model.rows.filter { $0.category == "Driving" }.allSatisfy { $0.interval == 10 })
    }

    func testApplyPreset() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: []))
        let model = makeModel(source: source)
        model.start()
        model.applyPreset(.lowPower)
        XCTAssertTrue(model.allSelected)
        XCTAssertTrue(model.rows.allSatisfy { $0.interval == 60 })
    }

    // MARK: Search + expand

    func testSearchFiltersAndSearchEmpty() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setSearch("soc")
        XCTAssertEqual(model.filteredRows.map(\.name), ["Soc"])
        XCTAssertFalse(model.isSearchEmpty)
        model.setSearch("nothing-here")
        XCTAssertTrue(model.isSearchEmpty)
        XCTAssertTrue(model.groups.isEmpty)
    }

    func testToggleExpanded() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        XCTAssertTrue(model.isExpanded("Driving")) // seeded expanded
        model.toggleExpanded("Driving")
        XCTAssertFalse(model.isExpanded("Driving"))
        model.toggleExpanded("Driving")
        XCTAssertTrue(model.isExpanded("Driving"))
    }

    // MARK: Submit / cancel

    func testSubmitProjectsSelectedPayload() {
        let actions = RecordingSignalConfigActions()
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: ["Speed", "Soc"]))
        let model = makeModel(source: source, actions: actions)
        model.start()
        model.setSignalInterval("Soc", interval: 1)
        model.submit()
        XCTAssertEqual(actions.subscribeCalls.count, 1)
        let payload = actions.subscribeCalls[0].sorted { $0.name < $1.name }
        XCTAssertEqual(payload.map(\.name), ["Soc", "Speed"])
        XCTAssertEqual(payload.first { $0.name == "Soc" }?.interval, 1)
    }

    func testSubmitGuardedWhenNothingSelected() {
        let actions = RecordingSignalConfigActions()
        let source = InMemorySignalConfigSource(initial: ModelSample.update(selected: []))
        let model = makeModel(source: source, actions: actions)
        model.start()
        XCTAssertFalse(model.canSubmit)
        model.submit()
        XCTAssertTrue(actions.subscribeCalls.isEmpty)
    }

    func testCancelInvokesSeam() {
        let actions = RecordingSignalConfigActions()
        let model = makeModel(source: InMemorySignalConfigSource(), actions: actions)
        model.cancel()
        XCTAssertEqual(actions.cancelCount, 1)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ModelSample.update(connection: .stale))
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .live))
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCatalogAndDoesNotRefresh() {
        let source = InMemorySignalConfigSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
