//
//  LiveStaleDataBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  Adapter + projection + model coverage for the LiveStaleDataBanner surface:
//    • Copy — the web `live.staleBanner.title` / `live.staleBanner.message` constants and the canonical
//      web source-key list (the parity guard).
//    • Window — the two-minute staleness decision (the web `STALE_BANNER_THRESHOLD_MS`): the inclusive
//      boundary, the sub-threshold miss, the non-disconnected statuses, and the future-dated clamp.
//    • Accessibility — the combined, whitespace-collapsed VoiceOver summary (title + body + the optional
//      reconnecting note when the reading is stale).
//    • Projection — every render branch across error / loading (unknown) / healthy (connected,
//      reconnecting, sub-threshold disconnect) / stale, with a sustained outage surviving a transient
//      feed error (the P4 leaf contract) and the freshness axis carried through.
//    • Model — start telemetry, snapshot application, the clock-driven tick promoting healthy → stale at
//      the two-minute crossing, the banner clearing when the pipe reconnects, the one-shot stale
//      auto-refresh (armed on the transition, re-armed after leaving stale), manual refresh, and stop.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real transport, so
//  each assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source against a fixed clock. The string resolver is the identity-fallback so the asserted copy is
//  deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: LiveStaleResolve = { _, fallback in fallback }

private let bannerMessage =
    "The live data connection has been offline for more than 2 minutes. "
        + "Values on this page may be stale until the connection is restored."

private enum LiveStaleFixture {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func ago(_ seconds: TimeInterval) -> Date {
        now.addingTimeInterval(-seconds)
    }
}

// MARK: - Copy (web `t('live.staleBanner.*', …)`)

final class LiveStaleMessageTests: XCTestCase {
    func testTitleIsTheConstantHeadline() {
        XCTAssertEqual(LiveStaleMessage.title(fallbackStrings), "Live data unavailable")
    }

    func testMessageIsTheTwoMinuteReassurance() {
        XCTAssertEqual(LiveStaleMessage.message(fallbackStrings), bannerMessage)
    }

    func testWebSourceKeysMirrorTheComponentInRenderOrder() {
        XCTAssertEqual(
            LiveStaleMessage.webSourceKeys,
            ["live.staleBanner.title", "live.staleBanner.message"]
        )
    }
}

// MARK: - Window (web `STALE_BANNER_THRESHOLD_MS`)

final class LiveStaleWindowTests: XCTestCase {
    func testThresholdIsTwoMinutes() {
        XCTAssertEqual(LiveStaleWindow.threshold, 120)
    }

    func testDisconnectedAtThresholdIsStale() {
        XCTAssertTrue(LiveStaleWindow.isStale(
            status: .disconnected, since: LiveStaleFixture.ago(120), now: LiveStaleFixture.now
        ))
    }

    func testDisconnectedBelowThresholdIsNotStale() {
        XCTAssertFalse(LiveStaleWindow.isStale(
            status: .disconnected, since: LiveStaleFixture.ago(119), now: LiveStaleFixture.now
        ))
    }

    func testNonDisconnectedStatusesAreNeverStale() {
        for status in [LiveStaleStatus.connected, .reconnecting, .unknown] {
            XCTAssertFalse(LiveStaleWindow.isStale(
                status: status, since: LiveStaleFixture.ago(600), now: LiveStaleFixture.now
            ), "\(status) must never be stale")
        }
    }

    func testFutureDatedSinceClampsElapsedToZero() {
        XCTAssertEqual(
            LiveStaleWindow.elapsed(since: LiveStaleFixture.now.addingTimeInterval(50), now: LiveStaleFixture.now),
            0
        )
    }
}

// MARK: - Accessibility

final class LiveStaleAccessibilityTests: XCTestCase {
    func testBannerSummaryCombinesTitleAndBody() {
        XCTAssertEqual(
            LiveStaleAccessibility.bannerSummary(
                title: "Live data unavailable",
                body: "Offline.",
                strings: fallbackStrings
            ),
            "Live data unavailable Offline."
        )
    }

    func testBannerSummaryCollapsesWhitespace() {
        XCTAssertEqual(
            LiveStaleAccessibility.bannerSummary(
                title: "  Live ",
                body: "Offline  for   2m. ",
                strings: fallbackStrings
            ),
            "Live Offline for 2m."
        )
    }

    func testBannerSummaryAppendsReconnectingNoteWhenStale() {
        let summary = LiveStaleAccessibility.bannerSummary(
            title: "Live data unavailable", body: "Offline.", freshness: .stale, strings: fallbackStrings
        )
        XCTAssertEqual(summary, "Live data unavailable Offline. Reconnecting to live data.")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class LiveStaleDataBannerProjectionTests: XCTestCase {
    private func resolve(_ input: LiveStaleDataBannerInput) -> LiveStaleDataBannerResolved {
        LiveStaleDataBannerProjection.resolve(input: input, now: LiveStaleFixture.now, strings: fallbackStrings)
    }

    func testUnknownIsLoading() {
        XCTAssertEqual(resolve(LiveStaleDataBannerInput(status: .unknown)).phase, .loading)
    }

    func testConnectedIsHealthy() {
        XCTAssertEqual(resolve(LiveStaleDataBannerInput(status: .connected)).phase, .healthy)
    }

    func testReconnectingIsHealthy() {
        XCTAssertEqual(resolve(LiveStaleDataBannerInput(status: .reconnecting)).phase, .healthy)
    }

    func testRecentDisconnectIsHealthy() {
        let input = LiveStaleDataBannerInput(status: .disconnected, statusSince: LiveStaleFixture.ago(60))
        XCTAssertEqual(resolve(input).phase, .healthy)
    }

    func testSustainedDisconnectRendersBannerWithComposedCopy() {
        let input = LiveStaleDataBannerInput(status: .disconnected, statusSince: LiveStaleFixture.ago(180))
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .stale)
        XCTAssertEqual(resolved.data?.title, "Live data unavailable")
        XCTAssertEqual(resolved.data?.body, bannerMessage)
        XCTAssertEqual(resolved.data?.accessibilitySummary, "Live data unavailable \(bannerMessage)")
        XCTAssertEqual(resolved.freshness, .live)
    }

    func testStaleFreshnessIsCarriedIntoTheBanner() {
        let input = LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(300), freshness: .stale
        )
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .stale)
        XCTAssertEqual(resolved.freshness, .stale)
        XCTAssertEqual(
            resolved.data?.accessibilitySummary,
            "Live data unavailable \(bannerMessage) Reconnecting to live data."
        )
    }

    func testErrorWithNoOutageIsError() {
        let input = LiveStaleDataBannerInput(status: .unknown, errorMessage: "boom")
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorWithSustainedOutageKeepsShowingTheBanner() {
        let input = LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(180), errorMessage: "boom"
        )
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .stale)
        XCTAssertEqual(resolved.data?.title, "Live data unavailable")
    }
}

// MARK: - Model (state holder + tick + auto-refresh)

private final class SpyLiveStaleTelemetry: LiveStaleDataBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

private final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock()
        current = current.addingTimeInterval(seconds)
        lock.unlock()
    }
}

@MainActor
final class LiveStaleDataBannerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryLiveStaleDataBannerSource,
        telemetry: LiveStaleDataBannerTelemetry = SpyLiveStaleTelemetry(),
        clock: @escaping @Sendable () -> Date = { LiveStaleFixture.now }
    ) -> LiveStaleDataBannerModel {
        LiveStaleDataBannerModel(
            source: source,
            telemetry: telemetry,
            strings: fallbackStrings,
            clock: clock
        )
    }

    private func sustainedOutage() -> LiveStaleDataBannerInput {
        LiveStaleDataBannerInput(status: .disconnected, statusSince: LiveStaleFixture.ago(180))
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryLiveStaleDataBannerSource(initial: LiveStaleDataBannerInput(status: .connected))
        let telemetry = SpyLiveStaleTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["LiveStaleDataBanner"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .healthy)
    }

    func testApplyDrivesPhaseToTheBanner() {
        let source = InMemoryLiveStaleDataBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(sustainedOutage())

        XCTAssertEqual(model.phase, .stale)
        XCTAssertEqual(model.data?.title, "Live data unavailable")
        XCTAssertEqual(model.freshness, .live)
    }

    func testTickPromotesHealthyToBannerAtTheTwoMinuteCrossing() {
        let box = MutableClock(LiveStaleFixture.now)
        let source = InMemoryLiveStaleDataBannerSource(
            initial: LiveStaleDataBannerInput(status: .disconnected, statusSince: LiveStaleFixture.now)
        )
        let model = makeModel(source: source, clock: { box.now })
        model.start()
        XCTAssertEqual(model.phase, .healthy)

        box.advance(130)
        model.tick()

        XCTAssertEqual(model.phase, .stale)
    }

    func testBannerClearsWhenThePipeReconnects() {
        let source = InMemoryLiveStaleDataBannerSource(initial: sustainedOutage())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .stale)

        source.push(LiveStaleDataBannerInput(status: .connected))

        XCTAssertEqual(model.phase, .healthy)
    }

    func testStaleFreshnessTransitionAutoRefreshesOnce() {
        let source = InMemoryLiveStaleDataBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(LiveStaleDataBannerInput(status: .disconnected, statusSince: LiveStaleFixture.ago(180)))
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(300), freshness: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale reading does not re-trigger the one-shot auto-refresh.
        source.push(LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(360), freshness: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterLeavingStale() {
        let source = InMemoryLiveStaleDataBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(300), freshness: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(LiveStaleDataBannerInput(status: .connected, freshness: .live))
        source.push(LiveStaleDataBannerInput(
            status: .disconnected, statusSince: LiveStaleFixture.ago(300), freshness: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let source = InMemoryLiveStaleDataBannerSource()
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryLiveStaleDataBannerSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
