//
//  GuardModeWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  Unit coverage for the GuardModeWidget surface:
//    • Adapter (cached → projection) — `GuardStatus`, `GuardFeedBuilder`,
//      `GuardEventCatalog` parity with the web `mapEventToFeedItem` / `EVENT_TYPE_MAP`.
//    • State holder — `GuardModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `guard-mode` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the status + event rows.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryGuardSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with mapEventToFeedItem)

final class GuardAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the builder tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testCatalogMapsKnownEventTypes() {
        let moved = GuardEventCatalog.visual(for: "vehicle_moved")
        XCTAssertEqual(moved.fallbackLabel, "Vehicle Moved")
        XCTAssertEqual(moved.severity, .warning)

        let unlock = GuardEventCatalog.visual(for: "unauthorized_unlock")
        XCTAssertEqual(unlock.severity, .critical)
        XCTAssertEqual(unlock.fallbackLabel, "Unauthorized Unlock")

        let panic = GuardEventCatalog.visual(for: "manual_panic")
        XCTAssertEqual(panic.fallbackLabel, "Panic Alert")
        XCTAssertEqual(panic.severity, .critical)
    }

    func testCatalogFallsBackForUnknownAndEmptyTypes() {
        let unknown = GuardEventCatalog.visual(for: "meteor_strike")
        XCTAssertEqual(unknown.fallbackLabel, "meteor_strike")
        XCTAssertEqual(unknown.severity, .info)
        XCTAssertEqual(unknown.systemImage, "exclamationmark.shield.fill")

        let empty = GuardEventCatalog.visual(for: "")
        XCTAssertEqual(empty.fallbackLabel, "—")
    }

    func testCatalogKnownTypesAllResolveDistinctly() {
        for type in GuardEventCatalog.knownTypes {
            let visual = GuardEventCatalog.visual(for: type)
            XCTAssertFalse(visual.systemImage.isEmpty)
            XCTAssertNotEqual(visual.fallbackLabel, "—")
        }
    }

    func testStatusProjectionDefaultsWhenConfigNil() {
        let status = GuardStatus.project(config: nil, eventCount: 0)
        XCTAssertEqual(status, .empty)
        XCTAssertFalse(status.enabled)
        XCTAssertEqual(status.sensitivity, "—")
        XCTAssertFalse(status.autoPanic)
    }

    func testStatusProjectionCarriesConfigAndCount() {
        let config = GuardConfigInput(enabled: true, sensitivity: "high", autoPanic: true)
        let status = GuardStatus.project(config: config, eventCount: 3)
        XCTAssertTrue(status.enabled)
        XCTAssertEqual(status.sensitivity, "high")
        XCTAssertTrue(status.autoPanic)
        XCTAssertEqual(status.eventCount, 3)
    }

    func testStatusProjectionBlankSensitivityFallsBackToDash() {
        let status = GuardStatus.project(config: GuardConfigInput(enabled: true, sensitivity: "   "), eventCount: 1)
        XCTAssertEqual(status.sensitivity, "—")
    }

    func testFeedBuilderSortsNewestFirst() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let events = [
            GuardEventInput(id: 1, eventType: "locked", timestamp: base),
            GuardEventInput(id: 2, eventType: "sentry_mode", timestamp: base.addingTimeInterval(300)),
            GuardEventInput(id: 3, eventType: "test_alert", timestamp: base.addingTimeInterval(-300))
        ]
        let items = GuardFeedBuilder.build(events: events, localize: echo)
        XCTAssertEqual(items.map(\.id), [2, 1, 3])
    }

    func testFeedBuilderHonorsLimit() {
        let base = Date()
        let events = (0 ..< 5).map {
            GuardEventInput(id: Int64($0), eventType: "locked", timestamp: base.addingTimeInterval(Double($0)))
        }
        let items = GuardFeedBuilder.build(events: events, limit: 2, localize: echo)
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items.map(\.id), [4, 3])
    }

    func testFeedBuilderResolvesTitleAndSubtitleKeys() {
        let acked = GuardEventInput(
            id: 1, eventType: "vehicle_moved", timestamp: Date(), acknowledgedAt: Date()
        )
        let open = GuardEventInput(id: 2, eventType: "sentry_triggered", timestamp: Date().addingTimeInterval(-10))
        let items = GuardFeedBuilder.build(events: [acked, open], localize: keyTap)

        let first = items[0]
        XCTAssertEqual(first.title, "L:widget.guardEvent.vehicle_moved")
        XCTAssertTrue(first.acknowledged)
        XCTAssertEqual(first.subtitle, "L:widget.guardAcknowledged")
        XCTAssertEqual(first.severity, .warning)

        let second = items[1]
        XCTAssertFalse(second.acknowledged)
        XCTAssertEqual(second.subtitle, "L:widget.guardUnacknowledged")
    }

    func testRelativeTimeIsNonEmptyAndOrderSensitive() {
        let now = Date()
        let recent = GuardRelativeTime.string(for: now.addingTimeInterval(-60), relativeTo: now)
        let older = GuardRelativeTime.string(for: now.addingTimeInterval(-7200), relativeTo: now)
        XCTAssertFalse(recent.isEmpty)
        XCTAssertFalse(older.isEmpty)
        XCTAssertNotEqual(recent, older)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class GuardModelTests: XCTestCase {
    private func makeModel(
        _ update: GuardUpdate,
        telemetry: GuardTelemetry = OSLogGuardTelemetry()
    ) -> (GuardModel, InMemoryGuardSource) {
        let source = InMemoryGuardSource(initial: update)
        let model = GuardModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutConfigShowsLoading() {
        let (model, _) = makeModel(GuardUpdate(status: .loading, config: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutConfigShowsEmpty() {
        let (model, _) = makeModel(GuardUpdate(status: .loaded, config: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutConfigShowsError() {
        let (model, _) = makeModel(GuardUpdate(status: .failed("boom"), config: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testConfigPresentShowsContentEvenWhileLoadingOrFailed() {
        let config = GuardConfigInput(enabled: true, sensitivity: "low")
        let (loading, _) = makeModel(GuardUpdate(status: .loading, config: config))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(GuardUpdate(status: .failed("net"), config: config))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyGuardTelemetry()
        let (model, source) = makeModel(GuardUpdate(status: .loading, config: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [GuardModeWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(GuardUpdate(status: .loaded, config: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(GuardUpdate(status: .loading, config: nil))
        model.start()
        source.push(
            GuardUpdate(
                status: .loaded,
                connection: .offline,
                config: GuardConfigInput(enabled: true, sensitivity: "medium", autoPanic: true),
                events: [GuardEventInput(id: 9, eventType: "sentry_triggered", timestamp: Date())],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.status.enabled)
        XCTAssertEqual(model.status.eventCount, 1)
        XCTAssertEqual(model.feedItems.count, 1)
    }
}

// MARK: - Registry parity

final class GuardRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = GuardModeWidget.registration
        XCTAssertEqual(registration.id, "guard-mode")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = GuardModeWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
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

final class GuardAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testStatusSummaryIncludesArmedSensitivityAutoPanicAndCount() {
        let status = GuardStatus(enabled: true, sensitivity: "high", autoPanic: true, eventCount: 3)
        let summary = GuardAccessibility.statusSummary(for: status, localize: echo)
        XCTAssertTrue(summary.contains("Armed"))
        XCTAssertTrue(summary.contains("Sensitivity: high"))
        XCTAssertTrue(summary.contains("Auto-panic"))
        XCTAssertTrue(summary.contains("3 events"))
    }

    func testStatusSummaryDisarmedOmitsAutoPanic() {
        let status = GuardStatus(enabled: false, sensitivity: "—", autoPanic: false, eventCount: 0)
        let summary = GuardAccessibility.statusSummary(for: status, localize: echo)
        XCTAssertTrue(summary.contains("Disarmed"))
        XCTAssertFalse(summary.contains("Auto-panic"))
    }

    func testEventSummaryCombinesTitleAndSubtitle() {
        let item = GuardFeedItem(
            id: 1, eventType: "sentry_triggered", title: "Sentry Triggered",
            subtitle: "Unacknowledged", acknowledged: false, timestamp: Date(), severity: .warning
        )
        XCTAssertEqual(GuardAccessibility.eventSummary(for: item), "Sentry Triggered. Unacknowledged")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyGuardTelemetry: GuardTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
