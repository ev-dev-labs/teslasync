//
//  TripReplayCharts.ModelTests.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  Pure-core coverage for the TripReplayCharts surface (the state-holder + per-state
//  coverage lives in TripReplayCharts.Tests.swift; split to honor the file-length
//  budget):
//    • Adapter (`TripReplayChartsProjection`) — point→sample indexing, the
//      `data.length > 0` content/empty threshold, phase resolution, the playhead
//      cursor-time / origin-index lookups, the dual-axis domains + rescale round-trip,
//      the evenly spaced ticks, and the `nearestIndexByTime` binary search (including its
//      web left-bias tie-break) — parity with the web `TripReplayCharts` body.
//    • Formatting (`TripReplayFormat`) — locale-aware axis / tooltip strings.
//    • Accessibility (`TripReplayChartsAccessibility`) — the chart summary + per-sample
//      VoiceOver value content.
//
//  Also home to the shared test fixtures + the telemetry spy reused by the state-holder
//  suite. Pure + bundle-free: the adapter has no network and no rendered view.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

enum TripReplayFixture {
    /// Four chronological samples; `originIndex` is offset from the plot position so a
    /// seek that reports the origin index can be told apart from one reporting position.
    static let points: [TripReplayPoint] = [
        TripReplayPoint(originIndex: 5, time: 0, speed: 0, power: 0),
        TripReplayPoint(originIndex: 15, time: 1, speed: 30, power: 60),
        TripReplayPoint(originIndex: 25, time: 2, speed: 55, power: 40),
        TripReplayPoint(originIndex: 35, time: 3, speed: 12, power: -25)
    ]

    static var samples: [TripReplaySample] {
        TripReplayChartsProjection.samples(from: points)
    }
}

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTripReplayChartsTelemetry: TripReplayChartsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

// MARK: - Adapter: projection (web TripReplayCharts body parity)

@MainActor final class TripReplayChartsProjectionTests: XCTestCase {
    func testSamplesPreserveOrderAndCarryOriginIndex() {
        let samples = TripReplayFixture.samples
        XCTAssertEqual(samples.map(\.position), [0, 1, 2, 3])
        XCTAssertEqual(samples.map(\.originIndex), [5, 15, 25, 35])
        XCTAssertEqual(samples.map(\.time), [0, 1, 2, 3])
        XCTAssertEqual(samples.map(\.id), samples.map(\.position))
    }

    func testHasTraceMirrorsLengthGreaterThanZero() {
        // Web `data.length > 0`: 0 samples is empty; 1+ renders the area chart.
        let single = TripReplayChartsProjection.samples(from: [TripReplayFixture.points[0]])
        XCTAssertFalse(TripReplayChartsProjection.hasTrace([]))
        XCTAssertTrue(TripReplayChartsProjection.hasTrace(single))
        XCTAssertTrue(TripReplayChartsProjection.hasTrace(TripReplayFixture.samples))
    }

    func testResolvePhase() {
        XCTAssertEqual(TripReplayChartsProjection.resolvePhase(.loading, hasTrace: false), .loading)
        XCTAssertEqual(TripReplayChartsProjection.resolvePhase(.loaded, hasTrace: true), .content)
        XCTAssertEqual(TripReplayChartsProjection.resolvePhase(.loaded, hasTrace: false), .empty)
        XCTAssertEqual(TripReplayChartsProjection.resolvePhase(.failed("boom"), hasTrace: true), .error("boom"))
    }

    func testClampPosition() {
        XCTAssertEqual(TripReplayChartsProjection.clampPosition(2, count: 4), 2)
        XCTAssertEqual(TripReplayChartsProjection.clampPosition(-3, count: 4), 0)
        XCTAssertEqual(TripReplayChartsProjection.clampPosition(99, count: 4), 3)
        XCTAssertNil(TripReplayChartsProjection.clampPosition(0, count: 0))
    }

    func testCursorTimeAndOriginIndexForPosition() {
        let samples = TripReplayFixture.samples
        XCTAssertEqual(TripReplayChartsProjection.cursorTime(forPosition: 2, in: samples), 2)
        XCTAssertNil(TripReplayChartsProjection.cursorTime(forPosition: 9, in: samples))
        XCTAssertEqual(TripReplayChartsProjection.originIndex(forPosition: 2, in: samples), 25)
        XCTAssertNil(TripReplayChartsProjection.originIndex(forPosition: -1, in: samples))
    }

    func testNearestIndexByTimeSnapsToClosestSample() {
        let samples = TripReplayChartsProjection.samples(from: [
            TripReplayPoint(originIndex: 0, time: 0, speed: 0, power: 0),
            TripReplayPoint(originIndex: 1, time: 2, speed: 0, power: 0),
            TripReplayPoint(originIndex: 2, time: 4, speed: 0, power: 0)
        ])
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, 0.9), 0)
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, 1.1), 1)
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, 5), 2)
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, -1), 0)
    }

    func testNearestIndexByTimeTieBreakMatchesWebRightBias() {
        // Web strict `<` tie-break: an exactly-equidistant target resolves to the right
        // (higher) sample, not the left one.
        let samples = TripReplayChartsProjection.samples(from: [
            TripReplayPoint(originIndex: 0, time: 0, speed: 0, power: 0),
            TripReplayPoint(originIndex: 1, time: 2, speed: 0, power: 0),
            TripReplayPoint(originIndex: 2, time: 4, speed: 0, power: 0)
        ])
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, 1), 1)
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime(samples, 3), 2)
    }

    func testNearestIndexByTimeEmptyReturnsZero() {
        XCTAssertEqual(TripReplayChartsProjection.nearestIndexByTime([], 5), 0)
    }

    func testDualAxisDomains() {
        let samples = TripReplayFixture.samples
        XCTAssertEqual(TripReplayChartsProjection.timeDomain(samples), 0 ... 3)
        // Speed clamps the lower bound to a 0 baseline.
        XCTAssertEqual(TripReplayChartsProjection.speedDomain(samples), 0 ... 55)
        // Power always spans 0 so regen reads against a zero baseline (min -25, max 60).
        XCTAssertEqual(TripReplayChartsProjection.powerDomain(samples), -25 ... 60)
    }

    func testDomainsAreNilWhenEmpty() {
        XCTAssertNil(TripReplayChartsProjection.timeDomain([]))
        XCTAssertNil(TripReplayChartsProjection.speedDomain([]))
        XCTAssertNil(TripReplayChartsProjection.powerDomain([]))
    }

    func testRescaleRoundTripsThroughInverse() {
        let power = -50.0 ... 150.0
        let primary = 0.0 ... 80.0
        let plotted = TripReplayChartsProjection.rescale(power: 50, from: power, onto: primary)
        let back = TripReplayChartsProjection.power(forPlotted: plotted, primary: primary, power: power)
        XCTAssertEqual(back, 50, accuracy: 0.0001)
        // Endpoints map to the primary bounds.
        XCTAssertEqual(TripReplayChartsProjection.rescale(power: -50, from: power, onto: primary), 0, accuracy: 0.0001)
        XCTAssertEqual(TripReplayChartsProjection.rescale(power: 150, from: power, onto: primary), 80, accuracy: 0.0001)
    }

    func testEvenlySpacedValues() {
        XCTAssertEqual(TripReplayChartsProjection.evenlySpacedValues(in: 0 ... 8, count: 5), [0, 2, 4, 6, 8])
        XCTAssertEqual(TripReplayChartsProjection.evenlySpacedValues(in: 4 ... 4, count: 5), [4])
    }

    func testSampleAtPosition() {
        let samples = TripReplayFixture.samples
        XCTAssertEqual(TripReplayChartsProjection.sample(at: 1, in: samples)?.originIndex, 15)
        XCTAssertNil(TripReplayChartsProjection.sample(at: nil, in: samples))
        XCTAssertNil(TripReplayChartsProjection.sample(at: 9, in: samples))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TripReplaySurface.slug, "TripReplayCharts")
        XCTAssertEqual(TripReplayCharts.surfaceSlug, "TripReplayCharts")
    }
}

// MARK: - Formatting

@MainActor final class TripReplayFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testMinutesAxisLabelIsWholeMinutesWithSuffix() {
        XCTAssertEqual(TripReplayFormat.minutesAxisLabel(5, locale: posix), "5m")
        XCTAssertEqual(TripReplayFormat.minutesAxisLabel(12.6, locale: posix), "13m")
    }

    func testMinutesTooltipIsOneDecimalMin() {
        XCTAssertEqual(TripReplayFormat.minutesTooltip(2.5, locale: posix), "2.5 min")
    }

    func testSpeedAndPowerCarryUnits() {
        XCTAssertEqual(TripReplayFormat.speed(56, unit: "mph", locale: posix), "56.0 mph")
        XCTAssertEqual(TripReplayFormat.power(-12.5, locale: posix), "-12.5 kW")
    }

    func testNonFiniteIsEmDash() {
        XCTAssertEqual(TripReplayFormat.number(.nan, fractionDigits: 1, locale: posix), "—")
        XCTAssertEqual(TripReplayFormat.number(.infinity, fractionDigits: 0, locale: posix), "—")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class TripReplayChartsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    func testChartSummaryIncludesSpansAndCount() {
        let summary = TripReplayChartsAccessibility.chartSummary(
            samples: TripReplayFixture.samples,
            speedUnit: "mph",
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("Speed & Power Timeline"))
        XCTAssertTrue(summary.contains("4 samples"))
        XCTAssertTrue(summary.contains("Speed 0.0 mph – 55.0 mph"))
        XCTAssertTrue(summary.contains("Power -25.0 kW – 60.0 kW"))
    }

    func testChartSummaryEmptyUsesNoTelemetryFallback() {
        let summary = TripReplayChartsAccessibility.chartSummary(
            samples: [],
            speedUnit: "mph",
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("Speed & Power Timeline"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testSampleValue() {
        let sample = TripReplayFixture.samples[1]
        let value = TripReplayChartsAccessibility.sampleValue(sample, speedUnit: "mph", localize: echo, locale: posix)
        XCTAssertEqual(value, "1.0 min: Speed 30.0 mph, Power 60.0 kW")
    }
}
