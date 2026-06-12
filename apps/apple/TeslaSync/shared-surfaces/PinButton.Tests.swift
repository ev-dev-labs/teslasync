//
//  PinButton.Tests.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in PinButton.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • PinButtonModel — the once-only `view.opened`, the store start/stop wiring, the projection refresh
//      on each snapshot, the toggle routing (writes the OPPOSITE pinned-ness, guarded while busy / cold),
//      the failed/stale retry → refresh, the stale one-shot auto-refresh (offline does not), and the
//      props `update` guard.
//    • Views — the public surface (every branch) + the subviews compose.
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks + the composed
//      accessibility value.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the in-memory store is
//  deterministic.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - PinButtonModel (binding + derivation + routing)

@MainActor
final class PinButtonModelTests: XCTestCase {
    private func input(itemID: String = "1", context: String? = nil, showLabel: Bool = false) -> PinButtonInput {
        PinButtonInput(itemType: .vehicle, itemID: itemID, context: context, size: .small, showLabel: showLabel)
    }

    private func makeModel(
        _ input: PinButtonInput,
        store: InMemoryPinnedStore,
        telemetry: PinButtonTelemetry = OSLogPinButtonTelemetry()
    ) -> PinButtonModel {
        PinButtonModel(input: input, store: store, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndStartsStore() {
        let spy = SpyTelemetry()
        let store = InMemoryPinnedStore(snapshot: .loaded())
        let model = makeModel(input(), store: store, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PinButtonSurface.slug])
        XCTAssertEqual(store.startCount, 1)
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let model = makeModel(input(), store: InMemoryPinnedStore(snapshot: .loaded()), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [PinButtonSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsSnapshotOnStart() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: ["1"]))
        let model = makeModel(input(), store: store)
        model.start()
        XCTAssertTrue(model.projection.isPinned)
        XCTAssertEqual(model.projection.presentation, .pinned)
    }

    func testToggleWritesOppositePinnednessAndUpdatesProjection() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: []))
        let model = makeModel(input(context: "dash"), store: store)
        model.start()
        // Unpinned → toggle pins it.
        model.toggle()
        XCTAssertEqual(store.toggleCalls, [PinToggleCall(itemID: "1", context: "dash", pinned: true)])
        XCTAssertTrue(model.projection.isPinned)
        // Pinned → toggle unpins it.
        model.toggle()
        XCTAssertEqual(store.toggleCalls.last, PinToggleCall(itemID: "1", context: "dash", pinned: false))
        XCTAssertFalse(model.projection.isPinned)
    }

    func testToggleIsNoOpWhileBusy() {
        let store = InMemoryPinnedStore(
            snapshot: PinnedSnapshot(status: .loaded, pinnedIDs: ["1"], pendingItemIDs: ["1"], hasLoaded: true)
        )
        let model = makeModel(input(), store: store)
        model.start()
        XCTAssertTrue(model.projection.isBusy)
        model.toggle()
        XCTAssertTrue(store.toggleCalls.isEmpty, "web `if (toggle.isPending) return`")
    }

    func testToggleIsNoOpWhileColdLoading() {
        let store = InMemoryPinnedStore(snapshot: PinnedSnapshot(status: .loading, hasLoaded: false))
        let model = makeModel(input(), store: store)
        model.start()
        XCTAssertTrue(model.projection.isAwaitingFirstLoad)
        model.toggle()
        XCTAssertTrue(store.toggleCalls.isEmpty, "cannot toggle against an unknown set")
    }

    func testRefreshForwardsToStore() {
        let store = InMemoryPinnedStore(snapshot: .loaded())
        let model = makeModel(input(), store: store)
        model.start()
        model.refresh()
        XCTAssertGreaterThanOrEqual(store.refreshCount, 1)
    }

    func testStaleTriggersOneAutoRefresh() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: ["1"]))
        let model = makeModel(input(), store: store)
        model.start()
        XCTAssertEqual(store.refreshCount, 0)
        // Push stale → exactly one guarded auto-refresh fires (which itself settles back to fresh).
        store.push(PinnedSnapshot(status: .loaded, freshness: .stale, pinnedIDs: ["1"], hasLoaded: true))
        XCTAssertEqual(store.refreshCount, 1)
        // A fresh episode resets the latch; a later stale re-triggers exactly once more.
        store.push(PinnedSnapshot(status: .loaded, freshness: .stale, pinnedIDs: ["1"], hasLoaded: true))
        XCTAssertEqual(store.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefreshAndKeepsCache() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: ["1"]))
        let model = makeModel(input(), store: store)
        model.start()
        store.push(PinnedSnapshot(status: .loaded, freshness: .offline, pinnedIDs: ["1"], hasLoaded: true))
        XCTAssertEqual(store.refreshCount, 0, "offline keeps the cached set; no auto-refresh")
        XCTAssertTrue(model.projection.isPinned)
        XCTAssertEqual(model.projection.statusBadge?.tone, .offline)
    }

    func testExternalChangeUpdatesProjection() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: []))
        let model = makeModel(input(itemID: "7"), store: store)
        model.start()
        XCTAssertFalse(model.projection.isPinned)
        store.external(pinnedIDs: ["7"])
        XCTAssertTrue(model.projection.isPinned, "a cross-surface pin re-derives this button")
    }

    func testUpdateRefreshesPropsAndIsNoOpWhenUnchanged() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: ["1"]))
        let model = makeModel(input(showLabel: false), store: store)
        model.start()
        XCTAssertFalse(model.projection.showsLabel)
        model.update(input(showLabel: true))
        XCTAssertTrue(model.projection.showsLabel)
        // Re-applying the same props is a no-op (still resolves correctly).
        model.update(input(showLabel: true))
        XCTAssertTrue(model.projection.showsLabel)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class PinButtonViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = PinButton(itemType: .vehicle, itemID: "1", pinned: false)
        _ = PinButton(itemType: .vehicle, itemID: "2", pinned: true)
        _ = PinButton(itemType: .widget, itemID: "3", size: .medium, showLabel: true, pinned: true)
        _ = PinButton(itemType: .vehicle, itemID: "4", status: .loading)
        _ = PinButton(itemType: .vehicle, itemID: "5", pinned: true, freshness: .stale)
        _ = PinButton(itemType: .vehicle, itemID: "6", pinned: true, freshness: .offline)
        XCTAssertEqual(PinButton.surfaceSlug, "PinButton")
    }

    func testSurfaceComposesFromInjectedModel() {
        let store = InMemoryPinnedStore(snapshot: .loaded(pinnedIDs: ["1"]))
        let model = PinButtonModel(input: PinButtonInput(itemType: .vehicle, itemID: "1"), store: store)
        _ = PinButton(model: model)
    }

    func testSubviewsCompose() {
        let pinned = PinButtonProjector.resolve(
            PinButtonInput(itemType: .vehicle, itemID: "1", showLabel: true),
            snapshot: .loaded(pinnedIDs: ["1"])
        )
        let cold = PinButtonProjector.resolve(
            PinButtonInput(itemType: .vehicle, itemID: "1"),
            snapshot: PinnedSnapshot(status: .loading, hasLoaded: false)
        )
        _ = PinGlyphView(projection: pinned, size: .medium)
        _ = PinGlyphView(projection: cold, size: .small)
        _ = PinInlineLabel(projection: pinned, size: .medium)
        _ = PinStatusBadgeView(badge: PinStatusBadge(
            tone: .stale,
            symbolName: "arrow.triangle.2.circlepath",
            messageKey: "pin.status.stale",
            messageFallback: "Refreshing pinned items…",
            showsRetry: true
        ))
    }
}

// MARK: - Strings facade (P1/S10)

final class PinButtonStringsTests: XCTestCase {
    func testTooltipAndLabelFallbacks() {
        XCTAssertEqual(PinButtonStrings.tooltip(.unpinned), "Pin")
        XCTAssertEqual(PinButtonStrings.tooltip(.pinned), "Unpin")
        XCTAssertEqual(PinButtonStrings.label(.unpinned), "Pin")
        XCTAssertEqual(PinButtonStrings.label(.pinned), "Pinned")
    }

    func testStatusFallbacks() {
        XCTAssertEqual(PinButtonStrings.loading, "Loading pins…")
        XCTAssertEqual(PinButtonStrings.busy, "Updating…")
        XCTAssertEqual(PinButtonStrings.retry, "Retry")
    }

    func testAccessibilityValueIsEmptyWhenIdleAndFresh() {
        let projection = PinButtonProjector.resolve(
            PinButtonInput(itemType: .vehicle, itemID: "1"),
            snapshot: .loaded(pinnedIDs: ["1"])
        )
        XCTAssertEqual(PinButtonStrings.accessibilityValue(for: projection), "")
    }

    func testAccessibilityValueAnnouncesColdLoad() {
        let projection = PinButtonProjector.resolve(
            PinButtonInput(itemType: .vehicle, itemID: "1"),
            snapshot: PinnedSnapshot(status: .loading, hasLoaded: false)
        )
        XCTAssertEqual(PinButtonStrings.accessibilityValue(for: projection), "Loading pins…")
    }

    func testAccessibilityValueAppendsBadgeMessage() {
        let projection = PinButtonProjector.resolve(
            PinButtonInput(itemType: .vehicle, itemID: "1"),
            snapshot: PinnedSnapshot(status: .loaded, freshness: .offline, pinnedIDs: ["1"], hasLoaded: true)
        )
        XCTAssertEqual(
            PinButtonStrings.accessibilityValue(for: projection),
            "Offline — showing the last known pins"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: PinButtonTelemetry, @unchecked Sendable {
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
