//
//  ProjectedRangeWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  Unit coverage for the ProjectedRangeWidget surface:
//    • Adapter (cached → projection) — distance conversion, health tier, EPA ratio,
//      factor rows, comparison tint, number formatting (parity with the web
//      `convertDistanceFromSI` / `healthBadge` / `fmtNumber` derivations).
//    • State holder — `ProjectedRangeModel` phase resolution across loading / empty /
//      error / content + stale/offline freshness, plus the P1/S11 `view.opened`
//      telemetry + source wiring.
//    • Registry — canonical `projected-range` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the range readout.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryProjectedRangeSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

/// Deterministic, bundle-free localizer that echoes the English fallback.
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }
/// Key-revealing localizer so tests can assert the exact i18n key used.
private let keyTap: @Sendable (String, String) -> String = { key, _ in "L:\(key)" }
/// Fixed-locale formatter so assertions don't depend on the host locale.
private let fixedFormat: @Sendable (Double, Int) -> String = { value, digits in
    ProjectedRangeFormat.number(value, fractionDigits: digits, locale: Locale(identifier: "en_US"))
}

/// Stable name for a `TSTone` (which is intentionally not `Equatable`) so the
/// comparison-tint mapping can be asserted.
private func toneName(_ tone: TSTone) -> String {
    switch tone {
    case .neutral: "neutral"
    case .accent: "accent"
    case .success: "success"
    case .warning: "warning"
    case .danger: "danger"
    case .info: "info"
    }
}

private func project(
    _ data: ProjectedRangeInput,
    units: MeasurementSystem = .metric
) -> ProjectedRangeStats {
    ProjectedRangeStats.project(data: data, units: units, localize: echo, format: fixedFormat)
}

// MARK: - Adapter: cached DTO → projection

@MainActor final class ProjectedRangeAdapterTests: XCTestCase {
    func testDistanceConversionMetricIsIdentity() {
        XCTAssertEqual(ProjectedRangeUnits.distanceFromKilometers(412, system: .metric), 412, accuracy: 0.001)
    }

    func testDistanceConversionImperialIsMiles() {
        // 100 km → 100_000 m / 1609.344 ≈ 62.137 mi (web convertDistanceFromSI parity).
        XCTAssertEqual(ProjectedRangeUnits.distanceFromKilometers(100, system: .imperial), 62.137, accuracy: 0.001)
    }

    func testHealthTierThresholds() {
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 90), .excellent)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 89.99), .good)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 70), .good)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 69.99), .fair)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 50), .fair)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 49.99), .poor)
        XCTAssertEqual(ProjectedRangeHealthTier.tier(for: 0), .poor)
    }

    func testHealthTierTones() {
        XCTAssertEqual(toneName(ProjectedRangeHealthTier.excellent.tone), "success")
        XCTAssertEqual(toneName(ProjectedRangeHealthTier.good.tone), "success")
        XCTAssertEqual(toneName(ProjectedRangeHealthTier.fair.tone), "warning")
        XCTAssertEqual(toneName(ProjectedRangeHealthTier.poor.tone), "danger")
    }

    func testComparisonToneTiers() {
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: nil)), "danger")
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: 59)), "danger")
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: 60)), "warning")
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: 79)), "warning")
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: 80)), "success")
        XCTAssertEqual(toneName(ProjectedRangeStats.comparisonTone(rangePct: 100)), "success")
    }

    func testRangePctRoundsAndClamps() {
        let normal = project(ProjectedRangeInput(currentRangeKm: 412, newRangeKm: 505))
        XCTAssertEqual(normal.rangePct, 82) // 412/505*100 = 81.58 → 82

        let over = project(ProjectedRangeInput(currentRangeKm: 600, newRangeKm: 500))
        XCTAssertEqual(over.rangePct, 100) // clamps at 100

        let zeroEpa = project(ProjectedRangeInput(currentRangeKm: 400, newRangeKm: 0))
        XCTAssertNil(zeroEpa.rangePct)
    }

    func testNullCurrentRangeYieldsNoProjection() {
        let stats = project(ProjectedRangeInput(currentRangeKm: nil, newRangeKm: 505, healthScore: 92))
        XCTAssertNil(stats.projectedRange)
        XCTAssertNil(stats.projectedDisplay)
        XCTAssertNil(stats.rangePct)
        XCTAssertNotNil(stats.epaDisplay)
    }

    func testDisplayStringsAreFormattedAndUnitTagged() {
        let stats = project(
            ProjectedRangeInput(currentRangeKm: 412, newRangeKm: 505, healthScore: 92),
            units: .metric
        )
        XCTAssertEqual(stats.distanceUnit, "km")
        XCTAssertEqual(stats.projectedDisplay, "412")
        XCTAssertEqual(stats.epaDisplay, "505 km")
        XCTAssertEqual(stats.healthScoreDisplay, "92%")
        XCTAssertEqual(stats.healthTier, .excellent)
    }

    func testImperialProjectionConvertsValueAndLabel() {
        let stats = project(ProjectedRangeInput(currentRangeKm: 100, newRangeKm: 200), units: .imperial)
        XCTAssertEqual(stats.distanceUnit, "mi")
        XCTAssertEqual(stats.projectedDisplay, "62") // round(62.137)
        XCTAssertEqual(stats.epaDisplay, "124 mi") // round(124.27)
    }

    func testFactorsCoverAllFourMetricsWithFallbacks() {
        let stats = project(
            ProjectedRangeInput(
                currentRangeKm: 412,
                degradationPct: 7.4,
                totalCycles: 312,
                currentCapacityPct: 92.6,
                avgDailyKm: 48
            )
        )
        XCTAssertEqual(stats.factors.map(\.id), ["degradation", "avgDaily", "capacity", "cycles"])
        XCTAssertEqual(stats.factors[0].value, "7.4%")
        XCTAssertEqual(stats.factors[1].value, "48 km")
        XCTAssertEqual(stats.factors[2].value, "92.6%")
        XCTAssertEqual(stats.factors[3].value, "312")
    }

    func testFactorsApplyZeroFallbackWhenFieldsMissing() {
        let stats = project(ProjectedRangeInput(currentRangeKm: 100))
        XCTAssertEqual(stats.factors[0].value, "0.0%") // degradation nil → 0
        XCTAssertEqual(stats.factors[3].value, "0") // cycles nil → 0
    }

    func testFactorLabelsResolveThroughLocalizerKeys() {
        let stats = ProjectedRangeStats.project(
            data: ProjectedRangeInput(currentRangeKm: 100),
            units: .metric,
            localize: keyTap,
            format: fixedFormat
        )
        XCTAssertEqual(stats.factors[0].label, "L:widget.projectedRange.degradation")
        XCTAssertEqual(stats.factors[1].label, "L:widget.projectedRange.avgDaily")
        XCTAssertEqual(stats.factors[2].label, "L:widget.projectedRange.capacity")
        XCTAssertEqual(stats.factors[3].label, "L:widget.projectedRange.cycles")
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor final class ProjectedRangeModelTests: XCTestCase {
    private func makeModel(
        _ update: ProjectedRangeUpdate,
        telemetry: ProjectedRangeTelemetry = OSLogProjectedRangeTelemetry()
    ) -> (ProjectedRangeModel, InMemoryProjectedRangeSource) {
        let source = InMemoryProjectedRangeSource(initial: update)
        let model = ProjectedRangeModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ProjectedRangeUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.stats)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(ProjectedRangeUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(ProjectedRangeUpdate(status: .failed("boom"), data: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let data = ProjectedRangeInput(currentRangeKm: 400, newRangeKm: 500, healthScore: 88)
        let (loading, _) = makeModel(ProjectedRangeUpdate(status: .loading, data: data))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertNotNil(loading.stats)

        let (failed, _) = makeModel(ProjectedRangeUpdate(status: .failed("net"), data: data))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyProjectedRangeTelemetry()
        let (model, source) = makeModel(ProjectedRangeUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ProjectedRangeWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ProjectedRangeUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ProjectedRangeUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            ProjectedRangeUpdate(
                status: .loaded,
                connection: .offline,
                data: ProjectedRangeInput(currentRangeKm: 300, newRangeKm: 500, healthScore: 60),
                units: .imperial,
                isRefetching: true,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.isRefetching)
        XCTAssertEqual(model.stats?.distanceUnit, "mi")
        XCTAssertEqual(model.stats?.healthTier, .fair)
    }
}

// MARK: - Registry parity

@MainActor final class ProjectedRangeRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ProjectedRangeWidget.registration
        XCTAssertEqual(registration.id, "projected-range")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ProjectedRangeWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class ProjectedRangeAccessibilityTests: XCTestCase {
    func testSummaryIncludesValueHealthAndEpaRatio() {
        let stats = project(
            ProjectedRangeInput(currentRangeKm: 412, newRangeKm: 505, healthScore: 92),
            units: .metric
        )
        let summary = ProjectedRangeAccessibility.summary(for: stats, localize: echo)
        XCTAssertTrue(summary.contains("Projected Range"))
        XCTAssertTrue(summary.contains("412 km"))
        XCTAssertTrue(summary.contains("Excellent, 92%"))
        XCTAssertTrue(summary.contains("82% of EPA rated"))
    }

    func testSummaryFallsBackWhenNoProjection() {
        let stats = project(ProjectedRangeInput(currentRangeKm: nil, newRangeKm: 505))
        let summary = ProjectedRangeAccessibility.summary(for: stats, localize: echo)
        XCTAssertTrue(summary.contains("No projected range data"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyProjectedRangeTelemetry: ProjectedRangeTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
