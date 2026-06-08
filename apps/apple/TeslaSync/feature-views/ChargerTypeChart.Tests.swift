//
//  ChargerTypeChart.Tests.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  Unit coverage for the ChargerTypeChart surface:
//    • Adapter (`ChargerTypeChartProjection`) — charger classification (`getChargerLabel`),
//      first-occurrence grouping + aggregates, duration minutes, mean, chart-row
//      flattening, phase resolution, totals, and locale-aware formatting.
//    • State holder (`ChargerTypeChartModel`) — phase across loading / loaded / empty
//      / failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once), and offline keeping cached columns.
//    • Accessibility — the chart summary + per-charger VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (chargerTypeStats parity)

@MainActor final class ChargerTypeChartProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func mins(_ minutes: Double) -> Date {
        base.addingTimeInterval(minutes * 60)
    }

    private func sessions() -> [ChargingSessionInput] {
        [
            ChargingSessionInput(
                chargerType: "Tesla", peakPowerW: 150_000, totalEnergyAddedWh: 50000,
                startedAt: base, endedAt: mins(30)
            ),
            ChargingSessionInput(
                chargerType: "Tesla", peakPowerW: 170_000, totalEnergyAddedWh: 60000,
                startedAt: base, endedAt: mins(20)
            ),
            ChargingSessionInput(
                chargerType: "EVgo", peakPowerW: 50000, totalEnergyAddedWh: 40000,
                startedAt: base, endedAt: mins(40)
            ),
            ChargingSessionInput(
                chargerType: nil, peakPowerW: 7000, totalEnergyAddedWh: 30000,
                startedAt: base, endedAt: mins(300)
            )
        ]
    }

    func testClassifyMatchesGetChargerLabel() {
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: "Tesla", peakPowerW: nil), .supercharger)
        XCTAssertEqual(
            ChargerTypeChartProjection.classify(chargerType: "Tesla Supercharger V3", peakPowerW: nil),
            .supercharger
        )
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: "EVgo", peakPowerW: 50000), .dcFast)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: "EVgo", peakPowerW: nil), .dcFast)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: nil, peakPowerW: 50000), .dcFast)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: "  ", peakPowerW: 50000), .dcFast)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: nil, peakPowerW: 7000), .homeAC)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: "", peakPowerW: 7000), .homeAC)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: nil, peakPowerW: 20000), .homeAC)
        XCTAssertEqual(ChargerTypeChartProjection.classify(chargerType: nil, peakPowerW: nil), .homeAC)
    }

    func testPointsGroupInFirstOccurrenceOrder() {
        let points = ChargerTypeChartProjection.points(from: sessions())
        XCTAssertEqual(points.map(\.type), [.supercharger, .dcFast, .homeAC])
    }

    func testPointsAggregates() {
        let points = ChargerTypeChartProjection.points(from: sessions())
        let supercharger = points[0]
        XCTAssertEqual(supercharger.count, 2)
        XCTAssertEqual(supercharger.avgKw, 160.0, accuracy: 0.0001)
        XCTAssertEqual(supercharger.avgKwh, 55.0, accuracy: 0.0001)
        XCTAssertEqual(supercharger.avgDurationMin, 25.0, accuracy: 0.0001)

        let dcFast = points[1]
        XCTAssertEqual(dcFast.count, 1)
        XCTAssertEqual(dcFast.avgKw, 50.0, accuracy: 0.0001)
        XCTAssertEqual(dcFast.avgKwh, 40.0, accuracy: 0.0001)
        XCTAssertEqual(dcFast.avgDurationMin, 40.0, accuracy: 0.0001)

        let homeAC = points[2]
        XCTAssertEqual(homeAC.count, 1)
        XCTAssertEqual(homeAC.avgKw, 7.0, accuracy: 0.0001)
        XCTAssertEqual(homeAC.avgKwh, 30.0, accuracy: 0.0001)
        XCTAssertEqual(homeAC.avgDurationMin, 300.0, accuracy: 0.0001)
    }

    func testPointsEmptyForNoSessions() {
        XCTAssertTrue(ChargerTypeChartProjection.points(from: []).isEmpty)
    }

    func testDurationMinutes() {
        XCTAssertEqual(ChargerTypeChartProjection.durationMinutes(startedAt: base, endedAt: mins(30)), 30)
        XCTAssertEqual(ChargerTypeChartProjection.durationMinutes(startedAt: base, endedAt: nil), 0)
        XCTAssertEqual(ChargerTypeChartProjection.durationMinutes(startedAt: mins(10), endedAt: base), 0)
        XCTAssertEqual(ChargerTypeChartProjection.durationMinutes(startedAt: nil, endedAt: mins(10)), 0)
        XCTAssertEqual(
            ChargerTypeChartProjection.durationMinutes(startedAt: base, endedAt: base.addingTimeInterval(90)),
            2
        )
    }

    func testAvg() {
        XCTAssertEqual(ChargerTypeChartProjection.avg([]), 0)
        XCTAssertEqual(ChargerTypeChartProjection.avg([2, 4, 6]), 4, accuracy: 0.0001)
        XCTAssertEqual(ChargerTypeChartProjection.avg([150, 170]), 160, accuracy: 0.0001)
    }

    func testChartRowsFlattenInPlotOrder() {
        let points = ChargerTypeChartProjection.points(from: sessions())
        let rows = ChargerTypeChartProjection.chartRows(from: points)
        XCTAssertEqual(rows.count, points.count * 2)
        // Within each charger the Power (kW) row precedes the Energy (kWh) row.
        XCTAssertEqual(rows[0].metric, .power)
        XCTAssertEqual(rows[1].metric, .energy)
        XCTAssertEqual(rows[0].type, .supercharger)
        XCTAssertEqual(rows[0].value, 160.0, accuracy: 0.0001)
        XCTAssertEqual(rows[1].value, 55.0, accuracy: 0.0001)
    }

    func testResolvePhase() {
        XCTAssertEqual(ChargerTypeChartProjection.resolvePhase(.loading, hasRows: false), .loading)
        XCTAssertEqual(ChargerTypeChartProjection.resolvePhase(.loaded, hasRows: true), .content)
        XCTAssertEqual(ChargerTypeChartProjection.resolvePhase(.loaded, hasRows: false), .empty)
        XCTAssertEqual(ChargerTypeChartProjection.resolvePhase(.failed("boom"), hasRows: true), .error("boom"))
    }

    func testTotalSessions() {
        XCTAssertEqual(ChargerTypeChartProjection.totalSessions(ChargerTypeChartProjection.points(from: sessions())), 4)
    }

    func testPointValueForMetric() {
        let point = ChargerTypePoint(type: .dcFast, count: 3, avgKw: 48.5, avgKwh: 33.2, avgDurationMin: 44)
        XCTAssertEqual(point.value(for: .power), 48.5)
        XCTAssertEqual(point.value(for: .energy), 33.2)
    }

    func testFormatting() {
        XCTAssertEqual(ChargerTypeChartProjection.decimalString(160.0, decimals: 1, locale: posix), "160.0")
        XCTAssertEqual(ChargerTypeChartProjection.decimalString(48.567, decimals: 1, locale: posix), "48.6")
        XCTAssertEqual(ChargerTypeChartProjection.intString(25.0, locale: posix), "25")
        // Grouping follows the locale (web `fmtInt` groups under en-US).
        let enUS = Locale(identifier: "en_US")
        XCTAssertEqual(ChargerTypeChartProjection.intString(1234.0, locale: enUS), "1,234")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChargerTypeSurface.slug, "ChargerTypeChart")
    }
}

// MARK: - State holder: ChargerTypeChartModel

@MainActor final class ChargerTypeChartModelTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_700_000_000)

    private func sampleSessions() -> [ChargingSessionInput] {
        [
            ChargingSessionInput(
                chargerType: "Tesla", peakPowerW: 150_000, totalEnergyAddedWh: 50000,
                startedAt: base, endedAt: base.addingTimeInterval(1800)
            ),
            ChargingSessionInput(
                chargerType: nil, peakPowerW: 7000, totalEnergyAddedWh: 30000,
                startedAt: base, endedAt: base.addingTimeInterval(18000)
            )
        ]
    }

    private func makeModel(
        initial: ChargerTypeChartUpdate?,
        telemetry: ChargerTypeChartTelemetry = ChargerTypeChartSpyChargerTypeTelemetry()
    ) -> (ChargerTypeChartModel, ChargerTypeChartInMemoryChargerTypeSource) {
        let source = ChargerTypeChartInMemoryChargerTypeSource(initial: initial)
        let model = ChargerTypeChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsPointsAndRows() {
        let (model, source) = makeModel(
            initial: ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions())
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(model.rows.count, 4)
        XCTAssertEqual(model.totalSessions, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: ChargerTypeChartUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: ChargerTypeChartUpdate(status: .loading, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: ChargerTypeChartUpdate(status: .failed("timeout"), sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = ChargerTypeChartSpyChargerTypeTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargerTypeSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .stale))
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .stale))
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .live))
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedColumnsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ChargerTypeChartUpdate(status: .loaded, sessions: sampleSessions(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: ChargerTypeChartUpdate(status: .failed("x"), sessions: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testSurfaceSlugOnView() {
        // `ChargerTypeChart` is `@MainActor` (SwiftUI `View`); read the slug here.
        let slug = ChargerTypeChart.surfaceSlug
        XCTAssertEqual(slug, "ChargerTypeChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class ChargerTypeChartAccessibilityTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let points = [
        ChargerTypePoint(type: .supercharger, count: 5, avgKw: 160.0, avgKwh: 55.0, avgDurationMin: 25),
        ChargerTypePoint(type: .homeAC, count: 3, avgKw: 7.0, avgKwh: 30.0, avgDurationMin: 300)
    ]

    func testChartSummaryIncludesTotals() {
        let summary = ChargerTypeChartAccessibility.chartSummary(points: points, localize: echo)
        XCTAssertTrue(summary.contains("Charge Rate by Charger Type"))
        XCTAssertTrue(summary.contains("2 charger types"))
        XCTAssertTrue(summary.contains("8 Sessions"))
    }

    func testChartSummaryEmpty() {
        let summary = ChargerTypeChartAccessibility.chartSummary(points: [], localize: echo)
        XCTAssertTrue(summary.contains("Charge Rate by Charger Type"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testRowLabelCarriesColumnFigures() {
        let label = ChargerTypeChartAccessibility.rowLabel(
            points[0],
            name: "Supercharger",
            locale: posix,
            localize: echo
        )
        XCTAssertEqual(label, "Supercharger: Sessions 5, Avg kW 160.0, Avg kWh 55.0, Avg minutes 25")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class ChargerTypeChartSpyChargerTypeTelemetry: ChargerTypeChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
