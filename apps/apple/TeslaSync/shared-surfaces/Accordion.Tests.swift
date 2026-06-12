//
//  Accordion.Tests.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in Accordion.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • AccordionModel — the once-only `view.opened`, the `internalOpen` seeding from `defaultOpen`, the
//      uncontrolled toggle / setOpen flipping the local flag, the controlled toggle / setOpen routing to
//      `onOpenChange` WITHOUT mutating the local flag, and the props update (controlled re-derive +
//      initial-only `defaultOpen` that never reseeds).
//    • AccordionMotion — the toggle animation is nil under reduced motion and present otherwise.
//    • Views — the public surface + the subviews compose in every real branch.
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - AccordionModel (interaction state + routing)

@MainActor
final class AccordionModelTests: XCTestCase {
    private func model(
        _ input: AccordionInput,
        onOpenChange: (@MainActor (Bool) -> Void)? = nil,
        telemetry: AccordionTelemetry = OSLogAccordionTelemetry()
    ) -> AccordionModel {
        AccordionModel(input: input, onOpenChange: onOpenChange, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(AccordionInput(title: "T"), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [AccordionSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(AccordionInput(title: "T"), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [AccordionSurface.slug], "view.opened fires once per instance")
    }

    func testInitSeedsInternalOpenFromDefaultOpen() {
        XCTAssertFalse(model(AccordionInput(title: "T", defaultOpen: false)).internalOpen)
        XCTAssertTrue(model(AccordionInput(title: "T", defaultOpen: true)).internalOpen)
    }

    func testUncontrolledToggleFlipsInternalOpen() {
        let holder = model(AccordionInput(title: "T", defaultOpen: false))
        XCTAssertFalse(holder.isOpen)
        holder.toggle()
        XCTAssertTrue(holder.internalOpen)
        XCTAssertTrue(holder.isOpen)
        holder.toggle()
        XCTAssertFalse(holder.internalOpen)
    }

    func testUncontrolledSetOpen() {
        let holder = model(AccordionInput(title: "T"))
        holder.setOpen(true)
        XCTAssertTrue(holder.internalOpen)
        holder.setOpen(false)
        XCTAssertFalse(holder.internalOpen)
    }

    func testControlledToggleRoutesToOnOpenChangeWithoutMutatingLocal() {
        let recorder = OpenChangeRecorder()
        let holder = model(
            AccordionInput(title: "T", isControlled: true, controlledOpen: false),
            onOpenChange: { recorder.record($0) }
        )
        holder.toggle()
        XCTAssertEqual(recorder.values, [true], "web setOpen routes !open out through onOpenChange")
        XCTAssertFalse(holder.internalOpen, "controlled mode never mutates the local flag")
    }

    func testControlledSetOpenRoutesToOnOpenChange() {
        let recorder = OpenChangeRecorder()
        let holder = model(
            AccordionInput(title: "T", isControlled: true, controlledOpen: true),
            onOpenChange: { recorder.record($0) }
        )
        holder.setOpen(false)
        XCTAssertEqual(recorder.values, [false])
        XCTAssertFalse(holder.internalOpen)
    }

    func testUpdateRefreshesControlledOpenAndReDerivesProjection() {
        let holder = model(AccordionInput(title: "T", isControlled: true, controlledOpen: false))
        XCTAssertFalse(holder.isOpen)
        holder.update(AccordionInput(title: "T", isControlled: true, controlledOpen: true), onOpenChange: nil)
        XCTAssertTrue(holder.isOpen)
        XCTAssertTrue(holder.projection.showsBody)
    }

    func testUpdateDoesNotReseedInternalOpenFromDefaultOpen() {
        // defaultOpen is initial-only (web useState): once the user collapses, a re-render must not reopen.
        let holder = model(AccordionInput(title: "T", defaultOpen: true))
        XCTAssertTrue(holder.internalOpen)
        holder.toggle()
        XCTAssertFalse(holder.internalOpen)
        holder.update(AccordionInput(title: "T", defaultOpen: true), onOpenChange: nil)
        XCTAssertFalse(holder.internalOpen, "a re-render with defaultOpen=true does not reopen the section")
    }
}

// MARK: - AccordionMotion (toggle animation honors Reduce Motion)

final class AccordionMotionTests: XCTestCase {
    func testToggleAnimationNilUnderReducedMotion() {
        XCTAssertNil(AccordionMotion.toggle(reduce: true))
    }

    func testToggleAnimationPresentWhenMotionAllowed() {
        XCTAssertNotNil(AccordionMotion.toggle(reduce: false))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class AccordionViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = Accordion(title: "T") { Text(verbatim: "body") }
        _ = Accordion(title: "T", defaultOpen: true) { Text(verbatim: "body") }
        _ = Accordion(title: "T", open: true, onOpenChange: { _ in }, content: { Text(verbatim: "body") })
        _ = Accordion(
            title: "T",
            defaultOpen: true,
            icon: { Image(systemName: "bell") },
            badge: { Text(verbatim: "3") },
            headerExtra: { Image(systemName: "gear") },
            content: { Text(verbatim: "body") }
        )
        _ = Accordion(title: "T", defaultOpen: true) { AccordionEmptyBody() }
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = AccordionModel(
            input: AccordionInput(title: "Charging", defaultOpen: true),
            telemetry: SpyTelemetry()
        )
        _ = Accordion(model: injected) { Text(verbatim: "body") }
        XCTAssertEqual(Accordion<Text, EmptyView, EmptyView, EmptyView>.surfaceSlug, "Accordion")
    }

    func testSubviewsCompose() {
        let holder = AccordionModel(
            input: AccordionInput(title: "T", hasIcon: true, hasBadge: true, hasHeaderExtra: true)
        )
        _ = AccordionHeader(
            model: holder,
            icon: Image(systemName: "bell"),
            badge: Text(verbatim: "3"),
            headerExtra: Image(systemName: "gear"),
            onToggle: {}
        )
        _ = AccordionBody(content: Text(verbatim: "body"))
        _ = AccordionEmptyBody()
    }
}

// MARK: - Strings facade (P1/S10)

final class AccordionStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(AccordionStrings.expandHint, "Expand section")
        XCTAssertEqual(AccordionStrings.collapseHint, "Collapse section")
        XCTAssertEqual(AccordionStrings.expandedValue, "Expanded")
        XCTAssertEqual(AccordionStrings.collapsedValue, "Collapsed")
        XCTAssertEqual(AccordionStrings.emptyTitle, "No details to show")
        XCTAssertEqual(AccordionStrings.emptyMessage, "Details appear here when they become available.")
    }

    func testToggleHintAndStateValueTrackOpenState() {
        XCTAssertEqual(AccordionStrings.toggleHint(isOpen: true), "Collapse section")
        XCTAssertEqual(AccordionStrings.toggleHint(isOpen: false), "Expand section")
        XCTAssertEqual(AccordionStrings.stateValue(isOpen: true), "Expanded")
        XCTAssertEqual(AccordionStrings.stateValue(isOpen: false), "Collapsed")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: AccordionTelemetry, @unchecked Sendable {
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

/// Records the open-state requests routed out through `onOpenChange` in controlled mode (the `@MainActor`
/// page-closure seam).
@MainActor
private final class OpenChangeRecorder {
    private(set) var values: [Bool] = []

    func record(_ value: Bool) {
        values.append(value)
    }
}
