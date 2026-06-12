//
//  StickyChipBar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the default active id (the
//  verbatim port of the web `chips[0]?.id ?? ''`), the membership + active-id-validity rules (the native
//  peer of the browser re-running its observer over a changed anchor set), the active test, the
//  empty/populated resolve, and the value-type equality. Split from StickyChipBar.Tests.swift (the SwiftUI
//  / state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class StickyChipBarAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(StickyChipBarSurface.slug, "StickyChipBar")
    }
}

// MARK: - Default active id (web `chips[0]?.id ?? ''`)

final class StickyChipBarDefaultActiveTests: XCTestCase {
    private func chips(_ count: Int) -> [SectionChip] {
        (0 ..< count).map { SectionChip(id: "s\($0)", label: "Section \($0)") }
    }

    func testDefaultIsFirstChipID() {
        XCTAssertEqual(StickyChipBarProjector.defaultActiveID(chips(3)), "s0")
    }

    func testDefaultIsEmptyWhenNoChips() {
        XCTAssertEqual(StickyChipBarProjector.defaultActiveID([]), "")
    }
}

// MARK: - Membership + active-id validity (web observer re-run on changed anchors)

final class StickyChipBarValidityTests: XCTestCase {
    private func chips(_ ids: [String]) -> [SectionChip] {
        ids.map { SectionChip(id: $0, label: $0.capitalized) }
    }

    func testContains() {
        let set = chips(["a", "b", "c"])
        XCTAssertTrue(StickyChipBarProjector.contains("b", in: set))
        XCTAssertFalse(StickyChipBarProjector.contains("z", in: set))
    }

    func testResolveKeepsValidRequest() {
        let set = chips(["a", "b", "c"])
        XCTAssertEqual(StickyChipBarProjector.resolveActiveID(requested: "c", chips: set), "c")
    }

    func testResolveFallsBackToDefaultWhenStale() {
        // The active section was removed → fall back to the first chip (web re-observes the new anchors).
        let set = chips(["a", "b"])
        XCTAssertEqual(StickyChipBarProjector.resolveActiveID(requested: "gone", chips: set), "a")
    }

    func testResolveIsEmptyWhenNoChips() {
        XCTAssertEqual(StickyChipBarProjector.resolveActiveID(requested: "a", chips: []), "")
    }
}

// MARK: - Active test (web `chip.id === activeId`)

final class StickyChipBarActiveTests: XCTestCase {
    func testIsActive() {
        XCTAssertTrue(StickyChipBarProjector.isActive("b", activeID: "b"))
        XCTAssertFalse(StickyChipBarProjector.isActive("a", activeID: "b"))
    }
}

// MARK: - Resolve (empty / populated)

final class StickyChipBarResolveTests: XCTestCase {
    private func chips(_ count: Int) -> [SectionChip] {
        (0 ..< count).map { SectionChip(id: "s\($0)", label: "Section \($0)") }
    }

    func testResolvePopulated() {
        let projection = StickyChipBarProjector.resolve(StickyChipBarInput(chips: chips(3)))
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.chips.count, 3)
        XCTAssertEqual(projection.defaultActiveID, "s0")
    }

    func testResolveEmpty() {
        let projection = StickyChipBarProjector.resolve(StickyChipBarInput(chips: []))
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.chips.isEmpty)
        XCTAssertEqual(projection.defaultActiveID, "")
    }
}

// MARK: - Value-type equality

final class StickyChipBarValueTypeTests: XCTestCase {
    func testSectionChipEquality() {
        let lhs = SectionChip(id: "battery", label: "Battery")
        let rhs = SectionChip(id: "battery", label: "Battery")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, SectionChip(id: "battery", label: "Charging"))
    }

    func testInputEquality() {
        let chips = [SectionChip(id: "a", label: "A")]
        let lhs = StickyChipBarInput(chips: chips, topOffset: 12)
        let rhs = StickyChipBarInput(chips: chips, topOffset: 12)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, StickyChipBarInput(chips: chips, topOffset: 0))
    }
}
