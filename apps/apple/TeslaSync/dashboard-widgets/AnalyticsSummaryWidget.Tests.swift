//
//  AnalyticsSummaryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  Unit coverage for the AnalyticsSummaryWidget surface:
//    • Adapter (cached → projection) — `AnalyticsSummaryProjector` value parity with the web
//      widget's numeric pipeline (km*1000 → display unit; mi-only efficiency conversion;
//      cost-per-distance; fmtNumber / formatCurrency).
//    • State holder — `AnalyticsSummaryModel` phase resolution across loading / empty / error /
//      content (incl. the all-zero `hasData` empty gate), plus the P1/S11 `view.opened`
//      telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `analytics-summary` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content + compact label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryAnalyticsSummarySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class AnalyticsSummaryAdapterTests: XCTestCase {
    private let sample = AnalyticsSummaryDTO(
        totalDistanceKm: 12450.6,
        avgEfficiencyWhKm: 152.4,
        totalEnergyKwh: 1897.3,
        totalCost: 482.17
    )

    /// Pins the exact display strings the web widget produces for the km preference. The distance
    /// pipeline reproduces the source verbatim: convertDistanceFromSI(total_distance_km * 1000, 'km')
    /// = value / 1000; efficiency stays Wh/km; cost-per = totalCost / displayDist at 3 decimals.
    func testProjectionKilometers() {
        let units = AnalyticsSummaryUnitPrefs(distance: .kilometers, currencySymbol: "$", precision: 2)
        let projection = AnalyticsSummaryProjector.project(summary: sample, units: units)

        XCTAssertEqual(projection.stats.count, 4)

        XCTAssertEqual(projection.stats[0].value, "12,451")
        XCTAssertEqual(projection.stats[0].unit, "km")
        XCTAssertEqual(projection.stats[1].value, "152")
        XCTAssertEqual(projection.stats[1].unit, "Wh/km")
        XCTAssertEqual(projection.stats[2].value, "1,897.3")
        XCTAssertEqual(projection.stats[2].unit, "kWh")
        XCTAssertEqual(projection.stats[3].value, "$0.039")
        XCTAssertNil(projection.stats[3].unit)

        XCTAssertEqual(projection.compactValue, "12,451")
        XCTAssertEqual(projection.distanceSymbol, "km")
    }

    /// Pins the mile branch: distance = value / 1609.344; efficiency = effWhKm * MI_TO_KM with the
    /// `Wh/mi` unit; cost-per recomputed against the mile distance.
    func testProjectionMiles() {
        let units = AnalyticsSummaryUnitPrefs(distance: .miles, currencySymbol: "$", precision: 2)
        let projection = AnalyticsSummaryProjector.project(summary: sample, units: units)

        XCTAssertEqual(projection.stats[0].value, "7,736")
        XCTAssertEqual(projection.stats[0].unit, "mi")
        XCTAssertEqual(projection.stats[1].value, "245")
        XCTAssertEqual(projection.stats[1].unit, "Wh/mi")
        XCTAssertEqual(projection.stats[2].value, "1,897.3")
        XCTAssertEqual(projection.stats[3].value, "$0.062")

        XCTAssertEqual(projection.compactValue, "7,736")
        XCTAssertEqual(projection.distanceSymbol, "mi")
    }

    /// The efficiency conversion is mi-only in the web source: the feet preference keeps the raw
    /// Wh/km value and label, while the distance itself converts to feet.
    func testProjectionFeetKeepsWhPerKmEfficiency() {
        let units = AnalyticsSummaryUnitPrefs(distance: .feet, currencySymbol: "$", precision: 2)
        let projection = AnalyticsSummaryProjector.project(summary: sample, units: units)

        XCTAssertEqual(projection.stats[0].value, "40,848,425")
        XCTAssertEqual(projection.stats[0].unit, "ft")
        XCTAssertEqual(projection.stats[1].value, "152")
        XCTAssertEqual(projection.stats[1].unit, "Wh/km")
        XCTAssertEqual(projection.distanceSymbol, "ft")
    }

    /// The cost stat always renders at 3 decimals and honours the user's currency symbol (the web
    /// `formatCurrency(costPerDist, 3)` ignores the per-user precision for this widget).
    func testProjectionHonorsCurrencySymbolAtThreeDecimals() {
        let units = AnalyticsSummaryUnitPrefs(distance: .kilometers, currencySymbol: "€", precision: 0)
        let projection = AnalyticsSummaryProjector.project(summary: sample, units: units)
        XCTAssertEqual(projection.stats[3].value, "€0.039")
    }

    /// When there is no distance (or no cost), cost-per-distance is 0 and the web shows an em dash.
    func testCostDashWhenNoDistance() {
        let units = AnalyticsSummaryUnitPrefs(distance: .kilometers)
        let energyOnly = AnalyticsSummaryDTO(totalEnergyKwh: 42, totalCost: 99)
        let projection = AnalyticsSummaryProjector.project(summary: energyOnly, units: units)
        XCTAssertEqual(projection.stats[0].value, "0")
        XCTAssertEqual(projection.stats[3].value, "—")
    }

    func testCostDashWhenNoCost() {
        let units = AnalyticsSummaryUnitPrefs(distance: .kilometers)
        let noCost = AnalyticsSummaryDTO(totalDistanceKm: 100, totalCost: 0)
        let projection = AnalyticsSummaryProjector.project(summary: noCost, units: units)
        XCTAssertEqual(projection.stats[3].value, "—")
    }

    func testEmptyStatsProjectToZeroes() {
        let units = AnalyticsSummaryUnitPrefs(distance: .kilometers, currencySymbol: "$", precision: 2)
        let projection = AnalyticsSummaryProjector.project(summary: AnalyticsSummaryDTO(), units: units)
        XCTAssertEqual(projection.stats[0].value, "0")
        XCTAssertEqual(projection.stats[1].value, "0")
        XCTAssertEqual(projection.stats[2].value, "0.0")
        XCTAssertEqual(projection.stats[3].value, "—")
        XCTAssertFalse(projection.hasSparklines)
    }

    /// The four stats carry the web source's icon accents in order (cyan / emerald / amber / purple).
    func testStatAccentsMatchSource() {
        let projection = AnalyticsSummaryProjector.project(summary: sample, units: AnalyticsSummaryUnitPrefs())
        XCTAssertEqual(projection.stats.map(\.accent), [.cyan, .emerald, .amber, .purple])
    }

    /// The interpolated cost label resolves the `{{unit}}` placeholder with the distance symbol. // parity:allow ui
    func testCostLabelInterpolation() {
        let km = AnalyticsSummaryProjector.project(
            summary: sample,
            units: AnalyticsSummaryUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(km.stats[3].label, "Cost / km")
        let mi = AnalyticsSummaryProjector.project(
            summary: sample,
            units: AnalyticsSummaryUnitPrefs(distance: .miles)
        )
        XCTAssertEqual(mi.stats[3].label, "Cost / mi")
    }

    /// `hasSparklines` mirrors the web `sparklines.some(s => s.length > 0)`; the row carries one
    /// series per stat in source order.
    func testSparklinesPresentWhenTrendsExist() {
        let withTrends = AnalyticsSummaryDTO(
            totalDistanceKm: 100,
            distanceTrend: [1, 2, 3],
            costTrend: [4, 5]
        )
        let projection = AnalyticsSummaryProjector.project(summary: withTrends, units: AnalyticsSummaryUnitPrefs())
        XCTAssertEqual(projection.sparklines.count, 4)
        XCTAssertTrue(projection.hasSparklines)
        XCTAssertEqual(projection.sparklines.map(\.colorIndex), [0, 1, 2, 3])
        XCTAssertEqual(projection.sparklines[0].values, [1, 2, 3])
        XCTAssertTrue(projection.sparklines[1].values.isEmpty)
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(AnalyticsSummaryFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(AnalyticsSummaryFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(AnalyticsSummaryFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(AnalyticsSummaryFormat.currency(0.0387, symbol: "$", precision: 3), "$0.039")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertAnalyticsDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(AnalyticsSummaryFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertAnalyticsDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertAnalyticsDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertAnalyticsDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class AnalyticsSummaryPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(AnalyticsSummaryModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }

    /// The web `hasData = distKm > 0 || energyKwh > 0` content gate.
    func testDTOHasDataGate() {
        XCTAssertFalse(AnalyticsSummaryDTO().hasData)
        XCTAssertTrue(AnalyticsSummaryDTO(totalDistanceKm: 1).hasData)
        XCTAssertTrue(AnalyticsSummaryDTO(totalEnergyKwh: 1).hasData)
        XCTAssertFalse(AnalyticsSummaryDTO(totalCost: 99, distanceTrend: [1, 2]).hasData)
    }
}

@MainActor final class AnalyticsSummaryModelTests: XCTestCase {
    private func makeModel(
        _ update: AnalyticsSummaryUpdate,
        telemetry: AnalyticsSummaryTelemetry = OSLogAnalyticsSummaryTelemetry()
    ) -> (AnalyticsSummaryModel, InMemoryAnalyticsSummarySource) {
        let source = InMemoryAnalyticsSummarySource(initial: update)
        let model = AnalyticsSummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(AnalyticsSummaryUpdate(status: .loading, summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(AnalyticsSummaryUpdate(status: .loaded, summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    /// A present-but-all-zero snapshot is empty (the web `hasData` gate), not content.
    func testAllZeroSummaryShowsEmpty() {
        let (model, _) = makeModel(AnalyticsSummaryUpdate(status: .loaded, summary: AnalyticsSummaryDTO()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEnergyOnlySummaryShowsContent() {
        let (model, _) = makeModel(
            AnalyticsSummaryUpdate(status: .loaded, summary: AnalyticsSummaryDTO(totalEnergyKwh: 5))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.stats[3].value, "—")
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(AnalyticsSummaryUpdate(status: .failed("boom"), summary: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let summary = AnalyticsSummaryDTO(totalDistanceKm: 100, totalEnergyKwh: 12)
        let (model, _) = makeModel(AnalyticsSummaryUpdate(status: .failed("net"), summary: summary))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.stats.count, 4)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyAnalyticsSummaryTelemetry()
        let (model, source) = makeModel(AnalyticsSummaryUpdate(status: .loading, summary: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AnalyticsSummaryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(AnalyticsSummaryUpdate(status: .loaded, summary: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let summary = AnalyticsSummaryDTO(totalDistanceKm: 10)
        let (model, source) = makeModel(AnalyticsSummaryUpdate(status: .loaded, summary: summary))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AnalyticsSummaryUpdate(status: .loaded, connection: .stale, isFetching: true, summary: summary))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AnalyticsSummaryUpdate(status: .loaded, connection: .stale, isFetching: false, summary: summary))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(AnalyticsSummaryUpdate(status: .loading, summary: nil))
        model.start()
        source.push(
            AnalyticsSummaryUpdate(
                status: .loaded,
                connection: .offline,
                summary: AnalyticsSummaryDTO(totalDistanceKm: 1000, totalEnergyKwh: 200),
                units: AnalyticsSummaryUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.distanceSymbol, "mi")
    }
}

// MARK: - Registry parity

@MainActor final class AnalyticsSummaryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = AnalyticsSummaryWidget.registration
        XCTAssertEqual(registration.id, "analytics-summary")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(AnalyticsSummaryWidget.surfaceSlug, "AnalyticsSummaryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = AnalyticsSummaryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class AnalyticsSummaryAccessibilityTests: XCTestCase {
    private let projection = AnalyticsSummaryProjector.project(
        summary: AnalyticsSummaryDTO(
            totalDistanceKm: 12450.6,
            avgEfficiencyWhKm: 152.4,
            totalEnergyKwh: 1897.3,
            totalCost: 482.17
        ),
        units: AnalyticsSummaryUnitPrefs(distance: .kilometers)
    )

    func testSummaryIncludesEveryStat() {
        let summary = AnalyticsSummaryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Analytics Summary"))
        XCTAssertTrue(summary.contains("Total Distance 12,451 km"))
        XCTAssertTrue(summary.contains("Avg Efficiency 152 Wh/km"))
        XCTAssertTrue(summary.contains("Energy Consumed 1,897.3 kWh"))
        XCTAssertTrue(summary.contains("Cost / km $0.039"))
    }

    func testCompactLabelSpeaksDistanceAndRole() {
        let label = AnalyticsSummaryAccessibility.compactLabel(for: projection)
        XCTAssertEqual(label, "12,451 km Total Distance")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAnalyticsSummaryTelemetry: AnalyticsSummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
