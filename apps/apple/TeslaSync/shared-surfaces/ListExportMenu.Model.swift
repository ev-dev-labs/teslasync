//
//  ListExportMenu.Model.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  The Foundation-only core of the list-export menu — the native parity of
//  `web/src/components/forms/ListExportMenu.tsx`. The web component is a single Download-icon trigger
//  that opens a popover offering an optional export-scope chooser ("Visible (N)" / "Selected (M)")
//  followed by two file-format actions ("Download as CSV" / "Download as JSON"); whichever format the
//  user picks receives the chosen scope. It is purely presentational and props-driven: its only hook is
//  `useTranslation` (the P1/S10 localisation facade) — there is no network and no data-fetch state
//  holder to bind. This layer mirrors that exactly: the export scope/format value types, the pure
//  projection + scope rules (initial scope, the selected→visible auto-correction, the effective scope
//  handed to the export, the scope-chooser gate, the trigger-label switch), the i18n facade, the
//  diagnostics slug + telemetry seam (P1/S11), and the `@MainActor` action model that owns the
//  host-supplied export callbacks. View-free so every branch and mapping is unit tested without
//  rendering a view.
//
//  Branches reproduced from the web source (every one is exercised — there is no hidden surface):
//    • availability — the native split of the web `disabled` prop, documented as set "while data is
//                     loading or empty": `.ready` opens the menu, `.loading` disables the trigger and
//                     shows a spinner, `.empty` disables + dims it. Both non-ready reasons resolve the
//                     web `disabledTooltip` ("No data to export") and the menu cannot open (web
//                     `open && !disabled`). No stale/offline/error axis is fabricated — the web control
//                     has no query, so inventing one would be silent drift.
//    • scope chooser — shown only when `selectedCount > 0` (web `selectedCount > 0 && <fieldset>`).
//    • initial scope — `selectedCount > 0 ? .selected : .visible` (web `useState` initialiser).
//    • correction    — when the selection empties mid-menu the scope snaps back to `.visible` so the
//                      chosen scope can never be unselectable (web `useEffect`).
//    • effective scope — when the chooser is hidden the export always covers the visible set (web prop
//                      doc: "export will always cover the visible result set").
//    • labels        — "Visible ({{count}})" when a visible count is supplied else "Visible"; the
//                      selected radio is always "Selected ({{count}})" (web ungrouped `{{count}}`).
//

import Foundation
import Observation
import OSLog

// MARK: - Export scope (web `ExportScope = 'visible' | 'selected'`)

/// Which rows an export covers — the native port of the web `type ExportScope = 'visible' | 'selected'`.
/// `visible` exports the filtered result set; `selected` exports only the chosen rows (offered only
/// when there is a selection).
public enum ListExportScope: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// The visible (filtered) result set — the web default and the only scope when nothing is selected.
    case visible
    /// The currently selected rows — offered only when `selectedCount > 0`.
    case selected

    public var id: String {
        rawValue
    }
}

// MARK: - Export format (the two web file-format menu items)

/// The file formats the menu can export — one case per web `role="menuitem"` button. CSV leads, JSON
/// follows (the verbatim web order).
public enum ListExportFormat: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// "Download as CSV" (web `FileSpreadsheet` item).
    case csv
    /// "Download as JSON" (web `FileJson` item).
    case json

    public var id: String {
        rawValue
    }

    /// The SF Symbol mirroring the web lucide glyph for the format.
    public var systemImage: String {
        switch self {
        case .csv: "tablecells" // web FileSpreadsheet
        case .json: "curlybraces" // web FileJson
        }
    }
}

// MARK: - Trigger availability (native split of the web `disabled` boolean)

/// Why the trigger is (or is not) actionable — the typed native split of the single web `disabled`
/// prop, whose doc-comment says it is set "while data is loading or empty". `.ready` opens the menu;
/// `.loading` and `.empty` both disable the trigger (the web `disabled` affordance) and surface the
/// "No data to export" label, differing only in the trigger's visual (spinner vs dimmed).
public enum ListExportAvailability: String, Sendable, Equatable, CaseIterable {
    /// Data is present — the trigger opens the menu (web `!disabled`).
    case ready
    /// Data is still loading — the trigger is disabled and shows a spinner (web `disabled`).
    case loading
    /// The list resolved with no rows — the trigger is disabled and dimmed (web `disabled`).
    case empty

    /// Whether the trigger is inert and the menu cannot open (web `disabled`).
    public var isDisabled: Bool {
        self != .ready
    }
}

// MARK: - Pure projection logic (web scope rules + trigger-label switch + format list)

/// The view-free decision logic ported from the web component: the scope initialiser, the
/// selected→visible auto-correction, the scope-chooser gate, the effective scope handed to the export,
/// the trigger-label switch, the open guard, and the ordered format list. Each function is a direct
/// translation of a web branch so the view stays a pure function of these and every branch is unit
/// tested in isolation.
public enum ListExportMenuLogic {
    /// The scope the menu opens with — the web `useState(selectedCount > 0 ? 'selected' : 'visible')`.
    public static func initialScope(selectedCount: Int) -> ListExportScope {
        selectedCount > 0 ? .selected : .visible
    }

    /// The scope after the selection-empties correction — the web `useEffect` that snaps `selected`
    /// back to `visible` once `selectedCount` hits zero so the chosen scope is never unselectable.
    public static func correctedScope(_ current: ListExportScope, selectedCount: Int) -> ListExportScope {
        selectedCount == 0 && current == .selected ? .visible : current
    }

    /// Whether the scope chooser is shown — the web `selectedCount > 0 && <fieldset>` gate.
    public static func showsScopeChooser(selectedCount: Int) -> Bool {
        selectedCount > 0
    }

    /// The scope actually handed to the export — when the chooser is hidden the export always covers
    /// the visible set (web prop doc), otherwise the corrected current scope.
    public static func effectiveScope(_ current: ListExportScope, selectedCount: Int) -> ListExportScope {
        guard showsScopeChooser(selectedCount: selectedCount) else { return .visible }
        return correctedScope(current, selectedCount: selectedCount)
    }

    /// The trigger's accessible label key + web English fallback — the web
    /// `disabled ? disabledTooltip : menuLabel` switch.
    public static func triggerLabel(availability: ListExportAvailability) -> (key: String, fallback: String) {
        availability.isDisabled
            ? ("listExport.disabledTooltip", "No data to export")
            : ("listExport.menuLabel", "Export list")
    }

    /// Whether the menu may open — the web `open && !disabled` guard reduced to its precondition.
    public static func canOpen(availability: ListExportAvailability) -> Bool {
        availability == .ready
    }

    /// The ordered format rows — the verbatim web order: CSV then JSON.
    public static let formatOrder: [ListExportFormat] = [.csv, .json]

    /// The localisation key + web English fallback for a format's menu label.
    public static func label(for format: ListExportFormat) -> (key: String, fallback: String) {
        switch format {
        case .csv: ("listExport.csv", "Download as CSV")
        case .json: ("listExport.json", "Download as JSON")
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum ListExportMenuMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ListExportMenu"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ListExportMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogListExportMenuTelemetry: ListExportMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the menu appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum ListExportMenuDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any ListExportMenuTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: ListExportMenuMeta.surfaceSlug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ListExportMenu" table (the exact set from the web source
/// `components/forms/ListExportMenu.tsx`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings. The `{{count}}`
/// templates are interpolated ungrouped, matching the web `t(key, default, { count })`.
public enum ListExportMenuStrings {
    public static let table = "ListExportMenu"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Substitutes the web `{{count}}` token with the ungrouped integer (web `{ count }`).
    static func interpolateCount(_ template: String, _ count: Int) -> String {
        template.replacingOccurrences(of: "{{count}}", with: String(count))
    }

    /// The resolved trigger label for the current availability (web `disabled ? disabledTooltip : …`).
    public static func triggerLabel(availability: ListExportAvailability) -> String {
        let label = ListExportMenuLogic.triggerLabel(availability: availability)
        return string(label.key, label.fallback)
    }

    /// The short trigger button caption (web `t('listExport.button', 'Export')`).
    public static func exportButtonLabel() -> String {
        string("listExport.button", "Export")
    }

    /// The scope fieldset legend (web `t('listExport.scopeLegend', 'Export scope')`).
    public static func scopeLegend() -> String {
        string("listExport.scopeLegend", "Export scope")
    }

    /// The resolved menu label for a format (web `t(item.key, item.default)`).
    public static func formatLabel(_ format: ListExportFormat) -> String {
        let label = ListExportMenuLogic.label(for: format)
        return string(label.key, label.fallback)
    }

    /// The "Visible" radio label — "Visible ({{count}})" when a visible count is supplied, else the
    /// bare "Visible" (web `visibleCount != null ? withCount : visible`).
    public static func visibleScopeLabel(visibleCount: Int?) -> String {
        guard let visibleCount else {
            return string("listExport.visible", "Visible")
        }
        return interpolateCount(string("listExport.visibleWithCount", "Visible ({{count}})"), visibleCount)
    }

    /// The "Selected" radio label — always "Selected ({{count}})" (web `selectedWithCount`).
    public static func selectedScopeLabel(selectedCount: Int) -> String {
        interpolateCount(string("listExport.selectedWithCount", "Selected ({{count}})"), selectedCount)
    }

    /// The resolved radio label for a scope, given the counts (the spoken content for each radio row).
    public static func scopeLabel(
        _ scope: ListExportScope,
        visibleCount: Int?,
        selectedCount: Int
    ) -> String {
        switch scope {
        case .visible: visibleScopeLabel(visibleCount: visibleCount)
        case .selected: selectedScopeLabel(selectedCount: selectedCount)
        }
    }
}

// MARK: - Action model (@MainActor owner of the host export callbacks)

/// The `@MainActor` action model the view binds through — the home for the host-supplied export
/// callbacks (the native shape of the web `onExportCsv` / `onExportJson` props) and the once-only
/// `view.opened` emission. The view stays a pure function of `availability` / `selectedCount` /
/// `visibleCount` + its local scope `@State`; this model carries the side effects (the export
/// dispatch) off the view. The web component is purely presentational — the host serialises the data,
/// builds the filename, and triggers the download — so the callbacks are fire-and-forget `Void`,
/// receiving only the chosen scope.
@MainActor
@Observable
public final class ListExportMenuModel {
    @ObservationIgnored private let onExport: @MainActor (ListExportFormat, ListExportScope) -> Void
    @ObservationIgnored private let telemetry: any ListExportMenuTelemetry
    @ObservationIgnored private var didEmitOpen = false

    /// Designated initializer taking a unified export sink. `onExport` receives the chosen format and
    /// the effective scope (the parity of the web `onExportCsv(scope)` / `onExportJson(scope)` call).
    public init(
        onExport: @escaping @MainActor (ListExportFormat, ListExportScope) -> Void,
        telemetry: any ListExportMenuTelemetry = OSLogListExportMenuTelemetry()
    ) {
        self.onExport = onExport
        self.telemetry = telemetry
    }

    /// Convenience initializer wiring the two web callbacks directly — the parity of mounting
    /// `<ListExportMenu onExportCsv={…} onExportJson={…} />`. The format is dispatched to the matching
    /// handler with the chosen scope.
    public convenience init(
        onExportCsv: @escaping @MainActor (ListExportScope) -> Void,
        onExportJson: @escaping @MainActor (ListExportScope) -> Void,
        telemetry: any ListExportMenuTelemetry = OSLogListExportMenuTelemetry()
    ) {
        self.init(
            onExport: { format, scope in
                switch format {
                case .csv: onExportCsv(scope)
                case .json: onExportJson(scope)
                }
            },
            telemetry: telemetry
        )
    }

    /// Emits `view.opened` exactly once, the first time the menu appears (idempotent).
    public func markAppeared() {
        didEmitOpen = ListExportMenuDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// Dispatches the chosen export — the synchronous parity of the web item `onClick` handlers, which
    /// close the menu then call `onExportCsv(scope)` / `onExportJson(scope)`.
    public func export(_ format: ListExportFormat, scope: ListExportScope) {
        onExport(format, scope)
    }
}
