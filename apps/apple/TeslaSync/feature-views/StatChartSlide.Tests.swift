//
//  StatChartSlide.Tests.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  Unit coverage for the StatChartSlide surface:
//    • Format (fmtNumber port) — precision, grouping, non-finite→0, integer.
//    • Month labels — `MONTH_LABELS[m-1] ?? `M${m}`` parity incl. out-of-range.
//    • Adapter (cached → projection) — bar mapping, headline number + avg caption.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping cached recaps visible.
//    • Web-prop mapping — `data` → load state (loaded / empty / loading).
//    • Telemetry — `view.opened` event value + buffered sink.
//    • Accessibility — headline + per-bar VoiceOver content.
//    • Model — preview / web-prop / source binding + start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (and the SwiftPM host harness).
//  No network, no real store: the model is driven by `InMemoryStatChartSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Format + month labels

@MainActor
final class StatChartSlideFormatTests: XCTestCase {
    private let locale = "en_US"

    func testNumberPrecisionGroupingAndRounding() {
        XCTAssertEqual(StatChartSlideFormat.number(1284, decimals: 0, localeIdentifier: locale), "1,284")
        XCTAssertEqual(StatChartSlideFormat.number(24.7, decimals: 1, localeIdentifier: locale), "24.7")
        XCTAssertEqual(StatChartSlideFormat.number(1234.56, decimals: 1, localeIdentifier: locale), "1,234.6")
        XCTAssertEqual(StatChartSlideFormat.integer(1284, localeIdentifier: locale), "1,284")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(StatChartSlideFormat.number(.infinity, decimals: 1, localeIdentifier: locale), "0.0")
        XCTAssertEqual(StatChartSlideFormat.number(.nan, decimals: 0, localeIdentifier: locale), "0")
        XCTAssertEqual(StatChartSlideFormat.safeNumber(.nan), 0)
        XCTAssertEqual(StatChartSlideFormat.safeNumber(42), 42)
    }

    func testMonthLabelsMatchWebArrayAndFallback() {
        XCTAssertEqual(StatChartSlideMonthLabel.label(for: 1, localeIdentifier: locale), "Jan")
        XCTAssertEqual(StatChartSlideMonthLabel.label(for: 7, localeIdentifier: locale), "Jul")
        XCTAssertEqual(StatChartSlideMonthLabel.label(for: 12, localeIdentifier: locale), "Dec")
        XCTAssertEqual(StatChartSlideMonthLabel.label(for: 13, localeIdentifier: locale), "M13")
        XCTAssertEqual(StatChartSlideMonthLabel.label(for: 0, localeIdentifier: locale), "M0")
    }

    func testAxisLabelAbbreviation() {
        XCTAssertEqual(StatChartSlideChart.axisLabel(150, localeIdentifier: locale), "150")
        XCTAssertEqual(StatChartSlideChart.axisLabel(12000, localeIdentifier: locale), "12k")
        XCTAssertEqual(StatChartSlideChart.axisLabel(2_000_000, localeIdentifier: locale), "2.0M")
    }
}

// MARK: - Projection (cached → projection)

@MainActor
final class StatChartSlideProjectionTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    private func sampleData() -> StatChartSlideData {
        StatChartSlideData(
            totalDrives: 1284,
            avgDrivesPerWeek: 24.7,
            monthlyStats: [
                StatChartSlideMonthStat(month: 1, drives: 92),
                StatChartSlideMonthStat(month: 2, drives: 78),
                StatChartSlideMonthStat(month: 7, drives: 156)
            ]
        )
    }

    func testProjectionMapsBarsInOrder() {
        let projection = StatChartSlideProjection.make(from: sampleData(), locale: locale)
        XCTAssertEqual(projection.bars.map(\.month), [1, 2, 7])
        XCTAssertEqual(projection.bars.map(\.label), ["Jan", "Feb", "Jul"])
        XCTAssertEqual(projection.bars.map(\.drives), [92, 78, 156])
        XCTAssertEqual(projection.maxDrives, 156)
    }

    func testProjectionFormatsHeadlineAndAverage() {
        let projection = StatChartSlideProjection.make(from: sampleData(), locale: locale)
        XCTAssertEqual(projection.totalDrives, 1284)
        XCTAssertEqual(projection.totalDrivesText, "1,284")
        XCTAssertEqual(projection.avgPerWeekText, "24.7 drives per week on average")
    }

    func testProjectionHandlesOutOfRangeMonthAndEmptyStats() {
        let data = StatChartSlideData(
            totalDrives: 5,
            avgDrivesPerWeek: 0.2,
            monthlyStats: [StatChartSlideMonthStat(month: 13, drives: 3)]
        )
        let projection = StatChartSlideProjection.make(from: data, locale: locale)
        XCTAssertEqual(projection.bars.first?.label, "M13")
        XCTAssertEqual(projection.avgPerWeekText, "0.2 drives per week on average")

        let blank = StatChartSlideProjection.make(from: StatChartSlideData(), locale: locale)
        XCTAssertTrue(blank.bars.isEmpty)
        XCTAssertEqual(blank.maxDrives, 0)
        XCTAssertEqual(blank.totalDrivesText, "0")
    }

    func testDataEmptyDetection() {
        XCTAssertTrue(StatChartSlideData().isEmpty)
        XCTAssertTrue(StatChartSlideData(totalDrives: 0, monthlyStats: [
            StatChartSlideMonthStat(month: 1, drives: 0)
        ]).isEmpty)
        XCTAssertFalse(StatChartSlideData(totalDrives: 3).isEmpty)
        XCTAssertFalse(StatChartSlideData(monthlyStats: [
            StatChartSlideMonthStat(month: 1, drives: 2)
        ]).isEmpty)
    }
}

// MARK: - Presentation resolver (every state)

@MainActor
final class StatChartSlidePresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    private func sample() -> StatChartSlideData {
        StatChartSlideData(
            totalDrives: 12,
            avgDrivesPerWeek: 1.5,
            monthlyStats: [StatChartSlideMonthStat(month: 1, drives: 12)]
        )
    }

    private func resolve(_ state: StatChartSlideLoadState<StatChartSlideData>) -> StatChartSlidePresentation {
        StatChartSlidePresentation.resolve(state: state, locale: locale)
    }

    private func expected(_ data: StatChartSlideData) -> StatChartSlideProjection {
        StatChartSlideProjection.make(from: data, locale: locale)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(resolve(.loading(cached: StatChartSlideData(), stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedContentAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(resolve(.loaded(StatChartSlideData(), stale: false)), .empty)
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testStaleContent() {
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: false)
        )
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(resolve(.failed(.offline, cached: StatChartSlideData(), stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryabilityAndCache() {
        XCTAssertEqual(resolve(.failed(.network(message: "x"), cached: nil, stale: false)), .error(retryable: true))
        XCTAssertEqual(resolve(.failed(.decode(message: "x"), cached: nil, stale: false)), .error(retryable: false))
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Web-prop mapping + model + telemetry

@MainActor
final class StatChartSlideModelTests: XCTestCase {
    private func sample() -> StatChartSlideData {
        StatChartSlideData(
            totalDrives: 12,
            avgDrivesPerWeek: 1.5,
            monthlyStats: [StatChartSlideMonthStat(month: 1, drives: 12)]
        )
    }

    func testWebPropLoadStateMapping() {
        XCTAssertEqual(
            StatChartSlideModel.loadState(data: StatChartSlideData(), loading: true),
            .loading(cached: nil, stale: false)
        )
        XCTAssertEqual(
            StatChartSlideModel.loadState(data: sample(), loading: true),
            .loading(cached: sample(), stale: false)
        )
        XCTAssertEqual(StatChartSlideModel.loadState(data: StatChartSlideData(), loading: false), .empty(stale: false))
        XCTAssertEqual(StatChartSlideModel.loadState(data: sample(), loading: false), .loaded(sample(), stale: false))
    }

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(StatChartSlide.surfaceSlug, "StatChartSlide")
        XCTAssertEqual(
            StatChartSlide.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "StatChartSlide")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(StatChartSlide.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "StatChartSlide")]
        )
    }

    @MainActor
    func testWebPropConvenienceInit() {
        let populated = StatChartSlideModel(data: sample())
        XCTAssertEqual(populated.state, .loaded(sample(), stale: false))
        let empty = StatChartSlideModel(data: StatChartSlideData())
        XCTAssertEqual(empty.state, .empty(stale: false))
    }

    @MainActor
    func testPreviewModelExposesInjectedState() {
        let model = StatChartSlideModel(previewState: .loaded(sample(), stale: true))
        XCTAssertEqual(model.state, .loaded(sample(), stale: true))
    }

    @MainActor
    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let source = InMemoryStatChartSlideSource(initial: .loaded(sample(), stale: false))
        let model = StatChartSlideModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(sample(), stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility

@MainActor
final class StatChartSlideAccessibilityTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testHeadlineSummaryReadsTotalAndAverage() {
        let projection = StatChartSlideProjection.make(
            from: StatChartSlideData(totalDrives: 1284, avgDrivesPerWeek: 24.7),
            locale: locale
        )
        let summary = StatChartSlideAccessibility.headlineSummary(for: projection)
        XCTAssertTrue(summary.contains("1,284"))
        XCTAssertTrue(summary.contains("drives"))
        XCTAssertTrue(summary.contains("24.7 drives per week on average"))
    }

    func testBarValueReadsMonthAndCount() {
        let bar = StatChartSlideBar(month: 7, label: "Jul", drives: 156)
        XCTAssertEqual(
            StatChartSlideAccessibility.barValue(for: bar, localeIdentifier: "en_US"),
            "Jul: 156 drives"
        )
    }
}
