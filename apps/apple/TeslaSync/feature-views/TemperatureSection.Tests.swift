//
//  TemperatureSection.Tests.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  Unit coverage for the TemperatureSection surface:
//    • Adapter (`TempSectionProjector`) — SI→display conversion, per-series presence
//      + averaging, the climate-status rollup, the fan summary, the stat-tile order,
//      the content/empty gate, and phase resolution (parity with the web
//      `chartData` / `stats` derivation + the `chartData.length > 1 &&
//      stats.hasAnyTemp` gate).
//    • Formatting (`TempSectionFormat`) — locale decimal / int / plain / unit strings.
//    • State holder (`TemperatureSectionModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping the cached trace.
//    • Accessibility — the chart summary content (present series + averages).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion

final class TempSectionConversionTests: XCTestCase {
    func testCelsiusPassesThrough() {
        XCTAssertEqual(convertTempSectionFromSI(0, to: .celsius), 0, accuracy: 0.0001)
        XCTAssertEqual(convertTempSectionFromSI(21.5, to: .celsius), 21.5, accuracy: 0.0001)
        XCTAssertEqual(convertTempSectionFromSI(-12, to: .celsius), -12, accuracy: 0.0001)
    }

    func testFahrenheitMatchesFormula() {
        XCTAssertEqual(convertTempSectionFromSI(0, to: .fahrenheit), 32, accuracy: 0.0001)
        XCTAssertEqual(convertTempSectionFromSI(100, to: .fahrenheit), 212, accuracy: 0.0001)
        XCTAssertEqual(convertTempSectionFromSI(-40, to: .fahrenheit), -40, accuracy: 0.0001)
        XCTAssertEqual(convertTempSectionFromSI(37, to: .fahrenheit), 98.6, accuracy: 0.0001)
    }

    func testUnitFromSymbol() {
        XCTAssertEqual(TempSectionUnit.from(symbol: "°C"), .celsius)
        XCTAssertEqual(TempSectionUnit.from(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(TempSectionUnit.from(symbol: "garbage"), .celsius)
        XCTAssertEqual(TempSectionUnit.celsius.symbol, "°C")
        XCTAssertEqual(TempSectionUnit.fahrenheit.symbol, "°F")
    }
}

// MARK: - Adapter: projection (web chartData/stats parity)

final class TempSectionProjectorTests: XCTestCase {
    private let samples: [TempSectionSample] = [
        TempSectionSample(time: "08:00", outsideC: 10, insideC: 20, driverC: 21, climateOn: true, fanStatus: 2),
        TempSectionSample(time: "08:10", outsideC: 20, insideC: 22, driverC: 23, climateOn: true, fanStatus: 4),
        TempSectionSample(time: "08:20", insideC: 24, climateOn: false, fanStatus: 6)
    ]

    func testPresentSeriesAndOrder() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.presentSeries, [.outside, .inside, .driver])
        XCTAssertTrue(projection.hasAnyTemp)
    }

    func testAveragesPerSeries() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.average(for: .outside) ?? .nan, 15, accuracy: 0.0001)
        XCTAssertEqual(projection.average(for: .inside) ?? .nan, 22, accuracy: 0.0001)
        XCTAssertEqual(projection.average(for: .driver) ?? .nan, 22, accuracy: 0.0001)
        XCTAssertNil(projection.average(for: .passenger))
    }

    func testFahrenheitConvertsPointsAndAverages() {
        let projection = TempSectionProjector.project(samples: samples, unit: .fahrenheit)
        XCTAssertEqual(projection.points.first?.outside ?? .nan, 50, accuracy: 0.0001)
        XCTAssertEqual(projection.average(for: .outside) ?? .nan, 59, accuracy: 0.0001)
        XCTAssertEqual(projection.unitSymbol, "°F")
    }

    func testPointValueForSeries() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.points[0].value(for: .inside) ?? .nan, 20, accuracy: 0.0001)
        XCTAssertNil(projection.points[2].value(for: .outside))
        XCTAssertNil(projection.points[2].value(for: .driver))
    }

    func testFanSummary() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.avgFan ?? .nan, 4, accuracy: 0.0001)
        XCTAssertEqual(projection.maxFan ?? .nan, 6, accuracy: 0.0001)
    }

    func testTileKindsOrderAndPresence() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        XCTAssertEqual(projection.tileKinds, [.outside, .inside, .driver, .climate, .fan])
    }

    func testContentGateRequiresMoreThanOnePoint() {
        let single = [TempSectionSample(time: "08:00", outsideC: 10, insideC: 20)]
        let projection = TempSectionProjector.project(samples: single, unit: .celsius)
        XCTAssertTrue(projection.hasAnyTemp)
        XCTAssertFalse(projection.hasContent, "web gate is chartData.length > 1")
    }

    func testNoTemperaturesIsEmptyButKeepsClimateFanTiles() {
        let climateOnly = [
            TempSectionSample(time: "08:00", climateOn: true, fanStatus: 3),
            TempSectionSample(time: "08:10", climateOn: false, fanStatus: 5)
        ]
        let projection = TempSectionProjector.project(samples: climateOnly, unit: .celsius)
        XCTAssertFalse(projection.hasAnyTemp)
        XCTAssertFalse(projection.hasContent)
        XCTAssertTrue(projection.presentSeries.isEmpty)
        XCTAssertEqual(projection.tileKinds, [.climate, .fan])
    }

    func testEmptySamplesProduceEmptyProjection() {
        let projection = TempSectionProjector.project(samples: [], unit: .celsius)
        XCTAssertEqual(projection.pointCount, 0)
        XCTAssertFalse(projection.hasContent)
        XCTAssertTrue(projection.tileKinds.isEmpty)
    }
}

// MARK: - Adapter: climate rollup (web stats.climateStatus)

final class TempSectionClimateTests: XCTestCase {
    func testClimateStatusBranches() {
        XCTAssertEqual(TempSectionProjector.climateStatus(onCount: 2, offCount: 1), .on)
        XCTAssertEqual(TempSectionProjector.climateStatus(onCount: 3, offCount: 3), .on)
        XCTAssertEqual(TempSectionProjector.climateStatus(onCount: 1, offCount: 4), .mostlyOff)
        XCTAssertEqual(TempSectionProjector.climateStatus(onCount: 0, offCount: 2), .off)
        XCTAssertNil(TempSectionProjector.climateStatus(onCount: 0, offCount: 0))
    }

    func testClimateOnGate() {
        XCTAssertTrue(TempSectionClimate.on.isOn)
        XCTAssertFalse(TempSectionClimate.mostlyOff.isOn)
        XCTAssertFalse(TempSectionClimate.off.isOn)
    }

    func testMeanHelper() {
        XCTAssertEqual(TempSectionProjector.mean([]), 0, accuracy: 0.0001)
        XCTAssertEqual(TempSectionProjector.mean([10, 20, 30]), 20, accuracy: 0.0001)
        XCTAssertEqual(TempSectionProjector.mean([21.5]), 21.5, accuracy: 0.0001)
    }
}

// MARK: - Adapter: phase resolution

final class TempSectionPhaseTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(TempSectionProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(TempSectionProjector.resolvePhase(.loading, hasContent: true), .content)
        XCTAssertEqual(TempSectionProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(TempSectionProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(TempSectionProjector.resolvePhase(.failed("boom"), hasContent: false), .error("boom"))
        XCTAssertEqual(TempSectionProjector.resolvePhase(.failed("boom"), hasContent: true), .content)
    }
}

// MARK: - Formatting

final class TempSectionFormatTests: XCTestCase {
    private let posix = "en_US_POSIX"

    func testNumberFixedTwoDecimals() {
        XCTAssertEqual(TempSectionFormat.number(15, localeIdentifier: posix), "15.00")
        XCTAssertEqual(TempSectionFormat.number(21.5, localeIdentifier: posix), "21.50")
        XCTAssertEqual(TempSectionFormat.number(-3.456, localeIdentifier: posix), "-3.46")
    }

    func testIntDropsFraction() {
        XCTAssertEqual(TempSectionFormat.int(4, localeIdentifier: posix), "4")
        XCTAssertEqual(TempSectionFormat.int(4.7, localeIdentifier: posix), "5")
    }

    func testPlainHasNoGrouping() {
        XCTAssertEqual(TempSectionFormat.plain(6, localeIdentifier: posix), "6")
        XCTAssertEqual(TempSectionFormat.plain(1234, localeIdentifier: posix), "1234")
        XCTAssertEqual(TempSectionFormat.plain(7.5, localeIdentifier: posix), "7.5")
    }

    func testTemperatureAppendsSymbolNoSpace() {
        XCTAssertEqual(TempSectionFormat.temperature(15, symbol: "°C", localeIdentifier: posix), "15.00°C")
        XCTAssertEqual(TempSectionFormat.temperature(59, symbol: "°F", localeIdentifier: posix), "59.00°F")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(TempSectionFormat.number(.nan, localeIdentifier: posix), "0.00")
        XCTAssertEqual(TempSectionFormat.plain(.infinity, localeIdentifier: posix), "0")
    }
}

// MARK: - State holder: TemperatureSectionModel

@MainActor
final class TemperatureSectionModelTests: XCTestCase {
    private let samples: [TempSectionSample] = [
        TempSectionSample(time: "08:00", outsideC: 10, insideC: 20, climateOn: true, fanStatus: 2),
        TempSectionSample(time: "08:10", outsideC: 20, insideC: 22, climateOn: true, fanStatus: 4)
    ]

    private func makeModel(
        initial: TempSectionUpdate?,
        telemetry: TempSectionTelemetry = SpyTempSectionTelemetry()
    ) -> (TemperatureSectionModel, InMemoryTempSectionSource) {
        let source = InMemoryTempSectionSource(initial: initial)
        let model = TemperatureSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        _ samples: [TempSectionSample],
        connection: TempSectionConnection = .live
    ) -> TempSectionUpdate {
        TempSectionUpdate(status: .loaded, samples: samples, connection: connection)
    }

    func testLoadedContentProjects() {
        let (model, source) = makeModel(initial: loaded(samples))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.pointCount, 2)
        XCTAssertEqual(model.projection.presentSeries, [.outside, .inside])
        XCTAssertEqual(model.projection.average(for: .outside) ?? .nan, 15, accuracy: 0.0001)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: loaded([]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection.pointCount, 0)
    }

    func testSinglePointResolvesEmptyPhase() {
        let single = [TempSectionSample(time: "08:00", outsideC: 10, insideC: 20)]
        let (model, _) = makeModel(initial: loaded(single))
        model.start()
        XCTAssertEqual(model.phase, .empty, "content gate requires more than one sample")
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TempSectionUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TempSectionUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTempSectionTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TempSectionSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .stale))
        source.push(loaded(samples, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .stale))
        source.push(loaded(samples, connection: .live))
        source.push(loaded(samples, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.pointCount, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TempSectionUpdate(status: .failed("x"), samples: []))
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

    func testUnitPreferenceFromUpdateAppliesToProjection() {
        let update = TempSectionUpdate(status: .loaded, samples: samples, unit: .fahrenheit)
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.projection.unitSymbol, "°F")
        XCTAssertEqual(model.projection.average(for: .outside) ?? .nan, 59, accuracy: 0.0001)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TempSectionSurface.slug, "TemperatureSection")
        XCTAssertEqual(TemperatureSection.surfaceSlug, "TemperatureSection")
    }
}

// MARK: - Accessibility: VoiceOver summary

final class TempSectionAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = "en_US_POSIX"

    private let samples: [TempSectionSample] = [
        TempSectionSample(time: "08:00", outsideC: 10, insideC: 20),
        TempSectionSample(time: "08:10", outsideC: 20, insideC: 22)
    ]

    func testChartSummaryIncludesPresentSeriesAverages() {
        let projection = TempSectionProjector.project(samples: samples, unit: .celsius)
        let summary = TempSectionAccessibility.chartSummary(
            projection: projection,
            localize: echo,
            localeIdentifier: posix
        )
        XCTAssertTrue(summary.contains("Temperatures"))
        XCTAssertTrue(summary.contains("Outside 15.00 °C"))
        XCTAssertTrue(summary.contains("Inside 21.00 °C"))
    }

    func testChartSummaryEmpty() {
        let projection = TempSectionProjector.project(samples: [], unit: .celsius)
        let summary = TempSectionAccessibility.chartSummary(
            projection: projection,
            localize: echo,
            localeIdentifier: posix
        )
        XCTAssertTrue(summary.contains("Temperatures"))
        XCTAssertTrue(summary.contains("No temperature telemetry is available for this drive."))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTempSectionTelemetry: TempSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
