//
//  WidgetSettingsModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  State-holder coverage for `WidgetSettingsModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a resolved widget survives a failed vehicle-list reload), the draft build (config
//  seeded from the descriptor), the edit-preserving rebuild rule (a freshness flip keeps edits; a new
//  widget identity rebuilds), the category-driven section visibility, the per-field mutators, the
//  show-title default-on, the save commit seam, the save guard with no widget, the cancel seam, the
//  header-title interpolation + fallback, the stale auto-refresh (once, re-armed on return to live),
//  and offline keeping the cached vehicle list. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyWidgetSettingsTelemetry: WidgetSettingsTelemetry, @unchecked Sendable {
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

/// Records the commit / cancel action seam calls + the last committed config.
private final class RecordingWidgetSettingsActions: WidgetSettingsActions, @unchecked Sendable {
    private let lock = NSLock()
    private var commits: [WidgetSettingsCommit] = []
    private var cancels = 0

    func commit(_ change: WidgetSettingsCommit) {
        lock.lock(); commits.append(change); lock.unlock()
    }

    func cancel() {
        lock.lock(); cancels += 1; lock.unlock()
    }

    var commitCalls: [WidgetSettingsCommit] {
        lock.lock(); defer { lock.unlock() }
        return commits
    }

    var cancelCount: Int {
        lock.lock(); defer { lock.unlock() }
        return cancels
    }
}

private enum ModelSample {
    static func widget(
        id: String = "widget-1",
        name: String = "Battery Health",
        category: WidgetSettingsCategory = .battery,
        config: WidgetConfigValues = WidgetConfigValues(
            vehicleID: 2,
            refreshRate: 30,
            timeRange: "30d",
            showTitle: true
        )
    ) -> WidgetDescriptor {
        WidgetDescriptor(id: id, definitionID: "battery-health", name: name, category: category, config: config)
    }

    static func vehicles() -> [WidgetVehicleOption] {
        [
            WidgetVehicleOption(id: 1, displayName: "Model 3"),
            WidgetVehicleOption(id: 2, displayName: "Model Y")
        ]
    }

    static func update(
        status: WidgetSettingsLoadStatus = .loaded,
        connection: WidgetSettingsConnection = .live,
        widget: WidgetDescriptor? = widget(),
        vehicles: [WidgetVehicleOption] = vehicles()
    ) -> WidgetSettingsUpdate {
        WidgetSettingsUpdate(status: status, widget: widget, vehicles: vehicles, connection: connection)
    }
}

@MainActor
final class WidgetSettingsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryWidgetSettingsSource,
        telemetry: SpyWidgetSettingsTelemetry = SpyWidgetSettingsTelemetry(),
        actions: RecordingWidgetSettingsActions = RecordingWidgetSettingsActions()
    ) -> WidgetSettingsModel {
        WidgetSettingsModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyWidgetSettingsTelemetry()
        let model = makeModel(
            source: InMemoryWidgetSettingsSource(initial: ModelSample.update()),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["WidgetSettingsModal"])
    }

    // MARK: Phase

    func testLoadingWithoutWidgetIsLoadingPhase() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(
            initial: ModelSample.update(status: .loading, widget: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithWidgetIsPopulated() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.phase, .populated)
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testLoadedWithoutWidgetIsEmpty() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(
            initial: ModelSample.update(status: .loaded, widget: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutWidgetIsError() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(
            initial: ModelSample.update(status: .failed("boom"), widget: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedReloadWithWidgetKeepsFormAndShowsInlineError() {
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("reload failed")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    // MARK: Draft build

    func testDraftSeededFromConfig() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.draft.vehicleID, 2)
        XCTAssertEqual(model.draft.refreshRate, 30)
        XCTAssertEqual(model.draft.timeRange, "30d")
        XCTAssertEqual(model.draft.showTitle, true)
    }

    func testSelectedVehicleNameResolvesFromList() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.selectedVehicleName, "Model Y")
        model.setVehicleID(nil)
        XCTAssertNil(model.selectedVehicleName)
    }

    // MARK: Edit-preserving rebuild

    func testFreshnessFlipPreservesEdits() {
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setVehicleID(1)
        model.setRefreshRate(60)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(model.draft.vehicleID, 1)
        XCTAssertEqual(model.draft.refreshRate, 60)
    }

    func testNewWidgetIdentityRebuildsDraft() {
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setRefreshRate(60)
        source.push(ModelSample.update(widget: ModelSample.widget(id: "widget-2", name: "Tire Pressure")))
        XCTAssertEqual(model.draft.refreshRate, 30)
    }

    // MARK: Section visibility (web isVehicleWidget / isChartWidget)

    func testSectionVisibilityForBatteryWidget() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertTrue(model.showsVehicleSection)
        XCTAssertTrue(model.showsTimeRangeSection)
    }

    func testSectionVisibilityForSystemWidget() {
        let widget = ModelSample.widget(category: .system)
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update(widget: widget)))
        model.start()
        XCTAssertFalse(model.showsVehicleSection)
        XCTAssertFalse(model.showsTimeRangeSection)
    }

    func testSectionVisibilityForAnalyticsWidget() {
        let widget = ModelSample.widget(category: .analytics)
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update(widget: widget)))
        model.start()
        XCTAssertFalse(model.showsVehicleSection)
        XCTAssertTrue(model.showsTimeRangeSection)
    }

    // MARK: Mutators

    func testFieldMutators() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        model.setVehicleID(1)
        model.setRefreshRate(15)
        model.setTimeRange("90d")
        model.setShowTitle(false)
        XCTAssertEqual(model.draft.vehicleID, 1)
        XCTAssertEqual(model.draft.refreshRate, 15)
        XCTAssertEqual(model.draft.timeRange, "90d")
        XCTAssertEqual(model.draft.showTitle, false)
        XCTAssertFalse(model.showTitleChecked)
    }

    func testShowTitleDefaultsOnWhenUnset() {
        let widget = ModelSample.widget(config: WidgetConfigValues(refreshRate: 5))
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update(widget: widget)))
        model.start()
        XCTAssertNil(model.draft.showTitle)
        XCTAssertTrue(model.showTitleChecked)
    }

    func testTimeRangeValueDefaultsToSevenDays() {
        let widget = ModelSample.widget(config: WidgetConfigValues(refreshRate: 5))
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update(widget: widget)))
        model.start()
        XCTAssertEqual(model.timeRangeValue, "7d")
    }

    func testIsDirtyReflectsEdits() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertFalse(model.isDirty)
        model.setRefreshRate(5)
        XCTAssertTrue(model.isDirty)
    }

    // MARK: Header title

    func testHeaderTitleInterpolatesWidgetName() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.headerTitle, "Battery Health Settings")
    }

    func testHeaderTitleFallsBackWithoutWidget() {
        let model = makeModel(source: InMemoryWidgetSettingsSource(
            initial: ModelSample.update(status: .loading, widget: nil)
        ))
        model.start()
        XCTAssertEqual(model.headerTitle, "Widget Settings")
    }

    func testVehicleLabelFallsBackForBlankName() {
        let update = ModelSample.update(vehicles: [WidgetVehicleOption(id: 7, displayName: "  ")])
        let model = makeModel(source: InMemoryWidgetSettingsSource(initial: update))
        model.start()
        XCTAssertEqual(model.vehicleLabel(WidgetVehicleOption(id: 7, displayName: "  ")), "Vehicle 7")
    }

    // MARK: Save / cancel seams

    func testSaveCommitsConfig() {
        let actions = RecordingWidgetSettingsActions()
        let model = makeModel(
            source: InMemoryWidgetSettingsSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.setVehicleID(nil)
        model.setRefreshRate(60)
        model.setTimeRange("24h")
        model.save()
        XCTAssertEqual(actions.commitCalls.count, 1)
        let config = actions.commitCalls[0].config
        XCTAssertNil(config.vehicleID)
        XCTAssertEqual(config.refreshRate, 60)
        XCTAssertEqual(config.timeRange, "24h")
        XCTAssertEqual(config.showTitle, true)
    }

    func testSaveWithoutWidgetIsNoOp() {
        let actions = RecordingWidgetSettingsActions()
        let model = makeModel(
            source: InMemoryWidgetSettingsSource(initial: ModelSample.update(status: .loaded, widget: nil)),
            actions: actions
        )
        model.start()
        model.save()
        XCTAssertTrue(actions.commitCalls.isEmpty)
    }

    func testCancelRecordsIntent() {
        let actions = RecordingWidgetSettingsActions()
        let model = makeModel(
            source: InMemoryWidgetSettingsSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.cancel()
        XCTAssertEqual(actions.cancelCount, 1)
    }

    // MARK: Auto-refresh

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
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
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopStopsSource() {
        let source = InMemoryWidgetSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
