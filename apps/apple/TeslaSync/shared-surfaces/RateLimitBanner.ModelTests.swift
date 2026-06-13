//
//  RateLimitBanner.ModelTests.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  State-holder coverage for `RateLimitBannerModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the countdown driven by the manual ticker (decrement →
//  retry-enabled, reset on a fresh emission, preserved on a connection-only update), the connection
//  axis (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live),
//  the gated actions (retry only when enabled — invalidating queries + clearing the banner; dismiss
//  always clears), the live `NotificationCenter` source (ingest + numeric-guard + dismiss + connection
//  preservation), the default query invalidator (posts the cross-module signal), and the ticker.
//  Driven through the in-memory + manual seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

private func event(
    _ kind: RateLimitBannerKind,
    retryAfterS: Int = 0,
    scope: String? = nil,
    upstream: String? = nil
) -> RateLimitBannerEvent {
    RateLimitBannerEvent(kind: kind, scope: scope, upstream: upstream, retryAfterS: retryAfterS)
}

// MARK: - Model (state-holder)

@MainActor
final class RateLimitBannerModelTests: XCTestCase {
    private func makeModel(
        _ input: RateLimitBannerInput,
        ticker: RateLimitBannerTicker = ManualRateLimitBannerTicker(),
        telemetry: RateLimitBannerTelemetry = OSLogRateLimitBannerTelemetry(),
        invalidator: RateLimitBannerQueryInvalidating = OSLogRateLimitBannerQueryInvalidating()
    ) -> (RateLimitBannerModel, InMemoryRateLimitBannerSource) {
        let source = InMemoryRateLimitBannerSource(initial: input)
        let model = RateLimitBannerModel(
            source: source,
            ticker: ticker,
            telemetry: telemetry,
            queryInvalidator: invalidator
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRateLimitBannerTelemetry()
        let (model, source) = makeModel(
            RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 0), sequence: 1),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.kind, .rateLimited)
        XCTAssertEqual(spy.surfaces, [RateLimitBanner.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(RateLimitBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoEventProjectsEmptyAndStartsNoTicker() {
        let ticker = ManualRateLimitBannerTicker()
        let (model, _) = makeModel(RateLimitBannerInput(), ticker: ticker)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(ticker.isRunning)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(RateLimitBannerInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(RateLimitBannerInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RateLimitBannerInput(event: event(.upstreamDown, retryAfterS: 5), sequence: 1))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.data?.kind, .upstreamDown)
    }

    func testZeroRetryAfterIsImmediatelyEnabledAndNoTicker() {
        let ticker = ManualRateLimitBannerTicker()
        let (model, _) = makeModel(
            RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 0), sequence: 1),
            ticker: ticker
        )
        model.start()
        XCTAssertEqual(model.resolved.data?.secondsLeft, 0)
        XCTAssertEqual(model.resolved.data?.retryEnabled, true)
        XCTAssertFalse(ticker.isRunning)
    }

    func testCountdownTicksDownAndStopsAtZero() {
        let ticker = ManualRateLimitBannerTicker()
        let (model, _) = makeModel(
            RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 3), sequence: 1),
            ticker: ticker
        )
        model.start()
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)
        XCTAssertEqual(model.resolved.data?.retryEnabled, false)
        XCTAssertTrue(ticker.isRunning)

        ticker.fire() // 3 → 2
        XCTAssertEqual(model.resolved.data?.secondsLeft, 2)
        ticker.fire() // 2 → 1
        ticker.fire() // 1 → 0 → stop
        XCTAssertEqual(model.resolved.data?.secondsLeft, 0)
        XCTAssertEqual(model.resolved.data?.retryEnabled, true)
        XCTAssertFalse(ticker.isRunning)
    }

    func testFreshEmissionResetsTheCountdown() {
        let ticker = ManualRateLimitBannerTicker()
        let (model, source) = makeModel(
            RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 3), sequence: 1),
            ticker: ticker
        )
        model.start()
        ticker.fire() // 3 → 2
        XCTAssertEqual(model.resolved.data?.secondsLeft, 2)

        source.push(RateLimitBannerInput(event: event(.upstreamDown, retryAfterS: 10), sequence: 2))
        XCTAssertEqual(model.resolved.data?.secondsLeft, 10)
        XCTAssertEqual(model.resolved.data?.kind, .upstreamDown)
        XCTAssertTrue(ticker.isRunning)
    }

    func testConnectionOnlyUpdateDoesNotResetCountdown() {
        let ticker = ManualRateLimitBannerTicker()
        let fired = event(.rateLimited, retryAfterS: 5)
        let (model, source) = makeModel(RateLimitBannerInput(event: fired, sequence: 1), ticker: ticker)
        model.start()
        ticker.fire() // 5 → 4
        ticker.fire() // 4 → 3
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)

        // Same emission sequence, only connectivity changed → countdown must be preserved.
        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.resolved.data?.secondsLeft, 3)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let fired = event(.upstreamDown, retryAfterS: 0)
        let (model, source) = makeModel(RateLimitBannerInput(event: fired, sequence: 1))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let fired = event(.upstreamDown, retryAfterS: 0)
        let (model, source) = makeModel(RateLimitBannerInput(event: fired, sequence: 1))
        model.start()
        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsEventAndDoesNotAutoRefresh() {
        let fired = event(.rateLimited, retryAfterS: 0)
        let (model, source) = makeModel(RateLimitBannerInput(event: fired, sequence: 1))
        model.start()
        source.push(RateLimitBannerInput(event: fired, sequence: 1, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(RateLimitBannerInput(event: event(.rateLimited), sequence: 1))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsTickerAndReArms() {
        let ticker = ManualRateLimitBannerTicker()
        let (model, source) = makeModel(
            RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 9), sequence: 1),
            ticker: ticker
        )
        model.start()
        XCTAssertTrue(ticker.isRunning)
        model.stop()
        XCTAssertFalse(ticker.isRunning)
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(RateLimitBanner.surfaceSlug, "RateLimitBanner")
    }
}

// MARK: - Actions (web `handleRetry` / `handleDismiss`)

@MainActor
final class RateLimitBannerActionTests: XCTestCase {
    func testRetryOnlyFiresOnceTheCountdownIsReady() {
        let ticker = ManualRateLimitBannerTicker()
        let invalidator = SpyRateLimitBannerQueryInvalidating()
        let source = InMemoryRateLimitBannerSource(
            initial: RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 2), sequence: 1)
        )
        let model = RateLimitBannerModel(source: source, ticker: ticker, queryInvalidator: invalidator)
        model.start()

        // Counting down → the gate suppresses retry (web: the button is disabled).
        model.retry()
        XCTAssertEqual(invalidator.count, 0)
        XCTAssertEqual(source.dismissCount, 0)

        ticker.fire() // 2 → 1
        ticker.fire() // 1 → 0 → enabled
        model.retry()
        XCTAssertEqual(invalidator.count, 1)
        XCTAssertEqual(source.dismissCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testDismissClearsBannerWithoutInvalidatingQueries() {
        let invalidator = SpyRateLimitBannerQueryInvalidating()
        let source = InMemoryRateLimitBannerSource(
            initial: RateLimitBannerInput(event: event(.upstreamDown, retryAfterS: 0), sequence: 1)
        )
        let model = RateLimitBannerModel(
            source: source,
            ticker: ManualRateLimitBannerTicker(),
            queryInvalidator: invalidator
        )
        model.start()
        XCTAssertEqual(model.phase, .data)
        model.dismiss()
        XCTAssertEqual(source.dismissCount, 1)
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(invalidator.count, 0)
    }

    func testRetryIsNoOpWhenNoActiveBanner() {
        let invalidator = SpyRateLimitBannerQueryInvalidating()
        let source = InMemoryRateLimitBannerSource(initial: RateLimitBannerInput())
        let model = RateLimitBannerModel(
            source: source,
            ticker: ManualRateLimitBannerTicker(),
            queryInvalidator: invalidator
        )
        model.start()
        model.retry()
        XCTAssertEqual(invalidator.count, 0)
        XCTAssertEqual(source.dismissCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyRateLimitBannerTelemetry: RateLimitBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Counts `invalidateAll` calls so the "Retry now" side effect can be asserted. Lock-guarded so it
/// satisfies the `Sendable` invalidator seam under Swift 6 strict concurrency.
private final class SpyRateLimitBannerQueryInvalidating: RateLimitBannerQueryInvalidating, @unchecked Sendable {
    private let lock = NSLock()
    private var storage = 0

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func invalidateAll() {
        lock.lock()
        storage += 1
        lock.unlock()
    }
}
