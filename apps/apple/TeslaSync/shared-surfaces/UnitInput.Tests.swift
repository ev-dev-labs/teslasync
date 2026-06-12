//
//  UnitInput.Tests.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  Adapter + projection + seam coverage for the UnitInput surface — the Swift port of the web
//  behaviour (components/forms/UnitInput.tsx + lib/unitInput.ts):
//    • Symbol — distance mi/km, speed mph/(km/h), temperature °C/°F, energy kWh, percent %, currency.
//    • Formatting — canonical → display text per unit, km/°F conversion, precision rounding, nil → "".
//    • Parsing — plain + suffix-tolerant ("60 mph", "75 kWh", "68°F", "80%", "$1.50"), accounting
//      parens, km/°F display→canonical conversion, locale separators, strict mode, blank → nil.
//    • parseLocaleNumber — en-US / de-DE group + decimal separators.
//    • Accessibility — the composed field VoiceOver label (value vs empty hint).
//    • Projection — error / loading / ready-empty / ready-populated (web branches + P4 leaf).
//    • Seams — Live (start/update/commit-writeback/refresh) + InMemory (records commits / push).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store — each assertion
//  reads the pure core or the in-memory seam directly.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let deDE = Locale(identifier: "de_DE")

private func metric(precision: Int = 2) -> UnitInputFieldSettings {
    UnitInputFieldSettings(
        lengthUnit: .kilometers, tempUnit: .celsius, decimalPrecision: precision,
        currencySymbol: "$", locale: enUS
    )
}

private func imperial(precision: Int = 2) -> UnitInputFieldSettings {
    UnitInputFieldSettings(
        lengthUnit: .miles, tempUnit: .fahrenheit, decimalPrecision: precision,
        currencySymbol: "$", locale: enUS
    )
}

// MARK: - Symbol (web unitSymbol)

final class UnitInputFieldSymbolTests: XCTestCase {
    func testDistanceSymbol() {
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .distance, settings: metric()), "km")
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .distance, settings: imperial()), "mi")
    }

    func testSpeedSymbol() {
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .speed, settings: metric()), "km/h")
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .speed, settings: imperial()), "mph")
    }

    func testTemperatureSymbol() {
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .temperature, settings: imperial()), "°F")
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .temperature, settings: metric()), "°C")
    }

    func testFixedSymbols() {
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .energy, settings: metric()), "kWh")
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .percent, settings: metric()), "%")
    }

    func testCurrencySymbolUsesSettingsAndFallsBack() {
        let euro = UnitInputFieldSettings(currencySymbol: "€", locale: enUS)
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .currency, settings: euro), "€")
        let blank = UnitInputFieldSettings(currencySymbol: "  ", locale: enUS)
        XCTAssertEqual(UnitInputFieldConverter.symbol(kind: .currency, settings: blank), "$")
    }
}

// MARK: - Formatting (web formatForUnit)

final class UnitInputFieldFormatTests: XCTestCase {
    func testDistanceCanonicalMilesToKmDisplay() {
        // 100 canonical miles → km display = 100 * 1.609344 = 160.9344 → "160.93".
        XCTAssertEqual(UnitInputFieldConverter.format(value: 100, kind: .distance, settings: metric()), "160.93")
    }

    func testDistanceMilesNoConversion() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: 100, kind: .distance, settings: imperial()), "100")
    }

    func testSpeedCanonicalMphToKmhDisplay() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: 60, kind: .speed, settings: metric()), "96.56")
    }

    func testTemperatureCelsiusToFahrenheitDisplay() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: 20, kind: .temperature, settings: imperial()), "68")
    }

    func testTemperatureNoConversion() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: 20, kind: .temperature, settings: metric()), "20")
    }

    func testEnergyPercentCurrencyAreUnconverted() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: 75, kind: .energy, settings: metric()), "75")
        XCTAssertEqual(UnitInputFieldConverter.format(value: 80, kind: .percent, settings: metric()), "80")
        XCTAssertEqual(UnitInputFieldConverter.format(value: 0.12, kind: .currency, settings: metric()), "0.12")
    }

    func testNilFormatsAsEmptyString() {
        XCTAssertEqual(UnitInputFieldConverter.format(value: nil, kind: .energy, settings: metric()), "")
    }

    func testPrecisionRoundsHalfAwayFromZero() {
        // 1.23456 @ 4dp → 1.2346 (Intl halfExpand parity).
        XCTAssertEqual(
            UnitInputFieldConverter.format(value: 1.23456, kind: .energy, settings: metric(precision: 4)),
            "1.2346"
        )
    }

    func testGroupSeparatorsAreOff() {
        XCTAssertEqual(
            UnitInputFieldConverter.format(value: 1234.5, kind: .energy, settings: metric(precision: 1)),
            "1234.5"
        )
    }
}

// MARK: - Parsing (web parseForUnit)

final class UnitInputFieldParseTests: XCTestCase {
    func testParsesPlainMiles() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "100", kind: .distance, settings: imperial()), 100)
    }

    func testParsesKmDisplayToCanonicalMiles() throws {
        let value = try XCTUnwrap(UnitInputFieldConverter.parse(text: "100", kind: .distance, settings: metric()))
        XCTAssertEqual(value, 100 / 1.609344, accuracy: 1e-6)
    }

    func testStripsDistanceSuffixThenConverts() throws {
        let value = try XCTUnwrap(UnitInputFieldConverter.parse(text: "100 km", kind: .distance, settings: metric()))
        XCTAssertEqual(value, 62.137119, accuracy: 1e-4)
    }

    func testStripsSpeedSuffix() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "60 mph", kind: .speed, settings: imperial()), 60)
    }

    func testStripsFahrenheitSuffixAndConverts() {
        // "68°F" → strip "°f" → 68 → canonical °C = (68 - 32) * 5 / 9 = 20.
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "68°F", kind: .temperature, settings: imperial()), 20)
    }

    func testStripsCelsiusSuffix() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "20°C", kind: .temperature, settings: metric()), 20)
    }

    func testStripsEnergySuffix() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "75 kWh", kind: .energy, settings: metric()), 75)
    }

    func testStripsPercentSuffix() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "80%", kind: .percent, settings: metric()), 80)
    }

    func testStripsCurrencySymbol() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "$1.50", kind: .currency, settings: metric()), 1.5)
    }

    func testAccountingParenthesesAreNegative() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "($10)", kind: .currency, settings: metric()), -10)
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "(1.50)", kind: .currency, settings: metric()), -1.5)
    }

    func testLocaleGroupSeparator() {
        XCTAssertEqual(UnitInputFieldConverter.parse(text: "1,234.5", kind: .energy, settings: metric()), 1234.5)
    }

    func testBlankAndUnparseableReturnNil() {
        XCTAssertNil(UnitInputFieldConverter.parse(text: "", kind: .energy, settings: metric()))
        XCTAssertNil(UnitInputFieldConverter.parse(text: "   ", kind: .energy, settings: metric()))
        XCTAssertNil(UnitInputFieldConverter.parse(text: "abc", kind: .energy, settings: metric()))
    }

    func testSuffixOnlyReturnsNil() {
        XCTAssertNil(UnitInputFieldConverter.parse(text: "mph", kind: .speed, settings: imperial()))
    }

    func testStrictModeBypassesLocaleParsing() {
        // strict → Double("1,234.5") is nil; non-strict parses the locale group separator.
        XCTAssertNil(UnitInputFieldConverter.parse(text: "1,234.5", kind: .energy, settings: metric(), strict: true))
        XCTAssertEqual(
            UnitInputFieldConverter.parse(text: "1234.5", kind: .energy, settings: metric(), strict: true),
            1234.5
        )
    }
}

// MARK: - parseLocaleNumber (web parseLocaleNumber)

final class UnitInputFieldLocaleNumberTests: XCTestCase {
    func testEnglishGroupingAndDecimal() {
        XCTAssertEqual(UnitInputFieldConverter.parseLocaleNumber("1,234.56", locale: enUS), 1234.56)
    }

    func testGermanGroupingAndDecimal() {
        XCTAssertEqual(UnitInputFieldConverter.parseLocaleNumber("1.234,56", locale: deDE), 1234.56)
    }

    func testUnparseableReturnsNil() {
        XCTAssertNil(UnitInputFieldConverter.parseLocaleNumber("abc", locale: enUS))
        XCTAssertNil(UnitInputFieldConverter.parseLocaleNumber("", locale: enUS))
    }
}

// MARK: - Accessibility (composed field label)

final class UnitInputFieldAccessibilityTests: XCTestCase {
    func testLabelWithValue() {
        let label = UnitInputFieldAccessibility.fieldLabel(
            label: "Battery Capacity", value: "75", emptyHint: "Not set"
        )
        XCTAssertEqual(label, "Battery Capacity, 75")
    }

    func testLabelWhenEmptyUsesHint() {
        let label = UnitInputFieldAccessibility.fieldLabel(label: "Speed", value: "  ", emptyHint: "Not set")
        XCTAssertEqual(label, "Speed, Not set")
    }
}

// MARK: - Projection (web render branches + P4 leaf)

final class UnitInputFieldProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = UnitInputFieldProjection.resolve(
            UnitInputFieldInput(value: 75, kind: .energy, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = UnitInputFieldProjection.resolve(UnitInputFieldInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testReadyPopulatedCarriesDisplayAndSymbol() {
        let resolved = UnitInputFieldProjection.resolve(UnitInputFieldInput(
            value: 75, kind: .energy, settings: metric(), label: "Battery Capacity"
        ))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.canonicalDisplay, "75")
        XCTAssertEqual(resolved.symbol, "kWh")
        XCTAssertEqual(resolved.label, "Battery Capacity")
        XCTAssertFalse(resolved.isEmptyValue)
    }

    func testReadyEmptyHasBlankDisplay() {
        let resolved = UnitInputFieldProjection.resolve(UnitInputFieldInput(
            value: nil, kind: .energy, settings: metric()
        ))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.canonicalDisplay, "")
        XCTAssertTrue(resolved.isEmptyValue)
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = UnitInputFieldProjection.resolve(
            UnitInputFieldInput(value: 75, kind: .energy, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .ready)
    }

    func testRequiredAndDisabledCarryThrough() {
        let resolved = UnitInputFieldProjection.resolve(UnitInputFieldInput(
            value: nil, kind: .energy, isRequired: true, isDisabled: true
        ))
        XCTAssertTrue(resolved.isRequired)
        XCTAssertTrue(resolved.isDisabled)
    }
}

// MARK: - Live source (production value bridge + commit write-back)

@MainActor
final class LiveUnitInputFieldSourceTests: XCTestCase {
    func testStartEmitsInitialValue() {
        let source = LiveUnitInputFieldSource(value: UnitInputFieldInput(value: 75, kind: .energy))
        var latest: UnitInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        XCTAssertEqual(latest?.value, 75)
    }

    func testUpdateReEmitsTheNewSnapshot() {
        let source = LiveUnitInputFieldSource()
        var latest: UnitInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(UnitInputFieldInput(value: 42, kind: .speed))
        XCTAssertEqual(latest?.value, 42)
        XCTAssertEqual(latest?.kind, .speed)
    }

    func testCommitForwardsToOnCommitAndReEmits() {
        var committed: [Double?] = []
        let source = LiveUnitInputFieldSource(onCommit: { committed.append($0) })
        var emissions: [Double?] = []
        source.onUpdate = { emissions.append($0.value) }
        source.start()
        source.commit(12.5)
        XCTAssertEqual(committed, [12.5])
        XCTAssertEqual(emissions.last, 12.5)
    }

    func testRefreshReEmitsCurrentValue() {
        let source = LiveUnitInputFieldSource(value: UnitInputFieldInput(value: 5, kind: .energy))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - In-memory source (records commits / push)

@MainActor
final class InMemoryUnitInputFieldSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        let source = InMemoryUnitInputFieldSource(initial: UnitInputFieldInput(value: 1, kind: .energy))
        var latest: UnitInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(latest?.value, 1)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCommitIsRecordedAndPushEmits() {
        let source = InMemoryUnitInputFieldSource()
        var latest: UnitInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.commit(12.5)
        source.commit(nil)
        source.push(UnitInputFieldInput(value: 9, kind: .energy))
        XCTAssertEqual(source.committed, [12.5, nil])
        XCTAssertEqual(latest?.value, 9)
    }
}
