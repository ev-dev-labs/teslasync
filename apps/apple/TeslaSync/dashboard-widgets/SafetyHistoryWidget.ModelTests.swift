//
//  SafetyHistoryWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  Unit coverage for the SafetyHistoryWidget stats, layout, state holder, registry,
//  and accessibility seams (split from `SafetyHistoryWidget.Tests.swift`, which covers
//  the enum normalization + classify-ladder adapter). These run in the
//  TeslaSync(/-macOS) XCTest targets with no network and no real store: the model is
//  driven by `SafetyHistoryInMemorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Stats: 30-day total / most common / trend (web parity)

final class SafetyStatsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func daysAgo(_ days: Double) -> Date {
        now.addingTimeInterval(-days * 24 * 60 * 60)
    }

    func testTotalCountsOnlyLast30DaysAndExcludesNilCreatedAt() {
        let events = [
            SafetyEventInput(id: 1, vehicleID: 7, createdAt: daysAgo(1)),
            SafetyEventInput(id: 2, vehicleID: 7, createdAt: daysAgo(10)),
            SafetyEventInput(id: 3, vehicleID: 7, createdAt: daysAgo(40)), // prior window — excluded
            SafetyEventInput(id: 4, vehicleID: 7, createdAt: nil) // no timestamp — excluded
        ]
        let stats = SafetyStatsBuilder.build(events: events, now: now, localize: echo)
        XCTAssertEqual(stats.totalEvents, 2)
    }

    func testMostCommonPicksHighestCount() {
        let events = [
            SafetyEventInput(id: 1, vehicleID: 7, createdAt: daysAgo(1), blindSpotCollisionWarning: true),
            SafetyEventInput(id: 2, vehicleID: 7, createdAt: daysAgo(2), blindSpotCollisionWarning: true),
            SafetyEventInput(id: 3, vehicleID: 7, createdAt: daysAgo(3), automaticEmergencyBrakingOff: true)
        ]
        let stats = SafetyStatsBuilder.build(events: events, now: now, localize: echo)
        XCTAssertEqual(stats.mostCommon, "Blind Spot")
    }

    func testMostCommonTieBreaksByFirstEncounter() {
        // One AEB then one blind-spot — tie at 1 each, AEB encountered first wins.
        let events = [
            SafetyEventInput(id: 1, vehicleID: 7, createdAt: daysAgo(1), automaticEmergencyBrakingOff: true),
            SafetyEventInput(id: 2, vehicleID: 7, createdAt: daysAgo(2), blindSpotCollisionWarning: true)
        ]
        XCTAssertEqual(SafetyStatsBuilder.mostCommonLabel(in: events, localize: echo), "AEB")
    }

    func testMostCommonDashWhenNoRecent() {
        let stats = SafetyStatsBuilder.build(events: [], now: now, localize: echo)
        XCTAssertEqual(stats.mostCommon, "—")
        XCTAssertEqual(stats.totalEvents, 0)
        XCTAssertEqual(stats.trend, .none)
    }

    func testTrendLadder() {
        XCTAssertEqual(SafetyStatsBuilder.trend(recentCount: 5, priorCount: 2), .up)
        XCTAssertEqual(SafetyStatsBuilder.trend(recentCount: 1, priorCount: 4), .down)
        XCTAssertEqual(SafetyStatsBuilder.trend(recentCount: 3, priorCount: 3), .flat)
        XCTAssertEqual(SafetyStatsBuilder.trend(recentCount: 9, priorCount: 0), .none)
    }

    func testTrendGlyphAndSublabel() {
        XCTAssertEqual(SafetyTrend.up.glyph, "↑")
        XCTAssertEqual(SafetyTrend.down.glyph, "↓")
        XCTAssertEqual(SafetyTrend.flat.glyph, "→")
        XCTAssertEqual(SafetyTrend.none.glyph, "—")
        XCTAssertEqual(SafetyStatsBuilder.trendSublabel(.up, localize: echo), "Increasing")
        XCTAssertEqual(SafetyStatsBuilder.trendSublabel(.down, localize: echo), "Decreasing")
        XCTAssertEqual(SafetyStatsBuilder.trendSublabel(.flat, localize: echo), "Stable")
        XCTAssertEqual(SafetyStatsBuilder.trendSublabel(.none, localize: echo), "Stable")
    }

    func testTrendIncreasesOverPriorWindow() {
        let events = [
            SafetyEventInput(id: 1, vehicleID: 7, createdAt: daysAgo(1)),
            SafetyEventInput(id: 2, vehicleID: 7, createdAt: daysAgo(2)),
            SafetyEventInput(id: 3, vehicleID: 7, createdAt: daysAgo(45)) // prior window
        ]
        XCTAssertEqual(SafetyStatsBuilder.build(events: events, now: now, localize: echo).trend, .up)
    }
}

// MARK: - Layout: compact gate + feed cap (web parity)

final class SafetyLayoutTests: XCTestCase {
    func testIsCompactOnlyWhenSingleColumn() {
        XCTAssertTrue(SafetyLayout.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(SafetyLayout.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(SafetyLayout.isCompact(for: DashboardWidgetSize(cols: 4, rows: 40)))
    }

    func testFeedMaxItemsMatchesWeb() {
        XCTAssertEqual(SafetyLayout.feedMaxItems, 10)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SafetyHistoryWidgetSafetyModelTests: XCTestCase {
    private func makeModel(
        _ update: SafetyHistoryUpdate,
        telemetry: SafetyHistoryTelemetry = SafetyHistoryOSLogTelemetry()
    ) -> (SafetyHistoryModel, SafetyHistoryInMemorySource) {
        let source = SafetyHistoryInMemorySource(initial: update)
        let model = SafetyHistoryModel(
            source: source,
            telemetry: telemetry,
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )
        return (model, source)
    }

    private func sampleEvent() -> SafetyEventInput {
        SafetyEventInput(
            id: 1,
            vehicleID: 7,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            blindSpotCollisionWarning: true
        )
    }

    func testLoadingWithoutEventsShowsLoading() {
        let (model, _) = makeModel(SafetyHistoryUpdate(status: .loading, events: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutEventsShowsEmpty() {
        let (model, _) = makeModel(SafetyHistoryUpdate(status: .loaded, events: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutEventsShowsError() {
        let (model, _) = makeModel(SafetyHistoryUpdate(status: .failed("boom"), events: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEventsPresentShowContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(SafetyHistoryUpdate(status: .loading, events: [sampleEvent()]))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SafetyHistoryUpdate(status: .failed("net"), events: [sampleEvent()]))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SafetyHistoryWidgetSpySafetyTelemetry()
        let (model, source) = makeModel(SafetyHistoryUpdate(status: .loading, events: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SafetyHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SafetyHistoryUpdate(status: .loaded, events: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionProjectionAndStatsTrackUpdates() {
        let (model, source) = makeModel(SafetyHistoryUpdate(status: .loading, events: []))
        model.start()
        source.push(
            SafetyHistoryUpdate(
                status: .loaded,
                connection: .offline,
                events: [sampleEvent()],
                updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.feedItems.count, 1)
        XCTAssertEqual(model.feedItems.first?.kind, .blindSpot)
        XCTAssertEqual(model.stats.totalEvents, 1)
        XCTAssertEqual(model.stats.mostCommon, "Blind Spot")
    }
}

// MARK: - Registry parity

@MainActor final class SafetyHistoryWidgetSafetyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SafetyHistoryWidget.registration
        XCTAssertEqual(registration.id, "safety-history")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SafetyHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class SafetyHistoryWidgetSafetyAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func item(title: String, subtitle: String) -> SafetyFeedItem {
        SafetyFeedItem(
            id: "1",
            kind: .blindSpot,
            title: title,
            subtitle: subtitle,
            timestamp: Date(),
            severity: .warning
        )
    }

    func testEventSummaryIncludesSubtitleWhenMeaningful() {
        let summary = SafetyHistoryAccessibility.eventSummary(
            for: item(title: "Blind Spot Warning", subtitle: "Follow: 3 · PIN to Drive")
        )
        XCTAssertEqual(summary, "Blind Spot Warning. Follow: 3 · PIN to Drive")
    }

    func testEventSummaryOmitsDashSentinelSubtitle() {
        let summary = SafetyHistoryAccessibility.eventSummary(
            for: item(title: "Safety State Update", subtitle: "—")
        )
        XCTAssertEqual(summary, "Safety State Update")
    }

    func testCompactSummaryWithEvents() {
        let stats = SafetyStats(totalEvents: 5, mostCommon: "AEB", trend: .up)
        XCTAssertEqual(
            SafetyHistoryAccessibility.compactSummary(stats: stats, localize: echo),
            "5 events (30d). AEB. Increasing"
        )
    }

    func testCompactSummaryWhenZero() {
        let stats = SafetyStats(totalEvents: 0, mostCommon: "—", trend: .none)
        XCTAssertEqual(
            SafetyHistoryAccessibility.compactSummary(stats: stats, localize: echo),
            "No safety events"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SafetyHistoryWidgetSpySafetyTelemetry: SafetyHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
