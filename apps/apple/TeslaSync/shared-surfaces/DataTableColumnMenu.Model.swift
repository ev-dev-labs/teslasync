//
//  DataTableColumnMenu.Model.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  table column visibility + reorder menu. The web `<DataTableColumnMenu>` is CONTROLLED — its parent
//  DataTable owns the `ColumnLayout` and feeds it back through props after each `onChange`. The native peer
//  is the `@Observable` ``DataTableColumnMenuController``: it owns the current ``ColumnLayout`` as the view's
//  single source of truth (the web `layout` prop), applies the source's two mutation handlers through the
//  pure ``ColumnLayoutProjector`` (the last-visible guard, the bounds-clamped reorder), and notifies the
//  host through the `onChange` / `onReset` callbacks so the host can run its `localStorage` round-trip (the
//  web `onChange` / `onReset` props) — keeping this surface storage-agnostic exactly as the web source is.
//  It also owns the popover open state (the web `open` `useState` + the click-outside / Escape dismiss) and
//  emits the single `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` routed through keys

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "DataTableColumnMenu" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. Every `t(...)` call in `components/ui/DataTableColumnMenu.tsx` is routed here
/// (plus the native friendly-empty addition) per the no-hardcoded-English rule.
public enum DataTableColumnMenuStrings {
    public static let table = "DataTableColumnMenu"

    public static let string: DataTableColumnMenuResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The trigger / menu accessible name when reordering is enabled (web `t('table.columns.menuReorder',
    /// 'Reorder or hide columns')`).
    public static var menuReorder: String {
        string("table.columns.menuReorder", "Reorder or hide columns")
    }

    /// The trigger / menu accessible name when the menu is a pure visibility checklist (web
    /// `t('table.columns.menu', 'Show or hide columns')`).
    public static var menu: String {
        string("table.columns.menu", "Show or hide columns")
    }

    /// The default trigger's visible label (web `t('table.columns.button', 'Columns')`).
    public static var button: String {
        string("table.columns.button", "Columns")
    }

    /// The popover heading when reordering is enabled (web `t('table.columns.headingReorder', 'Columns')`).
    public static var headingReorder: String {
        string("table.columns.headingReorder", "Columns")
    }

    /// The popover heading for a pure visibility checklist (web `t('table.columns.heading', 'Visible
    /// columns')`).
    public static var heading: String {
        string("table.columns.heading", "Visible columns")
    }

    /// The reset-to-defaults control label (web `t('table.columns.reset', 'Reset')`).
    public static var reset: String {
        string("table.columns.reset", "Reset")
    }

    /// The visibility checkbox's accessible name for a column (web `t('table.columns.toggleColumn', 'Show or
    /// hide {{col}}', { col })`). Interpolates `{{col}}` exactly as i18next does.
    public static func toggleColumn(_ col: String) -> String {
        interpolate(string("table.columns.toggleColumn", "Show or hide {{col}}"), col: col)
    }

    /// The move-up button's accessible name for a column (web `t('table.columns.moveUp', 'Move {{col}} up',
    /// { col })`).
    public static func moveUp(_ col: String) -> String {
        interpolate(string("table.columns.moveUp", "Move {{col}} up"), col: col)
    }

    /// The move-down button's accessible name for a column (web `t('table.columns.moveDown', 'Move {{col}}
    /// down', { col })`).
    public static func moveDown(_ col: String) -> String {
        interpolate(string("table.columns.moveDown", "Move {{col}} down"), col: col)
    }

    /// Friendly body shown when the menu is opened with no columns (native — never a blank box; the web
    /// renders an empty list).
    public static var empty: String {
        string("table.columns.empty", "No columns to configure")
    }

    /// Substitutes the i18next `{{col}}` token, so the interpolation stays faithful to the web while the
    /// template still resolves through the facade.
    private static func interpolate(_ template: String, col: String) -> String {
        template.replacingOccurrences(of: "{{col}}", with: col)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataTableColumnMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataTableColumnMenuTelemetry: DataTableColumnMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DataTableColumnMenuController (P1/S8) — state-holder + mutations + routing

/// The surface's observable state-holder — the native peer of the web component's controlled state. The web
/// `<DataTableColumnMenu>` receives its `layout` from the parent DataTable and pushes every change back
/// through `onChange`; the native controller instead OWNS the current ``ColumnLayout`` as the view's single
/// source of truth and mirrors each change out through the same `onChange` / `onReset` callbacks so a host
/// can persist (the web DataTable's `localStorage` round-trip), keeping the surface storage-agnostic. It
/// applies the source's mutation handlers through the pure ``ColumnLayoutProjector`` (the last-visible
/// guard, the bounds-clamped reorder), exposes the per-row render models + the resolved heading / trigger
/// labels, owns the popover open state (web the `open` `useState` + click-outside / Escape dismiss), and
/// emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DataTableColumnMenuController {
    /// The table's static column descriptions (web `columns` prop). Immutable for an instance; a new table
    /// makes a new controller.
    public let columns: [ColumnDescriptor]

    /// The current layout, or `nil` when the table is at its source-defined defaults (web `layout` prop,
    /// which may be `null`). Observed so the menu re-renders its rows on every mutation.
    public private(set) var layout: ColumnLayout?

    /// Whether the ↑ / ↓ reorder controls render (web `reorderable`, default `true`).
    public let reorderable: Bool

    /// Whether the visibility checkboxes render (web `toggleable`, default `true`).
    public let toggleable: Bool

    /// Whether the popover is open (web the `open` `useState`). Observed so the host shows / tears down the
    /// popover.
    public var isOpen: Bool = false

    @ObservationIgnored private let onChange: (ColumnLayout) -> Void
    @ObservationIgnored private let onReset: () -> Void
    @ObservationIgnored private let telemetry: any DataTableColumnMenuTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder. `layout` defaults to `nil` (the table's source-defined defaults, web a
    /// `null` layout); `onChange` / `onReset` default to no-ops for a self-contained / preview instance and
    /// are supplied by a host that persists (the web DataTable's `localStorage` round-trip).
    public init(
        columns: [ColumnDescriptor],
        layout: ColumnLayout? = nil,
        reorderable: Bool = true,
        toggleable: Bool = true,
        onChange: @escaping (ColumnLayout) -> Void = { _ in },
        onReset: @escaping () -> Void = {},
        telemetry: any DataTableColumnMenuTelemetry = OSLogDataTableColumnMenuTelemetry()
    ) {
        self.columns = columns
        self.layout = layout
        self.reorderable = reorderable
        self.toggleable = toggleable
        self.onChange = onChange
        self.onReset = onReset
        self.telemetry = telemetry
    }

    // MARK: derived projections

    /// The per-row render models in effective order (web `orderedKeys.map(...)`).
    public var rows: [ColumnMenuRow] {
        ColumnLayoutProjector.rows(columns, layout: layout)
    }

    /// The ordered visible columns (web `applyColumnLayout(columns, layout)`), for a host that mirrors the
    /// menu's selection onto a live table.
    public var visibleColumns: [ColumnDescriptor] {
        ColumnLayoutProjector.applyLayout(columns, layout: layout)
    }

    /// The count of currently-visible columns (web `visibleCount`).
    public var visibleCount: Int {
        ColumnLayoutProjector.visibleCount(columns, layout: layout)
    }

    /// Whether the menu has no columns to configure (native friendly-empty branch; the web renders an empty
    /// list).
    public var isEmpty: Bool {
        columns.isEmpty
    }

    /// The trigger / menu accessible name — the web `triggerLabel`: "Reorder or hide columns" when
    /// reorderable, else "Show or hide columns".
    public var triggerLabel: String {
        reorderable ? DataTableColumnMenuStrings.menuReorder : DataTableColumnMenuStrings.menu
    }

    /// The popover heading — the web heading: "Columns" when reorderable, else "Visible columns".
    public var headingLabel: String {
        reorderable ? DataTableColumnMenuStrings.headingReorder : DataTableColumnMenuStrings.heading
    }

    // MARK: mutations (web handlers)

    /// Toggles a column's visibility — the native peer of the web `handleToggle`: refuses to hide the last
    /// visible column (a no-op), otherwise updates the owned layout and mirrors it to the host via
    /// `onChange`.
    public func toggle(_ key: String) {
        guard let next = ColumnLayoutProjector.toggledLayout(columns, layout: layout, key: key) else { return }
        layout = next
        onChange(next)
    }

    /// Moves a column one slot in `direction` (`-1` up / `+1` down) — the native peer of the web
    /// `handleMove`: a move off either end is a no-op, otherwise updates the owned layout and mirrors it to
    /// the host via `onChange`.
    public func move(_ key: String, direction: Int) {
        guard let next = ColumnLayoutProjector.movedLayout(
            columns,
            layout: layout,
            key: key,
            direction: direction
        ) else { return }
        layout = next
        onChange(next)
    }

    /// Moves a column up one slot (web `handleMove(key, -1)`).
    public func moveUp(_ key: String) {
        move(key, direction: -1)
    }

    /// Moves a column down one slot (web `handleMove(key, 1)`).
    public func moveDown(_ key: String) {
        move(key, direction: 1)
    }

    /// Resets to the table's source-defined defaults — the native peer of the web `onReset`: clears the
    /// owned layout (so rows recompute to defaults) and notifies the host to clear its persisted layout.
    public func reset() {
        layout = nil
        onReset()
    }

    /// Pushes an externally-owned layout into the controller without re-notifying the host — the controlled
    /// -prop parity for a host that drives the layout itself (e.g. restoring a persisted layout). Does not
    /// fire `onChange` (the value came from the host).
    public func apply(_ layout: ColumnLayout?) {
        self.layout = layout
    }

    // MARK: popover open state (web `open` useState)

    /// Opens the popover (web `setOpen(true)`).
    public func openMenu() {
        isOpen = true
    }

    /// Closes the popover — the native peer of the web click-outside / Escape dismiss (`setOpen(false)`).
    public func closeMenu() {
        isOpen = false
    }

    /// Toggles the popover (web the default trigger's `onClick={() => setOpen((v) => !v)}`).
    public func toggleMenu() {
        isOpen.toggle()
    }

    // MARK: lifecycle / telemetry

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear / disappear
    /// churn — the event fires a single time per instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DataTableColumnMenuSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
