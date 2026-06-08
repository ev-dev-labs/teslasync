//
//  VampireDrainWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  Unit coverage for the VampireDrainWidget surface:
//    • Adapter (cached → projection) — `VampireDrainBuilder` parity with the web
//      `eventItems` / `sparklineData` memos + `WidgetEventFeed` (tone, duration,
//      per-day scaling, sort+cap, relative-time).
//    • State holder — `VampireDrainModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `vampire-drain` metadata + size clamping.
//    • Accessibility / i18n composition — stat + row labels, title, duration,
//      per-day, event-count, relative-time copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryVampireDrainSource`. The pure
//  adapter subset is also proven by the executed host harness in the gate log.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web memos)

@MainActor final class VampireDrainAdapterTests: XCTestCase {
    func testDrainToneThresholds() {
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 0.0), .good)
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 0.99), .good)
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 1.0), .warning)
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 2.99), .warning)
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 3.0), .critical)
        XCTAssertEqual(VampireDrainBuilder.drainTone(perDay: 12.0), .critical)
    }

    func testDurationBucketSplitsAtOneHour() {
        XCTAssertEqual(VampireDrainBuilder.durationBucket(hours: 0.5), .minutes(30))
        XCTAssertEqual(VampireDrainBuilder.durationBucket(hours: 0.0), .minutes(0))
        XCTAssertEqual(VampireDrainBuilder.durationBucket(hours: 1.0), .hours(1.0))
        XCTAssertEqual(VampireDrainBuilder.durationBucket(hours: 2.5), .hours(2.5))
    }

    func testAvgDrainPerDayScalesByTwentyFour() {
        XCTAssertEqual(
            VampireDrainBuilder.avgDrainPerDay(VampireDrainStatsInput(avgDrainRatePerHour: 0.1)),
            2.4,
            accuracy: 1e-9
        )
        XCTAssertEqual(VampireDrainBuilder.avgDrainPerDay(nil), 0, accuracy: 1e-9)
        XCTAssertEqual(VampireDrainBuilder.avgDrainPerDay(VampireDrainStatsInput()), 0, accuracy: 1e-9)
    }

    func testMakeEventAppliesWebFallbacksAndScaling() {
        let item = VampireDrainBuilder.makeEvent(from: VampireDrainEventInput(id: 7))
        XCTAssertEqual(item.id, 7)
        XCTAssertEqual(item.batteryLostPct, 0)
        XCTAssertEqual(item.drainPerDay, 0)
        XCTAssertEqual(item.duration, .minutes(0))
        XCTAssertFalse(item.sentryMode)
        XCTAssertEqual(item.timestamp, Date(timeIntervalSince1970: 0))
        XCTAssertEqual(item.tone, .good)
    }

    func testMakeEventScalesRateAndPicksTone() {
        let input = VampireDrainEventInput(
            id: 1,
            batteryLost: 3.2,
            durationHours: 2.5,
            drainRatePerHour: 0.25,
            sentryMode: true,
            startDate: Date(timeIntervalSince1970: 1000)
        )
        let item = VampireDrainBuilder.makeEvent(from: input)
        XCTAssertEqual(item.batteryLostPct, 3.2, accuracy: 1e-9)
        XCTAssertEqual(item.drainPerDay, 6.0, accuracy: 1e-9)
        XCTAssertEqual(item.duration, .hours(2.5))
        XCTAssertTrue(item.sentryMode)
        XCTAssertEqual(item.tone, .critical)
    }

    func testFeedEventsSortNewestFirstAndCapAtFive() {
        let now = Date()
        let inputs = (0 ..< 7).map { idx in
            VampireDrainEventInput(id: idx, drainRatePerHour: 0.05, startDate: now.addingTimeInterval(Double(idx) * 60))
        }
        let feed = VampireDrainBuilder.feedEvents(from: VampireDrainBuilder.makeEvents(from: inputs))
        XCTAssertEqual(feed.count, VampireDrainBuilder.feedLimit)
        XCTAssertEqual(feed.first?.id, 6)
        XCTAssertEqual(feed.last?.id, 2)
    }

    func testSparklineDataReversesInputAndScales() {
        let inputs = [
            VampireDrainEventInput(id: 1, drainRatePerHour: 0.1),
            VampireDrainEventInput(id: 2, drainRatePerHour: 0.2),
            VampireDrainEventInput(id: 3, drainRatePerHour: 0.3)
        ]
        let series = VampireDrainBuilder.sparklineData(from: inputs)
        XCTAssertEqual(series.count, 3)
        XCTAssertEqual(series[0], 7.2, accuracy: 1e-9)
        XCTAssertEqual(series[1], 4.8, accuracy: 1e-9)
        XCTAssertEqual(series[2], 2.4, accuracy: 1e-9)
        XCTAssertTrue(VampireDrainBuilder.sparklineData(from: []).isEmpty)
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(VampireDrainBuilder.relativeTime(for: now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(VampireDrainBuilder.relativeTime(for: now.addingTimeInterval(-300), now: now), .minutes(5))
        XCTAssertEqual(VampireDrainBuilder.relativeTime(for: now.addingTimeInterval(-7200), now: now), .hours(2))
        guard case .absolute = VampireDrainBuilder.relativeTime(for: now.addingTimeInterval(-90000), now: now) else {
            return XCTFail("expected absolute bucket for ages over 24h")
        }
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class VampireDrainModelTests: XCTestCase {
    private func makeModel(
        _ update: VampireDrainUpdate,
        telemetry: VampireDrainTelemetry = OSLogVampireDrainTelemetry()
    ) -> (VampireDrainModel, InMemoryVampireDrainSource) {
        let source = InMemoryVampireDrainSource(initial: update)
        let model = VampireDrainModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(VampireDrainUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(VampireDrainUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(VampireDrainUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let stats = VampireDrainStatsInput(avgDrainRatePerHour: 0.1, eventCount: 3, totalHours: 40)
        let (loading, _) = makeModel(VampireDrainUpdate(status: .loading, stats: stats))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let events = [VampireDrainEventInput(id: 1, drainRatePerHour: 0.1, startDate: Date())]
        let (failed, _) = makeModel(VampireDrainUpdate(status: .failed("net"), events: events))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyVampireDrainTelemetry()
        let (model, source) = makeModel(VampireDrainUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VampireDrainWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(VampireDrainUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionsTrackUpdates() {
        let (model, source) = makeModel(VampireDrainUpdate(status: .loading))
        model.start()
        let stats = VampireDrainStatsInput(avgDrainRatePerHour: 0.09, eventCount: 12, totalHours: 142)
        let events = [
            VampireDrainEventInput(id: 1, drainRatePerHour: 0.1, startDate: Date()),
            VampireDrainEventInput(id: 2, drainRatePerHour: 0.2, startDate: Date().addingTimeInterval(-3600))
        ]
        source.push(VampireDrainUpdate(
            status: .loaded,
            connection: .offline,
            stats: stats,
            events: events,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.avgDrainPerDay, 2.16, accuracy: 1e-9)
        XCTAssertEqual(model.feedItems.count, 2)
        XCTAssertEqual(model.sparkline.count, 2)
        XCTAssertTrue(model.hasData)
    }
}

// MARK: - Registry parity

@MainActor final class VampireDrainRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VampireDrainWidget.registration
        XCTAssertEqual(registration.id, "vampire-drain")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VampireDrainWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 3, rows: 5)), DashboardWidgetSize(cols: 3, rows: 5))
    }
}

// MARK: - Accessibility + i18n composition

@MainActor final class VampireDrainAccessibilityTests: XCTestCase {
    private func item(sentry: Bool) -> VampireDrainEventItem {
        VampireDrainBuilder.makeEvent(from: VampireDrainEventInput(
            id: 1,
            batteryLost: 3.2,
            durationHours: 2.5,
            drainRatePerHour: 0.23,
            sentryMode: sentry,
            startDate: Date()
        ))
    }

    func testEventTitleIncludesBatteryDurationAndSentry() {
        let title = VampireDrainStrings.eventTitle(item(sentry: true))
        XCTAssertTrue(title.contains("%"))
        XCTAssertTrue(title.contains(" · "))
        XCTAssertTrue(title.hasSuffix("Sentry"))
    }

    func testEventTitleOmitsSentryWhenInactive() {
        XCTAssertFalse(VampireDrainStrings.eventTitle(item(sentry: false)).contains("Sentry"))
    }

    func testDurationLabelUnits() {
        XCTAssertTrue(VampireDrainStrings.durationLabel(.minutes(30)).hasSuffix("m"))
        XCTAssertTrue(VampireDrainStrings.durationLabel(.hours(2.5)).hasSuffix("h"))
    }

    func testPercentPerDayComposition() {
        let composed = VampireDrainStrings.percentPerDay(2.16)
        XCTAssertTrue(composed.contains("%"))
        XCTAssertTrue(composed.hasSuffix("/day"))
        XCTAssertTrue(composed.contains(VampireDrainNumberFormat.decimal(2.16, fractionDigits: 1)))
    }

    func testEventCountSublabelEmbedsCountAndHours() {
        let sublabel = VampireDrainStrings.eventCountSublabel(count: 12, totalHours: 142)
        XCTAssertTrue(sublabel.contains("12"))
        XCTAssertTrue(sublabel.contains("142"))
        XCTAssertTrue(sublabel.contains("events"))
        XCTAssertTrue(sublabel.contains("total"))
    }

    func testRelativeLabelLocalizesBuckets() {
        XCTAssertEqual(VampireDrainStrings.relativeTimeLabel(.justNow), "Just now")
        XCTAssertEqual(VampireDrainStrings.relativeTimeLabel(.minutes(5)), "5m ago")
        XCTAssertEqual(VampireDrainStrings.relativeTimeLabel(.hours(2)), "2h ago")
    }

    func testStatLabelIncludesLabelValueAndCount() {
        let stats = VampireDrainStatsInput(avgDrainRatePerHour: 0.09, eventCount: 12, totalHours: 142)
        let label = VampireDrainAccessibility.statLabel(avgPerDay: 2.16, stats: stats)
        XCTAssertTrue(label.contains("Avg Drain"))
        XCTAssertTrue(label.contains("/day"))
        XCTAssertTrue(label.contains("events"))
    }

    func testStatLabelOmitsCountWhenStatsMissing() {
        let label = VampireDrainAccessibility.statLabel(avgPerDay: 0, stats: nil)
        XCTAssertTrue(label.contains("Avg Drain"))
        XCTAssertFalse(label.contains("events"))
    }

    func testRowLabelComposesTitleRateAndTime() {
        let label = VampireDrainAccessibility.rowLabel(for: item(sentry: true), now: Date())
        XCTAssertTrue(label.contains("Sentry"))
        XCTAssertTrue(label.contains("/day"))
        XCTAssertTrue(label.contains("Just now"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVampireDrainTelemetry: VampireDrainTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
