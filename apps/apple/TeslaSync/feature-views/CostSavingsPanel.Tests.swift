//
//  CostSavingsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  Unit coverage for the CostSavingsPanel surface: the Adapter formatters +
//  settings derivation + cost/savings arithmetic + resolved-tile builder, the
//  `CostSavingsProjection` / `CostSavingsModel` state holder (wiring, `view.opened`
//  telemetry, stale auto-refresh), and the VoiceOver tile-label content. These run
//  in the TeslaSync(/-macOS) XCTest targets with no network and no real store: the
//  model is driven by `InMemoryCostSavingsSource`, and the locale is injected.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func fullConfig() -> CostSavingsConfig {
    CostSavingsConfig(
        costPerKwh: 0.12,
        currencySymbol: "$",
        decimalPrecision: 2,
        distanceUnit: .mi,
        gasEfficiencyMpg: 30,
        gasPricePerUnit: 3.5,
        gasUnit: .gallon,
        localeIdentifier: "en-US"
    )
}

/// ~31.07 mi, 12 kWh — exercises every cell.
private func fullInputs() -> CostSavingsInputs {
    CostSavingsInputs(distanceM: 50000, energyWh: 12000)
}

// MARK: - Number / currency / plain formatting (ports of numberFormat.ts + useFormatting)

final class CostSavingsFormatTests: XCTestCase {
    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(CostSavingsFormat.number(1234.5, decimals: 2, locale: enUS), "1,234.50")
        XCTAssertEqual(CostSavingsFormat.number(1.44, decimals: 2, locale: enUS), "1.44")
        XCTAssertEqual(CostSavingsFormat.number(0, decimals: 0, locale: enUS), "0")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(CostSavingsFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(CostSavingsFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(CostSavingsFormat.number(-.infinity, decimals: 0, locale: enUS), "0")
    }

    func testNumberRoundsHalfAway() {
        XCTAssertEqual(CostSavingsFormat.number(60.272, decimals: 0, locale: enUS), "60")
        XCTAssertEqual(CostSavingsFormat.number(60.5, decimals: 0, locale: enUS), "61")
        XCTAssertEqual(CostSavingsFormat.number(0.04672, decimals: 3, locale: enUS), "0.047")
    }

    func testCurrencyPrependsSymbol() {
        XCTAssertEqual(CostSavingsFormat.currency(1.44, decimals: 2, symbol: "$", locale: enUS), "$1.44")
        XCTAssertEqual(CostSavingsFormat.currency(2.5, decimals: 2, symbol: "€", locale: enUS), "€2.50")
        XCTAssertEqual(CostSavingsFormat.currency(0.046, decimals: 3, symbol: "$", locale: enUS), "$0.046")
    }

    func testPlainTrimsTrailingZerosWithoutRounding() {
        XCTAssertEqual(CostSavingsFormat.plain(0.12, locale: enUS), "0.12")
        XCTAssertEqual(CostSavingsFormat.plain(0.1, locale: enUS), "0.1")
        XCTAssertEqual(CostSavingsFormat.plain(30, locale: enUS), "30")
        XCTAssertEqual(CostSavingsFormat.plain(3.5, locale: enUS), "3.5")
    }

    func testConvertDistanceFromSI() {
        XCTAssertEqual(CostSavingsFormat.convertDistanceFromSI(1609.344, to: .mi), 1, accuracy: 1e-9)
        XCTAssertEqual(CostSavingsFormat.convertDistanceFromSI(1000, to: .km), 1, accuracy: 1e-9)
        XCTAssertEqual(CostSavingsFormat.convertDistanceFromSI(50000, to: .mi), 50000 / 1609.344, accuracy: 1e-9)
    }
}

// MARK: - Settings derivation (web useSettings → useUnits → useFormatting defaults)

final class CostSavingsConfigMakeTests: XCTestCase {
    func testCostPerKwhFallsBackToDefault() {
        let derived = CostSavingsConfig.make(from: CostSavingsRawSettings(
            baseCostPerKwh: nil,
            currencySymbol: "$",
            decimalPrecision: 2,
            unitOfLength: "km"
        ))
        XCTAssertEqual(derived.costPerKwh, 0.12, accuracy: 1e-9)
    }

    func testCurrencySymbolTrimAndFallback() {
        XCTAssertEqual(CostSavingsConfig.deriveCurrencySymbol(nil), "$")
        XCTAssertEqual(CostSavingsConfig.deriveCurrencySymbol(""), "$")
        XCTAssertEqual(CostSavingsConfig.deriveCurrencySymbol("   "), "$")
        XCTAssertEqual(CostSavingsConfig.deriveCurrencySymbol("€"), "€")
        // Web keeps the untrimmed symbol whenever its trim is non-empty.
        XCTAssertEqual(CostSavingsConfig.deriveCurrencySymbol(" $ "), " $ ")
    }

    func testPrecisionFloorFiniteNonNegativeElseDefault() {
        XCTAssertEqual(CostSavingsConfig.derivePrecision(nil), 2)
        XCTAssertEqual(CostSavingsConfig.derivePrecision(-1), 2)
        XCTAssertEqual(CostSavingsConfig.derivePrecision(.nan), 2)
        XCTAssertEqual(CostSavingsConfig.derivePrecision(.infinity), 2)
        XCTAssertEqual(CostSavingsConfig.derivePrecision(3.7), 3)
        XCTAssertEqual(CostSavingsConfig.derivePrecision(0), 0)
    }

    func testDistanceGasAndLocaleDerivation() {
        let mi = CostSavingsConfig.make(from: CostSavingsRawSettings(
            baseCostPerKwh: 0.2,
            currencySymbol: "$",
            decimalPrecision: 2,
            unitOfLength: "mi",
            gasEfficiencyMpg: 25,
            gasPricePerUnit: 4,
            gasUnit: "liter",
            locale: "fr-FR"
        ))
        XCTAssertEqual(mi.distanceUnit, .mi)
        XCTAssertEqual(mi.gasUnit, .liter)
        XCTAssertEqual(mi.localeIdentifier, "fr-FR")

        let km = CostSavingsConfig.make(from: CostSavingsRawSettings(
            baseCostPerKwh: 0.2,
            currencySymbol: "$",
            decimalPrecision: 2,
            unitOfLength: nil,
            gasEfficiencyMpg: nil,
            gasPricePerUnit: nil,
            gasUnit: nil,
            locale: ""
        ))
        XCTAssertEqual(km.distanceUnit, .km)
        XCTAssertEqual(km.gasUnit, .gallon)
        XCTAssertEqual(km.gasEfficiencyMpg, 0)
        XCTAssertEqual(km.gasPricePerUnit, 0)
        XCTAssertEqual(km.localeIdentifier, "en-US")
    }
}

// MARK: - Cost & savings math (web component body + useFormatting callbacks)

final class CostSavingsMathTests: XCTestCase {
    func testEnergyKwhAndTripCost() {
        XCTAssertEqual(CostSavingsMath.energyKwh(12000), 12, accuracy: 1e-9)
        XCTAssertEqual(CostSavingsMath.tripCost(energyWh: 12000, costPerKwh: 0.12), 1.44, accuracy: 1e-9)
    }

    func testCostPerDistanceUnit() {
        let perMi = CostSavingsMath.costPerDistanceUnit(
            energyWh: 12000, costPerKwh: 0.12, distanceM: 50000, unit: .mi
        )
        XCTAssertEqual(perMi ?? -1, 1.44 / (50000 / 1609.344), accuracy: 1e-9)
    }

    func testCostPerDistanceUnitNilWhenNoDistance() {
        XCTAssertNil(CostSavingsMath.costPerDistanceUnit(
            energyWh: 12000, costPerKwh: 0.12, distanceM: 0, unit: .mi
        ))
        XCTAssertNil(CostSavingsMath.costPerDistanceUnit(
            energyWh: 12000, costPerKwh: 0.12, distanceM: -5, unit: .km
        ))
    }

    func testEstimateGasCostGallon() {
        let gas = CostSavingsMath.estimateGasCost(distanceM: 50000, mpg: 30, gasPrice: 3.5, gasUnit: .gallon)
        XCTAssertEqual(gas ?? -1, (50000 / 1609.344) / 30 * 3.5, accuracy: 1e-9)
    }

    func testEstimateGasCostLiterScalesByGallonFactor() {
        let gas = CostSavingsMath.estimateGasCost(distanceM: 50000, mpg: 30, gasPrice: 3.5, gasUnit: .liter)
        let gallons = (50000 / 1609.344) / 30
        XCTAssertEqual(gas ?? -1, gallons * 3.78541 * 3.5, accuracy: 1e-9)
    }

    func testEstimateGasCostNilGuards() {
        XCTAssertNil(CostSavingsMath.estimateGasCost(distanceM: 50000, mpg: 0, gasPrice: 3.5, gasUnit: .gallon))
        XCTAssertNil(CostSavingsMath.estimateGasCost(distanceM: 50000, mpg: 30, gasPrice: 0, gasUnit: .gallon))
        XCTAssertNil(CostSavingsMath.estimateGasCost(distanceM: 0, mpg: 30, gasPrice: 3.5, gasUnit: .gallon))
    }

    func testSavings() {
        XCTAssertEqual(CostSavingsMath.savings(gasCost: 3.6, evCost: 1.44) ?? 0, 2.16, accuracy: 1e-9)
        XCTAssertNil(CostSavingsMath.savings(gasCost: nil, evCost: 1.44))
    }
}

// MARK: - Tile builder (the web render branches, in order)

final class CostSavingsTilesTests: XCTestCase {
    func testEmptyWhenNoEnergyAndNoDistance() {
        let tiles = CostSavingsTiles.build(config: fullConfig(), inputs: CostSavingsInputs(distanceM: 0, energyWh: 0))
        XCTAssertTrue(tiles.isEmpty)
    }

    func testFullDriveBuildsAllFiveCellsInOrder() {
        let tiles = CostSavingsTiles.build(config: fullConfig(), inputs: fullInputs())
        XCTAssertEqual(tiles.map(\.kind), [.tripCost, .costPerUnit, .gasEquiv, .gasSavings, .savingsPct])
        let trip = tiles[0]
        XCTAssertEqual(trip.value, "$1.44")
        XCTAssertEqual(trip.tone, .positive)
        XCTAssertEqual(trip.subLabelArguments, ["$", "0.12"])
        let perUnit = tiles[1]
        XCTAssertEqual(perUnit.value, "$0.046")
        XCTAssertEqual(perUnit.tone, .accent)
        XCTAssertEqual(perUnit.labelArgument, "mi")
        let gas = tiles[2]
        XCTAssertEqual(gas.value, "$3.62")
        XCTAssertEqual(gas.tone, .negative)
        XCTAssertEqual(gas.subLabelArguments, ["30"])
        XCTAssertEqual(tiles[3].value, "$2.18")
        XCTAssertEqual(tiles[3].tone, .positive)
        XCTAssertEqual(tiles[4].value, "60%")
        XCTAssertEqual(tiles[4].tone, .positive)
    }

    func testTripCostOnlyWhenNoDistance() {
        let tiles = CostSavingsTiles.build(
            config: fullConfig(),
            inputs: CostSavingsInputs(distanceM: 0, energyWh: 12000)
        )
        XCTAssertEqual(tiles.map(\.kind), [.tripCost])
    }

    func testCostPerUnitButNoGasTrioWhenGasNotConfigured() {
        var config = fullConfig()
        config.gasEfficiencyMpg = 0
        config.gasPricePerUnit = 0
        let tiles = CostSavingsTiles.build(config: config, inputs: fullInputs())
        XCTAssertEqual(tiles.map(\.kind), [.tripCost, .costPerUnit])
    }

    func testGasTrioHiddenWhenSavingsNotPositive() {
        var config = fullConfig()
        config.gasEfficiencyMpg = 1000
        config.gasPricePerUnit = 0.01
        let tiles = CostSavingsTiles.build(config: config, inputs: fullInputs())
        XCTAssertEqual(tiles.map(\.kind), [.tripCost, .costPerUnit])
    }

    func testCostPerUnitUsesKmWhenPreferred() {
        var config = fullConfig()
        config.distanceUnit = .km
        config.gasEfficiencyMpg = 0
        config.gasPricePerUnit = 0
        let tiles = CostSavingsTiles.build(config: config, inputs: fullInputs())
        let perUnit = tiles[1]
        XCTAssertEqual(perUnit.labelArgument, "km")
        XCTAssertEqual(perUnit.value, "$0.029")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class CostSavingsProjectionTests: XCTestCase {
    private func snapshot() -> CostSavingsSnapshot {
        CostSavingsSnapshot(config: fullConfig(), inputs: fullInputs())
    }

    func testErrorTakesPrecedence() {
        let resolved = CostSavingsProjection.resolve(
            CostSavingsInput(snapshot: snapshot(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.tiles.isEmpty)
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(CostSavingsProjection.resolve(CostSavingsInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(CostSavingsProjection.resolve(CostSavingsInput(snapshot: nil)).phase, .loading)
    }

    func testEmptyWhenDegenerateDrive() {
        let empty = CostSavingsSnapshot(config: fullConfig(), inputs: CostSavingsInputs(distanceM: 0, energyWh: 0))
        XCTAssertEqual(CostSavingsProjection.resolve(CostSavingsInput(snapshot: empty)).phase, .empty)
    }

    func testDataResolvesTiles() {
        let resolved = CostSavingsProjection.resolve(CostSavingsInput(snapshot: snapshot()))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tiles.count, 5)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class CostSavingsModelTests: XCTestCase {
    private func makeModel(
        _ input: CostSavingsInput,
        telemetry: CostSavingsTelemetry = OSLogCostSavingsTelemetry()
    ) -> (CostSavingsModel, InMemoryCostSavingsSource) {
        let source = InMemoryCostSavingsSource(initial: input)
        let model = CostSavingsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: CostSavingsInput {
        CostSavingsInput(snapshot: CostSavingsSnapshot(config: fullConfig(), inputs: fullInputs()))
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyCostSavingsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.tiles.count, 5)
        XCTAssertEqual(spy.surfaces, [CostSavingsPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(CostSavingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.tiles.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(CostSavingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(CostSavingsInput(snapshot: dataInput.snapshot, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(CostSavingsInput(snapshot: dataInput.snapshot, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(CostSavingsInput(snapshot: dataInput.snapshot, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(CostSavingsPanel.surfaceSlug, "CostSavingsPanel")
    }
}

// MARK: - Accessibility summary content

final class CostSavingsAccessibilityTests: XCTestCase {
    func testTileLabelWithDetail() {
        XCTAssertEqual(
            CostSavingsAccessibility.tileLabel(label: "Trip Cost", value: "$1.44", detail: "at $0.12/kWh"),
            "Trip Cost, $1.44, at $0.12/kWh"
        )
    }

    func testTileLabelWithoutDetail() {
        XCTAssertEqual(
            CostSavingsAccessibility.tileLabel(label: "vs Gas Savings", value: "$2.18"),
            "vs Gas Savings, $2.18"
        )
        XCTAssertEqual(
            CostSavingsAccessibility.tileLabel(label: "Savings %", value: "60%", detail: ""),
            "Savings %, 60%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostSavingsTelemetry: CostSavingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
