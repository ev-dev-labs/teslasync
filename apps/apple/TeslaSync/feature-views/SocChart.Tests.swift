//
//  SocChart.Tests.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  Unit coverage for the SocChart surface:
//    • Adapter (`SocChartProjection`) — reading→sample indexing, the
//      `chartData.length > 1` content/empty threshold, phase resolution, the
//      start / end / min / max SOC summaries, and the synced-cursor index/sample
//      lookups (parity with the web `SocChart` body + `useSyncedReferenceLineX`).
//    • Formatting (`SocChartFormat`) — locale-aware whole-percent strings.
//    • State holder (`SocChartModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the synced cursor
//      (move + auto-clear on data change), the stale auto-refresh (exactly once),
//      and offline keeping the cached trace.
//    • Accessibility — the chart summary + per-sample VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web SocChart body parity)

final class SocChartProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private let readings: [SocReading] = [
        SocReading(time: "12:00", battery: 82),
        SocReading(time: "12:06", battery: 77),
        SocReading(time: "12:12", battery: 73),
        SocReading(time: "12:18", battery: 68)
    ]

    func testSamplesAssignSequentialIndices() {
        let samples = SocChartProjection.samples(from: readings)
        XCTAssertEqual(samples.map(\.index), [0, 1, 2, 3])
        XCTAssertEqual(samples.map(\.time), ["12:00", "12:06", "12:12", "12:18"])
        XCTAssertEqual(samples.map(\.battery), [82, 77, 73, 68])
        XCTAssertEqual(samples.map(\.id), samples.map(\.index))
    }

    func testHasTraceMirrorsLengthGreaterThanOne() {
        // Web `chartData.length > 1`: 0 and 1 sample are empty; 2+ render.
        XCTAssertFalse(SocChartProjection.hasTrace([]))
        XCTAssertFalse(SocChartProjection.hasTrace(SocChartProjection.samples(from: [readings[0]])))
        XCTAssertTrue(SocChartProjection.hasTrace(SocChartProjection.samples(from: Array(readings.prefix(2)))))
        XCTAssertTrue(SocChartProjection.hasTrace(SocChartProjection.samples(from: readings)))
    }

    func testResolvePhase() {
        XCTAssertEqual(SocChartProjection.resolvePhase(.loading, hasTrace: false), .loading)
        XCTAssertEqual(SocChartProjection.resolvePhase(.loaded, hasTrace: true), .content)
        XCTAssertEqual(SocChartProjection.resolvePhase(.loaded, hasTrace: false), .empty)
        XCTAssertEqual(SocChartProjection.resolvePhase(.failed("boom"), hasTrace: true), .error("boom"))
    }

    func testStartEndMinMaxSoc() {
        let samples = SocChartProjection.samples(from: readings)
        XCTAssertEqual(SocChartProjection.startSoc(samples), 82)
        XCTAssertEqual(SocChartProjection.endSoc(samples), 68)
        XCTAssertEqual(SocChartProjection.minSoc(samples), 68)
        XCTAssertEqual(SocChartProjection.maxSoc(samples), 82)
    }

    func testSummaryHelpersAreNilWhenEmpty() {
        XCTAssertNil(SocChartProjection.startSoc([]))
        XCTAssertNil(SocChartProjection.endSoc([]))
        XCTAssertNil(SocChartProjection.minSoc([]))
        XCTAssertNil(SocChartProjection.maxSoc([]))
    }

    func testSampleAtIndex() {
        let samples = SocChartProjection.samples(from: readings)
        XCTAssertEqual(SocChartProjection.sample(at: 2, in: samples)?.time, "12:12")
        XCTAssertNil(SocChartProjection.sample(at: nil, in: samples))
        XCTAssertNil(SocChartProjection.sample(at: 99, in: samples))
    }

    func testIndexForTimeResolvesSyncedCursor() {
        let samples = SocChartProjection.samples(from: readings)
        XCTAssertEqual(SocChartProjection.index(forTime: "12:06", in: samples), 1)
        XCTAssertNil(SocChartProjection.index(forTime: "99:99", in: samples))
        XCTAssertNil(SocChartProjection.index(forTime: nil, in: samples))
    }

    func testIndexForTimeFirstMatchWinsOnDuplicateLabels() {
        let dupes = SocChartProjection.samples(from: [
            SocReading(time: "12:00", battery: 80),
            SocReading(time: "12:00", battery: 79)
        ])
        XCTAssertEqual(SocChartProjection.index(forTime: "12:00", in: dupes), 0)
    }

    func testSocDomainIsZeroToOneHundred() {
        XCTAssertEqual(SocChartProjection.socDomain, 0 ... 100)
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(SocChartSurface.slug, "SocChart")
        XCTAssertEqual(SocChart.surfaceSlug, "SocChart")
    }
}

// MARK: - Formatting

final class SocChartFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testPercentRendersWholeNumber() {
        XCTAssertEqual(SocChartFormat.percent(82, locale: posix), "82%")
        XCTAssertEqual(SocChartFormat.percent(0, locale: posix), "0%")
        XCTAssertEqual(SocChartFormat.percent(100, locale: posix), "100%")
    }

    func testPercentRoundsToNearest() {
        XCTAssertEqual(SocChartFormat.percent(73.4, locale: posix), "73%")
        XCTAssertEqual(SocChartFormat.percent(73.6, locale: posix), "74%")
    }

    func testPercentNonFiniteIsEmDash() {
        XCTAssertEqual(SocChartFormat.percent(.nan, locale: posix), "—")
        XCTAssertEqual(SocChartFormat.percent(.infinity, locale: posix), "—")
    }
}

// MARK: - State holder: SocChartModel

@MainActor
final class SocChartModelTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private let trace: [SocReading] = [
        SocReading(time: "12:00", battery: 82),
        SocReading(time: "12:06", battery: 77),
        SocReading(time: "12:12", battery: 73)
    ]

    private func makeModel(
        initial: SocChartUpdate?,
        telemetry: SocChartTelemetry = SpySocChartTelemetry()
    ) -> (SocChartModel, InMemorySocChartSource) {
        let source = InMemorySocChartSource(initial: initial)
        let model = SocChartModel(source: source, telemetry: telemetry, locale: posix)
        return (model, source)
    }

    func testLoadedContentProjectsSamples() {
        let (model, source) = makeModel(initial: SocChartUpdate(status: .loaded, readings: trace))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 3)
        XCTAssertEqual(model.samples.first?.battery, 82)
        XCTAssertEqual(model.samples.last?.battery, 73)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SocChartUpdate(status: .loaded, readings: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.samples.isEmpty)
    }

    func testSingleSampleResolvesEmptyPhase() {
        // Web `chartData.length > 1`: a lone sample cannot draw a trace.
        let (model, _) = makeModel(initial: SocChartUpdate(status: .loaded, readings: [trace[0]]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.samples.count, 1)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SocChartUpdate(status: .loading, readings: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SocChartUpdate(status: .failed("timeout"), readings: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySocChartTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SocChartSurface.slug])
    }

    func testMoveCursorSetsAndClearsSelectedTime() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SocChartUpdate(status: .loaded, readings: trace))
        model.moveCursor(to: "12:06")
        XCTAssertEqual(model.selectedTime, "12:06")
        model.moveCursor(to: nil)
        XCTAssertNil(model.selectedTime)
    }

    func testCursorAutoClearsWhenSampleRemovedOnDataChange() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SocChartUpdate(status: .loaded, readings: trace))
        model.moveCursor(to: "12:12")
        XCTAssertEqual(model.selectedTime, "12:12")
        // New data without that label → the lingering reference line is dropped.
        source.push(SocChartUpdate(status: .loaded, readings: Array(trace.prefix(2))))
        XCTAssertNil(model.selectedTime)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .stale))
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .stale))
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .live))
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SocChartUpdate(status: .loaded, readings: trace, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SocChartUpdate(status: .failed("x"), readings: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class SocChartAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    private var samples: [SocSample] {
        SocChartProjection.samples(from: [
            SocReading(time: "12:00", battery: 82),
            SocReading(time: "12:30", battery: 73),
            SocReading(time: "13:00", battery: 61)
        ])
    }

    func testChartSummaryIncludesStartAndEnd() {
        let summary = SocChartAccessibility.chartSummary(samples: samples, localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("SOC % Over Time"))
        XCTAssertTrue(summary.contains("3 samples"))
        XCTAssertTrue(summary.contains("start 82%"))
        XCTAssertTrue(summary.contains("end 61%"))
    }

    func testChartSummaryEmptyUsesNoTelemetryFallback() {
        let summary = SocChartAccessibility.chartSummary(samples: [], localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("SOC % Over Time"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testChartSummarySingleSampleIsEmptyFallback() {
        let one = SocChartProjection.samples(from: [SocReading(time: "12:00", battery: 80)])
        let summary = SocChartAccessibility.chartSummary(samples: one, localize: echo, locale: posix)
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }

    func testSampleValue() {
        let value = SocChartAccessibility.sampleValue(samples[1], localize: echo, locale: posix)
        XCTAssertEqual(value, "12:30: SOC 73%")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySocChartTelemetry: SocChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
