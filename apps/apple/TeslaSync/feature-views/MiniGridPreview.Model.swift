//
//  MiniGridPreview.Model.swift
//  TeslaSync — P4 feature view · 0128 · MiniGridPreview (Apple)
//
//  Pure, host-free projection layer for the MiniGridPreview surface — the
//  SwiftUI parity of features/dashboard/components/MiniGridPreview.tsx.
//
//  MiniGridPreview is a *presentational* component: the web source fetches
//  nothing (it takes a `dashboard` prop and the imported `getWidgetDef`). So,
//  exactly like the sibling HighlightCard / ToolCard surfaces, the remote phases
//  (loading / error / stale / offline) belong to whatever data-bound caller
//  embeds the preview (the dashboard manager), not to the preview itself. The
//  branches the preview *does* own — the grid geometry (columns, the maxY ⇒
//  safeMaxY guard, per-item fractional rects), the per-item widget→icon lookup,
//  and the empty layout that must read as a friendly state instead of a blank
//  box — are modelled here as `Equatable` value types so every branch is
//  unit-testable without a render host.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `MiniGridPreview` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract;
/// the view and its tests both read it from here so the two never drift.
public enum MiniGridPreviewSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "MiniGridPreview"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any MiniGridPreviewTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Grid constants (web `GRID_COLS.lg` + the maxY fallback)

/// The fixed grid geometry the preview reproduces from the web source. The web
/// `MiniGridPreview` always previews the large (`lg`) breakpoint at
/// `GRID_COLS.lg = 4`, and falls back to `2` rows when a layout has no items
/// (web `maxY … : 2`).
public enum MiniGridLayout {
    /// Columns in the previewed layout (web `GRID_COLS.lg`).
    public static let columns = 4
    /// Rows used when the layout is empty or degenerate (web `maxY … : 2`).
    public static let fallbackRows = 2
    /// The breakpoint the web preview always renders (web `dashboard.layouts.lg`).
    public static let breakpoint = "lg"
}

// MARK: - Domain value types (native parity of SavedDashboard / RGLLayout)

/// One placed item in a dashboard layout — the native parity of a react-grid
/// `RGLLayout` (`i`, `x`, `y`, `w`, `h`) reduced to the fields the preview reads.
public struct MiniGridLayoutItem: Equatable, Sendable {
    /// The layout key, joined to a widget instance's id (web `i` ↔ `widget.id`).
    public let identifier: String
    /// Column offset in grid units (web `x`).
    public let x: Int
    /// Row offset in grid units (web `y`).
    public let y: Int
    /// Column span in grid units (web `w`).
    public let widthUnits: Int
    /// Row span in grid units (web `h`).
    public let heightUnits: Int

    public init(identifier: String, x: Int, y: Int, widthUnits: Int, heightUnits: Int) {
        self.identifier = identifier
        self.x = x
        self.y = y
        self.widthUnits = widthUnits
        self.heightUnits = heightUnits
    }
}

/// A placed widget instance — native parity of `WidgetInstance` (`id`,
/// `widgetId`) reduced to the fields the preview reads.
public struct MiniGridWidgetInstance: Equatable, Sendable {
    /// The instance id, joined to a layout item (web `widget.id` ↔ `item.i`).
    public let instanceID: String
    /// The registry widget id used to resolve the icon (web `widget.widgetId`).
    public let widgetID: String

    public init(instanceID: String, widgetID: String) {
        self.instanceID = instanceID
        self.widgetID = widgetID
    }
}

/// The slice of a `SavedDashboard` the preview consumes: its widget instances
/// and the breakpoint-keyed layouts. Other `SavedDashboard` fields (name, icon,
/// timestamps, settings) are irrelevant to the thumbnail and intentionally
/// omitted so the preview binds to the smallest possible shape.
public struct MiniGridDashboard: Equatable, Sendable {
    /// The placed widget instances (web `dashboard.widgets`).
    public let widgets: [MiniGridWidgetInstance]
    /// Breakpoint-keyed layouts (web `dashboard.layouts`, e.g. `lg`/`md`/…).
    public let layouts: [String: [MiniGridLayoutItem]]

    public init(
        widgets: [MiniGridWidgetInstance],
        layouts: [String: [MiniGridLayoutItem]]
    ) {
        self.widgets = widgets
        self.layouts = layouts
    }

    /// The layout for the previewed breakpoint, or empty (web `layouts.lg ?? []`).
    public func layout(for breakpoint: String) -> [MiniGridLayoutItem] {
        layouts[breakpoint] ?? []
    }
}

// MARK: - Tile (one positioned box in the thumbnail)

/// A single positioned box in the preview, expressed as fractions of the
/// container (web inline `left/top/width/height` percentages), plus the optional
/// SF Symbol resolved for the widget (web `def?.icon`).
public struct MiniGridTile: Equatable, Identifiable, Sendable {
    /// Stable id, the layout item key (web `key={item.i}`).
    public let id: String
    /// Left edge as a fraction of width (web `item.x / cols`).
    public let originX: CGFloat
    /// Top edge as a fraction of height (web `item.y / safeMaxY`).
    public let originY: CGFloat
    /// Width as a fraction of the container (web `item.w / cols`).
    public let width: CGFloat
    /// Height as a fraction of the container (web `item.h / safeMaxY`).
    public let height: CGFloat
    /// The SF Symbol for the widget, or `nil` when the widget/icon is unknown
    /// (web `{Icon && …}`).
    public let systemImage: String?

    public init(
        id: String,
        originX: CGFloat,
        originY: CGFloat,
        width: CGFloat,
        height: CGFloat,
        systemImage: String?
    ) {
        self.id = id
        self.originX = originX
        self.originY = originY
        self.width = width
        self.height = height
        self.systemImage = systemImage
    }

    /// Whether this tile shows a glyph (web `Icon && …`).
    public var showsIcon: Bool {
        systemImage != nil
    }
}

// MARK: - Projection (pure port of the web render math)

/// The pure, `Equatable` projection of a dashboard into the thumbnail's grid
/// geometry and tiles. Computing this in a value type lets the XCTest suite
/// cover the `maxY ⇒ safeMaxY` guard, the per-item fractions, the widget→icon
/// join, and the empty state without a snapshot host.
public struct MiniGridProjection: Equatable, Sendable {
    /// Columns in the grid (web `cols`).
    public let columns: Int
    /// Rows the thumbnail is divided into (web `safeMaxY`).
    public let rows: Int
    /// The positioned tiles, in layout order (web `lgLayout.map`).
    public let tiles: [MiniGridTile]

    /// Builds the projection for `dashboard`, resolving each widget's icon
    /// through `iconResolver`. `breakpoint` defaults to the web `lg` preview.
    public init(
        dashboard: MiniGridDashboard,
        iconResolver: any MiniGridIconResolving = MiniGridWidgetIconCatalog(),
        breakpoint: String = MiniGridLayout.breakpoint
    ) {
        let layoutItems = dashboard.layout(for: breakpoint)
        let columns = MiniGridLayout.columns

        // web: maxY = length>0 ? max(y+h) : 2 ; safeMaxY = maxY>0 && finite ? maxY : 2.
        // Integer grid units are always finite, so the guard reduces to maxY>0.
        let maxRow = layoutItems.map { $0.y + $0.heightUnits }.max() ?? MiniGridLayout.fallbackRows
        let rows = maxRow > 0 ? maxRow : MiniGridLayout.fallbackRows

        self.columns = columns
        self.rows = rows
        tiles = layoutItems.map { item in
            let widget = dashboard.widgets.first { $0.instanceID == item.identifier }
            let symbol = widget.flatMap { iconResolver.systemImage(forWidgetID: $0.widgetID) }
            return MiniGridTile(
                id: item.identifier,
                originX: CGFloat(item.x) / CGFloat(columns),
                originY: CGFloat(item.y) / CGFloat(rows),
                width: CGFloat(item.widthUnits) / CGFloat(columns),
                height: CGFloat(item.heightUnits) / CGFloat(rows),
                systemImage: symbol
            )
        }
    }

    /// The container aspect ratio, width:height (web `aspectRatio: cols/safeMaxY`).
    public var aspectRatio: CGFloat {
        CGFloat(columns) / CGFloat(rows)
    }

    /// Whether the previewed layout has no tiles — the friendly empty state
    /// (web `lgLayout.length === 0`, which renders a bare bordered box).
    public var isEmpty: Bool {
        tiles.isEmpty
    }

    /// The number of tiles rendered (one per placed layout item).
    public var widgetCount: Int {
        tiles.count
    }

    /// The diagnostics slug this projection belongs to.
    public var surfaceSlug: String {
        MiniGridPreviewSurface.slug
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's *own* strings by key with a web-style English
/// fallback so the view holds no hardcoded literals. The previewed dashboard's
/// name/widgets are supplied by the caller (the web component takes them as a
/// prop), so only the preview's intrinsic chrome — the empty-state caption and
/// the VoiceOver summary — lives here. Keys live in the "MiniGridPreview" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum MiniGridStrings {
    public static let table = "MiniGridPreview"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver phrasing for the surface and the visible empty caption.
/// Kept pure + injectable so the a11y contract can be asserted without
/// rendering. The thumbnail is a single, non-interactive summary element.
public enum MiniGridPreviewAccessibility {
    /// The visible caption shown when a layout has no widgets (never a blank box).
    public static var emptyCaption: String {
        MiniGridStrings.string("miniGridPreview.empty", "No widgets")
    }

    /// The spoken summary for the thumbnail. Empty, singular, and plural forms
    /// are distinct so VoiceOver never says "1 widgets".
    public static func summary(widgetCount: Int) -> String {
        switch widgetCount {
        case 0:
            return MiniGridStrings.string(
                "miniGridPreview.a11y.empty",
                "Dashboard layout preview, no widgets"
            )
        case 1:
            return MiniGridStrings.string(
                "miniGridPreview.a11y.summary.one",
                "Dashboard layout preview, 1 widget"
            )
        default:
            let format = MiniGridStrings.string(
                "miniGridPreview.a11y.summary.other",
                "Dashboard layout preview, %d widgets"
            )
            return String(format: format, widgetCount)
        }
    }
}
