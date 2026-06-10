//
//  ImportPreviewModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The pure presentation projection for the preview screen — the part of
//  features/dashboard/components/ImportPreviewModal.tsx's `ImportPreview` sub-component that turns a
//  resolved `ImportValidation` into rendered values: the count badges (web `import.availableCount` /
//  `import.missingCount`), the widget-availability rows (web `availableWidgets.map` + the strikethrough
//  `missingWidgets.map`, each resolving `getWidgetDef(id)?.name`/`.icon`), and the embedded mini-grid
//  thumbnail geometry (web `<MiniGridPreview dashboard={dashboard} />`, the `lg` breakpoint at
//  `GRID_COLS.lg = 4` with the `maxY ⇒ safeMaxY` guard). All `Equatable` value types so every branch
//  is unit-tested without a render host. The modal/preview titles + VoiceOver copy live here too so
//  the views hold no English literal.
//

import CoreGraphics
import Foundation

// MARK: - Widget-availability row (web `availableWidgets.map` / `missingWidgets.map`)

/// One row in the preview's widget list: an available widget (check + glyph + registry name) or a
/// missing one (X + struck-through raw id + "Not available").
public struct ImportPreviewWidgetRow: Sendable, Equatable, Identifiable {
    /// Stable list id — list position is folded in because the same widget id can repeat across
    /// instances (web `key={widgetId}` tolerates duplicates; SwiftUI's `ForEach` cannot).
    public let id: String
    public let widgetID: String
    /// Web `def?.name ?? widgetId` for an available widget; the raw id for a missing one.
    public let name: String
    /// The SF Symbol (web `def?.icon`), or `nil` when unknown / missing.
    public let icon: String?
    public let available: Bool

    public init(id: String, widgetID: String, name: String, icon: String?, available: Bool) {
        self.id = id
        self.widgetID = widgetID
        self.name = name
        self.icon = icon
        self.available = available
    }
}

// MARK: - Count badge (web `<Badge>` chips)

/// A count chip above the widget list (web `{{count}} widgets` / `{{count}} skipped`).
public struct ImportPreviewBadge: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case available, skipped }
    public let id: String
    public let text: String
    public let kind: Kind

    public init(id: String, text: String, kind: Kind) {
        self.id = id
        self.text = text
        self.kind = kind
    }
}

// MARK: - Mini-grid thumbnail (web `<MiniGridPreview>`)

/// One positioned box in the thumbnail (web `lgLayout.map`), as fractions of the container plus the
/// optional widget glyph.
public struct ImportPreviewTile: Sendable, Equatable, Identifiable {
    public let id: String
    public let originX: CGFloat
    public let originY: CGFloat
    public let width: CGFloat
    public let height: CGFloat
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
}

/// The resolved thumbnail geometry (web `MiniGridPreview` render math).
public struct ImportPreviewGrid: Sendable, Equatable {
    public let columns: Int
    public let rows: Int
    public let tiles: [ImportPreviewTile]

    public init(columns: Int, rows: Int, tiles: [ImportPreviewTile]) {
        self.columns = columns
        self.rows = rows
        self.tiles = tiles
    }

    /// Container aspect ratio, width:height (web `aspectRatio: cols/safeMaxY`).
    public var aspectRatio: CGFloat {
        CGFloat(columns) / CGFloat(rows)
    }

    /// Whether the layout has no placed tiles (web `lgLayout.length === 0`).
    public var isEmpty: Bool {
        tiles.isEmpty
    }
}

// MARK: - Projection

/// The pure resolution from a validation/dashboard into the preview's badges, widget rows, and
/// thumbnail geometry, plus the modal titles.
public enum ImportPreviewProjection {
    /// Web `GRID_COLS.lg`.
    static let previewColumns = 4
    /// Web `maxY … : 2` fallback rows.
    static let fallbackRows = 2
    /// The breakpoint the web preview always renders (web `dashboard.layouts.lg`).
    static let previewBreakpoint = "lg"

    /// The modal header title — web `title={t(validation ? 'import.preview' : 'import.title')}`.
    public static func title(isPreview: Bool, localize: (String, String) -> String) -> String {
        isPreview
            ? localize("import.preview", "Import Preview")
            : localize("import.title", "Import Dashboard")
    }

    /// The count chips (web `import.availableCount` always; `import.missingCount` only when some
    /// widgets were skipped).
    public static func badges(
        for validation: ImportPreviewValidation,
        localize: (String, String) -> String
    ) -> [ImportPreviewBadge] {
        var badges = [ImportPreviewBadge(
            id: "available",
            text: localize("import.availableCount", "{{count}} widgets")
                .replacingOccurrences(of: "{{count}}", with: String(validation.availableWidgets.count)),
            kind: .available
        )]
        if !validation.missingWidgets.isEmpty {
            badges.append(ImportPreviewBadge(
                id: "skipped",
                text: localize("import.missingCount", "{{count}} skipped")
                    .replacingOccurrences(of: "{{count}}", with: String(validation.missingWidgets.count)),
                kind: .skipped
            ))
        }
        return badges
    }

    /// The widget-availability rows — available first (web `availableWidgets.map`), then missing
    /// (web `missingWidgets.map`).
    public static func widgetRows(
        for validation: ImportPreviewValidation,
        catalog: any ImportPreviewWidgetCatalog
    ) -> [ImportPreviewWidgetRow] {
        let available = validation.availableWidgets.enumerated().map { index, widgetID in
            let def = catalog.definition(forWidgetID: widgetID)
            return ImportPreviewWidgetRow(
                id: "ok-\(index)-\(widgetID)",
                widgetID: widgetID,
                name: def?.name ?? widgetID,
                icon: def?.icon,
                available: true
            )
        }
        let missing = validation.missingWidgets.enumerated().map { index, widgetID in
            ImportPreviewWidgetRow(
                id: "no-\(index)-\(widgetID)",
                widgetID: widgetID,
                name: widgetID,
                icon: nil,
                available: false
            )
        }
        return available + missing
    }

    /// The thumbnail geometry for the dashboard's `lg` layout (web `MiniGridPreview`).
    public static func grid(
        for dashboard: ImportPreviewDashboard,
        catalog: any ImportPreviewWidgetCatalog
    ) -> ImportPreviewGrid {
        let items = dashboard.layout(for: previewBreakpoint)
        let columns = previewColumns
        let maxRow = items.map { $0.y + $0.heightUnits }.max() ?? fallbackRows
        let rows = maxRow > 0 ? maxRow : fallbackRows
        let tiles = items.map { item -> ImportPreviewTile in
            let widget = dashboard.widgets.first { $0.id == item.identifier }
            let symbol = widget.flatMap { catalog.definition(forWidgetID: $0.widgetID)?.icon }
            return ImportPreviewTile(
                id: item.identifier,
                originX: CGFloat(item.x) / CGFloat(columns),
                originY: CGFloat(item.y) / CGFloat(rows),
                width: CGFloat(item.widthUnits) / CGFloat(columns),
                height: CGFloat(item.heightUnits) / CGFloat(rows),
                systemImage: symbol
            )
        }
        return ImportPreviewGrid(columns: columns, rows: rows, tiles: tiles)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver phrasing. Pure + injectable so the a11y contract is assertable
/// without rendering.
public enum ImportPreviewAccessibility {
    /// The dialog summary — the active modal title (web Modal `title`).
    public static func dialogLabel(isPreview: Bool, localize: (String, String) -> String) -> String {
        ImportPreviewProjection.title(isPreview: isPreview, localize: localize)
    }

    /// The header/footer close button label (web Modal close).
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("common.close", "Close")
    }

    /// The spoken label for one widget-availability row, naming the widget and its state.
    public static func widgetRowLabel(
        _ row: ImportPreviewWidgetRow,
        localize: (String, String) -> String
    ) -> String {
        let state = row.available
            ? localize("import.a11y.available", "available")
            : localize("import.notAvailable", "Not available")
        return "\(row.name), \(state)"
    }
}
