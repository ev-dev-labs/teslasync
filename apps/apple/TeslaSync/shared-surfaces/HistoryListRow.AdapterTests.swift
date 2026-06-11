//
//  HistoryListRow.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  Pure-core coverage for the slot-based history row (the model + view-composition half lives in
//  HistoryListRow.Tests.swift; split to keep each file within the SwiftLint file-length budget). This
//  is the "adapter (cached → projection)" unit test the acceptance calls for: it drives the structural
//  props through ``HistoryListRowProjector`` and asserts the verbatim port of the web `HistoryListRow`
//  render body, plus the value types it is built on:
//    • glow    — raw values, default, all cases (web `'cyan' | 'green' | 'purple' | 'none'`).
//    • kind    — none / link / action (web `href` xor `onClick`).
//    • inputs  — defaults, value equality (the `.onChange` key), action-count clamp.
//    • slug    — the diagnostics identity.
//    • project — slot presence → render flags, chevron, selected, glow passthrough, a11y traits.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - HistoryListRowSurface (diagnostics identity)

final class HistoryListRowSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(HistoryListRowSurface.slug, "HistoryListRow")
    }
}

// MARK: - HistoryListRowGlow (web glow union)

final class HistoryListRowGlowTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(HistoryListRowGlow.cyan.rawValue, "cyan")
        XCTAssertEqual(HistoryListRowGlow.green.rawValue, "green")
        XCTAssertEqual(HistoryListRowGlow.purple.rawValue, "purple")
        XCTAssertEqual(HistoryListRowGlow.none.rawValue, "none")
    }

    func testDefaultIsCyan() {
        XCTAssertEqual(HistoryListRowGlow.defaultGlow, .cyan, "web `glow = 'cyan'`")
    }

    func testAllCases() {
        XCTAssertEqual(Set(HistoryListRowGlow.allCases), [.cyan, .green, .purple, .none])
    }
}

// MARK: - HistoryListRowActivationKind (web href / onClick / neither)

final class HistoryListRowActivationKindTests: XCTestCase {
    func testRawValues() {
        XCTAssertEqual(HistoryListRowActivationKind.none.rawValue, "none")
        XCTAssertEqual(HistoryListRowActivationKind.link.rawValue, "link")
        XCTAssertEqual(HistoryListRowActivationKind.action.rawValue, "action")
    }

    func testAllCases() {
        XCTAssertEqual(Set(HistoryListRowActivationKind.allCases), [.none, .link, .action])
    }
}

// MARK: - HistoryListRowInputs (the `.onChange` key)

final class HistoryListRowInputsTests: XCTestCase {
    func testDefaults() {
        let inputs = HistoryListRowInputs()
        XCTAssertEqual(inputs.glow, .cyan)
        XCTAssertFalse(inputs.selected)
        XCTAssertFalse(inputs.hideChevron)
        XCTAssertEqual(inputs.activationKind, .none)
        XCTAssertNil(inputs.href)
        XCTAssertFalse(inputs.hasCheckbox)
        XCTAssertFalse(inputs.hasLeading)
        XCTAssertFalse(inputs.hasRoute)
        XCTAssertFalse(inputs.hasMetrics)
        XCTAssertFalse(inputs.hasInsight)
        XCTAssertEqual(inputs.actionCount, 0)
    }

    func testActionCountClampsNegative() {
        XCTAssertEqual(HistoryListRowInputs(actionCount: -3).actionCount, 0)
        XCTAssertEqual(HistoryListRowInputs(actionCount: 2).actionCount, 2)
    }

    func testEquality() {
        let base = HistoryListRowInputs(glow: .green, selected: true, activationKind: .link, href: "/d/1")
        XCTAssertEqual(base, HistoryListRowInputs(
            glow: .green, selected: true, activationKind: .link, href: "/d/1"
        ))
        XCTAssertNotEqual(base, HistoryListRowInputs(
            glow: .cyan, selected: true, activationKind: .link, href: "/d/1"
        ))
        XCTAssertNotEqual(base, HistoryListRowInputs(
            glow: .green, selected: false, activationKind: .link, href: "/d/1"
        ))
        XCTAssertNotEqual(base, HistoryListRowInputs(
            glow: .green, selected: true, activationKind: .link, href: "/d/2"
        ))
    }

    func testSlotPresenceParticipatesInEquality() {
        let withRoute = HistoryListRowInputs(hasRoute: true)
        XCTAssertNotEqual(withRoute, HistoryListRowInputs(hasRoute: false))
        XCTAssertNotEqual(HistoryListRowInputs(actionCount: 1), HistoryListRowInputs(actionCount: 2))
    }
}

// MARK: - HistoryListRowProjector (web `HistoryListRow` render body)

final class HistoryListRowProjectorTests: XCTestCase {
    func testInertMinimalRow() {
        let projection = HistoryListRowProjector.resolve(inputs: HistoryListRowInputs())
        XCTAssertFalse(projection.isNavigable)
        XCTAssertEqual(projection.activationKind, .none)
        XCTAssertNil(projection.href)
        XCTAssertFalse(projection.showsCheckbox)
        XCTAssertFalse(projection.showsLeading)
        XCTAssertFalse(projection.showsRoute)
        XCTAssertFalse(projection.showsMetrics)
        XCTAssertFalse(projection.showsInsight)
        XCTAssertFalse(projection.showsActions)
        XCTAssertEqual(projection.actionCount, 0)
        XCTAssertTrue(projection.showsChevron, "web `!hideChevron` defaults to shown")
        XCTAssertFalse(projection.accessibilityIsButton)
        XCTAssertFalse(projection.accessibilityIsLink)
    }

    func testSlotPresenceDrivesRenderFlags() {
        let inputs = HistoryListRowInputs(
            hasCheckbox: true, hasLeading: true, hasRoute: true,
            hasMetrics: true, hasInsight: true, actionCount: 3
        )
        let projection = HistoryListRowProjector.resolve(inputs: inputs)
        XCTAssertTrue(projection.showsCheckbox)
        XCTAssertTrue(projection.showsLeading)
        XCTAssertTrue(projection.showsRoute)
        XCTAssertTrue(projection.showsMetrics)
        XCTAssertTrue(projection.showsInsight)
        XCTAssertTrue(projection.showsActions)
        XCTAssertEqual(projection.actionCount, 3)
    }

    func testZeroActionsHidesOverlay() {
        let projection = HistoryListRowProjector.resolve(inputs: HistoryListRowInputs(actionCount: 0))
        XCTAssertFalse(projection.showsActions, "web `actions && actions.length > 0`")
    }

    func testHideChevron() {
        let projection = HistoryListRowProjector.resolve(inputs: HistoryListRowInputs(hideChevron: true))
        XCTAssertFalse(projection.showsChevron)
    }

    func testSelectedAndGlowPassThrough() {
        let inputs = HistoryListRowInputs(glow: .purple, selected: true)
        let projection = HistoryListRowProjector.resolve(inputs: inputs)
        XCTAssertTrue(projection.isSelected)
        XCTAssertEqual(projection.glow, .purple)
    }

    func testLinkActivationIsLinkTraitAndCarriesHref() {
        let inputs = HistoryListRowInputs(activationKind: .link, href: "/drives/42")
        let projection = HistoryListRowProjector.resolve(inputs: inputs)
        XCTAssertTrue(projection.isNavigable)
        XCTAssertEqual(projection.href, "/drives/42")
        XCTAssertTrue(projection.accessibilityIsLink)
        XCTAssertFalse(projection.accessibilityIsButton)
    }

    func testActionActivationIsButtonTraitAndDropsHref() {
        let inputs = HistoryListRowInputs(activationKind: .action, href: "/ignored")
        let projection = HistoryListRowProjector.resolve(inputs: inputs)
        XCTAssertTrue(projection.isNavigable)
        XCTAssertNil(projection.href, "href is only meaningful for the link kind")
        XCTAssertTrue(projection.accessibilityIsButton)
        XCTAssertFalse(projection.accessibilityIsLink)
    }

    func testProjectionIsEquatableForIdenticalInputs() {
        let inputs = HistoryListRowInputs(glow: .green, selected: true, hasLeading: true, actionCount: 2)
        XCTAssertEqual(
            HistoryListRowProjector.resolve(inputs: inputs),
            HistoryListRowProjector.resolve(inputs: inputs)
        )
    }
}
