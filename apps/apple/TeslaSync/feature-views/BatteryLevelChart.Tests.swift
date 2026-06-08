//
//  BatteryLevelChart.Tests.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  Unit coverage for the BatteryLevelChart surface:
//    • Adapter (`BatteryLevelBuilder`) — decile labels, the `min(floor(soc/10), 9)`
//      bucketing (with null-safe clamping of out-of-range levels), the ten-bucket
//      distribution, and the projection totals / hasData / peak (parity with the
//      web `computeStartLevelDist` consumer).
//    • State holder (`BatteryLevelChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping cached bars.
//    • Accessibility — the chart summary + per-bar VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (computeStartLevelDist consumer parity)

final class BatteryLevelBuilderTests: XCTestCase {
    func testRangeLabelsMatchWebDeciles() {
        XCTAssertEqual(BatteryLevelBuilder.rangeLabel(forIndex: 0), "0-10%")
        XCTAssertEqual(BatteryLevelBuilder.rangeLabel(forIndex: 4), "40-50%")
        XCTAssertEqual(BatteryLevelBuilder.rangeLabel(forIndex: 9), "90-100%")
    }

    func testBucketIndexMirrorsFloorDivideClamp() {
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 0), 0)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 5), 0)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 10), 1)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 15), 1)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 95), 9)
        // Web `Math.min(floor(100/10), 9)` lands a full charge start in the last decile.
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 100), 9)
    }

    func testBucketIndexClampsOutOfRangeLevels() {
        // Negative / non-finite levels would index out of range in JS; native clamps
        // them safely (valid 0–100 levels are unaffected). Out-of-range-high finite
        // levels clamp to the last decile; negative / non-finite clamp to the first.
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: -5), 0)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: 130), 9)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: .nan), 0)
        XCTAssertEqual(BatteryLevelBuilder.bucketIndex(forSoc: .infinity), 0)
    }

    func testDistributionSeedsTenBucketsAndTallies() {
        let sessions = [5.0, 15, 25, 95, 100].map(BatteryStartLevelSession.init(startSocPct:))
        let buckets = BatteryLevelBuilder.distribution(sessions)
        XCTAssertEqual(buckets.count, 10)
        XCTAssertEqual(buckets.map(\.range).first, "0-10%")
        XCTAssertEqual(buckets.map(\.range).last, "90-100%")
        XCTAssertEqual(buckets[0].count, 1)
        XCTAssertEqual(buckets[1].count, 1)
        XCTAssertEqual(buckets[2].count, 1)
        XCTAssertEqual(buckets[9].count, 2)
        XCTAssertEqual(buckets[5].count, 0)
    }

    func testDistributionOfNoSessionsIsAllZero() {
        let buckets = BatteryLevelBuilder.distribution([])
        XCTAssertEqual(buckets.count, 10)
        XCTAssertTrue(buckets.map(\.count).allSatisfy { $0 == 0 })
    }

    func testProjectDerivesTotalsHasDataAndPeak() {
        let sessions = [5.0, 15, 25, 95, 100].map(BatteryStartLevelSession.init(startSocPct:))
        let projection = BatteryLevelBuilder.project(sessions)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.totalSessions, 5)
        XCTAssertEqual(projection.buckets.count, 10)
        XCTAssertEqual(projection.peakRange, "90-100%")
    }

    func testProjectEmptyHasNoDataAndNilPeak() {
        let projection = BatteryLevelBuilder.project([])
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.totalSessions, 0)
        XCTAssertNil(projection.peakRange)
        XCTAssertEqual(projection.buckets.count, 10)
    }

    func testResolvePhase() {
        XCTAssertEqual(BatteryLevelBuilder.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(BatteryLevelBuilder.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(BatteryLevelBuilder.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(BatteryLevelBuilder.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BatteryLevelSurface.slug, "BatteryLevelChart")
    }
}

// MARK: - State holder: BatteryLevelChartModel

@MainActor
final class BatteryLevelChartModelTests: XCTestCase {
    private func makeModel(
        initial: BatteryLevelUpdate?,
        telemetry: BatteryLevelChartTelemetry = SpyBatteryLevelTelemetry()
    ) -> (BatteryLevelChartModel, InMemoryBatteryLevelSource) {
        let source = InMemoryBatteryLevelSource(initial: initial)
        let model = BatteryLevelChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let sampleSessions = [12.0, 22, 33, 41, 58].map(BatteryStartLevelSession.init(startSocPct:))

    func testLoadedContentProjectsBuckets() {
        let (model, source) = makeModel(initial: BatteryLevelUpdate(status: .loaded, sessions: sampleSessions))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.buckets.count, 10)
        XCTAssertEqual(model.projection.totalSessions, 5)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: BatteryLevelUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: BatteryLevelUpdate(status: .loading, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: BatteryLevelUpdate(status: .failed("timeout"), sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyBatteryLevelTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryLevelSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .stale))
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .stale))
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .live))
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedBarsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryLevelUpdate(status: .loaded, sessions: sampleSessions, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.totalSessions, 5)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: BatteryLevelUpdate(status: .failed("x"), sessions: []))
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

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(BatteryLevelChart.surfaceSlug, "BatteryLevelChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class BatteryLevelAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testChartSummaryIncludesTotalsAndPeak() {
        let sessions = [5.0, 15, 25, 95, 100].map(BatteryStartLevelSession.init(startSocPct:))
        let projection = BatteryLevelBuilder.project(sessions)
        let summary = BatteryLevelAccessibility.chartSummary(projection: projection, localize: echo)
        XCTAssertTrue(summary.contains("Battery Level at Charge Start"))
        XCTAssertTrue(summary.contains("5 sessions"))
        XCTAssertTrue(summary.contains("10 ranges"))
        XCTAssertTrue(summary.contains("most common 90-100%"))
    }

    func testChartSummaryEmpty() {
        let summary = BatteryLevelAccessibility.chartSummary(
            projection: BatteryLevelBuilder.project([]),
            localize: echo
        )
        XCTAssertTrue(summary.contains("Battery Level at Charge Start"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testBarValue() {
        let bucket = BatteryStartLevelBucket(range: "40-50%", count: 7)
        XCTAssertEqual(BatteryLevelAccessibility.barValue(bucket, localize: echo), "40-50%: 7 sessions")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyBatteryLevelTelemetry: BatteryLevelChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
