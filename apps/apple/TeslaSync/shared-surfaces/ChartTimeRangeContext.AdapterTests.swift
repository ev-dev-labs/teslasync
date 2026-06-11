//
//  ChartTimeRangeContext.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  Pure-core coverage for the cursor-sync surface (the model + store + view-composition half lives in
//  ChartTimeRangeContext.Tests.swift; split to keep each file within the SwiftLint file-length
//  budget). This is the "adapter (cached → projection)" unit test the acceptance calls for: it drives
//  the cached `[syncId: CursorSyncValue]` map through ``CursorSyncReducer`` and asserts the verbatim
//  port of the web external-store mutators:
//    • position — read `nil` for an unknown / `nil` id (web `useCursorSyncPosition(undefined)`).
//    • set      — store, no-op on an unchanged write (web `if (current === value) return`), delete on
//                 `nil`, per-`syncId` isolation.
//    • clear    — drop an entry, no-op when absent (web `if (!has(syncId)) return`).
//    • value    — `CursorSyncValue` equality + the index / date initializers + payload accessors.
//    • method   — the `'index' | 'value'` raw values; the context + props value types; the slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no store instance, so
//  each assertion reads the pure reducer directly.
//

import XCTest
@testable import TeslaSync

// MARK: - CursorSyncReducer (web cursorSync.ts mutators)

final class CursorSyncReducerTests: XCTestCase {
    func testPositionReadsNilForUnknownOrNilSyncId() {
        let positions: [String: CursorSyncValue] = ["drive-detail": .number(7)]
        XCTAssertEqual(CursorSyncReducer.position(in: positions, syncId: "drive-detail"), .number(7))
        XCTAssertNil(CursorSyncReducer.position(in: positions, syncId: "missing"))
        XCTAssertNil(CursorSyncReducer.position(in: positions, syncId: nil))
        XCTAssertNil(CursorSyncReducer.position(in: [:], syncId: "drive-detail"))
    }

    func testSetStoresValueAndReportsChange() {
        var positions: [String: CursorSyncValue] = [:]
        let changed = CursorSyncReducer.set(&positions, syncId: "drive-detail", value: .number(3))
        XCTAssertTrue(changed)
        XCTAssertEqual(positions["drive-detail"], .number(3))
    }

    func testSetIsNoOpWhenUnchanged() {
        var positions: [String: CursorSyncValue] = ["drive-detail": .number(3)]
        let changed = CursorSyncReducer.set(&positions, syncId: "drive-detail", value: .number(3))
        XCTAssertFalse(changed, "an unchanged write must not report a change (web early return)")
        XCTAssertEqual(positions["drive-detail"], .number(3))
    }

    func testSetUpdatesWhenValueDiffers() {
        var positions: [String: CursorSyncValue] = ["drive-detail": .number(3)]
        let changed = CursorSyncReducer.set(&positions, syncId: "drive-detail", value: .number(4))
        XCTAssertTrue(changed)
        XCTAssertEqual(positions["drive-detail"], .number(4))
    }

    func testSetNilDeletesEntry() {
        var positions: [String: CursorSyncValue] = ["drive-detail": .number(3)]
        let changed = CursorSyncReducer.set(&positions, syncId: "drive-detail", value: nil)
        XCTAssertTrue(changed)
        XCTAssertNil(positions["drive-detail"])
        XCTAssertTrue(positions.isEmpty)
    }

    func testSetNilOnAbsentEntryIsNoOp() {
        var positions: [String: CursorSyncValue] = [:]
        let changed = CursorSyncReducer.set(&positions, syncId: "drive-detail", value: nil)
        XCTAssertFalse(changed, "clearing an absent entry must not report a change")
        XCTAssertTrue(positions.isEmpty)
    }

    func testSetIsolatesSyncIds() {
        var positions: [String: CursorSyncValue] = [:]
        CursorSyncReducer.set(&positions, syncId: "drive-detail", value: .number(1))
        CursorSyncReducer.set(&positions, syncId: "charging.session", value: .text("12:30"))
        XCTAssertEqual(positions["drive-detail"], .number(1))
        XCTAssertEqual(positions["charging.session"], .text("12:30"))
        XCTAssertEqual(positions.count, 2)
    }

    func testClearDropsEntryAndReportsChange() {
        var positions: [String: CursorSyncValue] = ["drive-detail": .number(3)]
        let changed = CursorSyncReducer.clear(&positions, syncId: "drive-detail")
        XCTAssertTrue(changed)
        XCTAssertTrue(positions.isEmpty)
    }

    func testClearIsNoOpWhenAbsent() {
        var positions: [String: CursorSyncValue] = ["other": .number(3)]
        let changed = CursorSyncReducer.clear(&positions, syncId: "drive-detail")
        XCTAssertFalse(changed)
        XCTAssertEqual(positions["other"], .number(3))
    }
}

// MARK: - CursorSyncValue (web `string | number | null`)

final class CursorSyncValueTests: XCTestCase {
    func testEquality() {
        XCTAssertEqual(CursorSyncValue.number(5), .number(5))
        XCTAssertEqual(CursorSyncValue.text("a"), .text("a"))
        XCTAssertNotEqual(CursorSyncValue.number(5), .number(6))
        XCTAssertNotEqual(CursorSyncValue.text("a"), .text("b"))
        XCTAssertNotEqual(CursorSyncValue.number(5), .text("5"))
    }

    func testIndexInitializerProducesNumber() {
        XCTAssertEqual(CursorSyncValue(index: 9), .number(9))
    }

    func testDateInitializerProducesReferenceInterval() {
        let date = Date(timeIntervalSinceReferenceDate: 1234.5)
        XCTAssertEqual(CursorSyncValue(date: date), .number(1234.5))
    }

    func testPayloadAccessors() {
        XCTAssertEqual(CursorSyncValue.number(7).numberValue, 7)
        XCTAssertNil(CursorSyncValue.number(7).textValue)
        XCTAssertEqual(CursorSyncValue.text("x").textValue, "x")
        XCTAssertNil(CursorSyncValue.text("x").numberValue)
    }
}

// MARK: - ChartSyncMethod (web `'index' | 'value'`)

final class ChartSyncMethodTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(ChartSyncMethod.index.rawValue, "index")
        XCTAssertEqual(ChartSyncMethod.value.rawValue, "value")
    }

    func testAllCases() {
        XCTAssertEqual(Set(ChartSyncMethod.allCases), [.index, .value])
    }
}

// MARK: - Context + props value types

final class ChartSyncContextValueTests: XCTestCase {
    func testDefaultSyncMethodIsIndex() {
        let context = ChartSyncContextValue(syncId: "drive-detail")
        XCTAssertEqual(context.syncId, "drive-detail")
        XCTAssertEqual(context.syncMethod, .index)
    }

    func testExplicitSyncMethodIsCarried() {
        let context = ChartSyncContextValue(syncId: "charging", syncMethod: .value)
        XCTAssertEqual(context.syncMethod, .value)
    }
}

final class SyncedCursorPropsTests: XCTestCase {
    func testInactiveIsAllNil() {
        XCTAssertNil(SyncedCursorProps.inactive.syncId)
        XCTAssertNil(SyncedCursorProps.inactive.syncMethod)
        XCTAssertFalse(SyncedCursorProps.inactive.isActive)
    }

    func testActiveProps() {
        let props = SyncedCursorProps(syncId: "drive-detail", syncMethod: .index)
        XCTAssertTrue(props.isActive)
        XCTAssertEqual(props.syncId, "drive-detail")
        XCTAssertEqual(props.syncMethod, .index)
    }
}

// MARK: - Meta (diagnostics slug)

final class ChartTimeRangeSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ChartTimeRangeSurface.slug, "ChartTimeRangeContext")
    }
}
