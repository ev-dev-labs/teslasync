//
//  NotificationStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  Unit coverage for the NotificationStatsWidget surface:
//    • Adapter (cached → projection) — decode + `NotificationStatsProjection`
//      parity with the web source's `coreStats` / `recentLogs` / `formatLogTime`.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping cached values visible.
//    • Registry — canonical `notification-stats` metadata + size clamping.
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the stat-region summary content.
//    • Model — preview binding + source start/refresh delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryNotificationStatsSource`.
//

import XCTest
@testable import TeslaSync

@MainActor
final class NotificationStatsAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func data(failed: Int = 20) -> NotificationStatsData {
        let stats = NotificationStats(
            totalSent: 1000, sent: 950, failed: failed, pending: 30, totalChannels: 5, enabledChannels: 4
        )
        let logs = [
            NotificationLog(
                id: 1,
                title: "Pushover",
                message: "Charge complete",
                status: .sent,
                createdAt: now.addingTimeInterval(-30)
            ),
            NotificationLog(
                id: 2,
                title: "Email",
                message: "Sentry triggered",
                status: .failed,
                createdAt: now.addingTimeInterval(-300)
            ),
            NotificationLog(
                id: 3,
                title: "Webhook",
                message: "Drive started",
                status: .pending,
                createdAt: now.addingTimeInterval(-7200)
            ),
            NotificationLog(
                id: 4,
                title: "Slack",
                message: "Tire low",
                status: .sent,
                createdAt: now.addingTimeInterval(-90000)
            ),
            NotificationLog(
                id: 5,
                title: "SMS",
                message: "Update",
                status: .deferredDnd,
                createdAt: now.addingTimeInterval(-600)
            ),
            NotificationLog(
                id: 6,
                title: "Discord",
                message: "Parked",
                status: .sent,
                createdAt: now.addingTimeInterval(-3600)
            )
        ]
        return NotificationStatsData(stats: stats, logs: logs)
    }

    private func make(_ size: DashboardWidgetSize) -> NotificationStatsProjection {
        NotificationStatsProjection.make(from: data(), size: size, now: now, locale: locale, timeZone: timeZone)
    }

    // MARK: Decode

    func testDecodeStatsParsesSnakeCase() {
        let json = #"{"total_sent":1000,"sent":950,"failed":20,"pending":30,"total_channels":5,"enabled_channels":4}"#
        let stats = NotificationStats.decode(fromJSONString: json)
        XCTAssertEqual(stats?.totalSent, 1000)
        XCTAssertEqual(stats?.sent, 950)
        XCTAssertEqual(stats?.failed, 20)
        XCTAssertEqual(stats?.enabledChannels, 4)
        XCTAssertEqual(stats?.deliveryRate ?? 0, 95.0, accuracy: 0.0001)
    }

    func testDecodeStatsRejectsGarbageAndBridgesPayload() {
        XCTAssertNil(NotificationStats.decode(fromJSONString: "not json"))
        XCTAssertEqual(NotificationStats.decode(fromSharedPayload: 42), nil)
        let json = #"{"total_sent":10,"sent":9,"failed":1,"pending":0,"total_channels":1,"enabled_channels":1}"#
        XCTAssertEqual(NotificationStats.decode(fromSharedPayload: json)?.sent, 9)
    }

    func testDecodeLogsParsesArrayAndStatus() {
        let json = """
        [
          {"id":1,"title":"Pushover","message":"Charge complete","status":"sent","created_at":"2026-06-07T18:00:00Z"},
          {"id":2,"title":"Email","message":"Sentry","status":"deferred_dnd","created_at":"2026-06-07T17:00:00.250Z"}
        ]
        """
        let logs = NotificationLog.decodeList(fromJSONString: json)
        XCTAssertEqual(logs.count, 2)
        XCTAssertEqual(logs[0].id, 1)
        XCTAssertEqual(logs[0].status, .sent)
        XCTAssertNotNil(logs[0].createdAt)
        XCTAssertEqual(logs[1].status, .deferredDnd)
        XCTAssertNotNil(logs[1].createdAt)
        XCTAssertEqual(NotificationLog.decodeList(fromJSONString: "not json"), [])
    }

    func testStatusMappingRoundTrips() {
        XCTAssertEqual(NotificationLogStatus(rawTag: "deferred_dnd"), .deferredDnd)
        XCTAssertEqual(NotificationLogStatus(rawTag: "SENT"), .sent)
        XCTAssertEqual(NotificationLogStatus(rawTag: nil), .unknown)
        XCTAssertEqual(NotificationLogStatus(rawTag: "weird"), .unknown)
        XCTAssertEqual(NotificationLogStatus.deferredDnd.rawTag, "deferred_dnd")
    }

    func testTimestampParsing() {
        XCTAssertNotNil(NotificationLogTime.parse("2026-06-07T18:00:00Z"))
        XCTAssertNotNil(NotificationLogTime.parse("2026-06-07T18:00:00.123Z"))
        XCTAssertNil(NotificationLogTime.parse(nil))
        XCTAssertNil(NotificationLogTime.parse(""))
        XCTAssertNil(NotificationLogTime.parse("garbage"))
    }

    func testDeliveryRateGuardsZero() {
        XCTAssertEqual(NotificationStats(totalSent: 0, sent: 0).deliveryRate, 0)
        XCTAssertEqual(NotificationStats(totalSent: 200, sent: 100).deliveryRate, 50, accuracy: 0.0001)
    }

    // MARK: Number formatting (web fmtInt / fmtNumber)

    func testNumberFormatting() {
        XCTAssertEqual(NotificationStatsProjection.groupedInt(1000, locale: locale), "1,000")
        XCTAssertEqual(NotificationStatsProjection.groupedInt(42, locale: locale), "42")
        XCTAssertEqual(NotificationStatsProjection.fixed(nil, 1, locale: locale), "0.0")
        XCTAssertEqual(NotificationStatsProjection.fixed(.infinity, 1, locale: locale), "0.0")
        XCTAssertEqual(NotificationStatsProjection.fixed(.nan, 2, locale: locale), "0.00")
        XCTAssertEqual(NotificationStatsProjection.fixed(95, 1, locale: locale), "95.0")
    }

    // MARK: Relative time (web formatLogTime)

    func testRelativeTimeBranches() {
        func relative(_ offset: TimeInterval) -> String {
            NotificationStatsProjection.relativeTime(
                from: now.addingTimeInterval(offset), now: now, locale: locale, timeZone: timeZone
            )
        }
        XCTAssertEqual(relative(-30), "Just now")
        XCTAssertEqual(relative(60), "Just now") // future clamps to "Just now"
        XCTAssertEqual(relative(-300), "5m ago")
        XCTAssertEqual(relative(-7200), "2h ago")
        let absolute = relative(-90000)
        XCTAssertFalse(absolute.isEmpty)
        XCTAssertFalse(absolute.contains("ago"))
    }

    // MARK: Projection (cached → projection)

    func testProjectionMediumWidth() {
        let projection = make(DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertFalse(projection.isCompact)
        XCTAssertFalse(projection.isWide)
        XCTAssertEqual(projection.deliveryRatePercentText, "95.0%")
        XCTAssertEqual(projection.failedCount, 20)
        XCTAssertEqual(projection.failedCompactText, "20 failed")
        XCTAssertEqual(projection.stats.count, 4)

        XCTAssertEqual(projection.stats[0].label, "Total Sent (7d)")
        XCTAssertEqual(projection.stats[0].value, "1,000")
        XCTAssertEqual(projection.stats[0].trend, .up)
        XCTAssertEqual(projection.stats[0].trendLabel, "1,000")

        XCTAssertEqual(projection.stats[1].label, "Delivery Rate")
        XCTAssertEqual(projection.stats[1].value, "95.0")
        XCTAssertEqual(projection.stats[1].unit, "%")
        XCTAssertEqual(projection.stats[1].trend, .up)
        XCTAssertEqual(projection.stats[1].trendLabel, "Healthy")

        XCTAssertEqual(projection.stats[2].label, "Failed")
        XCTAssertEqual(projection.stats[2].value, "20")
        XCTAssertTrue(projection.stats[2].valueIsDanger)
        XCTAssertEqual(projection.stats[2].trend, .down)
        XCTAssertEqual(projection.stats[2].trendLabel, "Needs attention")

        XCTAssertEqual(projection.stats[3].label, "Active Channels")
        XCTAssertEqual(projection.stats[3].value, "4")
        XCTAssertNil(projection.stats[3].trend)
    }

    func testProjectionRecentLogsSortSliceAndTime() {
        let projection = make(DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(projection.recentLogs.count, 5)
        XCTAssertEqual(projection.recentLogs.map(\.id), [1, 2, 5, 6, 3])
        XCTAssertEqual(projection.recentLogs[0].timeText, "Just now")
        XCTAssertEqual(projection.recentLogs[1].timeText, "5m ago")
        XCTAssertEqual(projection.recentLogs[2].status, .deferredDnd)
        XCTAssertEqual(projection.recentLogs[2].statusLabel, "deferred_dnd")
        XCTAssertEqual(projection.recentLogs[0].channel, "Pushover")
        XCTAssertEqual(projection.recentLogs[0].type, "Charge complete")
    }

    func testProjectionCompactSlicesToThree() {
        let projection = make(DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertTrue(projection.isCompact)
        XCTAssertEqual(projection.recentLogs.count, 3)
        XCTAssertEqual(projection.recentLogs.map(\.id), [1, 2, 5])
    }

    func testProjectionWideFlags() {
        let projection = make(DashboardWidgetSize(cols: 4, rows: 4))
        XCTAssertTrue(projection.isWide)
        XCTAssertEqual(projection.recentLogs.count, 5)
    }

    func testZeroFailedHasNoCompactTextAndFlatTrend() {
        let zero = NotificationStatsData(stats: NotificationStats(totalSent: 0, sent: 0, failed: 0, enabledChannels: 0))
        let projection = NotificationStatsProjection.make(
            from: zero, size: DashboardWidgetSize(cols: 2, rows: 2), now: now, locale: locale, timeZone: timeZone
        )
        XCTAssertNil(projection.failedCompactText)
        XCTAssertEqual(projection.stats[0].trend, .flat)
        XCTAssertNil(projection.stats[0].trendLabel)
        XCTAssertEqual(projection.stats[1].trend, .flat)
        XCTAssertFalse(projection.stats[2].valueIsDanger)
        XCTAssertEqual(projection.deliveryRatePercentText, "0.0%")
    }

    // MARK: Accessibility

    func testAccessibilitySummary() {
        let summary = NotificationStatsAccessibility.summary(for: make(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertTrue(summary.contains("Total Sent (7d), 1,000"))
        XCTAssertTrue(summary.contains("Delivery Rate, 95.0%"))
        XCTAssertTrue(summary.contains("Failed, 20"))
        XCTAssertTrue(summary.contains("Active Channels, 4"))
    }
}

// MARK: - Presentation resolver (every state)

@MainActor
final class NotificationStatsPresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private let size = DashboardWidgetSize(cols: 2, rows: 2)

    private func sampleData() -> NotificationStatsData {
        NotificationStatsData(
            stats: NotificationStats(totalSent: 1000, sent: 950, failed: 20, enabledChannels: 4),
            logs: [NotificationLog(id: 1, title: "Email", message: "Hi", status: .sent, createdAt: now)]
        )
    }

    private func resolve(_ state: NotificationStatsLoadState<NotificationStatsData>) -> NotificationStatsPresentation {
        NotificationStatsPresentation.resolve(state: state, size: size, now: now, locale: locale, timeZone: timeZone)
    }

    private func expectedProjection() -> NotificationStatsProjection {
        NotificationStatsProjection.make(from: sampleData(), size: size, now: now, locale: locale, timeZone: timeZone)
    }

    func testIdleAndLoadingNoCacheAreLoading() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
    }

    func testLoadingWithCacheShowsContentRefreshing() {
        XCTAssertEqual(
            resolve(.loading(cached: sampleData(), stale: true)),
            .content(expectedProjection(), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedLiveAndStale() {
        XCTAssertEqual(
            resolve(.loaded(sampleData(), stale: false)),
            .content(expectedProjection(), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(.loaded(sampleData(), stale: true)),
            .content(expectedProjection(), freshness: .stale, refreshing: false)
        )
    }

    func testEmpty() {
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testOfflineWithoutCacheIsOfflineNoData() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
    }

    func testOfflineWithCacheShowsOfflineContent() {
        XCTAssertEqual(
            resolve(.failed(.offline, cached: sampleData(), stale: true)),
            .content(expectedProjection(), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryability() {
        XCTAssertEqual(resolve(.failed(.network(message: "x"), cached: nil, stale: false)), .error(retryable: true))
        XCTAssertEqual(resolve(.failed(.decode(message: "x"), cached: nil, stale: false)), .error(retryable: false))
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
    }

    func testErrorWithCacheKeepsContent() {
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: sampleData(), stale: false)),
            .content(expectedProjection(), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Registry, telemetry, model

@MainActor
final class NotificationStatsRegistryTests: XCTestCase {
    func testDescriptorMatchesCanonicalRegistry() {
        let descriptor = NotificationStatsWidget.descriptor
        XCTAssertEqual(descriptor.id, "notification-stats")
        XCTAssertEqual(descriptor.category, .alerts)
        XCTAssertEqual(descriptor.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(descriptor.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(descriptor.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampedSizeHonorsMinAndMax() {
        XCTAssertEqual(
            NotificationStatsWidget.clampedSize(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            NotificationStatsWidget.clampedSize(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            NotificationStatsWidget.clampedSize(DashboardWidgetSize(cols: 3, rows: 6)),
            DashboardWidgetSize(cols: 3, rows: 6)
        )
    }

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(NotificationStatsWidget.surfaceSlug, "NotificationStatsWidget")
        XCTAssertEqual(
            NotificationStatsWidget.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "NotificationStatsWidget")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(NotificationStatsWidget.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "NotificationStatsWidget")]
        )
    }

    @MainActor
    func testPreviewModelExposesInjectedState() {
        let data = NotificationStatsData(stats: NotificationStats(totalSent: 5, sent: 5))
        let model = NotificationStatsModel(previewState: .loaded(data, stale: false))
        XCTAssertEqual(model.state, .loaded(data, stale: false))
    }

    @MainActor
    func testSourceBackedModelStartsOnceAndRefreshesAndPushes() {
        let data = NotificationStatsData(stats: NotificationStats(totalSent: 5, sent: 4))
        let source = InMemoryNotificationStatsSource(initial: .loaded(data, stale: false))
        let model = NotificationStatsModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(data, stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
