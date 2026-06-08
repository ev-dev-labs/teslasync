//
//  DriveStatCards.AdapterTests.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  Adapter-level coverage for the DriveStatCards surface: the `DriveStatCardsUnitMath`
//  conversion / formatting / duration helpers (web `convertDistanceFromSI` / `fmtNumber` /
//  `fmtInt` / `formatDuration` parity) and the `DriveStatCardsAccessibility` VoiceOver tile
//  summary incl. the `Cost / {{unit}}` interpolation. Pure value-in / value-out — no store,
//  no bundle, no rendered view.
//

import XCTest
@testable import TeslaSync

// MARK: - Conversion + formatting (web parity)

final class DriveStatCardsUnitMathTests: XCTestCase {
    func testSafeCoercesNonFinite() {
        XCTAssertEqual(DriveStatCardsUnitMath.safe(42), 42, accuracy: 0.0001)
        XCTAssertEqual(DriveStatCardsUnitMath.safe(.nan), 0)
        XCTAssertEqual(DriveStatCardsUnitMath.safe(.infinity), 0)
        XCTAssertEqual(DriveStatCardsUnitMath.safe(-.infinity), 0)
    }

    func testDistanceConversionMatchesWeb() {
        // convertDistanceFromSI(meters, unit): "km" / "mi" / "ft" exact factors.
        XCTAssertEqual(DriveStatCardsUnitMath.distanceFromSI(412_700, "km"), 412.7, accuracy: 0.0001)
        XCTAssertEqual(DriveStatCardsUnitMath.distanceFromSI(412_700, "mi"), 256.43989, accuracy: 0.001)
        XCTAssertEqual(DriveStatCardsUnitMath.distanceFromSI(1609.344, "mi"), 1.0, accuracy: 0.000001)
        XCTAssertEqual(DriveStatCardsUnitMath.distanceFromSI(30.48, "ft"), 100.0, accuracy: 0.000001)
        // Unknown unit falls back to kilometers (web default branch).
        XCTAssertEqual(DriveStatCardsUnitMath.distanceFromSI(1000, "parsec"), 1.0, accuracy: 0.000001)
    }

    func testFmtNumberGroupingRoundingAndPrecision() {
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(256.43989, decimals: 1), "256.4")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(412.7, decimals: 1), "412.7")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(1240, decimals: 0), "1,240")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(285, decimals: 2), "285.00")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(7.488, decimals: 2), "7.49")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(0.0292, decimals: 3), "0.029")
    }

    func testFmtNumberGuardsNonFinite() {
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(.nan, decimals: 0), "0")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtNumber(.infinity, decimals: 1), "0.0")
    }

    func testFmtIntRoundsToGroupedInteger() {
        XCTAssertEqual(DriveStatCardsUnitMath.fmtInt(88), "88")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtInt(12345.6), "12,346")
        XCTAssertEqual(DriveStatCardsUnitMath.fmtInt(0), "0")
    }

    func testFormatDurationMatchesWeb() {
        // formatDuration(min): h = floor(min / 60), m = round(min % 60).
        XCTAssertEqual(DriveStatCardsUnitMath.formatDuration(minutes: 272), "4h 32m")
        XCTAssertEqual(DriveStatCardsUnitMath.formatDuration(minutes: 45), "45m")
        XCTAssertEqual(DriveStatCardsUnitMath.formatDuration(minutes: 60), "1h 0m")
        XCTAssertEqual(DriveStatCardsUnitMath.formatDuration(minutes: 0), "0m")
        // durationS 3661 / 60 → 61.0166… → 1h 1m (web `formatDuration(durationS / 60)`).
        XCTAssertEqual(DriveStatCardsUnitMath.formatDuration(minutes: 3661.0 / 60), "1h 1m")
    }
}

// MARK: - Accessibility summary

final class DriveStatCardsAccessibilityTests: XCTestCase {
    /// Mirrors the strings facade: substitute positional args into the fallback (bundle-free).
    private let echo: (String, String, [String]) -> String = { _, fallback, args in
        args.isEmpty ? fallback : String(format: fallback, arguments: args)
    }

    func testCardSummaryReadsLabelThenValue() {
        let item = DriveStatCardsItem(
            id: "distance",
            labelKey: "driveDetail.distance",
            labelFallback: "Distance",
            value: "256.4 mi",
            systemImage: "point.topleft.down.to.point.bottomright.curvepath",
            accent: .cyan
        )
        XCTAssertEqual(DriveStatCardsAccessibility.cardSummary(item, localize: echo), "Distance, 256.4 mi")
    }

    func testCardSummaryInterpolatesCostPerUnitLabel() {
        let item = DriveStatCardsItem(
            id: "costPerUnit",
            labelKey: "driveDetail.costPerUnit",
            labelFallback: "Cost / %@",
            labelArgs: ["mi"],
            value: "$0.029",
            systemImage: "chart.line.downtrend.xyaxis",
            accent: .teal
        )
        XCTAssertEqual(DriveStatCardsAccessibility.cardSummary(item, localize: echo), "Cost / mi, $0.029")
    }

    func testCardSummaryReadsEmDashValue() {
        let item = DriveStatCardsItem(
            id: "maxPower",
            labelKey: "driveDetail.maxPower",
            labelFallback: "Max Power",
            value: DriveStatCardsProjection.emDash,
            systemImage: "bolt.fill",
            accent: .amber
        )
        let summary = DriveStatCardsAccessibility.cardSummary(item, localize: echo)
        XCTAssertTrue(summary.contains("Max Power"))
        XCTAssertTrue(summary.contains(DriveStatCardsProjection.emDash))
    }
}
