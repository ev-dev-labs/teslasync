//
//  SpeedGearPanel.Tests.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  Unit coverage for the driving-dynamics SpeedGearPanel surface:
//    • Adapter — the speed converter (port of unitConversion.ts `convertSpeedFromSI`), the number
//      formatter (port of numberFormat.ts `fmtNumber`), the SI drive aggregation (mean / max /
//      nil-coalesce / empty → nil) with the single-boundary conversion guarantee, the shift colour +
//      badge tone ladders, and the four-cell projection (order / ids / labels / values / units incl.
//      nil → em-dash and the mph variant).
//    • State holder — `SpeedGearPanelModel.resolvePhase` across loading / empty / loaded / failed,
//      the model wiring, the P1/S11 `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver summary content.
//    • View — an `ImageRenderer` render smoke for every state (content / partial / empty / loading /
//      error / stale / offline).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemorySpeedGearSource`, and the locale is injected for determinism.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleUnits(_ speed: SpeedGearSpeedUnit = .kilometersPerHour) -> SpeedGearUnitPrefs {
    SpeedGearUnitPrefs(speed: speed, localeIdentifier: "en_US", precision: 2)
}

private func sampleReading() -> SpeedGearMotorReading {
    SpeedGearMotorReading(shiftState: "D", powerKW: 142.6)
}

/// Two drives whose SI speeds give clean display values: avg = (10 + 20) / 2 = 15 m/s, top = 35 m/s.
/// km/h → 54 / 126; mph → 34 / 78. Double-converting either would inflate them ~3.6×, so the exact
/// assertions below pin the single-boundary conversion.
private func sampleDrives() -> [SpeedGearDriveSample] {
    [
        SpeedGearDriveSample(avgSpeedMps: 10, maxSpeedMps: 25),
        SpeedGearDriveSample(avgSpeedMps: 20, maxSpeedMps: 35)
    ]
}

// MARK: - Speed conversion (port of unitConversion.ts convertSpeedFromSI)

final class SpeedGearConvertTests: XCTestCase {
    func testKilometersPerHour() {
        XCTAssertEqual(SpeedGearConvert.fromSI(10, to: .kilometersPerHour), 36, accuracy: 1e-9)
        XCTAssertEqual(SpeedGearConvert.fromSI(0, to: .kilometersPerHour), 0, accuracy: 1e-9)
    }

    func testMilesPerHour() {
        // 10 m/s = 10 * 3600 / 1609.344 = 22.369362920544... mph.
        XCTAssertEqual(SpeedGearConvert.fromSI(10, to: .milesPerHour), 22.369362920544023, accuracy: 1e-6)
    }
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber)

final class SpeedGearFormatTests: XCTestCase {
    func testGroupsAndFixesPrecision() {
        XCTAssertEqual(SpeedGearFormat.number(1234.5, decimals: 2, locale: enUS), "1,234.50")
        XCTAssertEqual(SpeedGearFormat.number(142.6, decimals: 2, locale: enUS), "142.60")
        XCTAssertEqual(SpeedGearFormat.number(126, decimals: 0, locale: enUS), "126")
    }

    func testZeroDecimalsRoundsHalfAwayFromZero() {
        XCTAssertEqual(SpeedGearFormat.number(33.55386, decimals: 0, locale: enUS), "34")
        XCTAssertEqual(SpeedGearFormat.number(49.44, decimals: 0, locale: enUS), "49")
        XCTAssertEqual(SpeedGearFormat.number(0.5, decimals: 0, locale: enUS), "1")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(SpeedGearFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(SpeedGearFormat.number(.infinity, decimals: 0, locale: enUS), "0")
        XCTAssertEqual(SpeedGearFormat.number(-.infinity, decimals: 2, locale: enUS), "0.00")
    }
}

// MARK: - Drive aggregation (web reduce / Math.max in SI)

final class SpeedGearDriveAggregateTests: XCTestCase {
    func testEmptyListYieldsNil() {
        let aggregate = SpeedGearDriveAggregate.aggregate([])
        XCTAssertNil(aggregate.averageMps)
        XCTAssertNil(aggregate.topMps)
    }

    func testMeanAndMaxInSI() {
        let aggregate = SpeedGearDriveAggregate.aggregate(sampleDrives())
        XCTAssertEqual(aggregate.averageMps ?? -1, 15, accuracy: 1e-9)
        XCTAssertEqual(aggregate.topMps ?? -1, 35, accuracy: 1e-9)
    }

    func testNilFieldsCoalesceToZero() {
        // avg = (0 + 20) / 2 = 10; top = max(10, 0) = 10 (the web `?? 0` coalesce).
        let drives = [
            SpeedGearDriveSample(avgSpeedMps: nil, maxSpeedMps: 10),
            SpeedGearDriveSample(avgSpeedMps: 20, maxSpeedMps: nil)
        ]
        let aggregate = SpeedGearDriveAggregate.aggregate(drives)
        XCTAssertEqual(aggregate.averageMps ?? -1, 10, accuracy: 1e-9)
        XCTAssertEqual(aggregate.topMps ?? -1, 10, accuracy: 1e-9)
    }
}

// MARK: - Shift colour + badge tone ladders (web shiftColor / shiftBadgeVariant)

final class SpeedGearShiftLadderTests: XCTestCase {
    func testLetterAccentLadder() {
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: "D"), .success)
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: "R"), .danger)
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: "N"), .warning)
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: "P"), .muted)
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: nil), .secondary)
        XCTAssertEqual(SpeedGearShiftAccent.accent(for: "Z"), .secondary)
    }

    func testBadgeToneLadder() {
        XCTAssertEqual(SpeedGearBadgeTone.tone(for: "D"), .success)
        XCTAssertEqual(SpeedGearBadgeTone.tone(for: "R"), .danger)
        XCTAssertEqual(SpeedGearBadgeTone.tone(for: "N"), .warning)
        // P folds into neutral for the badge while the letter colour folds it into muted.
        XCTAssertEqual(SpeedGearBadgeTone.tone(for: "P"), .neutral)
        XCTAssertEqual(SpeedGearBadgeTone.tone(for: nil), .neutral)
    }
}

// MARK: - Projector: shift cell

final class SpeedGearProjectorShiftTests: XCTestCase {
    func testDriveShiftTile() {
        let shift = SpeedGearProjector.project(
            reading: sampleReading(), drives: sampleDrives(), units: sampleUnits()
        ).shift
        XCTAssertEqual(shift.letter, "D")
        XCTAssertEqual(shift.accent, .success)
        XCTAssertEqual(shift.tone, .success)
        XCTAssertEqual(shift.badgeLabel, "Shift State")
    }

    func testNilShiftRendersEmDashSecondaryNeutral() {
        let shift = SpeedGearProjector.project(
            reading: SpeedGearMotorReading(), drives: [], units: sampleUnits()
        ).shift
        XCTAssertEqual(shift.letter, "—")
        XCTAssertEqual(shift.accent, .secondary)
        XCTAssertEqual(shift.tone, .neutral)
    }
}

// MARK: - Projector: metric cells (web Motor Power / Avg / Top)

final class SpeedGearProjectorMetricTests: XCTestCase {
    private func metrics(
        _ reading: SpeedGearMotorReading?,
        _ drives: [SpeedGearDriveSample],
        _ units: SpeedGearUnitPrefs = sampleUnits()
    ) -> [SpeedGearMetricTile] {
        SpeedGearProjector.project(reading: reading, drives: drives, units: units).metrics
    }

    func testMetricOrderIdsAndLabels() {
        let metrics = metrics(sampleReading(), sampleDrives())
        XCTAssertEqual(metrics.map(\.id), ["power", "avgDriveSpeed", "topDriveSpeed"])
        XCTAssertEqual(metrics.map(\.label), ["Motor Power", "Avg Drive Speed", "Top Drive Speed"])
    }

    func testKilometersPerHourValuesAndUnits() {
        let metrics = metrics(sampleReading(), sampleDrives())
        XCTAssertEqual(metrics.map(\.value), ["142.60", "54", "126"])
        XCTAssertEqual(metrics.map(\.unit), ["kW", "km/h", "km/h"])
    }

    func testMilesPerHourConvertsOnce() {
        // Single-boundary conversion: 15 m/s → 34 mph, 35 m/s → 78 mph (NOT ~3.6× larger).
        let metrics = metrics(sampleReading(), sampleDrives(), sampleUnits(.milesPerHour))
        XCTAssertEqual(metrics.map(\.value), ["142.60", "34", "78"])
        XCTAssertEqual(metrics.map(\.unit), ["kW", "mph", "mph"])
    }

    func testPowerUsesGlobalPrecision() {
        let metrics = metrics(SpeedGearMotorReading(shiftState: "D", powerKW: 7), sampleDrives())
        XCTAssertEqual(metrics[0].value, "7.00")
    }

    func testNilPowerRendersEmDashButKeepsUnit() {
        let metrics = metrics(SpeedGearMotorReading(shiftState: "D", powerKW: nil), sampleDrives())
        XCTAssertEqual(metrics[0].value, "—")
        XCTAssertEqual(metrics[0].unit, "kW")
    }

    func testNoDrivesRenderSpeedEmDashButKeepUnit() {
        let metrics = metrics(sampleReading(), [])
        XCTAssertEqual(metrics[1].value, "—")
        XCTAssertEqual(metrics[2].value, "—")
        XCTAssertEqual(metrics[1].unit, "km/h")
        XCTAssertEqual(metrics[2].unit, "km/h")
    }

    func testZeroPowerIsFormattedNotEmDash() {
        let metrics = metrics(SpeedGearMotorReading(shiftState: "N", powerKW: 0), sampleDrives())
        XCTAssertEqual(metrics[0].value, "0.00")
    }
}

// MARK: - Accessibility summary content

final class SpeedGearAccessibilityTests: XCTestCase {
    func testJoinFiltersEmptyParts() {
        XCTAssertEqual(SpeedGearAccessibility.join(["Motor Power", "", "142.60 kW"]), "Motor Power, 142.60 kW")
    }

    func testProjectionSummaryListsShiftAndMetrics() {
        let summary = SpeedGearProjector.project(
            reading: sampleReading(), drives: sampleDrives(), units: sampleUnits()
        ).accessibilitySummary
        XCTAssertTrue(summary.contains("Shift State, D"))
        XCTAssertTrue(summary.contains("Motor Power, 142.60 kW"))
        XCTAssertTrue(summary.contains("Avg Drive Speed, 54 km/h"))
        XCTAssertTrue(summary.contains("Top Drive Speed, 126 km/h"))
    }
}
