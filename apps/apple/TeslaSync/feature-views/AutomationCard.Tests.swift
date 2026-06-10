//
//  AutomationCard.Tests.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  Unit coverage for the AutomationCard surface: the Adapter projections (status
//  map, the handleToggle branch + displayed-checked, the kebab-menu item set, the
//  conflict tint, the freshness chip), the time/date formatters (web `timeAgo` +
//  `formatDateTime`), the delete-confirmation content, the VoiceOver summaries,
//  the i18n key parity (referenced == the web keys), and the P1/S11 `view.opened`
//  telemetry. No network, no real store, no rendering host — the pure projections
//  are exercised directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum AutomationCardFixture {
    nonisolated(unsafe) static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func ago(_ seconds: TimeInterval) -> String {
        let iso = ISO8601DateFormatter()
        return iso.string(from: now.addingTimeInterval(-seconds))
    }

    static func automation(
        autoDisabled: Bool = false,
        enabled: Bool = true,
        lastTriggeredAt: String? = nil,
        executionCount: Int64 = 0,
        failureCount: Int64 = 0,
        nextFireTime: String? = nil,
        conflicts: [AutomationConflictData] = [],
        isFiring: Bool = false,
        vehicleName: String? = nil
    ) -> AutomationCardData {
        AutomationCardData(
            id: 7,
            name: "Vent when hot",
            description: "desc",
            enabled: enabled,
            autoDisabled: autoDisabled,
            autoDisabledReason: autoDisabled ? "too many failures" : nil,
            lastTriggeredAt: lastTriggeredAt,
            executionCount: executionCount,
            failureCount: failureCount,
            nextFireTime: nextFireTime,
            conflicts: conflicts,
            isFiring: isFiring,
            vehicleName: vehicleName
        )
    }
}

// MARK: - Adapter: status / toggle / menu / conflict / freshness

@MainActor final class AutomationCardAdapterTests: XCTestCase {
    func testStatusProjectionPrecedence() {
        XCTAssertEqual(AutomationStatus.project(autoDisabled: true, enabled: true), .autoDisabled)
        XCTAssertEqual(AutomationStatus.project(autoDisabled: false, enabled: false), .disabled)
        XCTAssertEqual(AutomationStatus.project(autoDisabled: false, enabled: true), .active)
    }

    func testStatusLabelKeysAndFallbacks() {
        XCTAssertEqual(AutomationStatus.active.labelKey, "automations.status.active")
        XCTAssertEqual(AutomationStatus.disabled.labelKey, "automations.status.disabled")
        XCTAssertEqual(AutomationStatus.autoDisabled.labelKey, "automations.status.auto-disabled")
        XCTAssertEqual(AutomationStatus.active.labelFallback, "Active")
        XCTAssertEqual(AutomationStatus.disabled.labelFallback, "Disabled")
        XCTAssertEqual(AutomationStatus.autoDisabled.labelFallback, "Auto-Disabled")
    }

    func testToggleDisplayedChecked() {
        XCTAssertTrue(AutomationToggleIntent.displayedChecked(AutomationCardFixture.automation(enabled: true)))
        XCTAssertFalse(AutomationToggleIntent.displayedChecked(AutomationCardFixture.automation(enabled: false)))
        // Auto-disabled always renders OFF regardless of `enabled` (web ternary).
        XCTAssertFalse(
            AutomationToggleIntent.displayedChecked(AutomationCardFixture.automation(autoDisabled: true, enabled: true))
        )
    }

    func testToggleResolveBranch() {
        let plain = AutomationCardFixture.automation(autoDisabled: false, enabled: false)
        XCTAssertEqual(AutomationToggleIntent.resolve(plain, checked: true), .toggle(id: 7, enabled: true))
        XCTAssertEqual(AutomationToggleIntent.resolve(plain, checked: false), .toggle(id: 7, enabled: false))

        // Auto-disabled + flipped ON re-enables (web handleToggle); OFF stays a toggle.
        let auto = AutomationCardFixture.automation(autoDisabled: true, enabled: false)
        XCTAssertEqual(AutomationToggleIntent.resolve(auto, checked: true), .reEnable(id: 7))
        XCTAssertEqual(AutomationToggleIntent.resolve(auto, checked: false), .toggle(id: 7, enabled: false))
    }

    func testToggleDispatchInvokesCorrectCallback() {
        var toggled: (Int64, Bool)?
        var reEnabled: Int64?
        let actions = AutomationCardActions(
            onToggle: { toggled = ($0, $1) },
            onReEnable: { reEnabled = $0 },
            onDelete: { _ in },
            onTestRun: { _ in }
        )
        actions.dispatchToggle(.toggle(id: 7, enabled: false))
        XCTAssertEqual(toggled?.0, 7)
        XCTAssertEqual(toggled?.1, false)
        actions.dispatchToggle(.reEnable(id: 7))
        XCTAssertEqual(reEnabled, 7)
    }

    func testMenuItemsGatedOnAutoDisabled() {
        XCTAssertEqual(
            AutomationMenuItemKind.items(autoDisabled: false),
            [.testRun, .duplicate, .export, .delete]
        )
        XCTAssertEqual(
            AutomationMenuItemKind.items(autoDisabled: true),
            [.testRun, .reEnable, .duplicate, .export, .delete]
        )
    }

    func testMenuItemMetadata() {
        XCTAssertEqual(AutomationMenuItemKind.testRun.labelKey, "automations.testRun")
        XCTAssertEqual(AutomationMenuItemKind.reEnable.labelKey, "automations.reEnable")
        XCTAssertEqual(AutomationMenuItemKind.delete.labelKey, "automations.delete")
        XCTAssertEqual(AutomationMenuItemKind.delete.role, .destructive)
        XCTAssertEqual(AutomationMenuItemKind.reEnable.role, .accent)
        XCTAssertEqual(AutomationMenuItemKind.testRun.role, .normal)
        XCTAssertEqual(AutomationMenuItemKind.delete.systemImage, "trash")
    }

    func testConflictSeverityProjection() {
        XCTAssertEqual(AutomationConflictSeverity.project("warning"), .warning)
        XCTAssertEqual(AutomationConflictSeverity.project("info"), .info)
        XCTAssertEqual(AutomationConflictSeverity.project("anything-else"), .info)
    }

    func testFreshnessChipProjection() {
        XCTAssertEqual(AutomationFreshnessChip.project(isFiring: true, connection: .live), .firing)
        XCTAssertNil(AutomationFreshnessChip.project(isFiring: false, connection: .live))
        XCTAssertEqual(AutomationFreshnessChip.project(isFiring: true, connection: .stale), .stale)
        XCTAssertEqual(AutomationFreshnessChip.project(isFiring: false, connection: .offline), .offline)
    }

    func testFreshnessChipMetadata() {
        XCTAssertEqual(AutomationFreshnessChip.firing.labelKey, "automations.firing")
        XCTAssertEqual(AutomationFreshnessChip.stale.labelKey, "automations.freshness.stale")
        XCTAssertEqual(AutomationFreshnessChip.offline.labelKey, "automations.freshness.offline")
        XCTAssertTrue(AutomationLiveConnection.live.showsLiveFiringPulse)
        XCTAssertFalse(AutomationLiveConnection.stale.showsLiveFiringPulse)
        XCTAssertFalse(AutomationLiveConnection.offline.showsLiveFiringPulse)
    }

    func testStateAutomationAccessor() {
        let data = AutomationCardFixture.automation()
        XCTAssertEqual(AutomationCardState.loaded(data).automation, data)
        XCTAssertNil(AutomationCardState.loading.automation)
        XCTAssertNil(AutomationCardState.empty.automation)
        XCTAssertNil(AutomationCardState.error(message: nil).automation)
    }
}

// MARK: - Formatting: timeAgo / dateTime / confirm

@MainActor final class AutomationCardFormattingTests: XCTestCase {
    private let echo = AutomationCardLocalizer.echo

    func testTimeAgoBuckets() {
        XCTAssertEqual(AutomationTimeFormat.timeAgo(nil, now: AutomationCardFixture.now, localize: echo), "—")
        XCTAssertEqual(
            AutomationTimeFormat.timeAgo(AutomationCardFixture.ago(30), now: AutomationCardFixture.now, localize: echo),
            "just now"
        )
        XCTAssertEqual(
            AutomationTimeFormat
                .timeAgo(AutomationCardFixture.ago(300), now: AutomationCardFixture.now, localize: echo),
            "5m ago"
        )
        XCTAssertEqual(
            AutomationTimeFormat
                .timeAgo(AutomationCardFixture.ago(7200), now: AutomationCardFixture.now, localize: echo),
            "2h ago"
        )
        XCTAssertEqual(
            AutomationTimeFormat
                .timeAgo(AutomationCardFixture.ago(259_200), now: AutomationCardFixture.now, localize: echo),
            "3d ago"
        )
    }

    func testDateTimeFormatsAndFallsBack() throws {
        XCTAssertEqual(AutomationTimeFormat.dateTime(nil, localize: echo), "—")
        XCTAssertEqual(AutomationTimeFormat.dateTime("not-a-date", localize: echo), "—")
        let formatted = try AutomationTimeFormat.dateTime(
            "2023-11-15T14:30:00Z",
            locale: Locale(identifier: "en_US"),
            timeZone: XCTUnwrap(TimeZone(identifier: "UTC")),
            localize: echo
        )
        XCTAssertTrue(formatted.contains("Nov 15, 2023"), formatted)
        XCTAssertTrue(formatted.contains("2:30"), formatted)
    }

    func testDeleteConfirmContent() {
        let confirm = AutomationDeleteConfirm.build(name: "Vent when hot", localize: echo)
        XCTAssertEqual(confirm.title, "Delete Automation")
        XCTAssertEqual(confirm.confirmLabel, "Delete")
        XCTAssertEqual(confirm.cancelLabel, "Cancel")
        XCTAssertTrue(confirm.message.contains("Vent when hot"), confirm.message)
        XCTAssertTrue(confirm.message.contains("cannot be undone"), confirm.message)
    }
}

// MARK: - Accessibility + i18n key parity

@MainActor final class AutomationCardAccessibilityTests: XCTestCase {
    private let echo = AutomationCardLocalizer.echo

    func testHeaderLabelComposesNameStatusAndChip() {
        let data = AutomationCardFixture.automation(enabled: true, isFiring: true)
        let label = AutomationCardAccessibility.headerLabel(
            data,
            status: .active,
            chip: .firing,
            localize: echo
        )
        XCTAssertEqual(label, "Vent when hot, Active, Firing")
    }

    func testHeaderLabelWithoutChip() {
        let data = AutomationCardFixture.automation(enabled: false)
        let label = AutomationCardAccessibility.headerLabel(
            data,
            status: .disabled,
            chip: nil,
            localize: echo
        )
        XCTAssertEqual(label, "Vent when hot, Disabled")
    }

    func testControlAccessibilityLabels() {
        XCTAssertEqual(AutomationCardAccessibility.toggleLabel(echo), "Toggle automation")
        XCTAssertEqual(AutomationCardAccessibility.menuLabel(echo), "Actions menu")
    }

    /// Guards that the keys the surface references are exactly the web keys — a
    /// regression here means the folded catalog would miss a string.
    func testWebKeyParity() {
        XCTAssertEqual(AutomationFreshnessChip.firing.labelKey, "automations.firing")
        XCTAssertEqual(AutomationMenuItemKind.export.labelKey, "automations.export")
        XCTAssertEqual(AutomationMenuItemKind.duplicate.labelKey, "automations.duplicate")
        let confirm = AutomationDeleteConfirm.build(name: "x", localize: echo)
        XCTAssertFalse(confirm.title.isEmpty)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor final class AutomationCardTelemetryTests: XCTestCase {
    private final class Recorder: AutomationCardTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    @MainActor
    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        AutomationCardSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["AutomationCard"])
        XCTAssertEqual(AutomationCard.surfaceSlug, "AutomationCard")
    }
}
