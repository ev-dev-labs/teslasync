// The native Jetpack Compose + Material 3 DataTableColumnMenu shared surface — a parity port of
// web/src/components/ui/DataTableColumnMenu.tsx. The web surface is a controlled, presentational icon-button +
// popover that combines column visibility and column reorder for a DataTable: a heading, a "Reset to defaults"
// affordance, and one row per column — `[checkbox] Header  ↑ ↓` — where the checkbox toggles visibility behind the
// "at least one column must stay visible" guard, a `required` column can never be hidden, and the ↑/↓ buttons are
// the keyboard fallback for drag-to-reorder (disabled at the ends). `reorderable`/`toggleable` collapse it to a
// pure reorder list / pure visibility checklist.
//
// All interaction flows through the shared [DataTableColumnMenuViewModel] (P1/S8): the popover-open flag and the
// column-layout round-trip live there (delegated to a [ColumnLayoutStore]), never in the view. Every visible string
// resolves through the i18n catalog (P1/S10) and every interactive element carries a TalkBack label. The atomic
// chrome (Button, IconButton, Checkbox, Popover, EmptyState) is reused from the shared component library; this
// surface only composes them — no web Tailwind classes, platform design tokens only (P1/S9).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content /
// error / stale / offline contract is mapped onto this controlled surface's real behaviour, because it performs no
// data fetch (see DataTableColumnMenuModel.kt). `content` is the column rows; `empty` is the zero-columns case
// (a friendly EmptyState inside the popover, never a blank box); loading / error / stale / offline have no web
// branch (the host page owns any fetch + its lifecycle).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces
// /DataTableColumnMenu) cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the
// co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the trigger control, so a UI test can open the menu deterministically. */
const val MENU_TRIGGER_TEST_TAG: String = "datatable-column-menu-trigger"

/** Test tag on the popover body (mirrors the web `data-testid="datatable-column-menu"`). */
const val MENU_POPOVER_TEST_TAG: String = "datatable-column-menu"

/** Test tag on the Reset affordance (mirrors the web `data-testid="datatable-column-menu-reset"`). */
const val MENU_RESET_TEST_TAG: String = "datatable-column-menu-reset"

/**
 * Stateful entry point — the faithful port of the web `DataTableColumnMenu`. Binds the popover-open flag and the
 * column-layout round-trip through a [DataTableColumnMenuViewModel] + [ColumnLayoutStore], records the one-shot
 * `view.opened` diagnostic, and renders the trigger + popover. The surface performs no business logic; [logger]
 * defaults to the process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param columns the columns to manage, in source order (web `columns`).
 * @param initialLayout the host's already-read persisted layout, or `null` for a pristine table (web `layout`).
 * @param onLayoutChange notified whenever the layout changes so a host can persist it (web `onChange` / `onReset`).
 * @param reorderable when false the ↑/↓ arrows are hidden — a pure visibility checklist (web `reorderable`).
 * @param toggleable when false the checkboxes are hidden — a pure reorder list (web `toggleable`).
 * @param trigger an optional custom trigger; receives a toggle callback (web `trigger`).
 */
@Composable
fun DataTableColumnMenu(
    columns: List<ColumnDescriptor>,
    modifier: Modifier = Modifier,
    initialLayout: ColumnLayout? = null,
    onLayoutChange: (ColumnLayout?) -> Unit = {},
    reorderable: Boolean = true,
    toggleable: Boolean = true,
    trigger: (@Composable (onToggle: () -> Unit) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DataTableColumnMenuRegistration.ID,
) {
    val store: ColumnLayoutStore = remember(instanceKey) { columnLayoutStore(initialLayout) }
    val viewModel: DataTableColumnMenuViewModel =
        viewModel(key = instanceKey, factory = DataTableColumnMenuViewModel.factory(store, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val open by viewModel.open.collectAsStateWithLifecycle()
    val layout by viewModel.layout.collectAsStateWithLifecycle()

    var initialized by remember { mutableStateOf(false) }
    LaunchedEffect(layout) {
        if (initialized) onLayoutChange(layout) else initialized = true
    }

    DataTableColumnMenuContent(
        columns = columns,
        layout = layout,
        open = open,
        reorderable = reorderable,
        toggleable = toggleable,
        onToggleOpen = viewModel::toggleOpen,
        onDismiss = { viewModel.setOpen(false) },
        onToggleColumn = { key -> viewModel.onToggleColumn(columns, key) },
        onMoveColumn = { key, direction -> viewModel.onMoveColumn(columns, key, direction) },
        onReset = viewModel::resetLayout,
        trigger = trigger,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/preview entry point. Projects [columns] + [layout] into the render model and
 * renders the trigger plus, when [open], the popover (heading, Reset, and the column rows, or a friendly empty
 * state when there are no columns). Fully controlled: the open flag and every mutation are hoisted.
 */
@Composable
fun DataTableColumnMenuContent(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
    open: Boolean,
    reorderable: Boolean,
    toggleable: Boolean,
    onToggleOpen: () -> Unit,
    onDismiss: () -> Unit,
    onToggleColumn: (String) -> Unit,
    onMoveColumn: (String, MoveDirection) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
    trigger: (@Composable (onToggle: () -> Unit) -> Unit)? = null,
) {
    val triggerLabel = stringResource(triggerLabelResId(reorderable))
    var anchorHeightPx by remember { mutableIntStateOf(0) }

    Box(modifier = modifier) {
        if (trigger != null) {
            Box(modifier = Modifier.onSizeChanged { anchorHeightPx = it.height }) { trigger(onToggleOpen) }
        } else {
            DefaultTrigger(
                label = stringResource(R.string.translation_table_columns_button),
                accessibilityLabel = triggerLabel,
                onClick = onToggleOpen,
                modifier = Modifier.onSizeChanged { anchorHeightPx = it.height },
            )
        }

        Popover(
            expanded = open,
            onDismissRequest = onDismiss,
            alignment = Alignment.TopEnd,
            offset = IntOffset(0, anchorHeightPx),
            accessibleName = triggerLabel,
        ) {
            ColumnMenuBody(
                columns = columns,
                layout = layout,
                reorderable = reorderable,
                toggleable = toggleable,
                onToggleColumn = onToggleColumn,
                onMoveColumn = onMoveColumn,
                onReset = onReset,
            )
        }
    }
}

/** The default trigger — an outlined button with the columns glyph + "Columns", labelled for TalkBack. */
@Composable
private fun DefaultTrigger(
    label: String,
    accessibilityLabel: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        label = label,
        onClick = onClick,
        modifier =
            modifier
                .testTag(MENU_TRIGGER_TEST_TAG)
                .semantics { contentDescription = accessibilityLabel },
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
        leadingIcon = ColumnsGlyph,
    )
}

/** The popover body: the heading + Reset header and the per-column rows, or a friendly empty state. */
@Composable
private fun ColumnMenuBody(
    columns: List<ColumnDescriptor>,
    layout: ColumnLayout?,
    reorderable: Boolean,
    toggleable: Boolean,
    onToggleColumn: (String) -> Unit,
    onMoveColumn: (String, MoveDirection) -> Unit,
    onReset: () -> Unit,
) {
    val model = remember(columns, layout) { projectColumnMenu(columns, layout) }
    Column(
        modifier = Modifier.width(MENU_WIDTH).testTag(MENU_POPOVER_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        when (columnMenuSurface(columns.size)) {
            ColumnMenuSurface.Empty ->
                EmptyState(
                    message = stringResource(R.string.translation_common_noData),
                    icon = ColumnsGlyph,
                )

            ColumnMenuSurface.Content -> {
                ColumnMenuHeader(reorderable = reorderable, onReset = onReset)
                model.rows.forEach { row ->
                    ColumnRow(
                        row = row,
                        reorderable = reorderable,
                        toggleable = toggleable,
                        onToggleColumn = onToggleColumn,
                        onMoveColumn = onMoveColumn,
                    )
                }
            }
        }
    }
}

/** The header row: the muted heading and the Reset-to-defaults affordance. */
@Composable
private fun ColumnMenuHeader(
    reorderable: Boolean,
    onReset: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(stringResource(headingResId(reorderable)))
        Button(
            label = stringResource(R.string.translation_table_columns_reset),
            onClick = onReset,
            modifier = Modifier.testTag(MENU_RESET_TEST_TAG),
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = ResetGlyph,
        )
    }
}

/** One column row: an optional visibility checkbox, the header, and the optional ↑/↓ reorder controls. */
@Composable
private fun ColumnRow(
    row: ColumnMenuRow,
    reorderable: Boolean,
    toggleable: Boolean,
    onToggleColumn: (String) -> Unit,
    onMoveColumn: (String, MoveDirection) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (toggleable) {
            val toggleLabel = stringResource(R.string.translation_table_columns_toggleColumn, row.header)
            Checkbox(
                checked = row.checked,
                onCheckedChange = { onToggleColumn(row.key) },
                enabled = row.toggleEnabled,
                modifier = Modifier.semantics { contentDescription = toggleLabel },
            )
        }
        BodyText(row.header, modifier = Modifier.weight(1f), maxLines = 1)
        if (reorderable) {
            IconButton(
                imageVector = TeslaGlyphs.ChevronUp,
                contentDescription = stringResource(R.string.translation_table_columns_moveUp, row.header),
                onClick = { onMoveColumn(row.key, MoveDirection.Up) },
                modifier = Modifier.testTag("$MENU_POPOVER_TEST_TAG-up-${row.key}"),
                enabled = row.canMoveUp,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = stringResource(R.string.translation_table_columns_moveDown, row.header),
                onClick = { onMoveColumn(row.key, MoveDirection.Down) },
                modifier = Modifier.testTag("$MENU_POPOVER_TEST_TAG-down-${row.key}"),
                enabled = row.canMoveDown,
                size = IconSize.Sm,
            )
        }
    }
}

/** The trigger / popover-heading a11y label resource for [reorderable] — the render-side of [triggerLabelKey]. */
@StringRes
private fun triggerLabelResId(reorderable: Boolean): Int =
    if (reorderable) R.string.translation_table_columns_menuReorder else R.string.translation_table_columns_menu

/** The popover-heading string resource for [reorderable] — the render-side of [headingKey]. */
@StringRes
private fun headingResId(reorderable: Boolean): Int =
    if (reorderable) R.string.translation_table_columns_headingReorder else R.string.translation_table_columns_heading

private val MENU_WIDTH = 288.dp

/** Three-column glyph for the trigger (web lucide `Columns3`): a rectangle split into three by two dividers. */
private val ColumnsGlyph: ImageVector =
    menuGlyph("Columns") {
        moveTo(4f, 4f)
        lineTo(20f, 4f)
        lineTo(20f, 20f)
        lineTo(4f, 20f)
        close()
        moveTo(9.33f, 4f)
        lineTo(9.33f, 20f)
        moveTo(14.66f, 4f)
        lineTo(14.66f, 20f)
    }

/** Counter-clockwise circular-arrow glyph for Reset (web lucide `RotateCcw`): a near-full arc with a nock. */
private val ResetGlyph: ImageVector =
    menuGlyph("Reset") {
        moveTo(6.34f, 6.34f)
        arcTo(8f, 8f, 0f, true, true, 6.34f, 17.66f)
        moveTo(6.34f, 6.34f)
        lineTo(3.5f, 6.34f)
        moveTo(6.34f, 6.34f)
        lineTo(6.34f, 9.18f)
    }

/**
 * Authors a 24×24 monochrome stroked [ImageVector] (drawn opaque-black, recolored at render time by [IconButton] /
 * [Button] tint), mirroring the technique the shared [TeslaGlyphs] set uses for glyphs lucide does not ship to
 * Android. Co-located here because both glyphs are private to this surface's trigger + Reset affordances.
 */
private fun menuGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val PREVIEW_COLUMNS: List<ColumnDescriptor> =
    listOf(
        ColumnDescriptor(key = "select", header = "", required = true),
        ColumnDescriptor(key = "name", header = "Name"),
        ColumnDescriptor(key = "vin", header = "VIN"),
        ColumnDescriptor(key = "battery", header = "Battery", defaultVisible = false),
        ColumnDescriptor(key = "updated", header = "Last seen"),
    )

@Preview(name = "Column menu — open (reorder + visibility)", showBackground = true)
@Composable
private fun DataTableColumnMenuOpenPreview() {
    TeslaSyncTheme {
        DataTableColumnMenuContent(
            columns = PREVIEW_COLUMNS,
            layout = defaultColumnLayout(PREVIEW_COLUMNS),
            open = true,
            reorderable = true,
            toggleable = true,
            onToggleOpen = {},
            onDismiss = {},
            onToggleColumn = {},
            onMoveColumn = { _, _ -> },
            onReset = {},
        )
    }
}

@Preview(name = "Column menu — empty (no columns)", showBackground = true)
@Composable
private fun DataTableColumnMenuEmptyPreview() {
    TeslaSyncTheme {
        DataTableColumnMenuContent(
            columns = emptyList(),
            layout = null,
            open = true,
            reorderable = true,
            toggleable = true,
            onToggleOpen = {},
            onDismiss = {},
            onToggleColumn = {},
            onMoveColumn = { _, _ -> },
            onReset = {},
        )
    }
}
