//
//  WeekOverWeekSummary.Tests.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  Unit coverage for the WeekOverWeekSummary surface:
//    • Adapter — `WeekOverWeekFormatting` (web `fmtNumber`/`fmtInt`/`formatCurrency`
//      parity), `WeekOverWeekTrendCalculator` (web `pctChange`/`trendFor`, incl. the
//      flat band and `invertPositive` polarity), and `WeekOverWeekProjection` (the
//      ordered six-tile web JSX grid, with units + invert flags).
//    • Accessibility — the composed VoiceOver label builders + i18n interpolation.
//
//  The `WeekOverWeekSummaryModel` state-machine / freshness / telemetry coverage lives
//  in the sibling `WeekOverWeekSummary.ModelTests.swift` (kept separate so each file
//  stays within the SwiftLint file-length budget).
//
//  These run in the TeslaSync(/-macOS) XCTest scope. They have no network and no real
//  store: the model is driven by `InMemoryWeekOverWeekSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum WeekOverWeekFixture {
    static let sample = WeekOverWeekMetrics(
        totalDistance: 312.4,
        prevDistance: 280.1,
        totalDrives: 18,
        prevDriveCount: 15,
        energyUsed: 64.2,
        prevEnergy: 70.5,
        chargingCost: 12.80,
        prevChargingCost: 15.10,
        avgEfficiency: 205.6,
        prevAvgEfficiency: 212.0,
        co2Saved: 22.6,
        prevCo2: 19.8
    )

    /// Energy/cost/efficiency all RISING vs prior week (the "worse" direction) so the
    /// inverted-polarity tiles read as negative changes.
    static let regressing = WeekOverWeekMetrics(
        totalDistance: 100,
        prevDistance: 80,
        totalDrives: 10,
        prevDriveCount: 8,
        energyUsed: 80,
        prevEnergy: 70,
        chargingCost: 20,
        prevChargingCost: 15,
        avgEfficiency: 220,
        prevAvgEfficiency: 200,
        co2Saved: 5,
        prevCo2: 4
    )
}

// MARK: - Adapter: formatting (web `numberFormat` parity)

@MainActor final class WeekOverWeekFormattingTests: XCTestCase {
    private let formatting = WeekOverWeekFormatting.standard

    func testNumberAddsGroupingAndFixedFractionDigits() {
        XCTAssertEqual(formatting.number(1234.5, decimals: 1), "1,234.5")
        XCTAssertEqual(formatting.number(312.4, decimals: 1), "312.4")
        XCTAssertEqual(formatting.number(0, decimals: 1), "0.0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(formatting.number(2.45, decimals: 1), "2.5")
        XCTAssertEqual(formatting.number(8.93617, decimals: 1), "8.9")
    }

    func testIntRoundsAndGroups() {
        XCTAssertEqual(formatting.int(12345.6), "12,346")
        XCTAssertEqual(formatting.int(18), "18")
    }

    func testCurrencyPrependsSymbolAtPrecision() {
        XCTAssertEqual(formatting.currency(12.80, decimals: 2), "$12.80")
        XCTAssertEqual(formatting.currency(0, decimals: 2), "$0.00")
        XCTAssertEqual(formatting.currency(1500.5), "$1,500.50")
    }

    func testNonFiniteInputFormatsAsZero() {
        XCTAssertEqual(formatting.number(.nan, decimals: 1), "0.0")
        XCTAssertEqual(formatting.number(.infinity, decimals: 2), "0.00")
    }

    func testCustomLocaleAndSymbol() {
        let euro = WeekOverWeekFormatting(currencySymbol: "€", precision: 2, localeIdentifier: "en_US")
        XCTAssertEqual(euro.currency(9.5), "€9.50")
    }
}

// MARK: - Adapter: trend (web `helpers.trendFor`)

@MainActor final class WeekOverWeekTrendCalculatorTests: XCTestCase {
    func testPctChangeHandlesZeroPrevious() {
        XCTAssertEqual(WeekOverWeekTrendCalculator.pctChange(current: 5, previous: 0), 100)
        XCTAssertEqual(WeekOverWeekTrendCalculator.pctChange(current: 0, previous: 0), 0)
        XCTAssertEqual(WeekOverWeekTrendCalculator.pctChange(current: -3, previous: 0), 0)
    }

    func testPctChangeUsesAbsolutePrevious() {
        XCTAssertEqual(WeekOverWeekTrendCalculator.pctChange(current: 50, previous: 40), 25, accuracy: 0.0001)
        XCTAssertEqual(WeekOverWeekTrendCalculator.pctChange(current: 30, previous: -60), 150, accuracy: 0.0001)
    }

    func testFlatBandBelowOneHundredth() {
        let trend = WeekOverWeekTrendCalculator.trend(current: 100.005, previous: 100)
        XCTAssertEqual(trend.direction, .flat)
        XCTAssertEqual(trend.value, "0%")
        XCTAssertTrue(trend.positive)
    }

    func testRisingTrendSignedAndPositive() {
        let trend = WeekOverWeekTrendCalculator.trend(current: 110, previous: 100)
        XCTAssertEqual(trend.direction, .up)
        XCTAssertEqual(trend.value, "+10.0%")
        XCTAssertTrue(trend.positive)
    }

    func testFallingTrendIsNegative() {
        let trend = WeekOverWeekTrendCalculator.trend(current: 90, previous: 100)
        XCTAssertEqual(trend.direction, .down)
        XCTAssertEqual(trend.value, "-10.0%")
        XCTAssertFalse(trend.positive)
    }

    func testInvertPositiveFlipsPolarityNotDirection() {
        // Lower-is-better metric falling: numeric direction down, but a *good* change.
        let trend = WeekOverWeekTrendCalculator.trend(current: 90, previous: 100, invertPositive: true)
        XCTAssertEqual(trend.direction, .down)
        XCTAssertEqual(trend.value, "-10.0%")
        XCTAssertTrue(trend.positive)
    }

    func testInvertPositiveRisingIsBad() {
        // Lower-is-better metric rising: numeric direction up, but a *bad* change.
        let trend = WeekOverWeekTrendCalculator.trend(current: 110, previous: 100, invertPositive: true)
        XCTAssertEqual(trend.direction, .up)
        XCTAssertFalse(trend.positive)
    }
}

// MARK: - Adapter: projection (web JSX → ordered grid)

@MainActor final class WeekOverWeekProjectionTests: XCTestCase {
    func testProjectionOrderMatchesWebJSX() {
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample)
        XCTAssertEqual(
            items.map(\.id),
            [
                WeekOverWeekKeys.distance,
                WeekOverWeekKeys.drives,
                WeekOverWeekKeys.energy,
                WeekOverWeekKeys.cost,
                WeekOverWeekKeys.efficiency,
                WeekOverWeekKeys.co2
            ]
        )
    }

    func testProjectionAlwaysRendersSixTiles() {
        XCTAssertEqual(WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample).count, 6)
        XCTAssertEqual(WeekOverWeekProjection.items(from: WeekOverWeekFixture.regressing).count, 6)
    }

    func testTileValuesMatchWebFormatting() {
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample)
        XCTAssertEqual(items[0].value, "312.4")
        XCTAssertEqual(items[1].value, "18")
        XCTAssertEqual(items[2].value, "64.2")
        XCTAssertEqual(items[3].value, "$12.80")
        XCTAssertEqual(items[4].value, "205.6")
        XCTAssertEqual(items[5].value, "22.6")
    }

    func testTileUnitsMatchWebProps() {
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample)
        XCTAssertEqual(items[0].unitFallback, "km")
        XCTAssertNil(items[1].unitKey)
        XCTAssertNil(items[1].unitFallback)
        XCTAssertEqual(items[2].unitFallback, "kWh")
        XCTAssertNil(items[3].unitKey)
        XCTAssertEqual(items[4].unitFallback, "Wh/km")
        XCTAssertEqual(items[5].unitFallback, "kg")
    }

    func testTileIconsAndLabelKeys() {
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample)
        XCTAssertEqual(items[0].systemImage, "car.fill")
        XCTAssertEqual(items[0].labelKey, WeekOverWeekKeys.distance)
        XCTAssertEqual(items[1].systemImage, "waveform.path.ecg")
        XCTAssertEqual(items[2].systemImage, "bolt.fill")
        XCTAssertEqual(items[3].systemImage, "fuelpump.fill")
        XCTAssertEqual(items[4].systemImage, "chart.bar.fill")
        XCTAssertEqual(items[5].systemImage, "leaf.fill")
    }

    func testDistanceDrivesCo2UseDirectPolarity() {
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.sample)
        // All three rose week-over-week → good (positive) with an up arrow.
        for index in [0, 1, 5] {
            XCTAssertEqual(items[index].trend?.direction, .up)
            XCTAssertEqual(items[index].trend?.positive, true)
        }
    }

    func testEnergyCostEfficiencyUseInvertedPolarity() {
        // In the regressing fixture all three RISE (worse) → up arrow, but *negative*.
        let items = WeekOverWeekProjection.items(from: WeekOverWeekFixture.regressing)
        let energy = items.first { $0.id == WeekOverWeekKeys.energy }
        let cost = items.first { $0.id == WeekOverWeekKeys.cost }
        let efficiency = items.first { $0.id == WeekOverWeekKeys.efficiency }
        XCTAssertEqual(energy?.trend?.direction, .up)
        XCTAssertEqual(energy?.trend?.positive, false)
        XCTAssertEqual(cost?.trend?.positive, false)
        XCTAssertEqual(efficiency?.trend?.positive, false)
    }

    func testFirstWeekZeroPreviousReadsAsHundredPercent() {
        var metrics = WeekOverWeekFixture.sample
        metrics.prevDistance = 0
        let items = WeekOverWeekProjection.items(from: metrics)
        XCTAssertEqual(items[0].trend?.direction, .up)
        XCTAssertEqual(items[0].trend?.value, "+100.0%")
    }
}

// MARK: - Accessibility + i18n composition

@MainActor final class WeekOverWeekAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func distanceItem() -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.distance,
            systemImage: "car.fill",
            labelKey: WeekOverWeekKeys.distance,
            labelFallback: "Distance",
            value: "312.4",
            unitKey: WeekOverWeekKeys.unitKm,
            unitFallback: "km",
            trend: WeekOverWeekTrend(direction: .up, value: "+11.5%", positive: true)
        )
    }

    private func drivesItem() -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.drives,
            systemImage: "waveform.path.ecg",
            labelKey: WeekOverWeekKeys.drives,
            labelFallback: "Drives",
            value: "18",
            unitKey: nil,
            unitFallback: nil,
            trend: WeekOverWeekTrend(direction: .up, value: "+20.0%", positive: true)
        )
    }

    func testTileLabelComposesLabelValueUnitAndChange() {
        XCTAssertEqual(
            WeekOverWeekAccessibility.tileLabel(distanceItem(), localize: echo),
            "Distance, 312.4 km, change +11.5%"
        )
    }

    func testTileLabelOmitsUnitWhenUnitLess() {
        XCTAssertEqual(
            WeekOverWeekAccessibility.tileLabel(drivesItem(), localize: echo),
            "Drives, 18, change +20.0%"
        )
    }

    func testValuePhraseAppendsUnitOnlyWhenPresent() {
        XCTAssertEqual(WeekOverWeekAccessibility.valuePhrase(distanceItem(), localize: echo), "312.4 km")
        XCTAssertEqual(WeekOverWeekAccessibility.valuePhrase(drivesItem(), localize: echo), "18")
    }

    func testFreshnessLabels() {
        XCTAssertEqual(WeekOverWeekAccessibility.freshnessLabel(.online, localize: echo), "Live")
        XCTAssertEqual(WeekOverWeekAccessibility.freshnessLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(WeekOverWeekAccessibility.freshnessLabel(.offline, localize: echo), "Offline")
    }

    func testHeaderLabel() {
        XCTAssertEqual(WeekOverWeekAccessibility.headerLabel(localize: echo), "Week-over-Week Comparison")
    }

    func testInterpolationReplacesTokensWithOptionalSpaces() {
        XCTAssertEqual(
            WeekOverWeekStrings.interpolate("{{a}}-{{ b }}", values: ["a": "X", "b": "Y"]),
            "X-Y"
        )
    }

    func testStringsFacadeFallsBackForUnknownKeys() {
        XCTAssertEqual(
            WeekOverWeekStrings.string("analytics.weeklyDigest.__missing__", "fallback-value"),
            "fallback-value"
        )
    }
}
