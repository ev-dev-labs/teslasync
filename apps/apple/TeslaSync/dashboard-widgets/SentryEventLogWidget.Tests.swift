//
//  SentryEventLogWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  Unit coverage for the SentryEventLogWidget surface:
//    • Adapter (cached → projection) — `SentryEventCatalog.derive`/`visual`/`title`/
//      `subtitle` and `SentryFeedBuilder` parity with the web `deriveEvent` ladder +
//      the `feedItems` map (newest-first sort, id/timestamp fallbacks, cap).
//    • Layout — `SentryLayout.eventLimit`/`showsSubtitle` parity with the web
//      `eventLimit = isWide ? 10 : isTall ? 7 : 4` and `isWide` subtitle gate.
//    • State holder — `SentryModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `sentry-event-log` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the event rows.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySentrySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with deriveEvent / feedItems)

@MainActor final class SentryAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the value tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testDeriveOpenDoorsWinOverEverything() {
        let kind = SentryEventCatalog.derive(
            doorState: "Driver Front: open, Rear: closed",
            sentryMode: true,
            locked: false
        )
        XCTAssertEqual(kind, .doorOpen(doors: ["Driver Front: open"]))
        XCTAssertEqual(SentryEventCatalog.visual(for: kind).severity, .warning)
        XCTAssertEqual(SentryEventCatalog.visual(for: kind).systemImage, "door.left.hand.open")
    }

    func testDeriveSentryPrecedesLock() {
        XCTAssertEqual(SentryEventCatalog.derive(doorState: nil, sentryMode: true, locked: false), .sentryActivated)
        XCTAssertEqual(SentryEventCatalog.derive(doorState: nil, sentryMode: false, locked: true), .sentryDeactivated)
    }

    func testDeriveLockAndUnlock() {
        XCTAssertEqual(SentryEventCatalog.derive(doorState: nil, sentryMode: nil, locked: true), .locked)
        let unlocked = SentryEventCatalog.derive(doorState: nil, sentryMode: nil, locked: false)
        XCTAssertEqual(unlocked, .unlocked)
        XCTAssertEqual(SentryEventCatalog.visual(for: unlocked).severity, .critical)
        XCTAssertEqual(SentryEventCatalog.visual(for: .locked).severity, .info)
    }

    func testDeriveFallsBackToUpdated() {
        let kind = SentryEventCatalog.derive(doorState: nil, sentryMode: nil, locked: nil)
        XCTAssertEqual(kind, .updated)
        XCTAssertEqual(SentryEventCatalog.visual(for: kind).systemImage, "door.left.hand.closed")
        XCTAssertEqual(SentryEventCatalog.visual(for: kind).severity, .info)
    }

    func testOpenDoorsParsingTrimsFiltersAndHandlesEmpty() {
        XCTAssertEqual(
            SentryEventCatalog.openDoors(from: " Front: OPEN , Trunk: closed , Rear: open "),
            ["Front: OPEN", "Rear: open"]
        )
        XCTAssertTrue(SentryEventCatalog.openDoors(from: "all closed").isEmpty)
        XCTAssertTrue(SentryEventCatalog.openDoors(from: "").isEmpty)
        XCTAssertTrue(SentryEventCatalog.openDoors(from: nil).isEmpty)
    }

    func testTitleEchoesDoorListAndUsesExpectedKeys() {
        let doorKind = SentryEventCatalog.derive(doorState: "Front: open", sentryMode: nil, locked: nil)
        XCTAssertEqual(SentryEventCatalog.title(for: doorKind, localize: echo), "Door open: Front: open")
        XCTAssertEqual(SentryEventCatalog.title(for: .sentryActivated, localize: keyTap), "L:widget.sentryActivated")
        XCTAssertEqual(SentryEventCatalog.title(for: .unlocked, localize: keyTap), "L:widget.sentryUnlockedTitle")
    }

    func testSubtitleComposition() {
        XCTAssertEqual(
            SentryEventCatalog.subtitle(locked: true, sentryMode: true, localize: echo),
            "🔒 Locked · 🛡️ Sentry On"
        )
        XCTAssertEqual(SentryEventCatalog.subtitle(locked: false, sentryMode: nil, localize: echo), "🔓 Unlocked")
        XCTAssertEqual(SentryEventCatalog.subtitle(locked: nil, sentryMode: false, localize: echo), "Sentry Off")
        XCTAssertEqual(SentryEventCatalog.subtitle(locked: nil, sentryMode: nil, localize: echo), "—")
    }

    func testSubtitleUsesExpectedKeys() {
        XCTAssertEqual(
            SentryEventCatalog.subtitle(locked: true, sentryMode: false, localize: keyTap),
            "L:widget.sentryLocked · L:widget.sentryOff"
        )
    }

    func testFeedBuilderSortsNewestFirstByDisplayTimestamp() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let events = [
            SentryEventInput(id: 1, vehicleID: 7, timestamp: base, createdAt: base),
            // createdAt (used for sort) is newest even though ts is oldest.
            SentryEventInput(
                id: 2,
                vehicleID: 7,
                timestamp: base.addingTimeInterval(-9000),
                createdAt: base.addingTimeInterval(600)
            ),
            SentryEventInput(id: 3, vehicleID: 7, timestamp: base.addingTimeInterval(-300), createdAt: nil)
        ]
        let items = SentryFeedBuilder.build(events: events, localize: echo)
        XCTAssertEqual(items.map(\.id), ["2", "1", "3"])
    }

    func testFeedBuilderHonorsLimit() {
        let base = Date()
        let events = (0 ..< 6).map {
            SentryEventInput(
                id: Int64($0),
                vehicleID: 7,
                timestamp: base.addingTimeInterval(Double($0)),
                createdAt: base.addingTimeInterval(Double($0))
            )
        }
        let items = SentryFeedBuilder.build(events: events, limit: 4, localize: echo)
        XCTAssertEqual(items.count, 4)
        XCTAssertEqual(items.map(\.id), ["5", "4", "3", "2"])
    }

    func testFeedItemIdFallsBackToVehicleAndTimestampWhenIdNil() {
        let ts = Date(timeIntervalSince1970: 1_700_000_000)
        let withID = SentryEventInput(id: 42, vehicleID: 7, timestamp: ts)
        let withoutID = SentryEventInput(id: nil, vehicleID: 7, timestamp: ts)
        XCTAssertEqual(SentryFeedBuilder.build(events: [withID], localize: echo).first?.id, "42")
        XCTAssertEqual(
            SentryFeedBuilder.build(events: [withoutID], localize: echo).first?.id,
            "7-1700000000"
        )
    }

    func testFeedItemTimestampPrefersCreatedAt() {
        let ts = Date(timeIntervalSince1970: 1000)
        let created = Date(timeIntervalSince1970: 2000)
        let withCreated = SentryEventInput(id: 1, vehicleID: 7, timestamp: ts, createdAt: created)
        let withoutCreated = SentryEventInput(id: 2, vehicleID: 7, timestamp: ts, createdAt: nil)
        XCTAssertEqual(SentryFeedBuilder.build(events: [withCreated], localize: echo).first?.timestamp, created)
        XCTAssertEqual(SentryFeedBuilder.build(events: [withoutCreated], localize: echo).first?.timestamp, ts)
    }

    func testRelativeTimeIsNonEmptyAndOrderSensitive() {
        let now = Date()
        let recent = SentryRelativeTime.string(for: now.addingTimeInterval(-60), relativeTo: now)
        let older = SentryRelativeTime.string(for: now.addingTimeInterval(-7200), relativeTo: now)
        XCTAssertFalse(recent.isEmpty)
        XCTAssertFalse(older.isEmpty)
        XCTAssertNotEqual(recent, older)
    }
}

// MARK: - Layout: size → eventLimit / subtitle gate (web parity)

@MainActor final class SentryLayoutTests: XCTestCase {
    func testEventLimitWideTallAndSmall() {
        // Wide (cols >= 3) → 10, regardless of rows.
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 3, rows: 1)), 10)
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 4, rows: 40)), 10)
        // Narrow but tall (rows >= 2) → 7.
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 2, rows: 4)), 7)
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 2, rows: 2)), 7)
        // Narrow + short → 4.
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 2, rows: 1)), 4)
        XCTAssertEqual(SentryLayout.eventLimit(for: DashboardWidgetSize(cols: 1, rows: 1)), 4)
    }

    func testShowsSubtitleOnlyWhenWide() {
        XCTAssertTrue(SentryLayout.showsSubtitle(for: DashboardWidgetSize(cols: 3, rows: 4)))
        XCTAssertTrue(SentryLayout.showsSubtitle(for: DashboardWidgetSize(cols: 4, rows: 1)))
        XCTAssertFalse(SentryLayout.showsSubtitle(for: DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SentryModelTests: XCTestCase {
    private func makeModel(
        _ update: SentryUpdate,
        telemetry: SentryTelemetry = OSLogSentryTelemetry()
    ) -> (SentryModel, InMemorySentrySource) {
        let source = InMemorySentrySource(initial: update)
        let model = SentryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleEvent() -> SentryEventInput {
        SentryEventInput(id: 1, vehicleID: 7, timestamp: Date(), createdAt: Date(), sentryMode: true, locked: true)
    }

    func testLoadingWithoutEventsShowsLoading() {
        let (model, _) = makeModel(SentryUpdate(status: .loading, events: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutEventsShowsEmpty() {
        let (model, _) = makeModel(SentryUpdate(status: .loaded, events: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutEventsShowsError() {
        let (model, _) = makeModel(SentryUpdate(status: .failed("boom"), events: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEventsPresentShowContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(SentryUpdate(status: .loading, events: [sampleEvent()]))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SentryUpdate(status: .failed("net"), events: [sampleEvent()]))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySentryTelemetry()
        let (model, source) = makeModel(SentryUpdate(status: .loading, events: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SentryEventLogWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SentryUpdate(status: .loaded, events: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SentryUpdate(status: .loading, events: []))
        model.start()
        source.push(
            SentryUpdate(
                status: .loaded,
                connection: .offline,
                events: [
                    SentryEventInput(id: 9, vehicleID: 7, timestamp: Date(), createdAt: Date(), locked: false)
                ],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.feedItems.count, 1)
        XCTAssertEqual(model.feedItems.first?.kind, .unlocked)
    }
}

// MARK: - Registry parity

@MainActor final class SentryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SentryEventLogWidget.registration
        XCTAssertEqual(registration.id, "sentry-event-log")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SentryEventLogWidget.registration
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

@MainActor final class SentryAccessibilityTests: XCTestCase {
    private func item(title: String, subtitle: String) -> SentryFeedItem {
        SentryFeedItem(
            id: "1",
            kind: .locked,
            title: title,
            subtitle: subtitle,
            timestamp: Date(),
            severity: .info
        )
    }

    func testEventSummaryIncludesSubtitleWhenShown() {
        let summary = SentryAccessibility.eventSummary(
            for: item(title: "Vehicle locked", subtitle: "🔒 Locked · 🛡️ Sentry On"),
            showsSubtitle: true
        )
        XCTAssertEqual(summary, "Vehicle locked. 🔒 Locked · 🛡️ Sentry On")
    }

    func testEventSummaryOmitsSubtitleWhenHidden() {
        let summary = SentryAccessibility.eventSummary(
            for: item(title: "Vehicle locked", subtitle: "🔒 Locked"),
            showsSubtitle: false
        )
        XCTAssertEqual(summary, "Vehicle locked")
    }

    func testEventSummaryOmitsDashSentinelSubtitle() {
        let summary = SentryAccessibility.eventSummary(
            for: item(title: "Security state updated", subtitle: "—"),
            showsSubtitle: true
        )
        XCTAssertEqual(summary, "Security state updated")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySentryTelemetry: SentryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
