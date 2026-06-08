//
//  GeneralSettings.ModelTests.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  View-model coverage for the General Settings surface: the P1/S11 `view.opened`
//  emission, the lifecycle wiring, the snapshot hydration + dirty tracking, the
//  draft persistence / recovery (web `useFormDraft`), the navigation-guard
//  notification (web `useNavigationGuard`), and the save + sync-from-car actions
//  with their toasts (web `useToast`). Host-free: an `InMemoryGeneralSettingsSource`
//  drives the feed and resolves saves; no rendering / no network.
//

import XCTest
@testable import TeslaSync

@MainActor final class GeneralSettingsModelTests: XCTestCase {
    /// The bound model + its injected doubles, returned together so each test can
    /// drive the source and assert the model's projected state.
    private struct Harness {
        let model: GeneralSettingsModel
        let source: InMemoryGeneralSettingsSource
        let telemetry: SpyGeneralSettingsTelemetry
        let navGuard: RecordingNavigationGuard
    }

    private func makeHarness(
        snapshot: GeneralSettingsSnapshot? = nil,
        draft: AppSettingsState? = nil,
        saveResult: Result<AppSettingsState, SettingsSaveError>? = nil,
        autoResolveSave: Bool = true
    ) -> Harness {
        let source = InMemoryGeneralSettingsSource(
            initial: snapshot, saveResult: saveResult, autoResolveSave: autoResolveSave
        )
        let telemetry = SpyGeneralSettingsTelemetry()
        let navGuard = RecordingNavigationGuard()
        let store = InMemoryGeneralSettingsDraftStore(draft: draft)
        let model = GeneralSettingsModel(
            source: source, telemetry: telemetry, navigationGuard: navGuard, draftStore: store
        )
        return Harness(model: model, source: source, telemetry: telemetry, navGuard: navGuard)
    }

    private func loadedHarness(
        _ settings: AppSettingsState = .default,
        carPreferences: CarPreferences? = nil,
        saveResult: Result<AppSettingsState, SettingsSaveError>? = nil,
        autoResolveSave: Bool = true
    ) -> Harness {
        makeHarness(
            snapshot: GeneralSettingsSnapshot(settings: .loaded(settings), carPreferences: carPreferences),
            saveResult: saveResult,
            autoResolveSave: autoResolveSave
        )
    }

    // MARK: Lifecycle + telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let env = makeHarness()
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.telemetry.opened, ["GeneralSettings"])
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStopStopsSource() {
        let env = makeHarness()
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
    }

    func testRefreshForwardsToSource() {
        let env = makeHarness()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    // MARK: Snapshot hydration + dirty tracking

    func testLoadedSnapshotHydratesFormAndIsClean() {
        var loaded = AppSettingsState.default
        loaded.currencySymbol = "€"
        let env = loadedHarness(loaded)
        env.model.start()
        XCTAssertEqual(env.model.phase, .content)
        XCTAssertEqual(env.model.form, loaded)
        XCTAssertFalse(env.model.isDirty)
        XCTAssertFalse(env.navGuard.hasUnsaved)
    }

    func testEditMarksDirtyPersistsDraftAndArmsGuard() {
        let env = loadedHarness()
        env.model.start()
        env.model.update { $0.unitOfLength = "mi" }
        XCTAssertTrue(env.model.isDirty)
        XCTAssertTrue(env.model.hasDraft)
        XCTAssertTrue(env.navGuard.hasUnsaved)
        XCTAssertEqual(env.navGuard.message, "You have unsaved settings.")
    }

    func testDiscardDraftRestoresBaseline() {
        let env = loadedHarness()
        env.model.start()
        env.model.update { $0.unitOfTemp = "F" }
        env.model.discardDraft()
        XCTAssertEqual(env.model.form, .default)
        XCTAssertFalse(env.model.hasDraft)
        XCTAssertFalse(env.model.isDirty)
        XCTAssertFalse(env.navGuard.hasUnsaved)
    }

    func testDecimalPreviewReflectsForm() {
        let env = loadedHarness()
        env.model.start()
        env.model.update { $0.decimalPrecision = 3 }
        XCTAssertEqual(env.model.decimalPreview, "14.249")
    }

    // MARK: Draft recovery (web `useFormDraft`)

    func testRestoredDraftIsNotClobberedByServerSnapshot() {
        var draft = AppSettingsState.default
        draft.currencySymbol = "€"
        let env = makeHarness(snapshot: GeneralSettingsSnapshot(settings: .loaded(.default)), draft: draft)
        XCTAssertTrue(env.model.hasDraft)
        XCTAssertEqual(env.model.form, draft)
        env.model.start()
        // The server snapshot becomes the baseline but must not overwrite the
        // user's recovered in-progress edits.
        XCTAssertEqual(env.model.form, draft)
        XCTAssertTrue(env.model.isDirty)
    }

    // MARK: Save (web `useSaveSettings`)

    func testSaveSuccessUpdatesBaselineClearsDraftAndConfirms() {
        let env = loadedHarness()
        env.model.start()
        env.model.update { $0.gasEfficiencyMpg = 31 }
        env.model.save()
        XCTAssertEqual(env.model.saveStatus, .saved)
        XCTAssertEqual(env.source.saved.last?.gasEfficiencyMpg, 31)
        XCTAssertFalse(env.model.isDirty)
        XCTAssertFalse(env.model.hasDraft)
        XCTAssertFalse(env.navGuard.hasUnsaved)
        XCTAssertEqual(env.model.toast?.kind, .success)
        XCTAssertEqual(env.model.toast?.title, "Settings saved")
    }

    func testSaveFailureRaisesErrorToast() {
        let env = loadedHarness(saveResult: .failure(SettingsSaveError("server down")))
        env.model.start()
        env.model.update { $0.gasEfficiencyMpg = 31 }
        env.model.save()
        XCTAssertEqual(env.model.saveStatus, .failed)
        XCTAssertEqual(env.model.toast?.kind, .error)
        XCTAssertEqual(env.model.toast?.message, "server down")
    }

    func testIsDirtyIsSuppressedWhileSaving() {
        let env = loadedHarness(autoResolveSave: false)
        env.model.start()
        env.model.update { $0.unitOfLength = "mi" }
        env.model.save()
        XCTAssertEqual(env.model.saveStatus, .saving)
        XCTAssertFalse(env.model.isDirty)
        env.source.resolveSave(.success(env.model.form))
        XCTAssertEqual(env.model.saveStatus, .saved)
    }

    // MARK: Sync from car (web `syncUnitsFromCar`)

    func testSyncFromCarAppliesUnitsSavesAndConfirms() {
        let prefs = CarPreferences(
            distanceUnit: "DistanceUnitMiles",
            temperatureUnit: "TemperatureUnitFahrenheit",
            tirePressureUnit: "PressureUnitPsi"
        )
        let env = loadedHarness(carPreferences: prefs)
        env.model.start()
        env.model.syncUnitsFromCar()
        XCTAssertEqual(env.model.form.unitOfLength, "mi")
        XCTAssertEqual(env.model.form.unitOfTemp, "F")
        XCTAssertEqual(env.model.form.unitOfPressure, "psi")
        XCTAssertEqual(env.source.saved.count, 1)
        XCTAssertEqual(env.model.toast?.kind, .success)
    }

    func testSyncFromCarNoMappableUnitsRaisesInfo() {
        let env = loadedHarness(carPreferences: CarPreferences(tirePressureUnit: "PressureUnitKpa"))
        env.model.start()
        env.model.syncUnitsFromCar()
        XCTAssertEqual(env.model.toast?.kind, .info)
        XCTAssertTrue(env.source.saved.isEmpty)
    }

    func testSyncFromCarWithoutPreferencesIsNoop() {
        let env = loadedHarness()
        env.model.start()
        env.model.syncUnitsFromCar()
        XCTAssertNil(env.model.toast)
        XCTAssertTrue(env.source.saved.isEmpty)
    }
}

// MARK: - Test double

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyGeneralSettingsTelemetry: GeneralSettingsTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}
