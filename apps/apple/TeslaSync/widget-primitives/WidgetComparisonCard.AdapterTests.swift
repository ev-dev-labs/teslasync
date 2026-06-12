//
//  WidgetComparisonCard.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the `compact` slice (the
//  verbatim port of `compact ? metrics.slice(0, 2) : metrics`), the direction resolution (web
//  `higherIsBetter ? 'higher_better' : 'lower_better'`), the row mapping (positional ids + `isLast`), the
//  empty branch (web `visible.length === 0`), and the value-type equality. Split from
//  WidgetComparisonCard.Tests.swift (the SwiftUI / state-holder half) to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is
//  pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func metric(
        _ label: String,
        current: Double = 10,
        previous: Double = 8,
        formatted: String = "10",
        unit: String? = nil,
        higherIsBetter: Bool = true
    ) -> ComparisonMetric {
        ComparisonMetric(
            label: label,
            current: current,
            previous: previous,
            formattedCurrent: formatted,
            unit: unit,
            higherIsBetter: higherIsBetter
        )
    }

    static let three = [metric("A"), metric("B"), metric("C")]
}

// MARK: - Surface identity

final class WidgetComparisonCardAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetComparisonCardSurface.slug, "WidgetComparisonCard")
    }
}

// MARK: - Compact slice (web `compact ? metrics.slice(0, 2) : metrics`)

final class WidgetComparisonCardVisibleMetricsTests: XCTestCase {
    func testNonCompactReturnsEveryMetric() {
        let input = WidgetComparisonCardInput(metrics: Fixture.three, compact: false)
        XCTAssertEqual(WidgetComparisonCardProjector.visibleMetrics(input).map(\.label), ["A", "B", "C"])
    }

    func testCompactKeepsOnlyTheFirstTwo() {
        let input = WidgetComparisonCardInput(metrics: Fixture.three, compact: true)
        XCTAssertEqual(WidgetComparisonCardProjector.visibleMetrics(input).map(\.label), ["A", "B"])
    }

    func testCompactWithFewerThanLimitReturnsAllAvailable() {
        let input = WidgetComparisonCardInput(metrics: [Fixture.metric("A")], compact: true)
        XCTAssertEqual(WidgetComparisonCardProjector.visibleMetrics(input).map(\.label), ["A"])
    }

    func testEmptyStaysEmpty() {
        let input = WidgetComparisonCardInput(metrics: [], compact: true)
        XCTAssertTrue(WidgetComparisonCardProjector.visibleMetrics(input).isEmpty)
    }
}

// MARK: - Direction resolution (web `higherIsBetter ? 'higher_better' : 'lower_better'`)

final class WidgetComparisonCardDirectionTests: XCTestCase {
    func testHigherIsBetterMapsToHigherBetter() {
        XCTAssertEqual(WidgetComparisonCardProjector.direction(higherIsBetter: true), .higherBetter)
    }

    func testLowerIsBetterMapsToLowerBetter() {
        XCTAssertEqual(WidgetComparisonCardProjector.direction(higherIsBetter: false), .lowerBetter)
    }

    func testDefaultMetricResolvesToHigherBetter() {
        // Web `higherIsBetter ?? true` — an omitted value treats a rise as favorable.
        let rows = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: [Fixture.metric("A")])
        )
        XCTAssertEqual(rows.first?.direction, .higherBetter)
    }
}

// MARK: - Row mapping (positional ids + `isLast` + passthrough)

final class WidgetComparisonCardRowsTests: XCTestCase {
    func testRowsCarryStablePositionalIds() {
        let rows = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: Fixture.three)
        )
        XCTAssertEqual(rows.map(\.id), [0, 1, 2])
    }

    func testOnlyTheFinalRowIsLast() {
        let rows = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: Fixture.three)
        )
        XCTAssertEqual(rows.map(\.isLast), [false, false, true])
    }

    func testSingleRowIsLast() {
        let rows = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: [Fixture.metric("A")])
        )
        XCTAssertEqual(rows.map(\.isLast), [true])
    }

    func testRowPassesThroughFormattingAndEndpoints() {
        let metric = Fixture.metric(
            "Efficiency",
            current: 268,
            previous: 281,
            formatted: "268",
            unit: "Wh/km",
            higherIsBetter: false
        )
        let row = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: [metric])
        )[0]
        XCTAssertEqual(row.label, "Efficiency")
        XCTAssertEqual(row.formattedCurrent, "268")
        XCTAssertEqual(row.unit, "Wh/km")
        XCTAssertEqual(row.current, 268, accuracy: 0.0001)
        XCTAssertEqual(row.previous, 281, accuracy: 0.0001)
        XCTAssertEqual(row.direction, .lowerBetter)
    }

    func testCompactRowsSliceToTwoAndReindexIsLast() {
        let rows = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: Fixture.three, compact: true)
        )
        XCTAssertEqual(rows.map(\.label), ["A", "B"])
        XCTAssertEqual(rows.map(\.isLast), [false, true])
    }
}

// MARK: - Resolve (empty vs populated)

final class WidgetComparisonCardResolveTests: XCTestCase {
    func testEmptyInputResolvesToEmpty() {
        XCTAssertEqual(
            WidgetComparisonCardProjector.resolve(WidgetComparisonCardInput(metrics: [])),
            .empty
        )
    }

    func testPopulatedInputResolvesToPopulatedColumn() {
        let projection = WidgetComparisonCardProjector.resolve(
            WidgetComparisonCardInput(metrics: Fixture.three)
        )
        guard case let .populated(rows) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 3)
    }

    func testCompactPopulatedResolvesToTwoRows() {
        let projection = WidgetComparisonCardProjector.resolve(
            WidgetComparisonCardInput(metrics: Fixture.three, compact: true)
        )
        guard case let .populated(rows) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 2)
    }
}

// MARK: - Value-type equality

final class WidgetComparisonCardValueTypeTests: XCTestCase {
    func testComparisonMetricEqualityDistinguishesFields() {
        let base = Fixture.metric("A", current: 10, previous: 8, formatted: "10", unit: "km")
        XCTAssertEqual(base, Fixture.metric("A", current: 10, previous: 8, formatted: "10", unit: "km"))
        XCTAssertNotEqual(base, Fixture.metric("B", current: 10, previous: 8, formatted: "10", unit: "km"))
        XCTAssertNotEqual(base, Fixture.metric("A", current: 11, previous: 8, formatted: "10", unit: "km"))
        XCTAssertNotEqual(base, Fixture.metric("A", current: 10, previous: 8, formatted: "10", unit: "mi"))
        XCTAssertNotEqual(
            base,
            Fixture.metric("A", current: 10, previous: 8, formatted: "10", unit: "km", higherIsBetter: false)
        )
    }

    func testInputEqualityDistinguishesCompact() {
        let metrics = [Fixture.metric("A")]
        XCTAssertEqual(
            WidgetComparisonCardInput(metrics: metrics, compact: false),
            WidgetComparisonCardInput(metrics: metrics, compact: false)
        )
        XCTAssertNotEqual(
            WidgetComparisonCardInput(metrics: metrics, compact: false),
            WidgetComparisonCardInput(metrics: metrics, compact: true)
        )
    }

    func testProjectionEquality() {
        let lhs = WidgetComparisonCardProjector.resolve(WidgetComparisonCardInput(metrics: Fixture.three))
        let rhs = WidgetComparisonCardProjector.resolve(WidgetComparisonCardInput(metrics: Fixture.three))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, .empty)
    }
}
