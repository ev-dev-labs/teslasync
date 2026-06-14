//
//  WidgetDetailCard.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the `compact` slice (the
//  verbatim port of `compact ? entries.slice(0, 4) : entries`), the row mapping (positional ids + `isLast`
//  + value/mono/badge passthrough), the empty branch (web `entries.length === 0`), and the value-type
//  equality. Split from WidgetDetailCard.Tests.swift (the SwiftUI / state-holder half) to keep each file
//  within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func entry(
        _ label: String,
        value: String? = "value",
        mono: Bool = false,
        badge: DetailBadge? = nil
    ) -> DetailEntry {
        DetailEntry(label: label, value: value, badge: badge, mono: mono)
    }

    static let five = [entry("A"), entry("B"), entry("C"), entry("D"), entry("E")]
}

// MARK: - Surface identity

final class WidgetDetailCardAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetDetailCardSurface.slug, "WidgetDetailCard")
    }
}

// MARK: - Compact slice (web `compact ? entries.slice(0, 4) : entries`)

final class WidgetDetailCardVisibleEntriesTests: XCTestCase {
    func testNonCompactReturnsEveryEntry() {
        let input = WidgetDetailCardInput(entries: Fixture.five, compact: false)
        XCTAssertEqual(
            WidgetDetailCardProjector.visibleEntries(input).map(\.label),
            ["A", "B", "C", "D", "E"]
        )
    }

    func testCompactKeepsOnlyTheFirstFour() {
        let input = WidgetDetailCardInput(entries: Fixture.five, compact: true)
        XCTAssertEqual(
            WidgetDetailCardProjector.visibleEntries(input).map(\.label),
            ["A", "B", "C", "D"]
        )
    }

    func testCompactWithFewerThanLimitReturnsAllAvailable() {
        let input = WidgetDetailCardInput(entries: [Fixture.entry("A")], compact: true)
        XCTAssertEqual(WidgetDetailCardProjector.visibleEntries(input).map(\.label), ["A"])
    }

    func testEmptyStaysEmpty() {
        let input = WidgetDetailCardInput(entries: [], compact: true)
        XCTAssertTrue(WidgetDetailCardProjector.visibleEntries(input).isEmpty)
    }
}

// MARK: - Row mapping (positional ids + `isLast` + passthrough)

final class WidgetDetailCardRowsTests: XCTestCase {
    func testRowsCarryStablePositionalIds() {
        let rows = WidgetDetailCardProjector.rows(WidgetDetailCardInput(entries: Fixture.five))
        XCTAssertEqual(rows.map(\.id), [0, 1, 2, 3, 4])
    }

    func testOnlyTheFinalRowIsLast() {
        let rows = WidgetDetailCardProjector.rows(
            WidgetDetailCardInput(entries: [Fixture.entry("A"), Fixture.entry("B"), Fixture.entry("C")])
        )
        XCTAssertEqual(rows.map(\.isLast), [false, false, true])
    }

    func testSingleRowIsLast() {
        let rows = WidgetDetailCardProjector.rows(WidgetDetailCardInput(entries: [Fixture.entry("A")]))
        XCTAssertEqual(rows.map(\.isLast), [true])
    }

    func testRowPassesThroughValueMonoAndBadge() {
        let badge = DetailBadge(text: "Active", variant: .success)
        let entry = Fixture.entry("VIN", value: "5YJ", mono: true, badge: badge)
        let row = WidgetDetailCardProjector.rows(WidgetDetailCardInput(entries: [entry]))[0]
        XCTAssertEqual(row.label, "VIN")
        XCTAssertEqual(row.value, "5YJ")
        XCTAssertTrue(row.mono)
        XCTAssertEqual(row.badge, badge)
    }

    func testRowCarriesNilValueForFallback() {
        let row = WidgetDetailCardProjector.rows(
            WidgetDetailCardInput(entries: [Fixture.entry("Scheduled", value: nil)])
        )[0]
        XCTAssertNil(row.value)
    }

    func testCompactRowsSliceToFourAndReindexIsLast() {
        let rows = WidgetDetailCardProjector.rows(
            WidgetDetailCardInput(entries: Fixture.five, compact: true)
        )
        XCTAssertEqual(rows.map(\.label), ["A", "B", "C", "D"])
        XCTAssertEqual(rows.map(\.isLast), [false, false, false, true])
    }
}

// MARK: - Resolve (empty vs populated)

final class WidgetDetailCardResolveTests: XCTestCase {
    func testEmptyInputResolvesToEmpty() {
        XCTAssertEqual(
            WidgetDetailCardProjector.resolve(WidgetDetailCardInput(entries: [])),
            .empty
        )
    }

    func testPopulatedInputResolvesToPopulatedColumn() {
        let projection = WidgetDetailCardProjector.resolve(WidgetDetailCardInput(entries: Fixture.five))
        guard case let .populated(rows) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 5)
    }

    func testCompactPopulatedResolvesToFourRows() {
        let projection = WidgetDetailCardProjector.resolve(
            WidgetDetailCardInput(entries: Fixture.five, compact: true)
        )
        guard case let .populated(rows) = projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 4)
    }
}

// MARK: - Value-type equality

final class WidgetDetailCardValueTypeTests: XCTestCase {
    func testDetailEntryEqualityDistinguishesFields() {
        let base = Fixture.entry("A", value: "1", mono: false)
        XCTAssertEqual(base, Fixture.entry("A", value: "1", mono: false))
        XCTAssertNotEqual(base, Fixture.entry("B", value: "1", mono: false))
        XCTAssertNotEqual(base, Fixture.entry("A", value: "2", mono: false))
        XCTAssertNotEqual(base, Fixture.entry("A", value: "1", mono: true))
        XCTAssertNotEqual(
            base,
            Fixture.entry("A", value: "1", badge: DetailBadge(text: "x", variant: .neutral))
        )
    }

    func testDetailBadgeEqualityDistinguishesTextAndVariant() {
        let base = DetailBadge(text: "Active", variant: .success)
        XCTAssertEqual(base, DetailBadge(text: "Active", variant: .success))
        XCTAssertNotEqual(base, DetailBadge(text: "Idle", variant: .success))
        XCTAssertNotEqual(base, DetailBadge(text: "Active", variant: .warning))
    }

    func testInputEqualityDistinguishesCompactAndEmptyOverrides() {
        let entries = [Fixture.entry("A")]
        XCTAssertEqual(
            WidgetDetailCardInput(entries: entries, compact: false),
            WidgetDetailCardInput(entries: entries, compact: false)
        )
        XCTAssertNotEqual(
            WidgetDetailCardInput(entries: entries, compact: false),
            WidgetDetailCardInput(entries: entries, compact: true)
        )
        XCTAssertNotEqual(
            WidgetDetailCardInput(entries: entries, emptyMessage: "a"),
            WidgetDetailCardInput(entries: entries, emptyMessage: "b")
        )
        XCTAssertNotEqual(
            WidgetDetailCardInput(entries: entries, emptyIconSymbol: "x"),
            WidgetDetailCardInput(entries: entries, emptyIconSymbol: "y")
        )
    }

    func testProjectionEquality() {
        let lhs = WidgetDetailCardProjector.resolve(WidgetDetailCardInput(entries: Fixture.five))
        let rhs = WidgetDetailCardProjector.resolve(WidgetDetailCardInput(entries: Fixture.five))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, .empty)
    }

    func testBadgeVariantCoversEveryWebUnionCase() {
        XCTAssertEqual(DetailBadgeVariant.allCases, [.success, .warning, .error, .neutral])
    }
}
