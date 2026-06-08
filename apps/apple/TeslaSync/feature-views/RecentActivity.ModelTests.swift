//
//  RecentActivity.ModelTests.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  State-holder + accessibility coverage for the RecentActivity surface:
//    • `RecentActivityModel` phase across loading / loaded / empty / failed, the P1/S11
//      `view.opened` telemetry (once), the stale auto-refresh (once, re-armed on live), offline
//      keeping cached panels, the timeline cap, and the resolved display locale.
//    • `RecentActivityAccessibility` container summary + per-row / per-metric VoiceOver value.
//
//  The adapter (formatting + projection) coverage lives in RecentActivity.Tests.swift. These run
//  in the TeslaSync(/-macOS) XCTest targets: the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: RecentActivityModel

@MainActor
final class RecentActivityModelTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_733_580_000)

    private func units(_ localeID: String = "en-US") -> RecentActivityUnits {
        RecentActivityUnits(
            distanceUnit: "mi", efficiencyUnit: "Wh/mi", efficiencyFactor: 1.609344,
            currencySymbol: "$", localeIdentifier: localeID
        )
    }

    private func sampleDrives(_ count: Int) -> [RecentActivityDrive] {
        (0 ..< count).map { index in
            RecentActivityDrive(
                id: "d\(index)", distanceM: 16093.44, durationS: 5400, startSocPct: 80, endSocPct: 60,
                startedAt: now.addingTimeInterval(-Double(index + 1) * 600)
            )
        }
    }

    private func sampleCharge() -> RecentActivityCharge {
        RecentActivityCharge(
            id: "c0", energyAddedWh: 31400, startSocPct: 44, endSocPct: 80, cost: 9.4,
            startedAt: now.addingTimeInterval(-300)
        )
    }

    private func makeModel(
        initial: RecentActivityUpdate?,
        telemetry: RecentActivityTelemetry = SpyRecentActivityTelemetry()
    ) -> (RecentActivityModel, InMemoryRecentActivitySource) {
        let source = InMemoryRecentActivitySource(initial: initial)
        let model = RecentActivityModel(source: source, telemetry: telemetry, now: { [now = self.now] in now })
        return (model, source)
    }

    private func loaded(_ connection: RecentActivityConnection = .live) -> RecentActivityUpdate {
        RecentActivityUpdate(
            status: .loaded,
            drives: sampleDrives(2),
            charges: [sampleCharge()],
            analytics: RecentActivityAnalytics(
                totalDrives: 142, totalChargingSessions: 47, totalCost: 612, totalEnergyKwh: 1180.4,
                mostEfficientVehicle: nil
            ),
            units: units(),
            connection: connection,
            updatedAt: now
        )
    }

    func testLoadedContentProjectsPanels() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.itemCount, 3)
        XCTAssertEqual(model.timelineItems.count, 3)
        XCTAssertEqual(model.batteryTrend.count, 2)
        XCTAssertEqual(model.performance.metrics.count, 4)
        XCTAssertEqual(model.timelineItems.first?.kind, .charge)
        XCTAssertEqual(source.startCount, 1)
    }

    func testTimelineCapAppliesInModel() {
        let update = RecentActivityUpdate(status: .loaded, drives: sampleDrives(12), units: units())
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.itemCount, 12)
        XCTAssertEqual(model.timelineItems.count, 8)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(initial: RecentActivityUpdate(status: .loaded, units: units()))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(initial: RecentActivityUpdate(status: .loading, units: units()))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(initial: RecentActivityUpdate(status: .failed("timeout"), units: units()))
        failed.start()
        XCTAssertEqual(failed.phase, .error("timeout"))
    }

    func testCachedPanelsStayContentWhileFailing() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        source.push(
            RecentActivityUpdate(status: .failed("net"), drives: sampleDrives(2), units: units(), connection: .stale)
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyRecentActivityTelemetry()
        let (model, source) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RecentActivitySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(initial: loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the stale auto-refresh")
        _ = model
    }

    func testOfflineKeepsCachedPanelsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.itemCount, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testDisplayLocaleTracksPreferences() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(RecentActivityUpdate(status: .loaded, drives: sampleDrives(1), units: units("de-DE")))
        XCTAssertEqual(model.displayLocale, Locale(identifier: "de-DE"))
    }

    func testRetryRefreshesSourceAndStopStopsIt() {
        let (model, source) = makeModel(initial: RecentActivityUpdate(status: .failed("x"), units: units()))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor
final class RecentActivityAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testItemLabelJoinsTitleSubtitleTime() {
        let item = RecentActivityItem(
            id: "drive-1", kind: .drive, title: "10.0 mi drive", subtitle: "1h 30m · 80% → 60%",
            timeAgo: "10m ago", timestamp: nil
        )
        XCTAssertEqual(RecentActivityAccessibility.itemLabel(item), "10.0 mi drive, 1h 30m · 80% → 60%, 10m ago")
    }

    func testMetricLabel() {
        let metric = RecentActivityMetric(
            id: "cost", labelKey: "perf.cost", labelFallback: "Total Cost", value: "$612.00", tone: .warning
        )
        XCTAssertEqual(RecentActivityAccessibility.metricLabel(metric, localize: echo), "Total Cost: $612.00")
    }

    func testSummaryIncludesTitleAndCount() {
        let summary = RecentActivityAccessibility.summary(itemCount: 3, localize: echo)
        XCTAssertTrue(summary.contains("Recent Activity"))
        XCTAssertTrue(summary.contains("3 recent events"))
    }

    func testSummaryEmptyUsesFriendlyMessage() {
        let summary = RecentActivityAccessibility.summary(itemCount: 0, localize: echo)
        XCTAssertTrue(summary.contains("Recent Activity"))
        XCTAssertTrue(summary.contains("No activity yet. Start driving!"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyRecentActivityTelemetry: RecentActivityTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
