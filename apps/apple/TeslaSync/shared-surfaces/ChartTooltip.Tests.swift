//
//  ChartTooltip.Tests.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  Adapter + projection coverage for the ChartTooltip surface:
//    • ISO detection — the verbatim port of the web `ISO_TS_RE` heuristic.
//    • Number formatting — the locale-aware `fmtNumber` contract (precision, grouping, the
//      `safeNumber` non-finite fallback).
//    • Date/time formatting — the `formatDateTime` parity (ISO → locale + timezone-aware string).
//    • Label formatting — the `defaultLabelFormatter` branches (absent / ISO / plain / numeric).
//    • Value formatting — the `defaultValueFormatter` branches (number / string / nullish).
//    • Projection — the web gate (`!active || !payload.length`) plus the P4 leaf contract across
//      loading / empty / error / data.
//    • Accessibility — the composed VoiceOver row + panel summary labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

// MARK: - ISO detection (web `ISO_TS_RE`)

final class ChartTooltipISODetectionTests: XCTestCase {
    func testAcceptsTimestampsWithAtLeastMinutePrecision() {
        XCTAssertTrue(ChartTooltipFormat.isIsoTimestamp("2026-04-04T14:30"))
        XCTAssertTrue(ChartTooltipFormat.isIsoTimestamp("2026-04-04T14:30:00Z"))
        XCTAssertTrue(ChartTooltipFormat.isIsoTimestamp("2026-04-04T14:30:00.123Z"))
    }

    func testRejectsNonTimestampLabels() {
        XCTAssertFalse(ChartTooltipFormat.isIsoTimestamp("Apr 4"))
        XCTAssertFalse(ChartTooltipFormat.isIsoTimestamp("14:30"))
        XCTAssertFalse(ChartTooltipFormat.isIsoTimestamp("2026-04-04"))
        XCTAssertFalse(ChartTooltipFormat.isIsoTimestamp("2026/04/04T14:30"))
        XCTAssertFalse(ChartTooltipFormat.isIsoTimestamp(""))
    }
}

// MARK: - Number formatting (web `fmtNumber`)

final class ChartTooltipNumberFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testDefaultPrecisionIsTwoWithGrouping() {
        XCTAssertEqual(ChartTooltipFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(ChartTooltipFormat.number(42, locale: enUS), "42.00")
    }

    func testRoundsToRequestedPrecision() {
        XCTAssertEqual(ChartTooltipFormat.number(1234.567, precision: 2, locale: enUS), "1,234.57")
        XCTAssertEqual(ChartTooltipFormat.number(1234.4, precision: 0, locale: enUS), "1,234")
    }

    func testNonFiniteFallsBackToZero() {
        XCTAssertEqual(ChartTooltipFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(ChartTooltipFormat.number(.infinity, locale: enUS), "0.00")
    }
}

// MARK: - Date/time formatting (web `formatDateTime`)

final class ChartTooltipDateTimeFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")
    private let utc = TimeZone(identifier: "UTC")!

    func testFormatsIsoTimestampInLocaleAndZone() {
        let formatted = ChartTooltipFormat.dateTime("2026-04-04T14:30:00Z", locale: enUS, timeZone: utc)
        XCTAssertEqual(formatted, "Apr 4, 2026, 2:30 PM")
    }

    func testReturnsNilForUnparseableValue() {
        XCTAssertNil(ChartTooltipFormat.dateTime("not a date", locale: enUS, timeZone: utc))
    }
}

// MARK: - Label formatting (web `defaultLabelFormatter`)

final class ChartTooltipLabelFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")
    private let utc = TimeZone(identifier: "UTC")!

    func testAbsentLabelIsEmptyString() {
        XCTAssertEqual(ChartTooltipFormat.formatLabel(.absent, locale: enUS, timeZone: utc), "")
    }

    func testIsoTextLabelIsFormatted() {
        let formatted = ChartTooltipFormat.formatLabel(.text("2026-04-04T14:30:00Z"), locale: enUS, timeZone: utc)
        XCTAssertEqual(formatted, "Apr 4, 2026, 2:30 PM")
    }

    func testPlainTextLabelPassesThrough() {
        XCTAssertEqual(ChartTooltipFormat.formatLabel(.text("14:30"), locale: enUS, timeZone: utc), "14:30")
    }

    func testNumericLabelRendersAsPlainNumber() {
        XCTAssertEqual(ChartTooltipFormat.formatLabel(.number(42), locale: enUS, timeZone: utc), "42")
        XCTAssertEqual(ChartTooltipFormat.formatLabel(.number(42.5), locale: enUS, timeZone: utc), "42.5")
    }
}

// MARK: - Value formatting (web `defaultValueFormatter`)

final class ChartTooltipValueFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testNumberValueUsesLocaleNumberFormat() {
        XCTAssertEqual(ChartTooltipFormat.valueString(.number(1234.5), locale: enUS), "1,234.50")
    }

    func testStringValuePassesThrough() {
        XCTAssertEqual(ChartTooltipFormat.valueString(.text("on"), locale: enUS), "on")
    }

    func testEmptyValueRendersEmptyString() {
        XCTAssertEqual(ChartTooltipFormat.valueString(.empty, locale: enUS), "")
    }
}

// MARK: - Projection (web gate + P4 leaf contract)

final class ChartTooltipProjectionTests: XCTestCase {
    private let series = [
        ChartTooltipSeries(id: "soc", name: "Battery", value: .number(72.4), unit: "%", colorIndex: 0)
    ]

    func testErrorTakesPrecedence() {
        let resolved = ChartTooltipProjection.resolve(
            ChartTooltipInput(isActive: true, series: series, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.series.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = ChartTooltipProjection.resolve(ChartTooltipInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenInactive() {
        let resolved = ChartTooltipProjection.resolve(ChartTooltipInput(isActive: false, series: series))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testEmptyWhenActiveButNoSeries() {
        let resolved = ChartTooltipProjection.resolve(ChartTooltipInput(isActive: true, series: []))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testDataWhenActiveWithSeries() {
        let resolved = ChartTooltipProjection.resolve(
            ChartTooltipInput(isActive: true, label: .text("2026-04-04T14:30:00Z"), series: series)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.series.count, 1)
        XCTAssertEqual(resolved.label, .text("2026-04-04T14:30:00Z"))
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = ChartTooltipProjection.resolve(
            ChartTooltipInput(isActive: true, series: series, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility summaries

final class ChartTooltipAccessibilityTests: XCTestCase {
    func testRowLabelIncludesUnitWhenPresent() {
        let label = ChartTooltipAccessibility.rowLabel(name: "Battery", value: "72.40", unit: "%")
        XCTAssertEqual(label, "Battery: 72.40 %")
    }

    func testRowLabelOmitsUnitWhenAbsent() {
        let label = ChartTooltipAccessibility.rowLabel(name: "State", value: "on", unit: nil)
        XCTAssertEqual(label, "State: on")
    }

    func testSummaryPrefixesLabelThenJoinsRows() {
        let summary = ChartTooltipAccessibility.summary(
            label: "Apr 4, 2026, 2:30 PM",
            rows: ["Battery: 72.40 %", "Speed: 96.00 km/h"]
        )
        XCTAssertEqual(summary, "Apr 4, 2026, 2:30 PM. Battery: 72.40 %, Speed: 96.00 km/h")
    }

    func testSummaryWithoutLabelJoinsRowsOnly() {
        let summary = ChartTooltipAccessibility.summary(label: "", rows: ["Battery: 72.40 %"])
        XCTAssertEqual(summary, "Battery: 72.40 %")
    }
}
