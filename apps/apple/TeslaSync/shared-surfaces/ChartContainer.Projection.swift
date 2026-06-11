//
//  ChartContainer.Projection.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The pure projection from the surface inputs to the resolved view-state — the native port of the
//  web `ChartContainer` render decisions. The view is a pure function of `ChartContainerResolved`;
//  every branch is unit tested without rendering. Foundation-only.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound chart context — the orthogonal connectivity axis the surface renders
/// as a toolbar chip + banner. `live` shows the chart alone; `stale` adds a refresh affordance and
/// triggers a one-shot auto-refresh; `offline` keeps the last-known chart with an offline marker.
public enum ChartContainerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Chart body status (web `loading` / `empty` props + the SectionErrorBoundary)

/// The resolved state of the chart body — the native fold of the web `loading` / `empty` props plus
/// the `SectionErrorBoundary` failure branch. Precedence matches the web JSX: loading first, then
/// error, then empty, then the rendered chart.
public enum ChartContainerChartStatus: String, Sendable, Equatable, CaseIterable {
    /// Web `loading` → the centred spinner.
    case loading
    /// The chart's `SectionErrorBoundary` caught a render failure → the error row + retry.
    case error
    /// Web `empty` → the "No data available" empty state (never a blank box).
    case empty
    /// Deltas resolved → the chart renders inside the error boundary.
    case ready

    /// Folds the web props into the single status with the web precedence
    /// (`loading ? … : empty ? … : children`), widened with the native error branch.
    public static func resolve(loading: Bool, hasError: Bool, empty: Bool) -> ChartContainerChartStatus {
        if loading { return .loading }
        if hasError { return .error }
        if empty { return .empty }
        return .ready
    }
}

// MARK: - Body state inputs (web `loading` / `empty` props + fallback-table inputs)

/// The chart-body inputs the surface passes down each render — the web `loading` / `empty` props, the
/// `SectionErrorBoundary` signal, and the accessible fallback-table counts (web `data` /
/// `dataColumns`). Bundled so the projection stays within a small parameter budget.
public struct ChartContainerBodyState: Sendable, Equatable {
    public var loading: Bool
    public var empty: Bool
    public var hasError: Bool
    public var rowCount: Int
    public var columnCount: Int

    public init(
        loading: Bool = false,
        empty: Bool = false,
        hasError: Bool = false,
        rowCount: Int = 0,
        columnCount: Int = 0
    ) {
        self.loading = loading
        self.empty = empty
        self.hasError = hasError
        self.rowCount = rowCount
        self.columnCount = columnCount
    }
}

// MARK: - Surface content (web `ChartContainerProps`)

/// The per-chart configuration the surface is parameterised by — the native shape of the web
/// `ChartContainerProps` (minus the React `children`, which arrive as the SwiftUI content closure).
/// All copy is already localised at the call site or resolved through the facade in the view.
public struct ChartContainerContent: Sendable, Equatable {
    public var title: String
    public var subtitle: String?
    public var ariaLabel: String
    public var ariaDescription: String?
    public var exportable: Bool
    public var hasExportData: Bool
    public var fullscreen: Bool
    public var annotationsEnabled: Bool
    public var annotationKey: String
    public var scope: ChartContainerAnnotationScope?
    public var vehicleID: Int64?

    public init(
        title: String,
        subtitle: String? = nil,
        ariaLabel: String,
        ariaDescription: String? = nil,
        exportable: Bool = true,
        hasExportData: Bool = false,
        fullscreen: Bool = false,
        annotationsEnabled: Bool = false,
        annotationKey: String? = nil,
        scope: ChartContainerAnnotationScope? = nil,
        vehicleID: Int64? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.ariaLabel = ariaLabel
        self.ariaDescription = ariaDescription
        self.exportable = exportable
        self.hasExportData = hasExportData
        self.fullscreen = fullscreen
        self.annotationsEnabled = annotationsEnabled
        // Web `annotationKey = annotationsConfig?.chartId ?? title` — the persisted toggle key.
        self.annotationKey = (annotationKey?.isEmpty == false ? annotationKey : nil) ?? title
        self.scope = scope
        self.vehicleID = vehicleID
    }
}

// MARK: - Resolved view-state

/// The resolved, view-ready state — the chart-body status, the connectivity axis, the visible vs
/// fetched annotations, and the toolbar gates. Computed once by ``ChartContainerProjection`` so the
/// view holds no decision logic.
public struct ChartContainerResolved: Equatable, Sendable {
    public let status: ChartContainerChartStatus
    public let connection: ChartContainerConnection
    public let annotationsEnabled: Bool
    public let hidden: Bool
    public let fetchedAnnotations: [ChartContainerAnnotation]
    public let visibleAnnotations: [ChartContainerAnnotation]
    public let showMarkerRow: Bool
    public let showExportMenu: Bool
    public let hasFallbackTable: Bool
    public let showAnnotationList: Bool

    public init(
        status: ChartContainerChartStatus,
        connection: ChartContainerConnection,
        annotationsEnabled: Bool,
        hidden: Bool,
        fetchedAnnotations: [ChartContainerAnnotation],
        visibleAnnotations: [ChartContainerAnnotation],
        showMarkerRow: Bool,
        showExportMenu: Bool,
        hasFallbackTable: Bool,
        showAnnotationList: Bool
    ) {
        self.status = status
        self.connection = connection
        self.annotationsEnabled = annotationsEnabled
        self.hidden = hidden
        self.fetchedAnnotations = fetchedAnnotations
        self.visibleAnnotations = visibleAnnotations
        self.showMarkerRow = showMarkerRow
        self.showExportMenu = showExportMenu
        self.hasFallbackTable = hasFallbackTable
        self.showAnnotationList = showAnnotationList
    }

    /// Whether the chart toolbar's image/CSV export menu is the only toolbar affordance hidden by the
    /// body state (web auto-hides it in `loading` / `empty`).
    public var isLive: Bool {
        connection == .live
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection from the surface inputs to the resolved view-state. Mirrors the web
/// `ChartContainer` render derivations exactly: the visible annotation list collapses when hidden,
/// the marker row + annotation footer follow the fetched/visible counts, and the export menu is
/// gated by the body state.
public enum ChartContainerProjection {
    /// Resolves the full view-state. `rowCount` / `columnCount` describe the accessible fallback
    /// table inputs (web `data` / `dataColumns`); `hasError` is the chart `SectionErrorBoundary`
    /// signal.
    public static func resolve(
        content: ChartContainerContent,
        connection: ChartContainerConnection,
        body: ChartContainerBodyState,
        hidden: Bool,
        fetched: [ChartContainerAnnotation]
    ) -> ChartContainerResolved {
        let status = ChartContainerChartStatus.resolve(
            loading: body.loading,
            hasError: body.hasError,
            empty: body.empty
        )
        let enabled = content.annotationsEnabled
        let visible = ChartContainerLogic.visibleAnnotations(enabled: enabled, hidden: hidden, fetched: fetched)
        return ChartContainerResolved(
            status: status,
            connection: connection,
            annotationsEnabled: enabled,
            hidden: hidden,
            fetchedAnnotations: enabled ? fetched : [],
            visibleAnnotations: visible,
            showMarkerRow: ChartContainerLogic.showMarkerRow(
                enabled: enabled,
                hidden: hidden,
                visibleCount: visible.count
            ),
            showExportMenu: ChartContainerLogic.showExportMenu(
                exportable: content.exportable,
                loading: body.loading,
                empty: body.empty
            ),
            hasFallbackTable: ChartContainerLogic.hasFallbackTable(
                rowCount: body.rowCount,
                columnCount: body.columnCount
            ),
            showAnnotationList: enabled && !fetched.isEmpty
        )
    }
}
