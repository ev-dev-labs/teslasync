//
//  SleepEfficiencyWidget.FormatTests.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  Pure-function coverage split out of SleepEfficiencyWidget.Tests.swift (the efficiency-zone thresholds +
//  the number formatting / gauge-readout rule) so each file stays within the SwiftLint file-length budget.
//  Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Efficiency zone thresholds (web `efficiencyColor`)

@MainActor final class SleepZoneTests: XCTestCase {
    func testZoneBoundaries() {
        XCTAssertEqual(SleepZone.classify(percent: 0), .low)
        XCTAssertEqual(SleepZone.classify(percent: 85), .low)
        XCTAssertEqual(SleepZone.classify(percent: 85.01), .medium)
        XCTAssertEqual(SleepZone.classify(percent: 95), .medium)
        XCTAssertEqual(SleepZone.classify(percent: 95.01), .high)
        XCTAssertEqual(SleepZone.classify(percent: 100), .high)
    }
}

// MARK: - Number formatting + gauge readout (web `fmtNumber` / `RadialGauge`)

@MainActor final class SleepFormatTests: XCTestCase {
    func testNumberGroupingAndPrecision() {
        XCTAssertEqual(SleepFormat.number(12345, decimals: 0), "12,345")
        XCTAssertEqual(SleepFormat.number(12.5, decimals: 2), "12.50")
        XCTAssertEqual(SleepFormat.number(0, decimals: 2), "0.00")
        XCTAssertEqual(SleepFormat.number(-3, decimals: 0), "-3")
    }

    func testGaugeValueIntegerDropsFraction() {
        XCTAssertEqual(SleepFormat.gaugeValue(92, max: 100), "92")
        XCTAssertEqual(SleepFormat.gaugeValue(0, max: 100), "0")
        XCTAssertEqual(SleepFormat.gaugeValue(100, max: 100), "100")
    }

    func testGaugeValueNonIntegerUsesGlobalPrecision() {
        XCTAssertEqual(SleepFormat.gaugeValue(92.5, max: 100), "92.50")
        XCTAssertEqual(SleepFormat.gaugeValue(73.456, max: 100), "73.46")
    }

    func testGaugeValueClampsToBounds() {
        XCTAssertEqual(SleepFormat.gaugeValue(150, max: 100), "100")
        XCTAssertEqual(SleepFormat.gaugeValue(-5, max: 100), "0")
    }

    func testGaugeValueNonFiniteCoercesToZero() {
        XCTAssertEqual(SleepFormat.gaugeValue(.nan, max: 100), "0")
        XCTAssertEqual(SleepFormat.gaugeValue(.infinity, max: 100), "0")
    }

    func testNumberNonFiniteCoercesToZero() {
        XCTAssertEqual(SleepFormat.number(.nan, decimals: 0), "0")
        XCTAssertEqual(SleepFormat.number(.infinity, decimals: 2), "0.00")
        XCTAssertEqual(SleepFormat.number(1234.5, decimals: 1), "1,234.5")
    }
}
