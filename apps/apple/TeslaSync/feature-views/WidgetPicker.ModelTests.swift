//
//  WidgetPicker.ModelTests.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  Unit coverage for the `WidgetPickerModel` state holder: it seeds the active +
//  persisted-recents state, applies the web add/add-many/apply-preset mutations
//  (de-duping against seen/active/unknown), tracks the session-added list, persists
//  recents through the injected store (web localStorage), announces additions,
//  forwards added ids / chosen preset / close to the host, adds a lone search
//  result on submit, and emits the P1/S11 `view.opened` telemetry exactly once.
//

import XCTest
@testable import TeslaSync

@MainActor final class WidgetPickerModelTests: XCTestCase {
    private func model(
        active: [String] = [],
        store: SpyWidgetRecentsStore = SpyWidgetRecentsStore(),
        telemetry: SpyWidgetPickerTelemetry = SpyWidgetPickerTelemetry(),
        onAddWidgets: @escaping ([String]) -> Void = { _ in },
        onApplyPreset: @escaping (String) -> Void = { _ in },
        onClose: @escaping () -> Void = {}
    ) -> WidgetPickerModel {
        WidgetPickerModel(
            activeWidgetIDs: active,
            recentsStore: store,
            telemetry: telemetry,
            onAddWidgets: onAddWidgets,
            onApplyPreset: onApplyPreset,
            onClose: onClose
        )
    }

    func testInitSeedsFromStoreAndActive() {
        let model = model(active: ["battery-gauge"], store: SpyWidgetRecentsStore(["vehicle-hero"]))
        XCTAssertEqual(model.recentlyAddedIDs, ["vehicle-hero"])
        XCTAssertEqual(model.activeWidgetIDs, ["battery-gauge"])
        XCTAssertNil(model.categoryFilter)
        XCTAssertEqual(model.addedThisSessionIDs, [])
    }

    func testAddManyDeDupUpdatesStatePersistsAnnounces() {
        let store = SpyWidgetRecentsStore()
        let add = CaptureSpy()
        let model = model(store: store, onAddWidgets: add.capture)
        model.addMany(["battery-gauge", "battery-gauge", "range-estimate"])

        XCTAssertEqual(model.activeWidgetIDs, ["battery-gauge", "range-estimate"])
        XCTAssertEqual(model.addedThisSessionIDs, ["battery-gauge", "range-estimate"])
        XCTAssertEqual(model.recentlyAddedIDs, ["battery-gauge", "range-estimate"])
        XCTAssertEqual(store.saved, [["battery-gauge", "range-estimate"]])
        XCTAssertEqual(add.calls, [["battery-gauge", "range-estimate"]])
        XCTAssertEqual(model.announcement, "2 widgets added to dashboard")
        XCTAssertEqual(model.addedThisSessionCount, 2)
    }

    func testAddSingleAnnouncesByName() {
        let model = model()
        model.addMany(["battery-gauge"])
        XCTAssertEqual(model.announcement, "Battery Level added to dashboard")
    }

    func testAddManySkipsActiveAndUnknown() {
        let add = CaptureSpy()
        let model = model(active: ["battery-gauge"], onAddWidgets: add.capture)
        model.addMany(["battery-gauge", "not-a-widget"])
        XCTAssertEqual(model.addedThisSessionIDs, [])
        XCTAssertEqual(model.activeWidgetIDs, ["battery-gauge"])
        XCTAssertTrue(add.calls.isEmpty)
        XCTAssertEqual(model.announcement, "")
    }

    func testAddSingleClosesWhenRequested() throws {
        let close = CountSpy()
        let model = model(onClose: close.fire)
        let entry = try XCTUnwrap(WidgetCatalog.entry("battery-gauge"))
        model.add(entry, closeAfterAdd: true)
        XCTAssertTrue(model.activeWidgetIDs.contains("battery-gauge"))
        XCTAssertEqual(close.count, 1)
    }

    func testApplyPresetForwardsAndCloses() {
        let preset = StringCaptureSpy()
        let close = CountSpy()
        let model = model(onApplyPreset: preset.capture, onClose: close.fire)
        model.applyPreset("commuter")
        XCTAssertEqual(preset.values, ["commuter"])
        XCTAssertEqual(close.count, 1)
    }

    func testSelectCategoryHidesRecentlyAdded() {
        let model = model(store: SpyWidgetRecentsStore(["vehicle-hero"]))
        XCTAssertEqual(model.recentlyAddedVisible.map(\.id), ["vehicle-hero"])
        model.selectCategory(.battery)
        XCTAssertEqual(model.categoryFilter, .battery)
        XCTAssertTrue(model.recentlyAddedVisible.isEmpty)
    }

    func testSubmitSearchAddsLoneResult() {
        let model = model()
        model.search = "odometer counter"
        XCTAssertEqual(model.addableSearchWidgets.count, 1)
        model.submitSearch()
        XCTAssertTrue(model.activeWidgetIDs.contains("odometer-counter"))
    }

    func testSubmitSearchNoOpWhenAmbiguous() {
        let model = model()
        model.search = "battery"
        let before = model.activeWidgetIDs
        model.submitSearch()
        XCTAssertEqual(model.activeWidgetIDs, before)
    }

    func testClearSearch() {
        let model = model()
        model.search = "abc"
        model.clearSearch()
        XCTAssertEqual(model.search, "")
    }

    func testStartEmitsViewOpenedOnce() {
        let telemetry = SpyWidgetPickerTelemetry()
        let model = model(telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [WidgetPickerSurface.slug])
        XCTAssertEqual(WidgetPickerSurface.slug, "WidgetPicker")
    }

    func testDerivedProjections() {
        let model = model()
        XCTAssertEqual(model.filteredWidgets.count, 118)
        XCTAssertEqual(model.availableCategories.count, 16)
        XCTAssertEqual(model.groupedEntries.count, 16)
        model.search = "  Charge "
        XCTAssertEqual(model.query, "charge")
        XCTAssertEqual(model.trimmedSearch, "Charge")
        XCTAssertEqual(model.visibleWidgets, model.filteredWidgets)
    }
}

// MARK: - Spies (single-threaded test use only)

/// Records the surfaces a model reports as opened.
final class SpyWidgetPickerTelemetry: WidgetPickerTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// An in-memory recents store that records every save.
final class SpyWidgetRecentsStore: WidgetRecentsStore, @unchecked Sendable {
    private(set) var stored: [String]
    private(set) var saved: [[String]] = []

    init(_ stored: [String] = []) {
        self.stored = stored
    }

    func load() -> [String] {
        stored
    }

    func save(_ ids: [String]) {
        stored = ids
        saved.append(ids)
    }
}

/// Captures each `[String]` callback emission.
final class CaptureSpy: @unchecked Sendable {
    private(set) var calls: [[String]] = []

    func capture(_ ids: [String]) {
        calls.append(ids)
    }
}

/// Captures each `String` callback value.
final class StringCaptureSpy: @unchecked Sendable {
    private(set) var values: [String] = []

    func capture(_ value: String) {
        values.append(value)
    }
}

/// Counts no-argument callback fires.
final class CountSpy: @unchecked Sendable {
    private(set) var count = 0

    func fire() {
        count += 1
    }
}
