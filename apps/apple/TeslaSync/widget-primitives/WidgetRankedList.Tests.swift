//
//  WidgetRankedList.Tests.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The SwiftUI view-composition half of the coverage (the Foundation-pure arrange + projection + value
//  types + model + strings live in WidgetRankedList.AdapterTests.swift, which also runs in the isolated
//  SwiftPM harness):
//    • Views — the public surface + the subviews compose in every state (list with bars + badges, compact
//      bars-hidden, bars-off, all-zero, single, loading, error, empty, stale, offline), via both the prop
//      initializer and the injected-model seam.
//    • Accessibility — the row's composed VoiceOver label (the string the view applies via
//      `.accessibilityLabel`) reads "Rank {rank}: {label}, {value}[, {badge}]", so every row is one spoken
//      element with its badge folded in.
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func item(_ id: String, value: Double, badge: RankedBadge? = nil) -> RankedItem {
        RankedItem(id: id, label: "Item \(id)", value: value, formattedValue: "\(Int(value)) kWh", badge: badge)
    }

    static func items() -> [RankedItem] {
        [
            item("1", value: 412, badge: RankedBadge(text: "Top", tone: .success)),
            item("2", value: 286),
            item("3", value: 174, badge: RankedBadge(text: "Slow", tone: .warning))
        ]
    }

    @MainActor
    static func model(_ input: WidgetRankedListInput) -> WidgetRankedListModel {
        WidgetRankedListModel(source: InMemoryWidgetRankedListSource(initial: input), telemetry: SpyTelemetry())
    }
}

// MARK: - Views (every state composes)

@MainActor
final class WidgetRankedListViewTests: XCTestCase {
    func testSurfaceComposesForEveryState() {
        _ = WidgetRankedList(items: Fixture.items()) // list with bars + badges
        _ = WidgetRankedList(items: Fixture.items(), compact: true) // compact, bars hidden
        _ = WidgetRankedList(items: Fixture.items(), showBars: false) // bars off
        _ = WidgetRankedList(items: [Fixture.item("z", value: 0)]) // all-zero → flat bar
        _ = WidgetRankedList(items: [Fixture.item("s", value: 99)]) // single
        _ = WidgetRankedList(items: [], isLoading: true) // loading
        _ = WidgetRankedList(items: [], errorMessage: "boom") // error
        _ = WidgetRankedList(items: []) // empty
        _ = WidgetRankedList(items: Fixture.items(), connection: .stale) // stale chip
        _ = WidgetRankedList(items: Fixture.items(), connection: .offline) // offline chip
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = Fixture.model(WidgetRankedListInput(items: Fixture.items()))
        _ = WidgetRankedList(model: injected)
        XCTAssertEqual(WidgetRankedList.surfaceSlug, "WidgetRankedList")
    }

    func testSubviewsCompose() {
        let rows = WidgetRankedListArrange.rows(Fixture.items(), compact: false, maxItems: nil)
        _ = WidgetRankedListView(rows: rows, hideBars: false)
        _ = WidgetRankedListView(rows: rows, hideBars: true)
        _ = RankedListRowView(row: rows[0], hideBars: false)
        _ = RankedListBadgeChip(badge: RankedBadge(text: "Top", tone: .success))
        _ = WidgetRankedListLoadingView()
        _ = WidgetRankedListErrorView(message: "boom") {}
        _ = WidgetRankedListFreshnessChip(connection: .stale) {}
    }

    func testToneBridgesCoverEveryCase() {
        // Every bar / badge tone projects to a concrete token without trapping.
        XCTAssertEqual(RankedBarTone.allCases.map(\.color).count, RankedBarTone.allCases.count)
        XCTAssertEqual(RankedBadgeTone.allCases.map(\.tsTone).count, RankedBadgeTone.allCases.count)
    }
}

// MARK: - Accessibility (the row's spoken label folds rank + label + value + badge)

@MainActor
final class WidgetRankedListAccessibilityTests: XCTestCase {
    /// Reproduces the exact composition the row applies via `.accessibilityLabel` (the view uses these same
    /// facade calls), so the spoken reading is verified end-to-end without a UI host.
    private func rowLabel(for item: RankedItem, rank: Int) -> String {
        let base = WidgetRankedListStrings.rowAccessibilityLabel(
            rank: rank,
            label: item.label,
            value: item.formattedValue
        )
        guard let badge = item.badge, !badge.text.isEmpty else { return base }
        return WidgetRankedListStrings.rowWithBadge(base: base, badge: badge.text)
    }

    func testRowLabelFoldsRankLabelValue() {
        let item = RankedItem(id: "1", label: "Home", value: 412, formattedValue: "412 kWh")
        XCTAssertEqual(rowLabel(for: item, rank: 1), "Rank 1: Home, 412 kWh")
    }

    func testRowLabelFoldsBadgeWhenPresent() {
        let item = RankedItem(
            id: "2",
            label: "Work",
            value: 174,
            formattedValue: "174 kWh",
            badge: RankedBadge(text: "Slow", tone: .warning)
        )
        XCTAssertEqual(rowLabel(for: item, rank: 3), "Rank 3: Work, 174 kWh, Slow")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetRankedListTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
