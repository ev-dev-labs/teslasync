//
//  BackupActionsCard.Tests.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  Unit coverage for the BackupActionsCard surface: the Adapter projections (wrapped-
//  section phase, run-button label, toast content for every outcome incl. the 401/403
//  admin-permission + generic `Backup failed: ${msg}` branches, accessibility builders),
//  the `BackupActionsCardModel` state holder (idle/running/succeeded/failed lifecycle,
//  the success-path query invalidation, the re-entrancy guard, the toast dismiss, and
//  the P1/S11 `view.opened` telemetry), and the i18n facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by the in-memory + controllable seams.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: outcome + props → projection

final class BackupActionsCardAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// English-fallback `%@` formatter (bundle-free).
    private let fmt: (String, String, String) -> String = { _, fallbackFormat, arg in
        String(format: fallbackFormat, arg)
    }

    // Wrapped-section phase (web `children` DefList)

    func testContentRowsAndEmpty() {
        XCTAssertTrue(BackupStatusContent.loading.rows.isEmpty)
        XCTAssertFalse(BackupStatusContent.loading.isEmpty)

        let row = BackupStatusRow(id: "runs", label: "Total runs", value: "47")
        XCTAssertEqual(BackupStatusContent.ready([row]).rows, [row])
        XCTAssertFalse(BackupStatusContent.ready([row]).isEmpty)

        XCTAssertTrue(BackupStatusContent.ready([]).isEmpty)
        XCTAssertTrue(BackupStatusContent.ready([]).rows.isEmpty)

        XCTAssertTrue(BackupStatusContent.failed(message: "boom").rows.isEmpty)
        XCTAssertFalse(BackupStatusContent.failed(message: "boom").isEmpty)
    }

    // Run-button label (web `isPending ? 'Starting…' : 'Run quick backup now'`)

    func testButtonLabelProjection() {
        XCTAssertEqual(QuickBackupButtonLabel.project(isRunning: false).key, "backup.actions.button.run")
        XCTAssertEqual(QuickBackupButtonLabel.project(isRunning: false).fallback, "Run quick backup now")
        XCTAssertEqual(QuickBackupButtonLabel.project(isRunning: true).key, "backup.actions.button.starting")
        XCTAssertEqual(QuickBackupButtonLabel.project(isRunning: true).fallback, "Starting…")
    }

    // Toast content (web `useToast` — success / error branches)

    func testToastSuccessProjection() {
        let toast = BackupActionToast.project(.succeeded, localize: echo, format: fmt)
        XCTAssertEqual(toast.kind, .success)
        XCTAssertEqual(toast.tone, .success)
        XCTAssertEqual(toast.message, "Quick backup started")
        XCTAssertEqual(toast.systemImage, "checkmark.circle.fill")
    }

    func testToastPermissionProjection() {
        let toast = BackupActionToast.project(.permissionDenied, localize: echo, format: fmt)
        XCTAssertEqual(toast.kind, .permission)
        XCTAssertEqual(toast.tone, .danger)
        XCTAssertEqual(toast.message, "Quick backup requires admin permission.")
        XCTAssertEqual(toast.systemImage, "lock.fill")
    }

    func testToastOfflineProjection() {
        let toast = BackupActionToast.project(.offline, localize: echo, format: fmt)
        XCTAssertEqual(toast.kind, .offline)
        XCTAssertEqual(toast.tone, .neutral)
        XCTAssertEqual(toast.message, "You appear to be offline. Quick backup couldn’t start.")
        XCTAssertEqual(toast.systemImage, "wifi.slash")
    }

    func testToastGenericFailureInterpolatesMessage() {
        let toast = BackupActionToast.project(.failed(message: "disk full"), localize: echo, format: fmt)
        XCTAssertEqual(toast.kind, .failed)
        XCTAssertEqual(toast.tone, .danger)
        XCTAssertEqual(toast.message, "Backup failed: disk full")
        XCTAssertFalse(toast.message.contains("%@"))
        XCTAssertEqual(toast.systemImage, "exclamationmark.triangle.fill")
    }

    // Accessibility builders (web button/link names + the `/backup` route)

    func testAccessibilityBuilders() {
        XCTAssertEqual(BackupActionsAccessibility.runLabel(localize: echo), "Run quick backup now")
        XCTAssertEqual(BackupActionsAccessibility.manageLabel(localize: echo), "Manage backups & restore")
        XCTAssertEqual(BackupActionsAccessibility.manageRoute, "/backup")
        XCTAssertEqual(BackupActionsAccessibility.runTestID, "backup-actions-run")
        XCTAssertEqual(BackupActionsAccessibility.manageTestID, "backup-actions-manage")
    }

    // i18n facade resolves the verbatim source keys (bundle-free → returns value)

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(
            BackupActionsCardStrings.string("backup.actions.button.run", "Run quick backup now"),
            "Run quick backup now"
        )
        XCTAssertEqual(
            BackupActionsCardStrings.format("backup.actions.toast.failed", "Backup failed: %@", "disk full"),
            "Backup failed: disk full"
        )
    }
}

// MARK: - State holder: run lifecycle + invalidation + guard + telemetry

@MainActor
final class BackupActionsCardModelTests: XCTestCase {
    private func waitUntilRunning(_ model: BackupActionsCardModel) async {
        for _ in 0 ..< 50 where !model.isRunning {
            await Task.yield()
        }
    }

    func testInitialStateIsIdle() {
        let model = BackupActionsCardModel(source: InMemoryQuickBackupSource())
        XCTAssertEqual(model.actionPhase, .idle)
        XCTAssertFalse(model.isRunning)
        XCTAssertFalse(model.isRunDisabled)
        XCTAssertEqual(model.buttonLabel.key, "backup.actions.button.run")
        XCTAssertNil(model.toast)
        XCTAssertNil(model.lastRun)
    }

    func testRunSuccessSetsSucceededAndInvalidates() async {
        let source = InMemoryQuickBackupSource(result: .success(BackupRunSummary(id: 9, status: "started")))
        let model = BackupActionsCardModel(source: source)
        await model.run()
        XCTAssertEqual(model.actionPhase, .succeeded)
        XCTAssertEqual(model.toast?.kind, .success)
        XCTAssertEqual(model.toast?.tone, .success)
        XCTAssertEqual(model.toast?.message, "Quick backup started")
        XCTAssertEqual(model.lastRun, BackupRunSummary(id: 9, status: "started"))
        XCTAssertEqual(source.runCount, 1)
        XCTAssertEqual(source.invalidateCount, 1)
    }

    func testRunPermissionDeniedSurfacesAdminToastWithoutInvalidating() async {
        let source = InMemoryQuickBackupSource(result: .failure(.permissionDenied))
        let model = BackupActionsCardModel(source: source)
        await model.run()
        XCTAssertEqual(model.actionPhase, .failed(kind: .permission))
        XCTAssertEqual(model.toast?.kind, .permission)
        XCTAssertEqual(model.toast?.tone, .danger)
        XCTAssertEqual(model.toast?.message, "Quick backup requires admin permission.")
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testRunOfflineSurfacesOfflineToast() async {
        let source = InMemoryQuickBackupSource(result: .failure(.offline))
        let model = BackupActionsCardModel(source: source)
        await model.run()
        XCTAssertEqual(model.actionPhase, .failed(kind: .offline))
        XCTAssertEqual(model.toast?.kind, .offline)
        XCTAssertEqual(model.toast?.tone, .neutral)
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testRunGenericFailureSurfacesMessage() async {
        let source = InMemoryQuickBackupSource(result: .failure(.failed(message: "disk full")))
        let model = BackupActionsCardModel(source: source)
        await model.run()
        XCTAssertEqual(model.actionPhase, .failed(kind: .failed))
        XCTAssertEqual(model.toast?.message, "Backup failed: disk full")
        XCTAssertEqual(source.invalidateCount, 0)
    }

    func testRunningStateWhileInFlightThenSucceeds() async {
        let source = ControllableQuickBackupSource()
        let model = BackupActionsCardModel(source: source)
        let task = Task { await model.run() }
        await waitUntilRunning(model)
        XCTAssertTrue(model.isRunning)
        XCTAssertTrue(model.isRunDisabled)
        XCTAssertEqual(model.buttonLabel.key, "backup.actions.button.starting")
        XCTAssertNil(model.toast)

        source.complete(BackupRunSummary(id: 7, status: "started"))
        await task.value
        XCTAssertEqual(model.actionPhase, .succeeded)
        XCTAssertEqual(model.lastRun, BackupRunSummary(id: 7, status: "started"))
        XCTAssertEqual(source.invalidateCount, 1)
    }

    func testRunGuardsAgainstConcurrentRuns() async {
        let source = ControllableQuickBackupSource()
        let model = BackupActionsCardModel(source: source)
        let task = Task { await model.run() }
        await waitUntilRunning(model)
        await model.run() // second call must early-return while a run is in flight
        XCTAssertEqual(source.runCount, 1)
        source.complete()
        await task.value
    }

    func testRunClearsPriorToastWhileStarting() async {
        let source = ControllableQuickBackupSource()
        let model = BackupActionsCardModel(source: source)
        model.previewApply(.failed(message: "earlier"))
        XCTAssertNotNil(model.toast)
        let task = Task { await model.run() }
        await waitUntilRunning(model)
        XCTAssertNil(model.toast)
        source.complete()
        await task.value
    }

    func testDismissToastClears() async {
        let model = BackupActionsCardModel(source: InMemoryQuickBackupSource())
        await model.run()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyBackupTelemetry()
        let model = BackupActionsCardModel(source: InMemoryQuickBackupSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackupActionsCardSurface.slug])
        XCTAssertEqual(BackupActionsCardSurface.slug, "BackupActionsCard")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBackupTelemetry: BackupActionsCardTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
