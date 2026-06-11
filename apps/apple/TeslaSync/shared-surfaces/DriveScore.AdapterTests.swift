//
//  DriveScore.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  Pure-core coverage for the drive score (the model + view-composition half lives in
//  DriveScore.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives cached SI drive
//  fields through ``DriveScoreSurfaceProjector`` and asserts the verbatim port of the web
//  `computeDriveScore`, plus the value types it is built on:
//    • projector — eight representative drives whose expected totals + sub-scores are cross-checked
//                  against the web JS (incl. the unrounded-sum total that differs from the sum of the
//                  rounded parts), the absent-field fallbacks, and non-finite inputs.
//    • band      — the web `getScoreColor` thresholds (40 / 70 boundaries).
//    • category  — point ceilings, source order, i18n keys / fallbacks.
//    • breakdown — value / max / fill fraction.
//    • inputs    — value equality (the `.onChange` key).
//    • slug      — the diagnostics identity.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - DriveScoreSurfaceProjector (web `computeDriveScore`)

final class DriveScoreSurfaceProjectorTests: XCTestCase {
    private func compute(
        distanceM: Double? = nil,
        durationS: Double? = nil,
        maxSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil
    ) -> DriveScoreSurfaceProjection {
        DriveScoreSurfaceProjector.compute(
            DriveScoreSurfaceInputs(
                distanceM: distanceM,
                durationS: durationS,
                maxSpeedMps: maxSpeedMps,
                startBatteryPct: startBatteryPct,
                endBatteryPct: endBatteryPct
            )
        )
    }

    /// Asserts the flat scores in `[total, efficiency, speed, range, trip]` order plus the band.
    private func assertScore(
        _ projection: DriveScoreSurfaceProjection,
        _ expected: [Int],
        band: DriveScoreSurfaceBand,
        line: UInt = #line
    ) {
        let actual = [
            projection.total,
            projection.efficiency,
            projection.speed,
            projection.range,
            projection.trip
        ]
        XCTAssertEqual(actual, expected, "[total, efficiency, speed, range, trip]", line: line)
        XCTAssertEqual(projection.band, band, "band", line: line)
    }

    func testEmptyDriveMatchesWeb() {
        assertScore(compute(), [23, 13, 10, 0, 0], band: .poor)
    }

    func testGoodTripMatchesWeb() {
        let projection = compute(
            distanceM: 50000,
            durationS: 3000,
            maxSpeedMps: 30,
            startBatteryPct: 80,
            endBatteryPct: 70
        )
        assertScore(projection, [89, 40, 11, 18, 20], band: .good)
    }

    func testOptimalShortTripMatchesWeb() {
        let projection = compute(
            distanceM: 20000,
            durationS: 1200,
            maxSpeedMps: 25,
            startBatteryPct: 90,
            endBatteryPct: 86
        )
        assertScore(projection, [79, 40, 13, 18, 8], band: .good)
    }

    func testPoorWastefulDriveMatchesWeb() {
        let projection = compute(
            distanceM: 5000,
            durationS: 1800,
            maxSpeedMps: 40,
            startBatteryPct: 100,
            endBatteryPct: 80
        )
        assertScore(projection, [3, 0, 1, 0, 2], band: .poor)
    }

    func testLongSmoothTripUsesUnroundedSumTotal() {
        // Web parity guard: total is the rounded clamp of the UNROUNDED component sum (94), which is
        // NOT the sum of the rounded sub-scores (38 + 19 + 18 + 20 = 95).
        let projection = compute(
            distanceM: 120_000,
            durationS: 5400,
            maxSpeedMps: 24,
            startBatteryPct: 95,
            endBatteryPct: 70
        )
        assertScore(projection, [94, 38, 19, 18, 20], band: .good)
        XCTAssertNotEqual(
            projection.total,
            projection.efficiency + projection.speed + projection.range + projection.trip
        )
    }

    func testAbsentMaxSpeedFallsBackToAverage() {
        let projection = compute(distanceM: 30000, durationS: 1800, startBatteryPct: 70, endBatteryPct: 62)
        assertScore(projection, [75, 27, 20, 16, 12], band: .good)
    }

    func testZeroDurationMatchesWeb() {
        let projection = compute(distanceM: 10000, durationS: 0, startBatteryPct: 80, endBatteryPct: 75)
        assertScore(projection, [25, 0, 10, 11, 4], band: .poor)
    }

    func testFractionalBatteryMatchesWeb() {
        let projection = compute(
            distanceM: 40000,
            durationS: 2400,
            maxSpeedMps: 28,
            startBatteryPct: 79.5,
            endBatteryPct: 70
        )
        assertScore(projection, [77, 33, 12, 17, 16], band: .good)
    }

    func testNonFiniteFieldsAreTreatedAsAbsent() {
        let nanDrive = compute(distanceM: .nan, durationS: .infinity, maxSpeedMps: -.infinity)
        let emptyDrive = compute()
        XCTAssertEqual(nanDrive, emptyDrive, "non-finite inputs degrade to the absent fallback")
        XCTAssertEqual(nanDrive.total, 23)
    }

    func testFillFractionTracksTotal() {
        XCTAssertEqual(compute().fillFraction, 0.23, accuracy: 0.0001)
        let perfect = compute(
            distanceM: 60000,
            durationS: 3600,
            maxSpeedMps: 17,
            startBatteryPct: 90,
            endBatteryPct: 78
        )
        XCTAssertEqual(perfect.fillFraction, Double(perfect.total) / 100.0, accuracy: 0.0001)
    }

    func testBreakdownIsFourRowsInSourceOrder() {
        let projection = compute(
            distanceM: 50000,
            durationS: 3000,
            maxSpeedMps: 30,
            startBatteryPct: 80,
            endBatteryPct: 70
        )
        XCTAssertEqual(projection.breakdown.map(\.category), DriveScoreSurfaceCategory.allCases)
        let efficiencyRow = projection.breakdown[0]
        XCTAssertEqual(efficiencyRow.value, 40)
        XCTAssertEqual(efficiencyRow.maxPoints, 40)
        XCTAssertEqual(efficiencyRow.fraction, 1.0, accuracy: 0.0001)
    }

    func testBreakdownFractionClampsAndZeroGuards() {
        let zero = DriveScoreSurfaceBreakdownItem(category: .tripLength, value: 0, maxPoints: 20)
        XCTAssertEqual(zero.fraction, 0)
        let half = DriveScoreSurfaceBreakdownItem(category: .speedDiscipline, value: 10, maxPoints: 20)
        XCTAssertEqual(half.fraction, 0.5, accuracy: 0.0001)
        let degenerate = DriveScoreSurfaceBreakdownItem(category: .efficiency, value: 5, maxPoints: 0)
        XCTAssertEqual(degenerate.fraction, 0, "guards divide-by-zero")
    }
}

// MARK: - DriveScoreSurfaceBand (web `getScoreColor` thresholds)

final class DriveScoreSurfaceBandTests: XCTestCase {
    func testClassifyThresholds() {
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 0), .poor)
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 39), .poor)
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 40), .fair)
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 69), .fair)
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 70), .good)
        XCTAssertEqual(DriveScoreSurfaceBand.classify(total: 100), .good)
    }

    func testAllCases() {
        XCTAssertEqual(Set(DriveScoreSurfaceBand.allCases), [.poor, .fair, .good])
    }
}

// MARK: - DriveScoreSurfaceCategory (web breakdown axes)

final class DriveScoreSurfaceCategoryTests: XCTestCase {
    func testSourceOrder() {
        XCTAssertEqual(
            DriveScoreSurfaceCategory.allCases,
            [.efficiency, .speedDiscipline, .rangePreservation, .tripLength]
        )
    }

    func testPointCeilingsSumTo100() {
        let total = DriveScoreSurfaceCategory.allCases.reduce(0) { $0 + $1.maxPoints }
        XCTAssertEqual(total, DriveScoreSurfaceConstants.maxTotalScore)
        XCTAssertEqual(DriveScoreSurfaceCategory.efficiency.maxPoints, 40)
        XCTAssertEqual(DriveScoreSurfaceCategory.speedDiscipline.maxPoints, 20)
        XCTAssertEqual(DriveScoreSurfaceCategory.rangePreservation.maxPoints, 20)
        XCTAssertEqual(DriveScoreSurfaceCategory.tripLength.maxPoints, 20)
    }

    func testLocalizationKeysAndFallbacks() {
        XCTAssertEqual(DriveScoreSurfaceCategory.efficiency.localizationKey, "driveScore.efficiency")
        XCTAssertEqual(DriveScoreSurfaceCategory.speedDiscipline.localizationKey, "driveScore.speedDiscipline")
        XCTAssertEqual(DriveScoreSurfaceCategory.rangePreservation.localizationKey, "driveScore.rangePreservation")
        XCTAssertEqual(DriveScoreSurfaceCategory.tripLength.localizationKey, "driveScore.tripLength")
        XCTAssertEqual(DriveScoreSurfaceCategory.efficiency.fallbackLabel, "Efficiency")
        XCTAssertEqual(DriveScoreSurfaceCategory.speedDiscipline.fallbackLabel, "Speed Discipline")
        XCTAssertEqual(DriveScoreSurfaceCategory.rangePreservation.fallbackLabel, "Range Preservation")
        XCTAssertEqual(DriveScoreSurfaceCategory.tripLength.fallbackLabel, "Trip Length")
    }

    func testIdentityIsRawValue() {
        XCTAssertEqual(DriveScoreSurfaceCategory.efficiency.id, "efficiency")
    }
}

// MARK: - DriveScoreSurfaceInputs (the `.onChange` key)

final class DriveScoreSurfaceInputsTests: XCTestCase {
    func testEquality() {
        let base = DriveScoreSurfaceInputs(
            distanceM: 50000, durationS: 3000, maxSpeedMps: 30, startBatteryPct: 80, endBatteryPct: 70
        )
        XCTAssertEqual(base, DriveScoreSurfaceInputs(
            distanceM: 50000, durationS: 3000, maxSpeedMps: 30, startBatteryPct: 80, endBatteryPct: 70
        ))
        XCTAssertNotEqual(base, DriveScoreSurfaceInputs(
            distanceM: 51000, durationS: 3000, maxSpeedMps: 30, startBatteryPct: 80, endBatteryPct: 70
        ))
        XCTAssertNotEqual(base, DriveScoreSurfaceInputs(
            distanceM: 50000, durationS: 3000, maxSpeedMps: 30, startBatteryPct: 80, endBatteryPct: 71
        ))
    }

    func testDefaultsAreNil() {
        let inputs = DriveScoreSurfaceInputs()
        XCTAssertNil(inputs.distanceM)
        XCTAssertNil(inputs.durationS)
        XCTAssertNil(inputs.maxSpeedMps)
        XCTAssertNil(inputs.startBatteryPct)
        XCTAssertNil(inputs.endBatteryPct)
    }
}

// MARK: - DriveScoreSurface (diagnostics identity)

final class DriveScoreSurfaceIdentityTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(DriveScoreSurface.slug, "DriveScore")
    }
}
