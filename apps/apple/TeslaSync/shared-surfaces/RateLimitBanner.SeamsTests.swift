//
//  RateLimitBanner.SeamsTests.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  Seam coverage for the RateLimitBanner surface, split out of the model tests for the file-length
//  budget: the live `NotificationCenter` source (the native parity of the web document CustomEvent
//  listeners — rate-limited / upstream-down ingest, the numeric Retry-After guard, dismiss, and
//  connection preservation), the default query invalidator (posts the cross-module invalidation
//  signal — the native parity of `qc.invalidateQueries()`), and the manual countdown ticker.
//  Driven through the real seams against a private `NotificationCenter` — no network, no real time.
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

// MARK: - Live source (production parity of the document CustomEvents)

@MainActor
final class LiveRateLimitBannerSourceTests: XCTestCase {
    func testRateLimitedNotificationIsIngested() throws {
        let center = NotificationCenter()
        let source = LiveRateLimitBannerSource(center: center)
        var inputs: [RateLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        center.post(name: RateLimitBannerNotification.rateLimited, object: nil, userInfo: [
            RateLimitBannerNotification.scopeKey: "/vehicles",
            RateLimitBannerNotification.retryAfterSecondsKey: 30
        ])
        let last = try XCTUnwrap(inputs.last)
        XCTAssertEqual(last.event?.kind, .rateLimited)
        XCTAssertEqual(last.event?.scope, "/vehicles")
        XCTAssertEqual(last.event?.retryAfterS, 30)
        XCTAssertEqual(last.sequence, 1)
    }

    func testUpstreamDownNotificationIsIngested() throws {
        let center = NotificationCenter()
        let source = LiveRateLimitBannerSource(center: center)
        var inputs: [RateLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        center.post(name: RateLimitBannerNotification.upstreamDown, object: nil, userInfo: [
            RateLimitBannerNotification.upstreamKey: "tesla",
            RateLimitBannerNotification.retryAfterSecondsKey: 20
        ])
        let last = try XCTUnwrap(inputs.last)
        XCTAssertEqual(last.event?.kind, .upstreamDown)
        XCTAssertEqual(last.event?.upstream, "tesla")
        XCTAssertEqual(last.event?.retryAfterS, 20)
    }

    func testNotificationWithoutNumericRetryIsIgnored() {
        let center = NotificationCenter()
        let source = LiveRateLimitBannerSource(center: center)
        var inputs: [RateLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        let countAfterStart = inputs.count
        center.post(name: RateLimitBannerNotification.rateLimited, object: nil, userInfo: [
            RateLimitBannerNotification.retryAfterSecondsKey: "not-a-number"
        ])
        XCTAssertEqual(inputs.count, countAfterStart)
        XCTAssertNil(inputs.last?.event)
    }

    func testDismissClearsTheEventAndBumpsSequence() throws {
        let center = NotificationCenter()
        let source = LiveRateLimitBannerSource(center: center)
        var inputs: [RateLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        source.ingest(event(.rateLimited, retryAfterS: 5))
        XCTAssertEqual(inputs.last?.event?.kind, .rateLimited)
        let seqBeforeDismiss = try XCTUnwrap(inputs.last?.sequence)
        source.dismiss()
        XCTAssertNil(inputs.last?.event)
        XCTAssertGreaterThan(try XCTUnwrap(inputs.last?.sequence), seqBeforeDismiss)
    }

    func testUpdateConnectionPreservesSequence() throws {
        let center = NotificationCenter()
        let source = LiveRateLimitBannerSource(center: center)
        var inputs: [RateLimitBannerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        source.ingest(event(.upstreamDown, retryAfterS: 8))
        let seqAfterIngest = try XCTUnwrap(inputs.last?.sequence)
        source.update(connection: .stale)
        XCTAssertEqual(inputs.last?.connection, .stale)
        XCTAssertEqual(inputs.last?.sequence, seqAfterIngest)
    }

    func testRetryAfterSecondsParserAcceptsOnlyNumbers() {
        XCTAssertEqual(RateLimitBannerNotification.retryAfterSeconds(from: 30), 30)
        XCTAssertEqual(RateLimitBannerNotification.retryAfterSeconds(from: 12.9), 12)
        XCTAssertEqual(RateLimitBannerNotification.retryAfterSeconds(from: NSNumber(value: 7)), 7)
        XCTAssertNil(RateLimitBannerNotification.retryAfterSeconds(from: "5"))
        XCTAssertNil(RateLimitBannerNotification.retryAfterSeconds(from: nil))
    }
}

// MARK: - Query invalidator (default cross-module signal)

final class RateLimitBannerQueryInvalidatorTests: XCTestCase {
    func testDefaultInvalidatorPostsTheInvalidationSignal() {
        let center = NotificationCenter()
        let expectation = expectation(description: "invalidation signal posted")
        let token = center.addObserver(
            forName: RateLimitBannerNotification.queryInvalidationRequested,
            object: nil,
            queue: nil
        ) { _ in expectation.fulfill() }
        defer { center.removeObserver(token) }

        OSLogRateLimitBannerQueryInvalidating(center: center).invalidateAll()
        wait(for: [expectation], timeout: 1)
    }
}

// MARK: - Ticker (manual test double)

@MainActor
final class ManualRateLimitBannerTickerTests: XCTestCase {
    func testFireInvokesScheduledTick() {
        let ticker = ManualRateLimitBannerTicker()
        var ticks = 0
        ticker.start(interval: 1) { ticks += 1 }
        ticker.fire()
        ticker.fire()
        XCTAssertEqual(ticks, 2)
        XCTAssertEqual(ticker.startCount, 1)
        XCTAssertTrue(ticker.isRunning)
    }

    func testStopPreventsFurtherTicks() {
        let ticker = ManualRateLimitBannerTicker()
        var ticks = 0
        ticker.start(interval: 1) { ticks += 1 }
        ticker.stop()
        ticker.fire()
        XCTAssertEqual(ticks, 0)
        XCTAssertFalse(ticker.isRunning)
        XCTAssertEqual(ticker.stopCount, 1)
    }

    func testFireTimesStopsEarlyWhenHalted() {
        let ticker = ManualRateLimitBannerTicker()
        var ticks = 0
        ticker.start(interval: 1) {
            ticks += 1
            if ticks == 2 { ticker.stop() }
        }
        ticker.fire(times: 5)
        XCTAssertEqual(ticks, 2)
    }
}
