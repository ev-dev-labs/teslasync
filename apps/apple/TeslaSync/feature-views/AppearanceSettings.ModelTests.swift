//
//  AppearanceSettings.ModelTests.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  View-model coverage for the Appearance Settings surface: the P1/S11 `view.opened`
//  emission + lifecycle wiring, the snapshot hydration (server prefs + the four
//  device-local prefs), the optimistic per-selector save with success / failure-
//  revert (web `saveSettings.mutate`), the in-flight save guard, and the instant
//  device-local mutations with their status-bar / reset-tours toasts (web
//  `useToast`). Host-free: an `InMemoryAppearanceSettingsSource` drives the feed
//  and resolves saves; no rendering / no network.
//

import XCTest
@testable import TeslaSync

@MainActor final class AppearanceSettingsModelTests: XCTestCase {
    private struct Harness {
        let model: AppearanceSettingsModel
        let source: InMemoryAppearanceSettingsSource
        let telemetry: SpyAppearanceTelemetry
    }

    private func makeHarness(
        snapshot: AppearanceSnapshot? = nil,
        saveResult: Result<AppearancePreferences, AppearanceSaveError>? = nil,
        autoResolveSave: Bool = true
    ) -> Harness {
        let source = InMemoryAppearanceSettingsSource(
            initial: snapshot, saveResult: saveResult, autoResolveSave: autoResolveSave
        )
        let telemetry = SpyAppearanceTelemetry()
        let model = AppearanceSettingsModel(source: source, telemetry: telemetry)
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    private func loadedHarness(
        _ preferences: AppearancePreferences = .default,
        statusBar: AppearanceStatusBarPrefs = .default,
        celebration: AppearanceCelebrationPrefs = .default,
        sidebarStyle: AppearanceSidebarStyle = .linear,
        theme: AppearanceThemeState = .default,
        saveResult: Result<AppearancePreferences, AppearanceSaveError>? = nil,
        autoResolveSave: Bool = true
    ) -> Harness {
        makeHarness(
            snapshot: AppearanceSnapshot(
                settings: .loaded(preferences),
                statusBar: statusBar,
                celebration: celebration,
                sidebarStyle: sidebarStyle,
                theme: theme
            ),
            saveResult: saveResult,
            autoResolveSave: autoResolveSave
        )
    }

    // MARK: Lifecycle + telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let env = makeHarness()
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.telemetry.opened, ["AppearanceSettings"])
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

    // MARK: Snapshot hydration

    func testLoadedSnapshotHydratesServerAndLocalPrefs() {
        let prefs = AppearancePreferences(density: .compact, timeFormat: .absolute, chartPalette: .neon)
        let env = loadedHarness(
            prefs,
            statusBar: AppearanceStatusBarPrefs(enabled: false, iconOnly: true),
            sidebarStyle: .legacy,
            theme: AppearanceThemeState(mode: .light, accentID: "pink")
        )
        env.model.start()
        XCTAssertEqual(env.model.phase, .content)
        XCTAssertTrue(env.model.isSettingsLoaded)
        XCTAssertEqual(env.model.preferences, prefs)
        XCTAssertEqual(env.model.statusBar, AppearanceStatusBarPrefs(enabled: false, iconOnly: true))
        XCTAssertEqual(env.model.sidebarStyle, .legacy)
        XCTAssertEqual(env.model.theme, AppearanceThemeState(mode: .light, accentID: "pink"))
    }

    func testLoadingSnapshotHasLoadingPhaseAndIsNotLoaded() {
        let env = makeHarness(snapshot: AppearanceSnapshot(settings: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertFalse(env.model.isSettingsLoaded)
    }

    // MARK: Server selector save (web `useSaveSettings`)

    func testSetDensitySavesOptimisticallyAndConfirms() {
        let env = loadedHarness()
        env.model.start()
        env.model.setDensity(.spacious)
        XCTAssertEqual(env.model.preferences.density, .spacious)
        XCTAssertEqual(env.source.savedServer.last?.density, .spacious)
        XCTAssertNil(env.model.savingField)
    }

    func testSetTimeFormatAndChartPaletteSave() {
        let env = loadedHarness()
        env.model.start()
        env.model.setTimeFormat(.absolute)
        env.model.setChartPalette(.neon)
        XCTAssertEqual(env.model.preferences.timeFormat, .absolute)
        XCTAssertEqual(env.model.preferences.chartPalette, .neon)
        XCTAssertEqual(env.source.savedServer.count, 2)
    }

    func testSetDensityNoOpWhenUnchanged() {
        let env = loadedHarness(AppearancePreferences(density: .comfortable))
        env.model.start()
        env.model.setDensity(.comfortable)
        XCTAssertTrue(env.source.savedServer.isEmpty)
    }

    func testSetDensityNoOpWhenSettingsNotLoaded() {
        let env = makeHarness(snapshot: AppearanceSnapshot(settings: .loading))
        env.model.start()
        env.model.setDensity(.spacious)
        XCTAssertTrue(env.source.savedServer.isEmpty)
        XCTAssertEqual(env.model.preferences.density, .comfortable)
    }

    func testSaveFailureRevertsAndRaisesErrorToast() {
        let env = loadedHarness(
            AppearancePreferences(density: .comfortable),
            saveResult: .failure(AppearanceSaveError("server down"))
        )
        env.model.start()
        env.model.setDensity(.spacious)
        // Optimistic value is rolled back to the loaded baseline on failure.
        XCTAssertEqual(env.model.preferences.density, .comfortable)
        XCTAssertNil(env.model.savingField)
        XCTAssertEqual(env.model.toast?.kind, .error)
        XCTAssertEqual(env.model.toast?.message, "server down")
    }

    func testConcurrentSaveIgnoredWhileSaving() {
        let env = loadedHarness(autoResolveSave: false)
        env.model.start()
        env.model.setDensity(.spacious)
        XCTAssertEqual(env.model.savingField, .density)
        // A second selector edit is ignored until the in-flight save resolves.
        env.model.setTimeFormat(.absolute)
        XCTAssertEqual(env.source.savedServer.count, 1)
        XCTAssertEqual(env.model.preferences.timeFormat, .relative)
        env.source.resolveSave(.success(env.model.preferences))
        XCTAssertNil(env.model.savingField)
    }

    // MARK: Device-local — status bar (web `setStatusBarPrefs` + toast)

    func testSetStatusBarEnabledTogglesPersistsAndToasts() {
        let env = loadedHarness()
        env.model.start()
        env.model.setStatusBarEnabled(false)
        XCTAssertFalse(env.model.statusBar.enabled)
        XCTAssertEqual(env.source.savedStatusBar.last?.enabled, false)
        XCTAssertEqual(env.model.toast?.kind, .info)
        XCTAssertEqual(env.model.toast?.title, "Status bar hidden")
        env.model.setStatusBarEnabled(true)
        XCTAssertEqual(env.model.toast?.title, "Status bar shown")
    }

    func testSetStatusBarEnabledNoOpWhenUnchanged() {
        let env = loadedHarness()
        env.model.start()
        env.model.setStatusBarEnabled(true)
        XCTAssertTrue(env.source.savedStatusBar.isEmpty)
        XCTAssertNil(env.model.toast)
    }

    func testSetStatusBarIconOnlyPersistsWithoutToast() {
        let env = loadedHarness()
        env.model.start()
        env.model.setStatusBarIconOnly(true)
        XCTAssertTrue(env.model.statusBar.iconOnly)
        XCTAssertEqual(env.source.savedStatusBar.last?.iconOnly, true)
        XCTAssertNil(env.model.toast)
    }

    // MARK: Device-local — celebration / sidebar / theme

    func testUpdateCelebrationPersists() {
        let env = loadedHarness()
        env.model.start()
        env.model.updateCelebration { $0.playSound = true }
        XCTAssertTrue(env.model.celebration.playSound)
        XCTAssertEqual(env.source.savedCelebration.last?.playSound, true)
    }

    func testSetSidebarStylePersistsAndNoOp() {
        let env = loadedHarness(sidebarStyle: .linear)
        env.model.start()
        env.model.setSidebarStyle(.notion)
        XCTAssertEqual(env.model.sidebarStyle, .notion)
        XCTAssertEqual(env.source.savedSidebar, [.notion])
        env.model.setSidebarStyle(.notion)
        XCTAssertEqual(env.source.savedSidebar.count, 1)
    }

    func testSetThemeModeAndAccentPersistAndNoOp() {
        let env = loadedHarness(theme: AppearanceThemeState(mode: .system, accentID: "cyan"))
        env.model.start()
        env.model.setThemeMode(.dark)
        env.model.setAccent("purple")
        XCTAssertEqual(env.model.theme, AppearanceThemeState(mode: .dark, accentID: "purple"))
        XCTAssertEqual(env.source.savedTheme.count, 2)
        env.model.setThemeMode(.dark)
        XCTAssertEqual(env.source.savedTheme.count, 2)
    }

    // MARK: Device-local — product tours (web `startTour` / `resetAllTours`)

    func testStartTourForwards() {
        let env = loadedHarness()
        env.model.start()
        env.model.startTour(.debugger)
        XCTAssertEqual(env.source.startedTours, [.debugger])
    }

    func testResetToursForwardsAndToasts() {
        let env = loadedHarness()
        env.model.start()
        env.model.resetTours()
        XCTAssertEqual(env.source.resetToursCount, 1)
        XCTAssertEqual(env.model.toast?.kind, .success)
    }
}

// MARK: - Test double

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyAppearanceTelemetry: AppearanceSettingsTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}
