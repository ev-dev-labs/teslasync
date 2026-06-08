//
//  EventTimeline.Tests.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  Unit coverage for the EventTimeline surface: the Adapter (`deriveTimeline` parity,
//  `isSentryActive` / `doorClosed`, the `timelineIcon` SF-Symbol mapping), the Labels
//  (`useTimelineLabels` parity), the Timestamp formatter, the state holder
//  (`EventTimelineProjection` + `EventTimelineModel` wiring incl. stale auto-refresh +
//  P1/S11 `view.opened`), and the VoiceOver row summary. These run in the
//  TeslaSync(/-macOS) XCTest targets — no network, no real store: the model is driven by
//  `InMemoryEventTimelineSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: deriveTimeline (port of helpers.deriveTimeline)

final class EventTimelineDeriveTests: XCTestCase {
    private func event(
        _ id: String,
        _ offset: TimeInterval,
        locked: Bool?,
        sentry: EventTimelineSignal = .absent,
        door: EventTimelineSignal = .absent
    ) -> EventTimelineSecurityEvent {
        EventTimelineSecurityEvent(
            id: id,
            createdAt: Date(timeIntervalSince1970: 1_736_000_000 + offset),
            locked: locked,
            sentryMode: sentry,
            doorState: door
        )
    }

    func testEmptyHistoryYieldsNoRows() {
        XCTAssertTrue(EventTimelineAdapter.deriveTimeline(from: []).isEmpty)
    }

    func testSingleRecordYieldsNoRows() {
        let history = [event("1", 0, locked: true)]
        XCTAssertTrue(EventTimelineAdapter.deriveTimeline(from: history).isEmpty)
    }

    func testNoChangeBetweenRecordsYieldsNoRows() {
        let history = [
            event("2", 10, locked: true, sentry: .string("on"), door: .string("Closed")),
            event("1", 0, locked: true, sentry: .string("on"), door: .string("Closed"))
        ]
        XCTAssertTrue(EventTimelineAdapter.deriveTimeline(from: history).isEmpty)
    }

    func testEveryFieldChangeEmitsARow() {
        // The three rows share the newest record's timestamp; assert by kind (the
        // equal-timestamp final sort order is not contractually fixed).
        let history = [
            event("2", 10, locked: true, sentry: .string("On"), door: .string("Closed")),
            event("1", 0, locked: false, sentry: .string("Off"), door: .string("Open"))
        ]
        let rows = EventTimelineAdapter.deriveTimeline(from: history)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(Set(rows.map(\.kind)), [.lock, .sentry, .door])
        XCTAssertTrue(rows.allSatisfy { $0.variant == .positive })
        XCTAssertEqual(rows.first { $0.kind == .lock }?.id, "lock-2")
        XCTAssertEqual(rows.first { $0.kind == .lock }?.detail, "Closed")
        XCTAssertEqual(rows.first { $0.kind == .sentry }?.detail, "")
        XCTAssertEqual(rows.first { $0.kind == .door }?.detail, "Closed")
    }

    func testNegativeVariantsAndLockDetailFallback() {
        // Newest record unlocks, disarms sentry, opens door; doorState absent → lock detail
        // falls back to the em-dash; the door row falls back to the "Open" label.
        let history = [
            event("2", 10, locked: false, sentry: .string("Off"), door: .bool(true)),
            event("1", 0, locked: true, sentry: .string("On"), door: .absent)
        ]
        let rows = EventTimelineAdapter.deriveTimeline(from: history)
        XCTAssertEqual(rows.count, 3)
        XCTAssertTrue(rows.allSatisfy { $0.variant == .negative })
        XCTAssertEqual(rows.first { $0.kind == .lock }?.detail, "—")
        XCTAssertEqual(rows.first { $0.kind == .door }?.detail, "Open")
    }

    func testRowsAreSortedNewestFirst() {
        let history = [
            event("1", 0, locked: true),
            event("3", 200, locked: false),
            event("2", 100, locked: true)
        ]
        // Sorted desc: 3(false) > 2(true) > 1(true). Diffs: 3 vs 2 (lock), 2 vs 1 (none).
        let rows = EventTimelineAdapter.deriveTimeline(from: history)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].id, "lock-3")
        let timestamps = rows.compactMap(\.timestamp)
        XCTAssertEqual(timestamps, timestamps.sorted(by: >))
    }

    func testRowCountIsCappedAtFifty() {
        // 60 records toggling `locked` every step → 59 candidate diffs, capped at 50.
        let history = (0 ..< 60).map { index in
            event("\(index)", TimeInterval(index), locked: index.isMultiple(of: 2))
        }
        let rows = EventTimelineAdapter.deriveTimeline(from: history)
        XCTAssertEqual(rows.count, EventTimelineAdapter.maxEvents)
    }
}

// MARK: - Adapter: predicates + icon mapping

final class EventTimelineAdapterPredicateTests: XCTestCase {
    func testIsSentryActive() {
        XCTAssertTrue(EventTimelineAdapter.isSentryActive(.bool(true)))
        XCTAssertFalse(EventTimelineAdapter.isSentryActive(.bool(false)))
        XCTAssertTrue(EventTimelineAdapter.isSentryActive(.string("On")))
        XCTAssertTrue(EventTimelineAdapter.isSentryActive(.string("Armed")))
        XCTAssertFalse(EventTimelineAdapter.isSentryActive(.string("Off")))
        XCTAssertFalse(EventTimelineAdapter.isSentryActive(.string("SENTRY_OFF")))
        XCTAssertFalse(EventTimelineAdapter.isSentryActive(.string("")))
        XCTAssertFalse(EventTimelineAdapter.isSentryActive(.absent))
    }

    func testDoorClosed() {
        XCTAssertTrue(EventTimelineAdapter.doorClosed(.absent))
        XCTAssertTrue(EventTimelineAdapter.doorClosed(.bool(false)))
        XCTAssertFalse(EventTimelineAdapter.doorClosed(.bool(true)))
        XCTAssertTrue(EventTimelineAdapter.doorClosed(.string("Closed")))
        XCTAssertTrue(EventTimelineAdapter.doorClosed(.string("0")))
        XCTAssertTrue(EventTimelineAdapter.doorClosed(.string("false")))
        XCTAssertFalse(EventTimelineAdapter.doorClosed(.string("Open")))
        XCTAssertFalse(EventTimelineAdapter.doorClosed(.string("DRIVER_OPEN")))
    }

    func testIconSystemNamePerKindAndVariant() {
        XCTAssertEqual(EventTimelineAdapter.iconSystemName(kind: .lock, variant: .positive), "lock.fill")
        XCTAssertEqual(EventTimelineAdapter.iconSystemName(kind: .lock, variant: .negative), "lock.open.fill")
        XCTAssertEqual(
            EventTimelineAdapter.iconSystemName(kind: .sentry, variant: .positive),
            "checkmark.shield.fill"
        )
        XCTAssertEqual(
            EventTimelineAdapter.iconSystemName(kind: .sentry, variant: .negative),
            "exclamationmark.shield.fill"
        )
        XCTAssertEqual(
            EventTimelineAdapter.iconSystemName(kind: .door, variant: .positive),
            "door.left.hand.closed"
        )
        XCTAssertEqual(EventTimelineAdapter.iconSystemName(kind: .door, variant: .negative), "door.left.hand.open")
        // Neutral resolves like negative (web `variant === 'positive' ? … : …`).
        XCTAssertEqual(EventTimelineAdapter.iconSystemName(kind: .lock, variant: .neutral), "lock.open.fill")
    }
}

// MARK: - Labels (port of useTimelineLabels)

final class EventTimelineLabelsTests: XCTestCase {
    private let englishFallback: (String, String) -> String = { _, fallback in fallback }

    private func entry(
        _ kind: EventTimelineKind,
        _ variant: EventTimelineVariant,
        detail: String = ""
    ) -> EventTimelineEntry {
        EventTimelineEntry(id: "x", kind: kind, variant: variant, detail: detail, timestamp: nil)
    }

    func testLockLabels() {
        let positive = EventTimelineLabels.resolve(for: entry(.lock, .positive), localize: englishFallback)
        XCTAssertEqual(positive.title, "Vehicle Locked")
        XCTAssertEqual(positive.subtitle, "Doors secured")
        let negative = EventTimelineLabels.resolve(for: entry(.lock, .negative), localize: englishFallback)
        XCTAssertEqual(negative.title, "Vehicle Unlocked")
        XCTAssertEqual(negative.subtitle, "Doors accessible")
    }

    func testSentryLabels() {
        let positive = EventTimelineLabels.resolve(for: entry(.sentry, .positive), localize: englishFallback)
        XCTAssertEqual(positive.title, "Sentry Mode Activated")
        XCTAssertEqual(positive.subtitle, "Camera surveillance enabled")
        let negative = EventTimelineLabels.resolve(for: entry(.sentry, .negative), localize: englishFallback)
        XCTAssertEqual(negative.title, "Sentry Mode Deactivated")
        XCTAssertEqual(negative.subtitle, "Camera surveillance disabled")
    }

    func testDoorLabelsUseRawDetailSubtitle() {
        let positive = EventTimelineLabels.resolve(
            for: entry(.door, .positive, detail: "Closed"),
            localize: englishFallback
        )
        XCTAssertEqual(positive.title, "Doors Closed")
        XCTAssertEqual(positive.subtitle, "Closed")
        let negative = EventTimelineLabels.resolve(
            for: entry(.door, .negative, detail: "DRIVER_FRONT"),
            localize: englishFallback
        )
        XCTAssertEqual(negative.title, "Door Opened")
        XCTAssertEqual(negative.subtitle, "DRIVER_FRONT")
    }

    func testNeutralResolvesLikeNegative() {
        let neutral = EventTimelineLabels.resolve(for: entry(.lock, .neutral), localize: englishFallback)
        XCTAssertEqual(neutral.title, "Vehicle Unlocked")
        XCTAssertEqual(neutral.subtitle, "Doors accessible")
    }

    func testLocalizerKeysAreRequested() {
        var requestedKeys: [String] = []
        let recording: (String, String) -> String = { key, fallback in
            requestedKeys.append(key)
            return fallback
        }
        _ = EventTimelineLabels.resolve(for: entry(.sentry, .positive), localize: recording)
        XCTAssertEqual(requestedKeys, [
            "admin.security.timeline.sentry.positive",
            "admin.security.timeline.sentry.positiveDesc"
        ])
    }
}

// MARK: - Timestamp formatting

final class EventTimelineTimestampTests: XCTestCase {
    func testAbsoluteNilReturnsDash() {
        XCTAssertEqual(EventTimelineTimestamp.absolute(for: nil), "—")
    }

    func testAbsoluteRendersHumanReadable() {
        let date = Date(timeIntervalSince1970: 1_736_000_000)
        let out = EventTimelineTimestamp.absolute(for: date)
        XCTAssertNotEqual(out, "—")
        XCTAssertFalse(out.isEmpty)
    }

    func testRelativeRendersPastInterval() {
        let now = Date(timeIntervalSince1970: 1_736_000_000)
        let earlier = now.addingTimeInterval(-7200)
        let out = EventTimelineTimestamp.relative(for: earlier, relativeTo: now)
        XCTAssertFalse(out.isEmpty)
    }
}

// MARK: - Projection: phase resolution

final class EventTimelineProjectionTests: XCTestCase {
    func testLoading() {
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.loading, hasRows: false), .loading)
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.loading, hasRows: true), .content)
    }

    func testEmpty() {
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.empty, hasRows: false), .empty)
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.empty, hasRows: true), .empty)
    }

    func testLoaded() {
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.loaded, hasRows: false), .empty)
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.loaded, hasRows: true), .content)
    }

    func testFailed() {
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.failed("boom"), hasRows: false), .error("boom"))
        // Cached rows stay visible behind a failure.
        XCTAssertEqual(EventTimelineProjection.resolvePhase(.failed("boom"), hasRows: true), .content)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class EventTimelineModelTests: XCTestCase {
    private func history() -> [EventTimelineSecurityEvent] {
        [
            EventTimelineSecurityEvent(
                id: "2",
                createdAt: Date(timeIntervalSince1970: 1_736_000_010),
                locked: true,
                sentryMode: .string("On"),
                doorState: .string("Closed")
            ),
            EventTimelineSecurityEvent(
                id: "1",
                createdAt: Date(timeIntervalSince1970: 1_736_000_000),
                locked: false,
                sentryMode: .string("Off"),
                doorState: .string("Open")
            )
        ]
    }

    func testStartAppliesInitialDerivesAndEmitsTelemetryOnce() {
        let spy = SpyEventTimelineTelemetry()
        let source = InMemoryEventTimelineSource(
            initial: EventTimelineUpdate(status: .loaded, events: history())
        )
        let model = EventTimelineModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.events.count, 3)
        XCTAssertEqual(spy.surfaces, [EventTimelineSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testEmptyHistoryResolvesToEmptyPhase() {
        let source = InMemoryEventTimelineSource(
            initial: EventTimelineUpdate(status: .loaded, events: [])
        )
        let model = EventTimelineModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.events.isEmpty)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryEventTimelineSource(initial: EventTimelineUpdate(status: .loading))
        let model = EventTimelineModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesPhaseConnectionAndRefreshing() {
        let source = InMemoryEventTimelineSource(initial: EventTimelineUpdate(status: .loading))
        let model = EventTimelineModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(EventTimelineUpdate(
            status: .loaded,
            events: history(),
            refreshing: true,
            connection: .offline
        ))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertEqual(model.events.count, 3)
    }

    func testStaleTriggersExactlyOneAutoRefreshPerEpisode() {
        let source = InMemoryEventTimelineSource()
        let model = EventTimelineModel(source: source)
        model.start()
        source.push(EventTimelineUpdate(status: .loaded, events: history(), connection: .stale))
        source.push(EventTimelineUpdate(status: .loaded, events: history(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Returning live then going stale again re-arms the one-shot auto-refresh.
        source.push(EventTimelineUpdate(status: .loaded, events: history(), connection: .live))
        source.push(EventTimelineUpdate(status: .loaded, events: history(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryEventTimelineSource()
        let model = EventTimelineModel(source: source)
        model.start()
        source.push(EventTimelineUpdate(status: .loaded, events: history(), connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility summary content

final class EventTimelineAccessibilityTests: XCTestCase {
    private let englishFallback: (String, String) -> String = { _, fallback in fallback }

    func testRowSummaryCombinesTitleSubtitleAndTimestamp() {
        let entry = EventTimelineEntry(
            id: "lock-1",
            kind: .lock,
            variant: .positive,
            detail: "—",
            timestamp: Date(timeIntervalSince1970: 1_736_000_000)
        )
        let summary = EventTimelineAccessibility.rowSummary(for: entry, localize: englishFallback)
        XCTAssertTrue(summary.contains("Vehicle Locked"))
        XCTAssertTrue(summary.contains("Doors secured"))
        XCTAssertFalse(summary.hasSuffix(", "))
    }

    func testRowSummaryOmitsEmptySubtitle() {
        let entry = EventTimelineEntry(id: "d", kind: .door, variant: .positive, detail: "", timestamp: nil)
        let summary = EventTimelineAccessibility.rowSummary(for: entry, localize: englishFallback)
        // Door title + the em-dash timestamp, with no empty subtitle segment between them.
        XCTAssertEqual(summary, "Doors Closed, —")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEventTimelineTelemetry: EventTimelineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
