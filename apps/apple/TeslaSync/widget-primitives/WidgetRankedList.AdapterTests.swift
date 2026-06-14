//
//  WidgetRankedList.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The host-runnable, Foundation-pure coverage for the ranked list — everything that does not need SwiftUI,
//  so it executes both in the TeslaSync(/-macOS) XCTest targets AND in the isolated SwiftPM harness the
//  Apple surface gate uses while the full app build is deferred:
//    • Arrange — the limit table (web `maxItems ?? (compact ? 3 : 5)`), the `compact || !showBars` bar
//      hide, the descending stable sort + slice (web `sort((a, b) => b.value - a.value).slice`), the
//      `maxValue` reduce (seeded at 0), the clamped bar fraction, and the ranked row projection.
//    • Projection — the branch priority (error → loading → list → empty) of the web body + the P4 leaf.
//    • Value types — field-distinguishing equality for the item / badge / row / input / resolved.
//    • Model — the once-only `view.opened`, the stale auto-refresh transition, and the projection.
//    • Strings — the empty copy + a11y compositions resolve through the P1/S10 facade with the fallbacks.
//  The SwiftUI view-composition half lives in WidgetRankedList.Tests.swift. No network; the derivation is
//  pure, with no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func item(
        _ id: String,
        label: String = "L",
        value: Double,
        formatted: String? = nil,
        badge: RankedBadge? = nil,
        bar: RankedBarTone = .accent
    ) -> RankedItem {
        RankedItem(
            id: id,
            label: label,
            value: value,
            formattedValue: formatted ?? "\(Int(value))",
            badge: badge,
            barTone: bar
        )
    }

    /// Three out-of-order items: A=10, B=30, C=20 → sorted desc B, C, A.
    static func trio() -> [RankedItem] {
        [item("a", value: 10), item("b", value: 30), item("c", value: 20)]
    }
}

// MARK: - Surface identity

final class WidgetRankedListAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetRankedListSurface.slug, "WidgetRankedList")
        XCTAssertEqual(WidgetRankedListSymbols.empty, "list.number")
    }
}

// MARK: - Limit + hideBars (web `maxItems ?? (compact ? 3 : 5)` / `compact || !showBars`)

final class WidgetRankedListLimitTests: XCTestCase {
    func testDefaultLimitMatchesWeb() {
        XCTAssertEqual(WidgetRankedListArrange.defaultLimit(compact: false), 5)
        XCTAssertEqual(WidgetRankedListArrange.defaultLimit(compact: true), 3)
    }

    func testMaxItemsOverridesDefault() {
        XCTAssertEqual(WidgetRankedListArrange.limit(compact: true, maxItems: 7), 7)
        XCTAssertEqual(WidgetRankedListArrange.limit(compact: false, maxItems: nil), 5)
        XCTAssertEqual(WidgetRankedListArrange.limit(compact: true, maxItems: nil), 3)
    }

    func testHideBarsMatchesWeb() {
        // web `compact || !showBars`
        XCTAssertTrue(WidgetRankedListArrange.hideBars(compact: true, showBars: true))
        XCTAssertTrue(WidgetRankedListArrange.hideBars(compact: false, showBars: false))
        XCTAssertTrue(WidgetRankedListArrange.hideBars(compact: true, showBars: false))
        XCTAssertFalse(WidgetRankedListArrange.hideBars(compact: false, showBars: true))
    }
}

// MARK: - Visible (sort desc + stable ties + slice)

final class WidgetRankedListVisibleTests: XCTestCase {
    func testSortsByValueDescending() {
        let shown = WidgetRankedListArrange.visible(Fixture.trio(), compact: false, maxItems: nil)
        XCTAssertEqual(shown.map(\.id), ["b", "c", "a"])
        XCTAssertEqual(shown.map(\.value), [30, 20, 10])
    }

    func testSliceHonorsResolvedLimit() {
        let shown = WidgetRankedListArrange.visible(Fixture.trio(), compact: false, maxItems: 2)
        XCTAssertEqual(shown.map(\.id), ["b", "c"])
    }

    func testCompactSlicesToThree() {
        let items = (1 ... 6).map { Fixture.item("i\($0)", value: Double($0)) }
        let shown = WidgetRankedListArrange.visible(items, compact: true, maxItems: nil)
        XCTAssertEqual(shown.count, 3)
        XCTAssertEqual(shown.map(\.value), [6, 5, 4]) // top three by value
    }

    func testStableOnEqualValues() {
        // Equal values keep input order (a before b).
        let items = [Fixture.item("a", value: 10), Fixture.item("b", value: 10), Fixture.item("c", value: 5)]
        let shown = WidgetRankedListArrange.visible(items, compact: false, maxItems: nil)
        XCTAssertEqual(shown.map(\.id), ["a", "b", "c"])
    }
}

// MARK: - maxValue + barFraction (web reduce + `value / maxValue`)

final class WidgetRankedListBarMathTests: XCTestCase {
    func testMaxValueSeededAtZero() {
        XCTAssertEqual(WidgetRankedListArrange.maxValue([]), 0)
        XCTAssertEqual(WidgetRankedListArrange.maxValue(Fixture.trio()), 30)
        // All-negative values never drop below the 0 seed (web `reduce(..., 0)`).
        let negatives = [Fixture.item("a", value: -5), Fixture.item("b", value: -2)]
        XCTAssertEqual(WidgetRankedListArrange.maxValue(negatives), 0)
    }

    func testBarFractionScalesAndClamps() {
        XCTAssertEqual(WidgetRankedListArrange.barFraction(value: 30, maxValue: 30), 1, accuracy: 0.0001)
        XCTAssertEqual(WidgetRankedListArrange.barFraction(value: 20, maxValue: 30), 0.6667, accuracy: 0.0001)
        XCTAssertEqual(WidgetRankedListArrange.barFraction(value: 10, maxValue: 30), 0.3333, accuracy: 0.0001)
    }

    func testBarFractionZeroWhenNoPeak() {
        // web `maxValue > 0 ? … : 0`
        XCTAssertEqual(WidgetRankedListArrange.barFraction(value: 5, maxValue: 0), 0)
    }

    func testBarFractionClampsNegativeToZero() {
        XCTAssertEqual(WidgetRankedListArrange.barFraction(value: -5, maxValue: 30), 0)
    }
}

// MARK: - rows (rank + bar fraction projection)

final class WidgetRankedListRowsTests: XCTestCase {
    func testRowsCarryOneBasedRankAndFraction() {
        let rows = WidgetRankedListArrange.rows(Fixture.trio(), compact: false, maxItems: nil)
        XCTAssertEqual(rows.map(\.rank), [1, 2, 3])
        XCTAssertEqual(rows.map(\.item.id), ["b", "c", "a"])
        XCTAssertEqual(rows[0].barFraction, 1, accuracy: 0.0001)
        XCTAssertEqual(rows[1].barFraction, 0.6667, accuracy: 0.0001)
        XCTAssertEqual(rows[2].barFraction, 0.3333, accuracy: 0.0001)
    }

    func testRowIdentityMirrorsItem() {
        let rows = WidgetRankedListArrange.rows(Fixture.trio(), compact: false, maxItems: nil)
        XCTAssertEqual(rows.map(\.id), rows.map(\.item.id))
    }

    func testEmptyInputYieldsNoRows() {
        XCTAssertTrue(WidgetRankedListArrange.rows([], compact: false, maxItems: nil).isEmpty)
    }
}

// MARK: - Projection (error → loading → list → empty)

final class WidgetRankedListProjectionTests: XCTestCase {
    func testErrorBeatsEverything() {
        let input = WidgetRankedListInput(items: Fixture.trio(), isLoading: true, errorMessage: "boom")
        let resolved = WidgetRankedListProjection.resolve(input: input)
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testLoadingBeatsListWhenNoError() {
        let input = WidgetRankedListInput(items: Fixture.trio(), isLoading: true)
        XCTAssertEqual(WidgetRankedListProjection.resolve(input: input).phase, .loading)
    }

    func testListWhenItemsPresent() {
        let resolved = WidgetRankedListProjection.resolve(input: WidgetRankedListInput(items: Fixture.trio()))
        XCTAssertEqual(resolved.phase, .list)
        XCTAssertEqual(resolved.rows.count, 3)
        XCTAssertFalse(resolved.hideBars)
    }

    func testEmptyWhenNoItems() {
        XCTAssertEqual(WidgetRankedListProjection.resolve(input: WidgetRankedListInput()).phase, .empty)
    }

    func testHideBarsCarriedIntoResolved() {
        let input = WidgetRankedListInput(items: Fixture.trio(), compact: true)
        let resolved = WidgetRankedListProjection.resolve(input: input)
        XCTAssertTrue(resolved.hideBars)
        XCTAssertEqual(resolved.rows.count, 3)
    }

    func testEmptyMessageOverrideCarried() {
        let input = WidgetRankedListInput(emptyMessage: "Nothing yet", emptyIconSymbol: "tray")
        let resolved = WidgetRankedListProjection.resolve(input: input)
        XCTAssertEqual(resolved.emptyMessage, "Nothing yet")
        XCTAssertEqual(resolved.emptyIconSymbol, "tray")
    }
}

// MARK: - Value types (equality)

final class WidgetRankedListValueTypeTests: XCTestCase {
    func testItemEqualityDistinguishesFields() {
        let base = Fixture.item("a", label: "L", value: 10, formatted: "10", bar: .accent)
        XCTAssertEqual(base, Fixture.item("a", label: "L", value: 10, formatted: "10", bar: .accent))
        XCTAssertNotEqual(base, Fixture.item("b", label: "L", value: 10, formatted: "10", bar: .accent))
        XCTAssertNotEqual(base, Fixture.item("a", label: "X", value: 10, formatted: "10", bar: .accent))
        XCTAssertNotEqual(base, Fixture.item("a", label: "L", value: 11, formatted: "10", bar: .accent))
        XCTAssertNotEqual(base, Fixture.item("a", label: "L", value: 10, formatted: "11", bar: .accent))
        XCTAssertNotEqual(base, Fixture.item("a", label: "L", value: 10, formatted: "10", bar: .success))
    }

    func testBadgeEqualityDistinguishesTextAndTone() {
        let base = RankedBadge(text: "Top", tone: .success)
        XCTAssertEqual(base, RankedBadge(text: "Top", tone: .success))
        XCTAssertNotEqual(base, RankedBadge(text: "Low", tone: .success))
        XCTAssertNotEqual(base, RankedBadge(text: "Top", tone: .error))
    }

    func testBadgeToneCasesAreFaithfulToWeb() {
        // web RankedItem badge variants: success | warning | error | neutral
        XCTAssertEqual(Set(RankedBadgeTone.allCases), [.success, .warning, .error, .neutral])
    }

    func testRowEqualityDistinguishesRankAndFraction() {
        let item = Fixture.item("a", value: 10)
        let base = RankedListRow(rank: 1, item: item, barFraction: 0.5)
        XCTAssertEqual(base, RankedListRow(rank: 1, item: item, barFraction: 0.5))
        XCTAssertNotEqual(base, RankedListRow(rank: 2, item: item, barFraction: 0.5))
        XCTAssertNotEqual(base, RankedListRow(rank: 1, item: item, barFraction: 0.9))
    }

    func testInputEqualityDistinguishesProps() {
        let items = Fixture.trio()
        let base = WidgetRankedListInput(items: items, maxItems: 3, compact: false, showBars: true)
        XCTAssertEqual(base, WidgetRankedListInput(items: items, maxItems: 3, compact: false, showBars: true))
        XCTAssertNotEqual(base, WidgetRankedListInput(items: items, maxItems: 4, compact: false, showBars: true))
        XCTAssertNotEqual(base, WidgetRankedListInput(items: items, maxItems: 3, compact: true, showBars: true))
        XCTAssertNotEqual(base, WidgetRankedListInput(items: items, maxItems: 3, compact: false, showBars: false))
    }
}

// MARK: - Model (telemetry + derivation + stale auto-refresh)

@MainActor
final class WidgetRankedListModelTests: XCTestCase {
    private func model(
        source: InMemoryWidgetRankedListSource,
        telemetry: WidgetRankedListTelemetry = OSLogWidgetRankedListTelemetry()
    ) -> WidgetRankedListModel {
        WidgetRankedListModel(source: source, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: InMemoryWidgetRankedListSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetRankedListSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: InMemoryWidgetRankedListSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetRankedListSurface.slug, WidgetRankedListSurface.slug])
    }

    func testProjectionReflectsPushedList() {
        let source = InMemoryWidgetRankedListSource()
        let holder = model(source: source)
        source.push(WidgetRankedListInput(items: Fixture.trio()))
        XCTAssertEqual(holder.phase, .list)
        XCTAssertEqual(holder.resolved.rows.count, 3)
    }

    func testInitialSnapshotAppliedOnStart() {
        let source = InMemoryWidgetRankedListSource(initial: WidgetRankedListInput(items: Fixture.trio()))
        let holder = model(source: source)
        holder.start()
        XCTAssertEqual(holder.phase, .list)
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleTransitionTriggersOneShotRefresh() {
        let source = InMemoryWidgetRankedListSource()
        let holder = model(source: source)
        // Live → stale triggers exactly one refresh.
        source.push(WidgetRankedListInput(items: Fixture.trio(), connection: .stale))
        XCTAssertEqual(holder.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        // Staying stale does not re-trigger.
        source.push(WidgetRankedListInput(items: Fixture.trio(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryWidgetRankedListSource()
        let holder = model(source: source)
        holder.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetRankedListStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetRankedListStrings.emptyMessage, "No data available")
        XCTAssertFalse(WidgetRankedListStrings.emptyHint.isEmpty)
    }

    func testRowAccessibilityLabelComposesRankLabelValue() {
        XCTAssertEqual(
            WidgetRankedListStrings.rowAccessibilityLabel(rank: 2, label: "Home", value: "412 kWh"),
            "Rank 2: Home, 412 kWh"
        )
    }

    func testRowWithBadgeAppendsReading() {
        XCTAssertEqual(
            WidgetRankedListStrings.rowWithBadge(base: "Rank 1: Home, 412 kWh", badge: "Top"),
            "Rank 1: Home, 412 kWh, Top"
        )
    }

    func testFreshnessLabelsResolve() {
        XCTAssertEqual(WidgetRankedListStrings.freshnessLabel(.stale), "Stale")
        XCTAssertEqual(WidgetRankedListStrings.freshnessLabel(.offline), "Offline")
        XCTAssertFalse(WidgetRankedListStrings.freshnessAccessibility(.offline).isEmpty)
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
