//
//  RegenEfficiencyWidget.FormatTests.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  Pure-function coverage split out of RegenEfficiencyWidget.Tests.swift (the regen-recovery zone thresholds
//  + the SI energy/power/number formatting) so each file stays within the SwiftLint file-length budget. Runs
//  in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Recovery zone thresholds (web `regenColor`)

@MainActor final class RegenZoneTests: XCTestCase {
    func testZoneBoundaries() {
        XCTAssertEqual(RegenZone.classify(percent: 0), .low)
        XCTAssertEqual(RegenZone.classify(percent: 15), .low)
        XCTAssertEqual(RegenZone.classify(percent: 15.01), .medium)
        XCTAssertEqual(RegenZone.classify(percent: 30), .medium)
        XCTAssertEqual(RegenZone.classify(percent: 30.01), .high)
        XCTAssertEqual(RegenZone.classify(percent: 100), .high)
    }
}

// MARK: - Number formatting (web `fmtInt` / `formatEnergy` / `formatPower`)

@MainActor final class RegenFormatTests: XCTestCase {
    func testIntegerGrouping() {
        XCTAssertEqual(RegenFormat.int(12345), "12,345")
        XCTAssertEqual(RegenFormat.int(-3), "-3")
        XCTAssertEqual(RegenFormat.int(0), "0")
    }

    func testEnergyConvertsWhToKwhAtPrecisionOne() {
        XCTAssertEqual(RegenFormat.energy(184_500), "184.5 kWh")
        XCTAssertEqual(RegenFormat.energy(0), "0.0 kWh")
        XCTAssertEqual(RegenFormat.energy(1_234_500), "1,234.5 kWh")
    }

    func testPowerConvertsWattsToKwAtPrecisionOne() {
        XCTAssertEqual(RegenFormat.power(2500), "2.5 kW")
        XCTAssertEqual(RegenFormat.power(0), "0.0 kW")
    }

    func testEnergyAndPowerEmptyFallback() {
        XCTAssertEqual(RegenFormat.energy(nil), "—")
        XCTAssertEqual(RegenFormat.energy(.infinity), "—")
        XCTAssertEqual(RegenFormat.power(nil), "—")
        XCTAssertEqual(RegenFormat.power(.nan), "—")
    }

    func testPercentRoundsAndSuffixes() {
        XCTAssertEqual(RegenFormat.percent(28.7), "29%")
        XCTAssertEqual(RegenFormat.percent(0), "0%")
        XCTAssertEqual(RegenFormat.percent(100), "100%")
        XCTAssertEqual(RegenFormat.percent(.nan), "0%")
    }

    func testNonFiniteNumberCoercesToZero() {
        XCTAssertEqual(RegenFormat.number(.nan, decimals: 0), "0")
        XCTAssertEqual(RegenFormat.number(.infinity, decimals: 1), "0.0")
        XCTAssertEqual(RegenFormat.number(1234.5, decimals: 1), "1,234.5")
    }
}
