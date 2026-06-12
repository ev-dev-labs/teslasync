//
//  PillFilterBar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the projection (selected
//  flag, enabled-key ring excluding disabled pills, locale-formatted counts, variant / scrollable
//  passthrough), the WAI-ARIA Tabs keyboard math (the verbatim port of the web `handleKeyDown` —
//  ArrowLeft / ArrowRight wrap-around skipping disabled pills, a disabled active key as a no-op, Home /
//  End), the `fmtInt`-parity count formatting, and the value-type equality + accent default. Split from
//  PillFilterBar.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class PillFilterBarAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(PillFilterBarSurface.slug, "PillFilterBar")
    }

    func testAccentDefaultsToCyan() {
        XCTAssertEqual(PillAccent.default, .cyan)
        XCTAssertEqual(PillItem(key: "k", label: "L").accent, .cyan)
    }
}

// MARK: - Resolve (selected / enabled-ring / counts / passthrough)

final class PillFilterBarResolveTests: XCTestCase {
    private func items(_ count: Int) -> [PillItem] {
        (0 ..< count).map { PillItem(key: "k\($0)", label: "L\($0)") }
    }

    func testSelectedFlagMatchesActiveKey() {
        let projection = PillFilterBarProjector.resolve(
            PillFilterBarInput(items: items(3), activeKey: "k1", ariaLabel: "Filter")
        )
        XCTAssertEqual(projection.pills.map(\.isSelected), [false, true, false])
        XCTAssertEqual(projection.activeKey, "k1")
    }

    func testEmptyWhenNoItems() {
        let projection = PillFilterBarProjector.resolve(
            PillFilterBarInput(items: [], activeKey: "", ariaLabel: "Filter")
        )
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.pills.isEmpty)
        XCTAssertTrue(projection.enabledKeys.isEmpty)
    }

    func testEnabledKeysExcludeDisabled() {
        let pills = [
            PillItem(key: "a", label: "A"),
            PillItem(key: "b", label: "B", disabled: true),
            PillItem(key: "c", label: "C")
        ]
        let projection = PillFilterBarProjector.resolve(
            PillFilterBarInput(items: pills, activeKey: "a", ariaLabel: "Filter")
        )
        XCTAssertEqual(projection.enabledKeys, ["a", "c"])
        XCTAssertEqual(projection.pills.count, 3, "disabled pills still render, just not in the nav ring")
    }

    func testFormattedCountPresentOnlyWhenCountSet() {
        let pills = [
            PillItem(key: "a", label: "A", count: 12345),
            PillItem(key: "b", label: "B")
        ]
        let projection = PillFilterBarProjector.resolve(
            PillFilterBarInput(items: pills, activeKey: "a", ariaLabel: "Filter")
        )
        XCTAssertEqual(projection.pills.first?.formattedCount, "12,345")
        XCTAssertNil(projection.pills.last?.formattedCount)
    }

    func testVariantAndScrollablePassThrough() {
        let projection = PillFilterBarProjector.resolve(
            PillFilterBarInput(
                items: items(2),
                activeKey: "k0",
                ariaLabel: "Filter",
                variant: .tabs,
                scrollable: false
            )
        )
        XCTAssertEqual(projection.variant, .tabs)
        XCTAssertFalse(projection.scrollable)
    }
}

// MARK: - Count formatting (web `fmtInt`)

final class PillFilterBarCountTests: XCTestCase {
    func testGroupsThousandsLikeFmtInt() {
        XCTAssertEqual(PillFilterBarProjector.formatCount(0), "0")
        XCTAssertEqual(PillFilterBarProjector.formatCount(42), "42")
        XCTAssertEqual(PillFilterBarProjector.formatCount(12345), "12,345")
        XCTAssertEqual(PillFilterBarProjector.formatCount(1_000_000), "1,000,000")
    }

    func testNegativeCountFormats() {
        XCTAssertEqual(PillFilterBarProjector.formatCount(-1234), "-1,234")
    }
}

// MARK: - Keyboard navigation (web `handleKeyDown`)

final class PillFilterBarNavigationTests: XCTestCase {
    private let ring = ["a", "c"] // "b" is disabled and absent from the enabled ring

    func testForwardStepsAndWraps() {
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "a", direction: .forward, in: ring), "c")
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "c", direction: .forward, in: ring), "a")
    }

    func testBackwardStepsAndWraps() {
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "c", direction: .backward, in: ring), "a")
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "a", direction: .backward, in: ring), "c")
    }

    func testDisabledActiveKeyIsNoOp() {
        // Web `idx === -1` → return: the active key is not in the enabled ring.
        XCTAssertNil(PillFilterBarProjector.nextKey(from: "b", direction: .forward, in: ring))
    }

    func testEmptyRingIsNoOp() {
        XCTAssertNil(PillFilterBarProjector.nextKey(from: "a", direction: .forward, in: []))
        XCTAssertNil(PillFilterBarProjector.firstKey(in: []))
        XCTAssertNil(PillFilterBarProjector.lastKey(in: []))
    }

    func testHomeAndEnd() {
        let keys = ["a", "c", "d"]
        XCTAssertEqual(PillFilterBarProjector.firstKey(in: keys), "a")
        XCTAssertEqual(PillFilterBarProjector.lastKey(in: keys), "d")
    }

    func testSingleEnabledKeyWrapsToItself() {
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "a", direction: .forward, in: ["a"]), "a")
        XCTAssertEqual(PillFilterBarProjector.nextKey(from: "a", direction: .backward, in: ["a"]), "a")
    }

    func testDirectionDelta() {
        XCTAssertEqual(PillNavigationDirection.forward.delta, 1)
        XCTAssertEqual(PillNavigationDirection.backward.delta, -1)
    }
}

// MARK: - Value-type equality

final class PillFilterBarValueTypeTests: XCTestCase {
    func testPillItemEquality() {
        let lhs = PillItem(key: "a", label: "A", count: 3, accent: .green)
        let rhs = PillItem(key: "a", label: "A", count: 3, accent: .green)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, PillItem(key: "a", label: "A", count: 4, accent: .green))
        XCTAssertNotEqual(lhs, PillItem(key: "a", label: "A", count: 3, accent: .red))
    }

    func testInputEquality() {
        let items = [PillItem(key: "a", label: "A")]
        let lhs = PillFilterBarInput(items: items, activeKey: "a", ariaLabel: "Filter", variant: .tabs)
        let rhs = PillFilterBarInput(items: items, activeKey: "a", ariaLabel: "Filter", variant: .tabs)
        XCTAssertEqual(lhs, rhs)
        let other = PillFilterBarInput(items: items, activeKey: "a", ariaLabel: "Filter", variant: .pills)
        XCTAssertNotEqual(lhs, other)
    }

    func testResolvedPillIdentity() {
        let resolved = ResolvedPill(
            item: PillItem(key: "vehicle", label: "Vehicle"),
            isSelected: true,
            formattedCount: nil
        )
        XCTAssertEqual(resolved.id, "vehicle")
    }
}
