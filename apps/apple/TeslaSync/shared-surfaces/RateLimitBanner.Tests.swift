//
//  RateLimitBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  Adapter + projection coverage for the RateLimitBanner surface:
//    • Kind — the web `state.kind` → icon + message-key mapping (rate-limited / upstream-down).
//    • Countdown — the web `remaining` arithmetic (initial / tick / retry-enabled) and the "{n}s"
//      interpolation.
//    • Copy — the web `isRateLimit ? ratelimit.banner : upstream.banner` message ternary, resolved
//      through the facade.
//    • Projection — the render branches plus the P4 leaf contract across loading / empty / error /
//      data, including the retry-enabled gate and the retained scope / upstream detail.
//    • Accessibility — the composed VoiceOver banner label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private let identityResolve: RateLimitBannerResolve = { _, fallback in fallback }
private let keyEchoResolve: RateLimitBannerResolve = { key, _ in key }

private func event(
    _ kind: RateLimitBannerKind,
    retryAfterS: Int = 0,
    scope: String? = nil,
    upstream: String? = nil
) -> RateLimitBannerEvent {
    RateLimitBannerEvent(kind: kind, scope: scope, upstream: upstream, retryAfterS: retryAfterS)
}

// MARK: - Kind (web `state.kind`)

final class RateLimitBannerKindTests: XCTestCase {
    func testEachKindHasADistinctSymbol() {
        let symbols = Set(RateLimitBannerKind.allCases.map(\.systemImageName))
        XCTAssertEqual(symbols.count, RateLimitBannerKind.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }

    func testKindsMapToWebIcons() {
        XCTAssertEqual(RateLimitBannerKind.rateLimited.systemImageName, "clock")
        XCTAssertEqual(RateLimitBannerKind.upstreamDown.systemImageName, "exclamationmark.circle")
    }

    func testKindMessageKeysMatchWebSource() {
        XCTAssertEqual(RateLimitBannerKind.rateLimited.messageKey, "ratelimit.banner")
        XCTAssertEqual(RateLimitBannerKind.upstreamDown.messageKey, "upstream.banner")
    }

    func testKindMessageFallbacksCarryTheCountdownToken() {
        for kind in RateLimitBannerKind.allCases {
            XCTAssertTrue(kind.messageFallback.contains(RateLimitBannerCountdown.secondsToken))
            XCTAssertFalse(kind.messageFallback.isEmpty)
        }
    }
}

// MARK: - Countdown (web `remaining`)

final class RateLimitBannerCountdownTests: XCTestCase {
    func testInitialClampsNegativeToZero() {
        XCTAssertEqual(RateLimitBannerCountdown.initial(retryAfterS: 30), 30)
        XCTAssertEqual(RateLimitBannerCountdown.initial(retryAfterS: 0), 0)
        XCTAssertEqual(RateLimitBannerCountdown.initial(retryAfterS: -5), 0)
    }

    func testTickDecrementsAndFloorsAtZero() {
        XCTAssertEqual(RateLimitBannerCountdown.tick(3), 2)
        XCTAssertEqual(RateLimitBannerCountdown.tick(1), 0)
        XCTAssertEqual(RateLimitBannerCountdown.tick(0), 0)
        XCTAssertEqual(RateLimitBannerCountdown.tick(-2), 0)
    }

    func testRetryEnabledOnlyAtZeroOrBelow() {
        XCTAssertFalse(RateLimitBannerCountdown.isRetryEnabled(secondsLeft: 5))
        XCTAssertTrue(RateLimitBannerCountdown.isRetryEnabled(secondsLeft: 0))
        XCTAssertTrue(RateLimitBannerCountdown.isRetryEnabled(secondsLeft: -1))
    }

    func testTextSubstitutesSeconds() {
        XCTAssertEqual(
            RateLimitBannerCountdown.text(seconds: 12, template: "wait {n}s"),
            "wait 12s"
        )
        XCTAssertEqual(
            RateLimitBannerCountdown.text(seconds: 0, template: "wait {n}s"),
            "wait 0s"
        )
    }

    func testTextClampsNegativeSeconds() {
        XCTAssertEqual(RateLimitBannerCountdown.text(seconds: -3, template: "{n}s left"), "0s left")
    }

    func testTextToleratesTemplateWithoutToken() {
        XCTAssertEqual(RateLimitBannerCountdown.text(seconds: 9, template: "no token"), "no token")
    }
}

// MARK: - Copy (web message ternary)

final class RateLimitBannerCopyTests: XCTestCase {
    func testRateLimitedMessageInterpolatesSeconds() {
        let text = RateLimitBannerCopy.message(kind: .rateLimited, seconds: 30, resolve: identityResolve)
        XCTAssertEqual(text, "Too many requests — pausing for 30s")
    }

    func testUpstreamMessageInterpolatesSeconds() {
        let text = RateLimitBannerCopy.message(kind: .upstreamDown, seconds: 12, resolve: identityResolve)
        XCTAssertEqual(text, "Tesla upstream unavailable — retry in 12s")
    }

    func testMessageResolvesThroughTheFacadeKey() {
        // The echo resolver returns the key verbatim (no token) → proves the key is passed through.
        let text = RateLimitBannerCopy.message(kind: .rateLimited, seconds: 5, resolve: keyEchoResolve)
        XCTAssertEqual(text, "ratelimit.banner")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class RateLimitBannerProjectionTests: XCTestCase {
    func testErrorTakesPrecedenceOverEverything() {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(
                event: event(.rateLimited, retryAfterS: 30),
                sequence: 1,
                isLoading: true,
                errorMessage: "boom"
            ),
            secondsLeft: 30
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(event: event(.rateLimited), sequence: 1, errorMessage: ""),
            secondsLeft: 0
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(isLoading: true),
            secondsLeft: 0
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoEvent() {
        let resolved = RateLimitBannerProjection.resolve(input: RateLimitBannerInput(), secondsLeft: 0)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.data)
    }

    func testDataDerivesKindScopeAndCountdown() throws {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(
                event: event(.rateLimited, retryAfterS: 30, scope: "/vehicles"),
                sequence: 1
            ),
            secondsLeft: 18
        )
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.kind, .rateLimited)
        XCTAssertEqual(data.scope, "/vehicles")
        XCTAssertNil(data.upstream)
        XCTAssertEqual(data.secondsLeft, 18)
        XCTAssertFalse(data.retryEnabled)
    }

    func testUpstreamDataCarriesUpstreamName() throws {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(
                event: event(.upstreamDown, retryAfterS: 20, upstream: "tesla"),
                sequence: 1
            ),
            secondsLeft: 20
        )
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.kind, .upstreamDown)
        XCTAssertEqual(data.upstream, "tesla")
        XCTAssertNil(data.scope)
    }

    func testDataClampsNegativeSecondsAndEnablesRetry() throws {
        let resolved = RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(event: event(.upstreamDown), sequence: 1),
            secondsLeft: -4
        )
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.secondsLeft, 0)
        XCTAssertTrue(data.retryEnabled)
    }

    func testRetryDisabledWhileCountingDown() throws {
        let counting = try XCTUnwrap(RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(event: event(.rateLimited, retryAfterS: 30), sequence: 1),
            secondsLeft: 1
        ).data)
        XCTAssertFalse(counting.retryEnabled)

        let ready = try XCTUnwrap(RateLimitBannerProjection.resolve(
            input: RateLimitBannerInput(event: event(.rateLimited), sequence: 1),
            secondsLeft: 0
        ).data)
        XCTAssertTrue(ready.retryEnabled)
    }
}

// MARK: - Accessibility

final class RateLimitBannerAccessibilityTests: XCTestCase {
    func testBannerLabelIsTheTrimmedMessage() {
        let label = RateLimitBannerAccessibility.bannerLabel(message: "  Too many requests — pausing for 30s  ")
        XCTAssertEqual(label, "Too many requests — pausing for 30s")
    }

    func testBannerLabelMatchesTheRenderedMessage() {
        let message = RateLimitBannerCopy.message(kind: .upstreamDown, seconds: 8, resolve: identityResolve)
        XCTAssertEqual(
            RateLimitBannerAccessibility.bannerLabel(message: message),
            "Tesla upstream unavailable — retry in 8s"
        )
    }
}
