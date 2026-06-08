//
//  SpeedTrendChart.Tests.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  Unit coverage for the SpeedTrendChart surface:
//    • Adapter (`SpeedTrendProjection`) — month-key extraction, the `isDcSession`
//      heuristic, the SI→kW conversion + one-decimal rounding, monthly grouping +
//      chronological sorting, the localized "MMM yyyy" label, the (month, series)
//      row flattening, and content/empty phase resolution (parity with the web
//      `monthlyTrend` `useMemo`).
//    • Formatting (`SpeedTrendFormat`) — locale-aware decimal + kW strings.
//    • State holder (`SpeedTrendChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping the cached trend.
//    • Accessibility — the chart summary + per-month VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (monthlyTrend useMemo parity)

@MainActor
final class SpeedTrendProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let utc = TimeZone(identifier: "UTC")!

    private let unsorted: [SpeedTrendSession] = [
        SpeedTrendSession(startedAt: "2026-06-03T08:00:00Z", peakPowerW: 100_000, chargerType: "Tesla"),
        SpeedTrendSession(startedAt: "2026-06-15T22:00:00Z", peakPowerW: 7400, chargerType: nil),
        SpeedTrendSession(startedAt: "2026-04-10T10:00:00Z", peakPowerW: 50000, chargerType: nil),
        SpeedTrendSession(startedAt: "2026-05-01T12:00:00Z", peakPowerW: 11000, chargerType: nil),
        SpeedTrendSession(startedAt: "2026-05-20T18:00:00Z", peakPowerW: 150_000, chargerType: "CCS")
    ]

    func testMonthlyTrendSortsChronologically() {
        let points = SpeedTrendProjection.monthlyTrend(from: unsorted, locale: posix, timeZone: utc)
        XCTAssertEqual(points.map(\.monthKey), ["2026-04", "2026-05", "2026-06"])
    }

    func testMonthlyTrendAveragesPerSeries() {
        let points = SpeedTrendProjection.monthlyTrend(from: unsorted, locale: posix, timeZone: utc)
        XCTAssertEqual(points[0].dcAvgKw, 50.0, accuracy: 0.0001)
        XCTAssertEqual(points[0].acAvgKw, 0.0, accuracy: 0.0001)
        XCTAssertEqual(points[1].dcAvgKw, 150.0, accuracy: 0.0001)
        XCTAssertEqual(points[1].acAvgKw, 11.0, accuracy: 0.0001)
        XCTAssertEqual(points[2].dcAvgKw, 100.0, accuracy: 0.0001)
        XCTAssertEqual(points[2].acAvgKw, 7.4, accuracy: 0.0001)
    }

    func testEmptySessionsYieldNoMonths() {
        XCTAssertTrue(SpeedTrendProjection.monthlyTrend(from: [], locale: posix, timeZone: utc).isEmpty)
    }

    func testAverageHelper() {
        XCTAssertEqual(SpeedTrendProjection.average([]), 0, accuracy: 0.0001)
        XCTAssertEqual(SpeedTrendProjection.average([10, 20, 30]), 20, accuracy: 0.0001)
        XCTAssertEqual(SpeedTrendProjection.average([7.4]), 7.4, accuracy: 0.0001)
    }

    func testRoundedTenthMatchesMathRound() {
        // Parity with web `Math.round(value * 10) / 10`.
        XCTAssertEqual(SpeedTrendProjection.roundedTenth(10.24), 10.2, accuracy: 0.0001)
        XCTAssertEqual(SpeedTrendProjection.roundedTenth(10.25), 10.3, accuracy: 0.0001)
        XCTAssertEqual(SpeedTrendProjection.roundedTenth(10.0 / 3.0), 3.3, accuracy: 0.0001)
    }

    func testPeakPowerConvertsWattsToKilowatts() {
        let sessions = [
            SpeedTrendSession(startedAt: "2026-07-02T00:00:00Z", peakPowerW: 11000, chargerType: nil)
        ]
        let points = SpeedTrendProjection.monthlyTrend(from: sessions, locale: posix, timeZone: utc)
        let acAvg = try? XCTUnwrap(points.first).acAvgKw
        XCTAssertEqual(acAvg ?? .nan, 11.0, accuracy: 0.0001)
    }

    func testIsDcSessionHeuristic() {
        XCTAssertTrue(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 5000, chargerType: "Tesla")
        ))
        XCTAssertTrue(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 25000, chargerType: nil)
        ))
        XCTAssertTrue(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 20001, chargerType: nil)
        ))
        XCTAssertFalse(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 20000, chargerType: nil)
        ))
        XCTAssertFalse(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 11000, chargerType: nil)
        ))
        XCTAssertFalse(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: 11000, chargerType: "")
        ))
        XCTAssertFalse(SpeedTrendProjection.isDcSession(
            SpeedTrendSession(startedAt: nil, peakPowerW: nil, chargerType: nil)
        ))
    }

    func testMonthKeyTakesFirstSevenCharacters() {
        XCTAssertEqual(SpeedTrendProjection.monthKey(from: "2026-05-31T12:00:00Z"), "2026-05")
        XCTAssertEqual(SpeedTrendProjection.monthKey(from: nil), "")
        XCTAssertEqual(SpeedTrendProjection.monthKey(from: "2026"), "2026")
    }

    func testMonthLabelMatchesTemplate() {
        XCTAssertEqual(SpeedTrendProjection.monthLabel(for: "2026-05", locale: posix, timeZone: utc), "May 2026")
        XCTAssertEqual(SpeedTrendProjection.monthLabel(for: "2026-12", locale: posix, timeZone: utc), "Dec 2026")
    }

    func testMonthLabelInvalidIsEmDash() {
        XCTAssertEqual(SpeedTrendProjection.monthLabel(for: "", locale: posix, timeZone: utc), "—")
        XCTAssertEqual(SpeedTrendProjection.monthLabel(for: "not-ok!", locale: posix, timeZone: utc), "—")
        XCTAssertEqual(SpeedTrendProjection.monthLabel(for: "2026-13", locale: posix, timeZone: utc), "—")
    }

    func testChartRowsFlattenInPlotOrder() {
        let points = SpeedTrendProjection.monthlyTrend(from: unsorted, locale: posix, timeZone: utc)
        let rows = SpeedTrendProjection.chartRows(from: points)
        XCTAssertEqual(rows.count, points.count * 2)
        // Within each month the DC row precedes the AC row (web line order).
        let firstMonth = rows.prefix(2)
        XCTAssertEqual(firstMonth.map(\.series), [.dc, .ac])
        XCTAssertEqual(firstMonth.first?.monthKey, "2026-04")
        XCTAssertEqual(firstMonth.first?.valueKw, 50.0)
        XCTAssertEqual(firstMonth.last?.valueKw, 0.0)
    }

    func testResolvePhase() {
        XCTAssertEqual(SpeedTrendProjection.resolvePhase(.loading, hasMonths: false), .loading)
        XCTAssertEqual(SpeedTrendProjection.resolvePhase(.loaded, hasMonths: true), .content)
        XCTAssertEqual(SpeedTrendProjection.resolvePhase(.loaded, hasMonths: false), .empty)
        XCTAssertEqual(SpeedTrendProjection.resolvePhase(.failed("boom"), hasMonths: true), .error("boom"))
    }

    func testPointValueForSeries() {
        let point = MonthlySpeedPoint(monthKey: "2026-05", label: "May 2026", dcAvgKw: 120, acAvgKw: 7.4)
        XCTAssertEqual(point.value(for: .dc), 120)
        XCTAssertEqual(point.value(for: .ac), 7.4)
    }

    func testLatestPointIsMostRecentMonth() {
        let points = SpeedTrendProjection.monthlyTrend(from: unsorted, locale: posix, timeZone: utc)
        XCTAssertEqual(SpeedTrendProjection.latestPoint(points)?.monthKey, "2026-06")
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(SpeedTrendSurface.slug, "SpeedTrendChart")
        let slug = SpeedTrendChart.surfaceSlug
        XCTAssertEqual(slug, "SpeedTrendChart")
    }
}

// MARK: - Formatting

@MainActor
final class SpeedTrendFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testDecimalRendersUpToOneFractionDigit() {
        XCTAssertEqual(SpeedTrendFormat.decimal(7.4, locale: posix), "7.4")
        XCTAssertEqual(SpeedTrendFormat.decimal(11.0, locale: posix), "11")
        XCTAssertEqual(SpeedTrendFormat.decimal(0, locale: posix), "0")
    }

    func testDecimalNonFiniteIsEmDash() {
        XCTAssertEqual(SpeedTrendFormat.decimal(.nan, locale: posix), "—")
        XCTAssertEqual(SpeedTrendFormat.decimal(.infinity, locale: posix), "—")
    }

    func testKilowattsAppendsUnit() {
        XCTAssertEqual(SpeedTrendFormat.kilowatts(7.4, unit: "kW", locale: posix), "7.4 kW")
        XCTAssertEqual(SpeedTrendFormat.kilowatts(150, unit: "kW", locale: posix), "150 kW")
    }
}

// MARK: - State holder: SpeedTrendChartModel

@MainActor
final class SpeedTrendChartModelTests: XCTestCase {
    private func makeModel(
        initial: SpeedTrendUpdate?,
        telemetry: SpeedTrendChartTelemetry = SpySpeedTrendTelemetry()
    ) -> (SpeedTrendChartModel, InMemorySpeedTrendSource) {
        let source = InMemorySpeedTrendSource(initial: initial)
        let model = SpeedTrendChartModel(
            source: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US_POSIX"),
            timeZone: TimeZone(identifier: "UTC")!
        )
        return (model, source)
    }

    private let twoMonths: [SpeedTrendSession] = [
        SpeedTrendSession(startedAt: "2026-05-01T00:00:00Z", peakPowerW: 150_000, chargerType: "CCS"),
        SpeedTrendSession(startedAt: "2026-05-10T00:00:00Z", peakPowerW: 11000, chargerType: nil),
        SpeedTrendSession(startedAt: "2026-06-02T00:00:00Z", peakPowerW: 100_000, chargerType: "Tesla")
    ]

    func testLoadedContentProjectsPointsAndRows() {
        let (model, source) = makeModel(initial: SpeedTrendUpdate(status: .loaded, sessions: twoMonths))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(model.rows.count, 4)
        XCTAssertEqual(model.points.first?.dcAvgKw, 150.0)
        XCTAssertEqual(model.points.first?.acAvgKw, 11.0)
        XCTAssertEqual(model.points.last?.acAvgKw, 0.0)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SpeedTrendUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SpeedTrendUpdate(status: .loading, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SpeedTrendUpdate(status: .failed("timeout"), sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySpeedTrendTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SpeedTrendSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .stale))
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .stale))
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .live))
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTrendWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedTrendUpdate(status: .loaded, sessions: twoMonths, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SpeedTrendUpdate(status: .failed("x"), sessions: []))
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
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor
final class SpeedTrendAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    private let points = [
        MonthlySpeedPoint(monthKey: "2026-05", label: "May 2026", dcAvgKw: 150, acAvgKw: 11),
        MonthlySpeedPoint(monthKey: "2026-06", label: "Jun 2026", dcAvgKw: 100, acAvgKw: 7.4)
    ]

    func testChartSummaryIncludesLatestMonth() {
        let summary = SpeedTrendAccessibility.chartSummary(points: points, localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Charging Speed Trend"))
        XCTAssertTrue(summary.contains("2 months"))
        XCTAssertTrue(summary.contains("Latest"))
        XCTAssertTrue(summary.contains("Jun 2026"))
        XCTAssertTrue(summary.contains("DC Avg 100 kW"))
        XCTAssertTrue(summary.contains("AC Avg 7.4 kW"))
    }

    func testChartSummaryEmpty() {
        let summary = SpeedTrendAccessibility.chartSummary(points: [], localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("Charging Speed Trend"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testPointLabel() {
        let label = SpeedTrendAccessibility.pointLabel(points[0], localize: echo, locale: posix)
        XCTAssertEqual(label, "May 2026: DC Avg 150 kW, AC Avg 11 kW")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySpeedTrendTelemetry: SpeedTrendChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
