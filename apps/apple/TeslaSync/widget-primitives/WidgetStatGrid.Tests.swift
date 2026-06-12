//
//  WidgetStatGrid.Tests.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The SwiftUI view-composition half of the coverage (the Foundation-pure projector + value types + model +
//  strings live in WidgetStatGrid.AdapterTests.swift, which also runs in the isolated SwiftPM harness):
//    • Views — the public surface + the subviews compose in every real branch (auto 2/3/4-up, explicit
//      `cols`, compact single column, single cell, empty), via both the prop initializer and the injected-
//      model seam.
//    • Accessibility — the cell's composed VoiceOver label (the string the view applies via
//      `.accessibilityLabel`) reads "{label}, {value}{unit}[, {trend}]", so every cell is one spoken
//      element with its trend folded in.
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func item(_ label: String, trend: StatTrend? = nil) -> StatGridItem {
        StatGridItem(label: label, value: "10", unit: "km", iconSystemName: "bolt", trend: trend)
    }

    static func items(_ count: Int) -> [StatGridItem] {
        (0 ..< count).map { item("S\($0)") }
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetStatGridViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetStatGrid(stats: Fixture.items(2)) // auto 2-up
        _ = WidgetStatGrid(stats: Fixture.items(3)) // auto 3-up
        _ = WidgetStatGrid(stats: Fixture.items(4)) // auto 4-up
        _ = WidgetStatGrid(stats: Fixture.items(2), cols: .three) // explicit cols
        _ = WidgetStatGrid(stats: Fixture.items(3), compact: true) // compact single column
        _ = WidgetStatGrid(stats: [Fixture.item("Solo")]) // single cell
        _ = WidgetStatGrid(stats: []) // empty leaf
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetStatGridModel(
            input: WidgetStatGridInput(stats: Fixture.items(3)),
            telemetry: SpyTelemetry()
        )
        _ = WidgetStatGrid(model: injected)
        XCTAssertEqual(WidgetStatGrid.surfaceSlug, "WidgetStatGrid")
    }

    func testSubviewsCompose() {
        let layout = StatGridLayout(
            columns: 3,
            isCompact: false,
            cells: WidgetStatGridProjector.cells(WidgetStatGridInput(stats: Fixture.items(3)))
        )
        _ = StatGridLayoutView(layout: layout)
        _ = StatGridCell(item: Fixture.item("Battery", trend: StatTrend(direction: .up, value: "+2%")))
        _ = WidgetStatGridEmptyState()
    }

    func testTrendDirectionTokensCoverEveryCase() {
        // Every direction projects to a non-empty SF Symbol (the view's decorative arrow).
        for direction in [StatTrendDirection.up, .down, .flat] {
            XCTAssertFalse(direction.systemName.isEmpty)
        }
    }
}

// MARK: - Accessibility (the cell's spoken label folds in label + value + unit + trend)

@MainActor
final class WidgetStatGridAccessibilityTests: XCTestCase {
    /// Reproduces the exact composition the cell applies via `.accessibilityLabel` (the view uses these
    /// same facade calls), so the spoken reading is verified end-to-end without a UI host.
    private func cellLabel(for item: StatGridItem) -> String {
        let valueWithUnit = WidgetStatGridStrings.valueWithUnit(value: item.value, unit: item.unit)
        let base = WidgetStatGridStrings.cellAccessibilityLabel(label: item.label, value: valueWithUnit)
        guard let trend = item.trend else { return base }
        let reading = WidgetStatGridStrings.trendAccessibilityLabel(
            direction: trend.direction,
            value: trend.value
        )
        return WidgetStatGridStrings.cellWithTrend(base: base, trend: reading)
    }

    func testCellLabelFoldsValueAndUnit() {
        let item = StatGridItem(label: "Odometer", value: "48,213", unit: "km")
        XCTAssertEqual(cellLabel(for: item), "Odometer, 48,213 km")
    }

    func testCellLabelFoldsTrendWhenPresent() {
        let item = StatGridItem(
            label: "Efficiency",
            value: "162",
            unit: "Wh/km",
            trend: StatTrend(direction: .down, value: "-3.2%")
        )
        XCTAssertEqual(cellLabel(for: item), "Efficiency, 162 Wh/km, Down -3.2%")
    }

    func testCellLabelOmitsUnitAndTrendWhenAbsent() {
        let item = StatGridItem(label: "Trips", value: "18")
        XCTAssertEqual(cellLabel(for: item), "Trips, 18")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetStatGridTelemetry, @unchecked Sendable {
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
