//
//  RateLimitStatusPanel.Tests.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  Unit coverage for the RateLimitStatusPanel surface:
//    • Adapter — fmtNumber / formatDurationMsLong / formatRelative ports, the
//      snake_case wire decode, and the per-row projection (bar fraction + refill
//      countdown + meta flags).
//    • State holder — `RateLimitProjection` phase resolution across loading / error /
//      empty / data plus the stale / offline overlays, the `RateLimitModel` wiring,
//      and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryRateLimitSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (port of web fmtNumber)

final class RateLimitNumberFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    func testDefaultPrecisionIsTwoDecimals() {
        XCTAssertEqual(RateLimitNumberFormat.format(1, locale: enUS), "1.00")
        XCTAssertEqual(RateLimitNumberFormat.format(350, locale: enUS), "350.00")
    }

    func testGroupingSeparatorApplied() {
        XCTAssertEqual(RateLimitNumberFormat.format(1234.5, locale: enUS), "1,234.50")
    }

    func testDecimalsOverride() {
        XCTAssertEqual(RateLimitNumberFormat.format(42, decimals: 0, locale: enUS), "42")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(RateLimitNumberFormat.format(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(RateLimitNumberFormat.format(.nan, locale: enUS), "0.00")
    }
}

// MARK: - Duration formatting (port of web formatDurationMsLong)

final class RateLimitDurationTests: XCTestCase {
    func testNullishAndNonPositiveReturnDash() {
        XCTAssertEqual(RateLimitDuration.long(nil), "—")
        XCTAssertEqual(RateLimitDuration.long(0), "—")
        XCTAssertEqual(RateLimitDuration.long(-100), "—")
    }

    func testSubSecondMilliseconds() {
        XCTAssertEqual(RateLimitDuration.long(500), "500ms")
    }

    func testSubMinuteSeconds() {
        XCTAssertEqual(RateLimitDuration.long(1500), "1.5s")
    }

    func testMinutesAndSeconds() {
        XCTAssertEqual(RateLimitDuration.long(65000), "1m 5s")
        XCTAssertEqual(RateLimitDuration.long(120_000), "2m 0s")
    }
}

// MARK: - Relative time (port of web formatRelative)

final class RateLimitRelativeTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_762_000_000)

    func testNilReturnsDash() {
        XCTAssertEqual(RateLimitRelative.format(nil), "—")
    }

    func testThresholds() {
        XCTAssertEqual(RateLimitRelative.format(base, now: base.addingTimeInterval(30)), "just now")
        XCTAssertEqual(RateLimitRelative.format(base, now: base.addingTimeInterval(300)), "5m ago")
        XCTAssertEqual(RateLimitRelative.format(base, now: base.addingTimeInterval(3 * 3600)), "3h ago")
        XCTAssertEqual(RateLimitRelative.format(base, now: base.addingTimeInterval(2 * 86400)), "2d ago")
    }

    func testWeekOrMoreFallsBackToAbsoluteDate() {
        let locale = Locale(identifier: "en_US_POSIX")
        let utc = TimeZone(identifier: "UTC") ?? .current
        let out = RateLimitRelative.format(
            base,
            now: base.addingTimeInterval(10 * 86400),
            locale: locale,
            timeZone: utc
        )
        XCTAssertNotEqual(out, "—")
        XCTAssertFalse(out.contains("ago"))
        XCTAssertTrue(out.contains("2025"))
    }
}

// MARK: - Wire decode (snake_case → model)

final class RateLimitDecodeTests: XCTestCase {
    private func decode(_ json: String) -> RateLimitStatusResponse? {
        RateLimitStatusResponse.decode(Data(json.utf8))
    }

    func testDecodesSnakeCaseEnvelope() {
        let response = decode("""
        {
          "generated_at": "2026-05-05T12:00:00Z",
          "scopes": [
            {"id": "a", "name": "A", "current": 1, "limit": 5, "window_seconds": 0, "severity": "ok"},
            {"id": "b", "name": "B", "current": 350, "limit": 600, "window_seconds": 60,
             "reset_at": "2026-05-05T12:00:30Z", "severity": "warn", "detail": "shared"},
            {"id": "c", "name": "C", "current": 110, "limit": 120, "window_seconds": 60, "severity": "critical"}
          ]
        }
        """)
        XCTAssertNotNil(response)
        XCTAssertNotNil(response?.generatedAt)
        XCTAssertEqual(response?.scopes.count, 3)
        XCTAssertEqual(response?.scopes[0].windowSeconds, 0)
        XCTAssertEqual(response?.scopes[0].severity, .ok)
        XCTAssertNil(response?.scopes[0].detail)
        XCTAssertNotNil(response?.scopes[1].resetAt)
        XCTAssertEqual(response?.scopes[1].detail, "shared")
        XCTAssertEqual(response?.scopes[2].severity, .critical)
    }

    func testUnknownSeverityDegradesToWarn() {
        let response = decode("""
        {"generated_at": null, "scopes": [
          {"id": "x", "name": "X", "current": 0, "limit": 1, "window_seconds": 1, "severity": "bananas"}
        ]}
        """)
        XCTAssertEqual(response?.scopes.first?.severity, .warn)
        XCTAssertNil(response?.generatedAt)
    }
}

// MARK: - Row projection (web RateLimitRow inline maths)

final class RateLimitRowProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_762_000_000)

    private func scope(
        current: Double,
        limit: Double,
        windowSeconds: Int = 60,
        resetAt: Date? = nil,
        detail: String? = nil
    ) -> RateLimitScope {
        RateLimitScope(
            id: "id",
            name: "name",
            current: current,
            limit: limit,
            windowSeconds: windowSeconds,
            resetAt: resetAt,
            severity: .ok,
            detail: detail
        )
    }

    func testFractionIsRatioOfCurrentToLimit() {
        let row = RateLimitRowProjection.make(scope(current: 350, limit: 600), now: now)
        XCTAssertEqual(row.fraction, 350.0 / 600.0, accuracy: 0.0001)
    }

    func testZeroLimitUsesOneAsMax() {
        let row = RateLimitRowProjection.make(scope(current: 1, limit: 0), now: now)
        XCTAssertEqual(row.fraction, 1, accuracy: 0.0001)
    }

    func testFractionClampsToOne() {
        let row = RateLimitRowProjection.make(scope(current: 10, limit: 5), now: now)
        XCTAssertEqual(row.fraction, 1, accuracy: 0.0001)
    }

    func testResetCountdownInFutureIsPositiveMilliseconds() {
        let row = RateLimitRowProjection.make(
            scope(current: 1, limit: 5, resetAt: now.addingTimeInterval(30)),
            now: now
        )
        XCTAssertEqual(row.resetMilliseconds ?? 0, 30000, accuracy: 1)
    }

    func testPastResetIsDropped() {
        let row = RateLimitRowProjection.make(
            scope(current: 1, limit: 5, resetAt: now.addingTimeInterval(-30)),
            now: now
        )
        XCTAssertNil(row.resetMilliseconds)
    }

    func testInstantWindowFlag() {
        XCTAssertTrue(RateLimitRowProjection.make(scope(current: 1, limit: 5, windowSeconds: 0), now: now)
            .isInstantWindow)
        XCTAssertFalse(RateLimitRowProjection.make(scope(current: 1, limit: 5, windowSeconds: 60), now: now)
            .isInstantWindow)
    }

    func testMetaVisibilityAndDetailNormalisation() {
        XCTAssertFalse(RateLimitRowProjection.make(scope(current: 1, limit: 5, detail: ""), now: now).hasMeta)
        XCTAssertNil(RateLimitRowProjection.make(scope(current: 1, limit: 5, detail: ""), now: now).detail)
        XCTAssertTrue(RateLimitRowProjection.make(scope(current: 1, limit: 5, detail: "x"), now: now).hasMeta)
        let reset = scope(current: 1, limit: 5, resetAt: now.addingTimeInterval(10))
        XCTAssertTrue(RateLimitRowProjection.make(reset, now: now).hasMeta)
    }
}

// MARK: - Projection: phase resolution + overlays

final class RateLimitProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_762_000_000)

    private func response(scopeCount: Int) -> RateLimitStatusResponse {
        let scopes = (0 ..< scopeCount).map { index in
            RateLimitScope(
                id: "s\(index)", name: "S\(index)", current: 1, limit: 5,
                windowSeconds: 60, severity: .ok, detail: nil
            )
        }
        return RateLimitStatusResponse(generatedAt: now, scopes: scopes)
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = RateLimitInput(isLoading: true, response: response(scopeCount: 3))
        XCTAssertEqual(RateLimitProjection.resolve(input, now: now).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = RateLimitInput(errorMessage: "boom", response: response(scopeCount: 3))
        XCTAssertEqual(RateLimitProjection.resolve(input, now: now).phase, .error("boom"))
    }

    func testEmptyWhenZeroScopes() {
        let input = RateLimitInput(response: response(scopeCount: 0))
        let resolved = RateLimitProjection.resolve(input, now: now)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataWhenScopesPresent() {
        let input = RateLimitInput(response: response(scopeCount: 3))
        let resolved = RateLimitProjection.resolve(input, now: now)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 3)
        XCTAssertNotNil(resolved.generatedAt)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = RateLimitInput(response: response(scopeCount: 1), isStale: true, isOffline: true)
        let resolvedWith = RateLimitProjection.resolve(withData, now: now)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = RateLimitInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = RateLimitProjection.resolve(noData, now: now)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }

    func testFetchingFlagPassesThrough() {
        let input = RateLimitInput(isFetching: true, response: response(scopeCount: 1))
        XCTAssertTrue(RateLimitProjection.resolve(input, now: now).isFetching)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class RateLimitModelTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_762_000_000)

    private func response(scopeCount: Int, resetOffset: TimeInterval? = nil) -> RateLimitStatusResponse {
        let scopes = (0 ..< scopeCount).map { index in
            RateLimitScope(
                id: "s\(index)", name: "S\(index)", current: 1, limit: 5, windowSeconds: 60,
                resetAt: resetOffset.map { now.addingTimeInterval($0) }, severity: .ok, detail: nil
            )
        }
        return RateLimitStatusResponse(generatedAt: now, scopes: scopes)
    }

    private func makeModel(
        _ input: RateLimitInput,
        telemetry: RateLimitTelemetry = OSLogRateLimitTelemetry()
    ) -> (RateLimitModel, InMemoryRateLimitSource) {
        let source = InMemoryRateLimitSource(initial: input)
        let fixedNow = now
        let model = RateLimitModel(source: source, telemetry: telemetry, clock: { fixedNow })
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRateLimitTelemetry()
        let (model, source) = makeModel(RateLimitInput(response: response(scopeCount: 3)), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.count, 3)
        XCTAssertEqual(spy.surfaces, [RateLimitStatusPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RateLimitInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndClockDrivesCountdown() {
        let (model, source) = makeModel(RateLimitInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RateLimitInput(isFetching: true, response: response(scopeCount: 1, resetOffset: 30), isStale: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.isFetching)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.rows.first?.resetMilliseconds ?? 0, 30000, accuracy: 1)
    }
}

// MARK: - Accessibility summary content

final class RateLimitAccessibilityTests: XCTestCase {
    func testRowSummaryJoinsResolvedFragments() {
        let summary = RateLimitAccessibility.rowSummary(
            name: "Internal API",
            severity: "warn",
            usage: "350.00 / 600.00",
            window: "Last 60s window",
            reset: "Refills in 42.0s"
        )
        XCTAssertEqual(summary, "Internal API, warn, 350.00 / 600.00, Last 60s window, Refills in 42.0s")
    }

    func testRowSummaryDropsEmptyAndNilFragments() {
        let summary = RateLimitAccessibility.rowSummary(
            name: "Burst",
            severity: "ok",
            usage: "1.00 / 5.00",
            window: "Live snapshot",
            reset: nil
        )
        XCTAssertEqual(summary, "Burst, ok, 1.00 / 5.00, Live snapshot")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRateLimitTelemetry: RateLimitTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
