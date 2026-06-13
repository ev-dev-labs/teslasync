// The native Jetpack Compose + Material 3 ListExportMenu shared surface — a parity port of
// web/src/components/forms/ListExportMenu.tsx. The web surface is a download trigger in the list-controls strip
// of history pages (Drives, Charging, Trips) that opens an overflow menu of tabular-export actions: an optional
// scope chooser ("Visible (N)" / "Selected (M)" radios, shown only while rows are selected) followed by two
// file-format rows, "Download as CSV" then "Download as JSON". Both format callbacks receive the chosen
// [ExportScope]. The trigger is disabled — and the menu cannot open — while there is no data to export. It is
// purely presentational: the caller serialises the rows, names the file, and triggers the download.
//
// This port keeps that contract end to end. The Material 3 [DropdownMenu] anchored to the trigger is the
// faithful counterpart of the web relative-div + role="menu"; outside-tap / back dismissal replaces the web
// outside-click / Escape handlers; the scope radios are a Material [RadioButton] `selectableGroup` (the web
// `<fieldset>` of `<input type="radio">`); and every visible string resolves through the i18n catalog (P1/S10)
// so there is no English literal in shipped code. The download / spreadsheet / braces / checklist glyphs are
// drawn locally in the same stroked monochrome style as the sibling ChartExportMenu, so they recolor through
// the shared `Icon` tint without coupling this surface to the chart package.
//
// All derivation flows through the pure reducers in ListExportMenuModel.kt ([listExportInitialScope],
// [listExportResolvedScope], [listExportMenuOpen], [listExportShowScopeChooser], [listExportTriggerLabel],
// [listExportVisibleUsesCount], [listExportFormats]); this composable owns only the open toggle, the scope
// state + its snap-back effect, and the one-shot `view.opened` diagnostic (P1/S11). It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ListExportMenu) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.listexportmenu

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `ListExportMenu`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), owns the menu open toggle plus the scope state and its snap-back effect, and renders the
 * trigger and its overflow menu. Performs no HTTP; the parent serialises the rows in [onExportCsv] / [onExportJson]
 * and owns the [selectedCount] / [visibleCount] / [disabled] props, and [logger] defaults to the process logger.
 *
 * @param onExportCsv invoked with the chosen [ExportScope] when "Download as CSV" is selected (web `onExportCsv`).
 * @param onExportJson invoked with the chosen [ExportScope] when "Download as JSON" is selected (web `onExportJson`).
 * @param selectedCount number of selected rows; when > 0 the scope chooser appears so the export can be scoped to
 *   the selection, and the chosen scope defaults to "Selected" (web `selectedCount`).
 * @param visibleCount number of visible (filtered) rows; when non-null the "Visible" row reads "Visible (N)"
 *   (web `visibleCount`).
 * @param disabled disables the trigger and prevents the menu from opening (web `disabled`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ListExportMenu(
    onExportCsv: (ExportScope) -> Unit,
    onExportJson: (ExportScope) -> Unit,
    modifier: Modifier = Modifier,
    selectedCount: Int = 0,
    visibleCount: Int? = null,
    disabled: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ListExportMenuDiagnostics.recordViewOpened(logger) }

    val menuLabel = stringResource(R.string.translation_listExport_menuLabel)
    val disabledTooltip = stringResource(R.string.translation_listExport_disabledTooltip)
    val buttonText = stringResource(R.string.translation_listExport_button)

    var open by remember { mutableStateOf(false) }
    var scope by remember { mutableStateOf(listExportInitialScope(selectedCount)) }

    // Web snap-back effect: once the selection empties, "Selected" can no longer be the chosen scope.
    LaunchedEffect(selectedCount, scope) {
        val resolved = listExportResolvedScope(scope, selectedCount)
        if (resolved != scope) scope = resolved
    }

    val triggerLabel = listExportTriggerLabel(disabled, menuLabel, disabledTooltip)

    Box(modifier = modifier) {
        ListExportTrigger(
            label = triggerLabel,
            buttonText = buttonText,
            enabled = !disabled,
            onClick = { open = !open },
        )
        DropdownMenu(
            expanded = listExportMenuOpen(open, disabled),
            onDismissRequest = { open = false },
        ) {
            ListExportMenuContent(
                scope = scope,
                selectedCount = selectedCount,
                visibleCount = visibleCount,
                onScopeChange = { scope = it },
                onPickFormat = { format ->
                    open = false
                    when (format) {
                        ListExportFormat.Csv -> onExportCsv(scope)
                        ListExportFormat.Json -> onExportJson(scope)
                    }
                },
            )
        }
    }
}

/**
 * The download trigger — a clickable row of the [ListExportGlyphs.Download] glyph plus the visible "Export"
 * [buttonText]. The whole row carries the localized accessible [label] (web `aria-label` = "Export list" /
 * "No data to export") via merged semantics, with the visible text cleared from accessibility so the node reads
 * exactly the label; a disabled trigger ([enabled] = false) cannot open the menu (web `disabled` trigger).
 */
@Composable
private fun ListExportTrigger(
    label: String,
    buttonText: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .then(if (enabled) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
                .semantics(mergeDescendants = true) {
                    contentDescription = label
                    if (!enabled) disabled()
                }.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(ListExportGlyphs.Download, contentDescription = null, size = IconSize.Sm)
        Text(
            text = buttonText,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}

/**
 * The overflow-menu body — the stateless renderer shared by the live menu and the previews. When
 * [listExportShowScopeChooser] (a non-empty selection) the scope chooser is rendered first, followed by a
 * divider; the two file-format rows ([listExportFormats]) always follow. [onScopeChange] updates the chosen
 * scope; [onPickFormat] dispatches the chosen [ListExportFormat] to the parent (which closes the menu and runs
 * the export with the current scope).
 */
@Composable
private fun ListExportMenuContent(
    scope: ExportScope,
    selectedCount: Int,
    visibleCount: Int?,
    onScopeChange: (ExportScope) -> Unit,
    onPickFormat: (ListExportFormat) -> Unit,
) {
    val csvLabel = stringResource(R.string.translation_listExport_csv)
    val jsonLabel = stringResource(R.string.translation_listExport_json)

    if (listExportShowScopeChooser(selectedCount)) {
        ListExportScopeChooser(
            scope = scope,
            selectedCount = selectedCount,
            visibleCount = visibleCount,
            onScopeChange = onScopeChange,
        )
        HorizontalDivider(
            modifier = Modifier.padding(vertical = Spacing.xs),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
    listExportFormats().forEach { format ->
        val label = if (format == ListExportFormat.Csv) csvLabel else jsonLabel
        val glyph = if (format == ListExportFormat.Csv) ListExportGlyphs.Csv else ListExportGlyphs.Json
        DropdownMenuItem(
            text = { BodyText(label) },
            onClick = { onPickFormat(format) },
            leadingIcon = { Icon(glyph, contentDescription = null, size = IconSize.Sm) },
        )
    }
}

/**
 * The scope chooser — a labeled [selectableGroup] of two [RadioButton] rows (web `<fieldset>` + `<legend>`). The
 * "Visible" row reads its count form "Visible (N)" only when [visibleCount] is supplied ([listExportVisibleUsesCount]);
 * the "Selected" row always carries [selectedCount]. Each row is a single radio target so tapping the label
 * selects it, and the group announces "n of 2" to TalkBack.
 */
@Composable
private fun ListExportScopeChooser(
    scope: ExportScope,
    selectedCount: Int,
    visibleCount: Int?,
    onScopeChange: (ExportScope) -> Unit,
) {
    val legend = stringResource(R.string.translation_listExport_scopeLegend)
    val visibleLabel =
        if (listExportVisibleUsesCount(visibleCount)) {
            stringResource(R.string.translation_listExport_visibleWithCount, visibleCount ?: 0)
        } else {
            stringResource(R.string.translation_listExport_visible)
        }
    val selectedLabel = stringResource(R.string.translation_listExport_selectedWithCount, selectedCount)

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(ListExportGlyphs.ListChecks, contentDescription = null, size = IconSize.Xs)
            Spacer(Modifier.width(Spacing.xs))
            Caption(legend)
        }
        Column(modifier = Modifier.selectableGroup()) {
            ListExportScopeRadio(
                selected = scope == ExportScope.Visible,
                label = visibleLabel,
                onSelect = { onScopeChange(ExportScope.Visible) },
            )
            ListExportScopeRadio(
                selected = scope == ExportScope.Selected,
                label = selectedLabel,
                onSelect = { onScopeChange(ExportScope.Selected) },
            )
        }
    }
}

/**
 * One scope radio row — the native port of the web `ScopeRadio` (`<label><input type="radio"/></label>`). The
 * whole row is the radio target (`Role.RadioButton`, ≥48 dp via the radio control), so tapping the [label] also
 * selects it and the [selected] state is announced.
 */
@Composable
private fun ListExportScopeRadio(
    selected: Boolean,
    label: String,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
                .padding(horizontal = Spacing.xs, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Spacer(Modifier.width(Spacing.xs))
        BodyText(label)
    }
}

/**
 * Export-menu line glyphs not present in the shared `ui.TeslaGlyphs` set, drawn as 24×24 stroked [ImageVector]s
 * in the same monochrome style so they recolor through the `Icon` tint — co-located so this surface ships
 * self-contained without expanding the shared icon set from a per-surface prompt.
 */
private object ListExportGlyphs {
    /** Download tray — the menu trigger (web lucide `Download`). */
    val Download: ImageVector =
        stroked("ListExportDownload") {
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            moveTo(7f, 10.5f)
            lineTo(12f, 15.5f)
            lineTo(17f, 10.5f)
            moveTo(5f, 19f)
            lineTo(19f, 19f)
        }

    /** Spreadsheet document — the CSV row (web lucide `FileSpreadsheet`). */
    val Csv: ImageVector =
        stroked("ListExportCsv") {
            moveTo(7f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(7f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(9.5f, 12.5f)
            lineTo(16.5f, 12.5f)
            moveTo(9.5f, 15.5f)
            lineTo(16.5f, 15.5f)
            moveTo(9.5f, 18.5f)
            lineTo(13f, 18.5f)
        }

    /** Braces document — the JSON row (web lucide `FileJson`). */
    val Json: ImageVector =
        stroked("ListExportJson") {
            moveTo(7f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(7f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(11f, 11.5f)
            lineTo(9.8f, 12.5f)
            lineTo(9.8f, 14.2f)
            lineTo(8.8f, 15f)
            lineTo(9.8f, 15.8f)
            lineTo(9.8f, 17.5f)
            lineTo(11f, 18.5f)
            moveTo(15f, 11.5f)
            lineTo(16.2f, 12.5f)
            lineTo(16.2f, 14.2f)
            lineTo(17.2f, 15f)
            lineTo(16.2f, 15.8f)
            lineTo(16.2f, 17.5f)
            lineTo(15f, 18.5f)
        }

    /** Checklist — the scope-chooser legend glyph (web lucide `ListChecks`). */
    val ListChecks: ImageVector =
        stroked("ListExportListChecks") {
            moveTo(3f, 6f)
            lineTo(4.5f, 7.5f)
            lineTo(7f, 5f)
            moveTo(3f, 13f)
            lineTo(4.5f, 14.5f)
            lineTo(7f, 12f)
            moveTo(10f, 6.5f)
            lineTo(20f, 6.5f)
            moveTo(10f, 13.5f)
            lineTo(20f, 13.5f)
        }

    private fun stroked(
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
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────
// The surface's real states: the ready trigger, the disabled trigger, the open menu without a scope chooser (no
// selection), and the open menu with the scope chooser (a non-empty selection). The open previews render the
// stateless [ListExportMenuContent] directly since a live DropdownMenu is a popup window.

@Preview(name = "Trigger — ready", showBackground = true)
@Composable
private fun ListExportMenuTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ListExportTrigger(label = "Export list", buttonText = "Export", enabled = true, onClick = {})
    }
}

@Preview(name = "Trigger — disabled", showBackground = true)
@Composable
private fun ListExportMenuDisabledTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ListExportTrigger(label = "No data to export", buttonText = "Export", enabled = false, onClick = {})
    }
}

@Preview(name = "Menu — no selection", showBackground = true)
@Composable
private fun ListExportMenuNoSelectionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column {
                ListExportMenuContent(
                    scope = ExportScope.Visible,
                    selectedCount = 0,
                    visibleCount = 128,
                    onScopeChange = {},
                    onPickFormat = {},
                )
            }
        }
    }
}

@Preview(name = "Menu — with selection (scope chooser)", showBackground = true)
@Composable
private fun ListExportMenuWithSelectionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column {
                ListExportMenuContent(
                    scope = ExportScope.Selected,
                    selectedCount = 12,
                    visibleCount = 128,
                    onScopeChange = {},
                    onPickFormat = {},
                )
            }
        }
    }
}
