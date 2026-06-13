//
//  DatePresetChips.Tests.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + catalog + value
//  types live in DatePresetChips.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DatePresetChipsModel — the once-only `view.opened`, the props/closure update guard, and the tap-time
//      range resolution (resolves against the injected clock + calendar, records the selection, routes it out
//      through the page `onSelect`; a no-op for an unknown id).
//    • Views — the public surface + the subviews compose in every branch (populated / active / empty /
//      injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks (the values fed to
//      the group + chip accessibility labels).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DatePresetChipsModel (props + tap-time resolution)

@MainActor
final class DatePresetChipsModelTests: XCTestCase {
    /// A fixed UTC Gregorian calendar so the resolved ISO days are timezone-independent in CI.
    private let cal = DatePresetChipsCatalog.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    /// A fixed clock pinned to 2024-03-15 noon UTC.
    private var fixedClock: FixedClock {
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 12
        return FixedClock(instant: cal.date(from: components)!)
    }

    private func model(
        _ input: DatePresetChipsInput = DatePresetChipsInput(),
        onSelect: @escaping @MainActor (DatePresetChipsSelection) -> Void = { _ in },
        telemetry: DatePresetChipsTelemetry = OSLogDatePresetChipsTelemetry()
    ) -> DatePresetChipsModel {
        DatePresetChipsModel(
            input: input,
            onSelect: onSelect,
            clock: fixedClock,
            calendar: cal,
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DatePresetChipsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DatePresetChipsSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let holder = model(DatePresetChipsInput(presetIDs: ["today", "7d", "all"], activeID: "7d"))
        XCTAssertEqual(holder.projection.chips.map(\.id), ["today", "7d", "all"])
        XCTAssertEqual(holder.projection.chips.filter(\.isActive).map(\.id), ["7d"])
    }

    func testSelectResolvesRangeRoutesAndRecords() {
        var received: DatePresetChipsSelection?
        let holder = model { received = $0 }
        holder.select("today")
        XCTAssertEqual(received, DatePresetChipsSelection(id: "today", start: "2024-03-15", end: "2024-03-15"))
        XCTAssertEqual(holder.lastSelection, received)
    }

    func testSelectResolvesMultiDayPreset() {
        var received: DatePresetChipsSelection?
        let holder = model { received = $0 }
        holder.select("7d")
        XCTAssertEqual(received?.start, "2024-03-09")
        XCTAssertEqual(received?.end, "2024-03-15")
    }

    func testSelectUnknownIDIsNoOp() {
        var calls = 0
        let holder = model { _ in calls += 1 }
        holder.select("not-a-preset")
        XCTAssertEqual(calls, 0)
        XCTAssertNil(holder.lastSelection)
    }

    func testUpdateRefreshesPropsAndClosure() {
        var received: DatePresetChipsSelection?
        let holder = model()
        holder.update(DatePresetChipsInput(presetIDs: ["all"], activeID: "all")) { received = $0 }
        XCTAssertEqual(holder.projection.chips.map(\.id), ["all"])
        XCTAssertTrue(holder.projection.chips[0].isActive)
        holder.select("all")
        XCTAssertEqual(received?.id, "all")
        XCTAssertEqual(received?.end, "2024-03-15")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class DatePresetChipsViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = DatePresetChips(onSelect: { _ in })
        _ = DatePresetChips(activeID: "30d", onSelect: { _ in })
        _ = DatePresetChips(presetIDs: ["today", "7d"], size: .medium, ariaLabel: "Pick a range", onSelect: { _ in })
        _ = DatePresetChips(presetIDs: [], onSelect: { _ in })
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DatePresetChipsModel(
            input: DatePresetChipsInput(presetIDs: ["today", "all"], activeID: "all"),
            telemetry: SpyTelemetry()
        )
        _ = DatePresetChips(model: injected)
        XCTAssertEqual(DatePresetChips.surfaceSlug, "DatePresetChips")
    }

    func testSubviewsCompose() {
        let chip = DatePresetChipsChip(
            id: "7d",
            i18nKey: "date.preset.last7",
            fallback: "Last 7 days",
            isActive: true
        )
        _ = DatePresetChipsRow(chips: [chip], size: .small) { _ in }
        _ = DatePresetChipView(chip: chip, size: .medium) {}
        _ = DatePresetChipsEmptyView()
        _ = DatePresetChipsFlowLayout()
    }
}

// MARK: - Strings facade (P1/S10) — the accessibility-label sources

final class DatePresetChipsStringsTests: XCTestCase {
    func testGroupLabelFallback() {
        XCTAssertEqual(DatePresetChipsStrings.groupLabel, "Quick date range")
    }

    func testEmptyFallback() {
        XCTAssertEqual(DatePresetChipsStrings.empty, "No quick ranges")
    }

    func testPresetLabelResolverReturnsFallback() {
        XCTAssertEqual(
            DatePresetChipsStrings.label(key: "date.preset.last7", fallback: "Last 7 days"),
            "Last 7 days"
        )
    }

    func testEveryCatalogPresetHasAResolvableLabel() {
        for preset in DatePresetChipsCatalog.all {
            let label = DatePresetChipsStrings.label(key: preset.i18nKey, fallback: preset.fallback)
            XCTAssertFalse(label.isEmpty, "preset \(preset.id) resolves a non-empty accessibility label")
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: DatePresetChipsTelemetry, @unchecked Sendable {
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

/// A clock pinned to a fixed instant, so the tap-time range resolution is deterministic.
private struct FixedClock: DatePresetChipsClock {
    let instant: Date

    func now() -> Date {
        instant
    }
}
