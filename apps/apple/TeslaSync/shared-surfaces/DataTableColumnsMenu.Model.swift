//
//  DataTableColumnsMenu.Model.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  table column-visibility menu. The web `<DataTableColumnsMenu>` is CONTROLLED — its parent DataTable owns
//  the visible-key set and feeds it back through props after each `onChange`. The native peer is the
//  `@Observable` ``DataTableColumnsMenuController``: it owns the current `visibleKeys` as the view's single
//  source of truth (the web `visibleKeys` prop), applies the source's two mutation handlers through the pure
//  ``DataTableColumnsMenuProjector`` (the last-visible guard, the source-order rebuild on show, "Show all"),
//  and notifies the host through the `onChange` callback so the host can run its persistence round-trip (the
//  web DataTable's `tableId` storage) — keeping this surface storage-agnostic exactly as the web source is.
//  It also owns the popover open state (the web `open` `useState` + the click-outside / Escape dismiss) and
//  emits the single `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)` routed through keys

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "DataTableColumnsMenu" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. Every `t(...)` call in `components/ui/DataTableColumnsMenu.tsx` is routed here
/// (plus the native friendly-empty addition) per the no-hardcoded-English rule.
public enum DataTableColumnsMenuStrings {
    public static let table = "DataTableColumnsMenu"

    public static let string: DataTableColumnsMenuResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The trigger / menu accessible name (web `t('table.columns.menu', 'Show or hide columns')`).
    public static var menu: String {
        string("table.columns.menu", "Show or hide columns")
    }

    /// The default trigger's visible label (web `t('table.columns.button', 'Columns')`).
    public static var button: String {
        string("table.columns.button", "Columns")
    }

    /// The popover heading (web `t('table.columns.heading', 'Visible columns')`).
    public static var heading: String {
        string("table.columns.heading", "Visible columns")
    }

    /// The "show every column" control label (web `t('table.columns.showAll', 'Show all')`).
    public static var showAll: String {
        string("table.columns.showAll", "Show all")
    }

    /// Friendly body shown when the menu is opened with no columns (native — never a blank box; the web
    /// renders an empty list).
    public static var empty: String {
        string("table.columns.empty", "No columns to configure")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataTableColumnsMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataTableColumnsMenuTelemetry: DataTableColumnsMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DataTableColumnsMenuController (P1/S8) — state-holder + mutations + routing

/// The surface's observable state-holder — the native peer of the web component's controlled state. The web
/// `<DataTableColumnsMenu>` receives its `visibleKeys` from the parent DataTable and pushes every change back
/// through `onChange`; the native controller instead OWNS the current `visibleKeys` as the view's single
/// source of truth and mirrors each change out through the same `onChange` callback so a host can persist
/// (the web DataTable's `tableId` round-trip), keeping the surface storage-agnostic. It applies the source's
/// mutation handlers through the pure ``DataTableColumnsMenuProjector`` (the last-visible guard, the
/// source-order rebuild on show, "Show all"), exposes the per-row render models + the resolved labels, owns
/// the popover open state (web the `open` `useState` + click-outside / Escape dismiss), and emits
/// `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DataTableColumnsMenuController {
    /// The table's static column descriptions (web `columns` prop). Immutable for an instance; a new table
    /// makes a new controller.
    public let columns: [DataTableColumnsMenuColumn]

    /// The keys of the currently-visible columns (web `visibleKeys` prop), owned here as the view's single
    /// source of truth. Observed so the menu re-renders its rows on every mutation.
    public private(set) var visibleKeys: [String]

    /// Whether the popover is open (web the `open` `useState`). Observed so the host shows / tears down the
    /// popover.
    public var isOpen: Bool = false

    @ObservationIgnored private let onChange: ([String]) -> Void
    @ObservationIgnored private let telemetry: any DataTableColumnsMenuTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    /// Creates the state-holder. `visibleKeys` defaults to every column key (all visible) for a
    /// self-contained / preview instance; `onChange` defaults to a no-op and is supplied by a host that
    /// persists (the web DataTable's `tableId` round-trip).
    public init(
        columns: [DataTableColumnsMenuColumn],
        visibleKeys: [String]? = nil,
        onChange: @escaping ([String]) -> Void = { _ in },
        telemetry: any DataTableColumnsMenuTelemetry = OSLogDataTableColumnsMenuTelemetry()
    ) {
        self.columns = columns
        self.visibleKeys = visibleKeys ?? columns.map(\.key)
        self.onChange = onChange
        self.telemetry = telemetry
    }

    // MARK: derived projections

    /// The per-row render models in source order (web `columns.map(...)`).
    public var rows: [DataTableColumnsMenuRow] {
        DataTableColumnsMenuProjector.rows(columns, visibleKeys: visibleKeys)
    }

    /// The ordered visible columns, for a host that mirrors the menu's selection onto a live table.
    public var visibleColumns: [DataTableColumnsMenuColumn] {
        DataTableColumnsMenuProjector.visibleColumns(columns, visibleKeys: visibleKeys)
    }

    /// Whether the menu has no columns to configure (native friendly-empty branch; the web renders an empty
    /// list).
    public var isEmpty: Bool {
        columns.isEmpty
    }

    /// The trigger / menu accessible name (web `t('table.columns.menu', …)`).
    public var menuLabel: String {
        DataTableColumnsMenuStrings.menu
    }

    /// The popover heading (web `t('table.columns.heading', …)`).
    public var headingLabel: String {
        DataTableColumnsMenuStrings.heading
    }

    // MARK: mutations (web handlers)

    /// Toggles a column's visibility — the native peer of the web `toggle`: refuses to hide the last visible
    /// column (a no-op), otherwise updates the owned keys (rebuilt in source order when showing) and mirrors
    /// them to the host via `onChange`.
    public func toggle(_ key: String) {
        guard let next = DataTableColumnsMenuProjector.toggledKeys(columns, visibleKeys: visibleKeys, key: key)
        else { return }
        visibleKeys = next
        onChange(next)
    }

    /// Shows every column — the native peer of the web `showAll`: sets the owned keys to all column keys and
    /// mirrors them to the host via `onChange`.
    public func showAll() {
        let next = DataTableColumnsMenuProjector.allKeys(columns)
        visibleKeys = next
        onChange(next)
    }

    /// Pushes an externally-owned key set into the controller without re-notifying the host — the
    /// controlled-prop parity for a host that drives the selection itself (e.g. restoring a persisted set).
    /// Does not fire `onChange` (the value came from the host).
    public func apply(_ keys: [String]) {
        visibleKeys = keys
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
            telemetry.viewOpened(surface: DataTableColumnsMenuSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
