//
//  TimeOfUseAnalysis.AdapterTests.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  Pure-core unit coverage for the TimeOfUseAnalysis surface (no view, no bundle):
//    • Band (`TimeOfUseBand`) — classification at every boundary hour (web peak /
//      off-peak thresholds) + out-of-range normalisation.
//    • Adapter (`TimeOfUseProjection`) — point sanitation + band tagging, the
//      off-peak share, the cheapest / priciest / busiest derivation with tie-breaks
//      (web `useCostAnalysisData` insights), nil-insights when no hour has sessions,
//      content/empty/loading/error phase resolution, and the thinned axis ticks.
//    • Formatting (`DefaultTimeOfUseFormatting`) — the `"$" + fmtNumber(_, 3)` /
//      `fmtInt` / `fmtNumber(_, 1) + "%"` parity (grouping, fixed decimals, half-up,
//      non-finite + negative guards).
//
//  These run in the TeslaSync(/-macOS) XCTest targets alongside
//  TimeOfUseAnalysis.Tests.swift (which covers the state holder + accessibility).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: band classification

@MainActor final class TimeOfUseBandTests: XCTestCase {
    func testOffPeakBoundaries() {
        for hour in [0, 1, 5, 22, 23] {
            XCTAssertEqual(TimeOfUseBand.classify(hour: hour), .offPeak, "hour \(hour) should be off-peak")
        }
    }

    func testPeakBoundaries() {
        for hour in [14, 15, 18, 19] {
            XCTAssertEqual(TimeOfUseBand.classify(hour: hour), .peak, "hour \(hour) should be peak")
        }
    }

    func testMidPeakBoundaries() {
        for hour in [6, 7, 13, 20, 21] {
            XCTAssertEqual(TimeOfUseBand.classify(hour: hour), .midPeak, "hour \(hour) should be mid-peak")
        }
    }

    func testEdgeTransitions() {
        XCTAssertEqual(TimeOfUseBand.classify(hour: 6), .midPeak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: 13), .midPeak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: 14), .peak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: 20), .midPeak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: 22), .offPeak)
    }

    func testNormalizesOutOfRangeHours() {
        XCTAssertEqual(TimeOfUseBand.classify(hour: 24), .offPeak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: 38), .peak)
        XCTAssertEqual(TimeOfUseBand.classify(hour: -2), .offPeak)
    }
}

// MARK: - Adapter: projection (web `hourlyData` / `touInsights` consumer parity)

@MainActor final class TimeOfUseProjectionTests: XCTestCase {
    private func sample(_ hour: Int, sessions: Int, avgCost: Double, energy: Double = 0) -> TimeOfUseHourSample {
        TimeOfUseHourSample(
            hour: hour,
            label: String(format: "%02d:00", hour),
            sessions: sessions,
            avgCost: avgCost,
            totalEnergy: energy
        )
    }

    func testPointsClassifyBandAndPreserveOrder() {
        let points = TimeOfUseProjection.points(from: [
            sample(0, sessions: 2, avgCost: 0.1),
            sample(14, sessions: 3, avgCost: 0.3),
            sample(10, sessions: 1, avgCost: 0.2)
        ])
        XCTAssertEqual(points.map(\.hour), [0, 14, 10])
        XCTAssertEqual(points.map(\.band), [.offPeak, .peak, .midPeak])
        XCTAssertEqual(points.map(\.id), [0, 14, 10])
    }

    func testPointsSanitizeNonFiniteAndNegative() {
        let points = TimeOfUseProjection.points(from: [
            sample(2, sessions: -5, avgCost: .nan, energy: .infinity)
        ])
        XCTAssertEqual(points[0].sessions, 0)
        XCTAssertEqual(points[0].avgCost, 0)
        XCTAssertEqual(points[0].totalEnergy, 0)
    }

    func testTotalSessions() {
        let points = TimeOfUseProjection.points(from: [
            sample(2, sessions: 4, avgCost: 0.1),
            sample(14, sessions: 3, avgCost: 0.3)
        ])
        XCTAssertEqual(TimeOfUseProjection.totalSessions(points), 7)
    }

    func testOffPeakPercent() {
        let points = TimeOfUseProjection.points(from: [
            sample(2, sessions: 5, avgCost: 0.10),
            sample(3, sessions: 5, avgCost: 0.10),
            sample(14, sessions: 3, avgCost: 0.30),
            sample(18, sessions: 8, avgCost: 0.25),
            sample(9, sessions: 0, avgCost: 0.0)
        ])
        // off-peak sessions (hours 2,3) = 10, total = 21 → 47.619…%
        XCTAssertEqual(TimeOfUseProjection.offPeakPercent(points), 10.0 / 21.0 * 100, accuracy: 1e-6)
    }

    func testOffPeakPercentIsZeroWithoutSessions() {
        let points = TimeOfUseProjection.points(from: [sample(2, sessions: 0, avgCost: 0)])
        XCTAssertEqual(TimeOfUseProjection.offPeakPercent(points), 0)
    }

    func testCheapestPriciestBusiest() {
        let points = TimeOfUseProjection.points(from: [
            sample(2, sessions: 5, avgCost: 0.10),
            sample(3, sessions: 5, avgCost: 0.10),
            sample(14, sessions: 3, avgCost: 0.30),
            sample(18, sessions: 8, avgCost: 0.25),
            sample(9, sessions: 0, avgCost: 0.0)
        ])
        XCTAssertEqual(TimeOfUseProjection.cheapest(points)?.hour, 2)
        XCTAssertEqual(TimeOfUseProjection.priciest(points)?.hour, 14)
        XCTAssertEqual(TimeOfUseProjection.busiest(points)?.hour, 18)
    }

    func testTieBreaksToEarlierHour() {
        let points = TimeOfUseProjection.points(from: [
            sample(8, sessions: 4, avgCost: 0.20),
            sample(6, sessions: 4, avgCost: 0.20)
        ])
        XCTAssertEqual(TimeOfUseProjection.cheapest(points)?.hour, 6)
        XCTAssertEqual(TimeOfUseProjection.priciest(points)?.hour, 6)
        XCTAssertEqual(TimeOfUseProjection.busiest(points)?.hour, 6)
    }

    func testInsightsNilWhenNoSessions() {
        let points = TimeOfUseProjection.points(from: (0 ..< 24).map { sample($0, sessions: 0, avgCost: 0) })
        XCTAssertNil(TimeOfUseProjection.insights(points))
    }

    func testInsightsNilWhenEmpty() {
        XCTAssertNil(TimeOfUseProjection.insights([]))
    }

    func testInsightsPopulated() throws {
        let points = TimeOfUseProjection.points(from: [
            sample(2, sessions: 5, avgCost: 0.10),
            sample(14, sessions: 3, avgCost: 0.30),
            sample(18, sessions: 8, avgCost: 0.25)
        ])
        let insights = try XCTUnwrap(TimeOfUseProjection.insights(points))
        XCTAssertEqual(insights.cheapest.hour, 2)
        XCTAssertEqual(insights.priciest.hour, 14)
        XCTAssertEqual(insights.busiest.hour, 18)
        XCTAssertEqual(insights.offPeakPct, 5.0 / 16.0 * 100, accuracy: 1e-6)
    }

    func testResolvePhaseMatchesWebContentEmptySplit() {
        XCTAssertEqual(TimeOfUseProjection.resolvePhase(.loading, count: 0), .loading)
        XCTAssertEqual(TimeOfUseProjection.resolvePhase(.loaded, count: 24), .content)
        XCTAssertEqual(TimeOfUseProjection.resolvePhase(.loaded, count: 0), .empty)
        XCTAssertEqual(TimeOfUseProjection.resolvePhase(.failed("boom"), count: 24), .error("boom"))
    }

    func testAxisTickLabelsThinsEveryThirdHourKeepingFirst() {
        let points = TimeOfUseProjection.points(from: (0 ..< 24).map { sample($0, sessions: 1, avgCost: 0.1) })
        let labels = TimeOfUseProjection.axisTickLabels(points)
        XCTAssertEqual(labels.first, "00:00")
        XCTAssertEqual(labels, ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"])
    }

    func testAxisTickLabelsEmptyForNoPoints() {
        XCTAssertTrue(TimeOfUseProjection.axisTickLabels([]).isEmpty)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TimeOfUseSurface.slug, "TimeOfUseAnalysis")
        XCTAssertEqual(TimeOfUseAnalysis.surfaceSlug, "TimeOfUseAnalysis")
    }
}

// MARK: - Formatting: DefaultTimeOfUseFormatting (web `fmtNumber` / `fmtInt`)

@MainActor final class TimeOfUseFormattingTests: XCTestCase {
    private let formatter = DefaultTimeOfUseFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    func testCurrencyDefaultPrecisionIsThree() {
        XCTAssertEqual(formatter.formatCurrency(0.124), "$0.124")
    }

    func testCurrencyGroupingAndFixedDecimals() {
        XCTAssertEqual(formatter.formatCurrency(1234.5, fractionDigits: 3), "$1,234.500")
    }

    func testCurrencyHalfUpRounding() {
        XCTAssertEqual(formatter.formatCurrency(0.1235, fractionDigits: 3), "$0.124")
    }

    func testCurrencyNonFiniteGuard() {
        XCTAssertEqual(formatter.formatCurrency(.nan), "$0.000")
        XCTAssertEqual(formatter.formatCurrency(.infinity), "$0.000")
    }

    func testCountGroupsThousandsAndClampsNegative() {
        XCTAssertEqual(formatter.formatCount(12345), "12,345")
        XCTAssertEqual(formatter.formatCount(-4), "0")
    }

    func testPercentDefaultPrecisionIsOne() {
        XCTAssertEqual(formatter.formatPercent(42.55), "42.6%")
        XCTAssertEqual(formatter.formatPercent(0), "0.0%")
    }

    func testCustomCurrencySymbol() {
        let euro = DefaultTimeOfUseFormatting(currencySymbol: "€", localeIdentifier: "en_US")
        XCTAssertEqual(euro.formatCurrency(0.1), "€0.100")
    }
}
