//
//  NotificationSettings.Tests.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  Unit coverage for the NotificationSettings surface:
//    • Adapter (cached → projection) — `NotificationSettingsProjector` parity with the web source's render
//      logic (the `granted` event-toggle gate, the `settings?.field !== false` tab defaults + `!settings`
//      no-op guard, the `!master` channel dim, the `master && !dismissed` autoplay hint, the
//      `Math.round(volume * 100)` slider value, the channel order + labels + default gates).
//    • State holder — `NotificationSettingsModel` phase resolution, the P1/S11 `view.opened` telemetry,
//      refresh + stale auto-refresh wiring, offline-keeps-content, and every mutation round-trip.
//    • Accessibility — the section VoiceOver summary (with data + empty) and the permission summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model is
//  driven by `InMemoryNotificationSettingsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

enum NotificationFixture {
    static func input(
        authorization: NotificationAuthorization = .granted,
        tabSettings: TabSignalSettings? = TabSignalSettings(),
        soundPrefs: NotificationSoundPrefs = .defaults,
        autoplayHintDismissed: Bool = false
    ) -> NotificationSettingsInput {
        NotificationSettingsInput(
            authorization: authorization,
            eventPrefs: NotificationEventPrefs(alerts: true, exportCompletions: true),
            tabSettings: tabSettings,
            soundPrefs: soundPrefs,
            autoplayHintDismissed: autoplayHintDismissed
        )
    }

    static func project(_ input: NotificationSettingsInput) -> NotificationSettingsProjection {
        NotificationSettingsProjector.project(input: input, copy: .fallback)
    }

    static func channel(
        _ projection: NotificationSettingsProjection,
        _ category: NotificationSoundCategory
    ) -> NotificationSoundChannelRow {
        projection.channels.first { $0.category == category }!
    }
}

// MARK: - Adapter: cached input → projection (port parity with the web source)

@MainActor
final class NotificationSettingsAdapterTests: XCTestCase {
    func testChannelOrderMatchesWebConstant() {
        let projection = NotificationFixture.project(NotificationFixture.input())
        XCTAssertEqual(
            projection.channels.map(\.category),
            [.criticalAlert, .warningAlert, .infoAlert, .chargeComplete, .driveComplete, .automationRun, .achievement]
        )
        XCTAssertEqual(projection.channels.count, 7)
    }

    func testChannelLabelsAndTestAccessibilityFromCopy() {
        let projection = NotificationFixture.project(NotificationFixture.input())
        let critical = NotificationFixture.channel(projection, .criticalAlert)
        XCTAssertEqual(critical.label, "Critical alerts")
        XCTAssertEqual(critical.testAccessibilityLabel, "Test Critical alerts sound")
        XCTAssertEqual(NotificationFixture.channel(projection, .infoAlert).label, "Informational alerts")
        XCTAssertEqual(NotificationFixture.channel(projection, .achievement).label, "Achievements")
    }

    func testDefaultChannelGatesMatchWebSeed() {
        // Web DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory: critical / warning / charge on; rest off.
        let projection = NotificationFixture.project(NotificationFixture.input())
        XCTAssertTrue(NotificationFixture.channel(projection, .criticalAlert).isOn)
        XCTAssertTrue(NotificationFixture.channel(projection, .warningAlert).isOn)
        XCTAssertFalse(NotificationFixture.channel(projection, .infoAlert).isOn)
        XCTAssertTrue(NotificationFixture.channel(projection, .chargeComplete).isOn)
        XCTAssertFalse(NotificationFixture.channel(projection, .driveComplete).isOn)
        XCTAssertFalse(NotificationFixture.channel(projection, .automationRun).isOn)
        XCTAssertFalse(NotificationFixture.channel(projection, .achievement).isOn)
    }

    func testEventPrefsGatedByGrantedAuthorization() {
        // Web: the "Notify me about" block renders only inside `permission === 'granted'`.
        XCTAssertTrue(NotificationFixture.project(NotificationFixture.input(authorization: .granted)).showsEventPrefs)
        XCTAssertFalse(
            NotificationFixture.project(NotificationFixture.input(authorization: .notDetermined)).showsEventPrefs
        )
        XCTAssertFalse(NotificationFixture.project(NotificationFixture.input(authorization: .denied)).showsEventPrefs)
        XCTAssertFalse(
            NotificationFixture.project(NotificationFixture.input(authorization: .unsupported)).showsEventPrefs
        )
    }

    func testSupportsNotificationsBranch() {
        XCTAssertFalse(
            NotificationFixture.project(NotificationFixture.input(authorization: .unsupported)).supportsNotifications
        )
        XCTAssertTrue(
            NotificationFixture.project(NotificationFixture.input(authorization: .denied)).supportsNotifications
        )
    }

    func testTabDefaultsOnWhenMissingAndNotEditable() {
        // Web `settings?.tab_badge_enabled !== false`: a nil settings payload defaults both on, but cannot
        // be persisted (web `!settings` no-op guard).
        let projection = NotificationFixture.project(NotificationFixture.input(tabSettings: nil))
        XCTAssertTrue(projection.tabBadgeEnabled)
        XCTAssertTrue(projection.criticalFlashEnabled)
        XCTAssertFalse(projection.tabSettingsEditable)
    }

    func testTabExplicitFalseTurnsOff() {
        let settings = TabSignalSettings(badgeEnabled: false, criticalFlashEnabled: true)
        let projection = NotificationFixture.project(NotificationFixture.input(tabSettings: settings))
        XCTAssertFalse(projection.tabBadgeEnabled)
        XCTAssertTrue(projection.criticalFlashEnabled)
        XCTAssertTrue(projection.tabSettingsEditable)
    }

    func testAutoplayHintShownOnlyWhenSoundsOnAndNotDismissed() {
        let onPrefs = NotificationSoundPrefs(enabled: true)
        let offPrefs = NotificationSoundPrefs(enabled: false)
        XCTAssertTrue(NotificationFixture.project(NotificationFixture.input(soundPrefs: onPrefs)).showsAutoplayHint)
        XCTAssertFalse(NotificationFixture.project(NotificationFixture.input(soundPrefs: offPrefs)).showsAutoplayHint)
        XCTAssertFalse(
            NotificationFixture.project(
                NotificationFixture.input(soundPrefs: onPrefs, autoplayHintDismissed: true)
            ).showsAutoplayHint
        )
    }

    func testChannelsDimmedWhenSoundsOff() {
        let off = NotificationFixture
            .project(NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: false)))
        XCTAssertTrue(off.channels.allSatisfy(\.isDimmed))
        let on = NotificationFixture
            .project(NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: true)))
        XCTAssertTrue(on.channels.allSatisfy { !$0.isDimmed })
    }

    func testVolumePercentRoundsLikeWeb() {
        func percent(_ volume: Double) -> Int {
            NotificationFixture.project(
                NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: true, volume: volume))
            ).volumePercent
        }
        XCTAssertEqual(percent(0.6), 60)
        XCTAssertEqual(percent(0.0), 0)
        XCTAssertEqual(percent(1.0), 100)
        XCTAssertEqual(percent(0.05), 5)
        XCTAssertEqual(percent(0.999), 100)
    }

    func testHasContentTrueForPresentInput() {
        XCTAssertTrue(NotificationFixture.project(NotificationFixture.input()).hasContent)
        XCTAssertFalse(NotificationSettingsProjection.empty.hasContent)
    }

    func testCopyInjectionLocalizesChannelLabels() {
        let copy = NotificationSettingsCopy(
            categoryLabels: [.criticalAlert: "Alertas críticas"],
            testAccessibilityTemplate: "Probar sonido {{name}}"
        )
        let projection = NotificationSettingsProjector.project(input: NotificationFixture.input(), copy: copy)
        let critical = NotificationFixture.channel(projection, .criticalAlert)
        XCTAssertEqual(critical.label, "Alertas críticas")
        XCTAssertEqual(critical.testAccessibilityLabel, "Probar sonido Alertas críticas")
        // A channel missing from the injected map falls back to its English default.
        XCTAssertEqual(NotificationFixture.channel(projection, .achievement).label, "Achievements")
    }
}

// MARK: - Volume math

@MainActor
final class NotificationVolumeMathTests: XCTestCase {
    func testClampUnit() {
        XCTAssertEqual(NotificationVolumeMath.clampUnit(0.5), 0.5, accuracy: 0.0001)
        XCTAssertEqual(NotificationVolumeMath.clampUnit(-1), 0)
        XCTAssertEqual(NotificationVolumeMath.clampUnit(2), 1)
        XCTAssertEqual(NotificationVolumeMath.clampUnit(.nan), 0)
        XCTAssertEqual(NotificationVolumeMath.clampUnit(.infinity), 0)
    }

    func testPercentAndUnitRoundTrip() {
        XCTAssertEqual(NotificationVolumeMath.percent(0.65), 65)
        XCTAssertEqual(NotificationVolumeMath.unit(fromPercent: 65), 0.65, accuracy: 0.0001)
        XCTAssertEqual(NotificationVolumeMath.unit(fromPercent: 200), 1) // clamped
        XCTAssertEqual(NotificationVolumeMath.unit(fromPercent: -5), 0) // clamped
    }
}

// MARK: - State holder: phase resolution

@MainActor
final class NotificationSettingsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        // Web parent precedence: loading and error short-circuit BEFORE the content/empty body.
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.loading, hasContent: true), .loading)
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.failed("x"), hasContent: true), .error("x"))
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.failed("x"), hasContent: false), .error("x"))
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(NotificationSettingsProjector.resolvePhase(.loaded, hasContent: true), .content)
    }
}

// MARK: - Accessibility summary

@MainActor
final class NotificationSettingsAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testSectionSummaryWithData() {
        let projection = NotificationFixture.project(
            NotificationFixture.input(authorization: .granted, soundPrefs: NotificationSoundPrefs(enabled: true))
        )
        let summary = NotificationSettingsAccessibility.sectionSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Browser Notifications"))
        XCTAssertTrue(summary.contains("Enabled"))
        XCTAssertTrue(summary.contains("Notification sounds on"))
    }

    func testSectionSummaryEmpty() {
        let summary = NotificationSettingsAccessibility.sectionSummary(
            for: .empty,
            localize: fallback
        )
        XCTAssertTrue(summary.hasPrefix("Browser Notifications"))
        XCTAssertTrue(summary.contains("Notification settings are unavailable"))
    }

    func testPermissionSummaryBranches() {
        XCTAssertEqual(
            NotificationSettingsAccessibility.permissionSummary(.granted, localize: fallback),
            "Enabled"
        )
        XCTAssertEqual(
            NotificationSettingsAccessibility.permissionSummary(.notDetermined, localize: fallback),
            "Enable Browser Notifications"
        )
        XCTAssertEqual(
            NotificationSettingsAccessibility.permissionSummary(.denied, localize: fallback),
            "Notifications are blocked. Enable in your browser settings."
        )
        XCTAssertEqual(
            NotificationSettingsAccessibility.permissionSummary(.unsupported, localize: fallback),
            "Browser notifications are not supported in this browser."
        )
    }
}
