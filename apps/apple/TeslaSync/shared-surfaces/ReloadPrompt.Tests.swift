//
//  ReloadPrompt.Tests.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  Adapter + projection + model coverage for the ReloadPrompt surface:
//    • Constants — the web literals (`COUNTDOWN_SECONDS`, `UPDATE_CHECK_INTERVAL_MS`, the `{{seconds}}`
//      interpolation token).
//    • Countdown — the web `setCountdown` reducer: decrement, the reload threshold, and the
//      already-elapsed guard.
//    • Copy — the `{{seconds}}` interpolation (web `t('pwa.reloadingIn', { seconds })`).
//    • Accessibility — the composed VoiceOver banner label.
//    • Projection — every render branch across checking / idle / failed, with a staged update always
//      winning over the check status (the P4 leaf contract).
//    • Model — start telemetry, snapshot application, the one-second countdown driving an auto-reload,
//      the "Reload Now" / "Later" intents, the countdown reset on re-appearance, and the stale
//      auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real registration, so
//  each assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source.
//

import XCTest
@testable import TeslaSync

// MARK: - Constants (web literals)

final class ReloadPromptConstantsTests: XCTestCase {
    func testCountdownMatchesWebThreeSeconds() {
        XCTAssertEqual(ReloadPromptConstants.countdownSeconds, 3)
    }

    func testUpdateCheckIntervalMatchesWebFiveMinutes() {
        // Web `UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000` → 300 seconds.
        XCTAssertEqual(ReloadPromptConstants.updateCheckInterval, 300, accuracy: 0.0001)
    }

    func testSecondsTokenMatchesWebInterpolation() {
        XCTAssertEqual(ReloadPromptConstants.secondsToken, "{{seconds}}")
    }
}

// MARK: - Countdown (web `setCountdown` reducer)

final class ReloadCountdownTests: XCTestCase {
    func testDecrementsWhileAboveOne() {
        XCTAssertEqual(ReloadCountdown.next(from: 3), .tick(2))
        XCTAssertEqual(ReloadCountdown.next(from: 2), .tick(1))
        XCTAssertEqual(ReloadCountdown.next(from: 5), .tick(4))
    }

    func testReloadsAtThreshold() {
        XCTAssertEqual(ReloadCountdown.next(from: 1), .reload)
    }

    func testReloadsWhenAlreadyElapsed() {
        XCTAssertEqual(ReloadCountdown.next(from: 0), .reload)
        XCTAssertEqual(ReloadCountdown.next(from: -3), .reload)
    }
}

// MARK: - Copy (web `t('pwa.reloadingIn', { seconds })`)

final class ReloadPromptCopyTests: XCTestCase {
    func testSubstitutesTheLiveSecond() {
        XCTAssertEqual(
            ReloadPromptCopy.reloadingIn(template: "Reloading in {{seconds}}s...", seconds: 3),
            "Reloading in 3s..."
        )
        XCTAssertEqual(
            ReloadPromptCopy.reloadingIn(template: "Reloading in {{seconds}}s...", seconds: 0),
            "Reloading in 0s..."
        )
    }

    func testLeavesATemplateWithoutTheTokenUntouched() {
        XCTAssertEqual(
            ReloadPromptCopy.reloadingIn(template: "Reloading shortly", seconds: 2),
            "Reloading shortly"
        )
    }
}

// MARK: - Accessibility

final class ReloadPromptAccessibilityTests: XCTestCase {
    func testLabelReadsTitleThenStatus() {
        let label = ReloadPromptAccessibility.bannerLabel(
            title: "New version available",
            status: "Reloading in 3s..."
        )
        XCTAssertEqual(label, "New version available. Reloading in 3s...")
    }

    func testLabelSkipsEmptyPartsWithoutDoublingPunctuation() {
        XCTAssertEqual(
            ReloadPromptAccessibility.bannerLabel(title: "", status: "Reloading in 1s..."),
            "Reloading in 1s..."
        )
        XCTAssertEqual(
            ReloadPromptAccessibility.bannerLabel(title: "Update ready!", status: "Reloading"),
            "Update ready! Reloading"
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class ReloadPromptProjectionTests: XCTestCase {
    func testCheckingWithNoUpdateIsLoading() {
        let resolved = ReloadPromptProjection.resolve(status: .checking, updateAvailable: false, connection: .live)
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testCheckingWithStagedUpdateShowsData() {
        let resolved = ReloadPromptProjection.resolve(status: .checking, updateAvailable: true, connection: .live)
        XCTAssertEqual(resolved.phase, .data)
    }

    func testIdleWithNoUpdateIsEmpty() {
        let resolved = ReloadPromptProjection.resolve(status: .idle, updateAvailable: false, connection: .live)
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testIdleWithStagedUpdateIsData() {
        let resolved = ReloadPromptProjection.resolve(status: .idle, updateAvailable: true, connection: .live)
        XCTAssertEqual(resolved.phase, .data)
    }

    func testFailedWithNoUpdateIsError() {
        let resolved = ReloadPromptProjection.resolve(
            status: .failed("boom"), updateAvailable: false, connection: .live
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testFailedWithStagedUpdateKeepsShowingData() {
        let resolved = ReloadPromptProjection.resolve(
            status: .failed("boom"), updateAvailable: true, connection: .offline
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Model (state holder + countdown + intents)

private final class SpyReloadPromptTelemetry: ReloadPromptTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
final class ReloadPromptModelTests: XCTestCase {
    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryReloadPromptSource(initial: ReloadPromptUpdate(status: .idle))
        let telemetry = SpyReloadPromptTelemetry()
        let model = ReloadPromptModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["ReloadPrompt"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseConnectionAndResetsCountdown() {
        let source = InMemoryReloadPromptSource()
        let model = ReloadPromptModel(source: source)
        model.start()

        source.push(ReloadPromptUpdate(status: .idle, updateAvailable: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.countdown, ReloadPromptConstants.countdownSeconds)
    }

    func testTickCountsDownThenReloadsExactlyOnce() {
        let source = InMemoryReloadPromptSource(initial: ReloadPromptUpdate(status: .idle, updateAvailable: true))
        let model = ReloadPromptModel(source: source)
        model.start()
        XCTAssertEqual(model.countdown, 3)

        model.tick()
        XCTAssertEqual(model.countdown, 2)
        model.tick()
        XCTAssertEqual(model.countdown, 1)
        model.tick()
        XCTAssertEqual(model.countdown, 0)
        XCTAssertEqual(source.applyCount, 1)

        // A stray tick after the reload must not fire a second activation.
        model.tick()
        XCTAssertEqual(source.applyCount, 1)
    }

    func testReloadNowActivatesImmediatelyAndIsIdempotent() {
        let source = InMemoryReloadPromptSource(initial: ReloadPromptUpdate(status: .idle, updateAvailable: true))
        let model = ReloadPromptModel(source: source)
        model.start()

        model.reloadNow()
        XCTAssertEqual(source.applyCount, 1)
        XCTAssertEqual(model.countdown, 0)

        model.reloadNow()
        XCTAssertEqual(source.applyCount, 1)
    }

    func testDismissHidesBannerAndNotifiesSource() {
        let source = InMemoryReloadPromptSource(initial: ReloadPromptUpdate(status: .idle, updateAvailable: true))
        let model = ReloadPromptModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .data)

        model.dismiss()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(source.dismissCount, 1)
        XCTAssertEqual(source.applyCount, 0)
    }

    func testCountdownResetsWhenTheBannerReappears() {
        let source = InMemoryReloadPromptSource()
        let model = ReloadPromptModel(source: source)
        model.start()

        source.push(ReloadPromptUpdate(status: .idle, updateAvailable: true))
        model.tick()
        model.tick()
        XCTAssertEqual(model.countdown, 1)

        // Banner hidden, then a fresh build is staged again: the countdown restarts from the top and the
        // surface can reload again.
        source.push(ReloadPromptUpdate(status: .idle, updateAvailable: false))
        XCTAssertEqual(model.phase, .empty)
        source.push(ReloadPromptUpdate(status: .idle, updateAvailable: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.countdown, ReloadPromptConstants.countdownSeconds)

        model.reloadNow()
        XCTAssertEqual(source.applyCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryReloadPromptSource()
        let model = ReloadPromptModel(source: source)
        model.start()

        source.push(ReloadPromptUpdate(status: .idle, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(ReloadPromptUpdate(status: .idle, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testAutoRefreshIfStaleGuardsOnConnectionAndChecking() {
        let source = InMemoryReloadPromptSource()
        let model = ReloadPromptModel(source: source)
        model.start()

        // Live → no refresh.
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)

        // Offline + already checking → no refresh.
        source.push(ReloadPromptUpdate(status: .checking, connection: .offline, isChecking: true))
        let baseline = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, baseline)
    }

    func testStopStopsSource() {
        let source = InMemoryReloadPromptSource()
        let model = ReloadPromptModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
