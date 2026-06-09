//
//  GasPriceSettings.Tests.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  Adapter + projection + accessibility unit coverage for the GasPriceSettings surface:
//    • Adapter — the poll-interval catalogue/parse, the `formatCurrency` port (symbol +
//      grouping + decimals), the `current_price ? … : '—'` price cell, the gas-unit
//      suffix, the `formatDateTime` port, and the "Never" / Go zero-time timestamp
//      parse.
//    • Projection — `GasPriceSettingsProjection` across loading / empty / error / data
//      and the price / timestamp shaping.
//    • Accessibility — the VoiceOver cell / toggle / help label content.
//
//  The state-holder coverage (`GasPriceSettingsModel` wiring, telemetry, the three
//  mutations + toast routing, the poll-spinner guard, the stale auto-refresh, and the
//  formatting injection) lives in `GasPriceSettings.ModelTests.swift` so each file stays
//  within the 400-line budget.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store, and the locale + time zone + formatting are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!
private let usd = GasPriceFormatting(currencySymbol: "$", gasUnit: "gallon", decimals: 2)

private func makeDate(year: Int, month: Int, day: Int, hour: Int, minute: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
}

private let polledDate = makeDate(year: 2026, month: 4, day: 4, hour: 14, minute: 30)

private let runningRecord = GasPriceRecord(
    enabled: true,
    pollInterval: .weekly,
    currentPrice: 3.45,
    lastPollTime: polledDate
)

// MARK: - Adapter: poll-interval catalogue

final class GasPollIntervalTests: XCTestCase {
    func testRawValuesMatchTheWireTokens() {
        XCTAssertEqual(GasPollInterval.daily.rawValue, "daily")
        XCTAssertEqual(GasPollInterval.weekly.rawValue, "7d")
        XCTAssertEqual(GasPollInterval.biweekly.rawValue, "15d")
        XCTAssertEqual(GasPollInterval.monthly.rawValue, "30d")
    }

    func testParseKnownTokens() {
        XCTAssertEqual(GasPollInterval.parse("daily"), .daily)
        XCTAssertEqual(GasPollInterval.parse("7d"), .weekly)
        XCTAssertEqual(GasPollInterval.parse("15d"), .biweekly)
        XCTAssertEqual(GasPollInterval.parse("30d"), .monthly)
    }

    func testParseUnknownOrNilFallsBackToWeekly() {
        XCTAssertEqual(GasPollInterval.parse(nil), .weekly)
        XCTAssertEqual(GasPollInterval.parse(""), .weekly)
        XCTAssertEqual(GasPollInterval.parse("yearly"), .weekly)
    }

    func testCatalogueIsOrderedDailyToMonthly() {
        XCTAssertEqual(GasPollInterval.allCases, [.daily, .weekly, .biweekly, .monthly])
    }
}

// MARK: - Adapter: currency / price / unit formatting

final class GasPriceFormatCurrencyTests: XCTestCase {
    func testCurrencyPrependsSymbolWithFixedFraction() {
        XCTAssertEqual(GasPriceFormat.currency(3.45, formatting: usd, locale: enUS), "$3.45")
    }

    func testCurrencyGroupsThousands() {
        XCTAssertEqual(GasPriceFormat.currency(1234.5, formatting: usd, locale: enUS), "$1,234.50")
    }

    func testCurrencyHonoursDecimalsAndSymbol() {
        let euroZero = GasPriceFormatting(currencySymbol: "€", gasUnit: "liter", decimals: 0)
        XCTAssertEqual(GasPriceFormat.currency(3.45, formatting: euroZero, locale: enUS), "€3")
    }

    func testPriceAppendsGallonUnit() {
        XCTAssertEqual(GasPriceFormat.price(3.45, formatting: usd, locale: enUS), "$3.45/gal")
    }

    func testPriceAppendsLiterUnit() {
        let liters = GasPriceFormatting(currencySymbol: "$", gasUnit: "liter", decimals: 2)
        XCTAssertEqual(GasPriceFormat.price(2, formatting: liters, locale: enUS), "$2.00/L")
    }

    func testPriceFalsyValueFallsBackToDash() {
        XCTAssertEqual(GasPriceFormat.price(0, formatting: usd, locale: enUS), GasPriceFormat.dash)
        XCTAssertEqual(GasPriceFormat.price(-1, formatting: usd, locale: enUS), GasPriceFormat.dash)
        XCTAssertEqual(GasPriceFormat.price(.nan, formatting: usd, locale: enUS), GasPriceFormat.dash)
    }

    func testUnitLabelMapsGasUnit() {
        XCTAssertEqual(GasPriceFormatting(gasUnit: "liter").unitLabel, "L")
        XCTAssertEqual(GasPriceFormatting(gasUnit: "LITER").unitLabel, "L")
        XCTAssertEqual(GasPriceFormatting(gasUnit: "gallon").unitLabel, "gal")
    }
}

// MARK: - Adapter: timestamp parse + date formatting

final class GasPriceFormatDateTests: XCTestCase {
    func testParseNilOrEmptyIsNever() {
        XCTAssertNil(GasPriceFormat.parseTimestamp(nil))
        XCTAssertNil(GasPriceFormat.parseTimestamp(""))
        XCTAssertNil(GasPriceFormat.parseTimestamp("   "))
    }

    func testParseGoZeroTimeSentinelIsNever() {
        XCTAssertNil(GasPriceFormat.parseTimestamp(GasPriceFormat.zeroTime))
        XCTAssertNil(GasPriceFormat.parseTimestamp("0001-01-01T00:00:00Z"))
    }

    func testParseValidTimestamps() {
        XCTAssertNotNil(GasPriceFormat.parseTimestamp("2026-04-04T14:30:00Z"))
        XCTAssertNotNil(GasPriceFormat.parseTimestamp("2026-04-04T14:30:00.500Z"))
    }

    func testDateTimeRendersAbbreviatedMonthYearAndTime() {
        let rendered = GasPriceFormat.dateTime(polledDate, locale: enUS, timeZone: utc)
        XCTAssertTrue(rendered.contains("2026"), rendered)
        XCTAssertTrue(rendered.contains("Apr"), rendered)
        XCTAssertTrue(rendered.contains("PM"), rendered)
        XCTAssertTrue(rendered.contains("2:30"), rendered)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class GasPriceSettingsProjectionTests: XCTestCase {
    private func resolve(_ input: GasPriceSettingsInput) -> GasPriceSettingsResolved {
        GasPriceSettingsProjection.resolve(input, formatting: usd, locale: enUS, timeZone: utc)
    }

    func testErrorTakesPrecedence() {
        let resolved = resolve(GasPriceSettingsInput(status: runningRecord, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(resolve(GasPriceSettingsInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenNoStatus() {
        XCTAssertEqual(resolve(GasPriceSettingsInput(status: nil)).phase, .empty)
    }

    func testDataWhenStatusPresent() {
        let resolved = resolve(GasPriceSettingsInput(status: runningRecord))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.enabled)
        XCTAssertEqual(resolved.pollInterval, .weekly)
    }

    func testCurrentPriceLabelFormatsWhenPositive() {
        let resolved = resolve(GasPriceSettingsInput(status: runningRecord))
        XCTAssertEqual(resolved.currentPriceLabel, "$3.45/gal")
    }

    func testCurrentPriceLabelDashWhenZero() {
        let record = GasPriceRecord(enabled: false, pollInterval: .daily, currentPrice: 0, lastPollTime: nil)
        let resolved = resolve(GasPriceSettingsInput(status: record))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.currentPriceLabel, GasPriceFormat.dash)
    }

    func testLastPolledLabelComputedWhenPresent() {
        let resolved = resolve(GasPriceSettingsInput(status: runningRecord))
        XCTAssertNotNil(resolved.lastPolledLabel)
        XCTAssertTrue((resolved.lastPolledLabel ?? "").contains("2026"))
    }

    func testLastPolledLabelNilWhenNeverPolled() {
        let record = GasPriceRecord(enabled: true, pollInterval: .weekly, currentPrice: 3, lastPollTime: nil)
        XCTAssertNil(resolve(GasPriceSettingsInput(status: record)).lastPolledLabel)
    }

    func testEmptyStatusShapesFallbacks() {
        let resolved = resolve(GasPriceSettingsInput(status: nil))
        XCTAssertFalse(resolved.enabled)
        XCTAssertEqual(resolved.pollInterval, .weekly)
        XCTAssertEqual(resolved.currentPriceLabel, GasPriceFormat.dash)
        XCTAssertNil(resolved.lastPolledLabel)
    }
}

// MARK: - Accessibility summary content

final class GasPriceAccessibilityTests: XCTestCase {
    func testInfoLabelJoinsParts() {
        XCTAssertEqual(
            GasPriceAccessibility.infoLabel(label: "Current Price", value: "$3.45/gal"),
            "Current Price, $3.45/gal"
        )
    }

    func testToggleLabelJoinsParts() {
        XCTAssertEqual(
            GasPriceAccessibility.toggleLabel(label: "Auto-Poll", state: "Running"),
            "Auto-Poll, Running"
        )
    }

    func testHelpLabelFormatsField() {
        XCTAssertEqual(
            GasPriceAccessibility.helpLabel(format: "Help for %@", field: "gas-auto-poll"),
            "Help for gas-auto-poll"
        )
    }
}
