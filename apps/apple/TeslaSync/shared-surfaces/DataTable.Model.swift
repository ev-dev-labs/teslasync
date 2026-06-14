//
//  DataTable.Model.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The P1/S11 telemetry seam and the P1/S8 observable state-holder for the data table. The web `<DataTable>`
//  owns a cluster of `useState`s — `page` / `pageSize`, the `{ order, hidden }` column `layout`, the per-column
//  `widths`, the `exporting` flag, and the HTML5 reorder drag hint — plus two CONTROLLED inputs the parent
//  feeds back (`selectedKeys` / `expandedKeys` with their `onSelectionChange` / `onExpandedChange` callbacks).
//  ``DataTableModel`` is the native peer: it OWNS the page / page-size / layout / widths / export / reorder /
//  failure state, mirrors the two controlled selection sets (updated through ``update(selection:expansion:...)``
//  the way React re-renders a controlled component), routes every mutation through the pure
//  ``DataTableProjector`` / ``DataTableSelectionProjector``, and emits the single `view.opened` event. No
//  networking lives here (the table is prop-driven; `data` is supplied by the host).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataTableTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataTableTelemetry: DataTableTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DataTableModel (P1/S8) — owned + controlled table state

/// The table's observable state-holder. Owns the page / page-size, the column `layout`, the per-column
/// `widths`, the `exporting` flag, the reorder drag hint, and the render-failure flag; mirrors the controlled
/// `selection` / `expansion` sets. Reads register observation dependencies, so the table re-renders when any of
/// these change. Emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DataTableModel {
    /// The current 1-based page (web `page`).
    public private(set) var page: Int
    /// Rows per page (web `pageSize`).
    public private(set) var pageSize: Int
    /// The column order + hidden layout, or `nil` at source defaults (web `layout`).
    public private(set) var layout: ColumnLayout?
    /// Per-column resize widths in points (web `widths`).
    public private(set) var widths: [String: Double]
    /// Whether a CSV export is in flight (web `exporting`) — disables the export control.
    public private(set) var exporting = false
    /// The header key currently under a reorder drag (web `dragOverKey`) — tints the drop target.
    public private(set) var dragOverColumnKey: String?
    /// Whether the body is forced to the error fallback (host-signalled render failure / a retry clears it).
    public private(set) var forcedFailure = false
    /// The controlled selected-row keys (web `selectedKeys`).
    public private(set) var selection: Set<DataTableRowKey>
    /// The controlled expanded-row keys (web `expandedKeys`).
    public private(set) var expansion: Set<DataTableRowKey>

    @ObservationIgnored private var selectionAnchor: DataTableRowKey?
    @ObservationIgnored private var onSelectionChange: (@MainActor (Set<DataTableRowKey>) -> Void)?
    @ObservationIgnored private var onExpandedChange: (@MainActor (Set<DataTableRowKey>) -> Void)?
    @ObservationIgnored private let telemetry: any DataTableTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        page: Int = 1,
        pageSize: Int = 25,
        layout: ColumnLayout? = nil,
        widths: [String: Double] = [:],
        selection: Set<DataTableRowKey> = [],
        expansion: Set<DataTableRowKey> = [],
        onSelectionChange: (@MainActor (Set<DataTableRowKey>) -> Void)? = nil,
        onExpandedChange: (@MainActor (Set<DataTableRowKey>) -> Void)? = nil,
        telemetry: any DataTableTelemetry = OSLogDataTableTelemetry()
    ) {
        self.page = max(1, page)
        self.pageSize = pageSize
        self.layout = layout
        self.widths = widths
        self.selection = selection
        self.expansion = expansion
        self.onSelectionChange = onSelectionChange
        self.onExpandedChange = onExpandedChange
        self.telemetry = telemetry
    }

    // MARK: Pagination (web `setPage` / `setPageSize`)

    /// Moves to a page (clamped at 1) — the native peer of the web `setPage` the `<Pagination>` callbacks drive.
    public func setPage(_ value: Int) {
        let clamped = max(1, value)
        if clamped != page { page = clamped }
    }

    /// Changes the page size and returns to page 1 — the verbatim web `onPageSizeChange={(size) => { setPageSize;
    /// setPage(1) }}`.
    public func setPageSize(_ value: Int) {
        guard value > 0 else { return }
        pageSize = value
        page = 1
    }

    /// Returns to page 1 — the web `useEffect(() => setPage(1), [data.length])` reset when the row count changes.
    public func resetPageForDataChange() {
        if page != 1 { page = 1 }
    }

    // MARK: Column layout (web `persistLayout` / `resetLayout`)

    /// Stores a new column layout (web `persistLayout` — minus the localStorage round-trip the host owns).
    public func setLayout(_ value: ColumnLayout) {
        layout = value
    }

    /// Clears to source-defined defaults (web `resetLayout`).
    public func resetLayout() {
        layout = nil
    }

    // MARK: Column widths (web `setColumnWidth` / `persistColumnWidth`)

    /// Streams a live resize width (web `setColumnWidth`, called continuously during a drag).
    public func setWidth(key: String, width: Double) {
        widths[key] = width
    }

    /// Commits a resize width (web `persistColumnWidth` — native stores it; the host owns any persistence).
    public func commitWidth(key: String, width: Double) {
        widths[key] = width
    }

    // MARK: Reorder drag hint (web `dragOverKey`)

    /// Sets / clears the header key under a reorder drag (web `setDragOverKey`).
    public func setDragOver(_ key: String?) {
        if dragOverColumnKey != key { dragOverColumnKey = key }
    }

    // MARK: CSV export (web `exporting`)

    /// Raises the in-flight flag (web `setExporting(true)`).
    public func beginExport() {
        exporting = true
    }

    /// Clears the in-flight flag (web `finally { setExporting(false) }`).
    public func endExport() {
        exporting = false
    }

    // MARK: Failure / retry (web SectionErrorBoundary)

    /// Forces the error fallback — the host-driven peer of a row-render throw caught by the web boundary.
    public func markFailure() {
        forcedFailure = true
    }

    /// Clears the forced failure — the retry affordance (the web boundary re-renders to retry).
    public func retry() {
        forcedFailure = false
    }

    // MARK: Selection (web `toggleRow` / `toggleAll`)

    /// Toggles a row — the verbatim web `toggleRow`: single replaces, a multi shift-click extends the additive
    /// range from the prior anchor, an ordinary multi click toggles membership. The anchor advances to this row
    /// every time (web `lastClickedKey.current = rowKey`). The next selection is applied optimistically and
    /// mirrored to the host (web `onSelectionChange`).
    public func toggleRow(
        key: DataTableRowKey,
        shift: Bool,
        mode: DataTableSelectionMode,
        allKeys: [DataTableRowKey]
    ) {
        let next: Set<DataTableRowKey>
        switch mode {
        case .none:
            return
        case .single:
            next = DataTableSelectionProjector.toggleSingle(selection: selection, key: key)
        case .multi:
            if shift, let anchor = selectionAnchor {
                next = DataTableSelectionProjector.selectRange(
                    allKeys: allKeys,
                    selection: selection,
                    anchor: anchor,
                    target: key
                )
            } else {
                next = DataTableSelectionProjector.toggleMembership(selection: selection, key: key)
            }
        }
        selectionAnchor = key
        applySelection(next)
    }

    /// Select-all / clear-all (web `toggleAll`).
    public func toggleAll(allKeys: [DataTableRowKey]) {
        applySelection(DataTableSelectionProjector.toggleAll(allKeys: allKeys, selection: selection))
    }

    /// Clears the selection (web `clearSelection`, the bulk-bar "Clear").
    public func clearSelection() {
        applySelection([])
    }

    private func applySelection(_ next: Set<DataTableRowKey>) {
        selection = next
        onSelectionChange?(next)
    }

    // MARK: Expansion (web `toggleExpand`)

    /// Toggles a row's expansion (web `toggleExpand`); applied optimistically and mirrored to the host.
    public func toggleExpand(key: DataTableRowKey) {
        let next = DataTableSelectionProjector.toggleExpansion(expansion: expansion, key: key)
        expansion = next
        onExpandedChange?(next)
    }

    // MARK: Controlled-prop update (web re-render)

    /// Refreshes the controlled selection / expansion sets + the page closures — the native peer of React
    /// re-rendering the table with new props. The closures are always refreshed (recreated each parent render);
    /// the sets reassign only when they actually change so an unrelated re-render does not invalidate observers.
    public func update(
        selection: Set<DataTableRowKey>,
        expansion: Set<DataTableRowKey>,
        onSelectionChange: (@MainActor (Set<DataTableRowKey>) -> Void)?,
        onExpandedChange: (@MainActor (Set<DataTableRowKey>) -> Void)?
    ) {
        self.onSelectionChange = onSelectionChange
        self.onExpandedChange = onExpandedChange
        if selection != self.selection { self.selection = selection }
        if expansion != self.expansion { self.expansion = expansion }
    }

    // MARK: Lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear / disappear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DataTableSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
    }
}
