// The native Jetpack Compose + Material 3 DataTableColumnsMenu shared surface — a parity port of the web
// column-visibility popover web/src/components/ui/DataTableColumnsMenu.tsx. The web component is a controlled,
// presentational menu: a small trigger button (a Columns glyph + "Columns" text) that opens an anchored popover
// listing one checkbox per column; toggling a row shows/hides that column, a "Show all" reset makes every column
// visible, required columns and the checked last-visible column are disabled (at least one column must stay), and
// click-outside / Escape close it. The parent DataTable owns persistence — this surface holds no column state.
//
// All render decisions flow through the pure [DataTableColumnsMenuProjection] (the per-row checked/disabled, the
// toggle + show-all transitions, the empty classification) so the composable stays a thin render layer (ADR-002).
// Every visible/spoken string resolves through the i18n catalog (P1/S10) and every interactive element carries a
// TalkBack label. The chrome is reused from the shared component library — the anchored [Popover], the [Checkbox]
// rows, the ghost [Button] reset, the [Caption]/[HelperText] type roles, and the [Icon] facade — composed over the
// generated design tokens (P1/S9); no web Tailwind classes. The one-shot `view.opened` diagnostic fires on first
// composition (P1/S11), carrying only the surface slug.
//
// Parity choices:
//   • Anchored popover: web `absolute right-0 mt-1` → the shared [Popover] (a focusable Popup whose Back + outside
//     tap dismiss reproduce the web Escape + click-outside) placed below the trigger via `onSizeChanged`, end-
//     aligned for the web `right-0` (the SavedViewMenu / ActiveFilterChips anchoring idiom).
//   • Checkbox rows: web `<label><input type="checkbox"/>{header}</label>` → the shared component-library
//     [Checkbox] with a label, so the whole row is ONE `Role.Checkbox` target whose framework-localized
//     checked/unchecked announcement and column-header name need no hand-rolled string; `enabled = !disabled`
//     reproduces the web `disabled` rule, so a required or last-visible row cannot be toggled.
//   • Trigger: the default is a token-styled clickable Row (the Columns glyph + the "Columns" text) whose
//     contentDescription is the menu's accessible name (web `aria-label = t('table.columns.menu')`); the visible
//     text is cleared from the a11y tree so it is announced once. A caller-supplied [trigger] render-prop wins
//     verbatim (web `trigger`), receiving the open/close toggle exactly like the web render-prop.
//   • Columns glyph: the web lucide `Columns3` is reproduced as a locally-authored 24×24 stroked vector (Android
//     ships no lucide / material-icons-extended artifact) drawn through the shared [Icon] facade (the same
//     approach as the sibling PlaybackSpeedMenu chevron).
//   • States (Honesty Covenant #9, documented not silent): content = ≥1 column (the checkbox list); empty = no
//     columns → the header still renders plus a friendly `common.noData` line, never a blank box; loading / error
//     / stale / offline have no web branch (the parent owns the table + any data feed), so fabricating them would
//     invent behaviour — see DataTableColumnsMenuModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataTableColumnsMenu) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer, trigger, glyph, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnsmenu

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the default trigger — used by the instrumented open/close + a11y UI tests. */
const val DATA_TABLE_COLUMNS_MENU_TRIGGER_TAG: String = "dataTableColumnsMenuTrigger"

/** Popover content width — web `w-56` (224px). */
private val MENU_WIDTH: Dp = 224.dp

/** Max height of the scrollable column list before it scrolls — web `max-h-64` (256px). */
private val LIST_MAX_HEIGHT: Dp = 256.dp

/** Gap between the trigger and the popover — web `mt-1` (4px). */
private val MENU_GAP: Dp = 4.dp

/** Trigger outline width — web `border` (1px). */
private val TRIGGER_BORDER: Dp = 1.dp

/**
 * The columns glyph the web renders with lucide `Columns3`: a rounded square split by two dividers into three
 * columns. Authored locally as a 24×24 stroked vector (Android ships no lucide artifact) and recolored at render
 * time by the [Icon] tint.
 */
private val ColumnsGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "DataTableColumnsMenuColumns",
            defaultWidth = 16.dp,
            defaultHeight = 16.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(4f, 4f)
                lineTo(20f, 4f)
                lineTo(20f, 20f)
                lineTo(4f, 20f)
                close()
                moveTo(9.33f, 4f)
                lineTo(9.33f, 20f)
                moveTo(14.67f, 4f)
                lineTo(14.67f, 20f)
            }
        }.build()

/**
 * Column-visibility menu — the faithful Android port of the web `DataTableColumnsMenu`. Renders a trigger that
 * opens an anchored popover of one checkbox per column; toggling a row reports the next visible-key list through
 * [onChange] (preserving column order), and "Show all" reports every key. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition and performs no HTTP — the parent DataTable owns persistence.
 *
 * @param columns the columns to list, in display order (web `columns`).
 * @param visibleKeys the keys of the currently-visible columns (web `visibleKeys`).
 * @param onChange invoked with the next visible-key list when a row toggles or "Show all" is pressed (web `onChange`).
 * @param modifier layout modifier for the trigger anchor (the web `className` analogue).
 * @param trigger optional render-prop drawing a custom trigger; it receives the open/close toggle (web `trigger`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun DataTableColumnsMenu(
    columns: List<ColumnDescriptor>,
    visibleKeys: List<String>,
    onChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    trigger: (@Composable (toggle: () -> Unit) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DataTableColumnsMenuDiagnostics.recordViewOpened(logger) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    DataTableColumnsMenuContent(
        columns = columns,
        visibleKeys = visibleKeys,
        onChange = onChange,
        strings = dataTableColumnsMenuStrings(),
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = modifier,
        trigger = trigger,
    )
}

/**
 * Stateless renderer — the unit/preview/UI-test entry point (no diagnostics, no data container). Projects the
 * controlled props through [DataTableColumnsMenuProjection] and lays out the trigger (the caller [trigger] or the
 * default Columns button) plus the anchored [Popover] menu, which is open while [expanded]. Toggling routes
 * straight back through [onChange] / [onExpandedChange]; the open state is controlled so tests can drive it.
 */
@Composable
fun DataTableColumnsMenuContent(
    columns: List<ColumnDescriptor>,
    visibleKeys: List<String>,
    onChange: (List<String>) -> Unit,
    strings: DataTableColumnsMenuStrings,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    trigger: (@Composable (toggle: () -> Unit) -> Unit)? = null,
) {
    val display = remember(columns, visibleKeys) { DataTableColumnsMenuProjection.project(columns, visibleKeys) }
    val gapPx = with(LocalDensity.current) { MENU_GAP.roundToPx() }
    val toggleMenu = { onExpandedChange(!expanded) }
    Box(modifier = modifier) {
        var anchorHeightPx by remember { mutableIntStateOf(0) }
        Box(modifier = Modifier.onSizeChanged { anchorHeightPx = it.height }) {
            if (trigger != null) {
                trigger(toggleMenu)
            } else {
                DataTableColumnsMenuTrigger(
                    label = strings.button,
                    accessibleName = strings.menu,
                    onClick = toggleMenu,
                )
            }
        }
        Popover(
            expanded = expanded,
            onDismissRequest = { onExpandedChange(false) },
            alignment = Alignment.TopEnd,
            offset = IntOffset(0, anchorHeightPx + gapPx),
            accessibleName = strings.menu,
        ) {
            DataTableColumnsMenuPanel(
                display = display,
                columns = columns,
                visibleKeys = visibleKeys,
                strings = strings,
                onChange = onChange,
            )
        }
    }
}

/**
 * The popover body — the web menu panel. A header row (the localized [DataTableColumnsMenuStrings.heading] caption
 * plus the ghost "Show all" reset, disabled when there are no columns) over the per-column checkbox list, or — when
 * there are no columns — the friendly [DataTableColumnsMenuStrings.empty] line so the menu is never a blank box.
 */
@Composable
private fun DataTableColumnsMenuPanel(
    display: DataTableColumnsMenuDisplay,
    columns: List<ColumnDescriptor>,
    visibleKeys: List<String>,
    strings: DataTableColumnsMenuStrings,
    onChange: (List<String>) -> Unit,
) {
    Column(
        modifier = Modifier.width(MENU_WIDTH),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(strings.heading, modifier = Modifier.weight(1f))
            Button(
                label = strings.showAll,
                onClick = { onChange(DataTableColumnsMenuProjection.showAll(columns)) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = display.canShowAll,
            )
        }
        if (display.isEmpty) {
            HelperText(strings.empty, modifier = Modifier.padding(vertical = Spacing.sm))
        } else {
            Column(
                modifier =
                    Modifier
                        .heightIn(max = LIST_MAX_HEIGHT)
                        .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.none),
            ) {
                display.rows.forEach { row ->
                    Checkbox(
                        checked = row.checked,
                        onCheckedChange = {
                            onChange(DataTableColumnsMenuProjection.toggle(columns, visibleKeys, row.key))
                        },
                        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                        label = row.label,
                        enabled = !row.disabled,
                    )
                }
            }
        }
    }
}

/**
 * The default trigger — a token-styled, bordered clickable Row drawing the Columns glyph + the "Columns" [label]
 * (web default `<button>`). The whole row is one [Role.Button] target whose accessible name is [accessibleName]
 * (web `aria-label = t('table.columns.menu')`); the visible label is cleared from the a11y tree so it is announced
 * once. Tapping fires [onClick] to open/close the menu.
 */
@Composable
private fun DataTableColumnsMenuTrigger(
    label: String,
    accessibleName: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = MaterialTheme.shapes.small
    Row(
        modifier =
            modifier
                .testTag(DATA_TABLE_COLUMNS_MENU_TRIGGER_TAG)
                .clip(shape)
                .border(TRIGGER_BORDER, MaterialTheme.colorScheme.outlineVariant, shape)
                .clickable(role = Role.Button, onClick = onClick)
                .semantics { contentDescription = accessibleName }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = ColumnsGlyph,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = label,
            modifier = Modifier.clearAndSetSemantics { },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Resolves the five localized strings from the P1/S10 catalog at the render boundary. */
@Composable
private fun dataTableColumnsMenuStrings(): DataTableColumnsMenuStrings =
    DataTableColumnsMenuStrings(
        menu = stringResource(R.string.translation_table_columns_menu),
        button = stringResource(R.string.translation_table_columns_button),
        heading = stringResource(R.string.translation_table_columns_heading),
        showAll = stringResource(R.string.translation_table_columns_showAll),
        empty = stringResource(R.string.translation_common_noData),
    )

// ── Previews (tooling-only; the sample columns are never shipped UI) ────────────────────────────────────────────

private val previewStrings =
    DataTableColumnsMenuStrings(
        menu = "Show or hide columns",
        button = "Columns",
        heading = "Visible columns",
        showAll = "Show all",
        empty = "No data available",
    )

private val previewColumns =
    listOf(
        ColumnDescriptor(key = "select", header = "Select", required = true),
        ColumnDescriptor(key = "date", header = "Date"),
        ColumnDescriptor(key = "distance", header = "Distance"),
        ColumnDescriptor(key = "energy", header = "Energy"),
    )

@Preview(name = "Trigger (light)", showBackground = true)
@Composable
private fun DataTableColumnsMenuTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableColumnsMenuTrigger(label = previewStrings.button, accessibleName = previewStrings.menu, onClick = {})
    }
}

@Preview(name = "Menu · content", showBackground = true)
@Composable
private fun DataTableColumnsMenuContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableColumnsMenuPanel(
            display = DataTableColumnsMenuProjection.project(previewColumns, listOf("date")),
            columns = previewColumns,
            visibleKeys = listOf("date"),
            strings = previewStrings,
            onChange = {},
        )
    }
}

@Preview(name = "Menu · empty", showBackground = true)
@Composable
private fun DataTableColumnsMenuEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DataTableColumnsMenuPanel(
            display = DataTableColumnsMenuProjection.project(emptyList(), emptyList()),
            columns = emptyList(),
            visibleKeys = emptyList(),
            strings = previewStrings,
            onChange = {},
        )
    }
}

@Preview(name = "Menu · content (dark)", showBackground = true)
@Composable
private fun DataTableColumnsMenuDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        DataTableColumnsMenuPanel(
            display = DataTableColumnsMenuProjection.project(previewColumns, listOf("date", "distance", "energy")),
            columns = previewColumns,
            visibleKeys = listOf("date", "distance", "energy"),
            strings = previewStrings,
            onChange = {},
        )
    }
}
