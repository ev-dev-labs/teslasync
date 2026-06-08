//
//  PowerOutputChart.Tests.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  Unit coverage for the PowerOutputChart surface:
//    • Adapter (`PowerOutputProjection` / `PowerOutputExport`) — the watts→kW conversion,
//      the sort-ascending + `slice(-30)` trim, the `data.length <= 1` empty guard, the two
//      overlaid series projection, phase resolution, the value/date domains (incl. the y=0
//      reference line), the short date label, the legend toggle, and the CSV export.
//    • State holder (`PowerOutputChartModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh (exactly
//      once), offline keeping cached data, and the hidden-series toggle.
//    • Accessibility — the chart summary + per-series VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum PowerOutputFixture {
    static let posix = Locale(identifier: "en_US_POSIX")
    static let utc = TimeZone(identifier: "UTC")!

    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 9
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: components)!
    }

    static func point(
        id: Int = 1,
        date: Date,
        peakW: Double? = 120_000,
        regenW: Double? = -30000
    ) -> PowerOutputPoint {
        PowerOutputPoint(id: id, date: date, peakPowerW: peakW, regenPowerW: regenW)
    }

    /// `count` drives on ascending consecutive days starting 2026-06-01.
    static func points(_ count: Int, peakW: Double? = 120_000, regenW: Double? = -30000) -> [PowerOutputPoint] {
        (0 ..< count).map { offset in
            point(
                id: offset + 1,
                date: date(2026, 6, 1).addingTimeInterval(Double(offset) * 86400),
                peakW: peakW,
                regenW: regenW
            )
        }
    }
}

// MARK: - Adapter: projection

final class PowerOutputProjectionTests: XCTestCase {
    private let posix = PowerOutputFixture.posix
    private let utc = PowerOutputFixture.utc

    func testWattsToKw() {
        XCTAssertEqual(PowerOutputProjection.wattsToKw(120_000), 120, accuracy: 0.0001)
        XCTAssertEqual(PowerOutputProjection.wattsToKw(-30000), -30, accuracy: 0.0001)
        XCTAssertEqual(PowerOutputProjection.wattsToKw(nil), 0, accuracy: 0.0001, "web `?? 0` default")
    }

    func testTrimmedSortsAscendingAndKeepsLast30() {
        // 35 drives supplied out of order; expect the last 30 by date, ascending.
        let shuffled = PowerOutputFixture.points(35).reversed()
        let trimmed = PowerOutputProjection.trimmed(Array(shuffled))
        XCTAssertEqual(trimmed.count, 30, "web slice(-30)")
        XCTAssertEqual(trimmed.map(\.id), Array(6 ... 35), "keeps the latest 30, ascending")
        XCTAssertTrue(zip(trimmed, trimmed.dropFirst()).allSatisfy { $0.date <= $1.date })
    }

    func testHasRenderableDataMatchesWebLengthGuard() {
        XCTAssertFalse(PowerOutputProjection.hasRenderableData([]))
        XCTAssertFalse(
            PowerOutputProjection.hasRenderableData(PowerOutputFixture.points(1)),
            "web `data.length <= 1` → null"
        )
        XCTAssertTrue(PowerOutputProjection.hasRenderableData(PowerOutputFixture.points(2)))
    }

    func testSeriesProjectsTwoTracesInKw() {
        let series = PowerOutputProjection.series(from: PowerOutputFixture.points(3))
        XCTAssertEqual(series.count, 2)
        XCTAssertEqual(series.map(\.role), [.peak, .regen])
        XCTAssertEqual(series.map(\.id), ["powerMax", "powerMin"], "ids match web dataKeys")
        XCTAssertEqual(series[0].samples.count, 3)
        XCTAssertEqual(series[0].samples.first?.kw ?? 0, 120, accuracy: 0.0001)
        XCTAssertEqual(series[1].samples.first?.kw ?? 0, -30, accuracy: 0.0001)
    }

    func testSeriesEmptyWhenSingleDrive() {
        XCTAssertTrue(PowerOutputProjection.series(from: PowerOutputFixture.points(1)).isEmpty)
    }

    func testResolvePhase() {
        XCTAssertEqual(PowerOutputProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(PowerOutputProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(PowerOutputProjection.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(PowerOutputProjection.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testValueDomainAlwaysIncludesZero() {
        let series = PowerOutputProjection.series(
            from: PowerOutputFixture.points(4, peakW: 150_000, regenW: -40000)
        )
        let domain = PowerOutputProjection.valueDomain(for: series)
        XCTAssertEqual(domain?.lowerBound, -40, "regen min")
        XCTAssertEqual(domain?.upperBound, 150, "peak max")

        // All-positive data still pins the lower bound to the y=0 reference line.
        let positive = PowerOutputProjection.series(
            from: PowerOutputFixture.points(3, peakW: 90000, regenW: 10000)
        )
        XCTAssertEqual(PowerOutputProjection.valueDomain(for: positive)?.lowerBound, 0)
    }

    func testValueDomainRespectsHiddenSeries() {
        let series = PowerOutputProjection.series(
            from: PowerOutputFixture.points(3, peakW: 120_000, regenW: -50000)
        )
        let domain = PowerOutputProjection.valueDomain(for: series, hidden: ["powerMin"])
        XCTAssertEqual(domain?.lowerBound, 0, "regen hidden → lower bound pinned to zero")
        XCTAssertEqual(domain?.upperBound, 120)
    }

    func testDateDomainSpansTrimmedRange() {
        let series = PowerOutputProjection.series(from: PowerOutputFixture.points(5))
        let domain = PowerOutputProjection.dateDomain(for: series)
        XCTAssertEqual(domain?.lowerBound, PowerOutputFixture.date(2026, 6, 1))
        XCTAssertEqual(domain?.upperBound, PowerOutputFixture.date(2026, 6, 5))
        XCTAssertNil(PowerOutputProjection.dateDomain(for: []))
    }

    func testShortLabelMatchesFormatDateShort() {
        XCTAssertEqual(
            PowerOutputProjection.shortLabel(for: PowerOutputFixture.date(2026, 6, 1), locale: posix, timeZone: utc),
            "Jun 1"
        )
        XCTAssertEqual(
            PowerOutputProjection.shortLabel(for: PowerOutputFixture.date(2026, 12, 25), locale: posix, timeZone: utc),
            "Dec 25"
        )
    }

    func testShortLabelNilIsEmDash() {
        XCTAssertEqual(PowerOutputProjection.shortLabel(for: nil, locale: posix, timeZone: utc), "—")
    }

    func testToggleHiddenIsPureRoundTrip() {
        let once = PowerOutputProjection.toggleHidden([], "powerMax")
        XCTAssertEqual(once, ["powerMax"])
        XCTAssertEqual(PowerOutputProjection.toggleHidden(once, "powerMax"), [])
    }

    func testSurfaceSlugAndCap() {
        XCTAssertEqual(PowerOutputSurface.slug, "PowerOutputChart")
        XCTAssertEqual(PowerOutputChart.surfaceSlug, "PowerOutputChart")
        XCTAssertEqual(PowerOutputProjection.maxPoints, 30)
    }
}

// MARK: - Adapter: CSV export

final class PowerOutputExportTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCsvHeaderAndRows() {
        let csv = PowerOutputExport.csv(
            from: PowerOutputFixture.points(2, peakW: 120_000, regenW: -30000),
            localize: echo,
            locale: PowerOutputFixture.posix,
            timeZone: PowerOutputFixture.utc
        )
        let lines = csv.split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.first, "Date,Peak (kW),Regen (kW)")
        XCTAssertEqual(lines.count, 3, "header + 2 drives")
        XCTAssertEqual(lines[1], "Jun 1,120.0,-30.0")
        XCTAssertEqual(lines[2], "Jun 2,120.0,-30.0")
    }
}

// MARK: - State holder: PowerOutputChartModel

@MainActor
final class PowerOutputChartModelTests: XCTestCase {
    private func makeModel(
        initial: PowerOutputUpdate?,
        telemetry: PowerOutputTelemetry = SpyPowerOutputTelemetry()
    ) -> (PowerOutputChartModel, InMemoryPowerOutputSource) {
        let source = InMemoryPowerOutputSource(initial: initial)
        let model = PowerOutputChartModel(
            source: source,
            telemetry: telemetry,
            locale: PowerOutputFixture.posix,
            timeZone: PowerOutputFixture.utc
        )
        return (model, source)
    }

    func testLoadedContentProjectsSeries() {
        let (model, source) = makeModel(
            initial: PowerOutputUpdate(status: .loaded, points: PowerOutputFixture.points(4))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.series.count, 2)
        XCTAssertEqual(model.driveCount, 4)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedSingleDriveResolvesEmptyPhase() {
        let (model, _) = makeModel(
            initial: PowerOutputUpdate(status: .loaded, points: PowerOutputFixture.points(1))
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.series.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: PowerOutputUpdate(status: .loading, points: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: PowerOutputUpdate(status: .failed("timeout"), points: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyPowerOutputTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PowerOutputSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        let points = PowerOutputFixture.points(3)
        source.push(PowerOutputUpdate(status: .loaded, points: points, connection: .stale))
        source.push(PowerOutputUpdate(status: .loaded, points: points, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        let points = PowerOutputFixture.points(3)
        source.push(PowerOutputUpdate(status: .loaded, points: points, connection: .stale))
        source.push(PowerOutputUpdate(status: .loaded, points: points, connection: .live))
        source.push(PowerOutputUpdate(status: .loaded, points: points, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedDataWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(PowerOutputUpdate(status: .loaded, points: PowerOutputFixture.points(3), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.series.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testToggleSeriesHidesAndShows() {
        let (model, _) = makeModel(
            initial: PowerOutputUpdate(status: .loaded, points: PowerOutputFixture.points(4))
        )
        model.start()
        XCTAssertEqual(model.visibleSeries.count, 2)
        model.toggleSeries(.regen)
        XCTAssertTrue(model.isHidden(.regen))
        XCTAssertEqual(model.visibleSeries.map(\.role), [.peak])
        model.toggleSeries(.regen)
        XCTAssertFalse(model.isHidden(.regen))
        XCTAssertEqual(model.visibleSeries.count, 2)
    }

    func testExportCSVReflectsCurrentDrives() {
        let (model, _) = makeModel(
            initial: PowerOutputUpdate(status: .loaded, points: PowerOutputFixture.points(2))
        )
        model.start()
        XCTAssertTrue(model.exportCSV.contains("Peak (kW)"))
        XCTAssertEqual(model.exportCSV.split(separator: "\n").count, 3)
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: PowerOutputUpdate(status: .failed("x"), points: []))
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

final class PowerOutputAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private var series: [PowerOutputSeries] {
        PowerOutputProjection.series(
            from: PowerOutputFixture.points(5, peakW: 150_000, regenW: -40000)
        )
    }

    func testChartSummaryIncludesCountPeakAndRegen() {
        let summary = PowerOutputAccessibility.chartSummary(series: series, hidden: [], localize: echo)
        XCTAssertTrue(summary.contains("Power Output History"))
        XCTAssertTrue(summary.contains("5 drives"))
        XCTAssertTrue(summary.contains("peak 150.0 kW"))
        XCTAssertTrue(summary.contains("regen -40.0 kW"))
    }

    func testChartSummaryOmitsHiddenSeries() {
        let summary = PowerOutputAccessibility.chartSummary(series: series, hidden: ["powerMin"], localize: echo)
        XCTAssertTrue(summary.contains("peak 150.0 kW"))
        XCTAssertFalse(summary.contains("regen"), "hidden regen omitted from the summary")
    }

    func testChartSummaryEmpty() {
        let summary = PowerOutputAccessibility.chartSummary(series: [], hidden: [], localize: echo)
        XCTAssertTrue(summary.contains("Power Output History"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testSeriesLabels() {
        XCTAssertEqual(
            PowerOutputAccessibility.seriesLabel(series[0], localize: echo),
            "Peak Power (kW): peak 150.0 kW"
        )
        XCTAssertEqual(
            PowerOutputAccessibility.seriesLabel(series[1], localize: echo),
            "Regen Power (kW): regen -40.0 kW"
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyPowerOutputTelemetry: PowerOutputTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
