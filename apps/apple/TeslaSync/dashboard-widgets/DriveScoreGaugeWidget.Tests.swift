//
//  DriveScoreGaugeWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  Unit coverage for the DriveScoreGaugeWidget surface:
//    • Adapter (cached → projection) — `DriveScoreGaugeWidgetProjector` value parity with the web
//      widget's colour-banding + numeric pipeline (scoreColor thresholds, fmtNumber gauge readout,
//      bare `{number}` stat/bar rendering, `?? 0` / `?? '—'` fallbacks).
//    • State holder — `DriveScoreGaugeWidgetModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `drive-score-gauge` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `DriveScoreGaugeWidgetInMemorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DriveScoreFixture {
    static let excellent = DriveScoreGaugeWidgetScoreDTO(
        overall: 88,
        efficiency: 92,
        smoothness: 84,
        speedDiscipline: 86,
        grade: "A"
    )

    static let zeroDrives = DriveScoreGaugeWidgetScoreDTO(
        overall: 0,
        efficiency: 0,
        smoothness: 0,
        speedDiscipline: 0,
        grade: "F"
    )
}

// MARK: - Score bands (web `scoreColor` thresholds)

final class DriveScoreBandTests: XCTestCase {
    func testThresholdBoundaries() {
        XCTAssertEqual(GaugeDriveScoreBand.classify(100), .excellent)
        XCTAssertEqual(GaugeDriveScoreBand.classify(80), .excellent)
        XCTAssertEqual(GaugeDriveScoreBand.classify(79.999), .good)
        XCTAssertEqual(GaugeDriveScoreBand.classify(60), .good)
        XCTAssertEqual(GaugeDriveScoreBand.classify(59.999), .fair)
        XCTAssertEqual(GaugeDriveScoreBand.classify(40), .fair)
        XCTAssertEqual(GaugeDriveScoreBand.classify(39.999), .poor)
        XCTAssertEqual(GaugeDriveScoreBand.classify(0), .poor)
    }

    func testNonFiniteCollapsesToPoor() {
        XCTAssertEqual(GaugeDriveScoreBand.classify(.nan), .poor)
        XCTAssertEqual(GaugeDriveScoreBand.classify(-10), .poor)
    }
}

// MARK: - Number formatting (gauge fmtNumber + bare JSX number)

final class DriveScoreGaugeWidgetFormatTests: XCTestCase {
    func testGaugeValueIntegerUsesZeroDecimals() {
        XCTAssertEqual(
            DriveScoreGaugeWidgetFormat.gaugeValue(88, max: 100, precision: 2, localeIdentifier: "en_US"),
            "88"
        )
    }

    func testGaugeValueFractionUsesPrecision() {
        XCTAssertEqual(
            DriveScoreGaugeWidgetFormat.gaugeValue(88.5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "88.50"
        )
    }

    func testGaugeValueClampsIntoRange() {
        XCTAssertEqual(
            DriveScoreGaugeWidgetFormat.gaugeValue(120, max: 100, precision: 2, localeIdentifier: "en_US"),
            "100"
        )
        XCTAssertEqual(
            DriveScoreGaugeWidgetFormat.gaugeValue(-5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }

    func testGaugeValueNonFiniteCollapsesToZero() {
        XCTAssertEqual(
            DriveScoreGaugeWidgetFormat.gaugeValue(.infinity, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }

    func testJsNumberMatchesJavaScriptStringConversion() {
        XCTAssertEqual(DriveScoreGaugeWidgetFormat.jsNumber(92), "92")
        XCTAssertEqual(DriveScoreGaugeWidgetFormat.jsNumber(92.5), "92.5")
        XCTAssertEqual(DriveScoreGaugeWidgetFormat.jsNumber(0), "0")
        XCTAssertEqual(DriveScoreGaugeWidgetFormat.jsNumber(.nan), "0")
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

final class DriveScoreGaugeWidgetAdapterTests: XCTestCase {
    func testProjectsGaugeFromOverall() {
        let projection = DriveScoreGaugeWidgetProjector.project(
            score: DriveScoreFixture.excellent,
            format: DriveScoreGaugeWidgetFormatPrefs(localeIdentifier: "en_US", precision: 2),
            copy: .fallback
        )
        let gauge = projection.gauge
        XCTAssertEqual(gauge.valueText, "88")
        XCTAssertEqual(gauge.unit, "Weekly score")
        XCTAssertEqual(gauge.gradeLabel, "A")
        XCTAssertEqual(gauge.band, .excellent)
        XCTAssertEqual(gauge.fraction, 0.88, accuracy: 0.0001)
        XCTAssertEqual(gauge.accessibilityLabel, "Weekly drive score 88 out of 100, grade A")
    }

    func testProjectsStatsClusterInWebOrder() {
        let projection = DriveScoreGaugeWidgetProjector.project(score: DriveScoreFixture.excellent, copy: .fallback)
        XCTAssertEqual(projection.stats.map(\.id), ["efficiency", "smoothness", "speed"])
        XCTAssertEqual(projection.stats.map(\.label), ["Efficiency", "Smoothness", "Speed Discipline"])
        XCTAssertEqual(projection.stats.map(\.valueText), ["92", "84", "86"])
    }

    func testProjectsMetricBarsWithPerValueBands() {
        let projection = DriveScoreGaugeWidgetProjector.project(score: DriveScoreFixture.excellent, copy: .fallback)
        XCTAssertEqual(projection.bars.map(\.id), ["efficiency", "smoothness", "speed"])

        let efficiency = projection.bars[0]
        XCTAssertEqual(efficiency.label, "Efficiency")
        XCTAssertEqual(efficiency.valueText, "92")
        XCTAssertEqual(efficiency.fraction, 0.92, accuracy: 0.0001)
        XCTAssertEqual(efficiency.band, .excellent)
        XCTAssertEqual(efficiency.accessibilityLabel, "Efficiency 92 out of 100")

        // 84 → excellent (>=80); 86 → excellent; bands are computed per sub-score, not from overall.
        XCTAssertEqual(projection.bars[1].band, .excellent)
        XCTAssertEqual(projection.bars[2].band, .excellent)
    }

    func testMixedBandSubScores() {
        let score = DriveScoreGaugeWidgetScoreDTO(
            overall: 64,
            efficiency: 95, // excellent
            smoothness: 55, // fair
            speedDiscipline: 30, // poor
            grade: "B"
        )
        let projection = DriveScoreGaugeWidgetProjector.project(score: score, copy: .fallback)
        XCTAssertEqual(projection.gauge.band, .good) // 64 → good
        XCTAssertEqual(projection.bars[0].band, .excellent)
        XCTAssertEqual(projection.bars[1].band, .fair)
        XCTAssertEqual(projection.bars[2].band, .poor)
    }

    func testGradeFallbackWhenNilOrEmpty() {
        let noGrade = DriveScoreGaugeWidgetScoreDTO(overall: 50, grade: nil)
        XCTAssertEqual(DriveScoreGaugeWidgetProjector.project(score: noGrade, copy: .fallback).gauge.gradeLabel, "—")
        let emptyGrade = DriveScoreGaugeWidgetScoreDTO(overall: 50, grade: "")
        XCTAssertEqual(DriveScoreGaugeWidgetProjector.project(score: emptyGrade, copy: .fallback).gauge.gradeLabel, "—")
    }

    func testNilSubScoresFallBackToZeroLikeWeb() {
        let sparse = DriveScoreGaugeWidgetScoreDTO(overall: nil, grade: "F")
        let projection = DriveScoreGaugeWidgetProjector.project(score: sparse, copy: .fallback)
        XCTAssertEqual(projection.gauge.valueText, "0")
        XCTAssertEqual(projection.gauge.fraction, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gauge.band, .poor)
        XCTAssertEqual(projection.stats.map(\.valueText), ["0", "0", "0"])
        XCTAssertEqual(projection.bars.map(\.valueText), ["0", "0", "0"])
        XCTAssertEqual(projection.bars[0].fraction, 0, accuracy: 0.0001)
    }

    func testZeroDrivesScoreRendersGaugeNotEmpty() {
        // Backend returns a real object (overall 0, grade "F") when totalDrives == 0; that is a
        // rendered gauge, not the empty state (empty is only when the query yields no score at all).
        let projection = DriveScoreGaugeWidgetProjector.project(score: DriveScoreFixture.zeroDrives, copy: .fallback)
        XCTAssertEqual(projection.gauge.valueText, "0")
        XCTAssertEqual(projection.gauge.gradeLabel, "F")
        XCTAssertEqual(projection.gauge.band, .poor)
    }

    func testCopyIsLocalizableViaInjection() {
        let copy = DriveScoreGaugeCopy(
            weeklyScore: "Puntuación semanal",
            efficiency: "Eficiencia",
            smoothness: "Suavidad",
            speedDiscipline: "Disciplina de velocidad",
            gradeUnknown: "n/d",
            overallA11y: "Puntuación %1$@ de 100, nota %2$@",
            subScoreA11y: "%1$@ %2$@ de 100"
        )
        let projection = DriveScoreGaugeWidgetProjector.project(
            score: DriveScoreGaugeWidgetScoreDTO(overall: 70, efficiency: 70, grade: nil),
            copy: copy
        )
        XCTAssertEqual(projection.gauge.unit, "Puntuación semanal")
        XCTAssertEqual(projection.gauge.gradeLabel, "n/d")
        XCTAssertEqual(projection.gauge.accessibilityLabel, "Puntuación 70 de 100, nota n/d")
        XCTAssertEqual(projection.stats[0].label, "Eficiencia")
        XCTAssertEqual(projection.bars[0].accessibilityLabel, "Eficiencia 70 de 100")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class DriveScoreGaugeWidgetPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .loading, hasScore: false), .loading)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .loading, hasScore: true), .content)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .empty, hasScore: false), .empty)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .empty, hasScore: true), .empty)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .loaded, hasScore: false), .empty)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .loaded, hasScore: true), .content)
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .failed("x"), hasScore: false), .error("x"))
        XCTAssertEqual(DriveScoreGaugeWidgetModel.resolvePhase(status: .failed("x"), hasScore: true), .content)
    }
}

@MainActor final class DriveScoreGaugeWidgetModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveScoreGaugeWidgetUpdate,
        telemetry: DriveScoreGaugeWidgetTelemetry = DriveScoreGaugeWidgetOSLogTelemetry()
    ) -> (DriveScoreGaugeWidgetModel, DriveScoreGaugeWidgetInMemorySource) {
        let source = DriveScoreGaugeWidgetInMemorySource(initial: update)
        let model = DriveScoreGaugeWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutScoreShowsLoading() {
        let (model, _) = makeModel(DriveScoreGaugeWidgetUpdate(status: .loading, score: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutScoreShowsEmpty() {
        let (model, _) = makeModel(DriveScoreGaugeWidgetUpdate(status: .loaded, score: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(DriveScoreGaugeWidgetUpdate(status: .failed("boom"), score: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testScorePresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            DriveScoreGaugeWidgetUpdate(status: .failed("net"), score: DriveScoreFixture.excellent)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauge.valueText, "88")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = DriveScoreGaugeWidgetSpyDriveScoreTelemetry()
        let (model, source) = makeModel(DriveScoreGaugeWidgetUpdate(status: .loading, score: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveScoreGaugeWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DriveScoreGaugeWidgetUpdate(status: .loaded, score: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(
            DriveScoreGaugeWidgetUpdate(status: .loaded, score: DriveScoreFixture.excellent)
        )
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            DriveScoreGaugeWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                score: DriveScoreFixture.excellent
            )
        )
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            DriveScoreGaugeWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: false,
                score: DriveScoreFixture.excellent
            )
        )
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DriveScoreGaugeWidgetUpdate(status: .loading, score: nil))
        model.start()
        source.push(
            DriveScoreGaugeWidgetUpdate(
                status: .loaded,
                connection: .offline,
                score: DriveScoreFixture.excellent,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.bars.count, 3)
    }
}

// MARK: - Registry parity

final class DriveScoreGaugeWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DriveScoreGaugeWidget.registration
        XCTAssertEqual(registration.id, "drive-score-gauge")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
        XCTAssertEqual(DriveScoreGaugeWidget.surfaceSlug, "DriveScoreGaugeWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = DriveScoreGaugeWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

final class DriveScoreGaugeWidgetAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleGaugeAndEverySubScore() {
        let projection = DriveScoreGaugeWidgetProjector.project(score: DriveScoreFixture.excellent, copy: .fallback)
        let summary = DriveScoreGaugeWidgetAccessibility.summary(for: projection, title: "Drive Score")
        XCTAssertTrue(summary.hasPrefix("Drive Score"))
        XCTAssertTrue(summary.contains("Weekly drive score 88 out of 100, grade A"))
        XCTAssertTrue(summary.contains("Efficiency 92 out of 100"))
        XCTAssertTrue(summary.contains("Smoothness 84 out of 100"))
        XCTAssertTrue(summary.contains("Speed Discipline 86 out of 100"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class DriveScoreGaugeWidgetSpyDriveScoreTelemetry: DriveScoreGaugeWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
