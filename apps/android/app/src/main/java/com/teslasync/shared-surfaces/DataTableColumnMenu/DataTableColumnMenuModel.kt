// Pure, framework-free model + projection + diagnostics for the DataTableColumnMenu shared surface — the native
// analogue of everything the web source owns before it returns JSX (web/src/components/ui/DataTableColumnMenu.tsx)
// plus the storage-agnostic layout algebra it delegates to (web/src/lib/columnOrderStore.ts). No Compose, no
// Android framework, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a controlled,
// presentational icon-button + popover that combines column visibility and column reorder for a DataTable. One row
// per column — `[checkbox] Header  ↑ ↓` — with a heading and a "Reset to defaults" affordance. The checkbox toggles
// visibility behind the "at least one column must stay visible" guard; a `required` column can never be hidden; the
// ↑/↓ buttons are the keyboard fallback for drag-to-reorder, disabled at the ends of the list. `reorderable`
// hides the arrows (pure visibility checklist) and `toggleable` hides the checkboxes (pure reorder list). The
// component is deliberately storage-agnostic — the host DataTable owns the persistence round-trip and feeds it the
// current `layout` plus a controlled `onChange` / `onReset`; the only UI hook is `useTranslation` (P1/S10).
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — this is a controlled surface with no data feed, so several templated states have no
// web branch and are reproduced as the source's real behaviour rather than invented):
//   content => one or more columns => [ColumnMenuSurface.Content]: the heading, the Reset affordance, and one
//              [ColumnMenuRow] per column with its checkbox + reorder state.
//   empty   => zero columns => [ColumnMenuSurface.Empty]: a friendly, labelled empty state inside the popover
//              (never a blank box) — the honest native rendering of a menu opened over a table with no columns.
//   loading / error / stale / offline => not applicable to a controlled presentational surface with no data feed;
//              the host page owns any fetch + its lifecycle (web parity — there is no such branch).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DataTableColumnMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ActiveFilterChips / Toast surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the DataTableColumnMenu surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates; [ID] is the stable `viewModel`
 * key a host binds a placement with. Neither carries a column key, header, VIN, or any user content, so a
 * diagnostics line can never leak the operator's table layout.
 */
object DataTableColumnMenuRegistration {
    /** Stable surface id (also the default `viewModel` key a host binds a placement with). */
    const val ID: String = "datatable-column-menu"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DataTableColumnMenu"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The complete inventory of i18n keys the web DataTableColumnMenu references (every `t()` call), mapped to its
 * Android catalog entry (P1/S10, `translation_table_columns_*` in `strings.xml`). The render boundary resolves
 * these via `stringResource`; this list documents the contract and is asserted complete + unique by the model test.
 *
 * - [MENU_REORDER] → `R.string.translation_table_columns_menuReorder` ("Reorder or hide columns", trigger a11y when
 *   reorderable).
 * - [MENU] → `R.string.translation_table_columns_menu` ("Show or hide columns", trigger a11y when not reorderable).
 * - [BUTTON] → `R.string.translation_table_columns_button` ("Columns", the default trigger label).
 * - [HEADING_REORDER] → `R.string.translation_table_columns_headingReorder` ("Columns", popover heading when
 *   reorderable).
 * - [HEADING] → `R.string.translation_table_columns_heading` ("Visible columns", popover heading otherwise).
 * - [RESET] → `R.string.translation_table_columns_reset` ("Reset", the reset-to-defaults affordance).
 * - [TOGGLE_COLUMN] → `R.string.translation_table_columns_toggleColumn` ("Show or hide {col}", each checkbox label).
 * - [MOVE_UP] → `R.string.translation_table_columns_moveUp` ("Move {col} up", each up-arrow label).
 * - [MOVE_DOWN] → `R.string.translation_table_columns_moveDown` ("Move {col} down", each down-arrow label).
 */
object DataTableColumnMenuKeys {
    const val MENU_REORDER: String = "table.columns.menuReorder"
    const val MENU: String = "table.columns.menu"
    const val BUTTON: String = "table.columns.button"
    const val HEADING_REORDER: String = "table.columns.headingReorder"
    const val HEADING: String = "table.columns.heading"
    const val RESET: String = "table.columns.reset"
    const val TOGGLE_COLUMN: String = "table.columns.toggleColumn"
    const val MOVE_UP: String = "table.columns.moveUp"
    const val MOVE_DOWN: String = "table.columns.moveDown"

    /** Every key the web source references, in source order. */
    val ALL: List<String> =
        listOf(MENU_REORDER, MENU, BUTTON, HEADING_REORDER, HEADING, RESET, TOGGLE_COLUMN, MOVE_UP, MOVE_DOWN)
}

/**
 * One column the menu can show / hide / reorder — the native mirror of the web `ColumnDescriptor`. Pure data (no
 * Compose, no callbacks) so the whole layout algebra is unit-tested without a UI host.
 *
 * @property key stable column id used as the render key + the order/hidden token (web `key`).
 * @property header the already-localized column header shown in the row (web `header`); falls back to [key] when
 *   blank, exactly like the web `col.header || col.key`.
 * @property required when true the column can never be hidden (e.g. a selection / expand column); reorder is
 *   unaffected (web `required`).
 * @property defaultVisible the column's visibility before the user touches anything, used by [defaultColumnLayout]
 *   and the "Reset" computation; defaults to true (web `defaultVisible`).
 */
data class ColumnDescriptor(
    val key: String,
    val header: String,
    val required: Boolean = false,
    val defaultVisible: Boolean = true,
)

/**
 * The persisted per-table column layout — the native mirror of the web `ColumnLayout`. [order] is the column-key
 * order (keys absent here keep their default position AFTER any present keys, in source order); [hidden] is the set
 * of keys the user has hidden. Pure data so the persistence seam ([ColumnLayoutStore]) and the algebra below stay
 * framework-free.
 */
data class ColumnLayout(
    val order: List<String>,
    val hidden: List<String>,
) {
    companion object {
        /** The empty layout — no explicit order, nothing hidden (web `EMPTY_LAYOUT`). */
        val EMPTY: ColumnLayout = ColumnLayout(order = emptyList(), hidden = emptyList())
    }
}

/**
 * The full ordered key list (visible + hidden) the menu renders rows from — the native port of the web
 * `effectiveColumnOrder`. Keys in [ColumnLayout.order] lead (de-duplicated, dropping keys no longer present), then
 * any remaining columns follow in source order so a brand-new column always appears without manual intervention. A
 * null or order-less [layout] yields plain source order.
 */
fun effectiveColumnOrder(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
): List<String> {
    if (layout == null || layout.order.isEmpty()) return columns.map { it.key }
    val knownKeys = columns.mapTo(mutableSetOf()) { it.key }
    val ordered = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    for (key in layout.order) {
        if (key in knownKeys && seen.add(key)) ordered.add(key)
    }
    for (column in columns) {
        if (seen.add(column.key)) ordered.add(column.key)
    }
    return ordered
}

/**
 * The effective ordered, visible columns for rendering the table itself — the native port of the web
 * `applyColumnLayout`. With a null [layout] it honours each column's `defaultVisible`; otherwise it drops hidden
 * keys from [effectiveColumnOrder]. If the result would be empty (e.g. a stale stored layout hid everything) it
 * falls back to the default-visible set so the table never renders zero columns.
 */
fun applyColumnLayout(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
): List<ColumnDescriptor> {
    val defaultVisible = columns.filter { it.defaultVisible }
    if (layout == null) return defaultVisible
    val knownKeys = columns.mapTo(mutableSetOf()) { it.key }
    val hiddenSet = layout.hidden.filterTo(mutableSetOf()) { it in knownKeys }
    val byKey = columns.associateBy { it.key }
    val visible = effectiveColumnOrder(columns, layout).filter { it !in hiddenSet }.mapNotNull { byKey[it] }
    return visible.ifEmpty { defaultVisible }
}

/**
 * Moves [key] to position [toIndex] within [currentOrder], returning the new full order — the native port of the
 * web `moveColumn`. The caller first derives [currentOrder] via [effectiveColumnOrder] so it already covers every
 * known key; an out-of-range [toIndex] is clamped and a missing [key] is returned unchanged.
 */
fun moveColumn(
    currentOrder: List<String>,
    key: String,
    toIndex: Int,
): List<String> {
    val fromIndex = currentOrder.indexOf(key)
    if (fromIndex < 0) return currentOrder.toList()
    val next = currentOrder.toMutableList()
    next.removeAt(fromIndex)
    next.add(toIndex.coerceIn(0, next.size), key)
    return next
}

/**
 * Toggles a column's hidden state, returning a fresh layout — the native port of the web `toggleHiddenColumn`. The
 * [ColumnLayout.order] is preserved (un-hiding a key restores it to its previously-set position).
 */
fun toggleHiddenColumn(
    layout: ColumnLayout,
    key: String,
): ColumnLayout =
    ColumnLayout(
        order = layout.order.toList(),
        hidden = if (key in layout.hidden) layout.hidden.filterNot { it == key } else layout.hidden + key,
    )

/**
 * Builds the initial layout for a table the first time the user opens the menu — the native port of the web
 * `defaultColumnLayout`. Seeds [ColumnLayout.order] with source order and [ColumnLayout.hidden] from each column's
 * `defaultVisible == false`, so toggling one checkbox writes a complete picture rather than a partial one.
 */
fun defaultColumnLayout(columns: List<ColumnDescriptor>): ColumnLayout =
    ColumnLayout(
        order = columns.map { it.key },
        hidden = columns.filterNot { it.defaultVisible }.map { it.key },
    )

/** The direction a column moves in the order list — the native mirror of the web `direction: -1 | 1`. */
enum class MoveDirection(
    val delta: Int,
) {
    /** Move the column one slot earlier (web `↑`, `direction = -1`). */
    Up(-1),

    /** Move the column one slot later (web `↓`, `direction = 1`). */
    Down(1),
}

/**
 * Applies the visibility toggle for [key], returning the next layout or `null` when the change must be ignored —
 * the native port of the web `handleToggle`. A `null` mirrors the web early `return`: hiding the last remaining
 * visible column is refused so the table never renders empty. The visible count is measured against the live
 * [layout] (web `applyColumnLayout(columns, layout)`), and the mutation is applied to the seeded base layout.
 */
fun toggleColumnLayout(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
    key: String,
): ColumnLayout? {
    val base = layout ?: defaultColumnLayout(columns)
    val isHidden = key in base.hidden
    val visibleCount = applyColumnLayout(columns, layout).size
    if (!isHidden && visibleCount <= 1) return null
    return toggleHiddenColumn(base, key)
}

/**
 * Applies a reorder of [key] in [direction], returning the next layout or `null` when the move is a no-op — the
 * native port of the web `handleMove`. A `null` mirrors the web early `return`: an unknown key or a move past
 * either end of the list is refused. The [ColumnLayout.hidden] set is carried through unchanged.
 */
fun moveColumnInLayout(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
    key: String,
    direction: MoveDirection,
): ColumnLayout? {
    val base = layout ?: defaultColumnLayout(columns)
    val currentOrder = effectiveColumnOrder(columns, base)
    val fromIndex = currentOrder.indexOf(key)
    val toIndex = fromIndex + direction.delta
    if (fromIndex < 0 || toIndex < 0 || toIndex >= currentOrder.size) return null
    return ColumnLayout(order = moveColumn(currentOrder, key, toIndex), hidden = base.hidden.toList())
}

/**
 * One render-ready row of the menu — the fully-folded native projection of the per-column branch the web component
 * computes inside its `orderedKeys.map(...)`. Pure data (no Compose) so every disabled/checked branch is unit-tested
 * without a UI host.
 *
 * @property key the column key — the render key and the token passed back to the toggle / move callbacks.
 * @property header the already-localized label shown in the row (web `col.header || col.key`).
 * @property checked whether the column is currently visible (web `!isHidden`).
 * @property toggleEnabled whether the checkbox is interactive — false for a required column or the last remaining
 *   visible column (web `!checkboxDisabled`).
 * @property canMoveUp whether the up-arrow is enabled — false for the first row (web `!upDisabled`).
 * @property canMoveDown whether the down-arrow is enabled — false for the last row (web `!downDisabled`).
 */
data class ColumnMenuRow(
    val key: String,
    val header: String,
    val checked: Boolean,
    val toggleEnabled: Boolean,
    val canMoveUp: Boolean,
    val canMoveDown: Boolean,
)

/**
 * The complete render-ready projection of the menu body — the native fold of the web component's `orderedKeys`,
 * `colByKey`, `visibleCount`, and `effectiveHidden` derivations. The composable renders [rows] in order;
 * [visibleCount] is surfaced for tests + assistive context.
 *
 * @property rows one [ColumnMenuRow] per known column, in effective layout order.
 * @property visibleCount the number of currently-visible columns (web `applyColumnLayout(columns, layout).length`).
 */
data class ColumnMenuModel(
    val rows: List<ColumnMenuRow>,
    val visibleCount: Int,
)

/**
 * Folds [columns] + the current [layout] into the render-ready [ColumnMenuModel] — the storage-agnostic projection
 * the composable paints. Pure, so the per-column checked / disabled state is unit-tested off-device (this is the
 * surface's "cached layout → projection" adapter).
 */
fun projectColumnMenu(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
): ColumnMenuModel {
    val orderedKeys = effectiveColumnOrder(columns, layout)
    val byKey = columns.associateBy { it.key }
    val visibleCount = applyColumnLayout(columns, layout).size
    val effectiveHidden = (layout ?: defaultColumnLayout(columns)).hidden.toSet()
    val lastIndex = orderedKeys.lastIndex
    val rows =
        orderedKeys.mapIndexedNotNull { index, key ->
            val column = byKey[key] ?: return@mapIndexedNotNull null
            val checked = key !in effectiveHidden
            ColumnMenuRow(
                key = column.key,
                header = column.header.ifEmpty { column.key },
                checked = checked,
                toggleEnabled = !(column.required || (checked && visibleCount <= 1)),
                canMoveUp = index != 0,
                canMoveDown = index != lastIndex,
            )
        }
    return ColumnMenuModel(rows = rows, visibleCount = visibleCount)
}

/**
 * The render-ready classification of the menu body — a closed set the view switches on, so every branch is
 * exhaustively covered and unit-tested off-device. A column-less table yields [Empty] (a friendly empty state,
 * never a blank popover); any columns yield [Content].
 */
sealed interface ColumnMenuSurface {
    /** No columns to manage — the popover shows a labelled empty state. */
    data object Empty : ColumnMenuSurface

    /** One or more columns — the popover shows the heading, Reset, and the column rows. */
    data object Content : ColumnMenuSurface
}

/** Selects the render-ready [ColumnMenuSurface] for a menu over [columnCount] columns. */
fun columnMenuSurface(columnCount: Int): ColumnMenuSurface = if (columnCount == 0) ColumnMenuSurface.Empty else ColumnMenuSurface.Content

/**
 * The trigger's accessibility label varies with [reorderable] — the native fold of the web `triggerLabel` ternary.
 * [DataTableColumnMenuKeys] resolution happens at the render boundary; this picks the right key.
 */
fun triggerLabelKey(reorderable: Boolean): String = if (reorderable) DataTableColumnMenuKeys.MENU_REORDER else DataTableColumnMenuKeys.MENU

/** The popover-heading i18n key for the current mode — "Columns" when reorderable, else "Visible columns". */
fun headingKey(reorderable: Boolean): String = if (reorderable) DataTableColumnMenuKeys.HEADING_REORDER else DataTableColumnMenuKeys.HEADING

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [DataTableColumnMenuRegistration.SLUG]
 * (P1/S11) — never a column key, header, or any user content, so a diagnostics line can never leak the operator's
 * table layout. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once
 * per surface open.
 */
fun recordDataTableColumnMenuOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DataTableColumnMenuRegistration.SLUG))
}
