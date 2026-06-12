//
//  PillFilterBar.Tests.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in PillFilterBar.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • PillFilterBarModel — the once-only `view.opened`, the props/closure update guard + stale-focus
//      clear, the guarded selection (disabled / unknown key is inert), the arrow / Home / End travel
//      (onChange + roving focus), and the projection read.
//    • Views — the public surface composes in every branch (pills / tabs / disabled / scrollable / empty /
//      injected-model), and the accent style + empty view build for every accent.
//    • Strings — the empty state resolves through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - PillFilterBarModel (interaction state + routing)

@MainActor
final class PillFilterBarModelTests: XCTestCase {
    private func items(_ count: Int) -> [PillItem] {
        (0 ..< count).map { PillItem(key: "k\($0)", label: "L\($0)") }
    }

    private func model(
        _ input: PillFilterBarInput,
        onChange: (@MainActor (String) -> Void)? = nil,
        telemetry: PillFilterBarTelemetry = OSLogPillFilterBarTelemetry()
    ) -> PillFilterBarModel {
        PillFilterBarModel(input: input, onChange: onChange, telemetry: telemetry)
    }

    private func input(_ pills: [PillItem], active: String, variant: PillVariant = .pills) -> PillFilterBarInput {
        PillFilterBarInput(items: pills, activeKey: active, ariaLabel: "Filter", variant: variant)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(input(items(3), active: "k0"), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [PillFilterBarSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(input(items(2), active: "k0"), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [PillFilterBarSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let holder = model(input(items(3), active: "k2"))
        XCTAssertEqual(holder.projection.pills.count, 3)
        XCTAssertEqual(holder.projection.activeKey, "k2")
        XCTAssertTrue(holder.projection.pills[2].isSelected)
    }

    func testSelectInvokesOnChangeForEnabledKey() {
        let recorder = KeyRecorder()
        let holder = model(input(items(3), active: "k0"), onChange: { recorder.record($0) })
        holder.select("k1")
        XCTAssertEqual(recorder.keys, ["k1"])
    }

    func testSelectIsNoOpForDisabledKey() {
        let recorder = KeyRecorder()
        let pills = [PillItem(key: "a", label: "A"), PillItem(key: "b", label: "B", disabled: true)]
        let holder = model(input(pills, active: "a"), onChange: { recorder.record($0) })
        holder.select("b")
        holder.select("unknown")
        XCTAssertTrue(recorder.keys.isEmpty)
    }

    func testMoveForwardRoutesOnChangeAndFocus() {
        let recorder = KeyRecorder()
        let holder = model(input(items(3), active: "k0"), onChange: { recorder.record($0) })
        holder.move(.forward)
        XCTAssertEqual(recorder.keys, ["k1"])
        XCTAssertEqual(holder.focusedKey, "k1")
    }

    func testMoveBackwardWrapsToLast() {
        let recorder = KeyRecorder()
        let holder = model(input(items(3), active: "k0"), onChange: { recorder.record($0) })
        holder.move(.backward)
        XCTAssertEqual(recorder.keys, ["k2"])
        XCTAssertEqual(holder.focusedKey, "k2")
    }

    func testMoveSkipsDisabledPills() {
        let recorder = KeyRecorder()
        let pills = [
            PillItem(key: "a", label: "A"),
            PillItem(key: "b", label: "B", disabled: true),
            PillItem(key: "c", label: "C")
        ]
        let holder = model(input(pills, active: "a"), onChange: { recorder.record($0) })
        holder.move(.forward)
        XCTAssertEqual(recorder.keys, ["c"], "the disabled middle pill is skipped")
        XCTAssertEqual(holder.focusedKey, "c")
    }

    func testHomeAndEndTravel() {
        let recorder = KeyRecorder()
        let holder = model(input(items(4), active: "k2"), onChange: { recorder.record($0) })
        holder.moveToLast()
        holder.moveToFirst()
        XCTAssertEqual(recorder.keys, ["k3", "k0"])
        XCTAssertEqual(holder.focusedKey, "k0")
    }

    func testUpdateRefreshesPropsAndClearsStaleFocus() {
        let holder = model(input(items(3), active: "k0"))
        holder.move(.forward) // focusedKey = k1
        XCTAssertEqual(holder.focusedKey, "k1")
        // Rebind with k1 removed → the focus request is no longer selectable and is cleared.
        holder.update(input([PillItem(key: "k0", label: "L0")], active: "k0"), onChange: nil)
        XCTAssertEqual(holder.projection.pills.count, 1)
        XCTAssertNil(holder.focusedKey)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class PillFilterBarViewTests: XCTestCase {
    private func pills(_ count: Int) -> [PillItem] {
        (0 ..< count).map { PillItem(key: "k\($0)", label: "L\($0)", count: $0) }
    }

    func testSurfaceComposesForEveryBranch() {
        _ = PillFilterBar(items: pills(4), activeKey: "k1", ariaLabel: "Filter", onChange: { _ in })
        _ = PillFilterBar(items: pills(4), activeKey: "k0", ariaLabel: "Filter", onChange: { _ in }, variant: .tabs)
        _ = PillFilterBar(
            items: [PillItem(key: "a", label: "A"), PillItem(key: "b", label: "B", disabled: true)],
            activeKey: "a",
            ariaLabel: "Filter",
            onChange: { _ in }
        )
        _ = PillFilterBar(
            items: pills(2),
            activeKey: "k0",
            ariaLabel: "Filter",
            onChange: { _ in },
            scrollable: false
        )
        _ = PillFilterBar(items: [], activeKey: "", ariaLabel: "Filter", onChange: { _ in })
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = PillFilterBarModel(
            input: PillFilterBarInput(
                items: [PillItem(key: "all", label: "All", count: 12)],
                activeKey: "all",
                ariaLabel: "Filter"
            ),
            telemetry: SpyTelemetry()
        )
        _ = PillFilterBar(model: injected)
        XCTAssertEqual(PillFilterBar.surfaceSlug, "PillFilterBar")
    }

    func testAccentStyleAndEmptyViewBuild() {
        for accent in PillAccent.allCases {
            _ = PillAccentStyle(accent).tint
            _ = PillAccentStyle(accent).activeFill
            _ = PillAccentStyle(accent).activeRing
        }
        _ = PillFilterBarEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class PillFilterBarStringsTests: XCTestCase {
    func testEmptyFallback() {
        XCTAssertEqual(PillFilterBarStrings.empty, "No filters available")
        XCTAssertEqual(PillFilterBarStrings.table, "PillFilterBar")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: PillFilterBarTelemetry, @unchecked Sendable {
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

/// Records the keys the model routes through the page `onChange` (the `@MainActor` selection seam).
@MainActor
private final class KeyRecorder {
    private(set) var keys: [String] = []

    func record(_ key: String) {
        keys.append(key)
    }
}
