//
//  ExportModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The dependency-free domain layer for the export-dashboard modal — the faithful port of
//  features/dashboard/components/ExportModal.tsx. The web source is a presentational `Modal`: it
//  receives the dashboard to export (`SavedDashboard`) plus an `onDownload` callback, renders a summary
//  (a mini grid preview, the name, a widget-count + JSON-size badge pair, and the "Updated {date}"
//  line), and offers three actions — download the pretty-printed JSON file, copy that JSON to the
//  clipboard, and copy a self-contained share URL (`${origin}/dashboard#import=${base64url}`) that is
//  disabled with a warning when it would exceed the 2000-character limit. Everything here is pure
//  Foundation so the value model, the JSON value tree, the layout grid items, and the load / freshness /
//  phase enums are all unit-testable without a bundle or a rendered view. The pure projection (JSON
//  build, base64url, size formatting, share URL, phase, mini-grid geometry) lives in
//  ExportModal.Projection.swift.
//
//  Web parity notes:
//    • `SavedDashboard { id, name, icon?, widgets, layouts, updatedAt }` → `DashboardExportDescriptor`.
//    • `WidgetInstance { id, widgetId, config? }` → `ExportWidgetInstance`.
//    • `RGLLayout { i, x, y, w, h, … }` → `ExportLayoutItem`.
//    • `Record<string, unknown>` widget config → `ExportJSONValue` (a small JSON value tree).
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum ExportSurface {
    public static let slug = "ExportModal"
}

// MARK: - Constants (web literals)

/// The fixed thresholds the web component bakes in: the 2000-character share-URL ceiling (web
/// `shareUrl.length > 2000`) and the 1024-byte boundary between the "B" and "KB" size badge (web
/// `bytes < 1024`).
public enum ExportConstants {
    public static let shareURLMaxLength = 2000
    public static let bytesPerKilobyte = 1024
}

// MARK: - JSON value tree (web widget `config: Record<string, unknown>`)

/// A minimal JSON value tree so a widget's free-form `config` round-trips into both the pretty export
/// JSON and the minimal share payload exactly as the web `JSON.stringify` would emit it. Kept tiny and
/// `Equatable` so the projection's serialization is deterministically testable.
public indirect enum ExportJSONValue: Sendable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([ExportJSONValue])
    case object([String: ExportJSONValue])

    /// The Foundation bridge used by `JSONSerialization`. Swift `Bool` bridges to the boolean JSON
    /// literal (not 0/1), and `Int` stays integral, matching the web `JSON.stringify` output shape.
    public var foundationValue: Any {
        switch self {
        case let .string(value): value
        case let .int(value): value
        case let .double(value): value
        case let .bool(value): value
        case .null: NSNull()
        case let .array(values): values.map(\.foundationValue)
        case let .object(values): values.mapValues(\.foundationValue)
        }
    }
}

// MARK: - Widget instance (web `WidgetInstance`)

/// One placed widget (web `WidgetInstance { id, widgetId, config? }`). The `config` is carried as a JSON
/// value tree so the minimal export reproduces the web `...(w.config ? { config: w.config } : {})`
/// spread verbatim.
public struct ExportWidgetInstance: Sendable, Equatable, Identifiable {
    public let id: String
    public let widgetID: String
    public let config: ExportJSONValue?

    public init(id: String, widgetID: String, config: ExportJSONValue? = nil) {
        self.id = id
        self.widgetID = widgetID
        self.config = config
    }
}

// MARK: - Layout item (web `RGLLayout`)

/// One react-grid-layout placement (web `RGLLayout`): the widget id it positions plus its grid origin
/// (`x`, `y`) and span (`width`, `height`). The optional bounds are carried so the export JSON keeps
/// whatever the source layout had, but the mini-grid geometry only needs the core four. The properties
/// avoid the web's 1-letter names (`i`/`w`/`h`) for the identifier-name lint budget; the JSON keys are
/// still emitted as `i`/`w`/`h` by the projection.
public struct ExportLayoutItem: Sendable, Equatable, Identifiable {
    public let itemID: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
    public let minW: Int?
    public let minH: Int?
    public let maxW: Int?
    public let maxH: Int?

    public var id: String {
        itemID
    }

    public init(
        itemID: String,
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        minW: Int? = nil,
        minH: Int? = nil,
        maxW: Int? = nil,
        maxH: Int? = nil
    ) {
        self.itemID = itemID
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.minW = minW
        self.minH = minH
        self.maxW = maxW
        self.maxH = maxH
    }
}

// MARK: - Exported dashboard (web `SavedDashboard` subset)

/// The dashboard being exported (web `SavedDashboard`, the fields this modal reads): its id, display
/// name, icon (web defaults a missing icon to `📊`), placed widgets, the per-breakpoint layouts, and the
/// last-updated instant (web `formatDate(dashboard.updatedAt)`).
public struct DashboardExportDescriptor: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let icon: String
    public let widgets: [ExportWidgetInstance]
    public let layouts: [String: [ExportLayoutItem]]
    public let updatedAt: Date

    /// The web grid breakpoint the mini preview renders (web `dashboard.layouts.lg`).
    public static let previewBreakpoint = "lg"

    /// The web fallback icon (`dashboard.icon ?? '📊'`).
    public static let defaultIcon = "📊"

    public init(
        id: String,
        name: String,
        icon: String = DashboardExportDescriptor.defaultIcon,
        widgets: [ExportWidgetInstance],
        layouts: [String: [ExportLayoutItem]],
        updatedAt: Date
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.widgets = widgets
        self.layouts = layouts
        self.updatedAt = updatedAt
    }

    /// The layout items for the preview breakpoint (web `dashboard.layouts.lg ?? []`).
    public var previewLayout: [ExportLayoutItem] {
        layouts[Self.previewBreakpoint] ?? []
    }
}

// MARK: - Load status / freshness / phase

/// The bound source's load status for the modal's data (the dashboard being exported). The web modal
/// receives the dashboard as a prop; the native surface models the load lifecycle so every state
/// renders rather than flashing a blank box.
public enum ExportLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013) for the exported dashboard: drives the freshness chip + the
/// cached-data banner so the surface clearly labels when the dashboard came from a cached read rather
/// than a live fetch.
public enum ExportConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated export panel;
/// the loading / empty / error envelopes are added so a first-load (no resolved dashboard) is never a
/// blank box (engineering guideline #6).
public enum ExportPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}
