// Pure, framework-free model + projection + diagnostics for the DataTableColumnsMenu shared surface — the native
// analogue of every decision the web component makes (web/src/components/ui/DataTableColumnsMenu.tsx) before it
// paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these pure functions (the
// accepted sibling-surface contract used by SortControl / Checkbox / PlaybackSpeedMenu).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A CONTROLLED, presentational popover. Its only hook is `useTranslation`; the `columns`, the `visibleKeys`,
//     and the `onChange` callback are caller props — the parent DataTable owns persistence. There is NO data port
//     to bind (no fetch), so modelling a loading / stale / offline lifecycle would invent behaviour the web spec
//     does not have (Honesty Covenant: no scope narrowing, no silent drift), exactly as the accepted SortControl
//     port documents. The reproduced states are: content (≥1 column → the checkbox list) and empty (no columns →
//     the menu still renders its header, never a blank box). loading / error / stale / offline have no web branch.
//   • toggle(key): when the column is currently visible, drop it — UNLESS it is the last visible one, because at
//     least one column must stay (web `if (visibleKeys.length <= 1) return`). When it is hidden, re-add it while
//     PRESERVING the original column order (web `order.filter(k => visibleSet.has(k) || k === key)`). See [toggle].
//   • showAll(): make every column visible, in column order (web `onChange(columns.map(c => c.key))`). See [showAll].
//   • Per-row render decisions: a row is `checked` when its key is in `visibleKeys`; it is `disabled` when the
//     column is `required` OR it is the checked last-visible column (web
//     `col.required || (checked && visibleKeys.length <= 1)`); its visible label is `header || key`. See [project].
//
// i18n: the web component makes exactly FOUR `t()` calls — the menu/trigger aria-label (`table.columns.menu`), the
// trigger text (`table.columns.button`), the list heading (`table.columns.heading`), and the reset action
// (`table.columns.showAll`). All four already exist in the shared P1/S10 catalog; the composable resolves them
// through generated Android string resources. The pure model carries NO English microcopy — the render boundary
// passes the resolved [DataTableColumnsMenuStrings] in. The empty-columns hint reuses the existing generic
// `common.noData` catalog entry (the web source renders an empty `<ul>`; surfacing a friendly line instead of an
// empty region is the documented "never a blank box" enhancement the sibling ports also make — no invented key).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DataTableColumnsMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnsmenu

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the DataTableColumnsMenu surface. [SLUG] is the prompt-mandated diagnostics slug
 * emitted with the one-shot `view.opened` event (P1/S11); [ID] is the stable key a host would bind the surface
 * with.
 */
object DataTableColumnsMenuRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "dataTableColumnsMenu"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "DataTableColumnsMenu"
}

/**
 * A single table column the menu can toggle — the native port of the web `ColumnDescriptor`.
 *
 * @property key the stable column key persisted in `visibleKeys` (web `key`).
 * @property header the human-readable column header shown as the row label (web `header`); falls back to [key].
 * @property required when true the column can never be hidden (web `required`, e.g. selection / expand columns) —
 *   its row is always disabled.
 */
data class ColumnDescriptor(
    val key: String,
    val header: String,
    val required: Boolean = false,
)

/**
 * The localized strings the surface folds into its output, resolved from `stringResource` at the render boundary
 * (tests pass a deterministic instance) so the projection stays a pure, locale-stable function. Each maps to a
 * web `t()` call / P1/S10 catalog key (see [DataTableColumnsMenuKeys]); [empty] reuses `common.noData`.
 *
 * @property menu the trigger + menu accessible name (web `table.columns.menu`, "Show or hide columns").
 * @property button the default trigger's visible label (web `table.columns.button`, "Columns").
 * @property heading the visible-columns list heading (web `table.columns.heading`, "Visible columns").
 * @property showAll the reset action label (web `table.columns.showAll`, "Show all").
 * @property empty the friendly no-columns line (reuses `common.noData`, "No data available").
 */
data class DataTableColumnsMenuStrings(
    val menu: String,
    val button: String,
    val heading: String,
    val showAll: String,
    val empty: String,
)

/**
 * The complete inventory of i18n keys the web DataTableColumnsMenu references (every `t()` call), each mapped to
 * its Android catalog entry (P1/S10). The render boundary resolves these via `stringResource`; this list documents
 * the contract and is asserted complete + unique + prefixed by the model test.
 *
 * - [MENU] → `R.string.translation_table_columns_menu` (the trigger + menu accessible name).
 * - [BUTTON] → `R.string.translation_table_columns_button` (the default trigger's visible label).
 * - [HEADING] → `R.string.translation_table_columns_heading` (the visible-columns list heading).
 * - [SHOW_ALL] → `R.string.translation_table_columns_showAll` (the reset action label).
 */
object DataTableColumnsMenuKeys {
    const val MENU: String = "table.columns.menu"
    const val BUTTON: String = "table.columns.button"
    const val HEADING: String = "table.columns.heading"
    const val SHOW_ALL: String = "table.columns.showAll"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(MENU, BUTTON, HEADING, SHOW_ALL)
}

/**
 * One render-ready checkbox row — everything the web `columns.map(...)` derives per column before drawing the
 * `<label><input type="checkbox"/>…</label>`. Pure data so the projection is unit-tested without a UI host.
 *
 * @property key the column key the toggle reports (web `col.key`).
 * @property label the visible/accessible row label (web `col.header || col.key`).
 * @property checked whether the column is currently visible (web `visibleSet.has(col.key)`).
 * @property disabled whether the row cannot be toggled — required, or the checked last-visible column (web
 *   `col.required || (checked && visibleKeys.length <= 1)`).
 */
data class DataTableColumnRow(
    val key: String,
    val label: String,
    val checked: Boolean,
    val disabled: Boolean,
)

/**
 * The immutable, render-ready projection the composable draws: the per-column [rows], whether there are any
 * columns at all ([hasColumns], which classifies the empty state), and whether the "Show all" reset can do
 * anything ([canShowAll], false only when there are no columns). Pure data so [DataTableColumnsMenuProjection] is
 * unit-tested without a Compose host.
 */
data class DataTableColumnsMenuDisplay(
    val rows: List<DataTableColumnRow>,
    val hasColumns: Boolean,
    val canShowAll: Boolean,
) {
    /** True when there are no columns — the menu renders its header plus the friendly no-columns line. */
    val isEmpty: Boolean get() = !hasColumns
}

/** Pure projection + toggle logic for the surface — the native port of the web component's derivations. */
object DataTableColumnsMenuProjection {
    /** The visible/accessible row label — web `col.header || col.key` (a blank header falls back to the key). */
    fun rowLabel(column: ColumnDescriptor): String = column.header.ifBlank { column.key }

    /**
     * Folds the controlled [columns] + [visibleKeys] into the render-ready [DataTableColumnsMenuDisplay] the
     * composable draws. Each row is `checked` when its key is visible and `disabled` when the column is required or
     * it is the checked last-visible column (the web per-row `disabled` rule). Pure: the view simply reads the
     * projected fields, so every branch is unit-tested off-device.
     */
    fun project(
        columns: List<ColumnDescriptor>,
        visibleKeys: List<String>,
    ): DataTableColumnsMenuDisplay {
        val visible = visibleKeys.toSet()
        val onlyOneVisible = visibleKeys.size <= 1
        val rows =
            columns.map { column ->
                val checked = column.key in visible
                DataTableColumnRow(
                    key = column.key,
                    label = rowLabel(column),
                    checked = checked,
                    disabled = column.required || (checked && onlyOneVisible),
                )
            }
        return DataTableColumnsMenuDisplay(
            rows = rows,
            hasColumns = columns.isNotEmpty(),
            canShowAll = columns.isNotEmpty(),
        )
    }

    /**
     * The next visible-key set after toggling [key] — the native port of the web `toggle`. When [key] is currently
     * visible it is removed, UNLESS it is the last visible column (at least one must stay), in which case the list
     * is returned unchanged (the web early-returns without calling `onChange`). When [key] is hidden it is re-added
     * while preserving the original [columns] order. Pure, so both add and remove paths are unit-tested.
     */
    fun toggle(
        columns: List<ColumnDescriptor>,
        visibleKeys: List<String>,
        key: String,
    ): List<String> {
        val visible = visibleKeys.toSet()
        return if (key in visible) {
            if (visibleKeys.size <= 1) visibleKeys else visibleKeys.filter { it != key }
        } else {
            columns.map { it.key }.filter { it in visible || it == key }
        }
    }

    /** Every column key, in column order — the native port of the web `showAll` (`columns.map(c => c.key)`). */
    fun showAll(columns: List<ColumnDescriptor>): List<String> = columns.map { it.key }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never a column key, header, or any user content — so a diagnostics line can never leak the
 * operator's table layout. Kept free of Compose so the diagnostics contract is unit-tested with a recording
 * [Logger]; the composable calls it once per surface open.
 */
object DataTableColumnsMenuDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (mirrors [DataTableColumnsMenuRegistration]). */
    const val SLUG: String = DataTableColumnsMenuRegistration.SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect; the surface guards it to once per placement.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
