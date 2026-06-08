//
//  DashboardGrid.Tests.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  Unit coverage for the DashboardGrid surface: the breakpoint resolver (web
//  `getBreakpointFromWidth`), the layout projections (`getWidgetSizeLive`, mobile
//  `orderedWidgets`, the auto-flow `placements`, the render + fullscreen contexts),
//  the absolute-placement geometry, the kiosk-opacity map, the freshness chip, the
//  connection chip gating, the render-state accessor, the VoiceOver summaries, the
//  i18n key parity (referenced == the web/native keys), and the P1/S11 `view.opened`
//  telemetry. No network, no real store, no rendering host — the pure projections
//  are exercised directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func widget(
        _ id: String,
        widgetID: String = "type",
        name: String = "Widget",
        vehicleID: Int? = nil,
        cols: Int = 1,
        rows: Int = 1
    ) -> DashboardWidgetInstance {
        DashboardWidgetInstance(
            id: id,
            widgetId: widgetID,
            name: name,
            vehicleId: vehicleID,
            defaultSize: DashboardWidgetSpan(cols: cols, rows: rows)
        )
    }

    static func item(_ id: String, _ posX: Int, _ posY: Int, _ cols: Int, _ rows: Int) -> DashboardGridLayoutItem {
        DashboardGridLayoutItem(id: id, x: posX, y: posY, columnSpan: cols, rowSpan: rows)
    }
}

// MARK: - Breakpoint (web GRID_BREAKPOINTS / getBreakpointFromWidth)

final class DashboardBreakpointTests: XCTestCase {
    func testResolvePicksLargestThresholdAtOrBelowWidth() {
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 1300), .lg)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 1200), .lg)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 1199), .md)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 996), .md)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 995), .sm)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 768), .sm)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 767), .xs)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 480), .xs)
        XCTAssertEqual(DashboardBreakpoint.resolve(width: 0), .xs)
    }

    func testColumns() {
        XCTAssertEqual(DashboardBreakpoint.lg.columns, 4)
        XCTAssertEqual(DashboardBreakpoint.md.columns, 3)
        XCTAssertEqual(DashboardBreakpoint.sm.columns, 2)
        XCTAssertEqual(DashboardBreakpoint.xs.columns, 1)
    }

    func testIsMobileStackOnlyXS() {
        XCTAssertFalse(DashboardBreakpoint.lg.isMobileStack)
        XCTAssertFalse(DashboardBreakpoint.md.isMobileStack)
        XCTAssertFalse(DashboardBreakpoint.sm.isMobileStack)
        XCTAssertTrue(DashboardBreakpoint.xs.isMobileStack)
    }

    func testOrderedDescendingByThreshold() {
        XCTAssertEqual(DashboardBreakpoint.ordered, [.lg, .md, .sm, .xs])
    }
}

// MARK: - Layout projections (getWidgetSizeLive / orderedWidgets / placements / contexts)

final class DashboardLayoutMathTests: XCTestCase {
    private func layouts() -> DashboardGridLayouts {
        DashboardGridLayouts([
            .lg: [Fixture.item("A", 0, 0, 2, 3)],
            .md: [Fixture.item("A", 0, 0, 1, 1)]
        ])
    }

    func testWidgetSizeReadsActiveBreakpoint() {
        let size = DashboardGridLayoutMath.widgetSize(
            instanceID: "A",
            layouts: layouts(),
            breakpoint: .lg,
            widgets: []
        )
        XCTAssertEqual(size, DashboardWidgetSpan(cols: 2, rows: 3))
    }

    func testWidgetSizePrefersExactBreakpointOverLG() {
        let size = DashboardGridLayoutMath.widgetSize(
            instanceID: "A",
            layouts: layouts(),
            breakpoint: .md,
            widgets: []
        )
        XCTAssertEqual(size, DashboardWidgetSpan(cols: 1, rows: 1))
    }

    func testWidgetSizeFallsBackToLGThenDefaultThen1x1() {
        // sm has no layout → falls back to lg item.
        XCTAssertEqual(
            DashboardGridLayoutMath.widgetSize(instanceID: "A", layouts: layouts(), breakpoint: .sm, widgets: []),
            DashboardWidgetSpan(cols: 2, rows: 3)
        )
        // B is in no layout → falls back to its registry defaultSize.
        XCTAssertEqual(
            DashboardGridLayoutMath.widgetSize(
                instanceID: "B",
                layouts: layouts(),
                breakpoint: .lg,
                widgets: [Fixture.widget("B", cols: 2, rows: 2)]
            ),
            DashboardWidgetSpan(cols: 2, rows: 2)
        )
        // Unknown id → 1×1.
        XCTAssertEqual(
            DashboardGridLayoutMath.widgetSize(instanceID: "Z", layouts: layouts(), breakpoint: .lg, widgets: []),
            DashboardWidgetSpan(cols: 1, rows: 1)
        )
    }

    func testOrderedWidgetsDesktopKeepsInsertionOrder() {
        let widgets = [Fixture.widget("A"), Fixture.widget("B"), Fixture.widget("C")]
        let ordered = DashboardGridLayoutMath.orderedWidgets(widgets, layouts: layouts(), isMobileStack: false)
        XCTAssertEqual(ordered.map(\.id), ["A", "B", "C"])
    }

    func testOrderedWidgetsMobileEmptyXSKeepsInsertionOrder() {
        let widgets = [Fixture.widget("A"), Fixture.widget("B")]
        let ordered = DashboardGridLayoutMath.orderedWidgets(widgets, layouts: layouts(), isMobileStack: true)
        XCTAssertEqual(ordered.map(\.id), ["A", "B"])
    }

    func testOrderedWidgetsMobileHonorsSavedXSOrder() {
        let widgets = [Fixture.widget("A"), Fixture.widget("B"), Fixture.widget("C")]
        let layouts = DashboardGridLayouts([
            .xs: [Fixture.item("C", 0, 0, 1, 1), Fixture.item("A", 0, 1, 1, 1), Fixture.item("B", 0, 2, 1, 1)]
        ])
        let ordered = DashboardGridLayoutMath.orderedWidgets(widgets, layouts: layouts, isMobileStack: true)
        XCTAssertEqual(ordered.map(\.id), ["C", "A", "B"])
    }

    func testOrderedWidgetsMobileKeepsUnplacedAfterPlaced() {
        let widgets = [Fixture.widget("A"), Fixture.widget("B"), Fixture.widget("C")]
        let layouts = DashboardGridLayouts([
            .xs: [Fixture.item("B", 0, 0, 1, 1), Fixture.item("A", 0, 1, 1, 1)]
        ])
        // C is absent from the xs layout → kept after the placed ones, insertion order.
        let ordered = DashboardGridLayoutMath.orderedWidgets(widgets, layouts: layouts, isMobileStack: true)
        XCTAssertEqual(ordered.map(\.id), ["B", "A", "C"])
    }

    func testPlacementsUsesSavedItemsClampedToColumns() {
        let widgets = [Fixture.widget("A", cols: 2, rows: 3), Fixture.widget("D", cols: 2, rows: 1)]
        let layouts = DashboardGridLayouts([
            .lg: [Fixture.item("A", 0, 0, 2, 3), Fixture.item("D", 9, 0, 2, 1)]
        ])
        let placements = DashboardGridLayoutMath.placements(for: widgets, layouts: layouts, breakpoint: .lg)
        XCTAssertEqual(placements["A"], Fixture.item("A", 0, 0, 2, 3))
        // x=9 clamped to columns(4) - span(2) = 2.
        XCTAssertEqual(placements["D"], Fixture.item("D", 2, 0, 2, 1))
    }

    func testPlacementsAutoFlowsUnsavedWidgetsWithWrap() {
        let widgets = [
            Fixture.widget("E", cols: 3, rows: 1),
            Fixture.widget("F", cols: 2, rows: 1),
            Fixture.widget("G", cols: 2, rows: 1)
        ]
        let placements = DashboardGridLayoutMath.placements(
            for: widgets,
            layouts: DashboardGridLayouts(),
            breakpoint: .lg
        )
        XCTAssertEqual(placements["E"], Fixture.item("E", 0, 0, 3, 1))
        // E leaves cursor at x=3; F(span 2) would overflow 4 cols → wraps to row 1.
        XCTAssertEqual(placements["F"], Fixture.item("F", 0, 1, 2, 1))
        XCTAssertEqual(placements["G"], Fixture.item("G", 2, 1, 2, 1))
    }

    func testRenderContextResolvesSizeAndVehicleScope() {
        let widgets = [Fixture.widget("w", widgetID: "battery", name: "Battery", cols: 1, rows: 1)]
        let layouts = DashboardGridLayouts([.lg: [Fixture.item("w", 0, 0, 2, 2)]])
        let context = DashboardGridLayoutMath.renderContext(
            for: widgets[0],
            layouts: layouts,
            breakpoint: .lg,
            widgets: widgets,
            dashboardVehicleID: 5
        )
        XCTAssertEqual(context.size, DashboardWidgetSpan(cols: 2, rows: 2))
        XCTAssertEqual(context.vehicleId, 5) // widget override nil → dashboard filter
        XCTAssertEqual(context.name, "Battery")
        XCTAssertFalse(context.isFullscreen)
    }

    func testRenderContextWidgetVehicleOverridesDashboard() {
        let widget = Fixture.widget("w", vehicleID: 9)
        let context = DashboardGridLayoutMath.renderContext(
            for: widget,
            layouts: DashboardGridLayouts(),
            breakpoint: .lg,
            widgets: [widget],
            dashboardVehicleID: 5
        )
        XCTAssertEqual(context.vehicleId, 9)
    }

    func testFullscreenContextFloorsRowsAtFour() {
        let widget = Fixture.widget("w", cols: 2, rows: 2)
        let small = DashboardGridLayoutMath.fullscreenContext(
            for: widget,
            layouts: DashboardGridLayouts([.lg: [Fixture.item("w", 0, 0, 2, 2)]]),
            breakpoint: .lg,
            widgets: [widget],
            dashboardVehicleID: nil
        )
        XCTAssertEqual(small.size, DashboardWidgetSpan(cols: 2, rows: 4))
        XCTAssertTrue(small.isFullscreen)

        let tall = DashboardGridLayoutMath.fullscreenContext(
            for: widget,
            layouts: DashboardGridLayouts([.lg: [Fixture.item("w", 0, 0, 2, 6)]]),
            breakpoint: .lg,
            widgets: [widget],
            dashboardVehicleID: nil
        )
        XCTAssertEqual(tall.size, DashboardWidgetSpan(cols: 2, rows: 6))
    }
}

// MARK: - Placement geometry (native equivalent of RGL x/y/w/h)

final class DashboardGridPlacementTests: XCTestCase {
    func testColumnWidth() {
        XCTAssertEqual(
            DashboardGridPlacement.columnWidth(totalWidth: 1000, columns: 4, spacing: 16),
            238,
            accuracy: 0.0001
        )
    }

    func testColumnWidthGuardsZeroColumns() {
        XCTAssertEqual(
            DashboardGridPlacement.columnWidth(totalWidth: 120, columns: 0, spacing: 16),
            120,
            accuracy: 0.0001
        )
    }

    func testFrameOriginAndSpan() {
        let frame = DashboardGridPlacement.frame(
            for: Fixture.item("x", 2, 1, 1, 2),
            columnWidth: 238,
            rowHeight: 80,
            spacing: 16
        )
        XCTAssertEqual(frame.minX, 508, accuracy: 0.0001) // 2 * (238 + 16)
        XCTAssertEqual(frame.minY, 96, accuracy: 0.0001) // 1 * (80 + 16)
        XCTAssertEqual(frame.width, 238, accuracy: 0.0001) // 1 column
        XCTAssertEqual(frame.height, 176, accuracy: 0.0001) // 2 * 80 + 1 * 16
    }

    func testContentHeightUsesBottomMostRow() {
        let items = [Fixture.item("a", 0, 0, 1, 2), Fixture.item("b", 1, 2, 1, 2)]
        XCTAssertEqual(
            DashboardGridPlacement.contentHeight(items: items, rowHeight: 80, spacing: 16),
            368,
            accuracy: 0.0001
        ) // bottomRow 4 → 4 * 80 + 3 * 16
    }

    func testContentHeightEmptyIsZero() {
        XCTAssertEqual(
            DashboardGridPlacement.contentHeight(items: [], rowHeight: 80, spacing: 16),
            0,
            accuracy: 0.0001
        )
    }
}

// MARK: - Kiosk boost (web kioskPanelStyle)

final class DashboardKioskStyleTests: XCTestCase {
    func testNilOpacityYieldsNoStyle() {
        XCTAssertNil(DashboardKioskStyle.resolve(opacity: nil))
    }

    func testOpacityMap() throws {
        let full = try XCTUnwrap(DashboardKioskStyle.resolve(opacity: 1.0))
        XCTAssertEqual(full.backgroundOpacity, 0.20, accuracy: 1e-9) // 0.03 + 1.0 * 0.17
        XCTAssertEqual(full.blurRadius, 16, accuracy: 1e-9) // 4 + 1.0 * 12

        let mid = try XCTUnwrap(DashboardKioskStyle.resolve(opacity: 0.5))
        XCTAssertEqual(mid.backgroundOpacity, 0.115, accuracy: 1e-9)
        XCTAssertEqual(mid.blurRadius, 10, accuracy: 1e-9)
    }
}

// MARK: - Freshness chip + connection gating

final class DashboardFreshnessTests: XCTestCase {
    func testChipProjection() {
        XCTAssertNil(DashboardGridFreshnessChip.project(.live))
        XCTAssertEqual(DashboardGridFreshnessChip.project(.stale), .stale)
        XCTAssertEqual(DashboardGridFreshnessChip.project(.offline), .offline)
    }

    func testChipMetadata() {
        XCTAssertEqual(DashboardGridFreshnessChip.stale.labelKey, "dashboard.grid.freshness.stale")
        XCTAssertEqual(DashboardGridFreshnessChip.stale.labelFallback, "Stale")
        XCTAssertEqual(DashboardGridFreshnessChip.stale.systemImage, "clock.arrow.circlepath")
        XCTAssertEqual(DashboardGridFreshnessChip.stale.tone, .warning)
        XCTAssertEqual(DashboardGridFreshnessChip.offline.labelKey, "dashboard.grid.freshness.offline")
        XCTAssertEqual(DashboardGridFreshnessChip.offline.labelFallback, "Offline")
        XCTAssertEqual(DashboardGridFreshnessChip.offline.systemImage, "wifi.slash")
        XCTAssertEqual(DashboardGridFreshnessChip.offline.tone, .neutral)
    }

    func testConnectionShowsChip() {
        XCTAssertFalse(DashboardGridConnection.live.showsChip)
        XCTAssertTrue(DashboardGridConnection.stale.showsChip)
        XCTAssertTrue(DashboardGridConnection.offline.showsChip)
    }
}

// MARK: - Render state

final class DashboardGridStateTests: XCTestCase {
    func testDashboardAccessor() {
        let data = DashboardGridData(id: "d", name: "n", widgets: [], layouts: DashboardGridLayouts())
        XCTAssertEqual(DashboardGridState.loaded(data).dashboard, data)
        XCTAssertNil(DashboardGridState.loading.dashboard)
        XCTAssertNil(DashboardGridState.empty.dashboard)
        XCTAssertNil(DashboardGridState.error(message: nil).dashboard)
    }
}

// MARK: - Accessibility + i18n key parity

final class DashboardGridAccessibilityTests: XCTestCase {
    private let echo = DashboardGridLocalizer.echo

    func testGridAndTileLabels() {
        XCTAssertEqual(DashboardGridAccessibility.gridLabel(echo), "Dashboard widget grid")
        XCTAssertEqual(DashboardGridAccessibility.tileLabel("Battery", localize: echo), "Battery widget")
    }

    func testWebParityControlLabels() {
        XCTAssertEqual(DashboardGridAccessibility.settingsLabel("Battery", localize: echo), "Settings for Battery")
        XCTAssertEqual(DashboardGridAccessibility.removeLabel("Battery", localize: echo), "Remove Battery")
        XCTAssertEqual(DashboardGridAccessibility.expandLabel("Battery", localize: echo), "Expand Battery")
        XCTAssertEqual(
            DashboardGridAccessibility.dragHandleLabel("Battery", localize: echo),
            "Drag to reorder Battery"
        )
        XCTAssertEqual(DashboardGridAccessibility.exitFullscreenLabel(echo), "Exit Fullscreen")
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

final class DashboardGridTelemetryTests: XCTestCase {
    private final class Recorder: DashboardGridTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    @MainActor
    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        DashboardGridSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["DashboardGrid"])
        XCTAssertEqual(DashboardGridSurface.slug, "DashboardGrid")
        XCTAssertEqual(DashboardGrid<EmptyView>.surfaceSlug, "DashboardGrid")
    }
}
