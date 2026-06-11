//
//  ChartHiddenSeriesContext.Tests.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The projection + state-holder + store + view-composition half of the coverage (the pure codec +
//  reducer live in ChartHiddenSeriesContext.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • Projection — the decode + derived reads (web `useHiddenSeries` return: hidden / isHidden /
//      sortedKeys / queryValue / isEmpty / count) over a cached query value.
//    • HiddenSeriesStore — set / toggle / reset / read, drop-on-empty + no-op-on-unchanged (web
//      `omitDefault` / stable-identity), the deep-link round-trip, per-chartKey isolation, the shared
//      singleton.
//    • HiddenSeriesState — the hidden / isHidden / toggle / reset reads, the once-only `view.opened`,
//      the stop-does-NOT-clear contract (the URL-backed set survives unmount — the faithful difference
//      from the cursor-sync sibling), cross-state sharing over one store, per-chartKey isolation.
//    • Views — the provider (chartKey present / nil / empty / model-injected), the reader, the modifier
//      spelling, the legend chip, and the sample all compose; the copy resolves through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the store is in-process.
//

import Charts
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (web useHiddenSeries return value)

final class ChartHiddenSeriesProjectionTests: XCTestCase {
    func testResolveEmptyFromNilRaw() {
        let resolved = ChartHiddenSeriesProjection.resolve(chartKey: "c", raw: nil)
        XCTAssertEqual(resolved.chartKey, "c")
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertEqual(resolved.count, 0)
        XCTAssertNil(resolved.queryValue)
        XCTAssertEqual(resolved.sortedKeys, [])
        XCTAssertFalse(resolved.isHidden("health"))
    }

    func testResolveFromRaw() {
        let resolved = ChartHiddenSeriesProjection.resolve(chartKey: "c", raw: "projected,health")
        XCTAssertFalse(resolved.isEmpty)
        XCTAssertEqual(resolved.count, 2)
        XCTAssertTrue(resolved.isHidden("health"))
        XCTAssertTrue(resolved.isHidden("projected"))
        XCTAssertFalse(resolved.isHidden("fleet"))
        XCTAssertEqual(resolved.sortedKeys, ["health", "projected"])
        XCTAssertEqual(resolved.queryValue, "health,projected")
    }

    func testResolveFromHiddenSet() {
        let resolved = ChartHiddenSeriesProjection.resolve(chartKey: "c", hidden: ["health"])
        XCTAssertEqual(resolved.hidden, ["health"])
        XCTAssertEqual(resolved.queryValue, "health")
    }

    func testEmptyFactory() {
        XCTAssertTrue(HiddenSeriesResolved.empty(chartKey: "c").isEmpty)
    }
}

// MARK: - HiddenSeriesStore (web useHiddenSeries URL store)

@MainActor
final class HiddenSeriesStoreTests: XCTestCase {
    func testNewStoreIsEmpty() {
        let store = HiddenSeriesStore()
        XCTAssertTrue(store.hiddenByKey.isEmpty)
        XCTAssertTrue(store.hidden(for: "c").isEmpty)
        XCTAssertFalse(store.isHidden("health", for: "c"))
    }

    func testSetAndReadHidden() {
        let store = HiddenSeriesStore()
        store.setHidden(["health"], for: "c")
        XCTAssertEqual(store.hidden(for: "c"), ["health"])
        XCTAssertTrue(store.isHidden("health", for: "c"))
    }

    func testSetHiddenEmptyDropsEntry() {
        let store = HiddenSeriesStore()
        store.setHidden(["health"], for: "c")
        store.setHidden([], for: "c")
        XCTAssertNil(store.hiddenByKey["c"], "an empty set drops the entry (web omitDefault)")
        XCTAssertTrue(store.hiddenByKey.isEmpty)
    }

    func testSetHiddenAbsentEmptyIsNoOp() {
        let store = HiddenSeriesStore()
        store.setHidden([], for: "c")
        XCTAssertTrue(store.hiddenByKey.isEmpty)
    }

    func testToggle() {
        let store = HiddenSeriesStore()
        store.toggle("health", for: "c")
        XCTAssertEqual(store.hidden(for: "c"), ["health"])
        store.toggle("health", for: "c")
        XCTAssertTrue(store.hidden(for: "c").isEmpty)
        XCTAssertNil(store.hiddenByKey["c"], "toggling the last hidden series back on drops the entry")
    }

    func testReset() {
        let store = HiddenSeriesStore()
        store.setHidden(["health", "projected"], for: "c")
        store.reset("c")
        XCTAssertTrue(store.hidden(for: "c").isEmpty)
        XCTAssertNil(store.hiddenByKey["c"])
    }

    func testQueryValueAndApplyRoundTrip() {
        let store = HiddenSeriesStore()
        store.setHidden(["projected", "health"], for: "c")
        let query = store.queryValue(for: "c")
        XCTAssertEqual(query, "health,projected")

        let restored = HiddenSeriesStore()
        restored.apply(queryValue: query, for: "c")
        XCTAssertEqual(restored.hidden(for: "c"), ["health", "projected"])
    }

    func testApplyNilClears() {
        let store = HiddenSeriesStore()
        store.setHidden(["health"], for: "c")
        store.apply(queryValue: nil, for: "c")
        XCTAssertTrue(store.hidden(for: "c").isEmpty)
    }

    func testPerChartKeyIsolation() {
        let store = HiddenSeriesStore()
        store.toggle("health", for: "chartA")
        XCTAssertTrue(store.hidden(for: "chartB").isEmpty)
        XCTAssertEqual(store.hidden(for: "chartA"), ["health"])
    }

    func testResolvedReflectsStore() {
        let store = HiddenSeriesStore()
        store.setHidden(["health"], for: "c")
        XCTAssertEqual(store.resolved(for: "c").hidden, ["health"])
    }

    func testResetAll() {
        let store = HiddenSeriesStore()
        store.setHidden(["health"], for: "a")
        store.setHidden(["projected"], for: "b")
        store.resetAll()
        XCTAssertTrue(store.hiddenByKey.isEmpty)
    }

    func testSharedIsASingleton() {
        XCTAssertTrue(HiddenSeriesStore.shared === HiddenSeriesStore.shared)
    }
}

// MARK: - HiddenSeriesState (web HiddenSeriesState — useHiddenSeries return + context value)

@MainActor
final class HiddenSeriesStateTests: XCTestCase {
    private func makeState(
        chartKey: String = "battery-trend",
        store: HiddenSeriesStore = HiddenSeriesStore(),
        spy: SpyChartHiddenSeriesTelemetry
    ) -> HiddenSeriesState {
        HiddenSeriesState(chartKey: chartKey, store: store, telemetry: spy)
    }

    func testHiddenAndIsHiddenReadStore() {
        let store = HiddenSeriesStore()
        let state = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        XCTAssertTrue(state.hidden.isEmpty)
        store.setHidden(["health"], for: "battery-trend")
        XCTAssertEqual(state.hidden, ["health"])
        XCTAssertTrue(state.isHidden("health"))
        XCTAssertFalse(state.isHidden("projected"))
    }

    func testToggleWritesStore() {
        let store = HiddenSeriesStore()
        let state = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        state.toggle("health")
        XCTAssertEqual(store.hidden(for: "battery-trend"), ["health"])
        XCTAssertEqual(state.sortedHidden, ["health"])
        XCTAssertEqual(state.queryValue, "health")
    }

    func testResetClearsStore() {
        let store = HiddenSeriesStore()
        let state = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        state.toggle("health")
        state.reset()
        XCTAssertTrue(state.hidden.isEmpty)
        XCTAssertNil(state.queryValue)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyChartHiddenSeriesTelemetry()
        let state = makeState(spy: spy)
        state.start()
        state.start()
        XCTAssertEqual(spy.surfaces, [ChartHiddenSeriesSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyChartHiddenSeriesTelemetry()
        let state = makeState(spy: spy)
        state.start()
        state.stop()
        state.start()
        XCTAssertEqual(spy.surfaces, [ChartHiddenSeriesSurface.slug], "view.opened fires once per instance")
    }

    func testStopDoesNotClearHiddenSet() {
        let store = HiddenSeriesStore()
        let state = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        state.toggle("health")
        state.start()
        state.stop()
        XCTAssertEqual(
            store.hidden(for: "battery-trend"),
            ["health"],
            "the URL-backed hidden set survives unmount (web persists it in the URL)"
        )
    }

    func testStatesSharingStoreAndKeySeeEachOther() {
        let store = HiddenSeriesStore()
        let legendA = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        let legendB = makeState(store: store, spy: SpyChartHiddenSeriesTelemetry())
        legendA.toggle("health")
        XCTAssertTrue(legendB.isHidden("health"))
    }

    func testDistinctChartKeysAreIsolated() {
        let store = HiddenSeriesStore()
        let battery = makeState(chartKey: "battery", store: store, spy: SpyChartHiddenSeriesTelemetry())
        let energy = makeState(chartKey: "energy", store: store, spy: SpyChartHiddenSeriesTelemetry())
        battery.toggle("health")
        XCTAssertFalse(energy.isHidden("health"))
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class ChartHiddenSeriesViewTests: XCTestCase {
    func testProviderComposesForEveryChartKeyForm() {
        _ = ChartHiddenSeriesProvider(chartKey: "battery-trend") { EmptyView() }
        _ = ChartHiddenSeriesProvider(chartKey: nil) { EmptyView() }
        _ = ChartHiddenSeriesProvider(chartKey: "") { EmptyView() }
        let state = HiddenSeriesState(chartKey: "battery-trend", store: HiddenSeriesStore())
        _ = ChartHiddenSeriesProvider(model: state) { EmptyView() }
        _ = ChartHiddenSeriesProvider(model: nil) { EmptyView() }
    }

    func testReaderComposes() {
        _ = ChartHiddenSeriesReader { state in
            Text(verbatim: state == nil ? "none" : "active")
        }
    }

    func testModifierSpellingComposes() {
        _ = EmptyView().chartHiddenSeriesProvider(chartKey: "battery-trend")
        _ = EmptyView().chartHiddenSeriesProvider(chartKey: nil)
    }

    func testLegendChipComposes() {
        _ = ChartHiddenSeriesLegendChip(seriesID: "health", nameText: "Health", colorIndex: 0)
        _ = ChartHiddenSeriesLegendChip(series: ChartHiddenSeriesSampleData.series[0])
    }

    func testSampleComposes() {
        _ = ChartHiddenSeriesContextSample()
        _ = ChartHiddenSeriesContextSample(chartKey: nil)
        _ = ChartHiddenSeriesSampleChart()
        XCTAssertFalse(ChartHiddenSeriesSampleData.series.isEmpty)
    }

    func testSurfaceSlugExposedOnProvider() {
        XCTAssertEqual(ChartHiddenSeriesProvider<EmptyView>.surfaceSlug, "ChartHiddenSeriesContext")
    }

    func testCopyResolvesFromCatalog() {
        XCTAssertEqual(ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.shown", "Shown"), "Shown")
        XCTAssertEqual(ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.hidden", "Hidden"), "Hidden")
        XCTAssertEqual(
            ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.hint", "Double tap to toggle this series"),
            "Double tap to toggle this series"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyChartHiddenSeriesTelemetry: ChartHiddenSeriesTelemetry, @unchecked Sendable {
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
