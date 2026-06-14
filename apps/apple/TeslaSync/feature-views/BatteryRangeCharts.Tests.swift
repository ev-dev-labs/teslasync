//
//  BatteryRangeCharts.Tests.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  Unit coverage for the BatteryRangeCharts surface:
//    • Math (`BatteryRangeChartsMath`) — SI distance conversion, `fmtNumber` formatting, the
//      `Math.round` distance / minute helpers, the `RadialGauge` percent text, the `batteryColor`
//      band thresholds, and the `formatDate` label (parity with `lib/unitConversion.ts`,
//      `lib/numberFormat.ts`, `lib/dateFormat.ts`).
//    • Projection (`BatteryRangeChartsProjection`) — the gauge / Battery / Range / bar / drive-point
//      derivations (web `useMemo` parity, incl. the `.reverse()` of `driveChartData`), the
//      `hasState` content/empty split, and `resolvePhase`.
//    • Accessibility — the battery + drive chart VoiceOver summaries.
//
//  The state-holder (`BatteryRangeChartsModel`) coverage lives in
//  BatteryRangeCharts.ModelTests.swift. These run in the TeslaSync(/-macOS) XCTest targets and in
//  the isolated SwiftPM harness. They have no network and no bundle: the math + projection are
//  pure.
//

import XCTest
@testable import TeslaSync

// MARK: - Math (unit / number / date parity)

final class BatteryRangeChartsMathTests: XCTestCase {
    func testConvertDistanceFromSIMatchesWebFactors() {
        XCTAssertEqual(BatteryRangeChartsMath.convertDistanceFromSI(1000, to: .kilometers), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BatteryRangeChartsMath.convertDistanceFromSI(1609.344, to: .miles), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BatteryRangeChartsMath.convertDistanceFromSI(0.3048, to: .feet), 1.0, accuracy: 1e-9)
    }

    func testNumberFormatsGroupedHalfUp() {
        XCTAssertEqual(BatteryRangeChartsMath.number(1234.5, decimals: 0, localeIdentifier: "en_US"), "1,235")
        XCTAssertEqual(BatteryRangeChartsMath.number(1234.5, decimals: 1, localeIdentifier: "en_US"), "1,234.5")
        XCTAssertEqual(BatteryRangeChartsMath.number(.nan, decimals: 0, localeIdentifier: "en_US"), "0")
    }

    func testRoundedDistanceConvertsThenRoundsHalfUp() {
        XCTAssertEqual(BatteryRangeChartsMath.roundedDistance(42000, unit: .kilometers), 42)
        XCTAssertEqual(BatteryRangeChartsMath.roundedDistance(42500, unit: .kilometers), 43)
        XCTAssertEqual(BatteryRangeChartsMath.roundedDistance(nil, unit: .kilometers), 0)
    }

    func testRoundedMinutesMirrorsWebDivideRound() {
        XCTAssertEqual(BatteryRangeChartsMath.roundedMinutes(2880), 48)
        XCTAssertEqual(BatteryRangeChartsMath.roundedMinutes(2850), 48)
        XCTAssertEqual(BatteryRangeChartsMath.roundedMinutes(nil), 0)
    }

    func testGaugePercentTextIntegerVsFractionalVsAbsent() {
        XCTAssertEqual(
            BatteryRangeChartsMath.gaugePercentText(72, preferencePrecision: nil, localeIdentifier: "en_US"),
            "72"
        )
        XCTAssertEqual(
            BatteryRangeChartsMath.gaugePercentText(72.5, preferencePrecision: nil, localeIdentifier: "en_US"),
            "72.50"
        )
        XCTAssertEqual(
            BatteryRangeChartsMath.gaugePercentText(120, preferencePrecision: nil, localeIdentifier: "en_US"),
            "100"
        )
        XCTAssertEqual(
            BatteryRangeChartsMath.gaugePercentText(nil, preferencePrecision: nil, localeIdentifier: "en_US"),
            "—"
        )
    }

    func testBandMatchesWebBatteryColorThresholds() {
        XCTAssertEqual(BatteryRangeChartsMath.band(for: 61), .high)
        XCTAssertEqual(BatteryRangeChartsMath.band(for: 60), .medium)
        XCTAssertEqual(BatteryRangeChartsMath.band(for: 26), .medium)
        XCTAssertEqual(BatteryRangeChartsMath.band(for: 25), .low)
        XCTAssertEqual(BatteryRangeChartsMath.band(for: 0), .low)
        XCTAssertEqual(BatteryRangeChartsMath.band(for: nil), .unknown)
    }

    func testBandTonesMapToSemanticColors() {
        XCTAssertEqual(BatteryRangeChartsBatteryBand.high.tone, .success)
        XCTAssertEqual(BatteryRangeChartsBatteryBand.medium.tone, .warning)
        XCTAssertEqual(BatteryRangeChartsBatteryBand.low.tone, .danger)
        XCTAssertEqual(BatteryRangeChartsBatteryBand.unknown.tone, .muted)
    }

    func testDateLabelAbsentIsEmDashAndPresentIsLocalized() {
        XCTAssertEqual(BatteryRangeChartsMath.dateLabel(nil, localeIdentifier: "en_US"), "—")
        // Mid-year date so the rendered year is time-zone stable.
        let date = Date(timeIntervalSince1970: 1_718_000_000)
        let label = BatteryRangeChartsMath.dateLabel(date, localeIdentifier: "en_US")
        XCTAssertFalse(label.isEmpty)
        XCTAssertTrue(label.contains("2024"))
    }

    func testDistanceUnitFromSymbolDefaultsToKilometers() {
        XCTAssertEqual(BatteryRangeChartsDistanceUnit.from(symbol: "mi"), .miles)
        XCTAssertEqual(BatteryRangeChartsDistanceUnit.from(symbol: "ft"), .feet)
        XCTAssertEqual(BatteryRangeChartsDistanceUnit.from(symbol: "??"), .kilometers)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BatteryRangeChartsSurface.slug, "BatteryRangeCharts")
    }
}

// MARK: - Projection (web JSX + useMemo parity)

final class BatteryRangeChartsProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func prefs(
        _ unit: BatteryRangeChartsDistanceUnit = .kilometers
    ) -> BatteryRangeChartsUnitPrefs {
        BatteryRangeChartsUnitPrefs(distance: unit, localeIdentifier: "en_US", precision: nil)
    }

    private var sampleDrives: [BatteryRangeChartsDrive] {
        let base = Date(timeIntervalSince1970: 1_718_000_000)
        return [
            BatteryRangeChartsDrive(
                id: "newest",
                startTimestamp: base,
                distanceMeters: 42000,
                durationSeconds: 2880
            ),
            BatteryRangeChartsDrive(
                id: "middle",
                startTimestamp: base.addingTimeInterval(-86400),
                distanceMeters: 18500,
                durationSeconds: 1500
            ),
            BatteryRangeChartsDrive(
                id: "oldest",
                startTimestamp: base.addingTimeInterval(-2 * 86400),
                distanceMeters: 9800,
                durationSeconds: 900
            )
        ]
    }

    func testGaugeProjectsLevelBandAndFraction() {
        let snapshot = BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 72, ratedRangeMeters: 412_000)
        )
        let content = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(), localize: echo)
        XCTAssertEqual(content.gauge.valueText, "72")
        XCTAssertEqual(content.gauge.unit, "%")
        XCTAssertEqual(content.gauge.band, .high)
        XCTAssertEqual(content.gauge.fraction, 0.72, accuracy: 1e-9)
        XCTAssertTrue(content.gauge.hasValue)
        XCTAssertEqual(content.gauge.accessibilityLabel, "Battery: 72%")
    }

    func testBatteryAndRangeTiles() {
        let snapshot = BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 72, ratedRangeMeters: 412_000)
        )
        let km = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(.kilometers), localize: echo)
        XCTAssertEqual(km.batteryMetric.value, "72%")
        XCTAssertEqual(km.rangeMetric.value, "412 km")
        let mi = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(.miles), localize: echo)
        XCTAssertEqual(mi.rangeMetric.value, "256 mi")
    }

    func testBatteryBarsAreCurrentAndRemaining() {
        let snapshot = BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 72, ratedRangeMeters: 412_000)
        )
        let content = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(), localize: echo)
        XCTAssertEqual(content.batteryBars.count, 2)
        XCTAssertEqual(content.batteryBars[0].name, "Current")
        XCTAssertEqual(content.batteryBars[0].value, 72, accuracy: 1e-9)
        XCTAssertEqual(content.batteryBars[0].display, "72%")
        XCTAssertEqual(content.batteryBars[1].name, "Remaining")
        XCTAssertEqual(content.batteryBars[1].value, 28, accuracy: 1e-9)
        XCTAssertEqual(content.batteryBars[1].display, "28%")
    }

    func testDrivePointsAreReversedRoundedAndOrdered() {
        let snapshot = BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 50, ratedRangeMeters: 300_000),
            drives: sampleDrives
        )
        let content = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(), localize: echo)
        XCTAssertEqual(content.drivePoints.count, 3)
        // Web `.reverse()` puts the oldest drive first (x order 0).
        XCTAssertEqual(content.drivePoints.map(\.id), ["oldest", "middle", "newest"])
        XCTAssertEqual(content.drivePoints.map(\.order), [0, 1, 2])
        XCTAssertEqual(content.drivePoints[0].distance, 10) // round(9_800 / 1000)
        XCTAssertEqual(content.drivePoints[0].duration, 15) // round(900 / 60)
        XCTAssertEqual(content.drivePoints[2].distance, 42)
        XCTAssertEqual(content.drivePoints[2].duration, 48)
        XCTAssertTrue(content.hasDriveData)
        XCTAssertEqual(content.distanceUnitSymbol, "km")
    }

    func testNoDrivesHasNoDriveData() {
        let snapshot = BatteryRangeChartsSnapshot(
            state: BatteryRangeChartsState(batteryLevel: 50, ratedRangeMeters: 300_000),
            drives: []
        )
        let content = BatteryRangeChartsProjection.content(snapshot: snapshot, prefs: prefs(), localize: echo)
        XCTAssertFalse(content.hasDriveData)
        XCTAssertTrue(content.drivePoints.isEmpty)
        XCTAssertTrue(content.hasState)
    }

    func testAbsentStateProjectsEmDashesAndZeroBars() {
        let content = BatteryRangeChartsProjection.content(snapshot: nil, prefs: prefs(), localize: echo)
        XCTAssertFalse(content.hasState)
        XCTAssertFalse(content.gauge.hasValue)
        XCTAssertEqual(content.gauge.valueText, "—")
        XCTAssertEqual(content.batteryMetric.value, "—")
        XCTAssertEqual(content.rangeMetric.value, "—")
        XCTAssertEqual(content.batteryBars[0].value, 0, accuracy: 1e-9)
        XCTAssertEqual(content.batteryBars[1].value, 100, accuracy: 1e-9)
    }

    func testResolvePhase() {
        XCTAssertEqual(BatteryRangeChartsProjection.resolvePhase(status: .loading, hasState: false), .loading)
        XCTAssertEqual(BatteryRangeChartsProjection.resolvePhase(status: .loading, hasState: true), .content)
        XCTAssertEqual(BatteryRangeChartsProjection.resolvePhase(status: .loaded, hasState: false), .empty)
        XCTAssertEqual(BatteryRangeChartsProjection.resolvePhase(status: .loaded, hasState: true), .content)
        XCTAssertEqual(
            BatteryRangeChartsProjection.resolvePhase(status: .failed("x"), hasState: false),
            .error("x")
        )
        XCTAssertEqual(BatteryRangeChartsProjection.resolvePhase(status: .failed("x"), hasState: true), .content)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

final class BatteryRangeChartsAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testBatteryChartSummaryIncludesBars() {
        let bars = [
            BatteryRangeChartsBatteryBar(id: "current", name: "Current", value: 72, display: "72%"),
            BatteryRangeChartsBatteryBar(id: "remaining", name: "Remaining", value: 28, display: "28%")
        ]
        let summary = BatteryRangeChartsAccessibility.batteryChartSummary(bars: bars, localize: echo)
        XCTAssertTrue(summary.contains("Battery Overview"))
        XCTAssertTrue(summary.contains("Current 72%"))
        XCTAssertTrue(summary.contains("Remaining 28%"))
    }

    func testDriveChartSummaryWithPoints() {
        let points = [
            BatteryRangeChartsDrivePoint(id: "a", order: 0, dateLabel: "Jun 1, 2024", distance: 10, duration: 15),
            BatteryRangeChartsDrivePoint(id: "b", order: 1, dateLabel: "Jun 2, 2024", distance: 42, duration: 48)
        ]
        let summary = BatteryRangeChartsAccessibility.driveChartSummary(
            points: points,
            unitSymbol: "km",
            localize: echo
        )
        XCTAssertTrue(summary.contains("Drive Distance Trend"))
        XCTAssertTrue(summary.contains("2 drives"))
        XCTAssertTrue(summary.contains("(km)"))
    }

    func testDriveChartSummaryEmpty() {
        let summary = BatteryRangeChartsAccessibility.driveChartSummary(
            points: [],
            unitSymbol: "km",
            localize: echo
        )
        XCTAssertTrue(summary.contains("Drive Distance Trend"))
        XCTAssertTrue(summary.contains("No drive data for chart"))
    }

    func testDrivePointValue() {
        let point = BatteryRangeChartsDrivePoint(
            id: "a",
            order: 0,
            dateLabel: "Jun 1, 2024",
            distance: 42,
            duration: 48
        )
        let value = BatteryRangeChartsAccessibility.drivePointValue(point, unitSymbol: "km", localize: echo)
        XCTAssertEqual(value, "Jun 1, 2024: Distance 42 km, Duration 48 min")
    }
}
