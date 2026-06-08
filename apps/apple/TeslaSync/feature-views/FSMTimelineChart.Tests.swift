//
//  FSMTimelineChart.Tests.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  Pure-core unit coverage for the FSMTimelineChart surface:
//    • Adapter (`FSMTimelineProjector`) — the bucket-width selection, the floor /
//      epoch-ms helpers, the wall-clock "HH:mm" label, the verbatim web `useMemo`
//      port (sorted series, the start..now grid, per-cell counts, out-of-window
//      drops, the trailing now-aligned cell), the content/empty threshold, phase
//      resolution, the flattened (cell × series) points, and the total / peak /
//      lookup / max-stack summaries.
//    • Formatting (`FSMTimelineFormat`) — locale-aware whole-number strings.
//    • Accessibility — the chart summary, the per-cell tooltip value, the legend value.
//
//  The state-holder (`FSMTimelineChartModel`) coverage lives in
//  `FSMTimelineChart.ModelTests.swift`. These run in the TeslaSync(/-macOS) XCTest
//  targets; they have no network and no bundle (the adapter is pure). `now` + a UTC
//  calendar are injected so every bucket boundary + label is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web FSMTimelineChart useMemo parity)

final class FSMTimelineProjectorTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    /// A bucket-aligned `now` (a multiple of the 10-minute cell), so the six-hour
    /// grid is exactly 37 cells with deterministic boundaries.
    private let nowMs: Int64 = 1_700_000_400_000
    private var now: Date {
        Date(timeIntervalSince1970: Double(nowMs) / 1000)
    }

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }

    /// vehicle + drive in the last cell, telemetry_connection 70m back, drive 125m
    /// back, and one vehicle 10h back that falls outside the six-hour window.
    private var transitions: [FSMTransitionInput] {
        [
            FSMTransitionInput(timestamp: now.addingTimeInterval(-5 * 60), fsmName: "vehicle"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-5 * 60), fsmName: "drive"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-65 * 60), fsmName: "telemetry_connection"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-125 * 60), fsmName: "drive"),
            FSMTransitionInput(timestamp: now.addingTimeInterval(-10 * 3600), fsmName: "vehicle")
        ]
    }

    private func project(hours: Int = 6) -> FSMTimelineProjection {
        FSMTimelineProjector.project(transitions: transitions, hours: hours, now: now, calendar: utc)
    }

    func testBucketMillisSelectsByWindow() {
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 1), 600_000)
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 6), 600_000)
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 7), 1_800_000)
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 24), 1_800_000)
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 168), 7_200_000)
        XCTAssertEqual(FSMTimelineProjector.bucketMillis(forHours: 720), 7_200_000)
    }

    func testFloorToMultipleMatchesMathFloor() {
        XCTAssertEqual(FSMTimelineProjector.floor(1_700_000_100_000, toMultipleOf: 600_000), 1_699_999_800_000)
        XCTAssertEqual(FSMTimelineProjector.floor(600_000, toMultipleOf: 600_000), 600_000)
        XCTAssertEqual(FSMTimelineProjector.floor(0, toMultipleOf: 600_000), 0)
        // Floors toward −∞ (not toward zero), matching JS Math.floor on negatives.
        XCTAssertEqual(FSMTimelineProjector.floor(-1, toMultipleOf: 10), -10)
    }

    func testMillisTruncatesToWholeMilliseconds() {
        XCTAssertEqual(FSMTimelineProjector.millis(from: Date(timeIntervalSince1970: 1.5)), 1500)
        XCTAssertEqual(FSMTimelineProjector.millis(from: now), nowMs)
    }

    func testTimeLabelFormatsWallClockInCalendarZone() throws {
        XCTAssertEqual(FSMTimelineProjector.timeLabel(forMillis: 0, calendar: utc), "00:00")
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 13
        components.minute = 45
        let date = try XCTUnwrap(utc.date(from: components))
        let ms = FSMTimelineProjector.millis(from: date)
        XCTAssertEqual(FSMTimelineProjector.timeLabel(forMillis: ms, calendar: utc), "13:45")
    }

    func testEmptyTransitionsYieldEmptyProjection() {
        let projection = FSMTimelineProjector.project(transitions: [], hours: 6, now: now, calendar: utc)
        XCTAssertTrue(projection.buckets.isEmpty)
        XCTAssertTrue(projection.series.isEmpty)
        XCTAssertFalse(FSMTimelineProjector.hasData(projection.buckets))
    }

    func testGridSpansStartToNowInclusive() {
        // Six hours of 10-minute cells over a bucket-aligned window = 36 steps + the
        // trailing now-aligned cell = 37 (web loop is `ts <= now`).
        XCTAssertEqual(project().buckets.count, 37)
        XCTAssertEqual(project().buckets.first?.startMs, nowMs - 21_600_000)
        XCTAssertEqual(project().buckets.last?.startMs, nowMs)
        XCTAssertEqual(project().buckets.map(\.index), Array(0 ..< 37))
    }

    func testSeriesAreSortedUniqueWithStableIndices() {
        let series = project().series
        XCTAssertEqual(series.map(\.name), ["drive", "telemetry_connection", "vehicle"])
        XCTAssertEqual(series.map(\.index), [0, 1, 2])
        XCTAssertEqual(series.map(\.id), series.map(\.name))
    }

    func testCountsLandInTheCorrectCells() {
        let buckets = project().buckets
        let lastFull = buckets.first { $0.startMs == nowMs - 600_000 }
        XCTAssertEqual(lastFull?.count(for: "vehicle"), 1)
        XCTAssertEqual(lastFull?.count(for: "drive"), 1)
        XCTAssertEqual(lastFull?.count(for: "telemetry_connection"), 0)
        XCTAssertEqual(lastFull?.total, 2)
    }

    func testOutOfWindowTransitionsAreDropped() {
        // The 10-hour-old vehicle transition is outside the six-hour grid (web `if
        // (bucket)`), so the window total is 4, not 5.
        XCTAssertEqual(FSMTimelineProjector.totalTransitions(project().buckets), 4)
        let nonZero = project().buckets.filter { $0.total > 0 }
        XCTAssertEqual(nonZero.count, 3)
    }

    func testPeakAndMaxStackHeight() {
        let peak = FSMTimelineProjector.peakBucket(project().buckets)
        XCTAssertEqual(peak?.total, 2)
        XCTAssertEqual(peak?.startMs, nowMs - 600_000)
        XCTAssertEqual(FSMTimelineProjector.maxStackHeight(project().buckets), 2)
    }

    func testMaxStackHeightFloorsAtOne() {
        let empty = FSMTimelineProjector.project(
            transitions: [FSMTransitionInput(timestamp: now.addingTimeInterval(-10 * 3600), fsmName: "vehicle")],
            hours: 6,
            now: now,
            calendar: utc
        )
        // The single transition is out-of-window, so every cell is zero, but the
        // axis must still span at least 0...1.
        XCTAssertEqual(FSMTimelineProjector.maxStackHeight(empty.buckets), 1)
    }

    func testHasDataMirrorsBucketCount() {
        XCTAssertFalse(FSMTimelineProjector.hasData([]))
        XCTAssertTrue(FSMTimelineProjector.hasData(project().buckets))
    }

    func testResolvePhase() {
        XCTAssertEqual(FSMTimelineProjector.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(FSMTimelineProjector.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(FSMTimelineProjector.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(FSMTimelineProjector.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testAreaPointsFlattenEveryCellAndSeriesIncludingZeros() {
        let projection = project()
        let points = FSMTimelineProjector.areaPoints(projection)
        XCTAssertEqual(points.count, projection.buckets.count * projection.series.count)
        XCTAssertEqual(points.count, 37 * 3)
        // The peak cell carries one point per series with the expected counts.
        let peakPoints = points
            .filter { $0.label == (FSMTimelineProjector.peakBucket(projection.buckets)?.label ?? "") }
        XCTAssertEqual(peakPoints.count, 3)
        XCTAssertEqual(Set(peakPoints.map(\.count)), [0, 1])
        // Zero-count points exist (the empty trailing cell contributes them).
        XCTAssertTrue(points.map(\.count).contains(0))
        XCTAssertEqual(points.first?.colorIndex, 0)
    }

    func testBucketLookupResolvesTooltipDatum() {
        let buckets = project().buckets
        XCTAssertEqual(FSMTimelineProjector.bucket(atIndex: 0, in: buckets)?.index, 0)
        XCTAssertEqual(FSMTimelineProjector.bucket(atIndex: 36, in: buckets)?.index, 36)
        XCTAssertNil(FSMTimelineProjector.bucket(atIndex: nil, in: buckets))
        XCTAssertNil(FSMTimelineProjector.bucket(atIndex: 99, in: buckets))
    }

    func testTwentyFourHourWindowUsesThirtyMinuteCells() {
        let projection = FSMTimelineProjector.project(transitions: transitions, hours: 24, now: now, calendar: utc)
        // 24h / 30min = 48 steps + the trailing now-aligned cell = 49.
        XCTAssertEqual(projection.buckets.count, 49)
        // All five transitions fall within 24 hours now.
        XCTAssertEqual(FSMTimelineProjector.totalTransitions(projection.buckets), 5)
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(FSMTimelineChartSurface.slug, "FSMTimelineChart")
        XCTAssertEqual(FSMTimelineChart.surfaceSlug, "FSMTimelineChart")
    }
}

// MARK: - Formatting

final class FSMTimelineFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testCountRendersWholeNumber() {
        XCTAssertEqual(FSMTimelineFormat.count(0, locale: posix), "0")
        XCTAssertEqual(FSMTimelineFormat.count(7, locale: posix), "7")
        // en_US groups thousands; POSIX intentionally does not.
        XCTAssertEqual(FSMTimelineFormat.count(1234, locale: Locale(identifier: "en_US")), "1,234")
        XCTAssertEqual(FSMTimelineFormat.count(1234, locale: posix), "1234")
    }

    func testAxisCountRoundsAndGuardsNonFinite() {
        XCTAssertEqual(FSMTimelineFormat.axisCount(3, locale: posix), "3")
        XCTAssertEqual(FSMTimelineFormat.axisCount(3.6, locale: posix), "4")
        XCTAssertEqual(FSMTimelineFormat.axisCount(.nan, locale: posix), "—")
        XCTAssertEqual(FSMTimelineFormat.axisCount(.infinity, locale: posix), "—")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class FSMTimelineChartAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    private func series() -> [FSMTimelineSeries] {
        [
            FSMTimelineSeries(index: 0, name: "drive"),
            FSMTimelineSeries(index: 1, name: "telemetry_connection"),
            FSMTimelineSeries(index: 2, name: "vehicle")
        ]
    }

    private func projection() -> FSMTimelineProjection {
        let buckets = [
            FSMTimelineBucket(index: 0, startMs: 0, label: "08:00", counts: ["drive": 1], total: 1),
            FSMTimelineBucket(
                index: 1,
                startMs: 600_000,
                label: "08:10",
                counts: ["drive": 1, "vehicle": 1],
                total: 2
            ),
            FSMTimelineBucket(index: 2, startMs: 1_200_000, label: "08:20", counts: [:], total: 0)
        ]
        return FSMTimelineProjection(buckets: buckets, series: series())
    }

    func testChartSummaryIncludesTotalsMachinesSpanAndPeak() {
        let summary = FSMTimelineChartAccessibility.chartSummary(
            projection: projection(),
            emptyMessage: "No transition data for timeline",
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("Transitions Over Time"))
        XCTAssertTrue(summary.contains("3 transitions"))
        XCTAssertTrue(summary.contains("3 state machines"))
        XCTAssertTrue(summary.contains("from 08:00 to 08:20"))
        XCTAssertTrue(summary.contains("busiest 08:10 (2)"))
    }

    func testChartSummaryEmptyUsesEmptyMessage() {
        let summary = FSMTimelineChartAccessibility.chartSummary(
            projection: FSMTimelineProjection(buckets: [], series: []),
            emptyMessage: "No transition data for timeline",
            localize: echo,
            locale: posix
        )
        XCTAssertEqual(summary, "Transitions Over Time: No transition data for timeline")
    }

    func testBucketValueListsActiveSeriesAndTotal() {
        let bucket = FSMTimelineBucket(
            index: 1,
            startMs: 600_000,
            label: "08:10",
            counts: ["drive": 1, "vehicle": 1, "telemetry_connection": 0],
            total: 2
        )
        let value = FSMTimelineChartAccessibility.bucketValue(
            bucket,
            series: series(),
            localize: echo,
            locale: posix
        )
        // Series order is sorted; telemetry_connection (0) is skipped.
        XCTAssertEqual(value, "08:10: drive 1, vehicle 1 (total 2)")
    }

    func testBucketValueEmptyCellUsesNoneFallback() {
        let bucket = FSMTimelineBucket(index: 2, startMs: 0, label: "08:20", counts: [:], total: 0)
        let value = FSMTimelineChartAccessibility.bucketValue(
            bucket,
            series: series(),
            localize: echo,
            locale: posix
        )
        XCTAssertEqual(value, "08:20: no transitions")
    }

    func testLegendValueSumsSeriesAcrossWindow() {
        let value = FSMTimelineChartAccessibility.legendValue(
            FSMTimelineSeries(index: 0, name: "drive"),
            buckets: projection().buckets,
            localize: echo,
            locale: posix
        )
        XCTAssertEqual(value, "drive: 2 transitions")
    }
}
