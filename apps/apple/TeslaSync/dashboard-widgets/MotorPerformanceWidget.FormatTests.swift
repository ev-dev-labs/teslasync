//
//  MotorPerformanceWidget.FormatTests.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  Pure-function coverage split out of MotorPerformanceWidget.Tests.swift (the
//  torque-zone thresholds + number formatting) so each file stays within the
//  SwiftLint file-length budget. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Torque zone thresholds (web `torqueColor`)

@MainActor final class MotorTorqueZoneTests: XCTestCase {
    func testZoneBoundaries() {
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 0), .low)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 199), .low)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 200), .medium)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 399), .medium)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 400), .high)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 600), .high)
    }
}

// MARK: - Number formatting (web `fmtInt` / `fmtNumber`)

@MainActor final class MotorFormatTests: XCTestCase {
    func testIntegerGrouping() {
        XCTAssertEqual(MotorFormat.int(12345), "12,345")
        XCTAssertEqual(MotorFormat.int(-12345), "-12,345")
        XCTAssertEqual(MotorFormat.int(0), "0")
    }

    func testFixedDecimals() {
        XCTAssertEqual(MotorFormat.number(0.1, decimals: 2), "0.10")
        XCTAssertEqual(MotorFormat.number(312, decimals: 0), "312")
        XCTAssertEqual(MotorFormat.number(1234.5, decimals: 1), "1,234.5")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(MotorFormat.number(.nan, decimals: 0), "0")
        XCTAssertEqual(MotorFormat.number(.infinity, decimals: 2), "0.00")
    }
}
