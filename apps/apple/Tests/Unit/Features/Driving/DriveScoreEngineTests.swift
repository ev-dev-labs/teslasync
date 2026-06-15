import XCTest
@testable import TeslaSync

/// Pure scoring + aggregation + formatter tests for the Drive Score surface (web `scoreDrive` /
/// `avgScores` / `histogramData` / `weakestCategory` / `bestDrive` / `periodStats` / achievements /
/// tips, and the `fmtNumber` / `fmtWithUnit` / `formatDurationMinutes` display helpers). These cover
/// the `DriveScoreEngine` + `DriveScoreFormat` units in isolation from the page model.
final class DriveScoreEngineTests: XCTestCase {
    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeDrive(
        id: Int64,
        daysAgo: Double,
        distanceM: Double = 10000,
        energyUsedWh: Double? = 1500,
        avgPowerW: Double? = 15000,
        maxSpeedMps: Double? = 30,
        startAddress: String? = "A",
        endAddress: String? = "B"
    ) -> DriveScoreDrive {
        DriveScoreDrive(
            id: id,
            vehicleID: 1,
            startTs: reference.addingTimeInterval(-daysAgo * 86400),
            endTs: reference.addingTimeInterval(-daysAgo * 86400 + 1800),
            distanceM: distanceM,
            durationS: 1800,
            maxSpeedMps: maxSpeedMps,
            avgSpeedMps: 20,
            startBatteryPct: 80,
            endBatteryPct: 70,
            startAddress: startAddress,
            endAddress: endAddress,
            outsideTempAvgC: 18,
            avgPowerW: avgPowerW,
            energyUsedWh: energyUsedWh
        )
    }

    // MARK: Engine — scoring

    func testScorePerfectDrive() {
        let drive = makeDrive(id: 1, daysAgo: 0, energyUsedWh: 1300, avgPowerW: 0, maxSpeedMps: 0)
        let score = DriveScoreEngine.score(drive)
        XCTAssertEqual(score.efficiency, 40)
        XCTAssertEqual(score.smoothness, 30)
        XCTAssertEqual(score.speed, 30)
        XCTAssertEqual(score.total, 100)
        XCTAssertEqual(score.grade, .aPlus)
        XCTAssertEqual(score.whPerKm, 130, accuracy: 0.001)
    }

    func testScoreLowDrive() {
        let drive = makeDrive(id: 1, daysAgo: 0, energyUsedWh: 4000, avgPowerW: 120_000, maxSpeedMps: 60)
        let score = DriveScoreEngine.score(drive)
        XCTAssertEqual(score.efficiency, 0)
        XCTAssertEqual(score.smoothness, 0)
        XCTAssertEqual(score.grade, .fGrade)
    }

    func testScoreFallsBackToBatteryWhenNoEnergy() {
        let drive = makeDrive(id: 1, daysAgo: 0, energyUsedWh: nil)
        let score = DriveScoreEngine.score(drive)
        XCTAssertGreaterThanOrEqual(score.total, 0)
        XCTAssertLessThanOrEqual(score.total, 100)
    }

    func testGradeLadder() {
        XCTAssertEqual(DriveGrade.from(score: 90), .aPlus)
        XCTAssertEqual(DriveGrade.from(score: 80), .aGrade)
        XCTAssertEqual(DriveGrade.from(score: 70), .bGrade)
        XCTAssertEqual(DriveGrade.from(score: 60), .cGrade)
        XCTAssertEqual(DriveGrade.from(score: 50), .dGrade)
        XCTAssertEqual(DriveGrade.from(score: 49), .fGrade)
    }

    func testGradeParseFallsBackToScore() {
        XCTAssertEqual(DriveGrade.parse("A+", score: 10), .aPlus)
        XCTAssertEqual(DriveGrade.parse("mystery", score: 95), .aPlus)
    }

    // MARK: Engine — aggregations

    func testAveragesEmptyAndPopulated() {
        XCTAssertEqual(DriveScoreEngine.averages([]).total, 0)
        let perfect = ScoredDrive(
            drive: makeDrive(id: 1, daysAgo: 0, energyUsedWh: 1300, avgPowerW: 0, maxSpeedMps: 0),
            score: DriveScoreEngine.score(makeDrive(
                id: 1,
                daysAgo: 0,
                energyUsedWh: 1300,
                avgPowerW: 0,
                maxSpeedMps: 0
            ))
        )
        let low = ScoredDrive(
            drive: makeDrive(id: 2, daysAgo: 0, energyUsedWh: 4000, avgPowerW: 120_000, maxSpeedMps: 60),
            score: DriveScoreEngine.score(makeDrive(
                id: 2,
                daysAgo: 0,
                energyUsedWh: 4000,
                avgPowerW: 120_000,
                maxSpeedMps: 60
            ))
        )
        let averages = DriveScoreEngine.averages([perfect, low])
        XCTAssertEqual(averages.total, (perfect.score.total + low.score.total + 1) / 2, accuracy: 1)
    }

    func testHistogramBuckets() {
        let perfect = DriveScoreEngine.score(makeDrive(
            id: 1,
            daysAgo: 0,
            energyUsedWh: 1300,
            avgPowerW: 0,
            maxSpeedMps: 0
        ))
        let low = DriveScoreEngine.score(makeDrive(
            id: 2,
            daysAgo: 0,
            energyUsedWh: 4000,
            avgPowerW: 120_000,
            maxSpeedMps: 60
        ))
        let scored = [
            ScoredDrive(drive: makeDrive(id: 1, daysAgo: 0), score: perfect),
            ScoredDrive(drive: makeDrive(id: 2, daysAgo: 0), score: low)
        ]
        let bins = DriveScoreEngine.histogram(scored)
        XCTAssertEqual(bins.count, 5)
        XCTAssertEqual(bins.first { $0.rangeLabel == "80–100" }?.driveCount, 1)
        XCTAssertEqual(bins.first { $0.rangeLabel == "0–20" }?.driveCount, 1)
    }

    func testBestAndWorstDrive() {
        let scored = DriveScoreEngine.scoredDrives([
            makeDrive(id: 1, daysAgo: 0, energyUsedWh: 1300, avgPowerW: 0, maxSpeedMps: 0),
            makeDrive(id: 2, daysAgo: 0, energyUsedWh: 4000, avgPowerW: 120_000, maxSpeedMps: 60)
        ])
        XCTAssertEqual(DriveScoreEngine.bestDrive(scored)?.drive.id, 1)
        XCTAssertEqual(DriveScoreEngine.worstDrive(scored)?.drive.id, 2)
        XCTAssertNil(DriveScoreEngine.bestDrive([]))
    }

    func testWeakestCategory() {
        let averages = DriveScoreAverages(total: 50, efficiency: 10, smoothness: 28, speed: 28)
        XCTAssertEqual(DriveScoreEngine.weakestCategory(summary: nil, averages: averages), .efficiency)
    }

    func testTipsForCategory() {
        XCTAssertEqual(DriveScoreEngine.tips(for: .efficiency).count, 3)
        XCTAssertTrue(DriveScoreEngine.tips(for: .speed).allSatisfy { $0.category == .speed })
        XCTAssertEqual(DriveScoreEngine.allTips().count, 9)
    }

    func testAchievementsUnlock() {
        let scored = DriveScoreEngine.scoredDrives([
            makeDrive(id: 1, daysAgo: 0, energyUsedWh: 1300, avgPowerW: 0, maxSpeedMps: 0)
        ])
        let achievements = DriveScoreEngine.achievements(scored: scored, driveCount: 1)
        XCTAssertEqual(achievements.count, 8)
        XCTAssertTrue(achievements.first { $0.id == "first-drive" }?.unlocked ?? false)
        XCTAssertTrue(achievements.first { $0.id == "perfect-score" }?.unlocked ?? false)
        XCTAssertFalse(achievements.first { $0.id == "fifty-drives" }?.unlocked ?? true)
    }

    func testPeriodStatsNilWhenEmpty() {
        XCTAssertNil(DriveScoreEngine.periodStats([], now: reference))
    }

    func testPeriodStatsThisWeek() {
        let scored = DriveScoreEngine.scoredDrives([
            makeDrive(id: 1, daysAgo: 0),
            makeDrive(id: 2, daysAgo: 0)
        ])
        let stats = DriveScoreEngine.periodStats(scored, now: reference)
        XCTAssertNotNil(stats)
        XCTAssertEqual(stats?.totalDrives, 2)
        XCTAssertNotNil(stats?.thisWeekAvg)
    }

    // MARK: Formatters

    func testNumberAndInteger() {
        XCTAssertEqual(DriveScoreFormat.number(1234, decimals: 0), "1,234")
        XCTAssertEqual(DriveScoreFormat.integer(12), "12")
        XCTAssertEqual(DriveScoreFormat.number(.nan, decimals: 0), "—")
    }

    func testDurationFormatting() {
        XCTAssertEqual(DriveScoreFormat.durationMinutes(90), "1h 30m")
        XCTAssertEqual(DriveScoreFormat.durationMinutes(45), "45m")
        XCTAssertEqual(DriveScoreFormat.durationMinutes(-1), "—")
        XCTAssertEqual(DriveScoreFormat.durationSeconds(3600), "1h 0m")
    }

    func testEfficiencyUnitsAndScaling() {
        XCTAssertEqual(DriveScoreFormat.efficiencyUnit(.metric), "Wh/km")
        XCTAssertEqual(DriveScoreFormat.efficiencyUnit(.imperial), "Wh/mi")
        XCTAssertEqual(DriveScoreFormat.efficiencyValue(100, .metric), 100, accuracy: 0.0001)
        XCTAssertEqual(DriveScoreFormat.efficiencyValue(100, .imperial), 160.9344, accuracy: 0.0001)
    }

    func testDistanceFormatsWithUnit() {
        XCTAssertTrue(DriveScoreFormat.distance(1000, .metric).hasSuffix("km"))
        XCTAssertTrue(DriveScoreFormat.distance(1000, .imperial).hasSuffix("mi"))
    }

    func testDateShortNonEmpty() {
        XCTAssertFalse(DriveScoreFormat.dateShort(reference).isEmpty)
        XCTAssertNotEqual(DriveScoreFormat.dateShort(reference), "—")
    }
}
