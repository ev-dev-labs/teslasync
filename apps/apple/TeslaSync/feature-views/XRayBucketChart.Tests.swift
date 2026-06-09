//
//  XRayBucketChart.Tests.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  Unit coverage for the XRayBucketChart surface:
//    • Adapter (`XRayBucketChartProjection`) — the `buckets` → bars mapping (null-safe
//      count, ISO parse, unparseable-bucket drop preserving the source offset), phase
//      resolution, totals, the busiest bucket, the `formatTime` time label, and the
//      `fmtInt` sample-count formatting.
//    • State holder (`XRayBucketChartModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once), and offline keeping cached bars.
//    • Accessibility — the chart summary + per-bar VoiceOver label / value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let xrayUTC = TimeZone(identifier: "UTC") ?? .current
private let xrayEnGB = Locale(identifier: "en_GB")
private let xrayEnUS = Locale(identifier: "en_US")
/// 2023-11-14T22:13:20Z — the 2-digit en_GB time-of-day label is the deterministic "22:13".
private let xrayBase = Date(timeIntervalSince1970: 1_700_000_000)

private func xrayISO(_ offset: TimeInterval) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = xrayUTC
    return formatter.string(from: xrayBase.addingTimeInterval(offset))
}

// MARK: - Adapter: projection (series parity)

@MainActor final class XRayBucketChartProjectionTests: XCTestCase {
    func testBarsMapInputsNullSafe() {
        let inputs = [
            XRayBucketInput(bucketStart: xrayISO(0), count: 142),
            XRayBucketInput(bucketStart: xrayISO(30), count: nil),
            XRayBucketInput(bucketStart: xrayISO(60), count: 503)
        ]
        let bars = XRayBucketChartProjection.bars(from: inputs)
        XCTAssertEqual(bars.map(\.index), [0, 1, 2])
        XCTAssertEqual(bars.map(\.count), [142, 0, 503]) // nil → 0
        XCTAssertEqual(bars.map(\.bucketStart), [xrayISO(0), xrayISO(30), xrayISO(60)])
        XCTAssertEqual(bars[0].id, "0#\(xrayISO(0))")
        XCTAssertEqual(bars[0].timestamp, xrayBase)
    }

    func testBarsDropUnparseableBucketsPreservingOffset() {
        let inputs = [
            XRayBucketInput(bucketStart: xrayISO(0), count: 10),
            XRayBucketInput(bucketStart: "not-a-timestamp", count: 99),
            XRayBucketInput(bucketStart: xrayISO(60), count: 20)
        ]
        let bars = XRayBucketChartProjection.bars(from: inputs)
        // The malformed middle bucket is dropped; the surviving bars keep their source offset.
        XCTAssertEqual(bars.map(\.index), [0, 2])
        XCTAssertEqual(bars.map(\.count), [10, 20])
    }

    func testParseTimestampVariants() {
        XCTAssertNotNil(XRayBucketChartProjection.parseTimestamp("2026-06-07T19:30:00.123Z"))
        XCTAssertNotNil(XRayBucketChartProjection.parseTimestamp("2026-06-07T19:30:00Z"))
        XCTAssertNil(XRayBucketChartProjection.parseTimestamp("not-a-timestamp"))
    }

    func testResolvePhase() {
        XCTAssertEqual(XRayBucketChartProjection.resolvePhase(.loading, hasBars: false), .loading)
        XCTAssertEqual(XRayBucketChartProjection.resolvePhase(.loaded, hasBars: true), .content)
        XCTAssertEqual(XRayBucketChartProjection.resolvePhase(.loaded, hasBars: false), .empty)
        XCTAssertEqual(XRayBucketChartProjection.resolvePhase(.failed("boom"), hasBars: true), .error("boom"))
    }

    func testTotalCount() {
        let bars = XRayBucketChartProjection.bars(from: [
            XRayBucketInput(bucketStart: xrayISO(0), count: 30),
            XRayBucketInput(bucketStart: xrayISO(30), count: 70)
        ])
        XCTAssertEqual(XRayBucketChartProjection.totalCount(bars), 100)
    }

    func testPeakBarReturnsFirstMaxOnTie() {
        let bars = [
            XRayBucketBar(index: 0, bucketStart: xrayISO(0), timestamp: xrayBase, count: 60),
            XRayBucketBar(index: 1, bucketStart: xrayISO(30), timestamp: xrayBase.addingTimeInterval(30), count: 60),
            XRayBucketBar(index: 2, bucketStart: xrayISO(60), timestamp: xrayBase.addingTimeInterval(60), count: 20)
        ]
        XCTAssertEqual(XRayBucketChartProjection.peakBar(bars)?.index, 0)
        XCTAssertNil(XRayBucketChartProjection.peakBar([]))
    }

    func testTimeLabelMatchesFormatTime() {
        // formatTime `{ hour: '2-digit', minute: '2-digit' }` for a 24-hour locale.
        XCTAssertEqual(
            XRayBucketChartProjection.timeLabel(xrayBase, locale: xrayEnGB, timeZone: xrayUTC),
            "22:13"
        )
    }

    func testSampleCountTextGroupsEnUS() {
        XCTAssertEqual(XRayBucketChartProjection.sampleCountText(18234), "18,234")
        XCTAssertEqual(XRayBucketChartProjection.sampleCountText(0), "0")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(XRayBucketSurface.slug, "XRayBucketChart")
    }
}

// MARK: - State holder: XRayBucketChartModel

@MainActor final class XRayBucketChartModelTests: XCTestCase {
    private func sampleBuckets() -> [XRayBucketInput] {
        [
            XRayBucketInput(bucketStart: xrayISO(0), count: 100),
            XRayBucketInput(bucketStart: xrayISO(30), count: 250),
            XRayBucketInput(bucketStart: xrayISO(60), count: 175)
        ]
    }

    private func makeModel(
        initial: XRayBucketChartUpdate?,
        telemetry: XRayBucketChartTelemetry = XRayBucketChartSpyTelemetry()
    ) -> (XRayBucketChartModel, XRayBucketChartInMemorySource) {
        let source = XRayBucketChartInMemorySource(initial: initial)
        let model = XRayBucketChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsBars() {
        let (model, source) = makeModel(
            initial: XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets())
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 3)
        XCTAssertEqual(model.bars.map(\.count), [100, 250, 175])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: XRayBucketChartUpdate(status: .loaded, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.bars.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: XRayBucketChartUpdate(status: .loading, buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: XRayBucketChartUpdate(status: .failed("timeout"), buckets: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = XRayBucketChartSpyTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [XRayBucketSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .live))
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedBarsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(XRayBucketChartUpdate(status: .loaded, buckets: sampleBuckets(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: XRayBucketChartUpdate(status: .failed("x"), buckets: []))
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
        // `XRayBucketChart` is `@MainActor` (SwiftUI `View`); read the slug here.
        XCTAssertEqual(XRayBucketChart.surfaceSlug, "XRayBucketChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class XRayBucketChartAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let bars = [
        XRayBucketBar(index: 0, bucketStart: xrayISO(0), timestamp: xrayBase, count: 100),
        XRayBucketBar(index: 1, bucketStart: xrayISO(30), timestamp: xrayBase.addingTimeInterval(30), count: 250),
        XRayBucketBar(index: 2, bucketStart: xrayISO(60), timestamp: xrayBase.addingTimeInterval(60), count: 175)
    ]

    func testChartSummaryIncludesPeakBucket() {
        let summary = XRayBucketChartAccessibility.chartSummary(
            bars: bars,
            locale: xrayEnGB,
            timeZone: xrayUTC,
            localize: echo
        )
        XCTAssertTrue(summary.contains("Samples per bucket"))
        XCTAssertTrue(summary.contains("3 buckets"))
        XCTAssertTrue(summary.contains("busiest at 22:13"))
        XCTAssertTrue(summary.contains("250 samples"))
    }

    func testChartSummaryEmpty() {
        let summary = XRayBucketChartAccessibility.chartSummary(
            bars: [],
            locale: xrayEnGB,
            timeZone: xrayUTC,
            localize: echo
        )
        XCTAssertTrue(summary.contains("Samples per bucket"))
        XCTAssertTrue(summary.contains("No samples in this window"))
    }

    func testBarLabelCarriesColumnFigures() {
        let bar = XRayBucketBar(index: 0, bucketStart: xrayISO(0), timestamp: xrayBase, count: 1234)
        let label = XRayBucketChartAccessibility.barLabel(bar, locale: xrayEnGB, timeZone: xrayUTC, localize: echo)
        XCTAssertEqual(label, "Bucket 22:13: 1,234 samples")
    }

    func testBarValueCarriesTooltipCount() {
        let bar = XRayBucketBar(index: 0, bucketStart: xrayISO(0), timestamp: xrayBase, count: 1234)
        XCTAssertEqual(XRayBucketChartAccessibility.barValue(bar, localize: echo), "1,234 Samples")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class XRayBucketChartSpyTelemetry: XRayBucketChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
