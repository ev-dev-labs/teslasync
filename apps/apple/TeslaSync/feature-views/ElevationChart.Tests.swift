//
//  ElevationChart.Tests.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  Unit coverage for the ElevationChart surface:
//    • Adapter (`ElevationProjection`) — SI→unit speed conversion (km/h + mph),
//      the elevGain / elevLoss / net reduction, the `chartData.length > 1` phase
//      threshold, axis domains + the speed→elevation projection, and locale-aware
//      formatting.
//    • State holder (`ElevationChartModel`) — phase across loading / loaded / empty
//      / failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once + re-arm), offline keeping the cached trace, retry / stop,
//      speed-unit + precision propagation, and the synced-cursor read/write.
//    • Accessibility — the chart summary + per-sample cursor value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (ElevationChart parity)

@MainActor
final class ElevationProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private func samples() -> [ElevationSample] {
        [
            ElevationSample(index: 0, time: "09:00", elevationM: 100, speedMps: 0),
            ElevationSample(index: 1, time: "09:05", elevationM: 120, speedMps: 10),
            ElevationSample(index: 2, time: "09:10", elevationM: 90, speedMps: 20),
            ElevationSample(index: 3, time: "09:15", elevationM: 140, speedMps: 5)
        ]
    }

    func testPointsConvertSpeedToKmh() {
        let points = ElevationProjection.points(from: samples(), speedUnit: .kmh)
        XCTAssertEqual(points.map(\.index), [0, 1, 2, 3])
        XCTAssertEqual(points[0].speedDisplay, 0, accuracy: 0.0001)
        XCTAssertEqual(points[1].speedDisplay, 36, accuracy: 0.0001)
        XCTAssertEqual(points[2].speedDisplay, 72, accuracy: 0.0001)
        // Elevation passes through untouched (meters).
        XCTAssertEqual(points[3].elevationM, 140, accuracy: 0.0001)
    }

    func testPointsConvertSpeedToMph() {
        let points = ElevationProjection.points(from: samples(), speedUnit: .mph)
        XCTAssertEqual(points[1].speedDisplay, 22.369362920544, accuracy: 0.0001)
        XCTAssertEqual(points[2].speedDisplay, 44.738725841088, accuracy: 0.0001)
    }

    func testStatsGainLossNet() {
        // diffs: +20 (gain), -30 (loss), +50 (gain) → gain 70, loss 30, net 40.
        let stats = ElevationProjection.stats(from: samples())
        XCTAssertEqual(stats.gainM, 70, accuracy: 0.0001)
        XCTAssertEqual(stats.lossM, 30, accuracy: 0.0001)
        XCTAssertEqual(stats.netM, 40, accuracy: 0.0001)
    }

    func testStatsMonotonic() {
        let up = [
            ElevationSample(index: 0, time: "a", elevationM: 10, speedMps: 0),
            ElevationSample(index: 1, time: "b", elevationM: 35, speedMps: 0),
            ElevationSample(index: 2, time: "c", elevationM: 60, speedMps: 0)
        ]
        let upStats = ElevationProjection.stats(from: up)
        XCTAssertEqual(upStats.gainM, 50, accuracy: 0.0001)
        XCTAssertEqual(upStats.lossM, 0, accuracy: 0.0001)
        let down = up.reversed().enumerated().map { index, sample in
            ElevationSample(index: index, time: sample.time, elevationM: sample.elevationM, speedMps: 0)
        }
        let downStats = ElevationProjection.stats(from: down)
        XCTAssertEqual(downStats.gainM, 0, accuracy: 0.0001)
        XCTAssertEqual(downStats.lossM, 50, accuracy: 0.0001)
    }

    func testStatsZeroForUnderTwoSamples() {
        XCTAssertEqual(ElevationProjection.stats(from: []).gainM, 0)
        let one = [ElevationSample(index: 0, time: "a", elevationM: 10, speedMps: 1)]
        let stats = ElevationProjection.stats(from: one)
        XCTAssertEqual(stats.gainM, 0)
        XCTAssertEqual(stats.lossM, 0)
    }

    func testResolvePhaseMirrorsLengthThreshold() {
        XCTAssertEqual(ElevationProjection.resolvePhase(.loading, sampleCount: 0), .loading)
        XCTAssertEqual(ElevationProjection.resolvePhase(.failed("boom"), sampleCount: 5), .error("boom"))
        // web `chartData.length > 1`: 0 and 1 are empty, 2+ is content.
        XCTAssertEqual(ElevationProjection.resolvePhase(.loaded, sampleCount: 0), .empty)
        XCTAssertEqual(ElevationProjection.resolvePhase(.loaded, sampleCount: 1), .empty)
        XCTAssertEqual(ElevationProjection.resolvePhase(.loaded, sampleCount: 2), .content)
    }

    func testHasTrace() {
        XCTAssertFalse(ElevationProjection.hasTrace(sampleCount: 1))
        XCTAssertTrue(ElevationProjection.hasTrace(sampleCount: 2))
    }

    func testElevationDomainPadsRange() {
        let points = ElevationProjection.points(from: samples(), speedUnit: .kmh)
        let domain = ElevationProjection.elevationDomain(points)
        // min 90, max 140, pad = 50 * 0.08 = 4 → 86 ... 144.
        XCTAssertEqual(domain.lowerBound, 86, accuracy: 0.0001)
        XCTAssertEqual(domain.upperBound, 144, accuracy: 0.0001)
    }

    func testElevationDomainFlatTrace() {
        let flat = [
            ElevationPoint(index: 0, time: "a", elevationM: 50, speedDisplay: 0),
            ElevationPoint(index: 1, time: "b", elevationM: 50, speedDisplay: 0)
        ]
        let domain = ElevationProjection.elevationDomain(flat)
        XCTAssertEqual(domain.lowerBound, 49, accuracy: 0.0001)
        XCTAssertEqual(domain.upperBound, 51, accuracy: 0.0001)
    }

    func testSpeedDomainFloorsAtZero() {
        let points = ElevationProjection.points(from: samples(), speedUnit: .kmh)
        let domain = ElevationProjection.speedDomain(points)
        XCTAssertEqual(domain.lowerBound, 0, accuracy: 0.0001)
        // max 72, pad = 72 * 0.08 = 5.76 → upper 77.76.
        XCTAssertEqual(domain.upperBound, 77.76, accuracy: 0.0001)
    }

    func testProjectSpeedToElevationMapsEndpoints() {
        let elev = 86.0 ... 144.0
        let speed = 0.0 ... 80.0
        XCTAssertEqual(
            ElevationProjection.projectSpeedToElevation(0, speedDomain: speed, elevationDomain: elev),
            86,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            ElevationProjection.projectSpeedToElevation(80, speedDomain: speed, elevationDomain: elev),
            144,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            ElevationProjection.projectSpeedToElevation(40, speedDomain: speed, elevationDomain: elev),
            115,
            accuracy: 0.0001
        )
    }

    func testProjectSpeedToElevationDegenerateSpeedDomain() {
        let elev = 10.0 ... 20.0
        let speed = 5.0 ... 5.0
        XCTAssertEqual(
            ElevationProjection.projectSpeedToElevation(5, speedDomain: speed, elevationDomain: elev),
            10,
            accuracy: 0.0001
        )
    }

    func testFormatting() {
        XCTAssertEqual(ElevationProjection.decimalString(40.0, decimals: 2, locale: posix), "40.00")
        XCTAssertEqual(ElevationProjection.decimalString(48.567, decimals: 1, locale: posix), "48.6")
        XCTAssertEqual(ElevationProjection.intString(70.0, locale: posix), "70")
        let enUS = Locale(identifier: "en_US")
        XCTAssertEqual(ElevationProjection.intString(1234.0, locale: enUS), "1,234")
    }

    func testSpeedUnitConvert() {
        XCTAssertEqual(SpeedUnit.kmh.convert(mps: 10), 36, accuracy: 0.0001)
        XCTAssertEqual(SpeedUnit.mph.convert(mps: 10), 22.369362920544, accuracy: 0.0001)
        XCTAssertEqual(SpeedUnit.kmh.label, "km/h")
        XCTAssertEqual(SpeedUnit.mph.label, "mph")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ElevationSurface.slug, "ElevationChart")
    }
}

// MARK: - State holder: ElevationChartModel

@MainActor
final class ElevationChartModelTests: XCTestCase {
    private func sampleData() -> [ElevationSample] {
        [
            ElevationSample(index: 0, time: "09:00", elevationM: 100, speedMps: 0),
            ElevationSample(index: 1, time: "09:05", elevationM: 130, speedMps: 10),
            ElevationSample(index: 2, time: "09:10", elevationM: 95, speedMps: 20)
        ]
    }

    private func makeModel(
        initial: ElevationUpdate?,
        cursor: ElevationCursorSync = InMemoryElevationCursorSync(),
        telemetry: ElevationChartTelemetry = SpyElevationTelemetry()
    ) -> (ElevationChartModel, InMemoryElevationSource) {
        let source = InMemoryElevationSource(initial: initial)
        let model = ElevationChartModel(source: source, cursor: cursor, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsPointsStatsAndUnits() {
        let (model, source) = makeModel(
            initial: ElevationUpdate(status: .loaded, samples: sampleData(), speedUnit: .mph, precision: 1)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(model.speedUnit, .mph)
        XCTAssertEqual(model.precision, 1)
        // gain 30, loss 35, net -5.
        XCTAssertEqual(model.stats.gainM, 30, accuracy: 0.0001)
        XCTAssertEqual(model.stats.lossM, 35, accuracy: 0.0001)
        XCTAssertEqual(model.stats.netM, -5, accuracy: 0.0001)
        XCTAssertEqual(source.startCount, 1)
    }

    func testSingleSampleResolvesEmpty() {
        let one = [ElevationSample(index: 0, time: "09:00", elevationM: 100, speedMps: 0)]
        let (model, _) = makeModel(initial: ElevationUpdate(status: .loaded, samples: one))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: ElevationUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: ElevationUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyElevationTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ElevationSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .stale))
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .stale))
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .live))
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(ElevationUpdate(status: .loaded, samples: sampleData(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: ElevationUpdate(status: .failed("x"), samples: []))
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

    func testCursorWriteSetsSharedAndLocalIndex() {
        let cursor = InMemoryElevationCursorSync()
        let (model, _) = makeModel(
            initial: ElevationUpdate(status: .loaded, samples: sampleData()),
            cursor: cursor
        )
        model.start()
        model.updateCursor(to: 1)
        XCTAssertEqual(cursor.lastIndex, 1)
        XCTAssertEqual(model.cursorIndex, 1)
        XCTAssertEqual(model.cursorPoint?.index, 1)
    }

    func testCursorIgnoresOutOfRangeIndex() {
        let (model, _) = makeModel(initial: ElevationUpdate(status: .loaded, samples: sampleData()))
        model.start()
        model.updateCursor(to: 99)
        XCTAssertNil(model.cursorIndex)
        model.updateCursor(to: nil)
        XCTAssertNil(model.cursorIndex)
    }

    func testExternalCursorMoveReflectsSyncedReferenceLine() {
        let cursor = InMemoryElevationCursorSync()
        let (model, _) = makeModel(
            initial: ElevationUpdate(status: .loaded, samples: sampleData()),
            cursor: cursor
        )
        model.start()
        // A sibling chart broadcasts a hover; this surface's reference line follows.
        cursor.moveCursor(to: 2)
        XCTAssertEqual(model.cursorIndex, 2)
    }

    func testSurfaceSlugOnView() {
        XCTAssertEqual(ElevationChart.surfaceSlug, "ElevationChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor
final class ElevationAccessibilityTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func points() -> [ElevationPoint] {
        [
            ElevationPoint(index: 0, time: "09:00", elevationM: 100, speedDisplay: 0),
            ElevationPoint(index: 1, time: "09:05", elevationM: 150, speedDisplay: 80),
            ElevationPoint(index: 2, time: "09:10", elevationM: 110, speedDisplay: 40)
        ]
    }

    func testChartSummaryIncludesGainLossNetAndSpeed() {
        let stats = ElevationStats(gainM: 50, lossM: 40)
        let summary = ElevationAccessibility.chartSummary(
            points: points(),
            stats: stats,
            speedUnit: .kmh,
            locale: posix,
            localize: echo
        )
        XCTAssertTrue(summary.contains("Elevation Profile"))
        XCTAssertTrue(summary.contains("50 meters gain"))
        XCTAssertTrue(summary.contains("40 meters loss"))
        XCTAssertTrue(summary.contains("Net 10 meters"))
        XCTAssertTrue(summary.contains("up to 80 km/h"))
    }

    func testChartSummaryEmpty() {
        let summary = ElevationAccessibility.chartSummary(
            points: [],
            stats: ElevationStats(gainM: 0, lossM: 0),
            speedUnit: .mph,
            locale: posix,
            localize: echo
        )
        XCTAssertTrue(summary.contains("Elevation Profile"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testCursorLabelCarriesSampleFigures() {
        let label = ElevationAccessibility.cursorLabel(
            points()[1],
            speedUnit: .mph,
            locale: posix,
            localize: echo
        )
        XCTAssertEqual(label, "09:05: Elevation 150 meters, Speed 80 mph")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyElevationTelemetry: ElevationChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
