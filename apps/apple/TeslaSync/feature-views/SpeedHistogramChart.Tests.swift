//
//  SpeedHistogramChart.Tests.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  Unit coverage for the SpeedHistogramChart surface:
//    • Adapter (`SpeedHistogramChartProjection`) — the `speedHistData` → bars mapping
//      (null-safe pct), the canonical sample → bucket computation (band edges, en-dash
//      labels + "120+" tail, inclusive-lower/exclusive-upper counting, empty-band
//      filtering, web rounding over the full sample count), phase resolution, totals,
//      the dominant band, locale-aware formatting, and the series name.
//    • State holder (`SpeedHistogramChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping cached bars.
//    • Accessibility — the chart summary + per-bar VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

/// The en-dash band label used throughout (web `"{min}–{max}"`).
private func band(_ lo: Int, _ hi: Int) -> String {
    "\(lo)\u{2013}\(hi)"
}

// MARK: - Adapter: projection (speedHistData parity)

@MainActor final class SpeedHistogramChartProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testBarsMapInputsNullSafe() {
        let inputs = [
            SpeedHistogramBucketInput(range: band(0, 20), pct: 25),
            SpeedHistogramBucketInput(range: band(20, 40), pct: nil),
            SpeedHistogramBucketInput(range: band(40, 60), pct: 50)
        ]
        let bars = SpeedHistogramChartProjection.bars(from: inputs)
        XCTAssertEqual(bars.map(\.index), [0, 1, 2])
        XCTAssertEqual(bars.map(\.range), [band(0, 20), band(20, 40), band(40, 60)])
        XCTAssertEqual(bars.map(\.pct), [25, 0, 50]) // nil → 0
        XCTAssertEqual(bars[0].id, "0#\(band(0, 20))")
    }

    func testBucketsReproduceWebBucketing() {
        let speeds: [Double] = [10, 30, 50, 70, 90, 110, 130]
        let buckets = SpeedHistogramChartProjection.buckets(fromSamples: speeds, locale: posix)
        XCTAssertEqual(
            buckets.map(\.range),
            [band(0, 20), band(20, 40), band(40, 60), band(60, 80), band(80, 100), band(100, 120), "120+"]
        )
        // Each band holds one of seven samples → round(100/7) = 14.
        XCTAssertEqual(buckets.compactMap(\.pct), [14, 14, 14, 14, 14, 14, 14])
    }

    func testBucketsFilterEmptyBandsAndRound() {
        let speeds: [Double] = [10, 10, 50] // 2 in 0–20, 1 in 40–60
        let buckets = SpeedHistogramChartProjection.buckets(fromSamples: speeds, locale: posix)
        XCTAssertEqual(buckets.map(\.range), [band(0, 20), band(40, 60)])
        // 2/3 → round(66.67) = 67 ; 1/3 → round(33.33) = 33.
        XCTAssertEqual(buckets.compactMap(\.pct), [67, 33])
    }

    func testBucketsBoundaryInclusiveLowerExclusiveUpper() {
        // 0 → 0–20 ; 20 → 20–40 (not 0–20) ; 120 → "120+".
        let speeds: [Double] = [0, 20, 120]
        let buckets = SpeedHistogramChartProjection.buckets(fromSamples: speeds, locale: posix)
        XCTAssertEqual(buckets.map(\.range), [band(0, 20), band(20, 40), "120+"])
        XCTAssertEqual(buckets.compactMap(\.pct), [33, 33, 33])
    }

    func testBucketsDivideByFullSampleCount() {
        // Out-of-range samples are counted in no band but still inflate the denominator
        // (web `count / chartData.length`).
        let speeds: [Double] = [50, 50, 10000]
        let buckets = SpeedHistogramChartProjection.buckets(fromSamples: speeds, locale: posix)
        XCTAssertEqual(buckets.map(\.range), [band(40, 60)])
        XCTAssertEqual(buckets.first?.pct, 67) // 2/3 → round(66.67)
    }

    func testBucketsEmptyForNoSamples() {
        XCTAssertTrue(SpeedHistogramChartProjection.buckets(fromSamples: [], locale: posix).isEmpty)
    }

    func testRangeLabel() {
        XCTAssertEqual(SpeedHistogramChartProjection.rangeLabel(min: 20, max: 40, locale: posix), band(20, 40))
        XCTAssertEqual(SpeedHistogramChartProjection.rangeLabel(min: 120, max: 9999, locale: posix), "120+")
    }

    func testResolvePhase() {
        XCTAssertEqual(SpeedHistogramChartProjection.resolvePhase(.loading, hasBars: false), .loading)
        XCTAssertEqual(SpeedHistogramChartProjection.resolvePhase(.loaded, hasBars: true), .content)
        XCTAssertEqual(SpeedHistogramChartProjection.resolvePhase(.loaded, hasBars: false), .empty)
        XCTAssertEqual(SpeedHistogramChartProjection.resolvePhase(.failed("boom"), hasBars: true), .error("boom"))
    }

    func testTotalPct() {
        let bars = SpeedHistogramChartProjection.bars(from: [
            SpeedHistogramBucketInput(range: band(0, 20), pct: 30),
            SpeedHistogramBucketInput(range: band(20, 40), pct: 70)
        ])
        XCTAssertEqual(SpeedHistogramChartProjection.totalPct(bars), 100, accuracy: 0.0001)
    }

    func testModalBarReturnsFirstMaxOnTie() {
        let bars = [
            SpeedHistogramBar(index: 0, range: band(0, 20), pct: 40),
            SpeedHistogramBar(index: 1, range: band(20, 40), pct: 40),
            SpeedHistogramBar(index: 2, range: band(40, 60), pct: 20)
        ]
        XCTAssertEqual(SpeedHistogramChartProjection.modalBar(bars)?.range, band(0, 20))
        XCTAssertNil(SpeedHistogramChartProjection.modalBar([]))
    }

    func testFormatting() {
        XCTAssertEqual(SpeedHistogramChartProjection.intString(38, locale: posix), "38")
        XCTAssertEqual(SpeedHistogramChartProjection.percentString(38, locale: posix), "38%")
        XCTAssertEqual(SpeedHistogramChartProjection.decimalString(42.857, decimals: 1, locale: posix), "42.9")
        let enUS = Locale(identifier: "en_US")
        XCTAssertEqual(SpeedHistogramChartProjection.intString(1234, locale: enUS), "1,234")
    }

    func testSeriesNameComposesOfDriveTail() {
        let echo: (String, String) -> String = { _, fallback in fallback }
        XCTAssertEqual(SpeedHistogramChartProjection.seriesName(localize: echo), "% of drive")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SpeedHistogramSurface.slug, "SpeedHistogramChart")
    }
}

// MARK: - State holder: SpeedHistogramChartModel

@MainActor final class SpeedHistogramChartModelTests: XCTestCase {
    private func sampleBuckets() -> [SpeedHistogramBucketInput] {
        [
            SpeedHistogramBucketInput(range: band(0, 20), pct: 20),
            SpeedHistogramBucketInput(range: band(20, 40), pct: 50),
            SpeedHistogramBucketInput(range: band(40, 60), pct: 30)
        ]
    }

    private func makeModel(
        initial: SpeedHistogramChartUpdate?,
        telemetry: SpeedHistogramChartTelemetry = SpeedHistogramChartSpyTelemetry()
    ) -> (SpeedHistogramChartModel, SpeedHistogramChartInMemorySource) {
        let source = SpeedHistogramChartInMemorySource(initial: initial)
        let model = SpeedHistogramChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsBars() {
        let (model, source) = makeModel(
            initial: SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets())
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 3)
        XCTAssertEqual(model.bars.map(\.pct), [20, 50, 30])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SpeedHistogramChartUpdate(status: .loaded, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.bars.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SpeedHistogramChartUpdate(status: .loading, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SpeedHistogramChartUpdate(status: .failed("timeout"), buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpeedHistogramChartSpyTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SpeedHistogramSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .live))
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedBarsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SpeedHistogramChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SpeedHistogramChartUpdate(status: .failed("x"), buckets: []))
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
        // `SpeedHistogramChart` is `@MainActor` (SwiftUI `View`); read the slug here.
        XCTAssertEqual(SpeedHistogramChart.surfaceSlug, "SpeedHistogramChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class SpeedHistogramChartAccessibilityTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let bars = [
        SpeedHistogramBar(index: 0, range: band(0, 20), pct: 10),
        SpeedHistogramBar(index: 1, range: band(40, 60), pct: 60),
        SpeedHistogramBar(index: 2, range: band(80, 100), pct: 30)
    ]

    func testChartSummaryIncludesModalBand() {
        let summary = SpeedHistogramChartAccessibility.chartSummary(bars: bars, locale: posix, localize: echo)
        XCTAssertTrue(summary.contains("Speed Histogram"))
        XCTAssertTrue(summary.contains("3 speed buckets"))
        XCTAssertTrue(summary.contains("most in \(band(40, 60))"))
        XCTAssertTrue(summary.contains("60% of drive"))
    }

    func testChartSummaryEmpty() {
        let summary = SpeedHistogramChartAccessibility.chartSummary(bars: [], locale: posix, localize: echo)
        XCTAssertTrue(summary.contains("Speed Histogram"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testBarLabelCarriesColumnFigures() {
        let bar = SpeedHistogramBar(index: 1, range: band(40, 60), pct: 43)
        let label = SpeedHistogramChartAccessibility.barLabel(bar, locale: posix, localize: echo)
        XCTAssertEqual(label, "Speed range \(band(40, 60)): 43% of drive")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpeedHistogramChartSpyTelemetry: SpeedHistogramChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
