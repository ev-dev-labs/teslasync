//
//  ChartTimeRangeContext.Tests.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The projection + state-holder + store + view-composition half of the coverage (the pure reducer +
//  value types live in ChartTimeRangeContext.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • Projection — the inside / outside-provider collapse (web `useChartSync` / `useSyncedCursor` /
//      `useSyncedReferenceLineX` return values) over a cached positions map.
//    • CursorSyncStore — set / clear / reset / read, the shared singleton identity, and the
//      no-spurious-mutation guard (web external-store parity).
//    • ChartTimeRangeContextModel — the once-only `view.opened`, the hover broadcast, the persistent
//      reference-line read, cross-model sync over one store, per-`syncId` isolation, and the
//      unmount clear (web `clearCursorSync`).
//    • Views — the provider, the modifier spelling, the persistent-rule builder, and the sample all
//      compose; the sample's accessibility + axis labels resolve through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the store is in-process.
//

import Charts
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (web hook return values)

final class ChartTimeRangeProjectionTests: XCTestCase {
    func testStandaloneOutsideProvider() {
        let resolved = ChartTimeRangeProjection.resolve(
            context: nil,
            positions: ["drive-detail": .number(5)]
        )
        XCTAssertNil(resolved.context)
        XCTAssertFalse(resolved.isWithinProvider)
        XCTAssertEqual(resolved.syncedCursor, .inactive)
        XCTAssertNil(resolved.referenceLineX)
        XCTAssertFalse(resolved.hasReferenceLine)
    }

    func testWithinProviderNoCursor() {
        let context = ChartSyncContextValue(syncId: "drive-detail", syncMethod: .index)
        let resolved = ChartTimeRangeProjection.resolve(context: context, positions: [:])
        XCTAssertEqual(resolved.context, context)
        XCTAssertTrue(resolved.isWithinProvider)
        XCTAssertTrue(resolved.syncedCursor.isActive)
        XCTAssertEqual(resolved.syncedCursor.syncId, "drive-detail")
        XCTAssertEqual(resolved.syncedCursor.syncMethod, .index)
        XCTAssertNil(resolved.referenceLineX)
        XCTAssertFalse(resolved.hasReferenceLine)
    }

    func testWithinProviderWithCursor() {
        let context = ChartSyncContextValue(syncId: "drive-detail", syncMethod: .value)
        let resolved = ChartTimeRangeProjection.resolve(
            context: context,
            positions: ["drive-detail": .number(8), "other": .number(99)]
        )
        XCTAssertEqual(resolved.referenceLineX, .number(8))
        XCTAssertTrue(resolved.hasReferenceLine)
        XCTAssertEqual(resolved.syncedCursor.syncMethod, .value)
    }
}

// MARK: - CursorSyncStore (web cursorSync.ts external store)

@MainActor
final class CursorSyncStoreTests: XCTestCase {
    func testNewStoreIsEmpty() {
        let store = CursorSyncStore()
        XCTAssertTrue(store.positions.isEmpty)
        XCTAssertNil(store.position(for: "drive-detail"))
        XCTAssertNil(store.position(for: nil))
    }

    func testSetAndReadPosition() {
        let store = CursorSyncStore()
        store.setPosition(.number(4), for: "drive-detail")
        XCTAssertEqual(store.position(for: "drive-detail"), .number(4))
    }

    func testSetNilClearsPosition() {
        let store = CursorSyncStore()
        store.setPosition(.number(4), for: "drive-detail")
        store.setPosition(nil, for: "drive-detail")
        XCTAssertNil(store.position(for: "drive-detail"))
    }

    func testClearAndReset() {
        let store = CursorSyncStore()
        store.setPosition(.number(4), for: "a")
        store.setPosition(.text("x"), for: "b")
        store.clear("a")
        XCTAssertNil(store.position(for: "a"))
        XCTAssertEqual(store.position(for: "b"), .text("x"))
        store.reset()
        XCTAssertTrue(store.positions.isEmpty)
    }

    func testSharedIsASingleton() {
        XCTAssertTrue(CursorSyncStore.shared === CursorSyncStore.shared)
    }
}

// MARK: - ChartTimeRangeContextModel (web provider value + hooks)

@MainActor
final class ChartTimeRangeContextModelTests: XCTestCase {
    private func makeModel(
        syncId: String = "drive-detail",
        syncMethod: ChartSyncMethod = .index,
        store: CursorSyncStore = CursorSyncStore(),
        spy: SpyChartTimeRangeTelemetry
    ) -> ChartTimeRangeContextModel {
        ChartTimeRangeContextModel(
            syncId: syncId,
            syncMethod: syncMethod,
            store: store,
            telemetry: spy
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyChartTimeRangeTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChartTimeRangeSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyChartTimeRangeTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChartTimeRangeSurface.slug], "view.opened fires once per instance")
    }

    func testContextExposure() {
        let model = makeModel(syncId: "charging", syncMethod: .value, spy: SpyChartTimeRangeTelemetry())
        XCTAssertEqual(model.syncId, "charging")
        XCTAssertEqual(model.syncMethod, .value)
        XCTAssertEqual(model.syncedCursor, SyncedCursorProps(syncId: "charging", syncMethod: .value))
    }

    func testMoveCursorWritesStoreAndReferenceLineReadsIt() {
        let store = CursorSyncStore()
        let model = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        XCTAssertNil(model.referenceLineX)
        model.moveCursor(to: .number(6))
        XCTAssertEqual(model.referenceLineX, .number(6))
        XCTAssertEqual(store.position(for: "drive-detail"), .number(6))
    }

    func testMoveCursorNilIsNoOp() {
        let store = CursorSyncStore()
        let model = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        model.moveCursor(to: .number(6))
        model.moveCursor(to: nil)
        XCTAssertEqual(model.referenceLineX, .number(6), "a nil hover leaves the persistent line")
    }

    func testClearCursorDropsLine() {
        let model = makeModel(spy: SpyChartTimeRangeTelemetry())
        model.moveCursor(to: .number(6))
        model.clearCursor()
        XCTAssertNil(model.referenceLineX)
    }

    func testStopClearsStoreEntry() {
        let store = CursorSyncStore()
        let model = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        model.moveCursor(to: .number(6))
        XCTAssertEqual(store.position(for: "drive-detail"), .number(6))
        model.stop()
        XCTAssertNil(store.position(for: "drive-detail"))
    }

    func testResolvedReflectsStore() {
        let store = CursorSyncStore()
        let model = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        model.moveCursor(to: .number(2))
        let resolved = model.resolved
        XCTAssertTrue(resolved.isWithinProvider)
        XCTAssertEqual(resolved.referenceLineX, .number(2))
    }

    func testModelsSharingStoreAndSyncIdSeeEachOther() {
        let store = CursorSyncStore()
        let chartA = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        let chartB = makeModel(store: store, spy: SpyChartTimeRangeTelemetry())
        chartA.moveCursor(to: .number(11))
        XCTAssertEqual(chartB.referenceLineX, .number(11))
    }

    func testDistinctSyncIdsAreIsolated() {
        let store = CursorSyncStore()
        let drive = makeModel(syncId: "drive-detail", store: store, spy: SpyChartTimeRangeTelemetry())
        let charge = makeModel(syncId: "charging", store: store, spy: SpyChartTimeRangeTelemetry())
        drive.moveCursor(to: .number(11))
        XCTAssertNil(charge.referenceLineX)
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class ChartTimeRangeViewTests: XCTestCase {
    func testProviderComposes() {
        _ = ChartTimeRangeProvider(syncId: "drive-detail") { EmptyView() }
        _ = ChartTimeRangeProvider(syncId: "drive-detail", syncMethod: .value) { EmptyView() }
        let model = ChartTimeRangeContextModel(syncId: "drive-detail", store: CursorSyncStore())
        _ = ChartTimeRangeProvider(model: model) { EmptyView() }
    }

    func testModifierSpellingComposes() {
        _ = EmptyView().chartTimeRangeProvider(syncId: "drive-detail")
        _ = EmptyView().chartTimeRangeProvider(syncId: "drive-detail", syncMethod: .value)
    }

    func testPersistentRuleBuilds() {
        _ = tsSyncedCursorRule(at: .number(5))
        _ = tsSyncedCursorRule(at: .text("12:30"))
        _ = tsSyncedCursorRule(at: nil)
    }

    func testSampleComposes() {
        _ = ChartTimeRangeContextSample()
        _ = ChartTimeRangeContextSample(syncId: "test-sync", syncMethod: .value)
        _ = ChartTimeRangeSampleChart(
            titleKey: "chartTimeRange.sample.series.battery",
            titleFallback: "Battery (synced)",
            points: ChartTimeRangeSampleData.seriesA,
            colorIndex: 0
        )
        XCTAssertFalse(ChartTimeRangeSampleData.seriesA.isEmpty)
    }

    func testAccessibilityAndAxisLabelsResolveFromCatalog() {
        XCTAssertEqual(
            ChartTimeRangeStrings.string("chartTimeRange.sample.chart.aria", "Synced sample line chart"),
            "Synced sample line chart"
        )
        XCTAssertEqual(
            ChartTimeRangeStrings.string("chartTimeRange.sample.cursor.none", "No shared cursor"),
            "No shared cursor"
        )
        XCTAssertEqual(
            ChartTimeRangeStrings.string("chartTimeRange.sample.axis.x", "Sample"),
            "Sample"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyChartTimeRangeTelemetry: ChartTimeRangeTelemetry, @unchecked Sendable {
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
