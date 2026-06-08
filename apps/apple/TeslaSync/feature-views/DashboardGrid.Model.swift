//
//  DashboardGrid.Model.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11 `view.opened`),
//  i18n facade (P1/S10), and the pure input value types for the SwiftUI parity of
//  web/src/features/dashboard/components/DashboardGrid.tsx.
//
//  The web component is a composition/layout surface: it receives one
//  `dashboard` (a SavedDashboard of widget instances + per-breakpoint RGL
//  layouts), an `editMode` flag, display options (compact, borders, kiosk
//  opacity, dashboard-level vehicle filter), and callbacks (remove / open
//  settings / persist layout). Its only "data source" is `useContainerWidth`
//  (a layout measurement — natively a GeometryReader); it performs NO I/O and
//  resolves the widget body through the registry (`getWidgetDef(...).component`)
//  supplied by the parent. The native surface mirrors that exactly: it binds no
//  store and does no networking — the parent maps the shared S8 dashboard holder
//  into `DashboardGridData` and supplies the widget renderer + callbacks.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `DashboardGrid` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum DashboardGridSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "DashboardGrid"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any DashboardGridTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the
/// view can emit from its `.task` without a main-actor hop.
public protocol DashboardGridTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no dashboard name, widget
/// id, VIN, or payload is ever recorded.
public struct OSLogDashboardGridTelemetry: DashboardGridTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10)

/// Resolves the surface's strings by key with English fallbacks so the view holds
/// no hardcoded literals. Keys live in the "DashboardGrid" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The web source makes
/// no `t()` calls (the surface is anonymous and its chrome strings are hardcoded
/// English aria-labels); the native chrome keys are minted under `dashboard.grid.*`
/// and carry the same English copy so a shared catalog resolves identically.
public enum DashboardGridStrings {
    public static let table = "DashboardGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web template literal `${name}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Widget instance (web `WidgetInstance` + the registry `WidgetDef` fields the grid reads)

/// One placed widget — the projection of the web `WidgetInstance` plus the two
/// `WidgetDef` fields the grid itself reads (the display `name` used by the edit
/// chrome + fullscreen title, and the `defaultSize` used as the size fallback when
/// a layout entry is missing). The widget's own body is rendered by the parent's
/// registry renderer, not by this value.
public struct DashboardWidgetInstance: Equatable, Sendable, Identifiable {
    /// Stable instance id (web `WidgetInstance.id`, the RGL layout key `i`).
    public let id: String
    /// Registry widget type id (web `WidgetInstance.widgetId`).
    public let widgetId: String
    /// Display name (web `WidgetDef.name`) — the edit-chrome label + fullscreen title.
    public let name: String
    /// Per-widget vehicle scope (web `widget.config?.vehicleId`); falls back to the
    /// dashboard-level filter when `nil`.
    public let vehicleId: Int?
    /// Registry default size (web `WidgetDef.defaultSize`) — the size fallback when
    /// no layout entry exists for the active breakpoint.
    public let defaultSize: DashboardWidgetSpan

    public init(
        id: String,
        widgetId: String,
        name: String,
        vehicleId: Int? = nil,
        defaultSize: DashboardWidgetSpan = DashboardWidgetSpan(cols: 1, rows: 1)
    ) {
        self.id = id
        self.widgetId = widgetId
        self.name = name
        self.vehicleId = vehicleId
        self.defaultSize = defaultSize
    }
}

/// A widget's span in grid units (web `WidgetSize` / the `{ cols, rows }` the web
/// `getWidgetSize` returns). Distinct from the redacted layout item so the size
/// the body receives is unambiguous.
public struct DashboardWidgetSpan: Equatable, Sendable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

// MARK: - Layout item (web `RGLLayout`)

/// One react-grid-layout item — position + size in grid units for a single widget
/// at a single breakpoint (web `RGLLayout`). Only the fields the native grid reads
/// are carried (`i`, `x`, `y`, `w`, `h`); the RGL min/max/static flags are owned by
/// the persistence layer, not the renderer.
public struct DashboardGridLayoutItem: Equatable, Sendable, Identifiable {
    /// The instance id this item positions (web `RGLLayout.i`).
    public let id: String
    public let x: Int
    public let y: Int
    public let columnSpan: Int
    public let rowSpan: Int

    public init(id: String, x: Int, y: Int, columnSpan: Int, rowSpan: Int) {
        self.id = id
        self.x = x
        self.y = y
        self.columnSpan = columnSpan
        self.rowSpan = rowSpan
    }
}

/// Per-breakpoint layouts (web `RGLLayouts` — keyed by breakpoint string). Stored
/// strongly-typed by `DashboardBreakpoint` so the renderer never indexes a raw map.
public struct DashboardGridLayouts: Equatable, Sendable {
    private var byBreakpoint: [DashboardBreakpoint: [DashboardGridLayoutItem]]

    public init(_ byBreakpoint: [DashboardBreakpoint: [DashboardGridLayoutItem]] = [:]) {
        self.byBreakpoint = byBreakpoint
    }

    /// The layout array for a breakpoint, or `nil` when none is saved (web
    /// `liveLayouts[bp]`).
    public func items(for breakpoint: DashboardBreakpoint) -> [DashboardGridLayoutItem]? {
        byBreakpoint[breakpoint]
    }

    public subscript(_ breakpoint: DashboardBreakpoint) -> [DashboardGridLayoutItem]? {
        get { byBreakpoint[breakpoint] }
        set { byBreakpoint[breakpoint] = newValue }
    }
}

// MARK: - Dashboard data (web `SavedDashboard` subset the grid renders)

/// The resolved dashboard the grid renders — the projection of the web
/// `SavedDashboard` (its `widgets` + `layouts`, plus identity for diagnostics).
/// The parent maps the S8 holder into this; the grid never touches the network.
public struct DashboardGridData: Equatable, Sendable {
    public let id: String
    public let name: String
    public let widgets: [DashboardWidgetInstance]
    public let layouts: DashboardGridLayouts

    public init(
        id: String,
        name: String,
        widgets: [DashboardWidgetInstance],
        layouts: DashboardGridLayouts
    ) {
        self.id = id
        self.name = name
        self.widgets = widgets
        self.layouts = layouts
    }
}

// MARK: - Display options (web display props)

/// The grid's presentational options — the native port of the web props
/// `editMode`, `compactMode`, `showWidgetBorders`, `kioskWidgetOpacity`, and
/// `dashboardVehicleId`. A plain value bag threaded from the parent.
public struct DashboardGridOptions: Equatable, Sendable {
    /// Web `editMode` — drag chrome + settings/remove buttons + dot-grid backing.
    public let editMode: Bool
    /// Web `compactMode` — reduces the grid gaps.
    public let compactMode: Bool
    /// Web `showWidgetBorders` — a subtle border on each widget panel.
    public let showWidgetBorders: Bool
    /// Web `kioskWidgetOpacity` (0.3–1.0) — boosts each panel's background opacity
    /// for at-a-glance kiosk readability. `nil` keeps the default glass.
    public let kioskWidgetOpacity: Double?
    /// Web `dashboardVehicleId` — the dashboard-level vehicle filter widgets inherit
    /// unless they carry their own.
    public let dashboardVehicleId: Int?

    public init(
        editMode: Bool = false,
        compactMode: Bool = false,
        showWidgetBorders: Bool = false,
        kioskWidgetOpacity: Double? = nil,
        dashboardVehicleId: Int? = nil
    ) {
        self.editMode = editMode
        self.compactMode = compactMode
        self.showWidgetBorders = showWidgetBorders
        self.kioskWidgetOpacity = kioskWidgetOpacity
        self.dashboardVehicleId = dashboardVehicleId
    }
}

// MARK: - Live freshness (live / stale / offline)

/// Freshness of the dashboard's live signals (web SSE-driven widgets), mirroring
/// `LiveConnectionState` (ADR-013). The grid keeps its cached widgets visible and
/// surfaces a stale/offline chip, never blanking the surface — the P4 `stale` and
/// `offline` states.
public enum DashboardGridConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Whether a freshness chip should be shown (everything but a healthy live link).
    public var showsChip: Bool {
        self != .live
    }
}

// MARK: - Render state (every state renders — no hidden surfaces)

/// The render state of the grid. The web component is always `loaded`; the native
/// surface additionally renders the load/empty/error chrome required of every P4
/// surface so the parent never has to special-case the dashboard shell.
public enum DashboardGridState: Equatable, Sendable {
    /// Initial fetch of the dashboard — skeleton grid chrome.
    case loading
    /// Resolved with no widgets — friendly empty state, never a blank box.
    case empty
    /// The dashboard failed to load — message + retry affordance.
    case error(message: String?)
    /// The dashboard resolved — the full responsive widget grid.
    case loaded(DashboardGridData)

    /// The resolved dashboard, if any (convenience for the view/tests).
    public var dashboard: DashboardGridData? {
        if case let .loaded(data) = self { return data }
        return nil
    }
}

// MARK: - Action seam (web `onRemoveWidget` / `onOpenSettings` / `onLayoutChange`)

/// The callbacks the grid invokes — the native port of the web grid's mutation
/// props plus an optional retry for the native error state. No mutation logic lives
/// in the grid: the parent owns the store-backed effects, exactly like the web
/// component.
public struct DashboardGridActions {
    /// Web `onRemoveWidget(instanceId)`.
    public let onRemoveWidget: (String) -> Void
    /// Web `onOpenSettings(instanceId)`.
    public let onOpenSettings: (String) -> Void
    /// Web `onLayoutChange(layouts)` — persists a reorder/resize. Native reordering
    /// is a discrete move (see `DashboardGridActions.move`), so this is invoked with
    /// the already-mutated layouts.
    public let onLayoutChange: (DashboardGridLayouts) -> Void
    /// Native error-state retry.
    public let onRetry: () -> Void

    public init(
        onRemoveWidget: @escaping (String) -> Void,
        onOpenSettings: @escaping (String) -> Void,
        onLayoutChange: @escaping (DashboardGridLayouts) -> Void = { _ in },
        onRetry: @escaping () -> Void = {}
    ) {
        self.onRemoveWidget = onRemoveWidget
        self.onOpenSettings = onOpenSettings
        self.onLayoutChange = onLayoutChange
        self.onRetry = onRetry
    }
}

// MARK: - Widget render context (web `Component` props)

/// The context handed to the parent-supplied widget renderer for one tile — the
/// native port of the web `<Component vehicleId size config />` props. The grid
/// resolves `vehicleId` (per-widget override ?? dashboard filter) and the `size`
/// (from the active layout) before calling the renderer, exactly like the web.
public struct DashboardWidgetRenderContext: Equatable, Sendable, Identifiable {
    public let id: String
    public let widgetId: String
    public let name: String
    /// The resolved size in grid units (web `getWidgetSize`).
    public let size: DashboardWidgetSpan
    /// The resolved vehicle scope (web `widget.config?.vehicleId ?? dashboardVehicleId`).
    public let vehicleId: Int?
    /// Whether this context is for the enlarged fullscreen presentation (web
    /// `FullscreenOverlay`, which floors `rows` at 4).
    public let isFullscreen: Bool

    public init(
        id: String,
        widgetId: String,
        name: String,
        size: DashboardWidgetSpan,
        vehicleId: Int?,
        isFullscreen: Bool = false
    ) {
        self.id = id
        self.widgetId = widgetId
        self.name = name
        self.size = size
        self.vehicleId = vehicleId
        self.isFullscreen = isFullscreen
    }
}
