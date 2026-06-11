//
//  ActiveFilterChips.Tests.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in ActiveFilterChips.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ActiveFilterChipsModel — the once-only `view.opened`, the props/closures update guard + overflow
//      auto-collapse, the routed removal (announce + page `onRemove` + last-overflow close), the routed
//      clear-all (announce + page `onClearAll`), and the overflow toggle.
//    • Views — the public surface + the subviews compose in every branch (populated / overflow / empty /
//      all-collapsed / injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks + interpolation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ActiveFilterChipsModel (interaction state + routing)

@MainActor
final class ActiveFilterChipsModelTests: XCTestCase {
    private func descriptors(_ count: Int) -> [FilterChipDescriptor] {
        (0 ..< count).map { FilterChipDescriptor(id: "k\($0)", label: "L\($0)", value: "V\($0)") }
    }

    private func model(
        _ input: ActiveFilterChipsInput,
        handlers: [String: @MainActor () -> Void] = [:],
        onClearAll: (@MainActor () -> Void)? = nil,
        telemetry: ActiveFilterChipsTelemetry = OSLogActiveFilterChipsTelemetry(),
        announcer: ActiveFilterChipsAnnouncer = OSLogActiveFilterChipsAnnouncer()
    ) -> ActiveFilterChipsModel {
        ActiveFilterChipsModel(
            input: input,
            removeHandlers: handlers,
            onClearAll: onClearAll,
            telemetry: telemetry,
            announcer: announcer
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(ActiveFilterChipsInput(filters: descriptors(2)), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ActiveFilterChipsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(ActiveFilterChipsInput(filters: descriptors(1)), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ActiveFilterChipsSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let holder = model(ActiveFilterChipsInput(filters: descriptors(5), hasClearAll: true, maxVisible: 2))
        XCTAssertEqual(holder.projection.visible.count, 1)
        XCTAssertEqual(holder.projection.overflow.count, 4)
        XCTAssertTrue(holder.projection.showsClearAll)
    }

    func testRemoveInvokesKeyedHandlerAndAnnounces() {
        let counter = Counter()
        let announcer = SpyAnnouncer()
        let holder = model(
            ActiveFilterChipsInput(filters: descriptors(2)),
            handlers: ["k0": { counter.bump() }],
            announcer: announcer
        )
        holder.remove(FilterChipDescriptor(id: "k0", label: "Vehicle", value: "Model 3"))
        XCTAssertEqual(counter.count, 1)
        XCTAssertTrue(holder.announcement.hasPrefix("Filter removed: Vehicle"))
        XCTAssertEqual(announcer.messages.count, 1)
        XCTAssertEqual(announcer.messages.first, holder.announcement)
    }

    func testRemoveClosesPopoverWhenLastOverflowChip() {
        // maxVisible 0 + a single filter → exactly one overflow chip (web `overflow.length === 1`).
        let holder = model(ActiveFilterChipsInput(filters: descriptors(1), maxVisible: 0))
        holder.setOverflowOpen(true)
        holder.remove(FilterChipDescriptor(id: "k0", label: "L0", value: "V0"))
        XCTAssertFalse(holder.overflowOpen)
    }

    func testClearAllInvokesHandlerAndAnnounces() {
        let counter = Counter()
        let announcer = SpyAnnouncer()
        let holder = model(
            ActiveFilterChipsInput(filters: descriptors(2), hasClearAll: true),
            onClearAll: { counter.bump() },
            announcer: announcer
        )
        holder.clearAll()
        XCTAssertEqual(counter.count, 1)
        XCTAssertTrue(holder.announcement.hasPrefix("All filters cleared"))
        XCTAssertEqual(announcer.messages.count, 1)
    }

    func testClearAllIsNoOpWithoutHandler() {
        let announcer = SpyAnnouncer()
        let holder = model(ActiveFilterChipsInput(filters: descriptors(2)), announcer: announcer)
        holder.clearAll()
        XCTAssertEqual(holder.announcement, "")
        XCTAssertTrue(announcer.messages.isEmpty)
    }

    func testToggleAndSetOverflow() {
        let holder = model(ActiveFilterChipsInput(filters: descriptors(9), maxVisible: 3))
        XCTAssertFalse(holder.overflowOpen)
        holder.toggleOverflow()
        XCTAssertTrue(holder.overflowOpen)
        holder.setOverflowOpen(false)
        XCTAssertFalse(holder.overflowOpen)
    }

    func testUpdateRefreshesPropsAndAutoCollapsesOverflow() {
        let holder = model(ActiveFilterChipsInput(filters: descriptors(9), maxVisible: 3))
        holder.setOverflowOpen(true)
        // Rebind with few enough filters that nothing overflows → popover collapses.
        holder.update(
            ActiveFilterChipsInput(filters: descriptors(2), maxVisible: 3),
            removeHandlers: [:],
            onClearAll: nil
        )
        XCTAssertEqual(holder.projection.visible.count, 2)
        XCTAssertFalse(holder.projection.partition.hasOverflow)
        XCTAssertFalse(holder.overflowOpen)
    }

    func testAnnouncementPaddingRotatesAcrossRemovals() {
        let holder = model(ActiveFilterChipsInput(filters: descriptors(4)))
        var lengths: [Int] = []
        for index in 0 ..< 4 {
            holder.remove(FilterChipDescriptor(id: "k\(index)", label: "L", value: "V"))
            lengths.append(holder.announcement.count)
        }
        // Distinct trailing padding forces the assistive technology to re-read identical messages.
        XCTAssertEqual(Set(lengths).count, 4, "rotating zero-width padding yields four distinct lengths")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ActiveFilterChipsViewTests: XCTestCase {
    private func chips(_ count: Int) -> [ActiveFilterChip] {
        (0 ..< count).map { ActiveFilterChip(id: "k\($0)", label: "L\($0)", value: "V\($0)") {} }
    }

    func testSurfaceComposesForEveryBranch() {
        _ = ActiveFilterChips(filters: chips(3))
        _ = ActiveFilterChips(filters: chips(9), onClearAll: {}, maxVisible: 4)
        _ = ActiveFilterChips(filters: chips(2), onClearAll: {}, maxVisible: 0)
        _ = ActiveFilterChips(filters: [], onClearAll: {}, hideWhenEmpty: false)
        _ = ActiveFilterChips(filters: [])
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = ActiveFilterChipsModel(
            input: ActiveFilterChipsInput(filters: [FilterChipDescriptor(id: "v", label: "Vehicle", value: "M3")]),
            telemetry: SpyTelemetry()
        )
        _ = ActiveFilterChips(model: injected)
        XCTAssertEqual(ActiveFilterChips.surfaceSlug, "ActiveFilterChips")
    }

    func testSubviewsCompose() {
        let holder = ActiveFilterChipsModel(input: ActiveFilterChipsInput(filters: [], maxVisible: 0))
        let descriptor = FilterChipDescriptor(id: "v", label: "Vehicle", value: "Model 3")
        _ = FilterChipView(descriptor: descriptor, removeLabel: "Remove filter Vehicle") {}
        _ = FilterChipView(descriptor: descriptor, removeLabel: "Remove filter Vehicle", fullWidth: true) {}
        _ = ActiveFilterChipsOverflowControl(model: holder, overflow: [descriptor])
        _ = ActiveFilterChipsClearAllButton(model: holder)
        _ = ActiveFilterChipsEmptyView()
        _ = LiveActiveFilterChipsAnnouncer()
    }
}

// MARK: - Strings facade (P1/S10)

final class ActiveFilterChipsStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(ActiveFilterChipsStrings.activeLabel, "Active filters")
        XCTAssertEqual(ActiveFilterChipsStrings.clearAll, "Clear all")
        XCTAssertEqual(ActiveFilterChipsStrings.moreLabel, "Additional active filters")
        XCTAssertEqual(ActiveFilterChipsStrings.empty, "No active filters")
    }

    func testInterpolatedFallbacks() {
        XCTAssertEqual(ActiveFilterChipsStrings.moreCount(4), "+4 more")
        XCTAssertEqual(ActiveFilterChipsStrings.removeAria(label: "Vehicle"), "Remove filter Vehicle")
    }

    func testAnnouncementFallbacks() {
        XCTAssertTrue(ActiveFilterChipsStrings.removedAnnouncement(label: "State", sequence: 0)
            .hasPrefix("Filter removed: State"))
        XCTAssertTrue(ActiveFilterChipsStrings.clearedAllAnnouncement(sequence: 0)
            .hasPrefix("All filters cleared"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: ActiveFilterChipsTelemetry, @unchecked Sendable {
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

/// Records the polite announcements the model posts (the `@MainActor` announcement seam).
@MainActor
private final class SpyAnnouncer: ActiveFilterChipsAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}

/// A `@MainActor` counter for the routed `onRemove` / `onClearAll` forwarding tests.
@MainActor
private final class Counter {
    private(set) var count = 0
    func bump() {
        count += 1
    }
}
