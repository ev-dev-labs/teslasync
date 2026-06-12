//
//  DataTableBulkBar.Tests.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in DataTableBulkBar.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DataTableBulkBarModel — the once-only `view.opened`, the clear routing to `onClear`, the polite
//      "{{count}} selected" announcement (visible-only, with rotating padding), and the props update
//      (closure refresh + announce-on-count-change).
//    • Views — the public surface + the subviews compose in every real branch.
//    • Strings — the copy resolves through the P1/S10 facade with the web English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DataTableBulkBarModel (interaction state + routing)

@MainActor
final class DataTableBulkBarModelTests: XCTestCase {
    private func model(
        _ input: DataTableBulkBarInput,
        onClear: (@MainActor () -> Void)? = nil,
        telemetry: DataTableBulkBarTelemetry = OSLogDataTableBulkBarTelemetry(),
        announcer: DataTableBulkBarAnnouncer = OSLogDataTableBulkBarAnnouncer()
    ) -> DataTableBulkBarModel {
        DataTableBulkBarModel(input: input, onClear: onClear, telemetry: telemetry, announcer: announcer)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(DataTableBulkBarInput(count: 3), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DataTableBulkBarSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(DataTableBulkBarInput(count: 3), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DataTableBulkBarSurface.slug], "view.opened fires once per instance")
    }

    func testClearRoutesToOnClear() {
        let recorder = ClearRecorder()
        let holder = model(DataTableBulkBarInput(count: 3), onClear: { recorder.record() })
        holder.clear()
        XCTAssertEqual(recorder.calls, 1, "web onClick={onClear}")
    }

    func testClearIsNoOpWithoutHandler() {
        let holder = model(DataTableBulkBarInput(count: 3))
        holder.clear()
        XCTAssertEqual(holder.announcement, "", "clear neither announces nor crashes without a handler")
    }

    func testAnnounceWhenVisibleSetsTextAndPostsToAnnouncer() {
        let announcer = RecordingAnnouncer()
        let holder = model(DataTableBulkBarInput(count: 3), announcer: announcer)
        holder.announceSelectionIfVisible()
        XCTAssertEqual(announcer.messages.count, 1)
        XCTAssertTrue(holder.announcement.hasPrefix("3 selected"))
        XCTAssertEqual(holder.announcement, announcer.messages.first)
    }

    func testAnnounceIsNoOpWhenHidden() {
        let announcer = RecordingAnnouncer()
        let holder = model(DataTableBulkBarInput(count: 0), announcer: announcer)
        holder.announceSelectionIfVisible()
        XCTAssertTrue(announcer.messages.isEmpty, "a hidden bar (count <= 0) never speaks")
        XCTAssertEqual(holder.announcement, "")
    }

    func testConsecutiveAnnouncementsDifferForReReading() {
        let announcer = RecordingAnnouncer()
        let holder = model(DataTableBulkBarInput(count: 3), announcer: announcer)
        holder.announceSelectionIfVisible()
        holder.announceSelectionIfVisible()
        XCTAssertEqual(announcer.messages.count, 2)
        XCTAssertNotEqual(announcer.messages[0], announcer.messages[1], "rotating padding forces a re-read")
    }

    func testUpdateAnnouncesOnVisibleCountChange() {
        let announcer = RecordingAnnouncer()
        let holder = model(DataTableBulkBarInput(count: 3), announcer: announcer)
        holder.update(DataTableBulkBarInput(count: 4), onClear: nil)
        XCTAssertEqual(holder.input.count, 4)
        XCTAssertEqual(announcer.messages.count, 1)
        XCTAssertTrue(announcer.messages[0].hasPrefix("4 selected"))
    }

    func testUpdateDoesNotAnnounceWhenCountUnchanged() {
        let announcer = RecordingAnnouncer()
        let holder = model(DataTableBulkBarInput(count: 3, hasActions: false), announcer: announcer)
        holder.update(DataTableBulkBarInput(count: 3, hasActions: true), onClear: nil)
        XCTAssertTrue(announcer.messages.isEmpty, "only a count change re-announces (web live region)")
        XCTAssertTrue(holder.projection.showsActions, "the new props still re-derive the projection")
    }

    func testUpdateRefreshesOnClearClosure() {
        let stale = ClearRecorder()
        let fresh = ClearRecorder()
        let holder = model(DataTableBulkBarInput(count: 3), onClear: { stale.record() })
        holder.update(DataTableBulkBarInput(count: 3), onClear: { fresh.record() })
        holder.clear()
        XCTAssertEqual(stale.calls, 0, "the stale closure is discarded")
        XCTAssertEqual(fresh.calls, 1, "clear routes through the refreshed closure")
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class DataTableBulkBarViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = DataTableBulkBar(count: 0, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer())
        _ = DataTableBulkBar(count: 1, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer())
        _ = DataTableBulkBar(count: 3, onClear: {}, announcer: OSLogDataTableBulkBarAnnouncer(), actions: {
            Text(verbatim: "Export")
            Text(verbatim: "Delete")
        })
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DataTableBulkBarModel(
            input: DataTableBulkBarInput(count: 7, hasActions: true),
            telemetry: SpyTelemetry()
        )
        _ = DataTableBulkBar(model: injected) { Text(verbatim: "Archive") }
        XCTAssertEqual(DataTableBulkBar<EmptyView>.surfaceSlug, "DataTableBulkBar")
    }

    func testSubviewsCompose() {
        let holder = DataTableBulkBarModel(input: DataTableBulkBarInput(count: 3, hasActions: true))
        _ = DataTableBulkBarBar(model: holder, actions: Text(verbatim: "Export"))
        _ = DataTableBulkBarClearButton {}
        _ = LiveDataTableBulkBarAnnouncer()
    }
}

// MARK: - Strings facade (P1/S10)

final class DataTableBulkBarStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(DataTableBulkBarStrings.regionLabel, "Bulk actions")
        XCTAssertEqual(DataTableBulkBarStrings.clear, "Clear selection")
    }

    func testSelectedInterpolatesCount() {
        XCTAssertEqual(DataTableBulkBarStrings.selected(1), "1 selected")
        XCTAssertEqual(DataTableBulkBarStrings.selected(42), "42 selected")
    }

    func testSelectionAnnouncementCarriesTheCountLabel() {
        XCTAssertTrue(DataTableBulkBarStrings.selectionAnnouncement(count: 5, sequence: 1).hasPrefix("5 selected"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift
/// 6 strict concurrency.
private final class SpyTelemetry: DataTableBulkBarTelemetry, @unchecked Sendable {
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

/// Records the polite announcements posted through the `@MainActor` announcer seam.
@MainActor
private final class RecordingAnnouncer: DataTableBulkBarAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}

/// Counts the clear requests routed out through the `@MainActor` `onClear` page closure.
@MainActor
private final class ClearRecorder {
    private(set) var calls = 0

    func record() {
        calls += 1
    }
}
