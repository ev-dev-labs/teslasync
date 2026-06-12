//
//  Accordion.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the open-state resolution
//  (the verbatim port of the web `open = isControlled ? openProp : internalOpen`), the chevron rotation
//  (web `rotate-180`), the toggle (web `setOpen(!open)`), the projection (body visibility + a11y-expanded),
//  and the value-type equality. Split from Accordion.Tests.swift (the SwiftUI / state-holder half) to keep
//  each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets;
//  the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class AccordionAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(AccordionSurface.slug, "Accordion")
    }
}

// MARK: - Open-state resolution (web `isControlled ? openProp : internalOpen`)

final class AccordionResolvedOpenTests: XCTestCase {
    func testUncontrolledUsesInternalFlag() {
        let input = AccordionInput(title: "T", isControlled: false, controlledOpen: false)
        XCTAssertTrue(AccordionProjector.resolvedOpen(input: input, internalOpen: true))
        XCTAssertFalse(AccordionProjector.resolvedOpen(input: input, internalOpen: false))
    }

    func testControlledUsesPropAndIgnoresInternalFlag() {
        // Web: when controlled, openProp wins and internalOpen is irrelevant.
        let open = AccordionInput(title: "T", isControlled: true, controlledOpen: true)
        XCTAssertTrue(AccordionProjector.resolvedOpen(input: open, internalOpen: false))
        let closed = AccordionInput(title: "T", isControlled: true, controlledOpen: false)
        XCTAssertFalse(AccordionProjector.resolvedOpen(input: closed, internalOpen: true))
    }
}

// MARK: - Chevron rotation + toggle (web `rotate-180` / `setOpen(!open)`)

final class AccordionChevronAndToggleTests: XCTestCase {
    func testChevronRotatesWhenOpen() {
        XCTAssertEqual(AccordionProjector.chevronRotationDegrees(isOpen: true), 180, accuracy: 0.0001)
        XCTAssertEqual(AccordionProjector.chevronRotationDegrees(isOpen: false), 0, accuracy: 0.0001)
    }

    func testNextOpenInverts() {
        XCTAssertTrue(AccordionProjector.nextOpen(current: false))
        XCTAssertFalse(AccordionProjector.nextOpen(current: true))
    }
}

// MARK: - Projection (body visibility + a11y-expanded)

final class AccordionProjectionTests: XCTestCase {
    func testUncontrolledClosedProjection() {
        let projection = AccordionProjector.resolve(
            input: AccordionInput(title: "T"),
            internalOpen: false
        )
        XCTAssertFalse(projection.isOpen)
        XCTAssertFalse(projection.showsBody)
        XCTAssertFalse(projection.accessibilityExpanded)
        XCTAssertEqual(projection.chevronRotationDegrees, 0, accuracy: 0.0001)
    }

    func testUncontrolledOpenProjection() {
        let projection = AccordionProjector.resolve(
            input: AccordionInput(title: "T"),
            internalOpen: true
        )
        XCTAssertTrue(projection.isOpen)
        XCTAssertTrue(projection.showsBody)
        XCTAssertTrue(projection.accessibilityExpanded)
        XCTAssertEqual(projection.chevronRotationDegrees, 180, accuracy: 0.0001)
    }

    func testControlledOpenProjectionIgnoresInternalFlag() {
        let projection = AccordionProjector.resolve(
            input: AccordionInput(title: "T", isControlled: true, controlledOpen: true),
            internalOpen: false
        )
        XCTAssertTrue(projection.isOpen)
        XCTAssertTrue(projection.showsBody)
    }

    func testControlledClosedProjectionIgnoresInternalFlag() {
        let projection = AccordionProjector.resolve(
            input: AccordionInput(title: "T", isControlled: true, controlledOpen: false),
            internalOpen: true
        )
        XCTAssertFalse(projection.isOpen)
        XCTAssertFalse(projection.showsBody)
    }
}

// MARK: - Value-type equality

final class AccordionValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = AccordionInput(
            title: "Charging",
            defaultOpen: true,
            isControlled: true,
            controlledOpen: true,
            hasIcon: true,
            hasBadge: true,
            hasHeaderExtra: false
        )
        let rhs = AccordionInput(
            title: "Charging",
            defaultOpen: true,
            isControlled: true,
            controlledOpen: true,
            hasIcon: true,
            hasBadge: true,
            hasHeaderExtra: false
        )
        XCTAssertEqual(lhs, rhs)
        let other = AccordionInput(
            title: "Charging",
            defaultOpen: true,
            isControlled: true,
            controlledOpen: false,
            hasIcon: true,
            hasBadge: true,
            hasHeaderExtra: false
        )
        XCTAssertNotEqual(lhs, other)
    }

    func testInputEqualityDistinguishesTitleAndRegions() {
        let base = AccordionInput(title: "A", hasIcon: true)
        XCTAssertNotEqual(base, AccordionInput(title: "B", hasIcon: true))
        XCTAssertNotEqual(base, AccordionInput(title: "A", hasIcon: false))
    }

    func testProjectionEquality() {
        let lhs = AccordionProjector.resolve(input: AccordionInput(title: "T"), internalOpen: true)
        let rhs = AccordionProjector.resolve(input: AccordionInput(title: "T"), internalOpen: true)
        XCTAssertEqual(lhs, rhs)
        let other = AccordionProjector.resolve(input: AccordionInput(title: "T"), internalOpen: false)
        XCTAssertNotEqual(lhs, other)
    }
}
