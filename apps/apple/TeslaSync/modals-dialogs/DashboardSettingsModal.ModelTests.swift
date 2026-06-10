//
//  DashboardSettingsModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  State-holder coverage for `DashboardSettingsModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a resolved dashboard survives a failed vehicle-list reload), the draft build (name /
//  icon / settings seeded from the descriptor), the edit-preserving rebuild rule (a freshness flip
//  keeps edits; a new dashboard identity rebuilds), the per-field mutators, the save delta seam
//  (rename / icon / settings), the save guard with no dashboard, the cancel seam, the stale
//  auto-refresh (once, re-armed on return to live), and offline keeping the cached vehicle list.
//  Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyDashboardSettingsTelemetry: DashboardSettingsTelemetry, @unchecked Sendable {
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

/// Records the commit / cancel action seam calls + the last committed deltas.
private final class RecordingDashboardSettingsActions: DashboardSettingsActions, @unchecked Sendable {
    private let lock = NSLock()
    private var commits: [DashboardSettingsCommit] = []
    private var cancels = 0

    func commit(_ change: DashboardSettingsCommit) {
        lock.lock(); commits.append(change); lock.unlock()
    }

    func cancel() {
        lock.lock(); cancels += 1; lock.unlock()
    }

    var commitCalls: [DashboardSettingsCommit] {
        lock.lock(); defer { lock.unlock() }
        return commits
    }

    var cancelCount: Int {
        lock.lock(); defer { lock.unlock() }
        return cancels
    }
}

private enum ModelSample {
    static func dashboard(
        id: String = "dash-1",
        name: String = "Garage",
        icon: String = "🔋",
        settings: DashboardSettingsValues = DashboardSettingsValues(
            refreshInterval: 30,
            vehicleID: 2,
            showWidgetBorders: true,
            compactMode: false
        )
    ) -> DashboardDescriptor {
        DashboardDescriptor(id: id, name: name, icon: icon, settings: settings)
    }

    static func vehicles() -> [DashboardVehicleOption] {
        [
            DashboardVehicleOption(id: 1, displayName: "Model 3"),
            DashboardVehicleOption(id: 2, displayName: "Model Y")
        ]
    }

    static func update(
        status: DashboardSettingsLoadStatus = .loaded,
        connection: DashboardSettingsConnection = .live,
        dashboard: DashboardDescriptor? = dashboard(),
        vehicles: [DashboardVehicleOption] = vehicles()
    ) -> DashboardSettingsUpdate {
        DashboardSettingsUpdate(
            status: status,
            dashboard: dashboard,
            vehicles: vehicles,
            connection: connection
        )
    }
}

@MainActor
final class DashboardSettingsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryDashboardSettingsSource,
        telemetry: SpyDashboardSettingsTelemetry = SpyDashboardSettingsTelemetry(),
        actions: RecordingDashboardSettingsActions = RecordingDashboardSettingsActions()
    ) -> DashboardSettingsModel {
        DashboardSettingsModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyDashboardSettingsTelemetry()
        let model = makeModel(
            source: InMemoryDashboardSettingsSource(initial: ModelSample.update()),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["DashboardSettingsModal"])
    }

    // MARK: Phase

    func testLoadingWithoutDashboardIsLoadingPhase() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(
            initial: ModelSample.update(status: .loading, dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDashboardIsPopulated() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.phase, .populated)
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testLoadedWithoutDashboardIsEmpty() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(
            initial: ModelSample.update(status: .loaded, dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDashboardIsError() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(
            initial: ModelSample.update(status: .failed("boom"), dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedReloadWithDashboardKeepsFormAndShowsInlineError() {
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("reload failed")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    // MARK: Draft build

    func testDraftSeededFromDescriptor() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.draft.name, "Garage")
        XCTAssertEqual(model.draft.icon, "🔋")
        XCTAssertEqual(model.draft.refreshInterval, 30)
        XCTAssertEqual(model.draft.vehicleID, 2)
        XCTAssertTrue(model.draft.showWidgetBorders)
        XCTAssertFalse(model.draft.compactMode)
    }

    func testSelectedVehicleNameResolvesFromList() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.selectedVehicleName, "Model Y")
        model.setVehicleID(nil)
        XCTAssertNil(model.selectedVehicleName)
    }

    // MARK: Edit-preserving rebuild

    func testFreshnessFlipPreservesEdits() {
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setName("Edited")
        model.setCompactMode(true)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(model.draft.name, "Edited")
        XCTAssertTrue(model.draft.compactMode)
    }

    func testNewDashboardIdentityRebuildsDraft() {
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.setName("Edited")
        source.push(ModelSample.update(dashboard: ModelSample.dashboard(id: "dash-2", name: "Other")))
        XCTAssertEqual(model.draft.name, "Other")
    }

    // MARK: Mutators

    func testFieldMutators() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(initial: ModelSample.update()))
        model.start()
        model.setName("New Name")
        model.setIcon("🚗")
        model.setVehicleID(1)
        model.setRefreshInterval(60)
        model.setShowWidgetBorders(false)
        model.setCompactMode(true)
        XCTAssertEqual(model.draft.name, "New Name")
        XCTAssertEqual(model.draft.icon, "🚗")
        XCTAssertTrue(model.isIconSelected("🚗"))
        XCTAssertEqual(model.draft.vehicleID, 1)
        XCTAssertEqual(model.draft.refreshInterval, 60)
        XCTAssertFalse(model.draft.showWidgetBorders)
        XCTAssertTrue(model.draft.compactMode)
    }

    func testIsDirtyReflectsEdits() {
        let model = makeModel(source: InMemoryDashboardSettingsSource(initial: ModelSample.update()))
        model.start()
        XCTAssertFalse(model.isDirty)
        model.setCompactMode(true)
        XCTAssertTrue(model.isDirty)
    }

    // MARK: Save / cancel seams

    func testSaveCommitsRenameIconAndSettings() {
        let actions = RecordingDashboardSettingsActions()
        let model = makeModel(
            source: InMemoryDashboardSettingsSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.setName("Renamed")
        model.setIcon("🚗")
        model.setRefreshInterval(60)
        model.setVehicleID(nil)
        model.save()
        XCTAssertEqual(actions.commitCalls.count, 1)
        let change = actions.commitCalls[0]
        XCTAssertEqual(change.renamedName, "Renamed")
        XCTAssertEqual(change.changedIcon, "🚗")
        XCTAssertEqual(change.settings.refreshInterval, 60)
        XCTAssertNil(change.settings.vehicleID)
        XCTAssertTrue(change.settings.showWidgetBorders)
    }

    func testSaveWithoutChangesOmitsRenameAndIconDeltas() {
        let actions = RecordingDashboardSettingsActions()
        let model = makeModel(
            source: InMemoryDashboardSettingsSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.save()
        let change = actions.commitCalls[0]
        XCTAssertNil(change.renamedName)
        XCTAssertNil(change.changedIcon)
        XCTAssertEqual(change.settings.vehicleID, 2)
    }

    func testSaveWithoutDashboardIsNoOp() {
        let actions = RecordingDashboardSettingsActions()
        let model = makeModel(
            source: InMemoryDashboardSettingsSource(
                initial: ModelSample.update(status: .loaded, dashboard: nil)
            ),
            actions: actions
        )
        model.start()
        model.save()
        XCTAssertTrue(actions.commitCalls.isEmpty)
    }

    func testCancelRecordsIntent() {
        let actions = RecordingDashboardSettingsActions()
        let model = makeModel(
            source: InMemoryDashboardSettingsSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.cancel()
        XCTAssertEqual(actions.cancelCount, 1)
    }

    // MARK: Auto-refresh

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
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
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopStopsSource() {
        let source = InMemoryDashboardSettingsSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
