//
//  WidgetTipCards.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the limit resolution (the
//  verbatim port of `maxTips ?? (compact ? 1 : 3)`, floored at 0), the slice (web `tips.slice(0, limit)`),
//  the description clamp (web `compact && line-clamp-2`), the row mapping (field passthrough + caller ids),
//  the empty branch (web `visible.length === 0`), and the value-type equality. Split from
//  WidgetTipCards.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func tip(
        _ id: String,
        icon: String? = nil,
        title: String = "Title",
        description: String = "Description",
        impact: TipImpact? = nil,
        impactLabel: String? = nil
    ) -> TipItem {
        TipItem(
            id: id,
            iconSymbol: icon,
            title: title,
            description: description,
            impact: impact,
            impactLabel: impactLabel
        )
    }

    static let three = [tip("a"), tip("b"), tip("c")]
    static let five = [tip("a"), tip("b"), tip("c"), tip("d"), tip("e")]
}

// MARK: - Surface identity

final class WidgetTipCardsAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetTipCardsSurface.slug, "WidgetTipCards")
    }
}

// MARK: - Limit resolution (web `maxTips ?? (compact ? 1 : 3)`)

final class WidgetTipCardsLimitTests: XCTestCase {
    func testDefaultNonCompactLimitIsThree() {
        XCTAssertEqual(WidgetTipCardsProjector.limit(WidgetTipCardsInput(tips: Fixture.five)), 3)
    }

    func testDefaultCompactLimitIsOne() {
        XCTAssertEqual(
            WidgetTipCardsProjector.limit(WidgetTipCardsInput(tips: Fixture.five, compact: true)),
            1
        )
    }

    func testMaxTipsOverridesTheCompactDefault() {
        XCTAssertEqual(
            WidgetTipCardsProjector.limit(WidgetTipCardsInput(tips: Fixture.five, maxTips: 4, compact: true)),
            4
        )
    }

    func testZeroMaxTipsResolvesToZero() {
        XCTAssertEqual(WidgetTipCardsProjector.limit(WidgetTipCardsInput(tips: Fixture.five, maxTips: 0)), 0)
    }

    func testNegativeMaxTipsIsFlooredAtZero() {
        XCTAssertEqual(WidgetTipCardsProjector.limit(WidgetTipCardsInput(tips: Fixture.five, maxTips: -3)), 0)
    }
}

// MARK: - Slice (web `tips.slice(0, limit)`)

final class WidgetTipCardsVisibleTipsTests: XCTestCase {
    func testNonCompactCapsAtThree() {
        let visible = WidgetTipCardsProjector.visibleTips(WidgetTipCardsInput(tips: Fixture.five))
        XCTAssertEqual(visible.map(\.id), ["a", "b", "c"])
    }

    func testCompactKeepsOnlyTheFirst() {
        let visible = WidgetTipCardsProjector.visibleTips(
            WidgetTipCardsInput(tips: Fixture.five, compact: true)
        )
        XCTAssertEqual(visible.map(\.id), ["a"])
    }

    func testFewerThanLimitReturnsAll() {
        let visible = WidgetTipCardsProjector.visibleTips(
            WidgetTipCardsInput(tips: [Fixture.tip("a"), Fixture.tip("b")])
        )
        XCTAssertEqual(visible.map(\.id), ["a", "b"])
    }

    func testMaxTipsCapsBelowTheDefault() {
        let visible = WidgetTipCardsProjector.visibleTips(
            WidgetTipCardsInput(tips: Fixture.five, maxTips: 2)
        )
        XCTAssertEqual(visible.map(\.id), ["a", "b"])
    }

    func testZeroMaxTipsYieldsNoVisibleTips() {
        let visible = WidgetTipCardsProjector.visibleTips(
            WidgetTipCardsInput(tips: Fixture.five, maxTips: 0)
        )
        XCTAssertTrue(visible.isEmpty)
    }
}

// MARK: - Row mapping (clamp + passthrough)

final class WidgetTipCardsRowsTests: XCTestCase {
    func testNonCompactRowsHaveNoLineLimit() {
        let rows = WidgetTipCardsProjector.rows(WidgetTipCardsInput(tips: Fixture.three))
        XCTAssertEqual(rows.count, 3)
        XCTAssertTrue(rows.allSatisfy { $0.descriptionLineLimit == nil })
    }

    func testCompactRowsClampDescriptionToTwoLines() {
        let rows = WidgetTipCardsProjector.rows(
            WidgetTipCardsInput(tips: Fixture.three, maxTips: 3, compact: true)
        )
        XCTAssertTrue(rows.allSatisfy { $0.descriptionLineLimit == 2 })
    }

    func testRowPassesThroughEveryField() {
        let tip = Fixture.tip(
            "regen",
            icon: "leaf",
            title: "Maximize regen",
            description: "Keep regen on Standard to recover more energy on descents.",
            impact: .high,
            impactLabel: "High impact"
        )
        let row = WidgetTipCardsProjector.rows(WidgetTipCardsInput(tips: [tip]))[0]
        XCTAssertEqual(row.id, "regen")
        XCTAssertEqual(row.iconSymbol, "leaf")
        XCTAssertEqual(row.title, "Maximize regen")
        XCTAssertEqual(row.description, "Keep regen on Standard to recover more energy on descents.")
        XCTAssertEqual(row.impact, .high)
        XCTAssertEqual(row.impactLabel, "High impact")
    }

    func testRowsPreserveCallerOrderAndIds() {
        let rows = WidgetTipCardsProjector.rows(WidgetTipCardsInput(tips: Fixture.three))
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c"])
    }
}

// MARK: - Resolve (empty vs populated)

final class WidgetTipCardsResolveTests: XCTestCase {
    func testEmptyInputResolvesToEmpty() {
        XCTAssertEqual(WidgetTipCardsProjector.resolve(WidgetTipCardsInput(tips: [])), .empty)
    }

    func testZeroMaxTipsResolvesToEmpty() {
        XCTAssertEqual(
            WidgetTipCardsProjector.resolve(WidgetTipCardsInput(tips: Fixture.three, maxTips: 0)),
            .empty
        )
    }

    func testPopulatedInputResolvesToCappedList() {
        guard case let .populated(rows) = WidgetTipCardsProjector.resolve(
            WidgetTipCardsInput(tips: Fixture.five)
        ) else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 3)
    }

    func testCompactPopulatedResolvesToSingleRow() {
        guard case let .populated(rows) = WidgetTipCardsProjector.resolve(
            WidgetTipCardsInput(tips: Fixture.five, compact: true)
        ) else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 1)
    }
}

// MARK: - Value-type equality

final class WidgetTipCardsValueTypeTests: XCTestCase {
    func testTipItemEqualityDistinguishesFields() {
        let base = Fixture.tip("a", icon: "leaf", title: "T", description: "D", impact: .high, impactLabel: "L")
        XCTAssertEqual(
            base,
            Fixture.tip("a", icon: "leaf", title: "T", description: "D", impact: .high, impactLabel: "L")
        )
        XCTAssertNotEqual(base, Fixture.tip("b", icon: "leaf", title: "T", description: "D", impact: .high))
        XCTAssertNotEqual(base, Fixture.tip("a", icon: "bolt", title: "T", description: "D", impact: .high))
        XCTAssertNotEqual(base, Fixture.tip("a", icon: "leaf", title: "T", description: "D", impact: .low))
    }

    func testInputEqualityDistinguishesProps() {
        let tips = [Fixture.tip("a")]
        XCTAssertEqual(
            WidgetTipCardsInput(tips: tips, compact: false),
            WidgetTipCardsInput(tips: tips, compact: false)
        )
        XCTAssertNotEqual(
            WidgetTipCardsInput(tips: tips, compact: false),
            WidgetTipCardsInput(tips: tips, compact: true)
        )
        XCTAssertNotEqual(
            WidgetTipCardsInput(tips: tips, maxTips: 2),
            WidgetTipCardsInput(tips: tips, maxTips: 3)
        )
    }

    func testProjectionEquality() {
        let lhs = WidgetTipCardsProjector.resolve(WidgetTipCardsInput(tips: Fixture.three))
        let rhs = WidgetTipCardsProjector.resolve(WidgetTipCardsInput(tips: Fixture.three))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, .empty)
    }
}
