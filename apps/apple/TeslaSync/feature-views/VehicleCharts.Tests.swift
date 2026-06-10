//
//  VehicleCharts.Tests.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  Adapter + projection + formatting + units coverage for the VehicleCharts
//  surface (the tile/label coverage lives in `VehicleCharts.TilesTests`, the
//  model/state-holder coverage in `VehicleCharts.ModelTests`). Each test ports a
//  web computation or branch. These run in the TeslaSync(/-macOS) XCTest targets —
//  no network, no real store, no rendered view.
//

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Numeric guards (web JS truthiness vs `!= null`)

@MainActor final class VehicleChartsNumericTests: XCTestCase {
    func testTruthyCoordinateDropsZeroNaNAndNil() {
        XCTAssertTrue(VehicleChartsNumeric.isTruthyCoordinate(37.77))
        XCTAssertTrue(VehicleChartsNumeric.isTruthyCoordinate(-122.42))
        XCTAssertFalse(VehicleChartsNumeric.isTruthyCoordinate(0))
        XCTAssertFalse(VehicleChartsNumeric.isTruthyCoordinate(nil))
        XCTAssertFalse(VehicleChartsNumeric.isTruthyCoordinate(.nan))
        XCTAssertFalse(VehicleChartsNumeric.isTruthyCoordinate(.infinity))
    }

    func testFiniteNumberKeepsZeroButDropsNaNAndNil() {
        XCTAssertTrue(VehicleChartsNumeric.isFiniteNumber(0))
        XCTAssertTrue(VehicleChartsNumeric.isFiniteNumber(29.1))
        XCTAssertFalse(VehicleChartsNumeric.isFiniteNumber(nil))
        XCTAssertFalse(VehicleChartsNumeric.isFiniteNumber(.nan))
    }
}

// MARK: - cleanNil + parseSettingEnum ports

@MainActor final class VehicleChartsAdapterTests: XCTestCase {
    func testCleanNilStripsSentinelsAndBlanks() {
        XCTAssertEqual(VehicleChartsCleanNil.clean("Model Y"), "Model Y")
        XCTAssertNil(VehicleChartsCleanNil.clean(nil))
        XCTAssertNil(VehicleChartsCleanNil.clean(""))
        XCTAssertNil(VehicleChartsCleanNil.clean("<nil>"))
        XCTAssertNil(VehicleChartsCleanNil.clean("nil"))
        XCTAssertNil(VehicleChartsCleanNil.clean("null"))
    }

    func testParseSettingEnumMapsEachCategory() {
        XCTAssertEqual(VehicleChartsSettingEnum.parse("DistanceUnitMiles", category: .distance), .miles)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("km", category: .distance), .kilometers)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("TemperatureUnitCelsius", category: .temperature), .celsius)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("ChargeUnitPercent", category: .charge), .percent)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("PressureUnitPsi", category: .pressure), .psi)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("PressureUnitKpa", category: .pressure), .kpa)
    }

    func testParseSettingEnumRawAndMissingFallbacks() {
        XCTAssertEqual(VehicleChartsSettingEnum.parse("Weird Value", category: .distance), .raw("Weird Value"))
        XCTAssertEqual(VehicleChartsSettingEnum.parse(nil, category: .distance), .missing)
        XCTAssertEqual(VehicleChartsSettingEnum.parse("", category: .charge), .missing)
    }

    func testStateCurrentCoordinateGuardsTruthiness() {
        XCTAssertNotNil(VehicleChartsStateRecord(latitude: 37.4, longitude: -122.0).currentCoordinate)
        XCTAssertNil(VehicleChartsStateRecord(latitude: 0, longitude: -122.0).currentCoordinate)
        XCTAssertNil(VehicleChartsStateRecord(latitude: 37.4, longitude: 0).currentCoordinate)
    }

    func testPositionIsPlottableAndCoordinate() {
        let plottable = VehicleChartsPositionRecord(id: 1, latitude: 37.4, longitude: -122.0)
        XCTAssertTrue(plottable.isPlottable)
        XCTAssertNotNil(plottable.coordinate)
        XCTAssertFalse(VehicleChartsPositionRecord(id: 2, latitude: 0, longitude: -122.0).isPlottable)
        XCTAssertNil(VehicleChartsPositionRecord(id: 3, latitude: .nan, longitude: -122.0).coordinate)
    }
}

// MARK: - Projection (port of the web `trail` + `batteryData` + section guards)

@MainActor final class VehicleChartsProjectionTests: XCTestCase {
    private func position(
        _ id: Int,
        _ ts: Double?,
        _ lat: Double?,
        _ lng: Double?,
        _ speed: Double?
    ) -> VehicleChartsPositionRecord {
        VehicleChartsPositionRecord(
            id: id,
            timestamp: ts.map { Date(timeIntervalSince1970: $0) },
            latitude: lat,
            longitude: lng,
            speedMps: speed
        )
    }

    func testTrailReproducesWebFilter() {
        let positions = [
            position(1, 100, 37.40, -122.07, 20),
            position(2, 90, nil, -122.07, 18),
            position(3, 80, 0, -122.07, 16),
            position(4, 70, 36.25, -120.23, 12)
        ]
        let projection = VehicleChartsProjection.make(from: VehicleChartsData(positions: positions))
        XCTAssertEqual(projection.trail.count, 2)
        XCTAssertEqual(projection.trailCoordinates.count, 2)
        XCTAssertTrue(projection.hasTrail)
    }

    func testSpeedSeriesReversesAndDropsNonFinite() {
        // Newest-first input (id 1 newest). The web reverses to oldest-first and
        // keeps a real 0, dropping only null/NaN speeds.
        let positions = [
            position(1, 109, 37.41, -122.08, 29.1),
            position(2, 108, 37.40, -122.08, nil),
            position(3, 107, 37.40, -122.08, 0),
            position(4, 106, nil, nil, .nan)
        ]
        let series = VehicleChartsProjection.speedSeries(from: positions)
        // Reversed: id4(NaN→drop), id3(0→keep), id2(nil→drop), id1(29.1→keep).
        XCTAssertEqual(series.count, 2)
        XCTAssertEqual(series.first?.speedMps ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(series.last?.speedMps ?? -1, 29.1, accuracy: 0.0001)
        XCTAssertLessThan(series.first?.timestamp ?? .distantFuture, series.last?.timestamp ?? .distantPast)
    }

    func testSectionFlagsAndHasAnyContent() {
        let empty = VehicleChartsProjection.make(from: .empty)
        XCTAssertFalse(empty.hasMap)
        XCTAssertFalse(empty.hasConfig)
        XCTAssertFalse(empty.hasPreferences)
        XCTAssertFalse(empty.hasSpeedData)
        XCTAssertFalse(empty.hasAnyContent)

        let located = VehicleChartsProjection.make(
            from: VehicleChartsData(state: VehicleChartsStateRecord(latitude: 37.4, longitude: -122.0))
        )
        XCTAssertTrue(located.hasMap)
        XCTAssertTrue(located.hasAnyContent)
        XCTAssertEqual(located.currentCoordinate?.latitude ?? 0, 37.4, accuracy: 0.0001)

        let configOnly = VehicleChartsProjection.make(from: VehicleChartsData(config: VehicleChartsConfig()))
        XCTAssertTrue(configOnly.hasConfig)
        XCTAssertTrue(configOnly.hasAnyContent)
    }

    func testCameraCoordinatesIncludeCurrentAndTrail() {
        let data = VehicleChartsData(
            state: VehicleChartsStateRecord(latitude: 37.40, longitude: -122.08),
            positions: [
                position(1, 100, 37.41, -122.07, 10),
                position(2, 90, 37.42, -122.06, 12)
            ]
        )
        let projection = VehicleChartsProjection.make(from: data)
        XCTAssertEqual(projection.cameraCoordinates.count, 3)
    }
}

// MARK: - Units (web `convertSpeedFromSI`) + formatting (web `formatTime`/`fmtNumber`)

@MainActor final class VehicleChartsFormattingTests: XCTestCase {
    func testSpeedUnitConversionAndLabels() {
        XCTAssertEqual(VehicleChartsSpeedUnit.mph.fromSI(29.0576), 65.0, accuracy: 0.01)
        XCTAssertEqual(VehicleChartsSpeedUnit.kmh.fromSI(10), 36.0, accuracy: 0.0001)
        XCTAssertEqual(VehicleChartsSpeedUnit.mph.label, "mph")
        XCTAssertEqual(VehicleChartsSpeedUnit.kmh.label, "km/h")
    }

    func testUnitsSeamDefaultsToMph() {
        let units = DefaultVehicleChartsUnits()
        XCTAssertEqual(units.speed, .mph)
        XCTAssertEqual(units.speedUnitLabel, "mph")
        XCTAssertEqual(units.convertSpeedFromSI(29.0576), 65.0, accuracy: 0.01)
    }

    func testNumberFormattingGroupsAndRounds() {
        let formatting = DefaultVehicleChartsFormatting()
        XCTAssertEqual(formatting.formatNumber(1234.5, decimals: 2), "1,234.50")
        XCTAssertEqual(formatting.formatNumber(37.4002), "37.40")
        XCTAssertEqual(formatting.formatNumber(64.96, decimals: 0), "65")
    }

    func testTimeFormatting() {
        let formatting = DefaultVehicleChartsFormatting()
        XCTAssertEqual(formatting.formatTime(nil), "—")
        XCTAssertNotEqual(formatting.formatTime(Date(timeIntervalSince1970: 1_700_000_000)), "—")
    }
}
