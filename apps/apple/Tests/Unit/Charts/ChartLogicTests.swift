import XCTest
@testable import TeslaSync

/// Pure-logic tests for the chart utilities (formatting / downsampling / summary).
@MainActor
final class ChartLogicTests: XCTestCase {
    func testAxisLabelAbbreviates() {
        XCTAssertEqual(TSChartFormat.axisLabel(950), "950")
        XCTAssertEqual(TSChartFormat.axisLabel(1500), "1.5k")
        XCTAssertEqual(TSChartFormat.axisLabel(2_000_000), "2.0M")
    }

    func testAxisLabelHandlesNonFinite() {
        XCTAssertEqual(TSChartFormat.axisLabel(.nan), "—")
        XCTAssertEqual(TSChartFormat.axisLabel(.infinity), "—")
    }

    func testDownsampleReducesAndKeepsEndpoints() {
        let points = (0 ..< 1000).map { TSChartPoint(x: Double($0), y: Double($0)) }
        let reduced = TSChartFormat.downsample(points, maxCount: 100)
        XCTAssertEqual(reduced.count, 100)
        XCTAssertEqual(reduced.first?.xValue, 0)
        XCTAssertEqual(reduced.last?.xValue, 999)
    }

    func testDownsampleNoOpWhenSmall() {
        let points = (0 ..< 10).map { TSChartPoint(x: Double($0), y: 0) }
        XCTAssertEqual(TSChartFormat.downsample(points, maxCount: 100).count, 10)
    }

    func testToggleHidden() {
        var hidden = Set<String>()
        hidden = TSChartFormat.toggleHidden(hidden, "a")
        XCTAssertTrue(hidden.contains("a"))
        hidden = TSChartFormat.toggleHidden(hidden, "a")
        XCTAssertFalse(hidden.contains("a"))
    }

    func testSeriesSummary() {
        let series = TSChartSeries(
            id: "s",
            name: "s",
            nameText: "Speed",
            points: [TSChartPoint(x: 0, y: 10), TSChartPoint(x: 1, y: 30), TSChartPoint(x: 2, y: 20)]
        )
        let summary = TSChartFormat.summary(for: series)
        XCTAssertTrue(summary.contains("Speed"))
        XCTAssertTrue(summary.contains("min 10"))
        XCTAssertTrue(summary.contains("max 30"))
        XCTAssertTrue(summary.contains("latest 20"))
    }

    func testSeriesSummaryEmpty() {
        let series = TSChartSeries(id: "s", name: "s", nameText: "Empty", points: [])
        XCTAssertTrue(TSChartFormat.summary(for: series).contains("no data"))
    }
}
