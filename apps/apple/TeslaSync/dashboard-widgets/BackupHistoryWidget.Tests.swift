//
//  BackupHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  Unit coverage for the BackupHistoryWidget surface:
//    • Adapter (cached → projection) — `BackupHistoryAdapter` sort parity with
//      the web `sortedItems` `useMemo`, the duration / integer / date-time
//      formatter ports (`fmtDuration` / `fmtInt` / `formatDateTime`), the 30-day
//      outage count, and the average outage duration.
//    • State holder — `BackupHistoryModel` phase resolution across loading /
//      no-site / empty / error / content, plus the P1/S11 `view.opened`
//      telemetry + source wiring + freshness/projection tracking.
//    • Registry — canonical `backup-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryBackupHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = BackupHistoryFormatOptions(localeIdentifier: "en-US", timeZoneIdentifier: "UTC")

private func at(_ secondsFromEpoch: TimeInterval) -> Date {
    Date(timeIntervalSince1970: secondsFromEpoch)
}

private func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
    components.second = 0
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
    return calendar.date(from: components) ?? .distantPast
}

private func event(_ id: Int64, at timestamp: Date? = nil, duration: Double? = 0) -> BackupHistoryEvent {
    BackupHistoryEvent(id: id, timestamp: timestamp, durationSeconds: duration)
}

// MARK: - Adapter: cached DTO → projection (parity with the web source)

@MainActor final class BackupHistoryAdapterTests: XCTestCase {
    func testEventsSortByTimestampDescending() {
        let events = [
            event(1, at: at(1000), duration: 60),
            event(2, at: at(3000), duration: 60),
            event(3, at: at(2000), duration: 60)
        ]
        let projection = BackupHistoryAdapter.project(events: events, siteLinked: true, options: enUS)
        XCTAssertEqual(projection.rows.map(\.id), [2, 3, 1])
        XCTAssertEqual(projection.totalOutages, 3)
        XCTAssertTrue(projection.hasEvents)
    }

    func testDisplayedRowsCapMatchesCompactAndStandardLimits() {
        let events = (1 ... 12).map { event(Int64($0), at: at(Double($0) * 1000), duration: 60) }
        let projection = BackupHistoryAdapter.project(events: events, siteLinked: true, options: enUS)
        // All 12 rows are retained; the view caps the visible slice.
        XCTAssertEqual(projection.rows.count, 12)
        XCTAssertEqual(projection.displayedRows(max: BackupHistoryAdapter.compactMaxEvents).count, 3)
        XCTAssertEqual(projection.displayedRows(max: BackupHistoryAdapter.standardMaxEvents).count, 10)
        // Newest first (id 12) at the head of the capped slice.
        XCTAssertEqual(projection.displayedRows(max: 3).first?.id, 12)
    }

    func testDurationFormattingMatchesWebFmtDuration() {
        XCTAssertEqual(BackupHistoryFormat.duration(45), "45s")
        XCTAssertEqual(BackupHistoryFormat.duration(0), "0s")
        XCTAssertEqual(BackupHistoryFormat.duration(59.4), "59s")
        XCTAssertEqual(BackupHistoryFormat.duration(90), "1m")
        XCTAssertEqual(BackupHistoryFormat.duration(2700), "45m")
        XCTAssertEqual(BackupHistoryFormat.duration(7200), "2h")
        XCTAssertEqual(BackupHistoryFormat.duration(8100), "2h 15m")
        XCTAssertEqual(BackupHistoryFormat.duration(13500), "3h 45m")
    }

    func testIntegerFormattingGroupsThousands() {
        XCTAssertEqual(BackupHistoryFormat.integer(0, locale: enUS.locale), "0")
        XCTAssertEqual(BackupHistoryFormat.integer(7, locale: enUS.locale), "7")
        XCTAssertEqual(BackupHistoryFormat.integer(1234, locale: enUS.locale), "1,234")
    }

    func testDateTimeFormattingMatchesWebFormatDateTime() {
        let when = utcDate(2026, 4, 4, 15, 45)
        XCTAssertEqual(BackupHistoryFormat.dateTime(when, options: enUS), "Apr 4, 2026, 03:45 PM")
    }

    func testDateTimeMissingValueIsEmDash() {
        XCTAssertEqual(BackupHistoryFormat.dateTime(nil, options: enUS), "—")
    }

    func testRowFormattingThreadsTimeAndDuration() {
        let when = utcDate(2026, 1, 2, 9, 5)
        let projection = BackupHistoryAdapter.project(
            events: [event(7, at: when, duration: 8100)],
            siteLinked: true,
            options: enUS
        )
        XCTAssertEqual(projection.rows.first?.timeText, "Jan 2, 2026, 09:05 AM")
        XCTAssertEqual(projection.rows.first?.durationText, "2h 15m")
    }

    func testAverageDurationIsMeanOfDurations() {
        let projection = BackupHistoryAdapter.project(
            events: [
                event(1, at: at(2000), duration: 120),
                event(2, at: at(1000), duration: 240)
            ],
            siteLinked: true,
            options: enUS
        )
        // mean(120, 240) = 180s → "3m"
        XCTAssertEqual(projection.avgDurationText, "3m")
        XCTAssertEqual(projection.totalOutagesText, "2")
    }

    func testMissingDurationCountsAsZero() {
        let projection = BackupHistoryAdapter.project(
            events: [BackupHistoryEvent(id: 9, timestamp: at(1000), durationSeconds: nil)],
            siteLinked: true,
            options: enUS
        )
        XCTAssertEqual(projection.rows.first?.durationText, "0s")
        XCTAssertEqual(projection.avgDurationText, "0s")
    }

    func testEmptyEventsProduceZeroStatsAndNoRows() {
        let projection = BackupHistoryAdapter.project(events: [], siteLinked: true, options: enUS)
        XCTAssertFalse(projection.hasEvents)
        XCTAssertEqual(projection.totalOutages, 0)
        XCTAssertEqual(projection.totalOutagesText, "0")
        XCTAssertEqual(projection.avgDurationText, "0s")
        XCTAssertTrue(projection.siteLinked)
    }

    func testSiteLinkedFlagIsCarried() {
        let linked = BackupHistoryAdapter.project(events: [], siteLinked: true, options: enUS)
        let unlinked = BackupHistoryAdapter.project(events: [], siteLinked: false, options: enUS)
        XCTAssertTrue(linked.siteLinked)
        XCTAssertFalse(unlinked.siteLinked)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class BackupHistoryModelTests: XCTestCase {
    private func makeModel(
        _ update: BackupHistoryUpdate,
        telemetry: BackupHistoryTelemetry = OSLogBackupHistoryTelemetry()
    ) -> (BackupHistoryModel, InMemoryBackupHistorySource) {
        let source = InMemoryBackupHistorySource(initial: update)
        let model = BackupHistoryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutEventsShowsLoading() {
        let (model, _) = makeModel(BackupHistoryUpdate(status: .loading, siteLinked: false, events: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutLinkedSiteShowsNoSite() {
        let (model, _) = makeModel(BackupHistoryUpdate(status: .loaded, siteLinked: false, events: []))
        model.start()
        XCTAssertEqual(model.phase, .noSite)
    }

    func testLoadedWithLinkedSiteButNoEventsShowsEmpty() {
        let (model, _) = makeModel(BackupHistoryUpdate(status: .loaded, siteLinked: true, events: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BackupHistoryUpdate(status: .failed("boom"), siteLinked: true, events: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEventsPresentShowContentEvenWhileLoadingOrFailed() {
        let rows = [event(1, at: at(1000), duration: 60)]
        let (loading, _) = makeModel(BackupHistoryUpdate(status: .loading, siteLinked: true, events: rows))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(BackupHistoryUpdate(status: .failed("net"), siteLinked: true, events: rows))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyBackupHistoryTelemetry()
        let (model, source) = makeModel(BackupHistoryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackupHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BackupHistoryUpdate(status: .loaded, siteLinked: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BackupHistoryUpdate(status: .loading))
        model.start()
        source.push(
            BackupHistoryUpdate(
                status: .loaded,
                connection: .offline,
                siteLinked: true,
                events: [
                    event(1, at: at(1000), duration: 120),
                    event(2, at: at(2000), duration: 240)
                ],
                options: enUS,
                updatedAt: at(5000)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasEvents)
        XCTAssertTrue(model.siteLinked)
        // Newest (id 2) first.
        XCTAssertEqual(model.projection.rows.first?.id, 2)
        XCTAssertEqual(model.projection.totalOutagesText, "2")
        XCTAssertEqual(model.updatedAt, at(5000))
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(BackupHistoryModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(BackupHistoryModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class BackupHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BackupHistoryWidget.registration
        XCTAssertEqual(registration.id, "backup-history")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(BackupHistoryWidget.surfaceSlug, "BackupHistoryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = BackupHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class BackupHistoryAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleCountAndAverage() {
        let summary = BackupHistoryAccessibility.summary(siteLinked: true, outages: 3, avgDurationText: "1h 23m")
        XCTAssertTrue(summary.contains("Backup History"))
        XCTAssertTrue(summary.contains("3 outages"))
        XCTAssertTrue(summary.contains("Average duration 1h 23m"))
    }

    func testSummaryHandlesNoSite() {
        let summary = BackupHistoryAccessibility.summary(siteLinked: false, outages: 0, avgDurationText: "0s")
        XCTAssertTrue(summary.contains("Backup History"))
        XCTAssertTrue(summary.contains("No Tesla Energy site linked"))
    }

    func testSummaryHandlesNoEvents() {
        let summary = BackupHistoryAccessibility.summary(siteLinked: true, outages: 0, avgDurationText: "0s")
        XCTAssertTrue(summary.contains("Backup History"))
        XCTAssertTrue(summary.contains("No backup events in the last 30 days"))
    }

    func testCompactSummaryIncludesCount() {
        let summary = BackupHistoryAccessibility.compactSummary(outages: 5)
        XCTAssertTrue(summary.contains("Outages (30d)"))
        XCTAssertTrue(summary.contains("5"))
    }

    func testEventLabelIncludesTimeAndDuration() {
        let label = BackupHistoryAccessibility.eventLabel(time: "Apr 4, 2026, 03:45 PM", duration: "2h 15m")
        XCTAssertTrue(label.contains("Outage on"))
        XCTAssertTrue(label.contains("Apr 4, 2026, 03:45 PM"))
        XCTAssertTrue(label.contains("2h 15m"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBackupHistoryTelemetry: BackupHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
