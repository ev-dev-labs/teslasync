//
//  TimeOfUseAnalysis.Tests.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  State-holder + accessibility coverage for the TimeOfUseAnalysis surface:
//    • State holder (`TimeOfUseModel`) — phase + insights across loading / loaded /
//      empty / zero-session / failed, the P1/S11 `view.opened` telemetry (once), the
//      stale auto-refresh (exactly once, re-armed on return to live), and offline
//      keeping cached data.
//    • Accessibility — the chart summary + per-bar label/value content.
//
//  The pure adapter / projection / formatting cases live in
//  TimeOfUseAnalysis.AdapterTests.swift. These run in the TeslaSync(/-macOS) XCTest
//  targets; they have no network and no bundle (the model is driven through an
//  in-memory source).
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: TimeOfUseModel

@MainActor final class TimeOfUseModelTests: XCTestCase {
    private func makeModel(
        initial: TimeOfUseUpdate?,
        telemetry: TimeOfUseTelemetry = SpyTimeOfUseTelemetry()
    ) -> (TimeOfUseModel, InMemoryTimeOfUseSource) {
        let source = InMemoryTimeOfUseSource(initial: initial)
        let model = TimeOfUseModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func hours(_ count: Int) -> [TimeOfUseHourSample] {
        (0 ..< count).map { hour in
            TimeOfUseHourSample(
                hour: hour,
                label: String(format: "%02d:00", hour),
                sessions: hour + 1,
                avgCost: Double(hour) / 100 + 0.1,
                totalEnergy: Double(hour)
            )
        }
    }

    func testLoadedContentProjectsPointsAndInsights() {
        let (model, source) = makeModel(initial: TimeOfUseUpdate(status: .loaded, hours: hours(24)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 24)
        XCTAssertNotNil(model.insights)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: TimeOfUseUpdate(status: .loaded, hours: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.points.isEmpty)
        XCTAssertNil(model.insights)
    }

    func testZeroSessionHoursRenderContentWithoutInsights() {
        let zero = (0 ..< 24).map { hour in
            TimeOfUseHourSample(hour: hour, label: "\(hour)", sessions: 0, avgCost: 0, totalEnergy: 0)
        }
        let (model, _) = makeModel(initial: TimeOfUseUpdate(status: .loaded, hours: zero))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.insights, "web renders the chart but the noInsights branch when no hour has sessions")
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TimeOfUseUpdate(status: .loading, hours: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TimeOfUseUpdate(status: .failed("timeout"), hours: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTimeOfUseTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TimeOfUseSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(3), connection: .stale))
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(3), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(3), connection: .stale))
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(3), connection: .live))
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(3), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedPointsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(TimeOfUseUpdate(status: .loaded, hours: hours(2), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TimeOfUseUpdate(status: .failed("x"), hours: []))
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

    func testAxisTicksExposedFromModel() {
        let (model, _) = makeModel(initial: TimeOfUseUpdate(status: .loaded, hours: hours(24)))
        model.start()
        XCTAssertEqual(model.axisTickLabels.first, "00:00")
        XCTAssertEqual(model.axisTickLabels.count, 8)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class TimeOfUseAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let formatter = DefaultTimeOfUseFormatting(currencySymbol: "$", localeIdentifier: "en_US")

    private var points: [TimeOfUseHourPoint] {
        TimeOfUseProjection.points(from: [
            TimeOfUseHourSample(hour: 2, label: "02:00", sessions: 4, avgCost: 0.10, totalEnergy: 40),
            TimeOfUseHourSample(hour: 18, label: "18:00", sessions: 9, avgCost: 0.30, totalEnergy: 90)
        ])
    }

    func testChartSummaryIncludesTitleSessionsAndBusiest() {
        let summary = TimeOfUseAccessibility.chartSummary(
            points,
            localize: echo,
            formatCount: { formatter.formatCount($0) }
        )
        XCTAssertTrue(summary.contains("Hourly charging sessions"))
        XCTAssertTrue(summary.contains("13 sessions"))
        XCTAssertTrue(summary.contains("18:00"))
    }

    func testChartSummaryEmptyUsesNoDataMessage() {
        let summary = TimeOfUseAccessibility.chartSummary(
            [],
            localize: echo,
            formatCount: { formatter.formatCount($0) }
        )
        XCTAssertTrue(summary.contains("Hourly charging sessions"))
        XCTAssertTrue(summary.contains("Not enough data"))
    }

    func testChartSummaryZeroSessionsUsesNoDataMessage() {
        let zero = TimeOfUseProjection.points(from: [
            TimeOfUseHourSample(hour: 2, label: "02:00", sessions: 0, avgCost: 0, totalEnergy: 0)
        ])
        let summary = TimeOfUseAccessibility.chartSummary(
            zero,
            localize: echo,
            formatCount: { formatter.formatCount($0) }
        )
        XCTAssertTrue(summary.contains("Not enough data"))
    }

    func testBarLabelIsHourAndBandValueIsSessions() {
        let bar = points[1]
        XCTAssertEqual(TimeOfUseAccessibility.barLabel(bar, localize: echo), "18:00, peak")
        XCTAssertEqual(
            TimeOfUseAccessibility.barValue(bar, localize: echo, formatCount: { formatter.formatCount($0) }),
            "9 sessions"
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTimeOfUseTelemetry: TimeOfUseTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
