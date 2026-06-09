//
//  BatteryDegradationTrendWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  Unit coverage for the BatteryDegradationTrendWidget surface:
//    • Adapter (cached → projection) — `BatteryDegradationTrendBuilder` parity
//      with the web component's `chartData` memo + the SoH / degradation / cycles
//      derivations + the y-domain floor (`dataMin − 2`).
//    • Formatting — `BatteryDegradationTrendFormat` parity with web `fmtNumber`
//      (incl. the U+2212 minus sign and the "—" fallback glyph).
//    • State holder — `BatteryDegradationTrendModel` phase resolution across
//      loading / empty / error / content, plus the P1/S11 `view.opened` telemetry.
//    • Registry — canonical `battery-degradation-trend` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-point value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryBatteryDegradationTrendSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Test fixtures

private func trendRows(_ pairs: [(String, Double)]) -> [DegradationTrendRow] {
    pairs.map { DegradationTrendRow(month: $0.0, avgHealth: $0.1, avgCapacity: 0, avgRange: 0) }
}

private func summary(
    healthPct: Double? = nil,
    health: Double? = nil,
    rate: Double? = nil,
    cycles: Double? = nil
) -> DegradationSummary {
    DegradationSummary(
        currentHealthPct: healthPct,
        currentHealth: health,
        degradationRatePctPerMonth: rate,
        currentCycles: cycles
    )
}

// MARK: - Adapter: cached DTO → projection

@MainActor final class BatteryDegradationTrendBuilderTests: XCTestCase {
    func testShortMonthFormatsKnownMonths() {
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2026-01"), "Jan")
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2026-04"), "Apr")
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2025-12"), "Dec")
    }

    func testShortMonthHandlesMalformedInput() {
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2026"), "2026")
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2026-13"), "2026-13")
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth("2026-00"), "2026-00")
        XCTAssertEqual(BatteryDegradationTrendBuilder.shortMonth(""), "")
    }

    func testBuildProjectionMapsPointsInOrder() {
        let projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-02", 96), ("2026-03", 94.5), ("2026-04", 93)]),
            summary: summary(healthPct: 93, rate: 0.5, cycles: 200)
        )
        XCTAssertEqual(projection.points.map(\.month), ["2026-02", "2026-03", "2026-04"])
        XCTAssertEqual(projection.points.map(\.monthLabel), ["Feb", "Mar", "Apr"])
        XCTAssertEqual(projection.points.first?.health ?? 0, 96, accuracy: 0.0001)
    }

    func testBuildProjectionDerivesStatValues() {
        let projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-03", 95), ("2026-04", 93)]),
            summary: summary(healthPct: 92.4, rate: 0.62, cycles: 318)
        )
        XCTAssertEqual(projection.currentHealth ?? 0, 92.4, accuracy: 0.0001)
        XCTAssertEqual(projection.degradationRate ?? 0, 0.62, accuracy: 0.0001)
        XCTAssertEqual(projection.cycles ?? 0, 318, accuracy: 0.0001)
    }

    func testResolvedHealthPrefersPctThenLegacy() {
        XCTAssertEqual(summary(healthPct: 92, health: 80).resolvedHealth, 92)
        XCTAssertEqual(summary(healthPct: nil, health: 80).resolvedHealth, 80)
        XCTAssertNil(summary(healthPct: nil, health: nil).resolvedHealth)
    }

    func testHealthFloorIsMinMinusTwoClampedToZero() {
        let normal = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-03", 95), ("2026-04", 90)]),
            summary: summary(healthPct: 90)
        )
        XCTAssertEqual(normal.healthFloor, 88, accuracy: 0.0001)

        let clamped = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-04", 1)]),
            summary: summary(healthPct: 1)
        )
        XCTAssertEqual(clamped.healthFloor, 0, accuracy: 0.0001)
    }

    func testHealthFloorDefaultsToThresholdWhenNoPoints() {
        let projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: [],
            summary: summary(healthPct: 90)
        )
        XCTAssertEqual(projection.healthFloor, BatteryDegradationProjection.healthThreshold, accuracy: 0.0001)
    }

    func testHasTrendRequiresMoreThanOnePoint() {
        XCTAssertFalse(
            BatteryDegradationTrendBuilder.buildProjection(rows: [], summary: summary(healthPct: 90)).hasTrend
        )
        XCTAssertFalse(
            BatteryDegradationTrendBuilder.buildProjection(
                rows: trendRows([("2026-04", 90)]),
                summary: summary(healthPct: 90)
            ).hasTrend
        )
        XCTAssertTrue(
            BatteryDegradationTrendBuilder.buildProjection(
                rows: trendRows([("2026-03", 92), ("2026-04", 90)]),
                summary: summary(healthPct: 90)
            ).hasTrend
        )
    }

    func testIsEmptyWhenNoHealthAndNoPoints() {
        XCTAssertTrue(
            BatteryDegradationTrendBuilder.buildProjection(rows: [], summary: summary()).isEmpty
        )
        // Health present (no trend yet) is NOT empty — the stats still render.
        XCTAssertFalse(
            BatteryDegradationTrendBuilder.buildProjection(rows: [], summary: summary(healthPct: 90)).isEmpty
        )
        // Trend present (no summary health) is NOT empty.
        XCTAssertFalse(
            BatteryDegradationTrendBuilder.buildProjection(
                rows: trendRows([("2026-04", 90)]),
                summary: summary()
            ).isEmpty
        )
    }

    func testShowsDegradationRateOnlyWhenPositive() {
        XCTAssertTrue(BatteryDegradationTrendBuilder.showsDegradationRate(0.5))
        XCTAssertFalse(BatteryDegradationTrendBuilder.showsDegradationRate(0))
        XCTAssertFalse(BatteryDegradationTrendBuilder.showsDegradationRate(-1))
        XCTAssertFalse(BatteryDegradationTrendBuilder.showsDegradationRate(nil))
        XCTAssertFalse(BatteryDegradationTrendBuilder.showsDegradationRate(.nan))
    }
}

// MARK: - Number formatting parity (web fmtNumber)

@MainActor final class BatteryDegradationTrendFormatTests: XCTestCase {
    func testNumberKeepsRequestedDigitsAndGroups() {
        XCTAssertEqual(BatteryDegradationTrendFormat.number(92.37, digits: 1), "92.4")
        XCTAssertEqual(BatteryDegradationTrendFormat.number(1234, digits: 0), "1,234")
    }

    func testHealthValueAppendsPercentOrEmDash() {
        XCTAssertEqual(BatteryDegradationTrendFormat.healthValue(92.4), "92.4%")
        XCTAssertEqual(BatteryDegradationTrendFormat.healthValue(nil), "\u{2014}")
    }

    func testDegradationValueUsesUnicodeMinus() {
        let value = BatteryDegradationTrendFormat.degradationValue(0.62)
        XCTAssertEqual(value, "\u{2212}0.62%")
        XCTAssertTrue(value.hasPrefix("\u{2212}"))
        XCTAssertFalse(value.hasPrefix("-"))
    }

    func testCyclesValueGroupsOrEmDash() {
        XCTAssertEqual(BatteryDegradationTrendFormat.cyclesValue(1318), "1,318")
        XCTAssertEqual(BatteryDegradationTrendFormat.cyclesValue(nil), "\u{2014}")
    }

    func testAxisPercentIsWholePercent() {
        XCTAssertEqual(BatteryDegradationTrendFormat.axisPercent(80), "80%")
        XCTAssertEqual(BatteryDegradationTrendFormat.axisPercent(92.6), "93%")
    }

    func testNonFiniteRendersEmDash() {
        XCTAssertEqual(BatteryDegradationTrendFormat.number(.nan, digits: 1), "\u{2014}")
        XCTAssertEqual(BatteryDegradationTrendFormat.healthValue(.infinity), "\u{2014}")
        XCTAssertEqual(BatteryDegradationTrendFormat.cyclesValue(.nan), "\u{2014}")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class BatteryDegradationTrendModelTests: XCTestCase {
    private func makeModel(
        _ update: BatteryDegradationTrendUpdate,
        telemetry: BatteryDegradationTrendTelemetry = OSLogBatteryDegradationTrendTelemetry()
    ) -> (BatteryDegradationTrendModel, InMemoryBatteryDegradationTrendSource) {
        let source = InMemoryBatteryDegradationTrendSource(initial: update)
        let model = BatteryDegradationTrendModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(BatteryDegradationTrendUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithHealthShowsContent() {
        let (model, _) = makeModel(
            BatteryDegradationTrendUpdate(status: .loaded, summary: summary(healthPct: 92))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection.isEmpty)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(BatteryDegradationTrendUpdate(status: .loaded, rows: [], summary: summary()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BatteryDegradationTrendUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedDataStaysVisibleWhileFailingOrLoading() {
        let rows = trendRows([("2026-03", 95), ("2026-04", 93)])
        let (failed, _) = makeModel(
            BatteryDegradationTrendUpdate(
                status: .failed("net"),
                connection: .offline,
                rows: rows,
                summary: summary(healthPct: 93)
            )
        )
        failed.start()
        XCTAssertEqual(failed.phase, .content)
        XCTAssertEqual(failed.connection, .offline)

        let (loading, _) = makeModel(
            BatteryDegradationTrendUpdate(status: .loading, rows: rows, summary: summary(healthPct: 93))
        )
        loading.start()
        XCTAssertEqual(loading.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyBatteryDegradationTrendTelemetry()
        let (model, source) = makeModel(BatteryDegradationTrendUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryDegradationTrendWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryDegradationTrendUpdate(status: .loaded, summary: summary(healthPct: 90)))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BatteryDegradationTrendUpdate(status: .loading))
        model.start()
        source.push(
            BatteryDegradationTrendUpdate(
                status: .loaded,
                connection: .stale,
                rows: trendRows([("2026-03", 95), ("2026-04", 93)]),
                summary: summary(healthPct: 93, rate: 0.7, cycles: 240),
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasTrend)
        XCTAssertEqual(model.projection.cycles ?? 0, 240, accuracy: 0.0001)
        XCTAssertEqual(model.updatedAt, Date(timeIntervalSince1970: 1_700_000_000))
    }

    func testCompactThresholdRequiresSingleCellBothAxes() {
        XCTAssertTrue(BatteryDegradationTrendModel.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(BatteryDegradationTrendModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(BatteryDegradationTrendModel.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
        XCTAssertFalse(BatteryDegradationTrendModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class BatteryDegradationTrendRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BatteryDegradationTrendWidget.registration
        XCTAssertEqual(registration.id, "battery-degradation-trend")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = BatteryDegradationTrendWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility content

@MainActor final class BatteryDegradationTrendAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatsWhenAllPresent() {
        let projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-03", 95), ("2026-04", 92.4)]),
            summary: summary(healthPct: 92.4, rate: 0.62, cycles: 318)
        )
        let text = BatteryDegradationTrendAccessibility.summary(for: projection)
        XCTAssertTrue(text.contains("State of health"))
        XCTAssertTrue(text.contains("92.4%"))
        XCTAssertTrue(text.contains("Degradation"))
        XCTAssertTrue(text.contains("0.62%"))
        XCTAssertTrue(text.contains("per month"))
        XCTAssertTrue(text.contains("Cycles"))
        XCTAssertTrue(text.contains("318"))
    }

    func testSummaryOmitsDegradationWhenNotShown() {
        let projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: trendRows([("2026-03", 95), ("2026-04", 92)]),
            summary: summary(healthPct: 92, rate: 0, cycles: 100)
        )
        let text = BatteryDegradationTrendAccessibility.summary(for: projection)
        XCTAssertFalse(text.contains("per month"))
        XCTAssertTrue(text.contains("State of health"))
        XCTAssertTrue(text.contains("Cycles"))
    }

    func testSummaryEmptyWhenNoData() {
        let text = BatteryDegradationTrendAccessibility.summary(for: .empty)
        XCTAssertEqual(text, "No degradation data")
    }

    func testPointLabelDescribesMonthAndHealth() {
        let point = DegradationTrendPoint(month: "2026-04", monthLabel: "Apr", health: 92.4, range: 465)
        let label = BatteryDegradationTrendAccessibility.pointLabel(point)
        XCTAssertTrue(label.contains("Apr"))
        XCTAssertTrue(label.contains("92.4%"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBatteryDegradationTrendTelemetry: BatteryDegradationTrendTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
