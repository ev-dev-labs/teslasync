//
//  EnergyStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  Unit coverage for the EnergyStatsWidget surface:
//    • Adapter (cached → projection) — `EnergyStatsBuilder` parity with the web
//      `chartData` / `hasData` / `hasChartData` derivations + the compact
//      `total_wh / 1000` headline and the `shortDate` helper.
//    • State holder — `EnergyStatsModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring + freshness/prefs tracking.
//    • Registry — canonical `energy-stats` metadata + size clamping.
//    • Formatting — locale-safe energy / efficiency / cost / number formatting
//      at the display boundary (web `useUnits`).
//    • Accessibility — the VoiceOver summary content + stat-cell labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryEnergyStatsSource`.
//

import XCTest

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

@MainActor final class EnergyStatsBuilderTests: XCTestCase {
    private func sampleData() -> EnergyStatsData {
        EnergyStatsData(
            totalEnergyUsedWh: 312_000,
            totalEnergyChargedWh: 358_000,
            totalWh: 312_000,
            avgEfficiencyWhPerM: 0.172,
            totalDistanceM: 1_814_000,
            totalCost: 84.36,
            co2SavedKg: 141.7,
            dailyBreakdown: [
                EnergyDailyEntry(date: "2026-05-01", energyWh: 12000),
                EnergyDailyEntry(date: "2026-05-02T00:00:00Z", energyWh: nil), // ?? 0
                EnergyDailyEntry(date: "2026-05-03", energyWh: 0)
            ]
        )
    }

    func testShortDateStripsLeadingZerosAndMatchesWebMD() {
        XCTAssertEqual(EnergyStatsBuilder.shortDate("2026-05-01"), "5/1")
        XCTAssertEqual(EnergyStatsBuilder.shortDate("2026-12-25T00:00:00Z"), "12/25")
        XCTAssertEqual(EnergyStatsBuilder.shortDate("2026-01-09"), "1/9")
    }

    func testShortDateFallsBackOnUnparseableInput() {
        XCTAssertEqual(EnergyStatsBuilder.shortDate("not-a-date"), "not-a-date")
        XCTAssertEqual(EnergyStatsBuilder.shortDate("2026-13-40"), "2026-13-40")
        XCTAssertEqual(EnergyStatsBuilder.shortDate(""), "")
    }

    func testSinceKeyIsDaysBeforeToday() {
        let instant = Date(timeIntervalSince1970: 1_780_531_200) // 2026-06-04Z
        XCTAssertEqual(EnergyStatsBuilder.sinceKey(from: instant, days: 30), "2026-05-05")
        XCTAssertEqual(EnergyStatsBuilder.dayKey(instant), "2026-06-04")
    }

    func testNilDataYieldsEmptyProjection() {
        let projection = EnergyStatsBuilder.buildProjection(data: nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertFalse(projection.hasChartData)
        XCTAssertTrue(projection.points.isEmpty)
        XCTAssertEqual(projection.compactKwh, 0, accuracy: 0.0001)
    }

    func testProjectionMapsPointsScalarsAndGates() {
        let projection = EnergyStatsBuilder.buildProjection(data: sampleData())
        XCTAssertTrue(projection.hasData)
        XCTAssertTrue(projection.hasChartData)
        XCTAssertEqual(projection.points.count, 3)
        XCTAssertEqual(projection.points[0].energyKwh, 12, accuracy: 0.0001)
        XCTAssertEqual(projection.points[1].energyKwh, 0, accuracy: 0.0001) // nil → 0
        XCTAssertEqual(projection.points[0].dateLabel, "5/1")
        XCTAssertEqual(projection.points[0].isoDay, "2026-05-01")
        XCTAssertEqual(projection.points[1].isoDay, "2026-05-02") // 10-char prefix
        XCTAssertEqual(projection.peakKwh, 12, accuracy: 0.0001)
        XCTAssertEqual(projection.totalEnergyUsedWh, 312_000, accuracy: 0.0001)
        XCTAssertEqual(projection.totalEnergyChargedWh, 358_000, accuracy: 0.0001)
        XCTAssertEqual(projection.avgEfficiencyWhPerM, 0.172, accuracy: 0.0001)
        XCTAssertEqual(projection.co2SavedKg, 141.7, accuracy: 0.0001)
        XCTAssertEqual(projection.totalCost, 84.36, accuracy: 0.0001)
        XCTAssertEqual(projection.compactKwh, 312, accuracy: 0.0001) // 312000 / 1000
        XCTAssertEqual(projection.netEnergyWh, 46000, accuracy: 0.0001) // 358000 − 312000
    }

    func testProjectionPreservesRowOrderAndIndices() {
        let breakdown = (0 ..< 5).map { offset in
            EnergyDailyEntry(date: String(format: "2026-05-%02d", offset + 1), energyWh: Double(offset) * 1000)
        }
        let projection = EnergyStatsBuilder.buildProjection(data: EnergyStatsData(dailyBreakdown: breakdown))
        XCTAssertEqual(projection.points.map(\.index), [0, 1, 2, 3, 4])
        XCTAssertEqual(projection.points.map(\.dateLabel), ["5/1", "5/2", "5/3", "5/4", "5/5"])
        XCTAssertEqual(projection.points.map(\.energyKwh), [0, 1, 2, 3, 4])
    }

    func testHasDataTrueButHasChartDataFalseWhenBreakdownEmpty() {
        let data = EnergyStatsData(totalWh: 5000, dailyBreakdown: [])
        let projection = EnergyStatsBuilder.buildProjection(data: data)
        XCTAssertTrue(projection.hasData) // web `!!data`
        XCTAssertFalse(projection.hasChartData) // web `chartData.length > 0`
        XCTAssertEqual(projection.compactKwh, 5, accuracy: 0.0001)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class EnergyStatsModelTests: XCTestCase {
    private func data() -> EnergyStatsData {
        EnergyStatsData(totalEnergyUsedWh: 100_000, totalWh: 100_000, dailyBreakdown: [
            EnergyDailyEntry(date: "2026-05-01", energyWh: 9000)
        ])
    }

    private func makeModel(
        _ update: EnergyStatsUpdate,
        telemetry: EnergyStatsTelemetry = OSLogEnergyStatsTelemetry()
    ) -> (EnergyStatsModel, InMemoryEnergyStatsSource) {
        let source = InMemoryEnergyStatsSource(initial: update)
        let model = EnergyStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutCachedDataShowsLoading() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedDataShowsContent() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .loading, data: data()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .loaded, data: data()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedDataKeepsContent() {
        let (model, _) = makeModel(EnergyStatsUpdate(status: .failed("net"), data: data()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEnergyStatsTelemetry()
        let (model, source) = makeModel(EnergyStatsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EnergyStatsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EnergyStatsUpdate(status: .loaded, data: data()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessPrefsAndProjectionTrackUpdates() {
        let (model, source) = makeModel(EnergyStatsUpdate(status: .loading))
        model.start()
        source.push(
            EnergyStatsUpdate(
                status: .loaded,
                freshness: .offline,
                data: data(),
                prefs: .imperial,
                updatedAt: Date(),
                isFetching: false
            )
        )
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.prefs, .imperial)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(EnergyStatsModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(EnergyStatsModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(EnergyStatsModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(EnergyStatsModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 6)))
    }
}

// MARK: - Registry parity

@MainActor final class EnergyStatsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = EnergyStatsWidget.registration
        XCTAssertEqual(registration.id, "energy-stats")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = EnergyStatsWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
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

// MARK: - Formatting (locale-safe display boundary)

@MainActor final class EnergyStatsFormatTests: XCTestCase {
    private let metric = EnergyStatsUnitPrefs(distance: .km, energy: .kwh, localeIdentifier: "en_US")
    private let imperial = EnergyStatsUnitPrefs(distance: .mi, energy: .kwh, localeIdentifier: "en_US")
    private let whPrefs = EnergyStatsUnitPrefs(distance: .km, energy: .wh, localeIdentifier: "en_US")

    func testEnergyConvertsWhToKwhAndLabels() {
        let value = EnergyStatsFormat.energy(18000, prefs: metric, fractionDigits: 1)
        XCTAssertTrue(value.contains("kWh"))
        XCTAssertEqual(value.filter(\.isNumber), "180") // 18.0
    }

    func testEnergyKeepsWhWhenPreferenceIsWh() {
        let value = EnergyStatsFormat.energy(18000, prefs: whPrefs, fractionDigits: 1)
        XCTAssertTrue(value.contains("Wh"))
        XCTAssertFalse(value.contains("kWh"))
        XCTAssertEqual(value.filter(\.isNumber), "180000") // 18,000.0
    }

    func testEfficiencyConvertsPerDistanceUnit() {
        XCTAssertEqual(EnergyStatsFormat.efficiencyDisplay(0.18, distance: .km), 180, accuracy: 0.0001)
        XCTAssertEqual(EnergyStatsFormat.efficiencyDisplay(0.18, distance: .mi), 289.68192, accuracy: 0.0001)
        XCTAssertEqual(EnergyStatsFormat.efficiency(0.18, prefs: metric, fractionDigits: 1).filter(\.isNumber), "1800")
        XCTAssertEqual(
            EnergyStatsFormat.efficiency(0.18, prefs: imperial, fractionDigits: 1).filter(\.isNumber),
            "2897"
        )
        XCTAssertEqual(metric.efficiencyUnit, "Wh/km")
        XCTAssertEqual(imperial.efficiencyUnit, "Wh/mi")
    }

    func testCostAndNumberKeepFractionDigits() {
        XCTAssertEqual(EnergyStatsFormat.cost(84.36, prefs: metric, fractionDigits: 2).filter(\.isNumber), "8436")
        XCTAssertEqual(EnergyStatsFormat.number(141.74, fractionDigits: 1, locale: "en_US").filter(\.isNumber), "1417")
        XCTAssertEqual(EnergyStatsFormat.compact(312.0, prefs: metric, fractionDigits: 1).filter(\.isNumber), "3120")
    }

    func testNonFiniteIsSafe() {
        XCTAssertEqual(EnergyStatsFormat.number(.nan, fractionDigits: 1).filter(\.isNumber), "00")
        XCTAssertEqual(EnergyStatsFormat.energy(.infinity, prefs: metric).filter(\.isNumber), "00")
        XCTAssertEqual(EnergyStatsFormat.efficiencyDisplay(.nan, distance: .km), 0, accuracy: 0.0001)
    }
}

// MARK: - Accessibility summary + stat labels

@MainActor final class EnergyStatsAccessibilityTests: XCTestCase {
    private let metric = EnergyStatsUnitPrefs(distance: .km, energy: .kwh, localeIdentifier: "en_US")

    func testSummaryListsEveryMetricWithUnit() {
        let data = EnergyStatsData(
            totalEnergyUsedWh: 312_000,
            totalEnergyChargedWh: 358_000,
            avgEfficiencyWhPerM: 0.172,
            co2SavedKg: 141.7,
            dailyBreakdown: [EnergyDailyEntry(date: "2026-05-01", energyWh: 12000)]
        )
        let projection = EnergyStatsBuilder.buildProjection(data: data)
        let summary = EnergyStatsAccessibility.summary(for: projection, prefs: metric)
        XCTAssertTrue(summary.contains("Total Used"))
        XCTAssertTrue(summary.contains("Total Charged"))
        XCTAssertTrue(summary.contains("Avg Efficiency"))
        XCTAssertTrue(summary.contains("CO₂ Saved"))
        XCTAssertTrue(summary.contains("kWh"))
        XCTAssertTrue(summary.contains("Wh/km"))
        XCTAssertTrue(summary.contains("kg"))
    }

    func testSummaryFallsBackWhenNoData() {
        XCTAssertEqual(
            EnergyStatsAccessibility.summary(for: .empty, prefs: metric),
            "No energy data available"
        )
    }

    func testStatItemAccessibilityTextJoinsParts() {
        let withUnit = EnergyStatItem(
            id: "eff",
            label: "Avg Efficiency",
            value: "180.0",
            unit: "Wh/km",
            systemImage: "x"
        )
        XCTAssertEqual(withUnit.accessibilityText, "Avg Efficiency 180.0 Wh/km")
        let noUnit = EnergyStatItem(id: "used", label: "Total Used", value: "18.0 kWh", systemImage: "x")
        XCTAssertEqual(noUnit.accessibilityText, "Total Used 18.0 kWh")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnergyStatsTelemetry: EnergyStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
