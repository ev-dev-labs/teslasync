//
//  DateGroupedList.Tests.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  Coverage for the DateGroupedList surface composition:
//    • Projection — both render branches (empty / populated), the header mapping (verbatim
//      date / relative / summary + the composed spoken label), the VoiceOver item-count fallback
//      (singular / plural) when a group carries no caller summary, group ordering, `groupCount`, and
//      the always-true `presentsContent` predicate.
//    • Model — start idempotence, the once-only `view.opened` telemetry (fires for both populated and
//      empty content, since both present), the `sync` recompute + no-op-on-unchanged, and stop.
//    • Views — every state's subview + the generic surface composes (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records each `view.opened` emission. Accessed only on the main actor in these tests.
private final class RecordingDateGroupedListTelemetry: DateGroupedListTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// The identity (fallback) resolver — the projection's strings become their English defaults so the
/// assertions are deterministic without a bundle.
private let resolver: DateGroupedListResolve = { _, fallback in fallback }

private func header(
    _ dateKey: String = "2026-05-09",
    dateLabel: String = "May 9, 2026",
    itemCount: Int = 2,
    relativeLabel: String? = "3 days ago",
    summary: String? = "2 drives · 6.2 mi"
) -> DateGroupedListGroupHeader {
    DateGroupedListGroupHeader(
        dateKey: dateKey,
        dateLabel: dateLabel,
        itemCount: itemCount,
        relativeLabel: relativeLabel,
        summary: summary
    )
}

// MARK: - Projection (render branches)

final class DateGroupedListProjectionTests: XCTestCase {
    func testEmptyWhenNoGroups() {
        let resolved = DateGroupedListProjection.resolve(DateGroupedListInput(), strings: resolver)
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty") }
        XCTAssertEqual(empty.title, "Nothing here yet")
        XCTAssertFalse(empty.message.isEmpty)
        XCTAssertEqual(resolved.groupCount, 0)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testPopulatedMapsHeaderVerbatim() {
        let resolved = DateGroupedListProjection.resolve(
            DateGroupedListInput(headers: [header()]),
            strings: resolver
        )
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.dateKey, "2026-05-09")
        XCTAssertEqual(row.dateLabel, "May 9, 2026")
        XCTAssertEqual(row.relativeLabel, "3 days ago")
        XCTAssertEqual(row.summary, "2 drives · 6.2 mi")
        XCTAssertEqual(row.id, "2026-05-09")
        XCTAssertTrue(resolved.presentsContent)
        XCTAssertEqual(resolved.groupCount, 1)
    }

    func testAccessibilityLabelFoldsSummary() {
        let resolved = DateGroupedListProjection.resolve(
            DateGroupedListInput(headers: [header()]),
            strings: resolver
        )
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows[0].accessibilityLabel, "May 9, 2026, 3 days ago, 2 drives · 6.2 mi")
    }

    func testAccessibilityFallsBackToPluralItemCount() {
        let resolved = DateGroupedListProjection.resolve(
            DateGroupedListInput(headers: [header(itemCount: 4, relativeLabel: nil, summary: nil)]),
            strings: resolver
        )
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertNil(rows[0].summary, "no visible summary when the caller passes none")
        XCTAssertEqual(rows[0].accessibilityLabel, "May 9, 2026, 4 items")
    }

    func testAccessibilityFallsBackToSingularItemCount() {
        let resolved = DateGroupedListProjection.resolve(
            DateGroupedListInput(headers: [header(itemCount: 1, relativeLabel: nil, summary: nil)]),
            strings: resolver
        )
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows[0].accessibilityLabel, "May 9, 2026, 1 item")
    }

    func testPreservesGroupOrder() {
        let input = DateGroupedListInput(headers: [
            header("2026-05-09", dateLabel: "May 9, 2026"),
            header("2026-04-24", dateLabel: "Apr 24, 2026"),
            header("2026-03-01", dateLabel: "Mar 1, 2026")
        ])
        let resolved = DateGroupedListProjection.resolve(input, strings: resolver)
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.map(\.dateKey), ["2026-05-09", "2026-04-24", "2026-03-01"])
    }
}

// MARK: - Model (state-holder + telemetry)

@MainActor
final class DateGroupedListModelTests: XCTestCase {
    private struct Harness {
        let model: DateGroupedListModel
        let telemetry: RecordingDateGroupedListTelemetry
    }

    private func makeHarness(input: DateGroupedListInput = DateGroupedListInput()) -> Harness {
        let telemetry = RecordingDateGroupedListTelemetry()
        let model = DateGroupedListModel(input: input, telemetry: telemetry, strings: resolver)
        return Harness(model: model, telemetry: telemetry)
    }

    func testResolvesEmptyByDefault() {
        let harness = makeHarness()
        guard case .empty = harness.model.phase else { return XCTFail("expected empty") }
    }

    func testResolvesPopulatedInput() {
        let harness = makeHarness(input: DateGroupedListInput(headers: [header()]))
        guard case let .populated(rows) = harness.model.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 1)
    }

    func testViewOpenedFiresOnceForPopulated() {
        let harness = makeHarness(input: DateGroupedListInput(headers: [header()]))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "no open before appear")
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.opened, ["DateGroupedList"], "view.opened fires exactly once")
    }

    func testViewOpenedFiresForEmptyContent() {
        let harness = makeHarness()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.opened, ["DateGroupedList"], "empty state is content; it opens")
    }

    func testSyncRecomputesPhase() {
        let harness = makeHarness()
        guard case .empty = harness.model.phase else { return XCTFail("expected empty") }
        harness.model.sync(DateGroupedListInput(headers: [header()]))
        guard case let .populated(rows) = harness.model.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 1)
    }

    func testSyncIsNoOpForUnchangedInput() {
        let harness = makeHarness(input: DateGroupedListInput(headers: [header()]))
        let before = harness.model.resolved
        harness.model.sync(DateGroupedListInput(headers: [header()]))
        XCTAssertEqual(harness.model.resolved, before)
    }

    func testStopIsCallable() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.stop()
        // A second start after stop does not re-emit (open is once-only for the surface lifetime).
        harness.model.start()
        XCTAssertEqual(harness.telemetry.opened, ["DateGroupedList"])
    }
}

// MARK: - Views (signature contract — every state composes)

@MainActor
final class DateGroupedListViewsTests: XCTestCase {
    private func sampleGroups() -> [DateGroupedListGroup<Int>] {
        [DateGroupedListGroup(
            dateKey: "2026-05-09",
            dateLabel: "May 9, 2026",
            items: [1, 2],
            relativeLabel: "3 days ago",
            summary: "2 drives · 6.2 mi"
        )]
    }

    func testGenericSurfaceComposesWithDefaultItemKey() {
        _ = DateGroupedList(groups: sampleGroups()) { value, _ in
            Text(verbatim: "\(value)")
        }
    }

    func testGenericSurfaceComposesWithCustomItemKeyAndTelemetry() {
        _ = DateGroupedList(
            groups: sampleGroups(),
            itemSpacing: 10,
            groupSpacing: 20,
            itemKey: { value, _ in value },
            telemetry: RecordingDateGroupedListTelemetry(),
            rowContent: { value, index in
                Text(verbatim: "\(index): \(value)")
            }
        )
    }

    func testEmptySurfaceComposes() {
        _ = DateGroupedList(groups: [DateGroupedListGroup<Int>]()) { value, _ in
            Text(verbatim: "\(value)")
        }
    }

    func testStateSubviewsCompose() {
        let resolvedHeader = DateGroupedListResolvedHeader(
            dateKey: "k",
            dateLabel: "May 9, 2026",
            relativeLabel: "3 days ago",
            summary: "2 drives · 6.2 mi",
            accessibilityLabel: "May 9, 2026, 3 days ago, 2 drives · 6.2 mi"
        )
        _ = DateGroupedListDividerHeader(header: resolvedHeader)
        _ = DateGroupedListEmptyView(content: DateGroupedListEmpty(title: "t", message: "m"))
        _ = DateGroupedListGroupSection(
            header: resolvedHeader,
            items: [1, 2],
            itemSpacing: 12,
            itemKey: { value, _ in value },
            rowContent: { value, _ in Text(verbatim: "\(value)") }
        )
        _ = DateGroupedListContent(
            headers: [resolvedHeader],
            groups: sampleGroups(),
            itemSpacing: 12,
            groupSpacing: 24,
            itemKey: { value, _ in value },
            rowContent: { value, _ in Text(verbatim: "\(value)") }
        )
    }
}
