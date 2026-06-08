//
//  SentryModeChart.Tests.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  Unit coverage for the SentryModeChart surface:
//    • Adapter (`SentryModeProjection`) — day-point sorting + short labels, the
//      stacked chart-row flattening, content/empty phase resolution, and the
//      armed/off totals (parity with the web `buildSentryBuckets` consumer).
//    • State holder (`SentryModeChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping cached columns.
//    • Accessibility — the chart summary + per-column VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (buildSentryBuckets consumer parity)

@MainActor final class SentryModeProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    private let utc = TimeZone(identifier: "UTC")!

    private let unsorted: [SentryDayBucket] = [
        SentryDayBucket(date: "2026-06-03", sentryOn: 5, sentryOff: 1),
        SentryDayBucket(date: "2026-06-01", sentryOn: 2, sentryOff: 4),
        SentryDayBucket(date: "2026-06-02", sentryOn: 7, sentryOff: 0)
    ]

    func testDayPointsSortChronologically() {
        let points = SentryModeProjection.dayPoints(from: unsorted, locale: posix, timeZone: utc)
        XCTAssertEqual(points.map(\.dateKey), ["2026-06-01", "2026-06-02", "2026-06-03"])
    }

    func testShortLabelMatchesFormatDateShort() {
        XCTAssertEqual(SentryModeProjection.shortLabel(for: "2026-06-01", locale: posix, timeZone: utc), "Jun 1")
        XCTAssertEqual(SentryModeProjection.shortLabel(for: "2026-12-25", locale: posix, timeZone: utc), "Dec 25")
    }

    func testShortLabelInvalidIsEmDash() {
        XCTAssertEqual(SentryModeProjection.shortLabel(for: "", locale: posix, timeZone: utc), "—")
        XCTAssertEqual(SentryModeProjection.shortLabel(for: "not-a-date", locale: posix, timeZone: utc), "—")
        XCTAssertEqual(SentryModeProjection.shortLabel(for: "2026-13-40", locale: posix, timeZone: utc), "—")
    }

    func testShortLabelToleratesTrailingTime() {
        XCTAssertEqual(
            SentryModeProjection.shortLabel(for: "2026-06-01T12:34:56Z", locale: posix, timeZone: utc),
            "Jun 1"
        )
    }

    func testChartRowsFlattenInPlotOrder() {
        let points = SentryModeProjection.dayPoints(from: unsorted, locale: posix, timeZone: utc)
        let rows = SentryModeProjection.chartRows(from: points)
        XCTAssertEqual(rows.count, points.count * 2)
        // Within each day the armed (On) row precedes the Off row (web stack order).
        let firstDay = rows.prefix(2)
        XCTAssertEqual(firstDay.map(\.series), [.on, .off])
        XCTAssertEqual(firstDay.first?.dateKey, "2026-06-01")
        XCTAssertEqual(firstDay.first?.count, 2)
        XCTAssertEqual(firstDay.last?.count, 4)
    }

    func testNegativeCountsClampToZero() {
        let points = SentryModeProjection.dayPoints(
            from: [SentryDayBucket(date: "2026-06-01", sentryOn: -3, sentryOff: -1)],
            locale: posix,
            timeZone: utc
        )
        XCTAssertEqual(points.first?.sentryOn, 0)
        XCTAssertEqual(points.first?.sentryOff, 0)
    }

    func testTotals() {
        let points = SentryModeProjection.dayPoints(from: unsorted, locale: posix, timeZone: utc)
        XCTAssertEqual(SentryModeProjection.totalOn(points), 14)
        XCTAssertEqual(SentryModeProjection.totalOff(points), 5)
    }

    func testResolvePhase() {
        XCTAssertEqual(SentryModeProjection.resolvePhase(.loading, hasDays: false), .loading)
        XCTAssertEqual(SentryModeProjection.resolvePhase(.loaded, hasDays: true), .content)
        XCTAssertEqual(SentryModeProjection.resolvePhase(.loaded, hasDays: false), .empty)
        XCTAssertEqual(SentryModeProjection.resolvePhase(.failed("boom"), hasDays: true), .error("boom"))
    }

    func testDayPointCountForSeries() {
        let point = SentryDayPoint(dateKey: "2026-06-01", label: "Jun 1", sentryOn: 9, sentryOff: 3)
        XCTAssertEqual(point.count(for: .on), 9)
        XCTAssertEqual(point.count(for: .off), 3)
        XCTAssertEqual(point.total, 12)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SentryModeSurface.slug, "SentryModeChart")
        XCTAssertEqual(SentryModeChart.surfaceSlug, "SentryModeChart")
    }
}

// MARK: - State holder: SentryModeChartModel

@MainActor final class SentryModeChartModelTests: XCTestCase {
    private func makeModel(
        initial: SentryModeUpdate?,
        telemetry: SentryModeChartTelemetry = SpySentryModeTelemetry()
    ) -> (SentryModeChartModel, InMemorySentryModeSource) {
        let source = InMemorySentryModeSource(initial: initial)
        let model = SentryModeChartModel(
            source: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US_POSIX"),
            timeZone: TimeZone(identifier: "UTC")!
        )
        return (model, source)
    }

    func testLoadedContentProjectsPointsAndRows() {
        let buckets = [
            SentryDayBucket(date: "2026-06-01", sentryOn: 3, sentryOff: 1),
            SentryDayBucket(date: "2026-06-02", sentryOn: 4, sentryOff: 2)
        ]
        let (model, source) = makeModel(initial: SentryModeUpdate(status: .loaded, buckets: buckets))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(model.rows.count, 4)
        XCTAssertEqual(model.totalOn, 7)
        XCTAssertEqual(model.totalOff, 3)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SentryModeUpdate(status: .loaded, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SentryModeUpdate(status: .loading, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SentryModeUpdate(status: .failed("timeout"), buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySentryModeTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SentryModeSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let buckets = [SentryDayBucket(date: "2026-06-01", sentryOn: 1, sentryOff: 1)]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .stale))
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let buckets = [SentryDayBucket(date: "2026-06-01", sentryOn: 1, sentryOff: 1)]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .stale))
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .live))
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedColumnsWithoutRefresh() {
        let buckets = [SentryDayBucket(date: "2026-06-01", sentryOn: 2, sentryOff: 5)]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SentryModeUpdate(status: .loaded, buckets: buckets, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SentryModeUpdate(status: .failed("x"), buckets: []))
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

@MainActor final class SentryModeAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let points = [
        SentryDayPoint(dateKey: "2026-06-01", label: "Jun 1", sentryOn: 9, sentryOff: 3),
        SentryDayPoint(dateKey: "2026-06-02", label: "Jun 2", sentryOn: 4, sentryOff: 6)
    ]

    func testChartSummaryIncludesTotals() {
        let summary = SentryModeAccessibility.chartSummary(points: points, localize: echo)
        XCTAssertTrue(summary.contains("Sentry Mode Activity"))
        XCTAssertTrue(summary.contains("2 days"))
        XCTAssertTrue(summary.contains("13 Sentry On"))
        XCTAssertTrue(summary.contains("9 Sentry Off"))
    }

    func testChartSummaryEmpty() {
        let summary = SentryModeAccessibility.chartSummary(points: [], localize: echo)
        XCTAssertTrue(summary.contains("Sentry Mode Activity"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testColumnLabel() {
        let label = SentryModeAccessibility.columnLabel(points[0], localize: echo)
        XCTAssertEqual(label, "Jun 1: Sentry On 9, Sentry Off 3")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySentryModeTelemetry: SentryModeChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
