//
//  selectedVehicle.ModelTests.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  State-holder coverage for `SelectedVehicleStoreModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / content / empty / error, the
//  web `useSelectedVehicle()` write-back effects (URL adoption + first-vehicle default on
//  load), the selection actions (select / select-candidate / clear), the cross-scene store
//  sync, the stale auto-refresh (once, re-armed on return to live), and offline keeping the
//  cached selection without refetching. Driven through the in-memory store + fleet source —
//  no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry
/// seam under Swift 6 strict concurrency.
private final class SpySelectedVehicleStoreTelemetry: SelectedVehicleStoreTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

private enum SelectedVehicleStoreSample {
    static let fleet: [SelectedVehicleStoreSummary] = [
        SelectedVehicleStoreSummary(id: 1, displayName: "Midnight Model 3"),
        SelectedVehicleStoreSummary(id: 2, displayName: "Pearl Model Y")
    ]

    static func loaded(
        urlVehicleId: Int? = nil,
        connection: SelectedVehicleStoreConnection = .live
    ) -> SelectedVehicleStoreUpdate {
        SelectedVehicleStoreUpdate(
            fleet: .loaded(fleet),
            urlVehicleId: urlVehicleId,
            connection: connection
        )
    }
}

@MainActor
final class SelectedVehicleStoreModelTests: XCTestCase {
    private func makeModel(
        store: SelectedVehicleStore,
        source: InMemorySelectedVehicleStoreFleetSource,
        telemetry: SpySelectedVehicleStoreTelemetry = SpySelectedVehicleStoreTelemetry()
    ) -> SelectedVehicleStoreModel {
        SelectedVehicleStoreModel(
            store: store,
            source: source,
            telemetry: telemetry,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpySelectedVehicleStoreTelemetry()
        let source = InMemorySelectedVehicleStoreFleetSource()
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
            source: source,
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["selectedVehicle"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContentWithStoredSelection() {
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 2)),
            source: source
        )
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.selected?.id, 2)
    }

    func testEmptyFleetResolvesEmpty() {
        let source = InMemorySelectedVehicleStoreFleetSource(
            initial: SelectedVehicleStoreUpdate(fleet: .loaded([]))
        )
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
            source: source
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.candidate)
    }

    func testFailedFleetResolvesError() {
        let source = InMemorySelectedVehicleStoreFleetSource(
            initial: SelectedVehicleStoreUpdate(fleet: .failed(message: "boom"))
        )
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
            source: source
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
        XCTAssertEqual(model.errorMessage, "boom")
    }

    func testFirstVehicleDefaultWritesFirstToStoreOnLoad() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage())
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        XCTAssertEqual(store.vehicleId, 1)
        XCTAssertEqual(model.selected?.id, 1)
    }

    func testUrlAdoptionWritesUrlIdToStore() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1))
        let source = InMemorySelectedVehicleStoreFleetSource(
            initial: SelectedVehicleStoreSample.loaded(urlVehicleId: 2)
        )
        let model = makeModel(store: store, source: source)
        model.start()
        XCTAssertEqual(store.vehicleId, 2)
        XCTAssertEqual(model.selected?.id, 2)
    }

    func testSelectActionUpdatesStore() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1))
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        model.select(2)
        XCTAssertEqual(store.vehicleId, 2)
        XCTAssertEqual(model.selected?.id, 2)
    }

    func testSelectCandidateSelectsFirstVehicle() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 99))
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.candidate?.id, 1)
        model.selectCandidate()
        XCTAssertEqual(store.vehicleId, 1)
        XCTAssertEqual(model.phase, .content)
    }

    func testClearSelectionClearsStore() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1))
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        model.clearSelection()
        XCTAssertNil(store.vehicleId)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1))
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SelectedVehicleStoreSample.loaded(connection: .stale))
        source.push(SelectedVehicleStoreSample.loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SelectedVehicleStoreSample.loaded(connection: .live))
        source.push(SelectedVehicleStoreSample.loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsSelectionAndDoesNotRefresh() {
        let store = SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1))
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        source.push(SelectedVehicleStoreSample.loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.selected?.id, 1)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopHaltsSourceAndAllowsRestart() {
        let source = InMemorySelectedVehicleStoreFleetSource()
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage()),
            source: source
        )
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testCrossSceneStorageChangeUpdatesSelection() {
        let storage = InMemorySelectedVehicleStorage(initial: 1)
        let store = SelectedVehicleStore(storage: storage)
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(store: store, source: source)
        model.start()
        XCTAssertEqual(model.selected?.id, 1)
        storage.simulateExternalChange(to: 2)
        XCTAssertEqual(store.vehicleId, 2)
        XCTAssertEqual(model.selected?.id, 2)
    }

    func testCopyDefaultsToEnglishFallbacks() {
        let source = InMemorySelectedVehicleStoreFleetSource(initial: SelectedVehicleStoreSample.loaded())
        let model = makeModel(
            store: SelectedVehicleStore(storage: InMemorySelectedVehicleStorage(initial: 1)),
            source: source
        )
        model.start()
        XCTAssertEqual(model.pageTitle, "Selected vehicle")
        XCTAssertEqual(model.clearLabel, "Clear selection")
        XCTAssertEqual(model.emptyTitle, "No vehicle selected")
        XCTAssertEqual(model.retryLabel, "Try again")
    }
}
