//
//  PowerProfileChart.Tests.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  Unit coverage: the pure projection (the cached samples → footer stats reducer, the
//  zero-crossing y-domain, endpoint indices, phase `length > 1`), number formatting
//  (fmtNumber / fmtInt / kW helpers + non-finite → 0), the state holder (phase envelope,
//  derived-vs-explicit stats, `view.opened` once, stale auto-refresh + re-arm,
//  offline-cached, retry, stop, cursor clamp), and accessibility (chart summary + stats
//  VoiceOver value). No network, no bundle — the projection is pure; the model runs on an
//  in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum PowerFixture {
    static let enUS = Locale(identifier: "en_US")

    static func sample(_ index: Int, _ power: Double) -> PowerProfileSample {
        PowerProfileSample(index: index, time: String(format: "08:%02d", index), power: power)
    }

    /// A 4-sample trace mixing drive power and a regen dip (max 60, min -30, mean 15).
    static let trace: [PowerProfileSample] = [
        sample(0, 20), sample(1, 60), sample(2, -30), sample(3, 10)
    ]
}

// MARK: - Projection (the "cached → projection" adapter test)

final class PowerProfileProjectionTests: XCTestCase {
    func testStatsReducerMatchesWeb() {
        let stats = PowerProfileProjection.stats(from: PowerFixture.trace)
        XCTAssertEqual(stats.powerMax, 60, accuracy: 0.0001)
        XCTAssertEqual(stats.powerMin, -30, accuracy: 0.0001, "regen is the signed minimum")
        XCTAssertEqual(stats.avgPower, 15, accuracy: 0.0001)
    }

    func testStatsEmptyIsZero() {
        XCTAssertEqual(PowerProfileProjection.stats(from: []), .zero)
    }

    func testPowerDomainAlwaysIncludesZero() {
        let positive = PowerProfileProjection.powerDomain([PowerFixture.sample(0, 10), PowerFixture.sample(1, 60)])
        XCTAssertEqual(positive?.lowerBound, 0, "all-positive trace anchors the baseline at 0")
        XCTAssertEqual(positive?.upperBound, 60)

        let negative = PowerProfileProjection.powerDomain([PowerFixture.sample(0, -5), PowerFixture.sample(1, -20)])
        XCTAssertEqual(negative?.lowerBound, -20)
        XCTAssertEqual(negative?.upperBound, 0, "all-regen trace anchors the baseline at 0")
    }

    func testPowerDomainFlatTraceHasHeight() {
        let flat = PowerProfileProjection.powerDomain([PowerFixture.sample(0, 0), PowerFixture.sample(1, 0)])
        XCTAssertEqual(flat?.lowerBound, 0)
        XCTAssertEqual(flat?.upperBound, 1, "a flat trace still spans at least 1 kW")
        XCTAssertNil(PowerProfileProjection.powerDomain([]))
    }

    func testEndpointIndices() {
        XCTAssertEqual(PowerProfileProjection.endpointIndices(PowerFixture.trace), [0, 3])
        XCTAssertEqual(PowerProfileProjection.endpointIndices([PowerFixture.sample(7, 1)]), [7])
        XCTAssertEqual(PowerProfileProjection.endpointIndices([]), [])
    }

    func testResolvePhase() {
        XCTAssertEqual(PowerProfileProjection.resolvePhase(.loading, sampleCount: 0), .loading)
        XCTAssertEqual(PowerProfileProjection.resolvePhase(.failed("x"), sampleCount: 9), .error("x"))
        XCTAssertEqual(PowerProfileProjection.resolvePhase(.loaded, sampleCount: 0), .empty)
        XCTAssertEqual(PowerProfileProjection.resolvePhase(.loaded, sampleCount: 1), .empty)
        XCTAssertEqual(PowerProfileProjection.resolvePhase(.loaded, sampleCount: 2), .content)
    }
}

// MARK: - Number formatting

final class PowerNumberFormatTests: XCTestCase {
    private let enUS = PowerFixture.enUS

    func testNumberAndInt() {
        XCTAssertEqual(PowerNumberFormat.number(15, locale: enUS), "15.00")
        XCTAssertEqual(PowerNumberFormat.int(60, locale: enUS), "60")
        XCTAssertEqual(PowerNumberFormat.number(1234.5, locale: enUS), "1,234.50", "grouped thousands")
    }

    func testKilowattHelpers() {
        XCTAssertEqual(PowerNumberFormat.kilowattInt(-30, locale: enUS), "-30 kW")
        XCTAssertEqual(PowerNumberFormat.kilowatt(15, locale: enUS), "15.00 kW")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(PowerNumberFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(PowerNumberFormat.number(.nan, locale: enUS), "0.00")
    }
}

// MARK: - State holder

@MainActor
final class PowerProfileChartModelTests: XCTestCase {
    private func makeModel(
        initial: PowerProfileUpdate?,
        telemetry: PowerProfileTelemetry = SpyPowerProfileTelemetry()
    ) -> (PowerProfileChartModel, InMemoryPowerProfileSource) {
        let source = InMemoryPowerProfileSource(initial: initial)
        let model = PowerProfileChartModel(source: source, telemetry: telemetry, locale: PowerFixture.enUS)
        return (model, source)
    }

    private func loaded(
        _ samples: [PowerProfileSample],
        stats: PowerProfileStats? = nil,
        _ connection: PowerProfileConnection = .live
    ) -> PowerProfileUpdate {
        PowerProfileUpdate(status: .loaded, samples: samples, stats: stats, connection: connection)
    }

    func testLoadedContentDerivesStats() {
        let (model, source) = makeModel(initial: loaded(PowerFixture.trace))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.sampleCount, 4)
        XCTAssertEqual(model.stats.powerMax, 60, accuracy: 0.0001, "stats derived from samples when absent")
        XCTAssertEqual(model.stats.powerMin, -30, accuracy: 0.0001)
        XCTAssertEqual(source.startCount, 1)
    }

    func testExplicitStatsPreferredOverDerived() {
        let explicit = PowerProfileStats(powerMax: 99, powerMin: -88, avgPower: 7)
        let (model, _) = makeModel(initial: loaded(PowerFixture.trace, stats: explicit))
        model.start()
        XCTAssertEqual(model.stats, explicit, "the parent-supplied stats prop wins over the derived reducer")
    }

    func testSingleSampleResolvesEmpty() {
        let (model, _) = makeModel(initial: loaded([PowerFixture.trace[0]]))
        model.start()
        XCTAssertEqual(model.phase, .empty, "web renders the chart only when length > 1")
    }

    func testEmptyResolvesEmpty() {
        let (model, _) = makeModel(initial: loaded([]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.stats, .zero)
    }

    func testLoadingAndFailed() {
        let (loadingModel, _) = makeModel(initial: PowerProfileUpdate(status: .loading))
        loadingModel.start()
        XCTAssertEqual(loadingModel.phase, .loading)

        let (failedModel, _) = makeModel(initial: PowerProfileUpdate(status: .failed("timeout")))
        failedModel.start()
        XCTAssertEqual(failedModel.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyPowerProfileTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PowerProfileSurface.slug])
    }

    func testStaleAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(PowerFixture.trace, .stale))
        source.push(loaded(PowerFixture.trace, .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale → exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(PowerFixture.trace, .stale))
        source.push(loaded(PowerFixture.trace, .live))
        source.push(loaded(PowerFixture.trace, .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(PowerFixture.trace, .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.sampleCount, 4)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryAndStop() {
        let (model, source) = makeModel(initial: PowerProfileUpdate(status: .failed("x")))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCursorClampsToSampleRange() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.cursorIndex = 99
        source.push(loaded(PowerFixture.trace))
        XCTAssertEqual(model.cursorIndex, 3, "cursor clamps to the last sample index")
        source.push(loaded([]))
        XCTAssertNil(model.cursorIndex, "no samples → cursor cleared")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(PowerProfileChart.surfaceSlug, "PowerProfileChart")
    }
}

// MARK: - Accessibility

final class PowerProfileAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testChartSummaryIncludesCount() {
        let summary = PowerProfileAccessibility.chartSummary(samples: PowerFixture.trace, localize: echo)
        XCTAssertTrue(summary.contains("Power Profile"))
        XCTAssertTrue(summary.contains("4"))
        XCTAssertTrue(summary.contains("samples"))
    }

    func testChartSummaryEmpty() {
        let summary = PowerProfileAccessibility.chartSummary(samples: [PowerFixture.trace[0]], localize: echo)
        XCTAssertTrue(summary.contains("Power Profile"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testStatsSummary() {
        let stats = PowerProfileStats(powerMax: 60, powerMin: -30, avgPower: 15)
        let summary = PowerProfileAccessibility.statsSummary(stats, localize: echo, locale: PowerFixture.enUS)
        XCTAssertEqual(summary, "Max Power 60 kW, Max Regen -30 kW, Avg 15.00 kW")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyPowerProfileTelemetry: PowerProfileTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
