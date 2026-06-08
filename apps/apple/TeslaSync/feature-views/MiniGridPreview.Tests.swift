//
//  MiniGridPreview.Tests.swift
//  TeslaSync — P4 feature view · 0128 · MiniGridPreview (Apple)
//
//  Host-free unit coverage for the MiniGridPreview surface. MiniGridPreview is a
//  pure presentational thumbnail (the web source fetches nothing), so the
//  meaningful, render-free surface area is:
//    • the projection geometry — columns, the web `maxY ⇒ safeMaxY` guard, the
//      per-item fractional rects, layout order, aspect ratio, empty/count,
//    • the widget→icon join (present / instance-missing / unknown id),
//    • the default icon catalog (full registry coverage + the registry-miss nil),
//    • the accessibility phrasing (empty + singular/plural summary),
//    • the P1/S11 `view.opened` telemetry slug.
//  These mirror the web `dashboard.layouts.lg ?? []`, `Math.max(...y+h) : 2`,
//  the `item.x/cols` percentages, and `getWidgetDef(widgetId)?.icon`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (folded in at integration
//  time, like every per-surface bundle).
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Helpers

private func makeDashboard(
    widgets: [MiniGridWidgetInstance],
    items: [MiniGridLayoutItem],
    breakpoint: String = "lg"
) -> MiniGridDashboard {
    MiniGridDashboard(widgets: widgets, layouts: [breakpoint: items])
}

/// A deterministic icon resolver for join tests (independent of the catalog).
private struct StubIconResolver: MiniGridIconResolving {
    let map: [String: String]
    func systemImage(forWidgetID widgetID: String) -> String? {
        map[widgetID]
    }
}

// MARK: - Projection geometry (web render math)

final class MiniGridProjectionGeometryTests: XCTestCase {
    private let accuracy: CGFloat = 1e-9

    func testColumnsAreAlwaysFour() {
        // web `cols = GRID_COLS.lg` — a constant 4.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)
        ]))
        XCTAssertEqual(projection.columns, 4)
        XCTAssertEqual(MiniGridLayout.columns, 4)
    }

    func testRowsAreMaxYOfItems() {
        // web `maxY = Math.max(...lgLayout.map(l => l.y + l.h))`.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 2, heightUnits: 2),
            MiniGridLayoutItem(identifier: "b", x: 2, y: 1, widthUnits: 1, heightUnits: 1),
            MiniGridLayoutItem(identifier: "c", x: 0, y: 2, widthUnits: 4, heightUnits: 1)
        ]))
        XCTAssertEqual(projection.rows, 3) // max(0+2, 1+1, 2+1) = 3
    }

    func testEmptyLayoutFallsBackToTwoRows() {
        // web `lgLayout.length > 0 ? … : 2`.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: []))
        XCTAssertEqual(projection.rows, 2)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.widgetCount, 0)
    }

    func testDegenerateMaxYFallsBackToTwoRows() {
        // web `safeMaxY = maxY > 0 && finite ? maxY : 2` — a zero span guards to 2.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "z", x: 0, y: 0, widthUnits: 1, heightUnits: 0)
        ]))
        XCTAssertEqual(projection.rows, 2)
    }

    func testMissingLgLayoutIsTreatedAsEmpty() {
        // web `dashboard.layouts.lg ?? []` — a dashboard with only another
        // breakpoint previews as empty.
        let dashboard = MiniGridDashboard(
            widgets: [MiniGridWidgetInstance(instanceID: "a", widgetID: "fleet-stats")],
            layouts: ["md": [MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)]]
        )
        let projection = MiniGridProjection(dashboard: dashboard)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.rows, 2)
    }

    func testFractionalRectsAreItemOverGrid() throws {
        // web inline: left=x/cols, top=y/safeMaxY, width=w/cols, height=h/safeMaxY.
        // rows here = max(2+2) = 4, cols = 4 → all fractions are exact halves.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 2, y: 2, widthUnits: 2, heightUnits: 2)
        ]))
        let tile = try XCTUnwrap(projection.tiles.first)
        XCTAssertEqual(tile.originX, 0.5, accuracy: accuracy)
        XCTAssertEqual(tile.originY, 0.5, accuracy: accuracy)
        XCTAssertEqual(tile.width, 0.5, accuracy: accuracy)
        XCTAssertEqual(tile.height, 0.5, accuracy: accuracy)
    }

    func testFractionalRectsHandleThirds() throws {
        // rows = max(0+1, 0+3) = 3 → top/height are exact thirds.
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "tall", x: 0, y: 0, widthUnits: 1, heightUnits: 3),
            MiniGridLayoutItem(identifier: "small", x: 1, y: 1, widthUnits: 1, heightUnits: 1)
        ]))
        XCTAssertEqual(projection.rows, 3)
        let small = try XCTUnwrap(projection.tiles.first { $0.id == "small" })
        XCTAssertEqual(small.originX, 0.25, accuracy: accuracy) // 1/4
        XCTAssertEqual(small.originY, 1.0 / 3.0, accuracy: accuracy)
        XCTAssertEqual(small.height, 1.0 / 3.0, accuracy: accuracy)
    }

    func testTilesPreserveLayoutOrder() {
        // web `lgLayout.map(...)` — render order is layout order.
        let items = [
            MiniGridLayoutItem(identifier: "first", x: 0, y: 0, widthUnits: 1, heightUnits: 1),
            MiniGridLayoutItem(identifier: "second", x: 1, y: 0, widthUnits: 1, heightUnits: 1),
            MiniGridLayoutItem(identifier: "third", x: 2, y: 0, widthUnits: 1, heightUnits: 1)
        ]
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: items))
        XCTAssertEqual(projection.tiles.map(\.id), ["first", "second", "third"])
    }

    func testAspectRatioIsColumnsOverRows() {
        // web `aspectRatio: ${cols} / ${safeMaxY}`.
        let twoRow = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 2)
        ]))
        XCTAssertEqual(twoRow.aspectRatio, 2.0, accuracy: accuracy) // 4 / 2

        let emptyAspect = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: []))
        XCTAssertEqual(emptyAspect.aspectRatio, 2.0, accuracy: accuracy) // 4 / 2 (fallback)
    }

    func testProjectionIsEquatable() {
        let lhs = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)
        ]))
        let rhs = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: [
            MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)
        ]))
        XCTAssertEqual(lhs, rhs)
    }
}

// MARK: - Widget → icon join (web `getWidgetDef(widget.widgetId)?.icon`)

final class MiniGridIconJoinTests: XCTestCase {
    private let resolver = StubIconResolver(map: ["battery-gauge": "battery.100"])

    func testResolvesIconForMatchedWidget() throws {
        let dashboard = makeDashboard(
            widgets: [MiniGridWidgetInstance(instanceID: "a", widgetID: "battery-gauge")],
            items: [MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)]
        )
        let tile = try XCTUnwrap(MiniGridProjection(dashboard: dashboard, iconResolver: resolver).tiles.first)
        XCTAssertEqual(tile.systemImage, "battery.100")
        XCTAssertTrue(tile.showsIcon)
    }

    func testNoIconWhenNoWidgetMatchesLayoutItem() throws {
        // web `dashboard.widgets.find(...)` → undefined → `def` null → no Icon.
        let dashboard = makeDashboard(
            widgets: [],
            items: [MiniGridLayoutItem(identifier: "orphan", x: 0, y: 0, widthUnits: 1, heightUnits: 1)]
        )
        let tile = try XCTUnwrap(MiniGridProjection(dashboard: dashboard, iconResolver: resolver).tiles.first)
        XCTAssertNil(tile.systemImage)
        XCTAssertFalse(tile.showsIcon)
    }

    func testNoIconWhenWidgetIDUnknownToResolver() throws {
        // web `getWidgetDef(widgetId)` → undefined → no Icon.
        let dashboard = makeDashboard(
            widgets: [MiniGridWidgetInstance(instanceID: "a", widgetID: "not-a-widget")],
            items: [MiniGridLayoutItem(identifier: "a", x: 0, y: 0, widthUnits: 1, heightUnits: 1)]
        )
        let tile = try XCTUnwrap(MiniGridProjection(dashboard: dashboard, iconResolver: resolver).tiles.first)
        XCTAssertNil(tile.systemImage)
    }

    func testJoinMatchesInstanceIDToLayoutKey() throws {
        // web join is `widget.id === item.i`, not widgetId — verify the key used.
        let dashboard = makeDashboard(
            widgets: [MiniGridWidgetInstance(instanceID: "battery-gauge", widgetID: "fleet-stats")],
            items: [MiniGridLayoutItem(identifier: "battery-gauge", x: 0, y: 0, widthUnits: 1, heightUnits: 1)]
        )
        // The instance id collides with a widgetId, but the resolver keys off the
        // instance's widgetId ("fleet-stats"), which the stub doesn't know → nil.
        let tile = try XCTUnwrap(MiniGridProjection(dashboard: dashboard, iconResolver: resolver).tiles.first)
        XCTAssertNil(tile.systemImage)
    }
}

// MARK: - Default catalog (faithful registry port)

final class MiniGridWidgetIconCatalogTests: XCTestCase {
    private let catalog = MiniGridWidgetIconCatalog()

    func testCoversTheFullWebRegistry() {
        // The web registry pins 118 widget ids; the catalog must cover them all.
        XCTAssertEqual(MiniGridWidgetIconCatalog.coverage, 118)
    }

    func testResolvesFaithfulSymbolsForKnownWidgets() {
        // Spot-check the lucide → SF Symbol parity for a spread of categories.
        XCTAssertEqual(catalog.systemImage(forWidgetID: "alert-feed"), "bell.fill")
        XCTAssertEqual(catalog.systemImage(forWidgetID: "fleet-stats"), "chart.bar.fill")
        XCTAssertEqual(catalog.systemImage(forWidgetID: "energy-stats"), "bolt.fill")
        XCTAssertEqual(catalog.systemImage(forWidgetID: "guard-mode"), "shield.fill")
        XCTAssertEqual(catalog.systemImage(forWidgetID: "battery-gauge"), "battery.100")
        XCTAssertEqual(catalog.systemImage(forWidgetID: "year-review"), "calendar")
    }

    func testReturnsNilForUnknownWidget() {
        // web `getWidgetDef` miss → undefined.
        XCTAssertNil(catalog.systemImage(forWidgetID: "totally-unknown"))
        XCTAssertNil(catalog.systemImage(forWidgetID: ""))
    }

    func testEverySymbolIsNonEmpty() {
        for symbol in MiniGridWidgetIconCatalog.symbols.values {
            XCTAssertFalse(symbol.isEmpty)
        }
    }
}

// MARK: - Accessibility phrasing

final class MiniGridPreviewAccessibilityTests: XCTestCase {
    func testEmptyCaptionIsNonEmpty() {
        XCTAssertFalse(MiniGridPreviewAccessibility.emptyCaption.isEmpty)
    }

    func testSummaryEmptyDiffersFromPopulated() {
        let empty = MiniGridPreviewAccessibility.summary(widgetCount: 0)
        XCTAssertTrue(empty.lowercased().contains("no widget"), empty)
    }

    func testSummarySingularSaysOneWidget() {
        let one = MiniGridPreviewAccessibility.summary(widgetCount: 1)
        XCTAssertTrue(one.contains("1 widget"), one)
        XCTAssertFalse(one.contains("1 widgets"), one) // never "1 widgets"
    }

    func testSummaryPluralIncludesCount() {
        let many = MiniGridPreviewAccessibility.summary(widgetCount: 7)
        XCTAssertTrue(many.contains("7"), many)
        XCTAssertTrue(many.lowercased().contains("widget"), many)
    }
}

// MARK: - Surface slug + telemetry (P1/S11 view.opened)

final class MiniGridPreviewTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyMiniGridPreviewTelemetry()
        MiniGridPreviewSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["MiniGridPreview"])
    }

    func testReportOpenEmitsTheExactSlugEachTime() {
        let spy = SpyMiniGridPreviewTelemetry()
        MiniGridPreviewSurface.reportOpen(to: spy)
        MiniGridPreviewSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["MiniGridPreview", "MiniGridPreview"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(MiniGridPreviewSurface.slug, "MiniGridPreview")
        XCTAssertEqual(MiniGridPreview.surfaceSlug, MiniGridPreviewSurface.slug)
        let projection = MiniGridProjection(dashboard: makeDashboard(widgets: [], items: []))
        XCTAssertEqual(projection.surfaceSlug, MiniGridPreviewSurface.slug)
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyMiniGridPreviewTelemetry: MiniGridPreviewTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
