//
//  SignalChartPanel.Tests.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  Unit coverage for the SignalChartPanel surface:
//    • Adapter (rows → projection) — `SignalChartBuilder` parity with the web
//      `useRightAxis` / `effectiveMode` / per-cell projection + the `SignalChartFormat`
//      integer / timestamp / time helpers.
//    • State holder — `SignalChartModel` phase resolution across loading / empty /
//      error / content (live + historical), the P1/S11 `view.opened` telemetry, the
//      mode + dual-axis derivation, and the stale one-shot auto-refresh.
//    • Accessibility — the VoiceOver chart summary + series labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalChartSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: dual-axis + mode + projection (web `useMemo` chain)

@MainActor final class SignalChartBuilderTests: XCTestCase {
    private func stat(_ name: String, _ minimum: Double, _ maximum: Double) -> SignalSeriesStat {
        SignalSeriesStat(signal: name, min: minimum, max: maximum, avg: (minimum + maximum) / 2, count: 10)
    }

    func testUseRightAxisNeedsTwoStats() {
        XCTAssertFalse(SignalChartBuilder.useRightAxis([]))
        XCTAssertFalse(SignalChartBuilder.useRightAxis([stat("a", 0, 100)]))
    }

    func testUseRightAxisTrueWhenRangesDifferMoreThanTenfold() {
        let stats = [stat("a", 0, 100), stat("b", 2.7, 2.9)]
        XCTAssertTrue(SignalChartBuilder.useRightAxis(stats))
    }

    func testUseRightAxisFalseWhenRangesComparable() {
        let stats = [stat("a", 0, 100), stat("b", 0, 80)]
        XCTAssertFalse(SignalChartBuilder.useRightAxis(stats))
    }

    func testUseRightAxisTreatsFlatSeriesRangeAsOne() {
        // b is flat (range 0 → treated as 1); a spans 50 → 50/1 > 10 → true.
        let stats = [stat("a", 0, 50), stat("b", 5, 5)]
        XCTAssertTrue(SignalChartBuilder.useRightAxis(stats))
    }

    func testEffectiveModeOverlayAlwaysOverlay() {
        XCTAssertEqual(SignalChartBuilder.effectiveMode(.overlay, selectedCount: 20), .overlay)
    }

    func testEffectiveModeGridNeedsTwoSignals() {
        XCTAssertEqual(SignalChartBuilder.effectiveMode(.grid, selectedCount: 1), .overlay)
        XCTAssertEqual(SignalChartBuilder.effectiveMode(.grid, selectedCount: 2), .grid)
    }

    func testEffectiveModeAutoFlipsAboveThreshold() {
        XCTAssertEqual(SignalChartBuilder.effectiveMode(.auto, selectedCount: 8, gridAutoThreshold: 8), .overlay)
        XCTAssertEqual(SignalChartBuilder.effectiveMode(.auto, selectedCount: 9, gridAutoThreshold: 8), .grid)
    }

    func testRightAxisIndexOnlyWhenEnabledAndTwoPlus() {
        XCTAssertEqual(SignalChartBuilder.rightAxisIndex(useRightAxis: true, selectedCount: 3), 1)
        XCTAssertNil(SignalChartBuilder.rightAxisIndex(useRightAxis: true, selectedCount: 1))
        XCTAssertNil(SignalChartBuilder.rightAxisIndex(useRightAxis: false, selectedCount: 3))
    }

    func testSamplesAssignIndicesAndParseTimestamps() {
        let rows = [
            SignalChartRow(timestamp: "2026-06-07T19:00:00Z", values: ["a": 1]),
            SignalChartRow(timestamp: "not-a-date", values: ["a": 2])
        ]
        let samples = SignalChartBuilder.samples(from: rows)
        XCTAssertEqual(samples.map(\.index), [0, 1])
        XCTAssertNotNil(samples[0].timestamp)
        XCTAssertNil(samples[1].timestamp)
        XCTAssertEqual(samples[1].timestampRaw, "not-a-date")
    }

    func testProjectReportsContentSplit() {
        XCTAssertFalse(SignalChartBuilder.project(rows: []).hasData)
        let projection = SignalChartBuilder.project(rows: [SignalChartRow(timestamp: "t", values: ["a": 1])])
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.pointCount, 1)
    }

    func testDomainSpansSignalsAndPadsFlatSeries() {
        let samples = [
            SignalChartSample(index: 0, timestamp: nil, timestampRaw: "t", values: ["a": 10, "b": 5]),
            SignalChartSample(index: 1, timestamp: nil, timestampRaw: "t", values: ["a": 90, "b": 5])
        ]
        XCTAssertEqual(SignalChartBuilder.domain(for: ["a"], in: samples), 10 ... 90)
        XCTAssertEqual(SignalChartBuilder.domain(for: ["b"], in: samples), 4.5 ... 5.5)
        XCTAssertNil(SignalChartBuilder.domain(for: ["missing"], in: samples))
    }

    func testRescaleMapsBetweenRanges() {
        XCTAssertEqual(SignalChartBuilder.rescale(50, from: 0 ... 100, onto: 0 ... 10), 5, accuracy: 1e-9)
        XCTAssertEqual(SignalChartBuilder.rescale(2.8, from: 0 ... 100, onto: 0 ... 100), 2.8, accuracy: 1e-9)
        XCTAssertEqual(SignalChartBuilder.rescale(5, from: 5 ... 5, onto: 0 ... 10), 0, accuracy: 1e-9)
    }

    func testCellValuesKeepsFiniteOnlyAndDownsamples() {
        let samples = [
            SignalChartSample(index: 0, timestamp: nil, timestampRaw: "t", values: ["a": 1]),
            SignalChartSample(index: 1, timestamp: nil, timestampRaw: "t", values: ["a": .nan]),
            SignalChartSample(index: 2, timestamp: nil, timestampRaw: "t", values: [:]),
            SignalChartSample(index: 3, timestamp: nil, timestampRaw: "t", values: ["a": 4])
        ]
        XCTAssertEqual(SignalChartBuilder.cellValues(of: "a", in: samples), [1, 4])
        XCTAssertEqual(SignalChartBuilder.cellValues(of: "a", in: samples, maxPoints: 1), [1, 4])
    }

    func testDownsamplePreservesEndpoints() {
        let values = Array(stride(from: 0.0, through: 99.0, by: 1.0))
        let sampled = SignalChartBuilder.downsample(values, maxCount: 10)
        XCTAssertEqual(sampled.count, 10)
        XCTAssertEqual(sampled.first, 0)
        XCTAssertEqual(sampled.last, 99)
    }

    func testEndpointIndicesFirstAndLast() {
        let samples = (0 ..< 5).map {
            SignalChartSample(index: $0, timestamp: nil, timestampRaw: "t", values: [:])
        }
        XCTAssertEqual(SignalChartBuilder.endpointIndices(samples), [0, 4])
        XCTAssertEqual(SignalChartBuilder.endpointIndices([samples[0]]), [0])
        XCTAssertEqual(SignalChartBuilder.endpointIndices([]), [])
    }
}

// MARK: - Adapter: formatting (web `fmtInt` / `useDateFormat`)

@MainActor final class SignalChartFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testIntGroupsThousands() {
        XCTAssertEqual(SignalChartFormat.int(12345, locale: enUS), "12,345")
        XCTAssertEqual(SignalChartFormat.int(0, locale: enUS), "0")
    }

    func testParseTimestampHandlesIsoVariantsAndJunk() {
        XCTAssertNotNil(SignalChartFormat.parseTimestamp("2026-06-07T19:00:00Z"))
        XCTAssertNotNil(SignalChartFormat.parseTimestamp("2026-06-07T19:00:00.250Z"))
        XCTAssertNil(SignalChartFormat.parseTimestamp(""))
        XCTAssertNil(SignalChartFormat.parseTimestamp("not-a-date"))
    }

    func testTimeIsNonEmpty() {
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let utc = TimeZone(identifier: "UTC") ?? .current
        XCTAssertFalse(SignalChartFormat.time(from: date, locale: enUS, timeZone: utc).isEmpty)
    }

    func testTooltipNumberFormatsWithGrouping() {
        XCTAssertEqual(SignalChartNumber.tooltip(78.5, locale: enUS), "78.5")
        XCTAssertEqual(SignalChartNumber.tooltip(1234, locale: enUS), "1,234")
    }
}

// MARK: - State holder: phases + telemetry + derivation

@MainActor final class SignalChartModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalChartUpdate,
        telemetry: SignalChartTelemetry = OSLogSignalChartTelemetry()
    ) -> (SignalChartModel, InMemorySignalChartSource) {
        let source = InMemorySignalChartSource(initial: update)
        let model = SignalChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func rows() -> [SignalChartRow] {
        (0 ..< 6).map { SignalChartRow(
            timestamp: "2026-06-07T19:00:0\($0)Z",
            values: ["a": Double($0), "b": Double($0) * 2]
        ) }
    }

    func testHistoricalLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SignalChartUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLiveLoadingWithoutDataShowsEmptyWaiting() {
        let (model, _) = makeModel(SignalChartUpdate(status: .loading, isLive: true))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.isLive)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SignalChartUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(SignalChartUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(SignalChartUpdate(status: .failed("net"), selectedSignals: ["a", "b"], rows: rows()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.pointCount, 6)
    }

    func testModeAndDualAxisDerivedFromUpdate() {
        let signals = (0 ..< 9).map { "s\($0)" }
        let stats = [
            SignalSeriesStat(signal: "s0", min: 0, max: 100, avg: 50, count: 9),
            SignalSeriesStat(signal: "s1", min: 2.7, max: 2.9, avg: 2.8, count: 9)
        ]
        let update = SignalChartUpdate(
            status: .loaded,
            selectedSignals: signals,
            rows: [SignalChartRow(timestamp: "t", values: ["s0": 1])],
            stats: stats,
            chartMode: .auto
        )
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.mode, .grid)
        XCTAssertTrue(model.useRightAxis)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalChartTelemetry()
        let (model, source) = makeModel(SignalChartUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalChartSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(SignalChartUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testCountersAndConnectionTrackUpdates() {
        let (model, source) = makeModel(SignalChartUpdate(status: .loading))
        model.start()
        source.push(SignalChartUpdate(
            status: .loaded,
            connection: .offline,
            isLive: true,
            selectedSignals: ["a", "b"],
            rows: rows(),
            liveEventCount: 42,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.liveEventCount, 42)
        XCTAssertEqual(model.phase, .content)
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(SignalChartUpdate(status: .loaded, selectedSignals: ["a"], rows: rows()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SignalChartUpdate(status: .loaded, connection: .stale, selectedSignals: ["a"], rows: rows()))
        source.push(SignalChartUpdate(status: .loaded, connection: .stale, selectedSignals: ["a"], rows: rows()))
        XCTAssertEqual(source.refreshCount, 1, "stale auto-refresh is one-shot")
        source.push(SignalChartUpdate(status: .loaded, connection: .live, selectedSignals: ["a"], rows: rows()))
        source.push(SignalChartUpdate(status: .loaded, connection: .stale, selectedSignals: ["a"], rows: rows()))
        XCTAssertEqual(source.refreshCount, 2, "re-arms after returning live")
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(SignalChartUpdate(status: .loaded, selectedSignals: ["a"], rows: rows()))
        model.start()
        source.push(SignalChartUpdate(status: .loaded, connection: .offline, selectedSignals: ["a"], rows: rows()))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testAccessibilitySummaryReflectsState() {
        let (model, _) = makeModel(SignalChartUpdate(
            status: .loaded,
            isLive: true,
            selectedSignals: ["a", "b"],
            rows: rows()
        ))
        model.start()
        let summary = model.accessibilitySummary
        XCTAssertTrue(summary.contains("Live Signal Stream"))
        XCTAssertTrue(summary.contains("2"))
    }
}

// MARK: - Accessibility

@MainActor final class SignalChartAccessibilityTests: XCTestCase {
    func testChartSummaryIncludesTitleLayoutAndCounts() {
        let summary = SignalChartAccessibility.chartSummary(
            isLive: false,
            mode: .grid,
            signalCount: 4,
            pointCount: 120,
            localize: SignalChartStrings.string
        )
        XCTAssertTrue(summary.contains("Signal Chart"))
        XCTAssertTrue(summary.contains("grid"))
        XCTAssertTrue(summary.contains("4"))
        XCTAssertTrue(summary.contains("120"))
    }

    func testSeriesLabelJoinsNameAndValue() {
        XCTAssertEqual(SignalChartAccessibility.seriesLabel(name: "speed", value: "42"), "speed: 42")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalChartTelemetry: SignalChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
