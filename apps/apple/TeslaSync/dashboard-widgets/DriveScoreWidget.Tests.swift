//
//  DriveScoreWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  Unit coverage for the DriveScoreWidget surface:
//    • Adapter (cached → projection) — the score formula, the SI→display efficiency
//      conversion, the score band classifier, and the formatted readout, parity with the
//      web `useMemo` / `toEfficiencyDisplay` / gauge color thresholds.
//    • State holder — `DriveScoreModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `drive-score` metadata + size clamping.
//    • Accessibility — the VoiceOver gauge summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDriveScoreSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with the web useMemo)

@MainActor final class DriveScoreAdapterTests: XCTestCase {
    func testDistancePreferenceFromLabelOnlyMilesIsImperial() {
        XCTAssertEqual(DriveScoreDistancePreference.from(label: "mi"), .miles)
        XCTAssertEqual(DriveScoreDistancePreference.from(label: "MI"), .miles)
        XCTAssertEqual(DriveScoreDistancePreference.from(label: "km"), .kilometers)
        XCTAssertEqual(DriveScoreDistancePreference.from(label: "ft"), .kilometers)
        XCTAssertEqual(DriveScoreDistancePreference.from(label: ""), .kilometers)
    }

    func testEfficiencyUnitSuffix() {
        XCTAssertEqual(DriveScoreDistancePreference.kilometers.efficiencyUnit, "Wh/km")
        XCTAssertEqual(DriveScoreDistancePreference.miles.efficiencyUnit, "Wh/mi")
    }

    func testToDisplayConvertsWhPerKmToWhPerMileForImperial() {
        XCTAssertEqual(DriveScoreDistancePreference.kilometers.toDisplay(200), 200, accuracy: 0.0001)
        XCTAssertEqual(DriveScoreDistancePreference.miles.toDisplay(200), 200 * 1.609344, accuracy: 0.0001)
    }

    func testScoreFormulaMatchesWeb() {
        // efficiency > 0 ? min(100, round(250/efficiency*100)) : 0
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 250), 100)
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 200), 100) // capped at 100
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 312.5), 80)
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 500), 50)
    }

    func testScoreIsZeroForNonPositiveEfficiency() {
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 0), 0)
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: -10), 0)
    }

    func testScoreRoundsHalfAwayFromZeroLikeMathRound() {
        // 250 / 333.333… * 100 = 75.0000…  → 75 ; 250/303.03*100 ≈ 82.5 → 83 (round half up)
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 1000.0 / 3.0), 75)
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 250.0 / 0.825), 83)
    }

    func testScoreTinyEfficiencyCapsWithoutOverflow() {
        XCTAssertEqual(DriveScoreProjection.score(fromEfficiencyWhKm: 0.0000001), 100)
    }

    func testBandThresholdsMatchWebColors() {
        XCTAssertEqual(DriveScoreBand.classify(score: 100), .strong)
        XCTAssertEqual(DriveScoreBand.classify(score: 76), .strong)
        XCTAssertEqual(DriveScoreBand.classify(score: 75), .fair)
        XCTAssertEqual(DriveScoreBand.classify(score: 51), .fair)
        XCTAssertEqual(DriveScoreBand.classify(score: 50), .weak)
        XCTAssertEqual(DriveScoreBand.classify(score: 0), .weak)
    }

    func testBandTonesMatchWebVariants() {
        XCTAssertEqual(DriveScoreBand.strong.tone, .success)
        XCTAssertEqual(DriveScoreBand.fair.tone, .warning)
        XCTAssertEqual(DriveScoreBand.weak.tone, .danger)
    }

    func testBuildNilEfficiencyCoalescesToZeroScore() {
        let readout = DriveScoreProjection.build(
            analytics: DriveScoreInput(avgEfficiencyWhKm: nil),
            unit: .kilometers
        )
        XCTAssertEqual(readout.score, 0)
        XCTAssertEqual(readout.band, .weak)
        XCTAssertEqual(readout.formattedScore, 0.formatted(.number))
        XCTAssertEqual(readout.efficiencyDisplay, 0, accuracy: 0.0001)
    }

    func testBuildKilometersReadout() {
        let readout = DriveScoreProjection.build(
            analytics: DriveScoreInput(avgEfficiencyWhKm: 250),
            unit: .kilometers
        )
        XCTAssertEqual(readout.score, 100)
        XCTAssertEqual(readout.band, .strong)
        XCTAssertEqual(readout.efficiencyUnit, "Wh/km")
        XCTAssertEqual(readout.efficiencyDisplay, 250, accuracy: 0.0001)
    }

    func testBuildMilesConvertsEfficiencyAndUnit() {
        let readout = DriveScoreProjection.build(
            analytics: DriveScoreInput(avgEfficiencyWhKm: 200),
            unit: .miles
        )
        // Score uses RAW Wh/km (200) → capped 100; the stat is converted to Wh/mi.
        XCTAssertEqual(readout.score, 100)
        XCTAssertEqual(readout.efficiencyUnit, "Wh/mi")
        XCTAssertEqual(readout.efficiencyDisplay, 200 * 1.609344, accuracy: 0.0001)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DriveScoreModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveScoreUpdate,
        telemetry: DriveScoreTelemetry = OSLogDriveScoreTelemetry()
    ) -> (DriveScoreModel, InMemoryDriveScoreSource) {
        let source = InMemoryDriveScoreSource(initial: update)
        let model = DriveScoreModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleAnalytics() -> DriveScoreInput {
        DriveScoreInput(avgEfficiencyWhKm: 210)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DriveScoreUpdate(status: .loading, analytics: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedDataShowsContent() {
        let (model, _) = makeModel(DriveScoreUpdate(status: .loading, analytics: sampleAnalytics()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(DriveScoreUpdate(status: .loaded, analytics: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testExplicitEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(DriveScoreUpdate(status: .empty, analytics: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorRegardlessOfCache() {
        let (noCache, _) = makeModel(DriveScoreUpdate(status: .failed("boom"), analytics: nil))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(DriveScoreUpdate(status: .failed("net"), analytics: sampleAnalytics()))
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(DriveScoreUpdate(status: .loaded, analytics: sampleAnalytics()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.analytics?.avgEfficiencyWhKm, 210)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = DriveScoreWidgetSpyDriveScoreTelemetry()
        let (model, source) = makeModel(DriveScoreUpdate(status: .loading, analytics: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveScoreWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DriveScoreUpdate(status: .loaded, analytics: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionUnitAndDataTrackUpdates() {
        let (model, source) = makeModel(DriveScoreUpdate(status: .loading, analytics: nil))
        model.start()
        source.push(
            DriveScoreUpdate(
                status: .loaded,
                connection: .offline,
                analytics: sampleAnalytics(),
                unit: .miles,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .miles)
        XCTAssertEqual(model.analytics?.avgEfficiencyWhKm, 210)
    }

    func testStopResetsStartedSoTelemetryCanReArm() {
        let spy = DriveScoreWidgetSpyDriveScoreTelemetry()
        let (model, source) = makeModel(DriveScoreUpdate(status: .loaded, analytics: nil), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces.count, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Registry parity

@MainActor final class DriveScoreRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DriveScoreWidget.registration
        XCTAssertEqual(registration.id, "drive-score")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DriveScoreWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class DriveScoreAccessibilityTests: XCTestCase {
    func testGaugeSummaryIncludesScoreOutOfMaxEfficiencyAndBand() {
        let readout = DriveScoreProjection.build(
            analytics: DriveScoreInput(avgEfficiencyWhKm: 250),
            unit: .kilometers
        )
        let summary = DriveScoreAccessibility.gaugeSummary(
            readout: readout,
            scoreLabel: "Score",
            efficiencyLabel: "Efficiency",
            band: "strong score"
        )
        XCTAssertTrue(summary.contains("Score: 100 / 100"))
        XCTAssertTrue(summary.contains("strong score"))
        XCTAssertTrue(summary.contains("Efficiency: 250 Wh/km"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class DriveScoreWidgetSpyDriveScoreTelemetry: DriveScoreTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
