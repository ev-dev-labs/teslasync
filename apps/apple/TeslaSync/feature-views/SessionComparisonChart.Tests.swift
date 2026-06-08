//
//  SessionComparisonChart.Tests.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  Unit coverage for the SessionComparisonChart surface:
//    • Adapter (`ComparisonProjection`) — the DC taper / AC flat curve math (parity
//      with the web `generateChargingCurve`), the charger classification
//      (`getChargerLabel`), the short date label (`formatDateShort`), the
//      slice(0, 10) + display-rounding series projection, phase resolution, and the
//      SOC / power domains.
//    • State holder (`SessionComparisonChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping cached curves.
//    • Accessibility — the chart summary + per-series VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum ComparisonFixture {
    static let posix = Locale(identifier: "en_US_POSIX")
    static let utc = TimeZone(identifier: "UTC")!

    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: components)!
    }

    static func session(
        id: Int = 1,
        date: Date? = nil,
        start: Double? = 0,
        end: Double? = 100,
        peakW: Double? = 11000,
        charger: String? = nil
    ) -> ComparisonSession {
        ComparisonSession(
            id: id,
            startedAt: date,
            startSocPct: start,
            endSocPct: end,
            peakPowerW: peakW,
            chargerType: charger
        )
    }
}

// MARK: - Adapter: projection (generateChargingCurve consumer parity)

@MainActor
final class ComparisonProjectionTests: XCTestCase {
    private let posix = ComparisonFixture.posix
    private let utc = ComparisonFixture.utc

    private func power(_ curve: [CurvePoint], at soc: Double) -> Double {
        curve.first(where: { $0.soc == soc })?.powerKw ?? .nan
    }

    func testDcCurveTaperBands() {
        let dc = ComparisonFixture.session(peakW: 150_000, charger: nil)
        let curve = ComparisonProjection.curve(for: dc)
        XCTAssertEqual(curve.count, 101)
        XCTAssertEqual(power(curve, at: 0), 150, accuracy: 0.0001)
        XCTAssertEqual(power(curve, at: 50), 150, accuracy: 0.0001)
        XCTAssertEqual(power(curve, at: 65), 150 * (1 - (15.0 / 30) * 0.5), accuracy: 0.0001)
        XCTAssertEqual(power(curve, at: 80), 75, accuracy: 0.0001)
        XCTAssertEqual(power(curve, at: 81), 72.375, accuracy: 0.0001)
        XCTAssertEqual(power(curve, at: 100), 22.5, accuracy: 0.0001)
    }

    func testAcCurveIsFlat() {
        let curve = ComparisonProjection.curve(for: ComparisonFixture.session(start: 20, end: 30, peakW: 11000))
        XCTAssertEqual(curve.count, 11)
        XCTAssertTrue(curve.allSatisfy { abs($0.powerKw - 11) < 0.0001 })
    }

    func testCurveDefaultsForNilFields() {
        let curve = ComparisonProjection.curve(
            for: ComparisonFixture.session(start: nil, end: nil, peakW: nil)
        )
        XCTAssertEqual(curve.count, 101, "nil SOC → 0...100")
        XCTAssertEqual(curve.first?.powerKw ?? 0, 11, accuracy: 0.0001, "nil peak → 11 kW")
    }

    func testIsDcClassification() {
        XCTAssertTrue(ComparisonProjection.isDc(ComparisonFixture.session(peakW: 50000, charger: nil)))
        XCTAssertTrue(ComparisonProjection.isDc(ComparisonFixture.session(peakW: 5000, charger: "CCS")))
        XCTAssertFalse(ComparisonProjection.isDc(ComparisonFixture.session(peakW: 11000, charger: nil)))
        XCTAssertFalse(ComparisonProjection.isDc(ComparisonFixture.session(peakW: 11000, charger: "")))
    }

    func testChargerKind() {
        XCTAssertEqual(
            ComparisonProjection.chargerKind(for: ComparisonFixture.session(charger: "Tesla")),
            .supercharger
        )
        XCTAssertEqual(
            ComparisonProjection.chargerKind(for: ComparisonFixture.session(charger: "tesla-roadside")),
            .supercharger
        )
        XCTAssertEqual(ComparisonProjection.chargerKind(for: ComparisonFixture.session(charger: "CCS")), .dcFast)
        XCTAssertEqual(
            ComparisonProjection.chargerKind(for: ComparisonFixture.session(peakW: 50000, charger: nil)),
            .dcFast
        )
        XCTAssertEqual(
            ComparisonProjection.chargerKind(for: ComparisonFixture.session(peakW: 5000, charger: nil)),
            .homeAc
        )
    }

    func testShortLabelMatchesFormatDateShort() {
        XCTAssertEqual(
            ComparisonProjection.shortLabel(for: ComparisonFixture.date(2026, 6, 1), locale: posix, timeZone: utc),
            "Jun 1"
        )
        XCTAssertEqual(
            ComparisonProjection.shortLabel(for: ComparisonFixture.date(2026, 12, 25), locale: posix, timeZone: utc),
            "Dec 25"
        )
    }

    func testShortLabelNilIsEmDash() {
        XCTAssertEqual(ComparisonProjection.shortLabel(for: nil, locale: posix, timeZone: utc), "—")
    }

    func testSeriesSlicesToTenAndAssignsIds() {
        let sessions = (0 ..< 12).map { ComparisonFixture.session(id: $0, date: ComparisonFixture.date(2026, 6, 1)) }
        let series = ComparisonProjection.series(from: sessions, locale: posix, timeZone: utc)
        XCTAssertEqual(series.count, 10)
        XCTAssertEqual(series.map(\.id), (0 ..< 10).map { "s\($0)" })
        XCTAssertEqual(series.map(\.colorIndex), Array(0 ..< 10))
    }

    func testSeriesRoundsPowerToOneDecimal() {
        let series = ComparisonProjection.series(
            from: [ComparisonFixture.session(peakW: 150_000, charger: nil)],
            locale: posix,
            timeZone: utc
        )
        let point = series.first?.points.first(where: { $0.soc == 81 })
        XCTAssertEqual(point?.powerKw ?? 0, 72.4, accuracy: 0.0001, "72.375 → 72.4 (web Math.round(x*10)/10)")
    }

    func testRoundTenth() {
        XCTAssertEqual(ComparisonProjection.roundTenth(72.375), 72.4, accuracy: 0.0001)
        XCTAssertEqual(ComparisonProjection.roundTenth(150), 150, accuracy: 0.0001)
    }

    func testResolvePhase() {
        XCTAssertEqual(ComparisonProjection.resolvePhase(.loading, hasSeries: false), .loading)
        XCTAssertEqual(ComparisonProjection.resolvePhase(.loaded, hasSeries: true), .content)
        XCTAssertEqual(ComparisonProjection.resolvePhase(.loaded, hasSeries: false), .empty)
        XCTAssertEqual(ComparisonProjection.resolvePhase(.failed("boom"), hasSeries: true), .error("boom"))
    }

    func testSocDomainAndPeak() {
        let series = ComparisonProjection.series(
            from: [ComparisonFixture.session(start: 10, end: 90, peakW: 150_000, charger: nil)],
            locale: posix,
            timeZone: utc
        )
        let domain = ComparisonProjection.socDomain(for: series)
        XCTAssertEqual(domain?.lowerBound, 10)
        XCTAssertEqual(domain?.upperBound, 90)
        XCTAssertEqual(ComparisonProjection.peakPowerKw(of: series), 150, accuracy: 0.0001)
        XCTAssertNil(ComparisonProjection.socDomain(for: []))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ComparisonSurface.slug, "SessionComparisonChart")
        XCTAssertEqual(SessionComparisonChart.surfaceSlug, "SessionComparisonChart")
        XCTAssertEqual(ComparisonProjection.maxSessions, 10)
    }
}

// MARK: - State holder: SessionComparisonChartModel

@MainActor
final class SessionComparisonChartModelTests: XCTestCase {
    private func makeModel(
        initial: ComparisonUpdate?,
        telemetry: SessionComparisonTelemetry = SpySessionComparisonTelemetry()
    ) -> (SessionComparisonChartModel, InMemorySessionComparisonSource) {
        let source = InMemorySessionComparisonSource(initial: initial)
        let model = SessionComparisonChartModel(
            source: source,
            telemetry: telemetry,
            locale: ComparisonFixture.posix,
            timeZone: ComparisonFixture.utc
        )
        return (model, source)
    }

    func testLoadedContentProjectsSeries() {
        let sessions = [
            ComparisonFixture.session(
                id: 1,
                date: ComparisonFixture.date(2026, 6, 1),
                peakW: 150_000,
                charger: "Tesla"
            ),
            ComparisonFixture.session(id: 2, date: ComparisonFixture.date(2026, 6, 2), peakW: 11000)
        ]
        let (model, source) = makeModel(initial: ComparisonUpdate(status: .loaded, sessions: sessions))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.series.count, 2)
        XCTAssertEqual(model.sessionCount, 2)
        XCTAssertEqual(model.series.first?.charger, .supercharger)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: ComparisonUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.series.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: ComparisonUpdate(status: .loading, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: ComparisonUpdate(status: .failed("timeout"), sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySessionComparisonTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ComparisonSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let sessions = [ComparisonFixture.session(id: 1, date: ComparisonFixture.date(2026, 6, 1))]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .stale))
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let sessions = [ComparisonFixture.session(id: 1, date: ComparisonFixture.date(2026, 6, 1))]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .stale))
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .live))
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedCurvesWithoutRefresh() {
        let sessions = [ComparisonFixture.session(id: 1, date: ComparisonFixture.date(2026, 6, 1), peakW: 120_000)]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ComparisonUpdate(status: .loaded, sessions: sessions, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.series.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: ComparisonUpdate(status: .failed("x"), sessions: []))
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
final class ComparisonAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private var series: [ComparisonSeries] {
        ComparisonProjection.series(
            from: [
                ComparisonFixture.session(
                    id: 1,
                    date: ComparisonFixture.date(2026, 6, 1),
                    peakW: 150_000,
                    charger: "Tesla"
                ),
                ComparisonFixture.session(id: 2, date: ComparisonFixture.date(2026, 6, 2), peakW: 11000)
            ],
            locale: ComparisonFixture.posix,
            timeZone: ComparisonFixture.utc
        )
    }

    func testChartSummaryIncludesCountAndPeak() {
        let summary = ComparisonAccessibility.chartSummary(series: series, localize: echo)
        XCTAssertTrue(summary.contains("Session Comparison"))
        XCTAssertTrue(summary.contains("2 sessions"))
        XCTAssertTrue(summary.contains("150.0 kW"))
    }

    func testChartSummaryEmpty() {
        let summary = ComparisonAccessibility.chartSummary(series: [], localize: echo)
        XCTAssertTrue(summary.contains("Session Comparison"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testSeriesLabel() {
        let label = ComparisonAccessibility.seriesLabel(series[0], localize: echo)
        XCTAssertEqual(label, "Jun 1 (Supercharger): peak 150.0 kW")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySessionComparisonTelemetry: SessionComparisonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
