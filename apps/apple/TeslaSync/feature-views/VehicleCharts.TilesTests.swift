//
//  VehicleCharts.TilesTests.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  Tile + label coverage for the VehicleCharts surface: the configuration grid
//  (web `vehicleConfigData` `MetricCard` array — `cleanNil` fallbacks, boolean
//  tokens, percentage suffixes), the preferences grid (web `parseSettingEnum`
//  values), and the visible/spoken label builders. The `localize` facade is
//  stubbed with an echo so the asserted text is the web English value. No view is
//  rendered.
//

import XCTest
@testable import TeslaSync

@MainActor final class VehicleChartsConfigTilesTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func value(_ tiles: [VehicleChartsTile], _ id: String) -> String? {
        tiles.first { $0.id == id }?.value
    }

    private func label(_ tiles: [VehicleChartsTile], _ id: String) -> String? {
        tiles.first { $0.id == id }?.label
    }

    private var sample: VehicleChartsConfig {
        VehicleChartsConfig(
            carType: "Model Y",
            trim: "Long Range",
            exteriorColor: "Pearl White",
            roofColor: "Glass",
            wheelType: "Induction",
            version: "2026.8.1",
            vehicleName: "Bolt",
            chargePort: "US",
            rearSeatHeaters: "1",
            efficiencyPackage: "Default",
            sunroofInstalled: nil,
            europeVehicle: false,
            rightHandDrive: false,
            remoteStartEnabled: true,
            offroadLightbarPresent: false,
            softwareUpdateVersion: nil,
            softwareUpdateDownloadPct: 100,
            softwareUpdateInstallPct: 45
        )
    }

    func testTileCountAndOrderMatchesWebArray() {
        let tiles = VehicleChartsConfigTiles.make(config: sample, localize: echo)
        XCTAssertEqual(tiles.count, 18)
        XCTAssertEqual(tiles.map(\.id).first, "model")
        XCTAssertEqual(tiles.map(\.id)[11], "europeVehicle")
        XCTAssertEqual(tiles.map(\.id).last, "swInstall")
    }

    func testDataValuesPassThroughCleanNil() {
        let tiles = VehicleChartsConfigTiles.make(config: sample, localize: echo)
        XCTAssertEqual(value(tiles, "model"), "Model Y")
        XCTAssertEqual(value(tiles, "firmware"), "2026.8.1")
        XCTAssertEqual(label(tiles, "model"), "Model")
        XCTAssertEqual(label(tiles, "rhd"), "Right-Hand Drive")
    }

    func testBooleanAndFallbackTokens() {
        let tiles = VehicleChartsConfigTiles.make(config: sample, localize: echo)
        XCTAssertEqual(value(tiles, "sunroof"), "Not Installed")
        XCTAssertEqual(value(tiles, "europeVehicle"), "No")
        XCTAssertEqual(value(tiles, "rhd"), "No")
        XCTAssertEqual(value(tiles, "remoteStart"), "Active")
        XCTAssertEqual(value(tiles, "offroadLightbar"), "No")
        XCTAssertEqual(value(tiles, "swUpdate"), "None")
    }

    func testPercentageAndNilBranches() {
        let tiles = VehicleChartsConfigTiles.make(config: sample, localize: echo)
        XCTAssertEqual(value(tiles, "swDownload"), "100%")
        XCTAssertEqual(value(tiles, "swInstall"), "45%")

        let sparse = VehicleChartsConfig(
            carType: "<nil>",
            europeVehicle: nil,
            softwareUpdateDownloadPct: nil,
            softwareUpdateInstallPct: 45.5
        )
        let sparseTiles = VehicleChartsConfigTiles.make(config: sparse, localize: echo)
        XCTAssertEqual(value(sparseTiles, "model"), "—")
        XCTAssertEqual(value(sparseTiles, "europeVehicle"), "—")
        XCTAssertEqual(value(sparseTiles, "swDownload"), "—")
        XCTAssertEqual(value(sparseTiles, "swInstall"), "45.5%")
    }
}

@MainActor final class VehicleChartsPreferenceTilesTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func value(_ tiles: [VehicleChartsTile], _ id: String) -> String? {
        tiles.first { $0.id == id }?.value
    }

    func testPreferencesGridParsesSettingEnums() {
        let preferences = VehicleChartsPreferences(
            setting24hrTime: true,
            settingChargeUnit: "ChargeUnitPercent",
            settingDistanceUnit: "DistanceUnitMiles",
            settingTemperatureUnit: "TemperatureUnitFahrenheit",
            settingTirePressureUnit: "PressureUnitPsi"
        )
        let tiles = VehicleChartsPreferenceTiles.make(preferences: preferences, localize: echo)
        XCTAssertEqual(tiles.count, 5)
        XCTAssertEqual(value(tiles, "distance"), "Miles")
        XCTAssertEqual(value(tiles, "temperature"), "Fahrenheit")
        XCTAssertEqual(value(tiles, "chargeUnit"), "Percent")
        XCTAssertEqual(value(tiles, "tirePressure"), "PSI")
        XCTAssertEqual(value(tiles, "time24h"), "Yes")
    }

    func testPreferencesMissingValuesFallBackToEmDash() {
        let tiles = VehicleChartsPreferenceTiles.make(preferences: VehicleChartsPreferences(), localize: echo)
        XCTAssertEqual(value(tiles, "distance"), "—")
        XCTAssertEqual(value(tiles, "time24h"), "—")
    }
}

@MainActor final class VehicleChartsLabelsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionTitlesResolveWebFallbacks() {
        XCTAssertEqual(VehicleChartsLabels.locationTitle(localize: echo), "Location")
        XCTAssertEqual(VehicleChartsLabels.vehicleConfigTitle(localize: echo), "Vehicle Configuration")
        XCTAssertEqual(VehicleChartsLabels.carPreferencesTitle(localize: echo), "Car Display Preferences")
        XCTAssertEqual(VehicleChartsLabels.speedHistoryTitle(localize: echo), "Speed History")
    }

    func testCoordinateAndChartLabels() {
        XCTAssertEqual(VehicleChartsLabels.coordinate(latitude: "37.40", longitude: "-122.08"), "37.40, -122.08")
        XCTAssertEqual(
            VehicleChartsLabels.coordinateAccessibility(latitude: "37.40", longitude: "-122.08", localize: echo),
            "Current location 37.40, -122.08"
        )
        XCTAssertEqual(VehicleChartsLabels.speedSeriesName(unit: "mph", localize: echo), "Speed mph")
        XCTAssertEqual(VehicleChartsLabels.speedValueAxis(unit: "mph", localize: echo), "Speed (mph)")
        XCTAssertEqual(
            VehicleChartsLabels.positionDataWillAppear(localize: echo),
            "Position data will appear here"
        )
    }

    func testValueTokenResolvers() {
        XCTAssertEqual(VehicleChartsLabels.yesNo(true, localize: echo), "Yes")
        XCTAssertEqual(VehicleChartsLabels.yesNo(false, localize: echo), "No")
        XCTAssertEqual(VehicleChartsLabels.settingLabel(.miles, localize: echo), "Miles")
        XCTAssertEqual(VehicleChartsLabels.settingLabel(.kpa, localize: echo), "kPa")
        XCTAssertEqual(VehicleChartsLabels.settingLabel(.raw("Custom"), localize: echo), "Custom")
        XCTAssertEqual(VehicleChartsLabels.settingLabel(.missing, localize: echo), "—")
    }
}
