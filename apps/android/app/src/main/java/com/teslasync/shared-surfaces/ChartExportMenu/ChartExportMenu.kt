// The native Jetpack Compose + Material 3 ChartExportMenu shared surface — a parity port of
// web/src/components/charts/ChartExportMenu.tsx. The web surface is a single download-icon trigger embedded in
// a chart's title bar that opens an overflow menu of export actions: an optional "Download data as CSV" row
// (first), then "Save as PNG", "Save as SVG", and "Copy image to clipboard". The trigger is disabled — and the
// menu cannot open — while the chart is not ready; the three image rows are disabled while a snapshot is in
// flight; and the copy action announces its result through the ambient toast (copied → success, fallback →
// info, failed → error). It is purely presentational: the parent owns the capture/file-IO callbacks and the
// disabled/busy flags.
//
// This port keeps that contract end to end. The Material 3 [DropdownMenu] anchored to an [IconButton] trigger is
// the faithful counterpart of the web relative-div + role="menu"; outside-tap / back dismissal replaces the web
// outside-click / Escape handlers; and every visible string resolves through the i18n catalog (P1/S10) so there
// is no English literal in shipped code. Web `useOptionalToast()` (the ambient controller, null outside a
// provider) maps to the optional [onAnnounceToast] sink: the menu builds a localized, toned [ToastItem] for the
// copy outcome and hands it to the host's toast queue, degrading silently when no sink is wired — exactly like
// the web `if (!toast) return`. SVG export is kept as a first-class action (the host owns the actual capture),
// matching the web menu's four rows.
//
// All derivation flows through the pure reducers in ChartExportMenuModel.kt ([chartExportMenuItems],
// [chartExportMenuOpen], [chartExportTriggerLabel], [copyToastSeverity]); this composable owns only the open
// toggle, the toast-id sequence, the copy coroutine, and the one-shot `view.opened` diagnostic (P1/S11). It
// performs NO HTTP. The download / spreadsheet / image / file glyphs are drawn locally in the same stroked
// monochrome style as the chart layer's `ChartGlyphs`, so they recolor through the shared `Icon` tint without
// coupling this surface to the chart package.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartExportMenu) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartexportmenu

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/**
 * Stateful entry point — the faithful port of the web `ChartExportMenu`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), owns the menu open toggle + the toast-id sequence, and renders the trigger plus its
 * overflow menu. Performs no HTTP; the parent owns the capture/file-IO callbacks and the [disabled] / [busy]
 * flags, and [logger] defaults to the process logger.
 *
 * @param onExportPng invoked when "Save as PNG" is selected (web `onExportPNG`).
 * @param onExportSvg invoked when "Save as SVG" is selected (web `onExportSVG`).
 * @param onCopyImage runs the clipboard copy and resolves to a [ClipboardOutcome] the menu announces via a
 *   toast (web `onCopyImage`). Suspends so the host can capture the chart off the main thread.
 * @param onExportCsv when non-null, the optional "Download data as CSV" row appears first and stays enabled even
 *   while [busy] (web `onExportCsv`); when null the row is omitted.
 * @param disabled disables the trigger and prevents the menu from opening (web `disabled`).
 * @param busy disables the PNG / SVG / Copy rows while a snapshot is in flight; the CSV row is unaffected
 *   (web `busy`).
 * @param onAnnounceToast the ambient toast sink (web `useOptionalToast()`); when null the copy outcome is
 *   announced silently — the menu degrades gracefully exactly like the web menu outside a ToastProvider.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChartExportMenu(
    onExportPng: () -> Unit,
    onExportSvg: () -> Unit,
    onCopyImage: suspend () -> ClipboardOutcome,
    modifier: Modifier = Modifier,
    onExportCsv: (() -> Unit)? = null,
    disabled: Boolean = false,
    busy: Boolean = false,
    onAnnounceToast: ((ToastItem) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ChartExportMenuDiagnostics.recordViewOpened(logger) }

    val menuLabel = stringResource(R.string.translation_chart_export_menuLabel)
    val disabledTooltip = stringResource(R.string.translation_chart_export_disabledTooltip)
    val copySuccess = stringResource(R.string.translation_chart_export_copySuccess)
    val copyFallback = stringResource(R.string.translation_chart_export_copyFallback)
    val copyFailed = stringResource(R.string.translation_chart_export_copyFailed)

    var open by remember { mutableStateOf(false) }
    var toastSeq by remember { mutableLongStateOf(0L) }
    val scope = rememberCoroutineScope()

    val items = chartExportMenuItems(hasCsv = onExportCsv != null, busy = busy)
    val triggerLabel = chartExportTriggerLabel(disabled, menuLabel, disabledTooltip)

    Box(modifier = modifier) {
        ChartExportTrigger(
            label = triggerLabel,
            enabled = !disabled,
            onClick = { open = !open },
        )
        DropdownMenu(
            expanded = chartExportMenuOpen(open, disabled),
            onDismissRequest = { open = false },
        ) {
            ChartExportMenuItems(
                items = items,
                onAction = { action ->
                    open = false
                    when (action) {
                        ChartExportAction.Csv -> onExportCsv?.invoke()
                        ChartExportAction.Png -> onExportPng()
                        ChartExportAction.Svg -> onExportSvg()
                        ChartExportAction.Copy ->
                            scope.launch {
                                val outcome = onCopyImage()
                                val sink = onAnnounceToast ?: return@launch
                                sink(
                                    ToastItem(
                                        id = toastSeq++,
                                        message = copyOutcomeMessage(outcome, copySuccess, copyFallback, copyFailed),
                                        tone = copyOutcomeTone(outcome),
                                    ),
                                )
                            }
                    }
                },
            )
        }
    }
}

/**
 * The download-icon trigger — an [IconButton] whose [contentDescription] is the localized [label] so TalkBack
 * announces the action. A disabled trigger ([enabled] = false) cannot open the menu (web `disabled` trigger).
 */
@Composable
private fun ChartExportTrigger(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    IconButton(
        imageVector = ChartExportGlyphs.Download,
        contentDescription = label,
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        size = IconSize.Sm,
    )
}

/**
 * The overflow-menu rows — the stateless renderer shared by the live menu and the previews. Each [items] row
 * becomes a [DropdownMenuItem] with its localized label (announced to TalkBack) and a decorative leading glyph;
 * a disabled row reflects the busy snapshot. [onAction] dispatches the row's [ChartExportAction] to the parent.
 */
@Composable
private fun ChartExportMenuItems(
    items: List<ChartExportMenuItem>,
    onAction: (ChartExportAction) -> Unit,
) {
    val csvLabel = stringResource(R.string.translation_chart_export_csv)
    val pngLabel = stringResource(R.string.translation_chart_export_png)
    val svgLabel = stringResource(R.string.translation_chart_export_svg)
    val copyLabel = stringResource(R.string.translation_chart_export_copy)
    items.forEach { item ->
        val label =
            when (item.action) {
                ChartExportAction.Csv -> csvLabel
                ChartExportAction.Png -> pngLabel
                ChartExportAction.Svg -> svgLabel
                ChartExportAction.Copy -> copyLabel
            }
        DropdownMenuItem(
            text = { BodyText(label) },
            onClick = { onAction(item.action) },
            enabled = item.enabled,
            leadingIcon = {
                Icon(chartExportGlyph(item.action), contentDescription = null, size = IconSize.Sm)
            },
        )
    }
}

/** The shared toast [Tone] a copy outcome paints with — the view side of the model's [copyToastSeverity]. */
private fun copyOutcomeTone(outcome: ClipboardOutcome): Tone =
    when (copyToastSeverity(outcome)) {
        CopyToastSeverity.Success -> Tone.Success
        CopyToastSeverity.Info -> Tone.Info
        CopyToastSeverity.Error -> Tone.Danger
    }

/** The already-localized toast message a copy outcome announces — the view side of [copyToastSeverity]. */
private fun copyOutcomeMessage(
    outcome: ClipboardOutcome,
    copied: String,
    fallback: String,
    failed: String,
): String =
    when (copyToastSeverity(outcome)) {
        CopyToastSeverity.Success -> copied
        CopyToastSeverity.Info -> fallback
        CopyToastSeverity.Error -> failed
    }

/** Map a menu [ChartExportAction] to its leading glyph (CSV/PNG/SVG local glyphs; copy reuses the shared one). */
private fun chartExportGlyph(action: ChartExportAction): ImageVector =
    when (action) {
        ChartExportAction.Csv -> ChartExportGlyphs.Csv
        ChartExportAction.Png -> ChartExportGlyphs.Png
        ChartExportAction.Svg -> ChartExportGlyphs.Svg
        ChartExportAction.Copy -> TeslaGlyphs.Copy
    }

/**
 * Export-menu line glyphs not present in the shared `ui.TeslaGlyphs` set, drawn as 24×24 stroked [ImageVector]s
 * in the same monochrome style so they recolor through the `Icon` tint — co-located so this surface ships
 * self-contained without expanding the shared icon set from a per-surface prompt.
 */
private object ChartExportGlyphs {
    /** Download tray — the menu trigger (web lucide `Download`). */
    val Download: ImageVector =
        stroked("ChartExportDownload") {
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
        stroked("ChartExportCsv") {
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

    /** Framed image — the PNG row (web lucide `Image`). */
    val Png: ImageVector =
        stroked("ChartExportPng") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(4f, 15f)
            lineTo(9f, 10f)
            lineTo(13f, 14f)
            lineTo(16f, 11f)
            lineTo(20f, 15f)
            moveTo(8.5f, 9.5f)
            lineTo(8.7f, 9.5f)
        }

    /** Image document — the SVG row (web lucide `FileImage`). */
    val Svg: ImageVector =
        stroked("ChartExportSvg") {
            moveTo(7f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(7f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(9f, 18.5f)
            lineTo(11.5f, 15f)
            lineTo(13.5f, 17f)
            lineTo(16.5f, 13f)
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
// The surface's real states: the closed trigger, the disabled trigger, the open menu (with the optional CSV
// row), and the busy menu (image rows disabled, CSV still enabled). The open/busy previews render the stateless
// [ChartExportMenuItems] directly since a live DropdownMenu is a popup window.

@Preview(name = "Trigger — ready", showBackground = true)
@Composable
private fun ChartExportMenuTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartExportTrigger(label = "Export chart", enabled = true, onClick = {})
    }
}

@Preview(name = "Trigger — disabled", showBackground = true)
@Composable
private fun ChartExportMenuDisabledTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartExportTrigger(label = "Chart not ready to export", enabled = false, onClick = {})
    }
}

@Preview(name = "Menu — open (with CSV)", showBackground = true)
@Composable
private fun ChartExportMenuOpenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column {
                ChartExportMenuItems(
                    items = chartExportMenuItems(hasCsv = true, busy = false),
                    onAction = {},
                )
            }
        }
    }
}

@Preview(name = "Menu — busy (image rows disabled)", showBackground = true)
@Composable
private fun ChartExportMenuBusyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column {
                ChartExportMenuItems(
                    items = chartExportMenuItems(hasCsv = true, busy = true),
                    onAction = {},
                )
            }
        }
    }
}
