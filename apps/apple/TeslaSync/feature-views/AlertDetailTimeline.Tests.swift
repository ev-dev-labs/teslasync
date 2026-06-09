//
//  AlertDetailTimeline.Tests.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  Unit coverage for the AlertDetailTimeline surface: the Adapter (`project` parity, the
//  actor / note normalization, the `KIND_COLOR` tint + `kindIcon` SF-Symbol mapping), the
//  Labels (`defaultTitle*` + i18next `{{actor}}` parity), the Timestamp formatter, the state
//  holder (`AlertDetailTimelineProjection` + `AlertDetailTimelineModel` wiring incl. stale
//  auto-refresh + P1/S11 `view.opened`), and the VoiceOver row summary. These run in the
//  TeslaSync(/-macOS) XCTest targets — no network, no real store: the model is driven by
//  `InMemoryAlertDetailTimelineSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: project (port of `events.map`)

@MainActor final class AlertDetailTimelineProjectTests: XCTestCase {
    private func event(
        _ id: Int64,
        _ offset: TimeInterval,
        actor: String? = nil,
        kind: AlertEventKind,
        note: String? = nil
    ) -> AlertDetailTimelineEvent {
        AlertDetailTimelineEvent(
            id: id,
            occurredAt: Date(timeIntervalSince1970: 1_736_000_000 + offset),
            actor: actor,
            kind: kind,
            note: note
        )
    }

    func testEmptyEventsYieldNoRows() {
        XCTAssertTrue(AlertDetailTimelineAdapter.project(from: []).isEmpty)
    }

    func testProjectPreservesOrderAndCount() {
        let events = [
            event(1, 0, kind: .created),
            event(2, 10, actor: "Alex", kind: .acknowledged),
            event(3, 20, actor: "Alex", kind: .commented, note: "Looking into it")
        ]
        let rows = AlertDetailTimelineAdapter.project(from: events)
        XCTAssertEqual(rows.map(\.id), [1, 2, 3])
        XCTAssertEqual(rows.map(\.kind), [.created, .acknowledged, .commented])
        XCTAssertEqual(rows[2].note, "Looking into it")
        XCTAssertEqual(rows[2].timestamp, Date(timeIntervalSince1970: 1_736_000_020))
    }

    func testActorNormalizationMatchesWebTrimCheck() {
        // nil / whitespace-only → nil; otherwise the raw (untrimmed) value is kept.
        XCTAssertNil(AlertDetailTimelineAdapter.normalizedActor(nil))
        XCTAssertNil(AlertDetailTimelineAdapter.normalizedActor(""))
        XCTAssertNil(AlertDetailTimelineAdapter.normalizedActor("   \n"))
        XCTAssertEqual(AlertDetailTimelineAdapter.normalizedActor("Alex"), "Alex")
        XCTAssertEqual(AlertDetailTimelineAdapter.normalizedActor("  Alex  "), "  Alex  ")
    }

    func testNoteNormalizationCollapsesEmptyToNil() {
        XCTAssertNil(AlertDetailTimelineAdapter.normalizedNote(nil))
        XCTAssertNil(AlertDetailTimelineAdapter.normalizedNote(""))
        XCTAssertEqual(AlertDetailTimelineAdapter.normalizedNote("note"), "note")
    }

    func testProjectAppliesActorAndNoteNormalization() {
        let rows = AlertDetailTimelineAdapter.project(from: [
            event(1, 0, actor: "   ", kind: .acknowledged, note: "")
        ])
        XCTAssertEqual(rows.count, 1)
        XCTAssertNil(rows[0].actor)
        XCTAssertNil(rows[0].note)
    }
}

// MARK: - Adapter: tint + icon mapping

@MainActor final class AlertDetailTimelineTintIconTests: XCTestCase {
    func testTintPerKindWithUnknownFallback() {
        XCTAssertEqual(AlertDetailTimelineAdapter.tint(for: .created), .created)
        XCTAssertEqual(AlertDetailTimelineAdapter.tint(for: .acknowledged), .acknowledged)
        XCTAssertEqual(AlertDetailTimelineAdapter.tint(for: .reopened), .reopened)
        XCTAssertEqual(AlertDetailTimelineAdapter.tint(for: .commented), .commented)
        // Web `KIND_COLOR[ev.kind] ?? KIND_COLOR.created`.
        XCTAssertEqual(AlertDetailTimelineAdapter.tint(for: .other("escalated")), .created)
    }

    func testIconSystemNamePerKindWithUnknownInfoFallback() {
        XCTAssertEqual(AlertDetailTimelineAdapter.iconSystemName(for: .created), "bell.fill")
        XCTAssertEqual(AlertDetailTimelineAdapter.iconSystemName(for: .acknowledged), "checkmark.circle.fill")
        XCTAssertEqual(AlertDetailTimelineAdapter.iconSystemName(for: .reopened), "arrow.clockwise")
        XCTAssertEqual(AlertDetailTimelineAdapter.iconSystemName(for: .commented), "square.and.pencil")
        // Web `default: return <Icons.info />` — note the icon default (info) differs from the
        // tint default (created).
        XCTAssertEqual(AlertDetailTimelineAdapter.iconSystemName(for: .other("escalated")), "info.circle.fill")
    }

    func testKindRawValueRoundTrip() {
        for raw in ["created", "acknowledged", "reopened", "commented", "escalated"] {
            XCTAssertEqual(AlertEventKind(raw).rawValue, raw)
        }
    }
}

// MARK: - Labels (port of defaultTitle* + i18next `{{actor}}`)

@MainActor final class AlertDetailTimelineLabelsTests: XCTestCase {
    private let englishFallback: (String, String) -> String = { _, fallback in fallback }

    private func entry(_ kind: AlertEventKind, actor: String?) -> AlertDetailTimelineEntry {
        AlertDetailTimelineEntry(id: 1, kind: kind, actor: actor, note: nil, timestamp: nil)
    }

    private func title(_ kind: AlertEventKind, actor: String?) -> String {
        AlertDetailTimelineLabels.title(for: entry(kind, actor: actor), localize: englishFallback)
    }

    func testCreatedTitleIgnoresActor() {
        XCTAssertEqual(title(.created, actor: nil), "Alert created")
        XCTAssertEqual(title(.created, actor: "Alex"), "Alert created")
    }

    func testAcknowledgedTitles() {
        XCTAssertEqual(title(.acknowledged, actor: "Alex Rivera"), "Acknowledged by Alex Rivera")
        XCTAssertEqual(title(.acknowledged, actor: nil), "Acknowledged")
    }

    func testReopenedTitles() {
        XCTAssertEqual(title(.reopened, actor: "Sam"), "Reopened by Sam")
        XCTAssertEqual(title(.reopened, actor: nil), "Reopened")
    }

    func testCommentedTitles() {
        XCTAssertEqual(title(.commented, actor: "Sam"), "Comment by Sam")
        XCTAssertEqual(title(.commented, actor: nil), "Comment added")
    }

    func testUnknownKindFallsBackToRawKind() {
        XCTAssertEqual(title(.other("escalated"), actor: "Alex"), "escalated")
        XCTAssertEqual(title(.other("escalated"), actor: nil), "escalated")
    }

    func testActorInterpolationSubstitutesCatalogFormat() {
        // Simulate the shipped catalog value (`%@`) rather than the English fallback.
        let catalog: (String, String) -> String = { key, _ in
            key == "alerts.timeline.kind.commented" ? "Comment by %@" : key
        }
        let resolved = AlertDetailTimelineLabels.title(
            for: entry(.commented, actor: "Robin"),
            localize: catalog
        )
        XCTAssertEqual(resolved, "Comment by Robin")
    }

    func testLocalizerRequestsExpectedKeys() {
        var keys: [String] = []
        let recording: (String, String) -> String = { key, fallback in
            keys.append(key)
            return fallback
        }
        _ = AlertDetailTimelineLabels.title(for: entry(.acknowledged, actor: "Alex"), localize: recording)
        _ = AlertDetailTimelineLabels.title(for: entry(.reopened, actor: nil), localize: recording)
        XCTAssertEqual(keys, [
            "alerts.timeline.kind.acknowledged",
            "alerts.timeline.kindAnonymous.reopened"
        ])
    }
}

// MARK: - Timestamp formatting

@MainActor final class AlertDetailTimelineTimestampTests: XCTestCase {
    func testAbsoluteNilReturnsDash() {
        XCTAssertEqual(AlertDetailTimelineTimestamp.absolute(for: nil), "—")
    }

    func testAbsoluteRendersHumanReadable() {
        let out = AlertDetailTimelineTimestamp.absolute(for: Date(timeIntervalSince1970: 1_736_000_000))
        XCTAssertNotEqual(out, "—")
        XCTAssertFalse(out.isEmpty)
    }
}

// MARK: - Projection: phase resolution

@MainActor final class AlertDetailTimelineProjectionTests: XCTestCase {
    func testLoading() {
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.loading, hasRows: false), .loading)
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.loading, hasRows: true), .content)
    }

    func testEmpty() {
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.empty, hasRows: false), .empty)
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.empty, hasRows: true), .empty)
    }

    func testLoaded() {
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.loaded, hasRows: false), .empty)
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.loaded, hasRows: true), .content)
    }

    func testFailed() {
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.failed("boom"), hasRows: false), .error("boom"))
        // Cached rows stay visible behind a failure.
        XCTAssertEqual(AlertDetailTimelineProjection.resolvePhase(.failed("boom"), hasRows: true), .content)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class AlertDetailTimelineModelTests: XCTestCase {
    private func events() -> [AlertDetailTimelineEvent] {
        [
            AlertDetailTimelineEvent(
                id: 1,
                occurredAt: Date(timeIntervalSince1970: 1_736_000_000),
                actor: nil,
                kind: .created,
                note: "BatteryLevel < 20%"
            ),
            AlertDetailTimelineEvent(
                id: 2,
                occurredAt: Date(timeIntervalSince1970: 1_736_000_900),
                actor: "Alex",
                kind: .acknowledged,
                note: nil
            )
        ]
    }

    func testStartAppliesInitialProjectsAndEmitsTelemetryOnce() {
        let spy = SpyAlertDetailTimelineTelemetry()
        let source = InMemoryAlertDetailTimelineSource(
            initial: AlertDetailTimelineUpdate(status: .loaded, events: events())
        )
        let model = AlertDetailTimelineModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.events.count, 2)
        XCTAssertEqual(spy.surfaces, [AlertDetailTimelineSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testEmptyEventsResolveToEmptyPhase() {
        let source = InMemoryAlertDetailTimelineSource(
            initial: AlertDetailTimelineUpdate(status: .loaded, events: [])
        )
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.events.isEmpty)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryAlertDetailTimelineSource(initial: AlertDetailTimelineUpdate(status: .loading))
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesPhaseConnectionAndRefreshing() {
        let source = InMemoryAlertDetailTimelineSource(initial: AlertDetailTimelineUpdate(status: .loading))
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AlertDetailTimelineUpdate(
            status: .loaded,
            events: events(),
            refreshing: true,
            connection: .offline
        ))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertEqual(model.events.count, 2)
    }

    func testStaleTriggersExactlyOneAutoRefreshPerEpisode() {
        let source = InMemoryAlertDetailTimelineSource()
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        source.push(AlertDetailTimelineUpdate(status: .loaded, events: events(), connection: .stale))
        source.push(AlertDetailTimelineUpdate(status: .loaded, events: events(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Returning live then going stale again re-arms the one-shot auto-refresh.
        source.push(AlertDetailTimelineUpdate(status: .loaded, events: events(), connection: .live))
        source.push(AlertDetailTimelineUpdate(status: .loaded, events: events(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryAlertDetailTimelineSource()
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        source.push(AlertDetailTimelineUpdate(status: .loaded, events: events(), connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility summary content

@MainActor final class AlertDetailTimelineAccessibilityTests: XCTestCase {
    private let englishFallback: (String, String) -> String = { _, fallback in fallback }

    func testRowSummaryCombinesTitleNoteAndTimestamp() {
        let entry = AlertDetailTimelineEntry(
            id: 2,
            kind: .acknowledged,
            actor: "Alex Rivera",
            note: "Looks resolved",
            timestamp: Date(timeIntervalSince1970: 1_736_000_000)
        )
        let summary = AlertDetailTimelineAccessibility.rowSummary(for: entry, localize: englishFallback)
        XCTAssertTrue(summary.contains("Acknowledged by Alex Rivera"))
        XCTAssertTrue(summary.contains("Looks resolved"))
        XCTAssertFalse(summary.hasSuffix(", "))
    }

    func testRowSummaryOmitsAbsentNote() {
        let entry = AlertDetailTimelineEntry(id: 1, kind: .created, actor: nil, note: nil, timestamp: nil)
        let summary = AlertDetailTimelineAccessibility.rowSummary(for: entry, localize: englishFallback)
        XCTAssertEqual(summary, "Alert created, —")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAlertDetailTimelineTelemetry: AlertDetailTimelineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
