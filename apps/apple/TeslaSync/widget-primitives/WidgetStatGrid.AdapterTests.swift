//
//  WidgetStatGrid.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The host-runnable, Foundation-pure coverage for the stat grid — everything that does not need SwiftUI,
//  so it executes both in the TeslaSync(/-macOS) XCTest targets AND in the isolated SwiftPM harness the
//  Apple surface gate uses while the full app build is deferred:
//    • Projector — the `autoCols` table (web `count % 3 → 3 / % 4 → 4 / else 2`), the `compact` collapse,
//      the explicit-`cols` override, the cell mapping (positional ids + passthrough), and the empty branch.
//    • Value types — field-distinguishing equality for ``StatGridItem`` / ``StatTrend`` / the input / the
//      projection, plus ``StatTrendDirection/isPositive`` (web `positive: trend === 'up'`).
//    • Model — the once-only `view.opened`, the props `update` re-derivation, and the projection.
//    • Strings — the empty copy + a11y compositions resolve through the P1/S10 facade with the fallbacks.
//  The SwiftUI view-composition half lives in WidgetStatGrid.Tests.swift. No network; the derivation is
//  pure, with no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func item(
        _ label: String,
        value: String = "10",
        unit: String? = nil,
        icon: String? = nil,
        trend: StatTrend? = nil,
        tone: StatValueTone = .primary
    ) -> StatGridItem {
        StatGridItem(label: label, value: value, unit: unit, iconSystemName: icon, trend: trend, valueTone: tone)
    }

    static func items(_ count: Int) -> [StatGridItem] {
        (0 ..< count).map { item("S\($0)", value: "\($0)") }
    }
}

// MARK: - Surface identity

final class WidgetStatGridAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        // The Foundation-pure identity (the SwiftUI `WidgetStatGrid.surfaceSlug` mirror is asserted in the
        // view-composition half, WidgetStatGrid.Tests.swift).
        XCTAssertEqual(WidgetStatGridSurface.slug, "WidgetStatGrid")
    }
}

// MARK: - autoCols (web `count % 3 → 3 / % 4 → 4 / else 2`)

final class WidgetStatGridAutoColsTests: XCTestCase {
    func testMultiplesOfThreePreferThree() {
        XCTAssertEqual(WidgetStatGridProjector.autoCols(3), 3)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(6), 3)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(9), 3)
        // 12 is divisible by both 3 and 4 — the web checks `% 3` first, so 3 wins.
        XCTAssertEqual(WidgetStatGridProjector.autoCols(12), 3)
    }

    func testMultiplesOfFourNotThreeAreFour() {
        XCTAssertEqual(WidgetStatGridProjector.autoCols(4), 4)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(8), 4)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(16), 4)
    }

    func testEverythingElseIsTwo() {
        XCTAssertEqual(WidgetStatGridProjector.autoCols(1), 2)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(2), 2)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(5), 2)
        XCTAssertEqual(WidgetStatGridProjector.autoCols(7), 2)
    }
}

// MARK: - resolveColumns (web `compact ? 1 : (cols ?? autoCols(len))`)

final class WidgetStatGridResolveColumnsTests: XCTestCase {
    func testCompactAlwaysCollapsesToOne() {
        let input = WidgetStatGridInput(stats: Fixture.items(6), compact: true, cols: .four)
        XCTAssertEqual(WidgetStatGridProjector.resolveColumns(input), 1)
        XCTAssertEqual(WidgetStatGridProjector.compactColumns, 1)
    }

    func testExplicitColsOverrideAutoCount() {
        let input = WidgetStatGridInput(stats: Fixture.items(5), compact: false, cols: .three)
        XCTAssertEqual(WidgetStatGridProjector.resolveColumns(input), 3)
    }

    func testNilColsFallsBackToAutoCount() {
        let input = WidgetStatGridInput(stats: Fixture.items(4), compact: false, cols: nil)
        XCTAssertEqual(WidgetStatGridProjector.resolveColumns(input), 4)
    }
}

// MARK: - Cell mapping (positional ids + passthrough)

final class WidgetStatGridCellsTests: XCTestCase {
    func testCellsCarryStablePositionalIds() {
        let cells = WidgetStatGridProjector.cells(WidgetStatGridInput(stats: Fixture.items(3)))
        XCTAssertEqual(cells.map(\.id), [0, 1, 2])
    }

    func testCellsPassThroughItemVerbatim() {
        let trend = StatTrend(direction: .down, value: "-3.2%")
        let stat = Fixture.item("Efficiency", value: "162", unit: "Wh/km", icon: "leaf", trend: trend, tone: .success)
        let cells = WidgetStatGridProjector.cells(WidgetStatGridInput(stats: [stat]))
        XCTAssertEqual(cells.count, 1)
        XCTAssertEqual(cells[0].item, stat)
        XCTAssertEqual(cells[0].item.unit, "Wh/km")
        XCTAssertEqual(cells[0].item.iconSystemName, "leaf")
        XCTAssertEqual(cells[0].item.trend, trend)
        XCTAssertEqual(cells[0].item.valueTone, .success)
    }
}

// MARK: - resolve (empty vs populated layout)

final class WidgetStatGridResolveTests: XCTestCase {
    func testEmptyStatsResolveToEmpty() {
        XCTAssertEqual(WidgetStatGridProjector.resolve(WidgetStatGridInput(stats: [])), .empty)
    }

    func testPopulatedResolvesLayoutWithColumnsAndCells() {
        let projection = WidgetStatGridProjector.resolve(WidgetStatGridInput(stats: Fixture.items(3)))
        guard case let .populated(layout) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(layout.columns, 3)
        XCTAssertFalse(layout.isCompact)
        XCTAssertEqual(layout.cells.count, 3)
    }

    func testCompactPopulatedCarriesSingleColumnAndCompactFlag() {
        let projection = WidgetStatGridProjector.resolve(
            WidgetStatGridInput(stats: Fixture.items(4), compact: true)
        )
        guard case let .populated(layout) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(layout.columns, 1)
        XCTAssertTrue(layout.isCompact)
        XCTAssertEqual(layout.cells.count, 4)
    }
}

// MARK: - Value types (equality + direction polarity)

final class WidgetStatGridValueTypeTests: XCTestCase {
    func testTrendDirectionPolarityMatchesWeb() {
        // Web `positive: trend === 'up'` — only `up` is favorable.
        XCTAssertTrue(StatTrendDirection.up.isPositive)
        XCTAssertFalse(StatTrendDirection.down.isPositive)
        XCTAssertFalse(StatTrendDirection.flat.isPositive)
    }

    func testStatGridItemEqualityDistinguishesFields() {
        let base = Fixture.item("A", value: "10", unit: "km", icon: "bolt", tone: .primary)
        XCTAssertEqual(base, Fixture.item("A", value: "10", unit: "km", icon: "bolt", tone: .primary))
        XCTAssertNotEqual(base, Fixture.item("B", value: "10", unit: "km", icon: "bolt", tone: .primary))
        XCTAssertNotEqual(base, Fixture.item("A", value: "11", unit: "km", icon: "bolt", tone: .primary))
        XCTAssertNotEqual(base, Fixture.item("A", value: "10", unit: "mi", icon: "bolt", tone: .primary))
        XCTAssertNotEqual(base, Fixture.item("A", value: "10", unit: "km", icon: "leaf", tone: .primary))
        XCTAssertNotEqual(base, Fixture.item("A", value: "10", unit: "km", icon: "bolt", tone: .success))
    }

    func testStatTrendEqualityDistinguishesDirectionAndValue() {
        let base = StatTrend(direction: .up, value: "+1%")
        XCTAssertEqual(base, StatTrend(direction: .up, value: "+1%"))
        XCTAssertNotEqual(base, StatTrend(direction: .down, value: "+1%"))
        XCTAssertNotEqual(base, StatTrend(direction: .up, value: "+2%"))
    }

    func testInputEqualityDistinguishesCompactAndCols() {
        let stats = Fixture.items(2)
        XCTAssertEqual(
            WidgetStatGridInput(stats: stats, compact: false, cols: .two),
            WidgetStatGridInput(stats: stats, compact: false, cols: .two)
        )
        XCTAssertNotEqual(
            WidgetStatGridInput(stats: stats, compact: false, cols: .two),
            WidgetStatGridInput(stats: stats, compact: true, cols: .two)
        )
        XCTAssertNotEqual(
            WidgetStatGridInput(stats: stats, compact: false, cols: .two),
            WidgetStatGridInput(stats: stats, compact: false, cols: .three)
        )
    }

    func testProjectionEquality() {
        let lhs = WidgetStatGridProjector.resolve(WidgetStatGridInput(stats: Fixture.items(3)))
        let rhs = WidgetStatGridProjector.resolve(WidgetStatGridInput(stats: Fixture.items(3)))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, .empty)
    }

    func testColumnsRawValuesMatchWeb() {
        XCTAssertEqual(StatGridColumns.two.rawValue, 2)
        XCTAssertEqual(StatGridColumns.three.rawValue, 3)
        XCTAssertEqual(StatGridColumns.four.rawValue, 4)
    }
}

// MARK: - WidgetStatGridModel (telemetry + derivation)

@MainActor
final class WidgetStatGridModelTests: XCTestCase {
    private func model(
        _ stats: [StatGridItem],
        compact: Bool = false,
        cols: StatGridColumns? = nil,
        telemetry: WidgetStatGridTelemetry = OSLogWidgetStatGridTelemetry()
    ) -> WidgetStatGridModel {
        WidgetStatGridModel(
            input: WidgetStatGridInput(stats: stats, compact: compact, cols: cols),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.items(3), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetStatGridSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.items(3), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetStatGridSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsPopulatedLayout() {
        guard case let .populated(layout) = model(Fixture.items(3)).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(layout.columns, 3)
        XCTAssertEqual(layout.cells.count, 3)
    }

    func testEmptyStatsProjectToEmpty() {
        XCTAssertEqual(model([]).projection, .empty)
    }

    func testUpdateReDerivesProjectionFromEmptyToPopulated() {
        let holder = model([])
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetStatGridInput(stats: Fixture.items(4)))
        guard case let .populated(layout) = holder.projection else {
            return XCTFail("expected populated projection after update")
        }
        XCTAssertEqual(layout.columns, 4)
        XCTAssertEqual(layout.cells.count, 4)
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetStatGridStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetStatGridStrings.emptyMessage, "No stats available")
        XCTAssertFalse(WidgetStatGridStrings.emptyHint.isEmpty)
    }

    func testCellAccessibilityLabelComposesLabelAndValue() {
        XCTAssertEqual(
            WidgetStatGridStrings.cellAccessibilityLabel(label: "Odometer", value: "48,213 km"),
            "Odometer, 48,213 km"
        )
    }

    func testValueWithUnitJoinsWhenPresentAndOmitsWhenAbsent() {
        XCTAssertEqual(WidgetStatGridStrings.valueWithUnit(value: "162", unit: "Wh/km"), "162 Wh/km")
        XCTAssertEqual(WidgetStatGridStrings.valueWithUnit(value: "18", unit: nil), "18")
        XCTAssertEqual(WidgetStatGridStrings.valueWithUnit(value: "18", unit: ""), "18")
    }

    func testTrendReadingUsesDirectionWordAndMagnitude() {
        XCTAssertEqual(
            WidgetStatGridStrings.trendAccessibilityLabel(direction: .up, value: "+1.4%"),
            "Up +1.4%"
        )
        XCTAssertEqual(
            WidgetStatGridStrings.trendAccessibilityLabel(direction: .down, value: "-3.2%"),
            "Down -3.2%"
        )
        XCTAssertEqual(
            WidgetStatGridStrings.trendAccessibilityLabel(direction: .flat, value: "0%"),
            "No change 0%"
        )
    }

    func testCellWithTrendAppendsReading() {
        XCTAssertEqual(
            WidgetStatGridStrings.cellWithTrend(base: "Odometer, 48,213 km", trend: "Up +1.4%"),
            "Odometer, 48,213 km, Up +1.4%"
        )
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
