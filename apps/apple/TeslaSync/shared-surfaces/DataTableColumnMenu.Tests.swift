//
//  DataTableColumnMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + value types live
//  in DataTableColumnMenu.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DataTableColumnMenuController — the once-only `view.opened`, the controlled-state mutations
//      (toggle / move / moveUp / moveDown mirror the layout out through `onChange`; the last-visible +
//      off-end guards are no-ops that don't notify), reset (clears the layout + fires `onReset`), the
//      host-pushed `apply` (no re-notify), the popover open state, and the derived projections + reorder
//      -aware labels.
//    • Views — the public host + every subview compose in each branch (populated / required / empty /
//      visibility-only / reorder-only / custom trigger).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks, including the
//      `{{col}}` interpolation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DataTableColumnMenuController (state + mutations + routing)

@MainActor
final class DataTableColumnMenuControllerTests: XCTestCase {
    private func columns() -> [ColumnDescriptor] {
        [
            ColumnDescriptor(key: "a", header: "A"),
            ColumnDescriptor(key: "b", header: "B"),
            ColumnDescriptor(key: "c", header: "C", defaultVisible: false),
            ColumnDescriptor(key: "d", header: "D")
        ]
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let controller = DataTableColumnMenuController(columns: columns(), telemetry: spy)
        controller.start()
        controller.start()
        XCTAssertEqual(spy.surfaces, [DataTableColumnMenuSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let controller = DataTableColumnMenuController(columns: columns(), telemetry: spy)
        controller.start()
        controller.stop()
        controller.start()
        XCTAssertEqual(spy.surfaces, [DataTableColumnMenuSurface.slug], "view.opened fires once per instance")
    }

    func testInitialState() {
        let controller = DataTableColumnMenuController(columns: columns())
        XCTAssertNil(controller.layout)
        XCTAssertTrue(controller.reorderable)
        XCTAssertTrue(controller.toggleable)
        XCTAssertFalse(controller.isOpen)
        XCTAssertEqual(controller.visibleCount, 3, "c is defaultVisible:false")
        XCTAssertFalse(controller.isEmpty)
    }

    func testToggleUpdatesLayoutAndNotifies() {
        let recorder = LayoutRecorder()
        let controller = DataTableColumnMenuController(columns: columns(), onChange: recorder.onChange)
        controller.toggle("a")
        XCTAssertEqual(controller.layout?.hidden.sorted(), ["a", "c"])
        XCTAssertEqual(recorder.layouts.count, 1)
        XCTAssertEqual(recorder.layouts.last?.hidden.sorted(), ["a", "c"])
    }

    func testToggleLastVisibleIsNoOp() {
        let recorder = LayoutRecorder()
        let cols = [ColumnDescriptor(key: "a", header: "A"), ColumnDescriptor(key: "b", header: "B")]
        let controller = DataTableColumnMenuController(
            columns: cols,
            layout: ColumnLayout(order: ["a", "b"], hidden: ["b"]), // only 'a' visible
            onChange: recorder.onChange
        )
        controller.toggle("a")
        XCTAssertEqual(controller.layout?.hidden, ["b"], "layout unchanged")
        XCTAssertTrue(recorder.layouts.isEmpty, "a refused toggle does not notify")
    }

    func testMoveUpAndDownUpdateLayoutAndNotify() {
        let recorder = LayoutRecorder()
        let controller = DataTableColumnMenuController(columns: columns(), onChange: recorder.onChange)
        controller.moveUp("b")
        XCTAssertEqual(controller.layout?.order, ["b", "a", "c", "d"])
        controller.moveDown("b")
        XCTAssertEqual(controller.layout?.order, ["a", "b", "c", "d"])
        XCTAssertEqual(recorder.layouts.count, 2)
    }

    func testMoveOffEndIsNoOp() {
        let recorder = LayoutRecorder()
        let controller = DataTableColumnMenuController(columns: columns(), onChange: recorder.onChange)
        controller.moveUp("a") // already first
        controller.moveDown("d") // already last
        XCTAssertNil(controller.layout, "no mutation happened")
        XCTAssertTrue(recorder.layouts.isEmpty)
    }

    func testResetClearsLayoutAndNotifies() {
        let recorder = LayoutRecorder()
        let controller = DataTableColumnMenuController(
            columns: columns(),
            layout: ColumnLayout(order: ["d", "a"], hidden: ["b"]),
            onChange: recorder.onChange,
            onReset: recorder.onReset
        )
        controller.reset()
        XCTAssertNil(controller.layout)
        XCTAssertEqual(recorder.resetCount, 1)
    }

    func testApplyPushesLayoutWithoutNotifying() {
        let recorder = LayoutRecorder()
        let controller = DataTableColumnMenuController(columns: columns(), onChange: recorder.onChange)
        let pushed = ColumnLayout(order: ["d", "c", "b", "a"], hidden: ["a"])
        controller.apply(pushed)
        XCTAssertEqual(controller.layout, pushed)
        XCTAssertTrue(recorder.layouts.isEmpty, "a host-pushed layout does not echo back through onChange")
    }

    func testPopoverOpenState() {
        let controller = DataTableColumnMenuController(columns: columns())
        controller.openMenu()
        XCTAssertTrue(controller.isOpen)
        controller.closeMenu()
        XCTAssertFalse(controller.isOpen)
        controller.toggleMenu()
        XCTAssertTrue(controller.isOpen)
    }

    func testDerivedRowsAndVisibleColumns() {
        let controller = DataTableColumnMenuController(columns: columns())
        XCTAssertEqual(controller.rows.map(\.key), ["a", "b", "c", "d"])
        XCTAssertEqual(controller.visibleColumns.map(\.key), ["a", "b", "d"])
    }

    func testReorderAwareLabels() {
        let reorder = DataTableColumnMenuController(columns: columns(), reorderable: true)
        XCTAssertEqual(reorder.triggerLabel, "Reorder or hide columns")
        XCTAssertEqual(reorder.headingLabel, "Columns")
        let checklist = DataTableColumnMenuController(columns: columns(), reorderable: false)
        XCTAssertEqual(checklist.triggerLabel, "Show or hide columns")
        XCTAssertEqual(checklist.headingLabel, "Visible columns")
    }

    func testIsEmptyWhenNoColumns() {
        let controller = DataTableColumnMenuController(columns: [])
        XCTAssertTrue(controller.isEmpty)
        XCTAssertTrue(controller.rows.isEmpty)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class DataTableColumnMenuViewTests: XCTestCase {
    private func controller() -> DataTableColumnMenuController {
        DataTableColumnMenuController(columns: [
            ColumnDescriptor(key: "sel", header: "", isRequired: true),
            ColumnDescriptor(key: "a", header: "A"),
            ColumnDescriptor(key: "b", header: "B")
        ])
    }

    func testSurfaceSlugExposed() {
        XCTAssertEqual(DataTableColumnMenu<DataTableColumnMenuTriggerButton>.surfaceSlug, "DataTableColumnMenu")
    }

    func testHostComposesWithDefaultAndCustomTrigger() {
        let controller = controller()
        _ = DataTableColumnMenu(controller: controller)
        _ = DataTableColumnMenu(controller: controller) { ctrl in
            Button("Open") { ctrl.toggleMenu() }
        }
        _ = DataTableColumnMenuTriggerButton(controller: controller)
    }

    func testPanelComposesForPopulatedEmptyAndModes() {
        _ = DataTableColumnMenuPanel(controller: controller())
        _ = DataTableColumnMenuPanel(controller: DataTableColumnMenuController(columns: []))
        _ = DataTableColumnMenuPanel(controller: DataTableColumnMenuController(
            columns: [ColumnDescriptor(key: "a", header: "A")],
            reorderable: false
        ))
        _ = DataTableColumnMenuPanel(controller: DataTableColumnMenuController(
            columns: [ColumnDescriptor(key: "a", header: "A")],
            toggleable: false
        ))
    }

    func testSubviewsCompose() {
        _ = DataTableColumnMenuHeader(heading: "Columns", onReset: {})
        let row = ColumnMenuRow(
            key: "a",
            label: "A",
            isVisible: true,
            toggleDisabled: false,
            canMoveUp: false,
            canMoveDown: true
        )
        _ = DataTableColumnMenuRowView(
            row: row,
            toggleable: true,
            reorderable: true,
            onToggle: {},
            onMoveUp: {},
            onMoveDown: {}
        )
        let pinned = ColumnMenuRow(
            key: "sel",
            label: "sel",
            isVisible: true,
            toggleDisabled: true,
            canMoveUp: true,
            canMoveDown: false
        )
        _ = DataTableColumnMenuRowView(
            row: pinned,
            toggleable: true,
            reorderable: false,
            onToggle: {},
            onMoveUp: {},
            onMoveDown: {}
        )
        _ = DataTableColumnMenuStepButton(systemImage: "arrow.up", label: "Move A up", isEnabled: false) {}
        _ = ColumnVisibilityToggleStyle()
        _ = DataTableColumnMenuEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class DataTableColumnMenuStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(DataTableColumnMenuStrings.menuReorder, "Reorder or hide columns")
        XCTAssertEqual(DataTableColumnMenuStrings.menu, "Show or hide columns")
        XCTAssertEqual(DataTableColumnMenuStrings.button, "Columns")
        XCTAssertEqual(DataTableColumnMenuStrings.headingReorder, "Columns")
        XCTAssertEqual(DataTableColumnMenuStrings.heading, "Visible columns")
        XCTAssertEqual(DataTableColumnMenuStrings.reset, "Reset")
        XCTAssertEqual(DataTableColumnMenuStrings.empty, "No columns to configure")
    }

    func testInterpolatedFallbacks() {
        XCTAssertEqual(DataTableColumnMenuStrings.toggleColumn("Drive"), "Show or hide Drive")
        XCTAssertEqual(DataTableColumnMenuStrings.moveUp("Drive"), "Move Drive up")
        XCTAssertEqual(DataTableColumnMenuStrings.moveDown("Drive"), "Move Drive down")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: DataTableColumnMenuTelemetry, @unchecked Sendable {
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

/// Records the layouts mirrored through `onChange` and the `onReset` count (the web DataTable's persistence
/// call sites).
@MainActor
private final class LayoutRecorder {
    private(set) var layouts: [ColumnLayout] = []
    private(set) var resetCount = 0

    func onChange(_ layout: ColumnLayout) {
        layouts.append(layout)
    }

    func onReset() {
        resetCount += 1
    }
}
