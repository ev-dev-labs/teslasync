//
//  TimeMachineBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  State-holder coverage for `TimeMachineBannerModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state (loading / empty / error /
//  data), the picker toggle + open affordance (web `setPickerOpen` + `TIME_MACHINE_OPEN_PICKER_EVENT`),
//  the submit + return-to-live writes (web `setAsOf` / `clear`), the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live), offline
//  keeping the cached snapshot, the default source over the as-of store, and the store contract
//  (`UserDefaults` RFC 3339 round-trip + malformed-drop). Driven through the in-memory + static seams —
//  no real persistence.
//

import XCTest
@testable import TeslaSync

@MainActor
final class TimeMachineBannerModelTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_731_421_800)

    private func makeModel(
        _ input: TimeMachineInput,
        pickerOpen: Bool = false,
        telemetry: TimeMachineBannerTelemetry = OSLogTimeMachineBannerTelemetry()
    ) -> (TimeMachineBannerModel, InMemoryTimeMachineBannerSource) {
        let source = InMemoryTimeMachineBannerSource(initial: input)
        let model = TimeMachineBannerModel(source: source, telemetry: telemetry, pickerOpen: pickerOpen)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTimeMachineTelemetry()
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.currentAsOf, anchor)
        XCTAssertTrue(model.resolved.data?.isHistorical ?? false)
        XCTAssertEqual(spy.surfaces, [TimeMachineBannerModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLivePickerClosedProjectsEmpty() {
        let (model, _) = makeModel(TimeMachineInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testOpenPickerInLiveProjectsData() {
        let (model, _) = makeModel(TimeMachineInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        model.openPicker()
        XCTAssertTrue(model.pickerOpen)
        XCTAssertEqual(model.phase, .data)
        XCTAssertFalse(model.resolved.data?.isHistorical ?? true)
    }

    func testTogglePickerFlipsState() {
        let (model, _) = makeModel(TimeMachineInput())
        model.start()
        model.togglePicker()
        XCTAssertTrue(model.pickerOpen)
        XCTAssertEqual(model.phase, .data)
        model.togglePicker()
        XCTAssertFalse(model.pickerOpen)
        XCTAssertEqual(model.phase, .empty)
    }

    func testSubmitWritesAnchorAndClosesPicker() {
        let (model, source) = makeModel(TimeMachineInput(), pickerOpen: true)
        model.start()
        model.submit(anchor)
        XCTAssertEqual(source.setAsOfValues.count, 1)
        XCTAssertEqual(source.setAsOfValues.first ?? nil, anchor)
        XCTAssertFalse(model.pickerOpen)
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.resolved.data?.isHistorical ?? false)
        XCTAssertEqual(model.currentAsOf, anchor)
    }

    func testReturnToLiveClearsAnchorAndClosesPicker() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor), pickerOpen: true)
        model.start()
        model.returnToLive()
        XCTAssertEqual(source.clearCount, 1)
        XCTAssertFalse(model.pickerOpen)
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.currentAsOf)
    }

    func testLoadingThenPushToData() {
        let (model, source) = makeModel(TimeMachineInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(TimeMachineInput(asOf: anchor))
        XCTAssertEqual(model.phase, .data)
    }

    func testErrorInputProjectsError() {
        let (model, _) = makeModel(TimeMachineInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(TimeMachineInput(asOf: anchor, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(TimeMachineInput(asOf: anchor, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor))
        model.start()
        source.push(TimeMachineInput(asOf: anchor, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(TimeMachineInput(asOf: anchor, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(TimeMachineInput(asOf: anchor, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsDataAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor))
        model.start()
        source.push(TimeMachineInput(asOf: anchor, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopReArms() {
        let (model, source) = makeModel(TimeMachineInput(asOf: anchor))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TimeMachineBannerModel.surfaceSlug, "TimeMachineBanner")
    }
}

// MARK: - Default source (production — over the as-of store)

@MainActor
final class DefaultTimeMachineBannerSourceTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_731_421_800)

    func testStartEmitsStoreAnchor() {
        let store = InMemoryAsOfDateStore(asOf: anchor)
        let source = DefaultTimeMachineBannerSource(store: store)
        var inputs: [TimeMachineInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.asOf, anchor)
    }

    func testSetAsOfPersistsAndReEmits() {
        let store = InMemoryAsOfDateStore()
        let source = DefaultTimeMachineBannerSource(store: store)
        var inputs: [TimeMachineInput] = []
        source.onUpdate = { inputs.append($0) }
        source.setAsOf(anchor)
        XCTAssertEqual(store.setCount, 1)
        XCTAssertEqual(store.asOf, anchor)
        XCTAssertEqual(inputs.last?.asOf, anchor)
    }

    func testClearPersistsNilAndReEmits() {
        let store = InMemoryAsOfDateStore(asOf: anchor)
        let source = DefaultTimeMachineBannerSource(store: store)
        var inputs: [TimeMachineInput] = []
        source.onUpdate = { inputs.append($0) }
        source.clear()
        XCTAssertNil(store.asOf)
        XCTAssertEqual(inputs.last?.asOf, nil)
    }
}

// MARK: - As-of store (web `useAsOfDate` `?as_of=` URL state)

@MainActor
final class AsOfDateStoreTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_731_421_800)

    func testUserDefaultsStoreRoundTripsRfc3339() throws {
        let suiteName = "timeMachine.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsAsOfDateStore(defaults: defaults)
        XCTAssertNil(store.asOf)

        store.setAsOf(anchor)
        let stored = try XCTUnwrap(defaults.string(forKey: UserDefaultsAsOfDateStore.storageKey))
        XCTAssertTrue(TimeMachineRfc3339.isValid(stored))
        let readBack = try XCTUnwrap(store.asOf)
        XCTAssertEqual(TimeMachineRfc3339.format(readBack), stored)

        store.setAsOf(nil)
        XCTAssertNil(store.asOf)
        XCTAssertNil(defaults.string(forKey: UserDefaultsAsOfDateStore.storageKey))
    }

    func testUserDefaultsStoreDropsMalformedStoredValue() throws {
        let suiteName = "timeMachine.test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        // A garbage value (web `looksLikeIso` would reject it) must not propagate as an anchor.
        defaults.set("definitely-not-a-timestamp", forKey: UserDefaultsAsOfDateStore.storageKey)
        let store = UserDefaultsAsOfDateStore(defaults: defaults)
        XCTAssertNil(store.asOf)
    }

    func testStorageKeyIsVersioned() {
        XCTAssertEqual(UserDefaultsAsOfDateStore.storageKey, "teslasync:time-machine:as-of:v1")
    }

    func testInMemoryStoreCountsWrites() {
        let store = InMemoryAsOfDateStore()
        store.setAsOf(anchor)
        XCTAssertEqual(store.asOf, anchor)
        XCTAssertEqual(store.setCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTimeMachineTelemetry: TimeMachineBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
