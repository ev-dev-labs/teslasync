//
//  ExportModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The dependency-free projection core for the export-dashboard modal — the faithful port of the web
//  component's `useMemo` derivations and render branches: the pretty-printed export JSON (web
//  `JSON.stringify(dashboard, null, 2)`), its byte size badge (web `new Blob([json]).size` → "B" / "KB"),
//  the minimal share payload (web `buildMinimalExport`), the URL-safe base64 encoder (web
//  `toUrlSafeBase64`), the composed share URL (web `${origin}/dashboard#import=${encoded}`), the
//  over-length guard (web `shareUrl.length > 2000`), the body phase branches, and the mini-grid geometry
//  (web `MiniGridPreview`). Pure Foundation so every derivation is unit-tested without a bundle or a
//  rendered view. The value model lives in ExportModal.Adapter.swift; the state holder that drives these
//  lives in ExportModal.Model.swift.
//

import Foundation

// MARK: - Mini-grid geometry (web `MiniGridPreview`)

/// One placed cell of the mini grid preview, expressed in fractions of the preview's width / height so
/// the view positions it with a single multiply (web inline `left/top/width/height` percentages).
public struct ExportMiniGridCell: Sendable, Equatable, Identifiable {
    public let id: String
    public let leftFraction: Double
    public let topFraction: Double
    public let widthFraction: Double
    public let heightFraction: Double
    /// Whether a widget instance still backs this placement (web `dashboard.widgets.find(...)`); a
    /// dangling layout entry renders as an empty cell rather than crashing.
    public let hasWidget: Bool

    public init(
        id: String,
        leftFraction: Double,
        topFraction: Double,
        widthFraction: Double,
        heightFraction: Double,
        hasWidget: Bool
    ) {
        self.id = id
        self.leftFraction = leftFraction
        self.topFraction = topFraction
        self.widthFraction = widthFraction
        self.heightFraction = heightFraction
        self.hasWidget = hasWidget
    }
}

/// The resolved mini-grid preview (web `MiniGridPreview`): the column count, the safe row span, the
/// aspect ratio the container is locked to, and the placed cells.
public struct ExportMiniGrid: Sendable, Equatable {
    public let columns: Int
    public let rows: Int
    public let aspectRatio: Double
    public let cells: [ExportMiniGridCell]

    public init(columns: Int, rows: Int, aspectRatio: Double, cells: [ExportMiniGridCell]) {
        self.columns = columns
        self.rows = rows
        self.aspectRatio = aspectRatio
        self.cells = cells
    }
}

// MARK: - Projection

/// The dependency-free resolution from the exported dashboard to the export JSON, its size, the share
/// URL, the body phase, and the mini-grid geometry.
public enum ExportProjection {
    /// The mini-grid column count (web `GRID_COLS.lg`).
    public static let gridColumns = 4

    /// The row span used when the layout is empty or non-positive (web `safeMaxY` default of `2`).
    public static let fallbackRows = 2

    // MARK: Pretty export JSON (web `JSON.stringify(dashboard, null, 2)`)

    /// The full, indented export JSON for the size badge + the clipboard copy (web `dashboardJson`).
    /// Serialized with sorted keys + 2-space indentation so the output is deterministic across runs.
    public static func prettyJSON(for descriptor: DashboardExportDescriptor) -> String {
        serialize(fullObject(for: descriptor), pretty: true)
    }

    /// The UTF-8 byte size of the pretty JSON (web `new Blob([dashboardJson]).size`).
    public static func byteCount(for descriptor: DashboardExportDescriptor) -> Int {
        prettyJSON(for: descriptor).utf8.count
    }

    /// The human size badge (web `bytes < 1024 ? "{bytes} B" : "{kb} KB"` with one decimal place).
    public static func formatByteSize(_ bytes: Int) -> String {
        if bytes < ExportConstants.bytesPerKilobyte {
            return "\(bytes) B"
        }
        let kilobytes = Double(bytes) / Double(ExportConstants.bytesPerKilobyte)
        return String(format: "%.1f KB", kilobytes)
    }

    // MARK: Minimal share payload (web `buildMinimalExport`)

    /// The minimal, compact share payload (web `buildMinimalExport`): `{ name, widgets:[{id, widgetId,
    /// config?}], layouts }`, with widget config included only when present (web spread).
    public static func minimalExportJSON(for descriptor: DashboardExportDescriptor) -> String {
        serialize(minimalObject(for: descriptor), pretty: false)
    }

    /// URL-safe base64 of a string (web `toUrlSafeBase64`): UTF-8 → base64 → `+`→`-`, `/`→`_`, padding
    /// stripped.
    public static func toURLSafeBase64(_ value: String) -> String {
        Data(value.utf8)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The composed share URL (web `${window.location.origin}/dashboard#import=${encoded}`). The origin's
    /// trailing slash is normalized so the result is always `<origin>/dashboard#import=<payload>`.
    public static func shareURL(for descriptor: DashboardExportDescriptor, origin: String) -> String {
        let base = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
        let encoded = toURLSafeBase64(minimalExportJSON(for: descriptor))
        return "\(base)/dashboard#import=\(encoded)"
    }

    /// Whether the share URL exceeds the sharing ceiling (web `shareUrl.length > 2000`).
    public static func isShareURLTooLong(_ url: String) -> Bool {
        url.count > ExportConstants.shareURLMaxLength
    }

    // MARK: Phase + inline failure (modals-dialogs envelope)

    /// The dialog body phase. Loading shows only before the dashboard resolves; once it is on hand the
    /// populated export panel stays (a failed reload keeps the cached panel rather than flashing the
    /// error envelope), and a first-load failure with no resolved dashboard shows the error state. A
    /// resolved-but-absent dashboard (e.g. it was deleted) is the friendly empty state.
    public static func phase(status: ExportLoadStatus, hasDashboard: Bool) -> ExportPhase {
        switch status {
        case .loading:
            hasDashboard ? .populated : .loading
        case .loaded:
            hasDashboard ? .populated : .empty
        case let .failed(message):
            hasDashboard ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a resolved dashboard survives a failed reload (the inline
    /// banner above the panel), else `nil`.
    public static func inlineFailure(status: ExportLoadStatus, hasDashboard: Bool) -> String? {
        guard hasDashboard, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Mini-grid geometry (web `MiniGridPreview`)

    /// Resolves the mini grid preview (web `MiniGridPreview`): the `lg` layout placed in a 4-column grid
    /// whose row span is `max(y + h)` (or `2` when empty / non-positive), each cell expressed in
    /// fractions of the container.
    public static func miniGrid(for descriptor: DashboardExportDescriptor) -> ExportMiniGrid {
        let layout = descriptor.previewLayout
        let columns = gridColumns
        let maxBottom = layout.map { $0.y + $0.height }.max() ?? fallbackRows
        let rows = maxBottom > 0 ? maxBottom : fallbackRows
        let widgetIDs = Set(descriptor.widgets.map(\.id))
        let cells = layout.map { item in
            ExportMiniGridCell(
                id: item.itemID,
                leftFraction: Double(item.x) / Double(columns),
                topFraction: Double(item.y) / Double(rows),
                widthFraction: Double(item.width) / Double(columns),
                heightFraction: Double(item.height) / Double(rows),
                hasWidget: widgetIDs.contains(item.itemID)
            )
        }
        return ExportMiniGrid(
            columns: columns,
            rows: rows,
            aspectRatio: Double(columns) / Double(rows),
            cells: cells
        )
    }

    // MARK: - Serialization helpers

    /// The full export object (web full `dashboard`): id, name, icon, widgets, layouts, and the
    /// last-updated instant as an ISO-8601 string.
    private static func fullObject(for descriptor: DashboardExportDescriptor) -> [String: Any] {
        [
            "id": descriptor.id,
            "name": descriptor.name,
            "icon": descriptor.icon,
            "widgets": descriptor.widgets.map(widgetObject),
            "layouts": layoutsObject(for: descriptor),
            "updatedAt": iso8601String(descriptor.updatedAt)
        ]
    }

    /// The minimal share object (web `buildMinimalExport`): name, widgets (id / widgetId / optional
    /// config), and the layouts.
    private static func minimalObject(for descriptor: DashboardExportDescriptor) -> [String: Any] {
        [
            "name": descriptor.name,
            "widgets": descriptor.widgets.map(widgetObject),
            "layouts": layoutsObject(for: descriptor)
        ]
    }

    /// One widget's JSON object (web `{ id, widgetId, ...(config ? { config } : {}) }`).
    private static func widgetObject(_ widget: ExportWidgetInstance) -> [String: Any] {
        var object: [String: Any] = ["id": widget.id, "widgetId": widget.widgetID]
        if let config = widget.config {
            object["config"] = config.foundationValue
        }
        return object
    }

    /// The layouts object keyed by breakpoint, each value an array of grid-item objects (web `layouts`).
    private static func layoutsObject(for descriptor: DashboardExportDescriptor) -> [String: Any] {
        var object: [String: Any] = [:]
        for (breakpoint, items) in descriptor.layouts {
            object[breakpoint] = items.map(layoutItemObject)
        }
        return object
    }

    /// One grid item's JSON object using the web `RGLLayout` keys (`i`/`x`/`y`/`w`/`h` + optional bounds).
    private static func layoutItemObject(_ item: ExportLayoutItem) -> [String: Any] {
        var object: [String: Any] = [
            "i": item.itemID,
            "x": item.x,
            "y": item.y,
            "w": item.width,
            "h": item.height
        ]
        if let minW = item.minW { object["minW"] = minW }
        if let minH = item.minH { object["minH"] = minH }
        if let maxW = item.maxW { object["maxW"] = maxW }
        if let maxH = item.maxH { object["maxH"] = maxH }
        return object
    }

    /// Serializes a JSON object with sorted keys (deterministic) and, optionally, 2-space indentation.
    private static func serialize(_ object: [String: Any], pretty: Bool) -> String {
        var options: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]
        if pretty {
            options.insert(.prettyPrinted)
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: options) else {
            return "{}"
        }
        return String(bytes: data, encoding: .utf8) ?? "{}"
    }

    /// A UTC ISO-8601 rendering of an instant so the exported `updatedAt` is stable across time zones. A
    /// fresh formatter is built per call to stay concurrency-safe under Swift 6 (no shared mutable
    /// global) — this runs once per snapshot, not on a hot path.
    private static func iso8601String(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}
