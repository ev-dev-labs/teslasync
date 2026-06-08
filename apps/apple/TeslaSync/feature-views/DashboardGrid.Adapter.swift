//
//  DashboardGrid.Adapter.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  The pure, testable projection core for the DashboardGrid surface: the web
//  breakpoint constants + `getBreakpointFromWidth`/`activeBreakpoint`, the
//  `isMobileStack` switch, `getWidgetSizeLive`, the mobile `orderedWidgets`
//  sort, the compact-margin + kiosk-opacity maps, the absolute-grid placement
//  math (the native equivalent of RGL's x/y/w/h positioning), the live freshness
//  chip, the render-context builder (resolved size + vehicle scope), and the
//  VoiceOver summaries. No SwiftUI and no I/O — every branch the web source
//  carries is decided here so the XCTest suite can cover it without a rendering
//  host (the same approach the sibling feature views use).
//

import CoreGraphics
import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `DashboardGridStrings` facade (real catalog + English fallback),
/// tests pass `echo` (returns the fallback / formats it directly).
public struct DashboardGridLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = DashboardGridLocalizer(
        string: DashboardGridStrings.string,
        format: DashboardGridStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = DashboardGridLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Breakpoint (web `GRID_BREAKPOINTS` / `GRID_COLS` / `getBreakpointFromWidth`)

/// The responsive breakpoint the grid is rendering for — the port of the web
/// `GRID_BREAKPOINTS` keys with their column counts. `resolve(width:)` mirrors
/// react-grid-layout's `getBreakpointFromWidth`: pick the largest breakpoint whose
/// threshold is `<=` the container width, falling back to `xs`.
public enum DashboardBreakpoint: String, Equatable, Sendable, CaseIterable {
    case lg
    case md
    case sm
    case xs

    /// Web `GRID_BREAKPOINTS` — the minimum container width (pt) for the breakpoint.
    public var threshold: CGFloat {
        switch self {
        case .lg: 1200
        case .md: 996
        case .sm: 768
        case .xs: 480
        }
    }

    /// Web `GRID_COLS` — the column count at this breakpoint.
    public var columns: Int {
        switch self {
        case .lg: 4
        case .md: 3
        case .sm: 2
        case .xs: 1
        }
    }

    /// Web `isMobileStack` — the smallest breakpoint renders a full-width stack
    /// instead of the absolute grid.
    public var isMobileStack: Bool {
        self == .xs
    }

    /// Web `activeBreakpoint`: the largest breakpoint whose threshold `<=` width,
    /// `xs` when width is `0`/unknown or below the smallest threshold.
    public static func resolve(width: CGFloat) -> DashboardBreakpoint {
        for breakpoint in ordered where width >= breakpoint.threshold {
            return breakpoint
        }
        return .xs
    }

    /// Breakpoints ordered largest-threshold first so the first `resolve` match wins.
    static var ordered: [DashboardBreakpoint] {
        allCases.sorted { $0.threshold > $1.threshold }
    }
}

// MARK: - Grid metrics (web `ROW_HEIGHT` / `GRID_MARGIN` / mobile + fullscreen floors)

/// The fixed grid metrics — the port of the web `ROW_HEIGHT`, `GRID_MARGIN`
/// (and its compact `[8, 8]` variant), the mobile-stack min height (`min-h-[12rem]`),
/// the fullscreen `rows` floor, and the edit-mode dot-grid pitch.
public enum DashboardGridMetrics {
    /// Web `ROW_HEIGHT`.
    public static let rowHeight: CGFloat = 80
    /// Web `GRID_MARGIN` (the symmetric gap).
    public static let normalMargin: CGFloat = 16
    /// Web compact `margin={[8, 8]}`.
    public static let compactMargin: CGFloat = 8
    /// Web mobile-stack floor `min-h-[12rem]` (192pt).
    public static let mobileMinHeight: CGFloat = 192
    /// Web `FullscreenOverlay` floors the widget at `rows: Math.max(rows, 4)`.
    public static let fullscreenMinRows = 4
    /// Web edit-mode dot-grid `backgroundSize: 40px 40px`.
    public static let dotGridPitch: CGFloat = 40

    /// Web `margin={compactMode ? [8, 8] : GRID_MARGIN}`.
    public static func margin(compactMode: Bool) -> CGFloat {
        compactMode ? compactMargin : normalMargin
    }
}

// MARK: - Layout projections (web `getWidgetSizeLive` + `orderedWidgets`)

/// Pure layout projections shared by the desktop-grid and mobile-stack paths.
public enum DashboardGridLayoutMath {
    /// Web `getWidgetSizeLive`: read the widget's span from the active breakpoint's
    /// layout (falling back to `lg`), then to the widget's registry `defaultSize`,
    /// then to `1×1`.
    public static func widgetSize(
        instanceID: String,
        layouts: DashboardGridLayouts,
        breakpoint: DashboardBreakpoint,
        widgets: [DashboardWidgetInstance]
    ) -> DashboardWidgetSpan {
        let layout = layouts[breakpoint] ?? layouts[.lg] ?? []
        if let item = layout.first(where: { $0.id == instanceID }) {
            return DashboardWidgetSpan(cols: item.columnSpan, rows: item.rowSpan)
        }
        if let widget = widgets.first(where: { $0.id == instanceID }) {
            return widget.defaultSize
        }
        return DashboardWidgetSpan(cols: 1, rows: 1)
    }

    /// Web `orderedWidgets`: desktop keeps insertion order; the mobile stack honors
    /// the saved `xs` layout order (`y`-then-`x`, stable), with widgets missing from
    /// the layout kept in insertion order after the placed ones.
    public static func orderedWidgets(
        _ widgets: [DashboardWidgetInstance],
        layouts: DashboardGridLayouts,
        isMobileStack: Bool
    ) -> [DashboardWidgetInstance] {
        guard isMobileStack else { return widgets }
        let xsLayout = layouts[.xs] ?? []
        guard !xsLayout.isEmpty else { return widgets }

        var orderByID: [String: Double] = [:]
        for (index, item) in xsLayout.enumerated() {
            // Encode (y, x, index) into one sortable scalar so equal y/x fall back
            // to layout-array order — the web `l.y * 10000 + l.x * 100 + i / 1000`.
            orderByID[item.id] = Double(item.y) * 10000 + Double(item.x) * 100 + Double(index) / 1000
        }

        return widgets.enumerated()
            .sorted { lhs, rhs in
                let lhsOrder = orderByID[lhs.element.id]
                let rhsOrder = orderByID[rhs.element.id]
                switch (lhsOrder, rhsOrder) {
                case let (lhsValue?, rhsValue?):
                    return lhsValue == rhsValue ? lhs.offset < rhs.offset : lhsValue < rhsValue
                case (.some, nil):
                    return true
                case (nil, .some):
                    return false
                case (nil, nil):
                    return lhs.offset < rhs.offset
                }
            }
            .map(\.element)
    }

    /// Builds the render context for one tile — the resolved `size` (active layout)
    /// and `vehicleId` (per-widget override ?? dashboard filter), web
    /// `<Component vehicleId={widget.config?.vehicleId ?? dashboardVehicleId} size={size} />`.
    public static func renderContext(
        for widget: DashboardWidgetInstance,
        layouts: DashboardGridLayouts,
        breakpoint: DashboardBreakpoint,
        widgets: [DashboardWidgetInstance],
        dashboardVehicleID: Int?
    ) -> DashboardWidgetRenderContext {
        let size = widgetSize(
            instanceID: widget.id,
            layouts: layouts,
            breakpoint: breakpoint,
            widgets: widgets
        )
        return DashboardWidgetRenderContext(
            id: widget.id,
            widgetId: widget.widgetId,
            name: widget.name,
            size: size,
            vehicleId: widget.vehicleId ?? dashboardVehicleID
        )
    }

    /// The enlarged context for the fullscreen presentation — web `FullscreenOverlay`
    /// floors `rows` at `DashboardGridMetrics.fullscreenMinRows`.
    public static func fullscreenContext(
        for widget: DashboardWidgetInstance,
        layouts: DashboardGridLayouts,
        breakpoint: DashboardBreakpoint,
        widgets: [DashboardWidgetInstance],
        dashboardVehicleID: Int?
    ) -> DashboardWidgetRenderContext {
        let base = renderContext(
            for: widget,
            layouts: layouts,
            breakpoint: breakpoint,
            widgets: widgets,
            dashboardVehicleID: dashboardVehicleID
        )
        return DashboardWidgetRenderContext(
            id: base.id,
            widgetId: base.widgetId,
            name: base.name,
            size: DashboardWidgetSpan(
                cols: base.size.cols,
                rows: max(base.size.rows, DashboardGridMetrics.fullscreenMinRows)
            ),
            vehicleId: base.vehicleId,
            isFullscreen: true
        )
    }

    /// Resolves the absolute placement of every widget at a breakpoint, keyed by
    /// instance id. Saved layout entries (this breakpoint, falling back to `lg`) are
    /// clamped to the column count; widgets with no saved entry auto-flow left-to-
    /// right at their resolved span — the native equivalent of the web
    /// `buildDefaultLayouts` auto-placement, kept pure so the grid stays declarative.
    public static func placements(
        for widgets: [DashboardWidgetInstance],
        layouts: DashboardGridLayouts,
        breakpoint: DashboardBreakpoint
    ) -> [String: DashboardGridLayoutItem] {
        let columns = breakpoint.columns
        let saved = layouts[breakpoint] ?? layouts[.lg]
        var result: [String: DashboardGridLayoutItem] = [:]
        var cursorX = 0
        var cursorY = 0
        var rowSpanMax = 0

        for widget in widgets {
            if let item = saved?.first(where: { $0.id == widget.id }) {
                let span = min(max(item.columnSpan, 1), columns)
                result[widget.id] = DashboardGridLayoutItem(
                    id: widget.id,
                    x: min(max(item.x, 0), max(columns - span, 0)),
                    y: max(item.y, 0),
                    columnSpan: span,
                    rowSpan: max(item.rowSpan, 1)
                )
            } else {
                let size = widgetSize(
                    instanceID: widget.id,
                    layouts: layouts,
                    breakpoint: breakpoint,
                    widgets: widgets
                )
                let span = min(max(size.cols, 1), columns)
                let rows = max(size.rows, 1)
                if cursorX + span > columns {
                    cursorX = 0
                    cursorY += max(rowSpanMax, 1)
                    rowSpanMax = 0
                }
                result[widget.id] = DashboardGridLayoutItem(
                    id: widget.id,
                    x: cursorX,
                    y: cursorY,
                    columnSpan: span,
                    rowSpan: rows
                )
                cursorX += span
                rowSpanMax = max(rowSpanMax, rows)
            }
        }
        return result
    }
}
