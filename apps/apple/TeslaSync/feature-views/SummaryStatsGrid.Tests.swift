//
//  SummaryStatsGrid.Tests.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  Unit coverage for the SummaryStatsGrid surface:
//    • Adapter — `fmtInt` / `fmtNumber` / `formatCurrency` number formatting
//      (numberFormat.ts + useFormatting.ts) across locales and precision, the
//      responsive column math, and the VoiceOver summary content.
//    • State holder — `SummaryStatsGridProjection` across the loading / data branches
//      and each card's label / value / unit, plus the `SummaryStatsGridModel` wiring
//      and the P1/S11 `view.opened` telemetry.
//    • i18n — the per-surface string + unit resolution through the facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySummaryStatsGridSource`, and the
//  locale / precision are injected for determinism.
//

import XCTest

// MARK: - Fixtures

private let enUS = Locale(identifier: "en_US")
private let deDE = Locale(identifier: "de_DE")

private func usdFormatting(precision: Int = 2) -> SummaryStatsGridFormatting {
    SummaryStatsGridFormatting(currencySymbol: "$", decimalPrecision: precision, locale: enUS)
}

private let populatedValues = SummaryStatsGridValues(
    totalSessions: 1284,
    totalEnergy: 18234.7,
    avgRate: 48.6,
    peakRate: 250,
    avgDuration: 42,
    totalCost: 2189.45
)

// MARK: - Number formatting (port of numberFormat.ts + useFormatting.ts)

@MainActor
final class SummaryStatsGridFormatTests: XCTestCase {
    func testIntegerRoundsAndGroups() {
        XCTAssertEqual(SummaryStatsGridFormat.decimal(12345.6, fractionDigits: 0, locale: enUS), "12,346")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(1284, fractionDigits: 0, locale: enUS), "1,284")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(99, fractionDigits: 0, locale: enUS), "99")
    }

    func testNumberPadsFractionDigits() {
        XCTAssertEqual(SummaryStatsGridFormat.decimal(18234.7, fractionDigits: 2, locale: enUS), "18,234.70")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(48.6, fractionDigits: 2, locale: enUS), "48.60")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(250, fractionDigits: 2, locale: enUS), "250.00")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(SummaryStatsGridFormat.decimal(.nan, fractionDigits: 0, locale: enUS), "0")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(.infinity, fractionDigits: 2, locale: enUS), "0.00")
        XCTAssertEqual(SummaryStatsGridFormat.decimal(-.infinity, fractionDigits: 2, locale: enUS), "0.00")
    }

    func testLocaleSeparatorsFollowLocale() {
        // de_DE uses "." for grouping and "," for the decimal mark.
        XCTAssertEqual(SummaryStatsGridFormat.decimal(1234.5, fractionDigits: 2, locale: deDE), "1.234,50")
    }
}

// MARK: - useFormatting mirror (symbol + precision)

@MainActor
final class SummaryStatsGridFormattingTests: XCTestCase {
    func testIntegerNumberAndCurrency() {
        let fmt = usdFormatting()
        XCTAssertEqual(fmt.integer(1284), "1,284")
        XCTAssertEqual(fmt.number(48.6), "48.60")
        XCTAssertEqual(fmt.currency(2189.45), "$2,189.45")
    }

    func testBlankCurrencySymbolFallsBackToUSD() {
        let fmt = SummaryStatsGridFormatting(currencySymbol: "  ", decimalPrecision: 2, locale: enUS)
        XCTAssertEqual(fmt.currencySymbol, "$")
        XCTAssertEqual(fmt.currency(10), "$10.00")
    }

    func testCustomSymbolAndLocale() {
        let fmt = SummaryStatsGridFormatting(currencySymbol: "€", decimalPrecision: 2, locale: deDE)
        XCTAssertEqual(fmt.currency(1342.8), "€1.342,80")
    }

    func testCustomPrecision() {
        let fmt = usdFormatting(precision: 0)
        XCTAssertEqual(fmt.number(48.6), "49")
        XCTAssertEqual(fmt.currency(2189.45), "$2,189")
    }
}

// MARK: - Responsive column math (web grid-cols-2 / lg:3 / xl:6)

@MainActor
final class SummaryStatsGridLayoutTests: XCTestCase {
    func testColumnsAtBreakpoints() {
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 320), 2)
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 1023), 2)
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 1024), 3)
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 1279), 3)
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 1280), 6)
        XCTAssertEqual(SummaryStatsGridLayout.columnCount(forWidth: 1920), 6)
    }
}

// MARK: - Projection: branches + card wiring

@MainActor
final class SummaryStatsGridProjectionTests: XCTestCase {
    func testLoadingBranchNullsEveryCardValue() {
        let resolved = SummaryStatsGridProjection.resolve(
            SummaryStatsGridInput(values: populatedValues, formatting: usdFormatting(), isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.cards.count, 6)
        XCTAssertTrue(resolved.cards.allSatisfy { $0.value == nil })
        // Labels are still present so the loading cards keep their headings.
        XCTAssertEqual(resolved.cards.map(\.id), [
            "totalSessions", "totalEnergy", "avgChargeRate", "peakRate", "avgDuration", "totalCost"
        ])
    }

    func testDataBranchBuildsSixCards() {
        let resolved = SummaryStatsGridProjection.resolve(
            SummaryStatsGridInput(values: populatedValues, formatting: usdFormatting())
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.cards.count, 6)

        XCTAssertEqual(resolved.cards[0].labelKey, "charging.curve.totalSessions")
        XCTAssertEqual(resolved.cards[0].value, "1,284")
        XCTAssertNil(resolved.cards[0].unit)

        XCTAssertEqual(resolved.cards[1].labelKey, "charging.curve.totalEnergy")
        XCTAssertEqual(resolved.cards[1].value, "18,234.70")
        XCTAssertEqual(resolved.cards[1].unit?.fallback, "kWh")

        XCTAssertEqual(resolved.cards[2].labelKey, "charging.curve.avgChargeRate")
        XCTAssertEqual(resolved.cards[2].value, "48.60")
        XCTAssertEqual(resolved.cards[2].unit?.fallback, "kW")

        XCTAssertEqual(resolved.cards[3].labelKey, "charging.curve.peakRate")
        XCTAssertEqual(resolved.cards[3].value, "250.00")
        XCTAssertEqual(resolved.cards[3].unit?.fallback, "kW")

        XCTAssertEqual(resolved.cards[4].labelKey, "charging.curve.avgDuration")
        XCTAssertEqual(resolved.cards[4].value, "42")
        XCTAssertEqual(resolved.cards[4].unit?.fallback, "min")

        XCTAssertEqual(resolved.cards[5].labelKey, "charging.curve.totalCost")
        XCTAssertEqual(resolved.cards[5].value, "$2,189.45")
        XCTAssertNil(resolved.cards[5].unit)
    }

    func testNullValuesRenderZeros() {
        let resolved = SummaryStatsGridProjection.resolve(
            SummaryStatsGridInput(values: nil, formatting: usdFormatting())
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.cards[0].value, "0")
        XCTAssertEqual(resolved.cards[1].value, "0.00")
        XCTAssertEqual(resolved.cards[4].value, "0")
        XCTAssertEqual(resolved.cards[5].value, "$0.00")
    }
}

// MARK: - Card facade resolution

@MainActor
final class SummaryStatsGridCardTests: XCTestCase {
    func testResolvedLabelAndUnitFallThroughToEnglish() {
        let card = SummaryStatsGridCard(
            id: "totalEnergy",
            labelKey: "charging.curve.totalEnergy",
            labelFallback: "Total Energy",
            value: "18,234.70",
            unit: SummaryStatsGridUnit(key: "charging.curve.unit.kwh", fallback: "kWh")
        )
        XCTAssertEqual(card.resolvedLabel, "Total Energy")
        XCTAssertEqual(card.resolvedUnit, "kWh")
        XCTAssertEqual(card.accessibilityText, "Total Energy, 18,234.70 kWh")
    }

    func testLoadingCardAccessibilityUsesLoadingWord() {
        let card = SummaryStatsGridCard(
            id: "totalCost",
            labelKey: "charging.curve.totalCost",
            labelFallback: "Total Cost",
            value: nil,
            unit: nil
        )
        XCTAssertNil(card.resolvedUnit)
        XCTAssertEqual(card.accessibilityText, "Total Cost, Loading")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class SummaryStatsGridAccessibilityTests: XCTestCase {
    func testCardLabelWithUnit() {
        XCTAssertEqual(
            SummaryStatsGridAccessibility.cardLabel(label: "Total Energy", value: "18,234.70", unit: "kWh"),
            "Total Energy, 18,234.70 kWh"
        )
    }

    func testCardLabelWithoutUnit() {
        XCTAssertEqual(
            SummaryStatsGridAccessibility.cardLabel(label: "Total Sessions", value: "1,284", unit: nil),
            "Total Sessions, 1,284"
        )
        XCTAssertEqual(
            SummaryStatsGridAccessibility.cardLabel(label: "Total Sessions", value: "1,284", unit: ""),
            "Total Sessions, 1,284"
        )
    }
}

// MARK: - i18n facade

@MainActor
final class SummaryStatsGridStringsTests: XCTestCase {
    func testUnitSymbolsResolveToFallback() {
        XCTAssertEqual(SSGStrings.string("charging.curve.unit.kwh", "kWh"), "kWh")
        XCTAssertEqual(SSGStrings.string("charging.curve.unit.kw", "kW"), "kW")
        XCTAssertEqual(SSGStrings.string("charging.curve.unit.min", "min"), "min")
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class SummaryStatsGridModelTests: XCTestCase {
    private func makeModel(
        _ input: SummaryStatsGridInput,
        telemetry: SummaryStatsGridTelemetry
    ) -> (SummaryStatsGridModel, InMemorySummaryStatsGridSource) {
        let source = InMemorySummaryStatsGridSource(initial: input)
        let model = SummaryStatsGridModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySummaryStatsGridTelemetry()
        let (model, source) = makeModel(
            SummaryStatsGridInput(values: populatedValues, formatting: usdFormatting()),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[5].value, "$2,189.45")
        XCTAssertEqual(spy.surfaces, [SummaryStatsGrid.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(
            SummaryStatsGridInput(formatting: usdFormatting(), isLoading: true),
            telemetry: SpySummaryStatsGridTelemetry()
        )
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertTrue(model.cards.allSatisfy { $0.value == nil })
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(
            SummaryStatsGridInput(formatting: usdFormatting(), isLoading: true),
            telemetry: SpySummaryStatsGridTelemetry()
        )
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SummaryStatsGridInput(values: populatedValues, formatting: usdFormatting()))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.cards[1].value, "18,234.70")
    }

    func testStopDelegatesToSourceAndReArms() {
        let (model, source) = makeModel(
            SummaryStatsGridInput(values: populatedValues, formatting: usdFormatting()),
            telemetry: SpySummaryStatsGridTelemetry()
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
private final class SpySummaryStatsGridTelemetry: SummaryStatsGridTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
