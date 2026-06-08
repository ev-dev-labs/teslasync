//
//  DrivingTemperatureStats.Tests.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  Unit coverage for the DrivingTemperatureStats surface:
//    • Adapter (cached → projection) — `convertDrivingTempFromSI` (°C / °F), the chart-`safe`
//      guard, `DrivingTemperatureFormat.number`, the six-cell catalog + per-cell value
//      resolution (present group vs the em-dash), all parity with the web cell expression
//      `insideTemp ? fmtNumber(fromC(safe(x)), 1) : '—'`.
//    • State holder — `DrivingTemperatureStatsModel` phase resolution across loading / empty /
//      error / content, the unit-aware projection, the refresh delegation, the stale auto-
//      refresh (once per episode), the connection/fetching tracking, and the P1/S11
//      `view.opened` telemetry.
//    • Accessibility — the VoiceOver cell summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDrivingTemperatureSource`. String assertions check
//  the web English fallbacks (the per-surface table folds into the master catalog at
//  integration time, so it resolves to the `value:` fallback in the un-integrated bundle).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion / safe / formatting (web parity)

@MainActor final class DrivingTemperatureAdapterTests: XCTestCase {
    func testConvertCelsiusIsIdentity() {
        XCTAssertEqual(convertDrivingTempFromSI(21.5, to: .celsius), 21.5, accuracy: 0.0001)
        XCTAssertEqual(convertDrivingTempFromSI(-12.0, to: .celsius), -12.0, accuracy: 0.0001)
    }

    func testConvertFahrenheitMatchesWebFormula() {
        XCTAssertEqual(convertDrivingTempFromSI(0, to: .fahrenheit), 32, accuracy: 0.0001)
        XCTAssertEqual(convertDrivingTempFromSI(25, to: .fahrenheit), 77, accuracy: 0.0001)
        XCTAssertEqual(convertDrivingTempFromSI(-40, to: .fahrenheit), -40, accuracy: 0.0001)
    }

    func testSafeGuardCollapsesNonFinite() {
        XCTAssertEqual(driveTempSafe(21.5), 21.5, accuracy: 0.0001)
        XCTAssertEqual(driveTempSafe(nil), 0, accuracy: 0.0001)
        XCTAssertEqual(driveTempSafe(.nan), 0, accuracy: 0.0001)
        XCTAssertEqual(driveTempSafe(.infinity), 0, accuracy: 0.0001)
    }

    func testNumberFormattingFixedOneDecimal() {
        XCTAssertEqual(DrivingTemperatureFormat.number(21.4, decimals: 1, localeIdentifier: "en_US"), "21.4")
        XCTAssertEqual(DrivingTemperatureFormat.number(0, decimals: 1, localeIdentifier: "en_US"), "0.0")
        XCTAssertEqual(DrivingTemperatureFormat.number(-40, decimals: 1, localeIdentifier: "en_US"), "-40.0")
        // Half-away-from-zero rounding parity with Intl.NumberFormat halfExpand.
        XCTAssertEqual(DrivingTemperatureFormat.number(21.45, decimals: 1, localeIdentifier: "en_US"), "21.5")
    }

    func testUnitResolvesFromSymbol() {
        XCTAssertEqual(DrivingTemperatureUnit.from(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(DrivingTemperatureUnit.from(symbol: "°C"), .celsius)
        XCTAssertEqual(DrivingTemperatureUnit.from(symbol: "??"), .celsius)
    }
}

// MARK: - Adapter: projection + cell catalog (web grid)

@MainActor final class DrivingTemperatureProjectorTests: XCTestCase {
    private let locale = "en_US"

    func testProjectBothGroupsCelsius() {
        let stats = DrivingTemperatureStatsInput(
            inside: TemperatureTripleInput(min: 18.5, avg: 21.4, max: 24.8),
            outside: TemperatureTripleInput(min: 6.2, avg: 12.7, max: 19.3)
        )
        let projection = DrivingTemperatureProjector.project(stats: stats, unit: .celsius, localeIdentifier: locale)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.unitSymbol, "°C")
        XCTAssertEqual(projection.inside?.min, "18.5")
        XCTAssertEqual(projection.inside?.avg, "21.4")
        XCTAssertEqual(projection.inside?.max, "24.8")
        XCTAssertEqual(projection.outside?.min, "6.2")
        XCTAssertEqual(projection.outside?.max, "19.3")
    }

    func testProjectConvertsToFahrenheit() {
        let stats = DrivingTemperatureStatsInput(inside: TemperatureTripleInput(min: 0, avg: 25, max: 100))
        let projection = DrivingTemperatureProjector.project(stats: stats, unit: .fahrenheit, localeIdentifier: locale)
        XCTAssertEqual(projection.unitSymbol, "°F")
        XCTAssertEqual(projection.inside?.min, "32.0")
        XCTAssertEqual(projection.inside?.avg, "77.0")
        XCTAssertEqual(projection.inside?.max, "212.0")
    }

    func testAbsentComponentFormatsAsZero() {
        // A present group with a nil component renders the converted zero (web `safe(undefined)`).
        let stats = DrivingTemperatureStatsInput(inside: TemperatureTripleInput(min: nil, avg: 10, max: nil))
        let projection = DrivingTemperatureProjector.project(stats: stats, unit: .celsius, localeIdentifier: locale)
        XCTAssertEqual(projection.inside?.min, "0.0")
        XCTAssertEqual(projection.inside?.avg, "10.0")
        XCTAssertEqual(projection.inside?.max, "0.0")
    }

    func testAbsentGroupYieldsNilAndNoData() {
        let projection = DrivingTemperatureProjector.project(
            stats: DrivingTemperatureStatsInput(),
            unit: .celsius,
            localeIdentifier: locale
        )
        XCTAssertNil(projection.inside)
        XCTAssertNil(projection.outside)
        XCTAssertFalse(projection.hasData)
    }

    func testHasDataWhenEitherGroupPresent() {
        let insideOnly = DrivingTemperatureProjector.project(
            stats: DrivingTemperatureStatsInput(inside: TemperatureTripleInput(min: 1)),
            unit: .celsius, localeIdentifier: locale
        )
        let outsideOnly = DrivingTemperatureProjector.project(
            stats: DrivingTemperatureStatsInput(outside: TemperatureTripleInput(min: 1)),
            unit: .celsius, localeIdentifier: locale
        )
        XCTAssertTrue(insideOnly.hasData)
        XCTAssertNil(insideOnly.outside)
        XCTAssertTrue(outsideOnly.hasData)
        XCTAssertNil(outsideOnly.inside)
    }

    func testTileCatalogOrderAndColors() {
        let tiles = DrivingTemperatureProjector.tiles
        XCTAssertEqual(tiles.count, 6)
        XCTAssertEqual(
            tiles.map(\.id),
            ["insideMin", "insideAvg", "insideMax", "outsideMin", "outsideAvg", "outsideMax"]
        )
        XCTAssertEqual(tiles.map(\.color), [.cyan, .green, .amber, .cyan, .green, .amber])
        XCTAssertEqual(tiles.prefix(3).map(\.group), [.inside, .inside, .inside])
        XCTAssertEqual(tiles.suffix(3).map(\.group), [.outside, .outside, .outside])
        XCTAssertEqual(tiles.map(\.metric), [.min, .avg, .max, .min, .avg, .max])
    }

    func testValueResolvesPresentGroupAndEmDashForAbsent() {
        let stats = DrivingTemperatureStatsInput(inside: TemperatureTripleInput(min: 18.5, avg: 21.4, max: 24.8))
        let projection = DrivingTemperatureProjector.project(stats: stats, unit: .celsius, localeIdentifier: locale)
        let tiles = DrivingTemperatureProjector.tiles
        // Inside cells resolve to the formatted statistic.
        XCTAssertEqual(DrivingTemperatureProjector.value(for: tiles[0], in: projection), "18.5")
        XCTAssertEqual(DrivingTemperatureProjector.value(for: tiles[1], in: projection), "21.4")
        XCTAssertEqual(DrivingTemperatureProjector.value(for: tiles[2], in: projection), "24.8")
        // Outside group absent → every outside cell is the em-dash.
        XCTAssertEqual(
            DrivingTemperatureProjector.value(for: tiles[3], in: projection),
            DrivingTemperatureProjector.emDash
        )
        XCTAssertEqual(
            DrivingTemperatureProjector.value(for: tiles[4], in: projection),
            DrivingTemperatureProjector.emDash
        )
        XCTAssertEqual(
            DrivingTemperatureProjector.value(for: tiles[5], in: projection),
            DrivingTemperatureProjector.emDash
        )
    }
}

// MARK: - State holder: phases + projection + refresh + telemetry

@MainActor final class DrivingTemperatureModelTests: XCTestCase {
    private func makeModel(
        _ update: DrivingTemperatureUpdate,
        telemetry: DrivingTemperatureTelemetry = OSLogDrivingTemperatureTelemetry()
    ) -> (DrivingTemperatureStatsModel, InMemoryDrivingTemperatureSource) {
        let source = InMemoryDrivingTemperatureSource(initial: update)
        let model = DrivingTemperatureStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleStats() -> DrivingTemperatureStatsInput {
        DrivingTemperatureStatsInput(
            inside: TemperatureTripleInput(min: 18, avg: 21, max: 25),
            outside: TemperatureTripleInput(min: 5, avg: 12, max: 19)
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(DrivingTemperatureStatsModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: sampleStats()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
        XCTAssertEqual(model.projection?.hasData, true)
    }

    func testEmptyWhenStatsPresentButBothGroupsNil() {
        let (model, _) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: DrivingTemperatureStatsInput()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyWhenNoStats() {
        let (model, _) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testLoadingPhases() {
        let (loading, _) = makeModel(DrivingTemperatureUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (cached, _) = makeModel(DrivingTemperatureUpdate(status: .loading, stats: sampleStats()))
        cached.start()
        XCTAssertEqual(cached.phase, .content)
    }

    func testErrorPhaseAndCachedStaysContent() {
        let (failed, _) = makeModel(DrivingTemperatureUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))

        let (cached, source) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: sampleStats()))
        cached.start()
        source.push(DrivingTemperatureUpdate(status: .failed("net"), stats: sampleStats()))
        XCTAssertEqual(cached.phase, .content)
    }

    func testProjectionHonorsUnitPreference() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loading))
        model.start()
        source.push(
            DrivingTemperatureUpdate(
                status: .loaded,
                stats: DrivingTemperatureStatsInput(inside: TemperatureTripleInput(min: 0, avg: 25, max: 100)),
                units: DrivingTemperatureUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")
            )
        )
        XCTAssertEqual(model.projection?.unitSymbol, "°F")
        XCTAssertEqual(model.projection?.inside?.avg, "77.0")
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: sampleStats()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: sampleStats()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(DrivingTemperatureUpdate(status: .loaded, connection: .stale, stats: sampleStats()))
        source.push(DrivingTemperatureUpdate(status: .loaded, connection: .stale, stats: sampleStats()))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(DrivingTemperatureUpdate(status: .loaded, connection: .live, stats: sampleStats()))
        source.push(DrivingTemperatureUpdate(status: .loaded, connection: .stale, stats: sampleStats()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loaded, stats: sampleStats()))
        model.start()
        source.push(DrivingTemperatureUpdate(status: .loaded, connection: .offline, stats: sampleStats()))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loading))
        model.start()
        source.push(
            DrivingTemperatureUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                stats: sampleStats(),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDrivingTemperatureTelemetry()
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingTemperatureStats.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopDelegates() {
        let (model, source) = makeModel(DrivingTemperatureUpdate(status: .loading))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class DrivingTemperatureAccessibilityTests: XCTestCase {
    func testCellSummaryComposesLabelValueUnit() {
        let summary = DrivingTemperatureAccessibility.cellSummary(label: "Inside Min", value: "18.5", unit: "°C")
        XCTAssertEqual(summary, "Inside Min, 18.5 °C")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingTemperatureTelemetry: DrivingTemperatureTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
