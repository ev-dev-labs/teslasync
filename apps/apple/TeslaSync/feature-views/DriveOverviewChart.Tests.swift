//
//  DriveOverviewChart.Tests.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  Unit coverage: the pure projection (presence guards, est/rated fallback, statFn +
//  SOC `battery > 0` rule, rich-legend formatting parity, dual-axis domains + rescale
//  round-trip + ticks, phase `length > 1`), number formatting (fmtNumber / fmtInt /
//  fmtPercent / fmtWithUnit + non-finite → 0), the state holder (phase envelope,
//  `view.opened` once, stale auto-refresh + re-arm, offline-cached, retry, stop, cursor
//  clamp), and accessibility (chart summary + per-legend VoiceOver value). No network,
//  no bundle — the projection is pure; the model runs on an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DriveFixture {
    static let enUS = Locale(identifier: "en_US")
    static let units = DriveUnitLabels(speed: "mph", distance: "mi")

    static func sample(
        _ index: Int,
        speed: Double,
        battery: Double,
        power: Double,
        ideal: Double? = nil,
        rated: Double? = nil,
        est: Double? = nil,
        usable: Double? = nil
    ) -> DriveChartSample {
        DriveChartSample(
            index: index,
            time: String(format: "08:%02d", index),
            speed: speed,
            battery: battery,
            power: power,
            idealRange: ideal,
            ratedRange: rated,
            estRange: est,
            usableSoc: usable
        )
    }

    /// A 3-sample trace with every optional series present.
    static let trace: [DriveChartSample] = [
        sample(0, speed: 10, battery: 80, power: 20, ideal: 200, rated: 190, est: 180, usable: 78),
        sample(1, speed: 30, battery: 78, power: 40, ideal: 190, rated: 180, est: 170, usable: 76),
        sample(2, speed: 20, battery: 76, power: -10, ideal: 180, rated: 170, est: 160, usable: 74)
    ]

    /// A 2-sample trace with only the always-on series (speed / SOC / power).
    static let bareTrace: [DriveChartSample] = [
        sample(0, speed: 12, battery: 60, power: 15),
        sample(1, speed: 24, battery: 58, power: 30)
    ]
}

// MARK: - Projection

final class DriveOverviewProjectionTests: XCTestCase {
    private let enUS = DriveFixture.enUS
    private let units = DriveFixture.units

    func testSeriesPresenceGuards() {
        let trace = DriveFixture.trace
        XCTAssertTrue(DriveOverviewProjection.hasIdealRange(trace))
        XCTAssertTrue(DriveOverviewProjection.hasEstOrRated(trace))
        XCTAssertTrue(DriveOverviewProjection.usesEstRange(trace))
        XCTAssertTrue(DriveOverviewProjection.hasUsableSoc(trace))

        let bare = DriveFixture.bareTrace
        XCTAssertFalse(DriveOverviewProjection.hasIdealRange(bare))
        XCTAssertFalse(DriveOverviewProjection.hasEstOrRated(bare))
        XCTAssertFalse(DriveOverviewProjection.hasUsableSoc(bare))
    }

    func testEstRatedFallback() {
        let ratedOnly = [
            DriveFixture.sample(0, speed: 5, battery: 50, power: 1, rated: 100),
            DriveFixture.sample(1, speed: 6, battery: 49, power: 1, rated: 90)
        ]
        XCTAssertTrue(DriveOverviewProjection.hasEstOrRated(ratedOnly))
        XCTAssertFalse(DriveOverviewProjection.usesEstRange(ratedOnly), "no estRange → falls back to ratedRange")
        XCTAssertEqual(ratedOnly[0].estOrRated, 100)
        XCTAssertEqual(DriveOverviewProjection.value(of: .estRange, at: ratedOnly[0]), 100)
    }

    func testPlottedKinds() {
        XCTAssertEqual(
            DriveOverviewProjection.plottedKinds(DriveFixture.trace),
            [.speed, .idealRange, .estRange, .soc, .usableSoc, .power]
        )
        XCTAssertEqual(DriveOverviewProjection.plottedKinds(DriveFixture.bareTrace), [.speed, .soc, .power])
        XCTAssertEqual(DriveOverviewProjection.plottedKinds([]), [])
    }

    func testStatBasics() {
        let stat = DriveOverviewProjection.stat([10, nil, 30, 20])
        XCTAssertEqual(stat?.mean ?? 0, 20, accuracy: 0.0001)
        XCTAssertEqual(stat?.max ?? 0, 30, accuracy: 0.0001)
        XCTAssertEqual(stat?.min ?? 0, 10, accuracy: 0.0001)
        XCTAssertNil(DriveOverviewProjection.stat([nil, nil]), "all-null → nil (web statFn returns null)")
    }

    func testSocStatUsesPositiveBatteryOnly() {
        let samples = [
            DriveFixture.sample(0, speed: 1, battery: 0, power: 0),
            DriveFixture.sample(1, speed: 1, battery: 50, power: 0),
            DriveFixture.sample(2, speed: 1, battery: 70, power: 0)
        ]
        let stat = DriveOverviewProjection.stat(for: .soc, in: samples)
        XCTAssertEqual(stat?.min ?? 0, 50, accuracy: 0.0001, "battery == 0 is excluded (web battery > 0 ? … : null)")
        XCTAssertEqual(stat?.max ?? 0, 70, accuracy: 0.0001)
    }

    func testLegendOrderAndFormattingParity() {
        let legend = DriveOverviewProjection.legend(for: DriveFixture.trace, units: units, locale: enUS)
        XCTAssertEqual(legend.map(\.kind), [.speed, .idealRange, .estRange, .soc, .usableSoc, .power])

        let speed = legend[0]
        XCTAssertEqual(speed.mean, "20.00 mph")
        XCTAssertEqual(speed.max, "30.00 mph")
        XCTAssertEqual(speed.min, "10 mph", "web uses fmtInt for the speed min only")

        let ideal = legend[1]
        XCTAssertEqual(ideal.mean, "190 mi")
        XCTAssertEqual(ideal.max, "200 mi")
        XCTAssertEqual(ideal.min, "180 mi")

        let est = legend[2]
        XCTAssertEqual(est.mean, "170 mi", "est uses estRange ?? ratedRange = [180,170,160]")

        XCTAssertEqual(legend[3].mean, "78.00%")
        XCTAssertEqual(legend[4].max, "78.00%")

        let power = legend[5]
        XCTAssertEqual(power.mean, "16.67 kW")
        XCTAssertEqual(power.max, "40.00 kW")
        XCTAssertEqual(power.min, "-10.00 kW")
    }

    func testLegendOmitsAbsentSeries() {
        let legend = DriveOverviewProjection.legend(for: DriveFixture.bareTrace, units: units, locale: enUS)
        XCTAssertEqual(legend.map(\.kind), [.speed, .soc, .power], "no ranges / usable SOC → omitted")
    }

    func testPrimaryAndPowerDomains() {
        let primary = DriveOverviewProjection.primaryDomain(DriveFixture.trace)
        XCTAssertEqual(primary?.lowerBound, 0, "lower clamped to ≤ 0 for the area baseline")
        XCTAssertEqual(primary?.upperBound, 200)

        let power = DriveOverviewProjection.powerDomain(DriveFixture.trace)
        XCTAssertEqual(power?.lowerBound, -10, "regen keeps the negative low")
        XCTAssertEqual(power?.upperBound, 40)

        XCTAssertNil(DriveOverviewProjection.primaryDomain([]))
        XCTAssertNil(DriveOverviewProjection.powerDomain([]))
    }

    func testRescaleRoundTrips() {
        let primary = 0.0 ... 200.0
        let power = -10.0 ... 40.0
        XCTAssertEqual(DriveOverviewProjection.rescale(power: -10, from: power, onto: primary), 0, accuracy: 0.0001)
        XCTAssertEqual(DriveOverviewProjection.rescale(power: 40, from: power, onto: primary), 200, accuracy: 0.0001)
        let plotted = DriveOverviewProjection.rescale(power: 15, from: power, onto: primary)
        XCTAssertEqual(plotted, 100, accuracy: 0.0001)
        let back = DriveOverviewProjection.power(forPlotted: plotted, primary: primary, power: power)
        XCTAssertEqual(back, 15, accuracy: 0.0001)
        XCTAssertEqual(DriveOverviewProjection.rescale(power: 5, from: 5 ... 5, onto: 0 ... 200), 0, "degenerate → low")
    }

    func testPowerAxisTicks() {
        let ticks = DriveOverviewProjection.powerAxisTicks(power: -10 ... 40, primary: 0 ... 200, count: 4)
        XCTAssertEqual(ticks.count, 4)
        XCTAssertEqual(ticks.first?.value ?? 0, -10, accuracy: 0.0001)
        XCTAssertEqual(ticks.last?.value ?? 0, 40, accuracy: 0.0001)
        XCTAssertEqual(ticks.first?.plotted ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(ticks.last?.plotted ?? -1, 200, accuracy: 0.0001)
        XCTAssertTrue(DriveOverviewProjection.powerAxisTicks(power: 5 ... 5, primary: 0 ... 1).isEmpty)
    }

    func testResolvePhaseUsesGreaterThanOne() {
        XCTAssertEqual(DriveOverviewProjection.resolvePhase(.loading, sampleCount: 0), .loading)
        XCTAssertEqual(DriveOverviewProjection.resolvePhase(.failed("boom"), sampleCount: 9), .error("boom"))
        XCTAssertEqual(DriveOverviewProjection.resolvePhase(.loaded, sampleCount: 2), .content)
        XCTAssertEqual(DriveOverviewProjection.resolvePhase(.loaded, sampleCount: 1), .empty, "web needs length > 1")
        XCTAssertEqual(DriveOverviewProjection.resolvePhase(.loaded, sampleCount: 0), .empty)
    }
}

// MARK: - Number formatting

final class DriveNumberFormatTests: XCTestCase {
    private let enUS = DriveFixture.enUS

    func testNumberAndInt() {
        XCTAssertEqual(DriveNumberFormat.number(62.5, locale: enUS), "62.50")
        XCTAssertEqual(DriveNumberFormat.int(5, locale: enUS), "5")
        XCTAssertEqual(DriveNumberFormat.int(12345.6, locale: enUS), "12,346", "grouped thousands like toLocaleString")
    }

    func testPercentAndWithUnit() {
        XCTAssertEqual(DriveNumberFormat.percent(84.5, locale: enUS), "84.50%")
        XCTAssertEqual(DriveNumberFormat.withUnit(42.567, unit: "kW", locale: enUS), "42.57 kW")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(DriveNumberFormat.number(.nan, locale: enUS), "0.00", "web safeNumber → 0")
        XCTAssertEqual(DriveNumberFormat.int(.infinity, locale: enUS), "0")
    }
}

// MARK: - Series identity + units

final class DriveSeriesKindTests: XCTestCase {
    func testHexAndDash() {
        XCTAssertEqual(DriveSeriesKind.speed.hex, "#3b82f6")
        XCTAssertEqual(DriveSeriesKind.power.hex, "#f59e0b")
        XCTAssertTrue(DriveSeriesKind.idealRange.dashed)
        XCTAssertTrue(DriveSeriesKind.estRange.dashed)
        XCTAssertFalse(DriveSeriesKind.speed.dashed)
    }

    func testLegendKeysPreserveWebParentheticals() {
        XCTAssertEqual(DriveSeriesKind.idealRange.localizationKey, "driveDetail.rangeIdeal")
        XCTAssertEqual(DriveSeriesKind.idealRange.legendKey, "driveDetail.rangeIdeal.legend")
        XCTAssertEqual(DriveSeriesKind.idealRange.legendFallback, "Range (ideal)")
        XCTAssertEqual(DriveSeriesKind.estRange.legendFallback, "Range (est.)")
        XCTAssertEqual(DriveSeriesKind.speed.legendKey, "driveDetail.speed", "non-range series reuse the source key")
    }

    func testUnitSuffix() {
        XCTAssertEqual(DriveSeriesKind.speed.unitSuffix, .speed)
        XCTAssertEqual(DriveSeriesKind.idealRange.unitSuffix, .distance)
        XCTAssertEqual(DriveSeriesKind.soc.unitSuffix, .percent)
        XCTAssertEqual(DriveSeriesKind.power.unitSuffix, .kilowatt)
    }

    func testUnitLabels() {
        XCTAssertEqual(DriveUnitLabels.of(.metric).speed, "km/h")
        XCTAssertEqual(DriveUnitLabels.of(.metric).distance, "km")
        XCTAssertEqual(DriveUnitLabels.of(.imperial).speed, "mph")
        XCTAssertEqual(DriveUnitLabels.of(.imperial).distance, "mi")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DriveOverviewSurface.slug, "DriveOverviewChart")
        XCTAssertEqual(DriveOverviewChart.surfaceSlug, "DriveOverviewChart")
    }
}

// MARK: - State holder

@MainActor
final class DriveOverviewChartModelTests: XCTestCase {
    private func makeModel(
        initial: DriveOverviewUpdate?,
        telemetry: DriveOverviewTelemetry = SpyDriveOverviewTelemetry()
    ) -> (DriveOverviewChartModel, InMemoryDriveOverviewSource) {
        let source = InMemoryDriveOverviewSource(initial: initial)
        let model = DriveOverviewChartModel(source: source, telemetry: telemetry, locale: DriveFixture.enUS)
        return (model, source)
    }

    private func loaded(
        _ samples: [DriveChartSample],
        _ connection: DriveOverviewConnection = .live
    ) -> DriveOverviewUpdate {
        DriveOverviewUpdate(status: .loaded, samples: samples, units: DriveFixture.units, connection: connection)
    }

    func testLoadedContentProjectsLegend() {
        let (model, source) = makeModel(initial: loaded(DriveFixture.trace))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.sampleCount, 3)
        XCTAssertEqual(model.legend.count, 6)
        XCTAssertEqual(model.units.speed, "mph")
        XCTAssertEqual(source.startCount, 1)
    }

    func testSingleSampleResolvesEmpty() {
        let (model, _) = makeModel(initial: loaded([DriveFixture.trace[0]]))
        model.start()
        XCTAssertEqual(model.phase, .empty, "web renders the chart only when length > 1")
    }

    func testEmptyResolvesEmpty() {
        let (model, _) = makeModel(initial: loaded([]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.legend.isEmpty)
    }

    func testLoadingAndFailed() {
        let (loadingModel, _) = makeModel(initial: DriveOverviewUpdate(status: .loading))
        loadingModel.start()
        XCTAssertEqual(loadingModel.phase, .loading)

        let (failedModel, _) = makeModel(initial: DriveOverviewUpdate(status: .failed("timeout")))
        failedModel.start()
        XCTAssertEqual(failedModel.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyDriveOverviewTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveOverviewSurface.slug])
    }

    func testStaleAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(DriveFixture.trace, .stale))
        source.push(loaded(DriveFixture.trace, .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale → exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(DriveFixture.trace, .stale))
        source.push(loaded(DriveFixture.trace, .live))
        source.push(loaded(DriveFixture.trace, .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(DriveFixture.trace, .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.sampleCount, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryAndStop() {
        let (model, source) = makeModel(initial: DriveOverviewUpdate(status: .failed("x")))
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
        source.push(loaded(DriveFixture.trace))
        XCTAssertEqual(model.cursorIndex, 2, "cursor clamps to the last sample index")
        source.push(loaded([]))
        XCTAssertNil(model.cursorIndex, "no samples → cursor cleared")
    }
}

// MARK: - Accessibility

final class DriveOverviewAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testChartSummaryIncludesCountAndSeries() {
        let summary = DriveOverviewAccessibility.chartSummary(samples: DriveFixture.trace, localize: echo)
        XCTAssertTrue(summary.contains("Drive Overview"))
        XCTAssertTrue(summary.contains("3 samples"))
        XCTAssertTrue(summary.contains("Speed"))
        XCTAssertTrue(summary.contains("Power"))
        XCTAssertTrue(summary.contains("Usable SOC"))
    }

    func testChartSummaryEmpty() {
        let summary = DriveOverviewAccessibility.chartSummary(samples: [DriveFixture.trace[0]], localize: echo)
        XCTAssertTrue(summary.contains("Drive Overview"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testLegendLabel() {
        let item = DriveLegendItem(kind: .speed, mean: "20.00 mph", max: "30.00 mph", min: "10 mph")
        let label = DriveOverviewAccessibility.legendLabel(item, localize: echo)
        XCTAssertEqual(label, "Speed: Mean 20.00 mph, Max 30.00 mph, Min 10 mph")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyDriveOverviewTelemetry: DriveOverviewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
