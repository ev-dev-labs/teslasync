//
//  KioskSettingsModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  State-holder coverage for `KioskSettingsModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when cached settings survive a failed reload), the draft seed (config + rotation
//  selection from the first resolved snapshot), the edit-preserving rules (a freshness flip keeps
//  edits; a dashboard-set change re-sanitizes the selection without clobbering the config), every
//  mutator (each persisting through the action seam, the sliders clamped), the conditional reveals,
//  the preview / slider projections, the enter (persist + enterKiosk with the selection) + cancel
//  seams, the stale auto-refresh (once, re-armed on return to live), and offline keeping the cached
//  snapshot. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyKioskSettingsTelemetry: KioskSettingsTelemetry, @unchecked Sendable {
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

/// Records the persist / enter / cancel action seam calls + the last submitted configs.
private final class RecordingKioskSettingsActions: KioskSettingsActions, @unchecked Sendable {
    private let lock = NSLock()
    private var persists: [KioskConfig] = []
    private var enters: [KioskConfig] = []
    private var cancels = 0

    func persist(_ config: KioskConfig) {
        lock.lock(); persists.append(config); lock.unlock()
    }

    func enterKiosk(_ config: KioskConfig) {
        lock.lock(); enters.append(config); lock.unlock()
    }

    func cancel() {
        lock.lock(); cancels += 1; lock.unlock()
    }

    var persistCalls: [KioskConfig] {
        lock.lock(); defer { lock.unlock() }
        return persists
    }

    var enterCalls: [KioskConfig] {
        lock.lock(); defer { lock.unlock() }
        return enters
    }

    var cancelCount: Int {
        lock.lock(); defer { lock.unlock() }
        return cancels
    }
}

private enum ModelSample {
    static func dashboards() -> [KioskDashboard] {
        [
            KioskDashboard(id: "a", name: "Alpha", isDefault: true),
            KioskDashboard(id: "b", name: "Bravo"),
            KioskDashboard(id: "c", name: "Charlie")
        ]
    }

    static func config() -> KioskConfig {
        var config = KioskConfig.default
        config.rotateInterval = 30
        config.dashboardIds = ["a", "b", "c"]
        config.dimAfter = 10
        return config
    }

    static func update(
        status: KioskLoadStatus = .loaded,
        connection: KioskConnection = .live,
        dashboards: [KioskDashboard]? = dashboards(),
        config: KioskConfig = config()
    ) -> KioskSettingsUpdate {
        KioskSettingsUpdate(
            status: status,
            dashboards: dashboards ?? [],
            config: config,
            connection: connection
        )
    }
}

@MainActor
final class KioskSettingsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryKioskSettingsSource,
        telemetry: SpyKioskSettingsTelemetry = SpyKioskSettingsTelemetry(),
        actions: RecordingKioskSettingsActions = RecordingKioskSettingsActions()
    ) -> KioskSettingsModel {
        KioskSettingsModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyKioskSettingsTelemetry()
        let source = InMemoryKioskSettingsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["KioskSettingsModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Phases + draft seed

    func testLoadingThenPopulatedSeedsDraft() {
        let source = InMemoryKioskSettingsSource(initial: KioskSettingsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ModelSample.update())
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.config.rotateInterval, 30)
        XCTAssertEqual(model.selectedDashboardIds, ["a", "b", "c"])
    }

    func testLoadedEmptyDashboardsPhase() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update(dashboards: nil))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.dashboards.isEmpty)
    }

    func testFailedNoDashboardsErrorPhase() {
        let source = InMemoryKioskSettingsSource(
            initial: ModelSample.update(status: .failed("timeout"), dashboards: nil)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithCachedDashboardsKeepsPopulatedAndInlineError() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("stale read")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Draft preservation vs re-sanitize

    func testFreshnessFlipPreservesEdits() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.toggleDashboard("b")
        XCTAssertEqual(model.selectedDashboardIds, ["a", "c"])
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(model.selectedDashboardIds, ["a", "c"])
        XCTAssertEqual(model.connection, .stale)
    }

    func testDashboardChangeReSanitizesSelectionKeepsConfigEdits() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setRotateInterval(15)
        var bumped = ModelSample.config()
        bumped.rotateInterval = 999
        let smaller = [
            KioskDashboard(id: "a", name: "Alpha", isDefault: true),
            KioskDashboard(id: "b", name: "Bravo")
        ]
        source.push(ModelSample.update(dashboards: smaller, config: bumped))
        XCTAssertEqual(model.selectedDashboardIds, ["a", "b"])
        XCTAssertEqual(model.config.rotateInterval, 15)
        XCTAssertEqual(model.config.dashboardIds, ["a", "b"])
    }

    // MARK: Mutators persist

    func testSetRotateIntervalPersists() {
        let actions = RecordingKioskSettingsActions()
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source, actions: actions)
        model.start()
        model.setRotateInterval(60)
        XCTAssertEqual(model.config.rotateInterval, 60)
        XCTAssertEqual(actions.persistCalls.last?.rotateInterval, 60)
    }

    func testToggleDashboardKeepsAtLeastOneAndPersists() {
        let actions = RecordingKioskSettingsActions()
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source, actions: actions)
        model.start()
        model.toggleDashboard("a")
        model.toggleDashboard("b")
        XCTAssertEqual(model.selectedDashboardIds, ["c"])
        model.toggleDashboard("c")
        XCTAssertEqual(model.selectedDashboardIds, ["c"])
        XCTAssertEqual(model.config.dashboardIds, ["c"])
        XCTAssertEqual(actions.persistCalls.count, 3)
    }

    func testDisplayMutatorsTrackReveals() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setHideCursor(false)
        XCTAssertFalse(model.showsCursorTimeout)
        model.setCursorTimeout(10)
        XCTAssertEqual(model.config.cursorTimeout, 10)
        model.setDimAfter(0)
        XCTAssertFalse(model.showsDimBrightness)
        model.setShowClock(false)
        XCTAssertFalse(model.showsClockPosition)
        model.setClockPosition(.topLeft)
        XCTAssertEqual(model.config.clockPosition, .topLeft)
    }

    func testSliderMutatorsClampAndConvert() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setDimBrightnessPercent(200)
        XCTAssertEqual(model.config.dimLevel, 0.9, accuracy: 0.0001)
        XCTAssertEqual(model.brightnessPercent, 90)
        model.setWidgetOpacityPercent(10)
        XCTAssertEqual(model.config.widgetOpacity, 0.3, accuracy: 0.0001)
        XCTAssertEqual(model.previewWidgetOpacity, 0.081, accuracy: 0.0001)
        model.setBackgroundOpacityPercent(70)
        XCTAssertEqual(model.backgroundOpacityPercent, 70)
        XCTAssertEqual(model.previewBackgroundOpacity, 0.7, accuracy: 0.0001)
    }

    // MARK: Enter / cancel

    func testEnterPersistsAndEntersWithSelection() {
        let actions = RecordingKioskSettingsActions()
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source, actions: actions)
        model.start()
        model.toggleDashboard("b")
        model.enter()
        XCTAssertEqual(actions.enterCalls.count, 1)
        XCTAssertEqual(actions.enterCalls.last?.dashboardIds, ["a", "c"])
        XCTAssertEqual(model.config.dashboardIds, ["a", "c"])
    }

    func testCancelInvokesSeam() {
        let actions = RecordingKioskSettingsActions()
        let model = makeModel(source: InMemoryKioskSettingsSource(), actions: actions)
        model.cancel()
        XCTAssertEqual(actions.cancelCount, 1)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
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

    func testOfflineKeepsDataAndDoesNotRefresh() {
        let source = InMemoryKioskSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
