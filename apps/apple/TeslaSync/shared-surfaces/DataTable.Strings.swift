//
//  DataTable.Strings.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The P1/S10 localization facade for the data table — every `t(key, default)` call in
//  `components/ui/DataTable.tsx` routed through a single resolver so the views hold no hardcoded prose. Keys
//  live in the "DataTable" table, folded into the app `Localizable.xcstrings` catalog at integration time; in
//  test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic.
//  The `{{col}}` interpolation token is resolved by ``DataTableInterpolation``.
//

import Foundation

// MARK: - DataTableStrings (P1/S10 facade)

/// Resolves the surface's strings by key with the web English fallback. Each accessor mirrors one web `t(...)`
/// call (plus the native friendly-empty / retry additions the no-hardcoded-English rule requires for the
/// states Apple renders).
public enum DataTableStrings {
    public static let table = "DataTable"

    /// The injectable resolver — the production app passes the P1/S10 facade; tests pass a deterministic
    /// fallback resolver. Defaults to `NSLocalizedString` against the per-surface table.
    public static let string: DataTableResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Error fallback (web SectionErrorBoundary)

    /// The error-fallback title (web `t('errors.section.tableTitle', 'This table failed to render')`).
    public static var errorTitle: String {
        string("errors.section.tableTitle", "This table failed to render")
    }

    /// The retry affordance on the error fallback (native addition — the web boundary auto-retries on
    /// re-render; Apple needs an explicit control).
    public static var retry: String {
        string("table.error.retry", "Try again")
    }

    // MARK: Empty (web `emptyMessage` default)

    /// The default empty-body message (web `emptyMessage = 'No data'`). A caller-supplied message overrides it.
    public static var emptyDefault: String {
        string("table.empty.default", "No data")
    }

    // MARK: Selection (web `table.selection.*`)

    /// A row checkbox's accessible name for its current state (web `selected ? deselectRow : selectRow`).
    public static func rowSelectionLabel(isSelected: Bool) -> String {
        isSelected
            ? string("table.selection.deselectRow", "Deselect row")
            : string("table.selection.selectRow", "Select row")
    }

    /// The select-all header checkbox's accessible name for its current state (web `allSelected ? deselectAll :
    /// selectAll`).
    public static func selectAllLabel(allSelected: Bool) -> String {
        allSelected
            ? string("table.selection.deselectAll", "Deselect all rows")
            : string("table.selection.selectAll", "Select all rows")
    }

    // MARK: Expansion (web `table.expand.*`)

    /// An expand toggle's accessible name for its current state (web `expanded ? collapse : expand`).
    public static func rowExpansionLabel(isExpanded: Bool) -> String {
        isExpanded
            ? string("table.expand.collapse", "Collapse row")
            : string("table.expand.expand", "Expand row")
    }

    /// The expand column header's accessible name (web `t('table.expand.column', 'Expand row')`).
    public static var expandColumnHeader: String {
        string("table.expand.column", "Expand row")
    }

    // MARK: Export (web `table.export.*`)

    /// The CSV button's accessible name (web `aria-label={t('table.export.csv', 'Download table as CSV')}`).
    public static var exportAccessibilityLabel: String {
        string("table.export.csv", "Download table as CSV")
    }

    /// The CSV button's visible label (web `t('table.export.csvButton', 'Download CSV')`).
    public static var exportButtonLabel: String {
        string("table.export.csvButton", "Download CSV")
    }

    // MARK: Resize (web `table.columns.resizeLabel`)

    /// A resize handle's accessible name with the column header interpolated (web `t('table.columns.resizeLabel',
    /// 'Resize column {{col}}', { col: col.header })`).
    public static func resizeLabel(column header: String) -> String {
        DataTableInterpolation.interpolate(
            string("table.columns.resizeLabel", "Resize column {{col}}"),
            ["col": header]
        )
    }
}
