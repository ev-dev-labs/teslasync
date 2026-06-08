//
//  YearlyTrendChart.Tests.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  Unit coverage for the YearlyTrendChart surface:
//    • Adapter (cached → projection) — `YearlyTrendMath` guards (finite-or-zero,
//      one-decimal rounding), `YearlyTrendProjection.make` order/count/precision,
//      `hasAny` / `maxCount`, and the per-status phase resolution.
//    • State holder — `YearlyTrendChartModel` phase resolution across loading /
//      empty / error / content, cached-stays-content on failure, refresh
//      delegation, stale auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver value summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryYearlyTrendSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared sample payload

private func samplePoints() -> [YearlyTrendPointInput] {
    [
        YearlyTrendPointInput(year: "2021", avg10to80: 42.5, avg20to80: 31.2, count: 18),
        YearlyTrendPointInput(year: "2022", avg10to80: 39.8, avg20to80: 28.6, count: 44),
        YearlyTrendPointInput(year: "2023", avg10to80: 36.1, avg20to80: 26.9, count: 71)
    ]
}

// MARK: - Adapter: numeric guards

final class YearlyTrendMathTests: XCTestCase {
    func testSafeGuardsNonFinite() {
        XCTAssertEqual(YearlyTrendMath.safe(5), 5, accuracy: 1e-9)
        XCTAssertEqual(YearlyTrendMath.safe(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(YearlyTrendMath.safe(.infinity), 0, accuracy: 1e-9)
        XCTAssertEqual(YearlyTrendMath.safe(-.infinity), 0, accuracy: 1e-9)
    }

    func testRound1MatchesWebPrecision() {
        XCTAssertEqual(YearlyTrendMath.round1(42.49), 42.5, accuracy: 1e-9)
        XCTAssertEqual(YearlyTrendMath.round1(42.44), 42.4, accuracy: 1e-9)
        XCTAssertEqual(YearlyTrendMath.round1(0), 0, accuracy: 1e-9)
        // Idempotent for already-rounded input.
        XCTAssertEqual(YearlyTrendMath.round1(31.2), 31.2, accuracy: 1e-9)
    }
}

// MARK: - Adapter: projection (web chart `data`)

final class YearlyTrendProjectionTests: XCTestCase {
    func testEmptyProjectionForNilInput() {
        let projection = YearlyTrendProjection.make(from: nil)
        XCTAssertFalse(projection.hasAny)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertEqual(projection.maxCount, 0, accuracy: 1e-9)
    }

    func testEmptyProjectionForEmptyInput() {
        let projection = YearlyTrendProjection.make(from: [])
        XCTAssertFalse(projection.hasAny)
    }

    func testBarsPreserveOrderAndValues() {
        let projection = YearlyTrendProjection.make(from: samplePoints())
        XCTAssertEqual(projection.bars.map(\.year), ["2021", "2022", "2023"])
        XCTAssertEqual(projection.bars.map(\.id), ["2021", "2022", "2023"])
        XCTAssertEqual(projection.bars[0].avg10to80, 42.5, accuracy: 1e-9)
        XCTAssertEqual(projection.bars[1].avg20to80, 28.6, accuracy: 1e-9)
        XCTAssertEqual(projection.bars[2].count, 71, accuracy: 1e-9)
        XCTAssertTrue(projection.hasAny)
        XCTAssertEqual(projection.maxCount, 71, accuracy: 1e-9)
    }

    func testProjectionRoundsAveragesAndGuardsNonFinite() {
        let input = [
            YearlyTrendPointInput(year: "2024", avg10to80: 35.06, avg20to80: .nan, count: -4)
        ]
        let projection = YearlyTrendProjection.make(from: input)
        XCTAssertEqual(projection.bars[0].avg10to80, 35.1, accuracy: 1e-9)
        XCTAssertEqual(projection.bars[0].avg20to80, 0, accuracy: 1e-9)
        // Negative counts clamp to zero.
        XCTAssertEqual(projection.bars[0].count, 0, accuracy: 1e-9)
    }

    func testResolvePhaseMatrix() {
        let full = YearlyTrendProjection.make(from: samplePoints())
        let blank = YearlyTrendProjection.make(from: nil)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.loading, projection: blank), .loading)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.loading, projection: full), .content)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.empty, projection: blank), .empty)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.loaded, projection: blank), .empty)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.loaded, projection: full), .content)
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.failed("e"), projection: blank), .error("e"))
        XCTAssertEqual(YearlyTrendProjection.resolvePhase(.failed("e"), projection: full), .content)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class YearlyTrendChartModelTests: XCTestCase {
    private func makeModel(
        _ update: YearlyTrendUpdate,
        telemetry: YearlyTrendTelemetry = OSLogYearlyTrendTelemetry()
    ) -> (YearlyTrendChartModel, InMemoryYearlyTrendSource) {
        let source = InMemoryYearlyTrendSource(initial: update)
        let model = YearlyTrendChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(YearlyTrendUpdate(status: .loaded, points: samplePoints()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAny)
        XCTAssertEqual(model.projection.bars.count, 3)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(YearlyTrendUpdate(status: .loaded, points: []))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(YearlyTrendUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(YearlyTrendUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedChartStaysContentWhileFailing() {
        let (model, source) = makeModel(YearlyTrendUpdate(status: .loaded, points: samplePoints()))
        model.start()
        source.push(YearlyTrendUpdate(status: .failed("net"), points: nil))
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasAny)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(YearlyTrendUpdate(status: .loaded, points: samplePoints()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(YearlyTrendUpdate(status: .loaded, points: samplePoints()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(YearlyTrendUpdate(status: .loaded, points: samplePoints(), connection: .stale))
        source.push(YearlyTrendUpdate(status: .loaded, points: samplePoints(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(YearlyTrendUpdate(status: .loaded, points: samplePoints(), connection: .live))
        source.push(YearlyTrendUpdate(status: .loaded, points: samplePoints(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyYearlyTrendTelemetry()
        let (model, source) = makeModel(YearlyTrendUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [YearlyTrendSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(YearlyTrendUpdate(status: .loading))
        model.start()
        source.push(
            YearlyTrendUpdate(
                status: .loaded,
                points: samplePoints(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Accessibility summary

final class YearlyTrendAccessibilityTests: XCTestCase {
    func testSummary() {
        let bars = YearlyTrendProjection.make(from: samplePoints()).bars
        let summary = YearlyTrendAccessibility.summary(
            bars: bars,
            yearsNoun: "years",
            sessionsNoun: "sessions",
            emptyFallback: "No data"
        )
        XCTAssertEqual(summary, "3 years, 133 sessions")
    }

    func testSummaryEmptyFallback() {
        let summary = YearlyTrendAccessibility.summary(
            bars: [],
            yearsNoun: "years",
            sessionsNoun: "sessions",
            emptyFallback: "No data"
        )
        XCTAssertEqual(summary, "No data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyYearlyTrendTelemetry: YearlyTrendTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
