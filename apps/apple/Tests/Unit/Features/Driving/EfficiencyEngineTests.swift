import XCTest
@testable import TeslaSync

/// Pure-logic tests for the Efficiency derivations (web `getEfficiency` + the `dailyTrend` /
/// `speedVsEff` / `tempVsEff` / `speedDist` / `tempBuckets` useMemo blocks) and the efficiency-tier
/// ladder. Unit conversion is injected as closures so the bucketing/aggregation is verified without
/// the KMP runtime, matching the web math byte-for-byte.
final class EfficiencyEngineTests: XCTestCase {
    private func drive(
        id: Int64 = 1,
        start: Double = 80,
        end: Double = 70,
        distanceM: Double = 10000,
        speedMps: Double? = 20,
        tempC: Double? = 15
    ) -> EfficiencyDrive {
        EfficiencyDrive(
            id: id,
            vehicleID: 1,
            startTs: Date(timeIntervalSince1970: 1_700_000_000 - Double(id) * 86400),
            distanceM: distanceM,
            avgSpeedMps: speedMps,
            startBatteryPct: start,
            endBatteryPct: end,
            outsideTempAvgC: tempC
        )
    }

    // MARK: getEfficiency (web `getEfficiency`)

    func testEfficiencyWhPerKm() throws {
        // battUsed 10 %, 50 km → (10 * 0.75 * 1000) / (50000/1000) = 7500 / 50 = 150 Wh/km.
        let value = drive(start: 90, end: 80, distanceM: 50000).efficiencyWhPerKm
        XCTAssertEqual(try XCTUnwrap(value), 150, accuracy: 0.0001)
    }

    func testEfficiencyNilWhenNoChargeUsedOrNoDistance() {
        XCTAssertNil(drive(start: 80, end: 80).efficiencyWhPerKm) // no charge used
        XCTAssertNil(drive(start: 80, end: 85).efficiencyWhPerKm) // gained charge
        XCTAssertNil(drive(start: 90, end: 80, distanceM: 0).efficiencyWhPerKm) // no distance
    }

    // MARK: jsRound (web `Math.round`, round half toward +∞)

    func testJsRoundMatchesJavaScript() {
        XCTAssertEqual(EfficiencyEngine.jsRound(2.4), 2)
        XCTAssertEqual(EfficiencyEngine.jsRound(2.5), 3)
        XCTAssertEqual(EfficiencyEngine.jsRound(-5.5), -5) // toward +∞, not away from zero
        XCTAssertEqual(EfficiencyEngine.jsRound(-5.6), -6)
    }

    // MARK: dailyTrend (web `dailyTrend`)

    func testDailyTrendTakesFirst30Reversed() {
        let drives = (0 ..< 35).map { drive(id: Int64($0), start: 90, end: 80, distanceM: 50000) }
        let trend = EfficiencyEngine.dailyTrend(
            drives,
            efficiencyToDisplay: { $0 },
            distanceToDisplay: { $0 / 1000 }
        )
        XCTAssertEqual(trend.count, 30) // first 30 of 35
        XCTAssertEqual(trend.map(\.index), Array(0 ..< 30)) // re-indexed after reverse
        XCTAssertEqual(trend.first?.efficiencyDisplay, 150) // rounded display Wh/km
        XCTAssertEqual(trend.first?.distanceDisplay, 50.0) // 50000 m → 50.0 km (1 dp)
        // Reversed: the last of the first-30 window becomes the first point.
        XCTAssertEqual(trend.first?.date, drives[29].startTs)
        XCTAssertEqual(trend.last?.date, drives[0].startTs)
    }

    func testDailyTrendExcludesUnscoredDrives() {
        let drives = [drive(id: 1, start: 90, end: 80), drive(id: 2, start: 80, end: 80)]
        let trend = EfficiencyEngine.dailyTrend(drives, efficiencyToDisplay: { $0 }, distanceToDisplay: { $0 })
        XCTAssertEqual(trend.count, 1)
    }

    // MARK: speedVsEff / tempVsEff (web `speedVsEff` / `tempVsEff`)

    func testSpeedVsEfficiencyFiltersAndRounds() {
        let drives = [
            drive(id: 1, start: 90, end: 80, distanceM: 50000, speedMps: 10),
            drive(id: 2, start: 90, end: 80, distanceM: 50000, speedMps: nil), // no speed → excluded
            drive(id: 3, start: 80, end: 80, distanceM: 50000, speedMps: 20) // no efficiency → excluded
        ]
        let points = EfficiencyEngine.speedVsEfficiency(
            drives,
            speedToDisplay: { $0 * 3.6 },
            efficiencyToDisplay: { $0 }
        )
        XCTAssertEqual(points.count, 1)
        XCTAssertEqual(points.first?.xDisplay, 36) // 10 m/s → 36 km/h
        XCTAssertEqual(points.first?.efficiencyDisplay, 150)
    }

    func testTemperatureVsEfficiencyAllowsZeroDegrees() {
        let drives = [drive(id: 1, start: 90, end: 80, distanceM: 50000, tempC: 0)]
        let points = EfficiencyEngine.temperatureVsEfficiency(
            drives,
            temperatureToDisplay: { $0 },
            efficiencyToDisplay: { $0 }
        )
        XCTAssertEqual(points.count, 1) // 0 °C is a valid temperature (web `!== null`)
        XCTAssertEqual(points.first?.xDisplay, 0)
    }

    // MARK: speedDistribution (web `speedDist`)

    func testSpeedDistributionBucketsByDisplaySpeed() throws {
        // 10, 20, 30 m/s → 36, 72, 108 km/h → bands 30–60, 60–90, 90–120.
        let drives = [10.0, 20.0, 30.0].enumerated().map { index, speed in
            drive(id: Int64(index + 1), start: 90, end: 80, distanceM: 50000, speedMps: speed)
        }
        let buckets = EfficiencyEngine.speedDistribution(drives, speedToDisplay: { $0 * 3.6 })
        XCTAssertEqual(buckets.map(\.id), [1, 2, 3]) // three non-empty bands
        XCTAssertTrue(buckets.allSatisfy { $0.count == 1 })
        XCTAssertEqual(try XCTUnwrap(buckets.first).avgWhPerKm, 150, accuracy: 0.0001)
    }

    func testSpeedDistributionOpenEndedBand() throws {
        let drives = [drive(id: 1, start: 90, end: 80, distanceM: 50000, speedMps: 40)] // 144 km/h → 120+
        let buckets = EfficiencyEngine.speedDistribution(drives, speedToDisplay: { $0 * 3.6 })
        XCTAssertEqual(buckets.count, 1)
        XCTAssertTrue(try XCTUnwrap(buckets.first).isOpenEnded)
        XCTAssertEqual(buckets.first?.lowerDisplay, 120)
    }

    // MARK: temperatureBuckets (web `tempBuckets` — unit-independent °C boundaries)

    func testTemperatureBucketsByCelsius() {
        let temps = [-5.0, 5.0, 15.0, 25.0, 35.0] // one per band <0 / 0–10 / 10–20 / 20–30 / >30
        let drives = temps.enumerated().map { index, temp in
            drive(id: Int64(index + 1), start: 90, end: 80, distanceM: 50000, tempC: temp)
        }
        let buckets = EfficiencyEngine.temperatureBuckets(drives)
        XCTAssertEqual(buckets.map(\.id), [0, 1, 2, 3, 4])
        XCTAssertTrue(buckets.allSatisfy { $0.count == 1 })
        XCTAssertNil(buckets.first?.lowerC) // first band is open-below
        XCTAssertNil(buckets.last?.upperC) // last band is open-above
        XCTAssertEqual(buckets.first?.totalDistanceM, 50000)
    }

    func testTemperatureBucketsAggregateSI() throws {
        let drives = [
            drive(id: 1, start: 90, end: 80, distanceM: 40000, speedMps: 10, tempC: 15),
            drive(id: 2, start: 90, end: 80, distanceM: 60000, speedMps: 20, tempC: 18)
        ]
        let buckets = EfficiencyEngine.temperatureBuckets(drives)
        let band = try? XCTUnwrap(buckets.first { $0.id == 2 }) // 10–20 °C band
        XCTAssertEqual(band?.count, 2)
        XCTAssertEqual(band?.totalDistanceM, 100_000) // SI sum
        XCTAssertEqual(try XCTUnwrap(band?.avgSpeedMps), 15, accuracy: 0.0001) // SI mean
    }

    // MARK: EfficiencyTier (web `efficiencyColor`)

    func testEfficiencyTierLadder() {
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 100), .excellent)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 139.9), .excellent)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 140), .good)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 169.9), .good)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 170), .fair)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 200), .high)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 240), .veryHigh)
        XCTAssertEqual(EfficiencyTier.from(whPerKm: 999), .veryHigh)
    }
}
