//
//  ActiveSessionsSection.Tests.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  Adapter + accessibility coverage for the ActiveSessionsSection surface:
//    • `ActiveSessionDevice` — the User-Agent heuristic (web `describeDevice`),
//      including the faithful "Mac OS X before iPhone" precedence and the fallbacks.
//    • `ActiveSessionsProjection` — phase resolution across loading / loaded / empty /
//      failed × open-mode, and the "are there other devices?" predicate.
//    • `ActiveSessionsAccessibility` — the section summary + row VoiceOver content.
//
//  The state-holder coverage lives in ActiveSessionsSection.ModelTests.swift. Pure,
//  bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the
/// real copy without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum ActiveSessionsSectionSampleSessions {
    static func current(id: String = "1") -> ActiveSessionItem {
        ActiveSessionItem(
            id: id,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
            ip: "192.168.1.2",
            createdAt: Date(timeIntervalSince1970: 1_716_000_000),
            lastSeenAt: Date(timeIntervalSince1970: 1_717_000_000),
            current: true
        )
    }

    static func other(id: String = "2") -> ActiveSessionItem {
        ActiveSessionItem(
            id: id,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36",
            ip: "203.0.113.9",
            createdAt: Date(timeIntervalSince1970: 1_715_000_000),
            lastSeenAt: Date(timeIntervalSince1970: 1_716_500_000),
            current: false
        )
    }
}

// MARK: - Adapter: device descriptor (web `describeDevice`)

@MainActor final class ActiveSessionsDeviceTests: XCTestCase {
    private func describe(_ userAgent: String) -> String {
        ActiveSessionDevice.describe(userAgent: userAgent, localize: passthroughLocalize)
    }

    func testEmptyUserAgentIsUnknownDevice() {
        XCTAssertEqual(describe(""), "Unknown device")
        XCTAssertEqual(describe("   "), "Unknown device")
    }

    func testChromeOnWindows() {
        let userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
        XCTAssertEqual(describe(userAgent), "Chrome on Windows")
    }

    func testSafariOnMac() {
        let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15"
        XCTAssertEqual(describe(userAgent), "Safari on macOS")
    }

    func testFirefoxOnLinux() {
        XCTAssertEqual(describe("Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Firefox/124.0"), "Firefox on Linux")
    }

    func testEdgeBeatsChrome() {
        let userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/124.0 Safari/537.36 Edg/124.0"
        XCTAssertEqual(describe(userAgent), "Edge on Windows")
    }

    func testChromiumDistinctFromChrome() {
        XCTAssertEqual(describe("Mozilla/5.0 (X11; Linux) Chromium/124.0"), "Chromium on Linux")
    }

    func testRealIphoneUaFollowsMacPrecedence() {
        // Faithful to the web ladder: "Mac OS X" is matched before the iPhone arm, so a
        // real iOS Safari UA (which contains "like Mac OS X") reads as macOS.
        let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
            + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
        XCTAssertEqual(describe(userAgent), "Safari on macOS")
    }

    func testIosArmWhenNoMacToken() {
        XCTAssertEqual(describe("TeslaSync/1.0 (iPad)"), "Browser on iOS")
    }

    func testAndroidChrome() {
        let userAgent = "Mozilla/5.0 (Linux; Android 14) Chrome/124.0 Mobile Safari/537.36"
        XCTAssertEqual(describe(userAgent), "Chrome on Android")
    }

    func testUnknownFallbacks() {
        XCTAssertEqual(describe("some-random-agent"), "Browser on Unknown OS")
    }
}

// MARK: - Adapter: projection (phase + hasOtherDevices)

@MainActor final class ActiveSessionsProjectionTests: XCTestCase {
    func testOpenModeWinsRegardlessOfStatus() {
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loading, mode: .open, sessionCount: 0),
            .openMode
        )
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loaded, mode: .open, sessionCount: 5),
            .openMode
        )
    }

    func testLoadingResolvesByRowPresence() {
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loading, mode: .session, sessionCount: 0),
            .loading
        )
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loading, mode: .session, sessionCount: 2),
            .content
        )
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loaded, mode: .session, sessionCount: 0),
            .empty
        )
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .loaded, mode: .session, sessionCount: 3),
            .content
        )
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .failed("boom"), mode: .session, sessionCount: 0),
            .error("boom")
        )
        XCTAssertEqual(
            ActiveSessionsProjection.resolvePhase(status: .failed("boom"), mode: .session, sessionCount: 1),
            .content
        )
    }

    func testHasOtherDevices() {
        XCTAssertFalse(ActiveSessionsProjection.hasOtherDevices([]))
        XCTAssertFalse(ActiveSessionsProjection.hasOtherDevices([ActiveSessionsSectionSampleSessions.current()]))
        XCTAssertTrue(
            ActiveSessionsProjection.hasOtherDevices([
                ActiveSessionsSectionSampleSessions.current(),
                ActiveSessionsSectionSampleSessions.other()
            ])
        )
    }
}

// MARK: - Accessibility

@MainActor final class ActiveSessionsAccessibilityTests: XCTestCase {
    func testSectionSummary() {
        let summary = ActiveSessionsAccessibility.sectionSummary(count: 3, localize: passthroughLocalize)
        XCTAssertEqual(summary, "Active sessions: 3")
    }

    func testRowLabelIncludesDeviceCurrentAndMetrics() {
        let item = ActiveSessionsSectionSampleSessions.current()
        let label = ActiveSessionsAccessibility.rowLabel(
            item,
            dates: DefaultActiveSessionsDateFormatting(),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("Safari on macOS"))
        XCTAssertTrue(label.contains("This device"))
        XCTAssertTrue(label.contains("IP address"))
        XCTAssertTrue(label.contains("Signed in"))
        XCTAssertTrue(label.contains("Last seen"))
    }

    func testRowLabelOmitsCurrentForOtherDevices() {
        let label = ActiveSessionsAccessibility.rowLabel(
            ActiveSessionsSectionSampleSessions.other(),
            dates: DefaultActiveSessionsDateFormatting(),
            localize: passthroughLocalize
        )
        XCTAssertFalse(label.contains("This device"))
    }
}
