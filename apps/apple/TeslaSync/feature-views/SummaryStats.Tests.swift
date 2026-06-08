//
//  SummaryStats.Tests.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  Unit coverage for the SummaryStats surface:
//    • Adapter — `fmtNumber` (one-decimal, grouped) vs the ungrouped raw-count
//      formatter, the SI Celsius→°C/°F conversion (web `convertTempFromSI`), the
//      responsive column math, and the VoiceOver summary content.
//    • State holder — `DynamicsSummaryStatsProjection` across the loading / data
//      branches, each tile's value / unit, and the temperature em-dash for a null
//      `motorStats`, plus the `DynamicsSummaryStatsModel` wiring and the P1/S11
//      `view.opened` telemetry.
//    • i18n — the per-surface string + unit resolution through the facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDynamicsSummaryStatsSource`, and the locale /
//  temperature unit are injected for determinism.
//

import XCTest

// MARK: - Fixtures

private let enUS = Locale(identifier: "en_US")
private let deDE = Locale(identifier: "de_DE")

private let celsiusFmt = DynamicsSummaryStatsFormatting(locale: enUS, temperatureUnit: .celsius)
private let fahrenheitFmt = DynamicsSummaryStatsFormatting(locale: enUS, temperatureUnit: .fahrenheit)

private let sampleValues = DynamicsSummaryStatsValues(
    totalReadings: 1284,
    avgTorque: 142.6,
    peakPower: 248.3,
    peakRegen: 64.1,
    avgPower: 38.9,
    avgMotorTempCelsius: 47.5
)

// MARK: - Number formatting (port of numberFormat.ts)

final class DynamicsSummaryStatsFormatTests: XCTestCase {
    func testDecimalPadsAndGroups() {
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(142.6, fractionDigits: 1, locale: enUS), "142.6")
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(1284, fractionDigits: 1, locale: enUS), "1,284.0")
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(38.9, fractionDigits: 1, locale: enUS), "38.9")
    }

    func testDecimalRoundsHalfAwayFromZero() {
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(12345.6, fractionDigits: 0, locale: enUS), "12,346")
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(2.5, fractionDigits: 0, locale: enUS), "3")
    }

    func testDecimalNonFiniteCoercesToZero() {
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(.nan, fractionDigits: 1, locale: enUS), "0.0")
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(.infinity, fractionDigits: 1, locale: enUS), "0.0")
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(-.infinity, fractionDigits: 1, locale: enUS), "0.0")
    }

    func testDecimalLocaleSeparatorsFollowLocale() {
        // de_DE uses "." for grouping and "," for the decimal mark.
        XCTAssertEqual(DynamicsSummaryStatsFormat.decimal(1234.5, fractionDigits: 1, locale: deDE), "1.234,5")
    }

    func testCountIsUngroupedRawNumber() {
        // Web `value={motorStats?.totalReadings ?? 0}` renders via Number.toString().
        XCTAssertEqual(DynamicsSummaryStatsFormat.count(1284), "1284")
        XCTAssertEqual(DynamicsSummaryStatsFormat.count(0), "0")
        XCTAssertEqual(DynamicsSummaryStatsFormat.count(1_284_932), "1284932")
    }
}

// MARK: - Temperature conversion (web `convertTempFromSI`)

final class DynamicsSummaryStatsTemperatureTests: XCTestCase {
    func testCelsiusIsIdentity() {
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.celsius.convert(47.5), 47.5, accuracy: 0.0001)
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.celsius.convert(0), 0, accuracy: 0.0001)
    }

    func testFahrenheitConverts() {
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.fahrenheit.convert(47.5), 117.5, accuracy: 0.0001)
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.fahrenheit.convert(0), 32, accuracy: 0.0001)
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.fahrenheit.convert(100), 212, accuracy: 0.0001)
    }

    func testSymbolKeysAndFallbacks() {
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.celsius.symbolFallback, "°C")
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.fahrenheit.symbolFallback, "°F")
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.celsius.symbolKey, "dynamics.unit.celsius")
        XCTAssertEqual(DynamicsSummaryStatsTemperatureUnit.fahrenheit.symbolKey, "dynamics.unit.fahrenheit")
    }
}

// MARK: - Formatting facade (web fmtNumber + temperature pipeline)

final class DynamicsSummaryStatsFormattingTests: XCTestCase {
    func testNumberCountAndTemperatureValue() {
        XCTAssertEqual(celsiusFmt.number(142.6), "142.6")
        XCTAssertEqual(celsiusFmt.count(1284), "1284")
        XCTAssertEqual(celsiusFmt.temperatureValue(47.5), "47.5")
        XCTAssertEqual(fahrenheitFmt.temperatureValue(47.5), "117.5")
    }

    func testTemperatureUnitDescriptor() {
        XCTAssertEqual(celsiusFmt.temperatureUnitDescriptor.fallback, "°C")
        XCTAssertEqual(celsiusFmt.temperatureUnitDescriptor.key, "dynamics.unit.celsius")
        XCTAssertEqual(fahrenheitFmt.temperatureUnitDescriptor.fallback, "°F")
    }
}

// MARK: - Responsive column math (web grid-cols-2 / md:3 / lg:6)

final class DynamicsSummaryStatsLayoutTests: XCTestCase {
    func testColumnsAtBreakpoints() {
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 320), 2)
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 767), 2)
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 768), 3)
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 1023), 3)
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 1024), 6)
        XCTAssertEqual(DynamicsSummaryStatsLayout.columnCount(forWidth: 1440), 6)
    }
}

// MARK: - Projection: branches + tile wiring

final class DynamicsSummaryStatsProjectionTests: XCTestCase {
    func testLoadingBranchMakesEveryTileLoading() {
        let resolved = DynamicsSummaryStatsProjection.resolve(
            DynamicsSummaryStatsInput(values: sampleValues, formatting: celsiusFmt, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.cards.count, 6)
        XCTAssertTrue(resolved.cards.allSatisfy { $0.value == .loading })
        XCTAssertEqual(resolved.cards.map(\.id), [
            "totalReadings", "avgTorque", "peakPower", "peakRegen", "avgPower", "avgMotorTemp"
        ])
        // The temperature tile keeps its unit descriptor even while loading.
        XCTAssertEqual(resolved.cards[5].unit?.fallback, "°C")
    }

    func testDataBranchBuildsSixTiles() {
        let resolved = DynamicsSummaryStatsProjection.resolve(
            DynamicsSummaryStatsInput(values: sampleValues, formatting: celsiusFmt)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.cards.count, 6)

        XCTAssertEqual(resolved.cards[0].labelKey, "dynamics.totalReadings")
        XCTAssertEqual(resolved.cards[0].value, .value("1284"))
        XCTAssertNil(resolved.cards[0].unit)

        XCTAssertEqual(resolved.cards[1].value, .value("142.6"))
        XCTAssertEqual(resolved.cards[1].unit?.fallback, "Nm")

        XCTAssertEqual(resolved.cards[2].value, .value("248.3"))
        XCTAssertEqual(resolved.cards[2].unit?.fallback, "kW")

        XCTAssertEqual(resolved.cards[3].value, .value("64.1"))
        XCTAssertEqual(resolved.cards[3].unit?.fallback, "kW")

        XCTAssertEqual(resolved.cards[4].value, .value("38.9"))
        XCTAssertEqual(resolved.cards[4].unit?.fallback, "kW")

        XCTAssertEqual(resolved.cards[5].labelKey, "dynamics.avgMotorTemp")
        XCTAssertEqual(resolved.cards[5].value, .value("47.5"))
        XCTAssertEqual(resolved.cards[5].unit?.fallback, "°C")
    }

    func testFahrenheitConvertsTheTemperatureTile() {
        let resolved = DynamicsSummaryStatsProjection.resolve(
            DynamicsSummaryStatsInput(values: sampleValues, formatting: fahrenheitFmt)
        )
        XCTAssertEqual(resolved.cards[5].value, .value("117.5"))
        XCTAssertEqual(resolved.cards[5].unit?.fallback, "°F")
    }

    func testNullValuesRenderZerosAndTemperatureEmDash() {
        let resolved = DynamicsSummaryStatsProjection.resolve(
            DynamicsSummaryStatsInput(values: nil, formatting: celsiusFmt)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.cards[0].value, .value("0"))
        XCTAssertEqual(resolved.cards[1].value, .value("0.0"))
        XCTAssertEqual(resolved.cards[4].value, .value("0.0"))
        // Web `motorStats ? … : '—'` — the temperature tile is the em-dash, no unit.
        XCTAssertEqual(resolved.cards[5].value, .empty)
        XCTAssertNil(resolved.cards[5].unit)
    }
}

// MARK: - Tile facade resolution

final class DynamicsSummaryStatsCardTests: XCTestCase {
    private func torqueTile(_ value: DynamicsSummaryStatsCardValue) -> DynamicsSummaryStatsCard {
        DynamicsSummaryStatsCard(
            id: "avgTorque",
            labelKey: "dynamics.avgTorque",
            labelFallback: "Avg Torque",
            value: value,
            unit: DynamicsSummaryStatsUnits.newtonMeter,
            symbol: "bolt.fill"
        )
    }

    func testResolvedLabelUnitAndA11yForValue() {
        let card = torqueTile(.value("142.6"))
        XCTAssertEqual(card.resolvedLabel, "Avg Torque")
        XCTAssertEqual(card.resolvedUnit, "Nm")
        XCTAssertEqual(card.accessibilityText, "Avg Torque, 142.6 Nm")
    }

    func testLoadingTileA11yUsesLoadingWord() {
        XCTAssertEqual(torqueTile(.loading).accessibilityText, "Avg Torque, Loading")
    }

    func testEmptyTemperatureTileA11yUsesEmDash() {
        let card = DynamicsSummaryStatsCard(
            id: "avgMotorTemp",
            labelKey: "dynamics.avgMotorTemp",
            labelFallback: "Avg Motor Temp",
            value: .empty,
            unit: nil,
            symbol: "thermometer.medium"
        )
        XCTAssertNil(card.resolvedUnit)
        XCTAssertEqual(card.resolvedEmpty, "—")
        XCTAssertEqual(card.accessibilityText, "Avg Motor Temp, —")
    }
}

// MARK: - Accessibility summary content

final class DynamicsSummaryStatsAccessibilityTests: XCTestCase {
    func testCardLabelWithUnit() {
        XCTAssertEqual(
            DynamicsSummaryStatsAccessibility.cardLabel(label: "Avg Torque", value: "142.6", unit: "Nm"),
            "Avg Torque, 142.6 Nm"
        )
    }

    func testCardLabelWithoutUnit() {
        XCTAssertEqual(
            DynamicsSummaryStatsAccessibility.cardLabel(label: "Total Readings", value: "1284", unit: nil),
            "Total Readings, 1284"
        )
        XCTAssertEqual(
            DynamicsSummaryStatsAccessibility.cardLabel(label: "Total Readings", value: "1284", unit: ""),
            "Total Readings, 1284"
        )
    }
}

// MARK: - i18n facade

final class DynamicsSummaryStatsStringsTests: XCTestCase {
    func testUnitSymbolsAndSentinelsResolveToFallback() {
        XCTAssertEqual(SSDStrings.string("dynamics.unit.nm", "Nm"), "Nm")
        XCTAssertEqual(SSDStrings.string("dynamics.unit.kw", "kW"), "kW")
        XCTAssertEqual(SSDStrings.string("dynamics.noData", "—"), "—")
        XCTAssertEqual(SSDStrings.string("dynamics.loadingValueA11y", "Loading"), "Loading")
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class DynamicsSummaryStatsModelTests: XCTestCase {
    private func makeModel(
        _ input: DynamicsSummaryStatsInput,
        telemetry: DynamicsSummaryStatsTelemetry
    ) -> (DynamicsSummaryStatsModel, InMemoryDynamicsSummaryStatsSource) {
        let source = InMemoryDynamicsSummaryStatsSource(initial: input)
        let model = DynamicsSummaryStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDynamicsSummaryStatsTelemetry()
        let (model, source) = makeModel(
            DynamicsSummaryStatsInput(values: sampleValues, formatting: celsiusFmt),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[5].value, .value("47.5"))
        XCTAssertEqual(spy.surfaces, [SummaryStats.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(
            DynamicsSummaryStatsInput(formatting: celsiusFmt, isLoading: true),
            telemetry: SpyDynamicsSummaryStatsTelemetry()
        )
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertTrue(model.cards.allSatisfy { $0.value == .loading })
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(
            DynamicsSummaryStatsInput(formatting: celsiusFmt, isLoading: true),
            telemetry: SpyDynamicsSummaryStatsTelemetry()
        )
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(DynamicsSummaryStatsInput(values: sampleValues, formatting: celsiusFmt))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cards[1].value, .value("142.6"))
    }

    func testStopDelegatesToSourceAndReArms() {
        let (model, source) = makeModel(
            DynamicsSummaryStatsInput(values: sampleValues, formatting: celsiusFmt),
            telemetry: SpyDynamicsSummaryStatsTelemetry()
        )
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDynamicsSummaryStatsTelemetry: DynamicsSummaryStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
