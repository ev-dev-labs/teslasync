//
//  FullscreenButton.Tests.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  Unit coverage for the FullscreenButton surface logic:
//    • Logic — the glyph switch on the fullscreen flag (web `Maximize` / `Minimize`), the label
//      resolution (web `isFs ? exitLabel : enterLabel`), the active-detection (web
//      `el === target || target.contains(el)`), and the `toggle()` decision tree (noop / enter /
//      exit / exit-then-enter).
//    • View-state — the per-state projection the view renders (the deterministic snapshot of the
//      view's inputs in the resting / active / detached / unsupported / custom-label states); the
//      on-screen rendering is covered by the #Preview blocks (precedent: CopyButton 0207).
//    • Accessibility — the spoken-label seam: a non-empty, state-reflecting accessibility label.
//    • i18n facade — the per-surface table resolves each web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  toggle-flow contract is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Pure logic (web glyph / label / active-detection / toggle switch)

@MainActor final class FullscreenButtonLogicTests: XCTestCase {
    func testIconSwitch() {
        XCTAssertEqual(
            FullscreenButtonLogic.iconSystemImage(isFullscreen: false),
            "arrow.up.left.and.arrow.down.right"
        )
        XCTAssertEqual(
            FullscreenButtonLogic.iconSystemImage(isFullscreen: true),
            "arrow.down.right.and.arrow.up.left"
        )
    }

    func testLabelSwitch() {
        XCTAssertEqual(
            FullscreenButtonLogic.label(isFullscreen: false, enterLabel: "Enter", exitLabel: "Exit"),
            "Enter"
        )
        XCTAssertEqual(
            FullscreenButtonLogic.label(isFullscreen: true, enterLabel: "Enter", exitLabel: "Exit"),
            "Exit"
        )
    }

    func testIsActiveRequiresBothTargetAndElement() {
        XCTAssertFalse(
            FullscreenButtonLogic.isActive(targetID: nil, activeTargetID: "a", descendantIDs: []),
            "a nil target is never active (web `target != null`)"
        )
        XCTAssertFalse(
            FullscreenButtonLogic.isActive(targetID: "a", activeTargetID: nil, descendantIDs: []),
            "a nil live element is never active (web `el != null`)"
        )
    }

    func testIsActiveExactMatch() {
        XCTAssertTrue(
            FullscreenButtonLogic.isActive(targetID: "a", activeTargetID: "a", descendantIDs: [])
        )
    }

    func testIsActiveDescendant() {
        XCTAssertTrue(
            FullscreenButtonLogic.isActive(
                targetID: "card",
                activeTargetID: "card.svg",
                descendantIDs: ["card.svg"]
            ),
            "a descendant of the target counts as active (web `target.contains(el)`)"
        )
    }

    func testIsActiveUnrelatedIsFalse() {
        XCTAssertFalse(
            FullscreenButtonLogic.isActive(
                targetID: "a",
                activeTargetID: "b",
                descendantIDs: ["a.child"]
            )
        )
    }

    func testToggleActionNoopWhenTargetNil() {
        XCTAssertEqual(
            FullscreenButtonLogic.toggleAction(targetID: nil, activeTargetID: nil, descendantIDs: []),
            .noop,
            "no target mounted → no-op (web `if (!target) return`)"
        )
    }

    func testToggleActionEnterWhenNothingActive() {
        XCTAssertEqual(
            FullscreenButtonLogic.toggleAction(targetID: "a", activeTargetID: nil, descendantIDs: []),
            .enter
        )
    }

    func testToggleActionExitWhenOursActive() {
        XCTAssertEqual(
            FullscreenButtonLogic.toggleAction(targetID: "a", activeTargetID: "a", descendantIDs: []),
            .exit
        )
    }

    func testToggleActionExitWhenDescendantActive() {
        XCTAssertEqual(
            FullscreenButtonLogic.toggleAction(
                targetID: "card",
                activeTargetID: "card.svg",
                descendantIDs: ["card.svg"]
            ),
            .exit,
            "exiting works when a descendant holds the lock (web contains branch)"
        )
    }

    func testToggleActionExitThenEnterWhenOtherActive() {
        XCTAssertEqual(
            FullscreenButtonLogic.toggleAction(targetID: "a", activeTargetID: "b", descendantIDs: []),
            .exitThenEnter,
            "another element holds the lock → release it first, then request ours (web parity)"
        )
    }
}

// MARK: - View-state projection (per-state snapshot of the view's inputs)

@MainActor final class FullscreenButtonViewStateTests: XCTestCase {
    func testRestingStateRendersExpandGlyphAndEnterLabel() {
        XCTAssertEqual(
            FullscreenButtonLogic.iconSystemImage(isFullscreen: false),
            "arrow.up.left.and.arrow.down.right"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: false, enterOverride: nil, exitOverride: nil),
            "Enter fullscreen"
        )
    }

    func testActiveStateRendersCollapseGlyphAndExitLabel() {
        XCTAssertEqual(
            FullscreenButtonLogic.iconSystemImage(isFullscreen: true),
            "arrow.down.right.and.arrow.up.left"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: true, enterOverride: nil, exitOverride: nil),
            "Exit fullscreen"
        )
    }

    func testSurfaceConstructsForEveryState() {
        // Exercises the view's construction path for the resting, active, custom-label, detached, and
        // unsupported states.
        let resting = FullscreenButton(targetID: "a", presenter: InMemoryFullscreenPresenter())
        let active = FullscreenButton(
            targetID: "a",
            presenter: InMemoryFullscreenPresenter(activeTargetID: "a")
        )
        let labelled = FullscreenButton(
            targetID: "a",
            presenter: InMemoryFullscreenPresenter(),
            ariaLabelEnter: "Expand map",
            ariaLabelExit: "Collapse map"
        )
        let detached = FullscreenButton(targetID: nil, presenter: InMemoryFullscreenPresenter())
        let unsupported = FullscreenButton(
            targetID: "a",
            presenter: InMemoryFullscreenPresenter(isFullscreenSupported: false)
        )
        _ = (resting, active, labelled, detached, unsupported)
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class FullscreenButtonAccessibilityTests: XCTestCase {
    func testAccessibilityLabelIsNeverEmpty() {
        XCTAssertFalse(
            FullscreenButtonStrings.resolvedLabel(
                isFullscreen: false,
                enterOverride: nil,
                exitOverride: nil
            ).isEmpty
        )
    }

    func testAccessibilityLabelReflectsState() {
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: false, enterOverride: nil, exitOverride: nil),
            "Enter fullscreen"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: true, enterOverride: nil, exitOverride: nil),
            "Exit fullscreen"
        )
    }

    func testAccessibilityLabelUsesOverrides() {
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(
                isFullscreen: false,
                enterOverride: "Expand chart",
                exitOverride: "Collapse chart"
            ),
            "Expand chart"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(
                isFullscreen: true,
                enterOverride: "Expand chart",
                exitOverride: "Collapse chart"
            ),
            "Collapse chart"
        )
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class FullscreenButtonStringsTests: XCTestCase {
    func testEveryWebKeyResolvesToItsFallback() {
        XCTAssertEqual(
            FullscreenButtonStrings.string("common.fullscreen.enter", "Enter fullscreen"),
            "Enter fullscreen"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.string("common.fullscreen.exit", "Exit fullscreen"),
            "Exit fullscreen"
        )
    }

    func testLabelHelpersResolveToWebFallbacks() {
        XCTAssertEqual(FullscreenButtonStrings.enterLabel(), "Enter fullscreen")
        XCTAssertEqual(FullscreenButtonStrings.exitLabel(), "Exit fullscreen")
    }

    func testResolvedLabelDefaultsTrackState() {
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: false, enterOverride: nil, exitOverride: nil),
            "Enter fullscreen"
        )
        XCTAssertEqual(
            FullscreenButtonStrings.resolvedLabel(isFullscreen: true, enterOverride: nil, exitOverride: nil),
            "Exit fullscreen"
        )
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(FullscreenButtonStrings.table, "FullscreenButton")
    }
}
