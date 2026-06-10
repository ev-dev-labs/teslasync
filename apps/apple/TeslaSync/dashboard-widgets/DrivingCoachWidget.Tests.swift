//
//  DrivingCoachWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  Unit coverage for the DrivingCoachWidget surface:
//    • Adapter (cached → projection) — `DrivingCoachProjection`, the impact-tier tone +
//      label mapping, the savings-percent formula, the tip projection, and the
//      potential-savings interpolation, parity with the web `useMemo` / `savingsPct` /
//      `impactBadgeMap` / `t('…potentialSavings', …, { pct })`.
//    • State holder — `DrivingCoachModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `driving-coach` metadata + size clamping.
//    • Accessibility — the VoiceOver summaries for the score header and a tip card.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDrivingCoachSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with the web useMemo)

@MainActor final class DrivingCoachAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testImpactFromRawParsesKnownTiersAndNilOtherwise() {
        XCTAssertEqual(CoachImpact.from(raw: "high"), .high)
        XCTAssertEqual(CoachImpact.from(raw: "MEDIUM"), .medium)
        XCTAssertEqual(CoachImpact.from(raw: "low"), .low)
        XCTAssertNil(CoachImpact.from(raw: "critical"))
        XCTAssertNil(CoachImpact.from(raw: nil))
        XCTAssertNil(CoachImpact.from(raw: ""))
    }

    func testImpactTonesMatchWebBadgeMap() {
        XCTAssertEqual(CoachImpact.high.tone, .success)
        XCTAssertEqual(CoachImpact.medium.tone, .warning)
        XCTAssertEqual(CoachImpact.low.tone, .neutral)
    }

    func testImpactLocalizationKeyAndRawFallback() {
        XCTAssertEqual(CoachImpact.high.localization.key, "widget.drivingCoach.impact.high")
        XCTAssertEqual(CoachImpact.high.localization.fallback, "high")
        XCTAssertEqual(CoachImpact.medium.localization.key, "widget.drivingCoach.impact.medium")
        XCTAssertEqual(CoachImpact.low.localization.key, "widget.drivingCoach.impact.low")
    }

    func testSavingsPercentMatchesWebFormula() {
        // (current - best) / current * 100, rounded.
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: 168, bestEff: 148), 12)
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: 200, bestEff: 150), 25)
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: 160, bestEff: 160), 0)
    }

    func testSavingsPercentIsZeroWhenCurrentNotPositive() {
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: 0, bestEff: 120), 0)
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: -5, bestEff: 120), 0)
    }

    func testSavingsPercentCanBeNegativeWhenBestExceedsCurrent() {
        // Web `Math.round` keeps the sign; the chip is simply hidden when pct <= 0.
        XCTAssertEqual(DrivingCoachProjection.savingsPercent(currentEff: 100, bestEff: 120), -20)
    }

    func testTipsProjectionMapsCategoryTipAndImpact() {
        let recs = [
            CoachRecommendationInput(id: 7, category: "Highway speed", tip: "Hold a steadier pace.", impact: .medium)
        ]
        let tips = DrivingCoachProjection.tips(from: recs, localize: echo)
        XCTAssertEqual(tips.count, 1)
        XCTAssertEqual(tips[0].id, 7)
        XCTAssertEqual(tips[0].title, "Highway speed")
        XCTAssertEqual(tips[0].description, "Hold a steadier pace.")
        XCTAssertEqual(tips[0].impact, .medium)
        XCTAssertEqual(tips[0].impactLabel, "medium")
    }

    func testTipsProjectionMissingCategoryAndTipUseEmDash() {
        let recs = [CoachRecommendationInput(id: 1, category: nil, tip: nil, impact: nil)]
        let tips = DrivingCoachProjection.tips(from: recs, localize: echo)
        XCTAssertEqual(tips[0].title, "—")
        XCTAssertEqual(tips[0].description, "—")
        XCTAssertNil(tips[0].impact)
        XCTAssertNil(tips[0].impactLabel)
    }

    func testTipsProjectionLocalizesImpactLabelOnlyWhenPresent() {
        let recs = [
            CoachRecommendationInput(id: 1, category: "A", tip: "a", impact: .high),
            CoachRecommendationInput(id: 2, category: "B", tip: "b", impact: nil)
        ]
        let tips = DrivingCoachProjection.tips(from: recs, localize: keyTap)
        XCTAssertEqual(tips[0].impactLabel, "L:widget.drivingCoach.impact.high")
        XCTAssertNil(tips[1].impactLabel)
    }

    func testTipsProjectionPreservesRecommendationOrder() {
        let recs = (0 ..< 4).map { CoachRecommendationInput(id: $0, category: "C\($0)", tip: "t", impact: .low) }
        let tips = DrivingCoachProjection.tips(from: recs, localize: echo)
        XCTAssertEqual(tips.map(\.id), [0, 1, 2, 3])
    }

    func testPotentialSavingsLabelInterpolatesPct() {
        let label = DrivingCoachProjection.potentialSavingsLabel(pct: 12, localize: echo)
        XCTAssertEqual(label, "Potential savings: 12%")
        XCTAssertFalse(label.contains("{{pct}}"))
    }

    func testFormatScoreRoundsToInteger() {
        XCTAssertEqual(DrivingCoachProjection.formatScore(82), "82")
        XCTAssertEqual(DrivingCoachProjection.formatScore(81.6), "82")
        XCTAssertEqual(DrivingCoachProjection.formatScore(0), "0")
    }

    func testStandardTipLimitMatchesWebMaxTips() {
        XCTAssertEqual(DrivingCoachProjection.standardTipLimit, 3)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DrivingCoachModelTests: XCTestCase {
    private func makeModel(
        _ update: DrivingCoachUpdate,
        telemetry: DrivingCoachTelemetry = OSLogDrivingCoachTelemetry()
    ) -> (DrivingCoachModel, InMemoryDrivingCoachSource) {
        let source = InMemoryDrivingCoachSource(initial: update)
        let model = DrivingCoachModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleCoach() -> DrivingCoachInput {
        DrivingCoachInput(
            overallScore: 80,
            efficiencyWhKm: 170,
            bestEfficiencyWhKm: 150,
            recommendations: [CoachRecommendationInput(id: 1, category: "A", tip: "a", impact: .high)]
        )
    }

    func testLoadingWithoutCoachShowsLoading() {
        let (model, _) = makeModel(DrivingCoachUpdate(status: .loading, coach: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutCoachShowsEmpty() {
        let (model, _) = makeModel(DrivingCoachUpdate(status: .loaded, coach: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(DrivingCoachUpdate(status: .empty, coach: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorRegardlessOfCache() {
        let (noCache, _) = makeModel(DrivingCoachUpdate(status: .failed("boom"), coach: nil))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(DrivingCoachUpdate(status: .failed("net"), coach: sampleCoach()))
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testLoadedWithCoachShowsContent() {
        let (model, _) = makeModel(DrivingCoachUpdate(status: .loaded, coach: sampleCoach()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.coach?.recommendations.count, 1)
    }

    func testLoadingWithCachedCoachStaysContent() {
        let (model, _) = makeModel(DrivingCoachUpdate(status: .loading, coach: sampleCoach()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = DrivingCoachWidgetSpyDrivingCoachTelemetry()
        let (model, source) = makeModel(DrivingCoachUpdate(status: .loading, coach: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingCoachWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DrivingCoachUpdate(status: .loaded, coach: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndCoachTrackUpdates() {
        let (model, source) = makeModel(DrivingCoachUpdate(status: .loading, coach: nil))
        model.start()
        source.push(
            DrivingCoachUpdate(status: .loaded, connection: .offline, coach: sampleCoach(), updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.coach?.overallScore, 80)
    }
}

// MARK: - Registry parity

@MainActor final class DrivingCoachRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DrivingCoachWidget.registration
        XCTAssertEqual(registration.id, "driving-coach")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DrivingCoachWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class DrivingCoachWidgetDrivingCoachAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testScoreSummaryIncludesScoreAndSavings() {
        let summary = DrivingCoachAccessibility.scoreSummary(scoreText: "82", savingsPct: 12, localize: echo)
        XCTAssertTrue(summary.contains("Driving score"))
        XCTAssertTrue(summary.contains("82"))
        XCTAssertTrue(summary.contains("/ 100"))
        XCTAssertTrue(summary.contains("Potential savings: 12%"))
    }

    func testScoreSummaryOmitsSavingsWhenNotPositive() {
        let summary = DrivingCoachAccessibility.scoreSummary(scoreText: "70", savingsPct: 0, localize: echo)
        XCTAssertTrue(summary.contains("70"))
        XCTAssertFalse(summary.contains("Potential savings"))
    }

    func testTipSummaryIncludesIndexTitleDescriptionAndImpact() {
        let tip = CoachTip(
            id: 1,
            title: "Smooth acceleration",
            description: "Ease off the pedal.",
            impact: .high,
            impactLabel: "High"
        )
        let summary = DrivingCoachAccessibility.tipSummary(index: 1, tip: tip, localize: echo)
        XCTAssertTrue(summary.contains("Tip 1."))
        XCTAssertTrue(summary.contains("Smooth acceleration"))
        XCTAssertTrue(summary.contains("Ease off the pedal."))
        XCTAssertTrue(summary.contains("High"))
    }

    func testTipSummaryOmitsImpactWhenNil() {
        let tip = CoachTip(id: 2, title: "Title", description: "Body", impact: nil, impactLabel: nil)
        let summary = DrivingCoachAccessibility.tipSummary(index: 2, tip: tip, localize: echo)
        XCTAssertTrue(summary.contains("Tip 2."))
        XCTAssertTrue(summary.hasSuffix("Body"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class DrivingCoachWidgetSpyDrivingCoachTelemetry: DrivingCoachTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
