//
//  StatusBar.Tests.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The model + view-composition + accessibility + i18n half of the coverage (the pure value types,
//  formatters and projection live in StatusBar.AdapterTests.swift + StatusBar.ProjectionTests.swift):
//    • StatusBarModel — once-only `view.opened`, the prefs intents (enable / icon-only) writing through the
//      store + hiding the bar, `syncPrefs` reflecting an external change, `update` preserving the store
//      prefs, every command delegation, and the one-shot stale rising-edge auto-refresh.
//    • Views — the bar composes for every branch; the segments, popovers, sheet, chips, skeleton and the
//      inspector + samples compose; copy resolves through P1/S10.
//    • Accessibility — every interactive element's label is present in the resolved presentation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network; the model is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StatusBarModel

@MainActor
final class StatusBarModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnce() {
        let spy = SpyStatusBarTelemetry()
        let model = StatusBarModel(
            input: StatusBarInput(),
            telemetry: spy,
            localize: { _, fallback in fallback },
            prefsStore: InMemoryStatusBarPrefsStore()
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StatusBarSurface.slug], "view.opened fires once per instance")
    }

    func testSetEnabledWritesStoreAndHides() {
        let store = InMemoryStatusBarPrefsStore()
        let model = makeModel(store: store)
        model.setEnabled(false)
        XCTAssertTrue(model.presentation.isHidden)
        XCTAssertFalse(store.current.enabled)
    }

    func testSetIconOnlyWritesStoreAndDensifies() {
        let store = InMemoryStatusBarPrefsStore()
        let model = makeModel(store: store)
        model.setIconOnly(true)
        XCTAssertTrue(model.presentation.iconOnly)
        XCTAssertTrue(store.current.iconOnly)
    }

    func testSyncPrefsReflectsExternalChange() {
        let store = InMemoryStatusBarPrefsStore()
        let model = makeModel(store: store)
        store.update(StatusBarPrefs(enabled: false, iconOnly: true))
        XCTAssertFalse(model.presentation.isHidden, "not reflected until synced (web cross-tab storage event)")
        model.syncPrefs()
        XCTAssertTrue(model.presentation.isHidden)
        XCTAssertTrue(model.presentation.iconOnly)
    }

    func testUpdatePreservesStorePrefs() {
        let store = InMemoryStatusBarPrefsStore(StatusBarPrefs(enabled: true, iconOnly: true))
        let model = makeModel(store: store)
        model.update(input: StatusBarInput(prefs: .defaults, apiHealth: .degraded))
        XCTAssertTrue(model.presentation.iconOnly, "a data push never clobbers the user's density choice")
        XCTAssertEqual(model.presentation.connection.tone, .caution)
    }

    func testCommandDelegation() {
        let recorder = CommandRecorder()
        let model = StatusBarModel(
            input: StatusBarInput(),
            localize: { _, fallback in fallback },
            prefsStore: InMemoryStatusBarPrefsStore(),
            commands: recorder.commands
        )
        model.openSystemStatus()
        model.openLiveExplorer()
        model.selectVehicle(7)
        model.openShortcuts()
        model.openTour()
        model.openFeedback()
        model.openChangelog()
        model.openReleaseNotes()
        model.retry()
        XCTAssertEqual(recorder.log, [
            "systemStatus", "liveExplorer", "vehicle:7", "shortcuts", "tour",
            "feedback", "changelog", "releaseNotes", "refresh"
        ])
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let recorder = CommandRecorder()
        let model = StatusBarModel(
            input: StatusBarInput(liveStatus: .connected),
            localize: { _, fallback in fallback },
            prefsStore: InMemoryStatusBarPrefsStore(),
            commands: recorder.commands
        )
        model.update(input: StatusBarInput(liveStatus: .stale))
        model.update(input: StatusBarInput(liveStatus: .stale))
        XCTAssertEqual(recorder.refreshCount, 1, "auto-refresh latches on the stale rising edge")
        model.update(input: StatusBarInput(liveStatus: .connected))
        model.update(input: StatusBarInput(liveStatus: .stale))
        XCTAssertEqual(recorder.refreshCount, 2, "a recovered-then-stale stream re-fires")
    }

    private func makeModel(store: any StatusBarPrefsStore) -> StatusBarModel {
        StatusBarModel(input: StatusBarInput(), localize: { _, fallback in fallback }, prefsStore: store)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class StatusBarViewTests: XCTestCase {
    func testBarComposesForEveryBranch() {
        _ = StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input()))
        _ = StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(phase: .loading)))
        _ = StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(connectivity: .offline, liveStatus: .disconnected)
        ))
        _ = StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(liveStatus: .stale)))
        _ = StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(apiHealth: .offline)))
        _ = StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(vehicleCount: 0, jobCount: 0)))
        _ = StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(prefs: StatusBarPrefs(enabled: true, iconOnly: true))
        ))
        _ = StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(prefs: StatusBarPrefs(enabled: false))
        ))
    }

    func testSegmentsAndChromeCompose() {
        let presentation = StatusBarSampleData.model(StatusBarSampleData.input()).presentation
        _ = StatusBarConnectionView(vm: presentation.connection, iconOnly: false, onOpen: {})
        _ = StatusBarLiveView(vm: presentation.live, iconOnly: false, reduceMotion: false, onOpen: {})
        _ = StatusBarVehicleView(
            vm: presentation.vehicle,
            iconOnly: false,
            isPresented: .constant(false),
            onSelect: { _ in }
        )
        _ = StatusBarVehicleList(vm: presentation.vehicle, onSelect: { _ in })
        _ = StatusBarBackgroundView(vm: presentation.background, iconOnly: false, isPresented: .constant(true))
        _ = StatusBarJobsList(vm: presentation.background)
        _ = StatusBarHelpView(
            vm: presentation.help,
            iconOnly: false,
            onShortcuts: {},
            onTour: {},
            onFeedback: {}
        )
        _ = StatusBarVersionView(
            vm: presentation.version,
            iconOnly: false,
            isPresented: .constant(false),
            onChangelog: {},
            onReleaseNotes: {}
        )
        _ = StatusBarVersionSheetView(
            sheet: presentation.version.sheet,
            onChangelog: {},
            onReleaseNotes: {},
            onClose: {}
        )
        _ = StatusBarStateChips(presentation: presentation, onRetry: {})
        _ = StatusBarLoadingChrome(iconOnly: false, reduceMotion: true)
        _ = StatusBarDivider()
    }

    func testInspectorAndSamplesCompose() {
        _ = StatusBarInspector()
        XCTAssertEqual(StatusBarSampleData.vehicles.count, 3)
        XCTAssertEqual(StatusBarSampleData.jobs.count, 2)
        XCTAssertEqual(StatusBarInspectorScenario.all.count, 8)
    }
}

// MARK: - Accessibility (labels present on every interactive element)

@MainActor
final class StatusBarAccessibilityTests: XCTestCase {
    private var presentation: StatusBarPresentation {
        StatusBarSampleData.model(StatusBarSampleData.input()).presentation
    }

    func testSegmentLabelsPresent() {
        let presentation = presentation
        XCTAssertFalse(presentation.connection.accessibilityLabel.isEmpty)
        XCTAssertFalse(presentation.live.accessibilityLabel.isEmpty)
        XCTAssertFalse(presentation.background.accessibilityLabel.isEmpty)
        XCTAssertTrue(presentation.version.accessibilityLabel.contains("v"))
    }

    func testVehicleSwitcherAndOptionsLabeled() {
        let vehicle = presentation.vehicle
        XCTAssertTrue(vehicle.switchAccessibilityLabel.contains(vehicle.label))
        XCTAssertFalse(vehicle.options.isEmpty)
        XCTAssertTrue(vehicle.options.allSatisfy { !$0.name.isEmpty })
        XCTAssertEqual(vehicle.options.filter(\.isSelected).count, 1)
    }

    func testStateChipLabelsResolve() {
        let presentation = presentation
        XCTAssertEqual(presentation.offlineChipLabel, "Offline")
        XCTAssertEqual(presentation.staleChipLabel, "Stale data")
        XCTAssertEqual(presentation.errorChipLabel, "Backend unreachable")
        XCTAssertEqual(presentation.retryLabel, "Retry")
        XCTAssertEqual(presentation.accessibilityLabel, "Application status")
    }
}

// MARK: - i18n facade

final class StatusBarStringsTests: XCTestCase {
    func testFacadeReturnsFallbackWhenKeyAbsent() {
        XCTAssertEqual(StatusBarStrings.string("statusBar.aria", "Application status"), "Application status")
        XCTAssertEqual(StatusBarStrings.localize("any.key", "Fallback"), "Fallback")
        XCTAssertEqual(StatusBarStrings.table, "StatusBar")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6.
private final class SpyStatusBarTelemetry: StatusBarTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}

/// Captures every command intent the model forwards. MainActor-isolated (the closures are `@MainActor`).
@MainActor
private final class CommandRecorder {
    private(set) var log: [String] = []
    private(set) var refreshCount = 0

    var commands: StatusBarCommands {
        StatusBarCommands(
            openSystemStatus: { self.log.append("systemStatus") },
            openLiveExplorer: { self.log.append("liveExplorer") },
            selectVehicle: { self.log.append("vehicle:\($0)") },
            openShortcuts: { self.log.append("shortcuts") },
            openTour: { self.log.append("tour") },
            openFeedback: { self.log.append("feedback") },
            openChangelog: { self.log.append("changelog") },
            openReleaseNotes: { self.log.append("releaseNotes") },
            refresh: { self.log.append("refresh"); self.refreshCount += 1 }
        )
    }
}
