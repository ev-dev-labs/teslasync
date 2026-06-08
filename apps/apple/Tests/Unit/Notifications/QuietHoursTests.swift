import XCTest
@testable import TeslaSync

/// Quiet-hours windowing + the settings-derived foreground presentation policy.
@MainActor final class QuietHoursTests: XCTestCase {
    func testWrapAroundWindowContainsNightHours() {
        let quiet = QuietHours(isEnabled: true, startMinute: 22 * 60, endMinute: 7 * 60)
        XCTAssertTrue(quiet.contains(dateAt(hour: 23), calendar: .fixedGregorian))
        XCTAssertTrue(quiet.contains(dateAt(hour: 2), calendar: .fixedGregorian))
        XCTAssertFalse(quiet.contains(dateAt(hour: 12), calendar: .fixedGregorian))
    }

    func testSameDayWindow() {
        let quiet = QuietHours(isEnabled: true, startMinute: 9 * 60, endMinute: 17 * 60)
        XCTAssertTrue(quiet.contains(dateAt(hour: 12), calendar: .fixedGregorian))
        XCTAssertFalse(quiet.contains(dateAt(hour: 20), calendar: .fixedGregorian))
    }

    func testDisabledOrZeroLengthIsNeverQuiet() {
        XCTAssertFalse(QuietHours(isEnabled: false).contains(dateAt(hour: 2), calendar: .fixedGregorian))
        let zero = QuietHours(isEnabled: true, startMinute: 60, endMinute: 60)
        XCTAssertFalse(zero.contains(dateAt(hour: 1), calendar: .fixedGregorian))
    }

    func testStartEndAccessorsRoundTrip() {
        var quiet = QuietHours()
        quiet.setStart(hour: 23, minute: 30)
        quiet.setEnd(hour: 6, minute: 15)
        XCTAssertEqual(quiet.start.hour, 23)
        XCTAssertEqual(quiet.start.minute, 30)
        XCTAssertEqual(quiet.end.hour, 6)
        XCTAssertEqual(quiet.end.minute, 15)
    }

    // MARK: - Presentation policy

    private func note(_ category: PushCategory, _ severity: PushSeverity?) -> PushNotification {
        PushNotification(id: "n", category: category, title: "t", body: "b", route: category.route, severity: severity)
    }

    func testQuietHoursMuteSoundForNonCritical() {
        var settings = PushSettings()
        settings.quietHours = QuietHours(isEnabled: true, startMinute: 22 * 60, endMinute: 7 * 60)
        let presentation = settings.presentation(
            for: note(.charging, .info),
            at: dateAt(hour: 2),
            calendar: .fixedGregorian
        )
        XCTAssertTrue(presentation.showsBanner, "the banner still shows so notification centre records it")
        XCTAssertFalse(presentation.playsSound, "non-critical sound is muted during quiet hours")
    }

    func testCriticalBypassesQuietHours() {
        var settings = PushSettings()
        settings.quietHours = QuietHours(isEnabled: true, startMinute: 22 * 60, endMinute: 7 * 60)
        let presentation = settings.presentation(
            for: note(.security, .critical),
            at: dateAt(hour: 2),
            calendar: .fixedGregorian
        )
        XCTAssertTrue(presentation.playsSound, "critical alerts break through quiet hours")
    }

    func testDisabledCategoryIsSuppressed() {
        var settings = PushSettings()
        settings.setCategory(.charging, enabled: false)
        let presentation = settings.presentation(
            for: note(.charging, .info),
            at: dateAt(hour: 12),
            calendar: .fixedGregorian
        )
        XCTAssertTrue(presentation.isSuppressed)
        XCTAssertFalse(presentation.showsBanner)
    }

    func testAuthorizationOptionsReflectChannels() {
        var settings = PushSettings(soundEnabled: false, badgeEnabled: false)
        XCTAssertFalse(settings.authorizationOptions.contains(.sound))
        XCTAssertFalse(settings.authorizationOptions.contains(.badge))
        XCTAssertTrue(settings.authorizationOptions.contains(.alert))
        settings.criticalAlertsEnabled = true
        XCTAssertTrue(settings.authorizationOptions.contains(.criticalAlert))
    }
}
