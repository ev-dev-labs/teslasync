//
//  StickyChipBar.Tests.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in StickyChipBar.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • StickyChipBarModel — the once-only `view.opened`, the seeded / defaulted active id, the routed tap
//      (set active + page `onSelect`, and the re-tap-while-active still scrolls), the passive scroll-spy
//      report (active update WITHOUT `onSelect`), the unknown-id guards, and the props/active-id update
//      re-validation.
//    • Views — the public surface + the subviews compose in every branch (populated / scroll-spy fed /
//      empty / injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StickyChipBarModel (interaction state + routing)

@MainActor
final class StickyChipBarModelTests: XCTestCase {
    private func chips(_ count: Int) -> [SectionChip] {
        (0 ..< count).map { SectionChip(id: "s\($0)", label: "Section \($0)") }
    }

    private func model(
        _ input: StickyChipBarInput,
        onSelect: (@MainActor (String) -> Void)? = nil,
        telemetry: StickyChipBarTelemetry = OSLogStickyChipBarTelemetry(),
        initialActiveID: String? = nil
    ) -> StickyChipBarModel {
        StickyChipBarModel(
            input: input,
            onSelect: onSelect,
            telemetry: telemetry,
            initialActiveID: initialActiveID
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(StickyChipBarInput(chips: chips(2)), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StickyChipBarSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(StickyChipBarInput(chips: chips(1)), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StickyChipBarSurface.slug], "view.opened fires once per instance")
    }

    func testInitialActiveIDDefaultsToFirstChip() {
        let holder = model(StickyChipBarInput(chips: chips(3)))
        XCTAssertEqual(holder.activeID, "s0")
    }

    func testInitialActiveIDHonorsSeed() {
        let holder = model(StickyChipBarInput(chips: chips(3)), initialActiveID: "s2")
        XCTAssertEqual(holder.activeID, "s2")
        XCTAssertTrue(holder.isActive("s2"))
        XCTAssertFalse(holder.isActive("s0"))
    }

    func testSelectSetsActiveAndInvokesOnSelect() {
        let recorder = SelectRecorder()
        let holder = model(StickyChipBarInput(chips: chips(3)), onSelect: { recorder.record($0) })
        holder.select("s1")
        XCTAssertEqual(holder.activeID, "s1")
        XCTAssertEqual(recorder.ids, ["s1"])
    }

    func testSelectReinvokesOnSelectWhenAlreadyActive() {
        // Web `handleClick` always scrolls, even when the chip is already active.
        let recorder = SelectRecorder()
        let holder = model(StickyChipBarInput(chips: chips(3)), onSelect: { recorder.record($0) })
        holder.select("s0")
        holder.select("s0")
        XCTAssertEqual(recorder.ids, ["s0", "s0"])
        XCTAssertEqual(holder.activeID, "s0")
    }

    func testSelectIgnoresUnknownID() {
        let recorder = SelectRecorder()
        let holder = model(StickyChipBarInput(chips: chips(2)), onSelect: { recorder.record($0) })
        holder.select("missing")
        XCTAssertEqual(holder.activeID, "s0")
        XCTAssertTrue(recorder.ids.isEmpty)
    }

    func testReportVisibleSectionUpdatesActive() {
        let holder = model(StickyChipBarInput(chips: chips(4)))
        holder.reportVisibleSection("s2")
        XCTAssertEqual(holder.activeID, "s2")
    }

    func testReportVisibleSectionIgnoresUnknownID() {
        let holder = model(StickyChipBarInput(chips: chips(2)))
        holder.reportVisibleSection("missing")
        XCTAssertEqual(holder.activeID, "s0")
    }

    func testReportVisibleSectionDoesNotInvokeOnSelect() {
        // Passive observation (web IntersectionObserver) must not trigger the page scroll closure.
        let recorder = SelectRecorder()
        let holder = model(StickyChipBarInput(chips: chips(3)), onSelect: { recorder.record($0) })
        holder.reportVisibleSection("s1")
        XCTAssertEqual(holder.activeID, "s1")
        XCTAssertTrue(recorder.ids.isEmpty)
    }

    func testUpdateRevalidatesActiveIDWhenSectionRemoved() {
        let holder = model(StickyChipBarInput(chips: chips(4)))
        holder.select("s3")
        XCTAssertEqual(holder.activeID, "s3")
        // Rebind with a set that no longer contains s3 → active falls back to the new first chip.
        holder.update(StickyChipBarInput(chips: chips(2)), onSelect: nil)
        XCTAssertEqual(holder.projection.chips.count, 2)
        XCTAssertEqual(holder.activeID, "s0")
    }

    func testUpdateKeepsValidActiveID() {
        let holder = model(StickyChipBarInput(chips: chips(4)))
        holder.select("s2")
        holder.update(StickyChipBarInput(chips: chips(4), topOffset: 16), onSelect: nil)
        XCTAssertEqual(holder.activeID, "s2")
        XCTAssertEqual(holder.input.topOffset, 16)
    }

    func testProjectionReflectsInput() {
        let holder = model(StickyChipBarInput(chips: chips(5)))
        XCTAssertFalse(holder.projection.isEmpty)
        XCTAssertEqual(holder.projection.chips.count, 5)
        XCTAssertEqual(holder.projection.defaultActiveID, "s0")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class StickyChipBarViewTests: XCTestCase {
    private func chips(_ count: Int) -> [SectionChip] {
        (0 ..< count).map { SectionChip(id: "s\($0)", label: "Section \($0)") }
    }

    func testSurfaceComposesForEveryBranch() {
        _ = StickyChipBar(chips: chips(4))
        _ = StickyChipBar(chips: chips(9), onSelect: { _ in })
        _ = StickyChipBar(chips: chips(5), topOffset: 24, visibleSectionID: "s2")
        _ = StickyChipBar(chips: [])
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = StickyChipBarModel(
            input: StickyChipBarInput(chips: chips(3)),
            telemetry: SpyTelemetry(),
            initialActiveID: "s1"
        )
        _ = StickyChipBar(model: injected)
        XCTAssertEqual(StickyChipBar.surfaceSlug, "StickyChipBar")
    }

    func testSubviewsCompose() {
        let chip = SectionChip(id: "battery", label: "Battery")
        _ = SectionChipView(chip: chip, isActive: true, hint: "Jumps to section") {}
        _ = SectionChipView(chip: chip, isActive: false, hint: "Jumps to section") {}
        _ = StickyChipBarEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class StickyChipBarStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(StickyChipBarStrings.jumpToSection, "Jump to section")
        XCTAssertEqual(StickyChipBarStrings.empty, "No sections")
        XCTAssertEqual(StickyChipBarStrings.chipHint, "Jumps to section")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: StickyChipBarTelemetry, @unchecked Sendable {
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

/// Records the ids routed through the page-supplied `onSelect` (the `@MainActor` scroll closure).
@MainActor
private final class SelectRecorder {
    private(set) var ids: [String] = []

    func record(_ id: String) {
        ids.append(id)
    }
}
