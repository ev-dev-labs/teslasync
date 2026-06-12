//
//  ContextMenu.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The pure-core coverage (the Foundation/CoreGraphics-only adapter): the surface identity, the closure
//  -free descriptor equality, the empty-open guard (web `openContextMenu` early-return), the enabled-row
//  set + first / last / next keyboard traversal (the verbatim port of the web `enabledIndices` /
//  `focusFirstEnabled` / `focusLastEnabled` / `focusNextEnabled`, wrapping and skipping disabled rows), and
//  the measure-and-flip placement (the verbatim port of the web `useLayoutEffect`: flip the overflowing
//  edge, clamp to the margin). Split from ContextMenu.Tests.swift (the SwiftUI / state-holder half) to keep
//  each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets;
//  the derivation is pure, with no network and no clock.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class ContextMenuAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ContextMenuSurface.slug, "ContextMenu")
    }
}

// MARK: - Descriptor value type

final class ContextMenuDescriptorTests: XCTestCase {
    func testEqualityComparesAllFields() {
        let lhs = ContextMenuItemDescriptor(id: "copy", label: "Copy", systemImage: "doc.on.doc")
        let rhs = ContextMenuItemDescriptor(id: "copy", label: "Copy", systemImage: "doc.on.doc")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, ContextMenuItemDescriptor(id: "copy", label: "Duplicate"))
        XCTAssertNotEqual(lhs, ContextMenuItemDescriptor(id: "copy", label: "Copy", isDestructive: true))
    }

    func testIdentityIsTheID() {
        let descriptor = ContextMenuItemDescriptor(id: "delete", label: "Delete")
        XCTAssertEqual(descriptor.id, "delete")
    }
}

// MARK: - Open guard (web `openContextMenu` early-return)

final class ContextMenuOpenGuardTests: XCTestCase {
    func testEmptyListIsRefused() {
        XCTAssertFalse(ContextMenuProjector.shouldOpen([]))
    }

    func testPopulatedListOpens() {
        XCTAssertTrue(ContextMenuProjector.shouldOpen([ContextMenuItemDescriptor(id: "a", label: "A")]))
    }

    func testAllDisabledStillOpens() {
        // The web only refuses an EMPTY list; an all-disabled list still opens with non-interactive rows.
        let items = [
            ContextMenuItemDescriptor(id: "a", label: "A", isDisabled: true),
            ContextMenuItemDescriptor(id: "b", label: "B", isDisabled: true)
        ]
        XCTAssertTrue(ContextMenuProjector.shouldOpen(items))
    }
}

// MARK: - Enabled set + keyboard traversal (web focus* helpers)

final class ContextMenuTraversalTests: XCTestCase {
    /// [enabled 0, disabled 1, enabled 2, enabled 3]
    private func mixed() -> [ContextMenuItemDescriptor] {
        [
            ContextMenuItemDescriptor(id: "i0", label: "0"),
            ContextMenuItemDescriptor(id: "i1", label: "1", isDisabled: true),
            ContextMenuItemDescriptor(id: "i2", label: "2"),
            ContextMenuItemDescriptor(id: "i3", label: "3")
        ]
    }

    func testEnabledIndicesSkipDisabled() {
        XCTAssertEqual(ContextMenuProjector.enabledIndices(mixed()), [0, 2, 3])
    }

    func testFirstAndLastEnabled() {
        XCTAssertEqual(ContextMenuProjector.firstEnabledIndex(mixed()), 0)
        XCTAssertEqual(ContextMenuProjector.lastEnabledIndex(mixed()), 3)
    }

    func testFirstAndLastEnabledNilWhenAllDisabled() {
        let allDisabled = [
            ContextMenuItemDescriptor(id: "a", label: "A", isDisabled: true),
            ContextMenuItemDescriptor(id: "b", label: "B", isDisabled: true)
        ]
        XCTAssertNil(ContextMenuProjector.firstEnabledIndex(allDisabled))
        XCTAssertNil(ContextMenuProjector.lastEnabledIndex(allDisabled))
    }

    func testNextFromContainerGoesToFirstOrLast() {
        // From container focus (nil): down -> first enabled, up -> last enabled (web focusFirst/LastEnabled).
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: nil, in: mixed(), step: 1), 0)
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: nil, in: mixed(), step: -1), 3)
    }

    func testNextSkipsDisabledAndWraps() {
        let items = mixed()
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 0, in: items, step: 1), 2)
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 3, in: items, step: 1), 0)
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 2, in: items, step: -1), 0)
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 0, in: items, step: -1), 3)
    }

    func testNextFromDisabledRowFallsBack() {
        // Focus reported on a disabled row (not in the enabled set) falls back to first / last enabled.
        let items = mixed()
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 1, in: items, step: 1), 0)
        XCTAssertEqual(ContextMenuProjector.nextEnabledIndex(after: 1, in: items, step: -1), 3)
    }

    func testNextNilWhenAllDisabled() {
        let allDisabled = [ContextMenuItemDescriptor(id: "a", label: "A", isDisabled: true)]
        XCTAssertNil(ContextMenuProjector.nextEnabledIndex(after: nil, in: allDisabled, step: 1))
    }
}

// MARK: - Placement (web measure-and-flip)

final class ContextMenuPlacementTests: XCTestCase {
    private let container = CGSize(width: 400, height: 600)
    private let menu = CGSize(width: 192, height: 150)

    func testNoFlipWhenItFits() {
        let origin = ContextMenuProjector.place(
            anchor: CGPoint(x: 50, y: 50),
            menuSize: menu,
            containerSize: container
        )
        XCTAssertEqual(origin, CGPoint(x: 50, y: 50))
    }

    func testFlipsLeftWhenRightEdgeOverflows() {
        let origin = ContextMenuProjector.place(
            anchor: CGPoint(x: 350, y: 50),
            menuSize: menu,
            containerSize: container
        )
        XCTAssertEqual(origin, CGPoint(x: 158, y: 50))
    }

    func testFlipsUpWhenBottomEdgeOverflows() {
        let origin = ContextMenuProjector.place(
            anchor: CGPoint(x: 50, y: 550),
            menuSize: CGSize(width: 192, height: 100),
            containerSize: container
        )
        XCTAssertEqual(origin, CGPoint(x: 50, y: 450))
    }

    func testFlipsBothEdges() {
        let origin = ContextMenuProjector.place(
            anchor: CGPoint(x: 380, y: 580),
            menuSize: menu,
            containerSize: container
        )
        XCTAssertEqual(origin, CGPoint(x: 188, y: 430))
    }

    func testClampsToMarginWhenFlippedPastLeadingEdge() {
        // A wide menu flipped left would run past the leading edge -> clamp to the margin (web `max`).
        let origin = ContextMenuProjector.place(
            anchor: CGPoint(x: 100, y: 50),
            menuSize: CGSize(width: 300, height: 100),
            containerSize: CGSize(width: 320, height: 600)
        )
        XCTAssertEqual(origin, CGPoint(x: ContextMenuLayout.viewportMargin, y: 50))
    }
}

// MARK: - Layout metrics

final class ContextMenuLayoutTests: XCTestCase {
    func testWidthBoundsAndMarginAreSane() {
        XCTAssertLessThan(ContextMenuLayout.minWidth, ContextMenuLayout.maxWidth)
        XCTAssertGreaterThan(ContextMenuLayout.viewportMargin, 0)
        XCTAssertEqual(ContextMenuLayout.minWidth, 192)
        XCTAssertEqual(ContextMenuLayout.maxWidth, 320)
    }
}
