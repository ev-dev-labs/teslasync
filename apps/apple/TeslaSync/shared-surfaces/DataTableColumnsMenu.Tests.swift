//
//  DataTableColumnsMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value types live
//  in DataTableColumnsMenu.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DataTableColumnsMenuController — the once-only `view.opened`, the controlled-state mutations (toggle
//      mirrors the keys out through `onChange`; the last-visible guard is a no-op that doesn't notify;
//      showAll sets + notifies), the host-pushed `apply` (no re-notify), the popover open state, and the
//      derived projections + labels.
//    • Views — the public host + every subview compose in each branch (populated / required / empty).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DataTableColumnsMenuController (state + mutations + routing)

@MainActor
final class DataTableColumnsMenuControllerTests: XCTestCase {
    private func columns() -> [DataTableColumnsMenuColumn] {
        [
            DataTableColumnsMenuColumn(key: "select", header: "", isRequired: true),
            DataTableColumnsMenuColumn(key: "a", header: "A"),
            DataTableColumnsMenuColumn(key: "b", header: "B"),
            DataTableColumnsMenuColumn(key: "c", header: "C")
        ]
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyColumnsTelemetry()
        let controller = DataTableColumnsMenuController(columns: columns(), telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [DataTableColumnsMenuSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyColumnsTelemetry()
        let controller = DataTableColumnsMenuController(columns: columns(), telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [DataTableColumnsMenuSurface.slug], "view.opened fires once per instance")
    }

    func testInitialStateDefaultsToAllVisible() {
        let controller = DataTableColumnsMenuController(columns: columns())
        XCTAssertEqual(controller.visibleKeys, ["select", "a", "b", "c"])
        XCTAssertFalse(controller.isOpen)
        XCTAssertFalse(controller.isEmpty)
    }

    func testInitialStateHonorsSuppliedVisibleKeys() {
        let controller = DataTableColumnsMenuController(columns: columns(), visibleKeys: ["select", "a"])
        XCTAssertEqual(controller.visibleKeys, ["select", "a"])
        XCTAssertEqual(controller.visibleColumns.map(\.key), ["select", "a"])
    }

    func testToggleHideUpdatesKeysAndNotifies() {
        let recorder = KeysRecorder()
        let controller = DataTableColumnsMenuController(
            columns: columns(),
            visibleKeys: ["select", "a", "b"],
            onChange: recorder.onChange
        )
        controller.toggle("a")
        XCTAssertEqual(controller.visibleKeys, ["select", "b"])
        XCTAssertEqual(recorder.keys.count, 1)
        XCTAssertEqual(recorder.keys.last, ["select", "b"])
    }

    func testToggleShowRebuildsInSourceOrderAndNotifies() {
        let recorder = KeysRecorder()
        let controller = DataTableColumnsMenuController(
            columns: columns(),
            visibleKeys: ["c", "select"],
            onChange: recorder.onChange
        )
        controller.toggle("a")
        XCTAssertEqual(controller.visibleKeys, ["select", "a", "c"], "show rebuilds in source order")
        XCTAssertEqual(recorder.keys.last, ["select", "a", "c"])
    }

    func testToggleLastVisibleIsNoOp() {
        let recorder = KeysRecorder()
        let controller = DataTableColumnsMenuController(
            columns: columns(),
            visibleKeys: ["a"],
            onChange: recorder.onChange
        )
        controller.toggle("a")
        XCTAssertEqual(controller.visibleKeys, ["a"], "keys unchanged")
        XCTAssertTrue(recorder.keys.isEmpty, "a refused toggle does not notify")
    }

    func testShowAllSetsEveryKeyAndNotifies() {
        let recorder = KeysRecorder()
        let controller = DataTableColumnsMenuController(
            columns: columns(),
            visibleKeys: ["a"],
            onChange: recorder.onChange
        )
        controller.showAll()
        XCTAssertEqual(controller.visibleKeys, ["select", "a", "b", "c"])
        XCTAssertEqual(recorder.keys.last, ["select", "a", "b", "c"])
    }

    func testApplyPushesKeysWithoutNotifying() {
        let recorder = KeysRecorder()
        let controller = DataTableColumnsMenuController(columns: columns(), onChange: recorder.onChange)
        controller.apply(["b", "c"])
        XCTAssertEqual(controller.visibleKeys, ["b", "c"])
        XCTAssertTrue(recorder.keys.isEmpty, "a host-pushed selection does not echo back through onChange")
    }

    func testPopoverOpenState() {
        let controller = DataTableColumnsMenuController(columns: columns())
        controller.openMenu()
        XCTAssertTrue(controller.isOpen)
        controller.closeMenu()
        XCTAssertFalse(controller.isOpen)
        controller.toggleMenu()
        XCTAssertTrue(controller.isOpen)
    }

    func testDerivedRowsAndLabels() {
        let controller = DataTableColumnsMenuController(columns: columns(), visibleKeys: ["select", "a"])
        XCTAssertEqual(controller.rows.map(\.key), ["select", "a", "b", "c"])
        XCTAssertEqual(controller.menuLabel, "Show or hide columns")
        XCTAssertEqual(controller.headingLabel, "Visible columns")
    }

    func testIsEmptyWhenNoColumns() {
        let controller = DataTableColumnsMenuController(columns: [])
        XCTAssertTrue(controller.isEmpty)
        XCTAssertTrue(controller.rows.isEmpty)
        XCTAssertTrue(controller.visibleKeys.isEmpty)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class DataTableColumnsMenuViewTests: XCTestCase {
    private func controller() -> DataTableColumnsMenuController {
        DataTableColumnsMenuController(columns: [
            DataTableColumnsMenuColumn(key: "select", header: "", isRequired: true),
            DataTableColumnsMenuColumn(key: "a", header: "A"),
            DataTableColumnsMenuColumn(key: "b", header: "B")
        ])
    }

    func testSurfaceSlugExposed() {
        XCTAssertEqual(
            DataTableColumnsMenu<DataTableColumnsMenuTriggerButton>.surfaceSlug,
            "DataTableColumnsMenu"
        )
    }

    func testHostComposesWithDefaultAndCustomTrigger() {
        let controller = controller()
        _ = DataTableColumnsMenu(controller: controller)
        _ = DataTableColumnsMenu(controller: controller) { ctrl in
            Button("Open") { ctrl.toggleMenu() }
        }
        _ = DataTableColumnsMenuTriggerButton(controller: controller)
    }

    func testPanelComposesForPopulatedAndEmpty() {
        _ = DataTableColumnsMenuPanel(controller: controller())
        _ = DataTableColumnsMenuPanel(controller: DataTableColumnsMenuController(columns: []))
        _ = DataTableColumnsMenuPanel(
            controller: DataTableColumnsMenuController(
                columns: [DataTableColumnsMenuColumn(key: "a", header: "A")],
                visibleKeys: ["a"]
            )
        )
    }

    func testSubviewsCompose() {
        _ = DataTableColumnsMenuHeader(heading: "Visible columns", onShowAll: {})
        let row = DataTableColumnsMenuRow(key: "a", label: "A", isVisible: true, toggleDisabled: false)
        _ = DataTableColumnsMenuRowView(row: row) {}
        let pinned = DataTableColumnsMenuRow(key: "select", label: "select", isVisible: true, toggleDisabled: true)
        _ = DataTableColumnsMenuRowView(row: pinned) {}
        _ = DataTableColumnsMenuCheckboxToggleStyle()
        _ = DataTableColumnsMenuEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class DataTableColumnsMenuStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(DataTableColumnsMenuStrings.menu, "Show or hide columns")
        XCTAssertEqual(DataTableColumnsMenuStrings.button, "Columns")
        XCTAssertEqual(DataTableColumnsMenuStrings.heading, "Visible columns")
        XCTAssertEqual(DataTableColumnsMenuStrings.showAll, "Show all")
        XCTAssertEqual(DataTableColumnsMenuStrings.empty, "No columns to configure")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyColumnsTelemetry: DataTableColumnsMenuTelemetry, @unchecked Sendable {
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

/// Records the key sets mirrored through `onChange` (the web DataTable's persistence call site).
@MainActor
private final class KeysRecorder {
    private(set) var keys: [[String]] = []

    func onChange(_ next: [String]) {
        keys.append(next)
    }
}
