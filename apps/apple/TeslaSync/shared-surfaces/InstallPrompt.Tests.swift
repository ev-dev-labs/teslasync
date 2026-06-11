//
//  InstallPrompt.Tests.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  Adapter + projection coverage for the InstallPrompt surface:
//    • Constants — the verbatim web literals (the dismissal key + the 14-day window).
//    • Copy — the verbatim web keys (`installPrompt.title` / `.subtitle` / `.install` / `.dismiss`)
//      and their English fallbacks.
//    • Dismissal — the 14-day window predicate (web `wasDismissedRecently`), including the window edge,
//      a never-dismissed nil, and a clock-skewed future instant.
//    • Projection — the render branches plus the P4 leaf contract across loading / empty (installed /
//      dismissed / unavailable) / error / data, including precedence.
//    • Accessibility — the composed VoiceOver card label (web title + subtitle notice).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no device probe and no persistence,
//  so each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Constants (verbatim web literals)

final class InstallPromptConstantsTests: XCTestCase {
    func testDismissKeyMatchesWebSourceVerbatim() {
        XCTAssertEqual(InstallPromptConstants.dismissKey, "teslasync-pwa-install-dismissed")
    }

    func testDismissDaysMatchesWebSource() {
        XCTAssertEqual(InstallPromptConstants.dismissDays, 14)
    }

    func testDismissWindowIsFourteenDaysInSeconds() {
        XCTAssertEqual(InstallPromptConstants.dismissWindow, 14 * 86400, accuracy: 0.001)
    }
}

// MARK: - Copy (web `installPrompt.*`)

final class InstallPromptCopyTests: XCTestCase {
    func testKeysMatchWebSourceVerbatim() {
        XCTAssertEqual(InstallPromptCopy.titleKey, "installPrompt.title")
        XCTAssertEqual(InstallPromptCopy.subtitleKey, "installPrompt.subtitle")
        XCTAssertEqual(InstallPromptCopy.installKey, "installPrompt.install")
        XCTAssertEqual(InstallPromptCopy.dismissKey, "installPrompt.dismiss")
    }

    func testFallbacksMatchWebSourceVerbatim() {
        XCTAssertEqual(InstallPromptCopy.titleFallback, "Install TeslaSync")
        XCTAssertEqual(InstallPromptCopy.subtitleFallback, "Add to home screen for native experience")
        XCTAssertEqual(InstallPromptCopy.installFallback, "Install")
        XCTAssertEqual(InstallPromptCopy.dismissFallback, "Dismiss install prompt")
    }
}

// MARK: - Dismissal window (web `wasDismissedRecently`)

final class InstallPromptDismissalTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private var window: TimeInterval {
        InstallPromptConstants.dismissWindow
    }

    func testNeverDismissedIsNotRecent() {
        XCTAssertFalse(InstallPromptDismissal.isRecent(dismissedAt: nil, now: now))
    }

    func testJustDismissedIsRecent() {
        XCTAssertTrue(InstallPromptDismissal.isRecent(dismissedAt: now, now: now))
    }

    func testWithinWindowIsRecent() {
        let dismissedAt = now.addingTimeInterval(-(window - 86400)) // 13 days ago
        XCTAssertTrue(InstallPromptDismissal.isRecent(dismissedAt: dismissedAt, now: now))
    }

    func testExactlyAtWindowEdgeIsNotRecent() {
        // Web uses a strict `<`, so a dismissal exactly `window` old has expired → prompt re-appears.
        let dismissedAt = now.addingTimeInterval(-window)
        XCTAssertFalse(InstallPromptDismissal.isRecent(dismissedAt: dismissedAt, now: now))
    }

    func testOlderThanWindowIsNotRecent() {
        let dismissedAt = now.addingTimeInterval(-(window + 86400)) // 15 days ago
        XCTAssertFalse(InstallPromptDismissal.isRecent(dismissedAt: dismissedAt, now: now))
    }

    func testFutureInstantIsTreatedAsRecent() {
        // Clock skew: a future-dated dismissal still suppresses the prompt (web `Date.now() - ts < W`).
        let dismissedAt = now.addingTimeInterval(120)
        XCTAssertTrue(InstallPromptDismissal.isRecent(dismissedAt: dismissedAt, now: now))
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class InstallPromptProjectionTests: XCTestCase {
    func testInstallableNotDismissedProjectsData() {
        let resolved = InstallPromptProjection.resolve(input: InstallPromptInput(canInstall: true))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertNil(resolved.emptyKind)
    }

    func testInstalledProjectsEmptyInstalled() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, isInstalled: true)
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .installed)
    }

    func testDismissedProjectsEmptyDismissed() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, dismissed: true)
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .dismissed)
    }

    func testNotInstallableProjectsEmptyUnavailable() {
        let resolved = InstallPromptProjection.resolve(input: InstallPromptInput(canInstall: false))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.emptyKind, .unavailable)
    }

    func testLoadingProjectsLoading() {
        let resolved = InstallPromptProjection.resolve(input: InstallPromptInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorInputProjectsError() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, errorMessage: "probe boom")
        )
        XCTAssertEqual(resolved.phase, .error("probe boom"))
        XCTAssertNil(resolved.emptyKind)
    }

    func testErrorBeatsLoading() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(isLoading: true, errorMessage: "timeout")
        )
        XCTAssertEqual(resolved.phase, .error("timeout"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingBeatsInstalled() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, isInstalled: true, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testInstalledBeatsDismissed() {
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: true, isInstalled: true, dismissed: true)
        )
        XCTAssertEqual(resolved.emptyKind, .installed)
    }

    func testDismissedBeatsUnavailable() {
        // Not installable + dismissed → the dismissed card wins (web standalone/dismissed checked
        // before the missing-affordance branch).
        let resolved = InstallPromptProjection.resolve(
            input: InstallPromptInput(canInstall: false, dismissed: true)
        )
        XCTAssertEqual(resolved.emptyKind, .dismissed)
    }
}

// MARK: - Accessibility

final class InstallPromptAccessibilityTests: XCTestCase {
    func testCardLabelJoinsTitleAndSubtitle() {
        XCTAssertEqual(
            InstallPromptAccessibility.cardLabel(
                title: "Install TeslaSync",
                subtitle: "Add to home screen for native experience"
            ),
            "Install TeslaSync. Add to home screen for native experience"
        )
    }

    func testCardLabelDoesNotDoubleTerminalPunctuation() {
        XCTAssertEqual(
            InstallPromptAccessibility.cardLabel(title: "Install TeslaSync.", subtitle: "Add it now."),
            "Install TeslaSync. Add it now."
        )
    }

    func testCardLabelHandlesEmptyParts() {
        XCTAssertEqual(
            InstallPromptAccessibility.cardLabel(title: "", subtitle: "Only subtitle"),
            "Only subtitle"
        )
        XCTAssertEqual(
            InstallPromptAccessibility.cardLabel(title: "Only title", subtitle: ""),
            "Only title"
        )
    }
}
