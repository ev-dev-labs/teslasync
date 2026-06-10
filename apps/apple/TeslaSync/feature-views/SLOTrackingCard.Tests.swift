//
//  SLOTrackingCard.Tests.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  Pure-adapter + accessibility coverage for the SLOTrackingCard surface:
//    • `SLOWindow` — the API value / short token / long label mapping + round-trip
//      (web `Window` union + `WINDOW_LABEL`).
//    • `SLOTrackingProjection` — the loading / content / empty / error phase
//      resolution, the percentage-vs-target tone ladder, the target clamp/parse
//      rules (web `loadTarget` / `handleSaveTarget`), and the snapshot-caveat guard.
//    • `SLOTrackingFormat` — percent / target-token / count formatting + the "—"
//      em-dash fallback contract (web `fmtPercent` / `String(target)` / `?? '—'`).
//    • `SLOTrackingAccessibility` — the components clause + the live figure summary.
//  The state-holder tests live in `.ModelTests`. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used here + in `.ModelTests`)

enum SLOTrackingFixture {
    static func series(_ window: SLOWindow = .d30, percent: Double = 99.95) -> UptimeWindowDTO {
        UptimeWindowDTO(
            window: window.apiValue,
            uptimePercent: percent,
            healthyCount: 6,
            totalCount: 6,
            generatedAt: "2026-04-15T09:30:00Z",
            historicalSource: "series"
        )
    }

    static let snapshotCaveat = UptimeWindowDTO(
        window: SLOWindow.d90.apiValue,
        uptimePercent: 98.4,
        healthyCount: 5,
        totalCount: 6,
        generatedAt: "2026-04-15T09:30:00Z",
        historicalSource: "snapshot",
        note: nil
    )

    static func loaded(_ snapshot: UptimeWindowDTO, connection: SLOConnection = .live) -> SLOTrackingUpdate {
        SLOTrackingUpdate(
            status: .loaded,
            snapshot: snapshot,
            connection: connection,
            updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
    }
}

// MARK: - Adapter: window identity

@MainActor final class SLOWindowTests: XCTestCase {
    func testApiValuesMatchWebUnion() {
        XCTAssertEqual(SLOWindow.allCases.map(\.apiValue), ["24h", "7d", "30d", "90d", "1y"])
    }

    func testShortLabelKeyIsTheApiToken() {
        XCTAssertEqual(SLOWindow.d30.shortLabelKey, "30d")
    }

    func testLongLabelsMatchWebWindowLabel() {
        XCTAssertEqual(SLOWindow.h24.longLabelKey, "Last 24 hours")
        XCTAssertEqual(SLOWindow.d7.longLabelKey, "Last 7 days")
        XCTAssertEqual(SLOWindow.d30.longLabelKey, "Last 30 days")
        XCTAssertEqual(SLOWindow.d90.longLabelKey, "Last 90 days")
        XCTAssertEqual(SLOWindow.y1.longLabelKey, "Last year")
    }

    func testRoundTripFromApiValue() {
        XCTAssertEqual(SLOWindow.from(apiValue: "90d"), .d90)
        XCTAssertNil(SLOWindow.from(apiValue: "5m"))
    }
}

// MARK: - Projection: phase resolution

@MainActor final class SLOTrackingPhaseTests: XCTestCase {
    func testLoadingResolvesLoading() {
        XCTAssertEqual(SLOTrackingProjection.resolvePhase(.loading, hasSnapshot: false), .loading)
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(SLOTrackingProjection.resolvePhase(.failed("boom"), hasSnapshot: false), .error("boom"))
    }

    func testLoadedWithSnapshotIsContent() {
        XCTAssertEqual(SLOTrackingProjection.resolvePhase(.loaded, hasSnapshot: true), .content)
    }

    func testLoadedWithoutSnapshotIsEmpty() {
        XCTAssertEqual(SLOTrackingProjection.resolvePhase(.loaded, hasSnapshot: false), .empty)
    }
}

// MARK: - Projection: tone ladder (web `tone`)

@MainActor final class SLOTrackingToneTests: XCTestCase {
    func testNilPercentIsUnknown() {
        XCTAssertEqual(SLOTrackingProjection.tone(percent: nil, target: 99), .unknown)
    }

    func testAtOrAboveTargetIsOnTarget() {
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 99, target: 99), .onTarget)
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 99.99, target: 99), .onTarget)
    }

    func testWithinOnePointIsNearTarget() {
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 98.5, target: 99), .nearTarget)
        // Exactly target - 1 is the inclusive lower bound of the amber band.
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 98, target: 99), .nearTarget)
    }

    func testMoreThanOnePointBelowIsBelowTarget() {
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 97.99, target: 99), .belowTarget)
        XCTAssertEqual(SLOTrackingProjection.tone(percent: 50, target: 99), .belowTarget)
    }
}

// MARK: - Projection: target clamp / load / parse (web `loadTarget` / `handleSaveTarget`)

@MainActor final class SLOTrackingTargetRuleTests: XCTestCase {
    func testClampAcceptsValidRange() {
        XCTAssertEqual(SLOTrackingProjection.clampTarget(0.5), 0.5)
        XCTAssertEqual(SLOTrackingProjection.clampTarget(100), 100)
        XCTAssertEqual(SLOTrackingProjection.clampTarget(99.95), 99.95)
    }

    func testClampRejectsOutOfRange() {
        XCTAssertNil(SLOTrackingProjection.clampTarget(0))
        XCTAssertNil(SLOTrackingProjection.clampTarget(-1))
        XCTAssertNil(SLOTrackingProjection.clampTarget(100.1))
        XCTAssertNil(SLOTrackingProjection.clampTarget(nil))
        XCTAssertNil(SLOTrackingProjection.clampTarget(.nan))
        XCTAssertNil(SLOTrackingProjection.clampTarget(.infinity))
    }

    func testLoadTargetSubstitutesDefault() {
        XCTAssertEqual(SLOTrackingProjection.loadTarget(nil), 99)
        XCTAssertEqual(SLOTrackingProjection.loadTarget(150), 99)
        XCTAssertEqual(SLOTrackingProjection.loadTarget(99.5), 99.5)
    }

    func testParseTargetMatchesWebHandleSave() {
        XCTAssertEqual(SLOTrackingProjection.parseTarget("99.5"), 99.5)
        XCTAssertEqual(SLOTrackingProjection.parseTarget(" 99 "), 99)
        XCTAssertEqual(SLOTrackingProjection.parseTarget("100"), 100)
        XCTAssertNil(SLOTrackingProjection.parseTarget(""))
        XCTAssertNil(SLOTrackingProjection.parseTarget("0"))
        XCTAssertNil(SLOTrackingProjection.parseTarget("100.1"))
        XCTAssertNil(SLOTrackingProjection.parseTarget("-5"))
        XCTAssertNil(SLOTrackingProjection.parseTarget("abc"))
    }
}

// MARK: - Projection: snapshot caveat guard

@MainActor final class SLOTrackingCaveatTests: XCTestCase {
    func testNoSnapshotHidesCaveat() {
        XCTAssertFalse(SLOTrackingProjection.showsCaveat(nil))
    }

    func testSeriesHidesCaveat() {
        XCTAssertFalse(SLOTrackingProjection.showsCaveat(SLOTrackingFixture.series()))
    }

    func testNonSeriesShowsCaveat() {
        XCTAssertTrue(SLOTrackingProjection.showsCaveat(SLOTrackingFixture.snapshotCaveat))
    }
}

// MARK: - Formatting (web fmtPercent / String(target) / count)

@MainActor final class SLOTrackingFormatTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testPercentFormatsTwoDecimals() {
        XCTAssertEqual(SLOTrackingFormat.percent(99.95, locale: locale), "99.95%")
        XCTAssertEqual(SLOTrackingFormat.percent(99, locale: locale), "99.00%")
    }

    func testPercentNilIsEmDash() {
        XCTAssertEqual(SLOTrackingFormat.percent(nil, locale: locale), "—")
    }

    func testTargetTokenDropsTrailingZeros() {
        XCTAssertEqual(SLOTrackingFormat.targetToken(99), "99")
        XCTAssertEqual(SLOTrackingFormat.targetToken(99.5), "99.5")
        XCTAssertEqual(SLOTrackingFormat.targetToken(100), "100")
        XCTAssertEqual(SLOTrackingFormat.targetToken(99.0), "99")
    }

    func testCountInvariantWithEmDashFallback() {
        XCTAssertEqual(SLOTrackingFormat.count(6), "6")
        XCTAssertEqual(SLOTrackingFormat.count(nil), "—")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SLOTrackingSurface.slug, "SLOTrackingCard")
        XCTAssertEqual(SLOTrackingCard.surfaceSlug, "SLOTrackingCard")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class SLOTrackingAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testComponentsClauseRendersTally() {
        let clause = SLOTrackingAccessibility.componentsClause(healthy: 6, total: 6, localize: echo)
        XCTAssertEqual(clause, "6 / 6 components healthy")
    }

    func testComponentsClauseEmDashForMissing() {
        let clause = SLOTrackingAccessibility.componentsClause(healthy: nil, total: nil, localize: echo)
        XCTAssertEqual(clause, "— / — components healthy")
    }

    func testFigureSummaryWithFigure() {
        let summary = SLOTrackingAccessibility.figureSummary(
            percentText: "99.95%",
            windowLabel: "Last 30 days",
            componentsClause: "6 / 6 components healthy",
            hasFigure: true,
            localize: echo
        )
        XCTAssertEqual(summary, "Uptime & SLO: 99.95% uptime, Last 30 days, 6 / 6 components healthy")
    }

    func testFigureSummaryWithoutFigureIsUnavailable() {
        let summary = SLOTrackingAccessibility.figureSummary(
            percentText: "—",
            windowLabel: "Last 30 days",
            componentsClause: "— / — components healthy",
            hasFigure: false,
            localize: echo
        )
        XCTAssertEqual(summary, "Uptime & SLO: Uptime unavailable, Last 30 days")
    }
}
