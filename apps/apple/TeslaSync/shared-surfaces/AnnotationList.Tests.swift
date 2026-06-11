//
//  AnnotationList.Tests.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  Coverage for the AnnotationList surface composition:
//    • Projection — every render branch (loading / error / empty-state / withdrawn /
//      populated), the carried freshness axis (live / stale / offline), the row mapping (swatch +
//      localized name + combined a11y label + remove label), and the `presentsContent` predicate.
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while loading /
//      withdrawn), the phase transitions, the one-shot stale auto-refresh (re-armed on return to
//      live), offline never auto-refreshing, remove forwarding (web `onRemove`), and stop / refresh.
//    • Views — every state's subview composes (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records each `view.opened` emission. Accessed only on the main actor in these tests.
private final class RecordingAnnotationListTelemetry: AnnotationListTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// The identity (fallback) resolver — the projection's strings become their English defaults so the
/// assertions are deterministic without a bundle.
private let resolver: AnnotationListResolve = { _, fallback in fallback }

private func sampleItem(
    _ id: String = "1",
    label: String = "100k miles",
    category: AnnotationListCategory = .milestone,
    description: String? = nil,
    timestamp: String = "Jan 4"
) -> AnnotationListItem {
    AnnotationListItem(id: id, label: label, timestamp: timestamp, category: category, description: description)
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AnnotationListProjectionTests: XCTestCase {
    func testLoading() {
        let resolved = AnnotationListProjection.resolve(AnnotationListInput(availability: .loading), strings: resolver)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.title, "Annotations")
        XCTAssertNil(resolved.freshness)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorCarriesMessage() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .failed("Network timed out")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Network timed out")
        XCTAssertEqual(content.accessibilityLabel, "Couldn't load annotations: Network timed out")
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorFallsBackOnEmptyMessage() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .failed("")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Couldn't load annotations.")
    }

    func testEmptyStatePolicy() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .resolved([]), emptyBehavior: .emptyState),
            strings: resolver
        )
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty") }
        XCTAssertEqual(empty.title, "No annotations")
        XCTAssertFalse(empty.message.isEmpty)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testEmptyWithdraw() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .resolved([]), emptyBehavior: .withdraw),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .withdrawn)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testPopulatedMapsRow() {
        let item = sampleItem(
            "7",
            label: "Brake fluid",
            category: .maintenance,
            description: "Flushed",
            timestamp: "Apr 2"
        )
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .resolved([item]), connection: .live),
            strings: resolver
        )
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.id, "7")
        XCTAssertEqual(row.label, "Brake fluid")
        XCTAssertEqual(row.description, "Flushed")
        XCTAssertEqual(row.timestamp, "Apr 2")
        XCTAssertEqual(row.colorHex, "#f59e0b")
        XCTAssertEqual(row.categoryName, "Maintenance")
        XCTAssertEqual(row.accessibilityLabel, "Maintenance: Brake fluid. Flushed. Apr 2")
        XCTAssertEqual(row.removeAccessibilityLabel, "Remove annotation: Brake fluid")
        XCTAssertNil(resolved.freshness)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testPopulatedStaleFreshness() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .resolved([sampleItem()]), connection: .stale),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testPopulatedOfflineFreshness() {
        let resolved = AnnotationListProjection.resolve(
            AnnotationListInput(availability: .resolved([sampleItem()]), connection: .offline),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }
}

// MARK: - Model (state-holder + telemetry + freshness)

@MainActor
final class AnnotationListModelTests: XCTestCase {
    /// The model under test plus its in-memory source and recording telemetry (a named bag rather
    /// than a wide tuple, per the `large_tuple` lint rule).
    private struct Harness {
        let model: AnnotationListModel
        let source: InMemoryAnnotationListSource
        let telemetry: RecordingAnnotationListTelemetry
    }

    private func makeHarness(
        initial: AnnotationListInput? = nil,
        onRemove: (@MainActor (String) -> Void)? = nil
    ) -> Harness {
        let source = InMemoryAnnotationListSource(initial: initial)
        let telemetry = RecordingAnnotationListTelemetry()
        let model = AnnotationListModel(source: source, onRemove: onRemove, telemetry: telemetry)
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    func testStartIsIdempotent() {
        let harness = makeHarness(initial: AnnotationListInput(availability: .loading))
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testResolvesPopulatedThroughSource() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .live))
        guard case let .populated(rows) = harness.model.resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 1)
    }

    func testViewOpenedFiresOnceOnFirstContent() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .loading))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "loading is pre-content")
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()])))
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem(), sampleItem("2")])))
        XCTAssertEqual(harness.telemetry.opened, ["AnnotationList"], "view.opened fires exactly once")
    }

    func testViewOpenedFiresForEmptyState() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([]), emptyBehavior: .emptyState))
        XCTAssertEqual(harness.telemetry.opened, ["AnnotationList"])
    }

    func testViewOpenedNeverFiresWhileWithdrawn() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([]), emptyBehavior: .withdraw))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "web null is never opened")
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .live))
        XCTAssertEqual(harness.source.refreshCount, 0)
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1, "stale arms one auto-refresh")
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 1, "no re-fire while still stale")
    }

    func testReturnToLiveRearmsStaleRefresh() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .stale))
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .live))
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AnnotationListInput(availability: .resolved([sampleItem()]), connection: .offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
    }

    func testRemoveForwardsToHost() {
        var removed: [String] = []
        let harness = makeHarness(onRemove: { removed.append($0) })
        harness.model.start()
        harness.model.remove(id: "42")
        XCTAssertEqual(removed, ["42"])
    }

    func testRefreshAndStopWiring() {
        let harness = makeHarness(initial: AnnotationListInput(availability: .loading))
        harness.model.start()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2, "stop allows a fresh start")
    }
}

// MARK: - Views (signature contract — every state composes)

@MainActor
final class AnnotationListViewsTests: XCTestCase {
    func testSurfaceInitializers() {
        let source = InMemoryAnnotationListSource(initial: AnnotationListInput(availability: .loading))
        _ = AnnotationList(model: AnnotationListModel(source: source))
        _ = AnnotationList(input: AnnotationListInput(availability: .resolved([sampleItem()]))) { _ in }
    }

    func testStateSubviewsCompose() {
        _ = AnnotationListLoadingView()
        _ = AnnotationListEmptyView(content: AnnotationListEmpty(title: "t", message: "m"))
        _ = AnnotationListErrorView(content: AnnotationListErrorContent(message: "m", accessibilityLabel: "a")) {}
        _ = AnnotationListPopulatedView(
            title: "Annotations",
            freshness: AnnotationListFreshness(label: "Stale", accessibilityLabel: "a", isOffline: false),
            rows: [],
            onRefresh: {},
            onRemove: { _ in }
        )
    }

    func testRowAndDotCompose() {
        let row = AnnotationListRow(
            id: "1",
            label: "x",
            description: "d",
            timestamp: "t",
            colorHex: "#3b82f6",
            categoryName: "Milestone",
            accessibilityLabel: "a",
            removeAccessibilityLabel: "r"
        )
        _ = AnnotationRowView(row: row) {}
        _ = AnnotationCategoryDot(colorHex: row.colorHex)
        XCTAssertEqual(annotationListColor("#zzzzzz"), Color.TS.accent, "malformed swatch falls back to accent")
    }
}
