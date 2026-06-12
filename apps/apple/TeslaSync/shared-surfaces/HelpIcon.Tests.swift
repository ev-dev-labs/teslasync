//
//  HelpIcon.Tests.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in HelpIcon.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • HelpIconModel — the once-only `view.opened`, the present / dismiss flipping `isPresented`, the
//      projection reflecting the props through the injected resolver, the props update (re-derive + no
//      spurious reassign), and the `hasContent` gate (web `return null`).
//    • Views — the public surface + the subviews compose in every real branch (content, per-field, each
//      side, injected model, and the absent branch that renders nothing).
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - HelpIconModel (interaction state + telemetry)

@MainActor
final class HelpIconModelTests: XCTestCase {
    private func model(
        _ input: HelpIconInput,
        telemetry: HelpIconTelemetry = OSLogHelpIconTelemetry()
    ) -> HelpIconModel {
        HelpIconModel(input: input, resolve: { _, fallback in fallback }, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(HelpIconInput(content: "Help"), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [HelpIconSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(HelpIconInput(content: "Help"), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [HelpIconSurface.slug], "view.opened fires once per instance")
    }

    func testPresentAndDismissFlipIsPresented() {
        let holder = model(HelpIconInput(content: "Help"))
        XCTAssertFalse(holder.isPresented)
        holder.present()
        XCTAssertTrue(holder.isPresented)
        holder.dismiss()
        XCTAssertFalse(holder.isPresented)
    }

    func testProjectionReflectsInput() {
        let holder = model(HelpIconInput(content: "Energy lost while parked.", forID: "Vampire drain"))
        XCTAssertTrue(holder.hasContent)
        XCTAssertEqual(holder.projection.text, "Energy lost while parked.")
        XCTAssertEqual(holder.projection.accessibilityLabel, "Help for Vampire drain")
        XCTAssertEqual(holder.projection.describedByID, "Vampire drain-help")
    }

    func testHasContentFalseForAbsentText() {
        XCTAssertFalse(model(HelpIconInput()).hasContent)
    }

    func testUpdateReassignsInputAndReDerives() {
        let holder = model(HelpIconInput(content: "First"))
        XCTAssertEqual(holder.projection.text, "First")
        holder.update(HelpIconInput(content: "Second", side: .bottom))
        XCTAssertEqual(holder.input.content, "Second")
        XCTAssertEqual(holder.projection.text, "Second")
        XCTAssertEqual(holder.projection.side, .bottom)
    }

    func testUpdateWithIdenticalInputKeepsState() {
        let holder = model(HelpIconInput(content: "Same"))
        holder.present()
        holder.update(HelpIconInput(content: "Same"))
        XCTAssertTrue(holder.isPresented, "an identical-prop re-render does not disturb the open state")
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class HelpIconViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = HelpIcon(content: "Plain help")
        _ = HelpIcon(i18nKey: "help.key", content: "Fallback")
        _ = HelpIcon(content: "Field help", for: "Battery")
        _ = HelpIcon(content: "Placed help", side: .leading)
        _ = HelpIcon(content: "x", ariaLabel: "Custom label")
        _ = HelpIcon()
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = HelpIconModel(
            input: HelpIconInput(content: "Injected", forID: "Regen"),
            resolve: { _, fallback in fallback },
            telemetry: SpyTelemetry()
        )
        _ = HelpIcon(model: injected)
        XCTAssertEqual(HelpIcon.surfaceSlug, "HelpIcon")
    }

    func testSubviewsCompose() {
        let holder = HelpIconModel(
            input: HelpIconInput(content: "Body", forID: "Speed", side: .trailing),
            resolve: { _, fallback in fallback }
        )
        _ = HelpIconTrigger(model: holder)
        _ = HelpIconPopover(text: "Body", describedByID: "Speed-help")
        _ = HelpIconPopover(text: "Body", describedByID: nil)
    }

    func testSideArrowEdgeMapping() {
        XCTAssertEqual(HelpIconSide.top.arrowEdge, .top)
        XCTAssertEqual(HelpIconSide.bottom.arrowEdge, .bottom)
        XCTAssertEqual(HelpIconSide.leading.arrowEdge, .leading)
        XCTAssertEqual(HelpIconSide.trailing.arrowEdge, .trailing)
    }
}

// MARK: - Strings facade (P1/S10)

final class HelpIconStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(HelpIconStrings.openHint, "Shows help")
    }

    func testResolveClosureReturnsFallbackForUnknownKey() {
        XCTAssertEqual(HelpIconStrings.resolve("totally.unknown.key", "Fallback value"), "Fallback value")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: HelpIconTelemetry, @unchecked Sendable {
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
