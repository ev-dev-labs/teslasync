//
//  PinButton.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the pinned-kind wire
//  tokens (web `PinnedItemType`), the size dimensions (web `h-7`/`h-8`, glyph + label points), the
//  pinned / unpinned presentation (lucide → SF Symbol + tone + copy keys), the pin-membership predicate
//  (web `pinned.some(...)`), the offline → error → stale badge precedence, and the full `resolve`
//  projection across the unpinned / pinned / busy / cold-load / refresh / failed-with-cache branches.
//  Split from PinButton.Tests.swift (the SwiftUI / state-holder half) to keep each file within the
//  SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is
//  pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + domain tokens

final class PinButtonAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(PinButtonSurface.slug, "PinButton")
    }

    func testPinnedItemKindWireValuesMatchWebUnion() {
        XCTAssertEqual(PinnedItemKind.vehicle.wireValue, "vehicle")
        XCTAssertEqual(PinnedItemKind.widget.wireValue, "widget")
        XCTAssertEqual(PinnedItemKind.alertRule.wireValue, "alert_rule")
        XCTAssertEqual(PinnedItemKind.location.wireValue, "location")
        XCTAssertEqual(PinnedItemKind.geofence.wireValue, "geofence")
        XCTAssertEqual(PinnedItemKind.automation.wireValue, "automation")
        XCTAssertEqual(PinnedItemKind.dashboard.wireValue, "dashboard")
        XCTAssertEqual(PinnedItemKind.command.wireValue, "command")
        // Round-trip parity with the wire token (the store seam parses these back).
        XCTAssertEqual(PinnedItemKind(rawValue: "alert_rule"), .alertRule)
        XCTAssertEqual(PinnedItemKind.allCases.count, 8)
    }

    func testSizeDimensionsMatchWebClasses() {
        // Web sm = h-7 w-7 (28) · h-3.5 glyph (14) · text-xs (12).
        XCTAssertEqual(PinButtonSize.small.controlSide, 28)
        XCTAssertEqual(PinButtonSize.small.glyphPointSize, 14)
        XCTAssertEqual(PinButtonSize.small.labelPointSize, 12)
        // Web md = h-8 w-8 (32) · h-4 glyph (16) · text-sm (14).
        XCTAssertEqual(PinButtonSize.medium.controlSide, 32)
        XCTAssertEqual(PinButtonSize.medium.glyphPointSize, 16)
        XCTAssertEqual(PinButtonSize.medium.labelPointSize, 14)
    }
}

// MARK: - Presentation (lucide → SF Symbol + tone + copy)

final class PinButtonPresentationTests: XCTestCase {
    func testUnpinnedPresentationMirrorsWebPin() {
        let presentation = PinPresentation.unpinned
        XCTAssertEqual(presentation.symbolName, "pin")
        XCTAssertEqual(presentation.tone, .idle)
        XCTAssertEqual(presentation.tooltipKey, "pin.pin")
        XCTAssertEqual(presentation.tooltipFallback, "Pin")
        XCTAssertEqual(presentation.labelKey, "pin.pin")
        XCTAssertEqual(presentation.labelFallback, "Pin")
    }

    func testPinnedPresentationMirrorsWebPinOff() {
        let presentation = PinPresentation.pinned
        XCTAssertEqual(presentation.symbolName, "pin.slash.fill")
        XCTAssertEqual(presentation.tone, .pinned)
        XCTAssertEqual(presentation.tooltipKey, "pin.unpin")
        XCTAssertEqual(presentation.tooltipFallback, "Unpin")
        // Web: the tooltip says "Unpin" but the inline label says "Pinned".
        XCTAssertEqual(presentation.labelKey, "pin.pinned")
        XCTAssertEqual(presentation.labelFallback, "Pinned")
    }
}

// MARK: - Pin membership (web `pinned.some(p => String(p.item_id) === idStr)`)

final class PinButtonMembershipTests: XCTestCase {
    func testIsPinnedTrueWhenSetContainsID() {
        XCTAssertTrue(PinButtonProjector.isPinned(pinnedIDs: ["1", "7"], itemID: "7"))
    }

    func testIsPinnedFalseWhenAbsentOrEmpty() {
        XCTAssertFalse(PinButtonProjector.isPinned(pinnedIDs: ["1", "7"], itemID: "9"))
        XCTAssertFalse(PinButtonProjector.isPinned(pinnedIDs: [], itemID: "1"))
    }
}

// MARK: - Status badge precedence (offline → error → stale → none)

final class PinButtonStatusBadgeTests: XCTestCase {
    func testFreshLoadedYieldsNoBadge() {
        XCTAssertNil(PinButtonProjector.statusBadge(status: .loaded, freshness: .fresh))
    }

    func testOfflineTakesPrecedenceOverFailure() {
        // Offline is the root cause even when the status is also a failure.
        let badge = PinButtonProjector.statusBadge(status: .failed("x"), freshness: .offline)
        XCTAssertEqual(badge?.tone, .offline)
        XCTAssertEqual(badge?.messageKey, "pin.status.offline")
        XCTAssertEqual(badge?.showsRetry, false)
    }

    func testFailureBeatsStale() {
        let badge = PinButtonProjector.statusBadge(status: .failed("x"), freshness: .stale)
        XCTAssertEqual(badge?.tone, .error)
        XCTAssertEqual(badge?.messageKey, "pin.status.error")
        XCTAssertEqual(badge?.showsRetry, true)
    }

    func testStaleWhenLoadedButAged() {
        let badge = PinButtonProjector.statusBadge(status: .loaded, freshness: .stale)
        XCTAssertEqual(badge?.tone, .stale)
        XCTAssertEqual(badge?.messageKey, "pin.status.stale")
        XCTAssertEqual(badge?.showsRetry, true)
    }
}

// MARK: - Resolve (the full projection across every branch)

final class PinButtonResolveTests: XCTestCase {
    private func input(itemID: String = "1", showLabel: Bool = false) -> PinButtonInput {
        PinButtonInput(itemType: .vehicle, itemID: itemID, size: .small, showLabel: showLabel)
    }

    func testUnpinnedLoadedEmptySet() {
        let projection = PinButtonProjector.resolve(input(), snapshot: .loaded(pinnedIDs: []))
        XCTAssertFalse(projection.isPinned)
        XCTAssertEqual(projection.presentation, .unpinned)
        XCTAssertFalse(projection.isBusy)
        XCTAssertFalse(projection.isAwaitingFirstLoad)
        XCTAssertTrue(projection.isInteractive)
        XCTAssertNil(projection.statusBadge)
    }

    func testPinnedWhenSetContainsID() {
        let projection = PinButtonProjector.resolve(input(itemID: "7"), snapshot: .loaded(pinnedIDs: ["7"]))
        XCTAssertTrue(projection.isPinned)
        XCTAssertEqual(projection.presentation, .pinned)
        XCTAssertTrue(projection.isInteractive)
    }

    func testBusyWhenItemIsPending() {
        // Web `toggle.isPending` → disabled.
        let snapshot = PinnedSnapshot(
            status: .loaded,
            pinnedIDs: ["1"],
            pendingItemIDs: ["1"],
            hasLoaded: true
        )
        let projection = PinButtonProjector.resolve(input(), snapshot: snapshot)
        XCTAssertTrue(projection.isBusy)
        XCTAssertFalse(projection.isInteractive)
        // A different item's pending mutation does NOT disable this button.
        let other = PinButtonProjector.resolve(input(itemID: "2"), snapshot: snapshot)
        XCTAssertFalse(other.isBusy)
        XCTAssertTrue(other.isInteractive)
    }

    func testColdLoadShowsSpinnerAndBlocksToggle() {
        let snapshot = PinnedSnapshot(status: .loading, pinnedIDs: [], hasLoaded: false)
        let projection = PinButtonProjector.resolve(input(), snapshot: snapshot)
        XCTAssertTrue(projection.isAwaitingFirstLoad)
        XCTAssertFalse(projection.isInteractive)
        XCTAssertFalse(projection.isPinned, "web `pinned = []` default → not pinned while cold")
    }

    func testRefreshLoadKeepsCachedPinnedness() {
        // Loading AFTER a successful load (hasLoaded) keeps the cached glyph — no spinner, still tappable.
        let snapshot = PinnedSnapshot(status: .loading, pinnedIDs: ["1"], hasLoaded: true)
        let projection = PinButtonProjector.resolve(input(), snapshot: snapshot)
        XCTAssertFalse(projection.isAwaitingFirstLoad)
        XCTAssertTrue(projection.isPinned)
        XCTAssertTrue(projection.isInteractive)
    }

    func testFailedWithCacheKeepsPinAndShowsErrorBadge() {
        let snapshot = PinnedSnapshot(status: .failed("boom"), pinnedIDs: ["1"], hasLoaded: true)
        let projection = PinButtonProjector.resolve(input(), snapshot: snapshot)
        XCTAssertTrue(projection.isPinned, "cached pin stays applied beneath the error badge")
        XCTAssertEqual(projection.statusBadge?.tone, .error)
        XCTAssertTrue(projection.isInteractive, "web keeps the button interactive on query error")
    }

    func testShowLabelPassthrough() {
        XCTAssertTrue(PinButtonProjector.resolve(input(showLabel: true), snapshot: .loaded()).showsLabel)
        XCTAssertFalse(PinButtonProjector.resolve(input(showLabel: false), snapshot: .loaded()).showsLabel)
    }
}

// MARK: - Value-type equality + snapshot helper

final class PinButtonValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = PinButtonInput(itemType: .vehicle, itemID: "1", context: "dash", size: .medium, showLabel: true)
        let rhs = PinButtonInput(itemType: .vehicle, itemID: "1", context: "dash", size: .medium, showLabel: true)
        XCTAssertEqual(lhs, rhs)
        let other = PinButtonInput(itemType: .vehicle, itemID: "1", context: nil, size: .medium, showLabel: true)
        XCTAssertNotEqual(lhs, other)
    }

    func testLoadedSnapshotHelper() {
        let snapshot = PinnedSnapshot.loaded(pinnedIDs: ["1"], freshness: .stale)
        XCTAssertEqual(snapshot.status, .loaded)
        XCTAssertEqual(snapshot.freshness, .stale)
        XCTAssertTrue(snapshot.hasLoaded)
        XCTAssertEqual(snapshot.pinnedIDs, ["1"])
        XCTAssertTrue(snapshot.pendingItemIDs.isEmpty)
    }

    func testToggleCallEquality() {
        let lhs = PinToggleCall(itemID: "1", context: nil, pinned: true)
        XCTAssertEqual(lhs, PinToggleCall(itemID: "1", context: nil, pinned: true))
        XCTAssertNotEqual(lhs, PinToggleCall(itemID: "1", context: nil, pinned: false))
    }
}
