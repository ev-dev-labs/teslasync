// Compose render layer for the ExportModal modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/dashboard/components/ExportModal.tsx). It is a thin shell over the pure
// [ExportModalProjection] derivations (ExportModalModel.kt): a Material 3 [Modal] hosting the dashboard summary
// (a mini-grid layout preview, the name, the widget-count + JSON-size chips, and the "Updated …" line) and the
// three stacked export actions (Download JSON file, Copy to clipboard, Copy shareable URL). The view performs NO
// HTTP and binds no fetch — the web component's only data dependencies are `useTranslation` (i18n) and
// `useDateFormat` (the locale/tz date formatter); the `dashboard` is handed in by the owning page, and the
// download decision is handed back through the [onDownload] callback exactly as the web `onDownload` prop is.
//
// Web `open` prop -> host-gated composition: the web renders only when `open=true` (its Modal handles the render
// gate). The Compose idiom — prescribed by the shared `components/ui/Modal` KDoc — is to compose
// `ExportModal(...)` conditionally (`if (open) ExportModal(...)`), so this surface maps to the `open=true` render
// and the owning view gates it (exactly as the sibling FeedbackModal / ConfirmDialog surfaces do).
//
// Dismiss semantics: the web binds Escape -> onClose and backdrop-click -> onClose. The Compose [Modal] (a
// platform [androidx.compose.ui.window.Dialog]) routes system-back AND outside-tap to `onDismissRequest`, wired
// to [onClose] (back is the platform equivalent of Escape). The download action mirrors the web `handleDownload`
// (fire `onDownload()` then `onClose()`).
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the `space-y-5` body / `gap-4` summary / `space-y-2` actions
// map to `Spacing` tokens; the `w-32` preview maps to a fixed [MINI_GRID_WIDTH]; the chips map to the shared
// [Badge]; the warning callout maps to the shared [AlertBanner] (tone=Warning, the AlertTriangle equivalent). The
// `Download` / `Package` lucide glyphs the web imports have no entry in the shared [TeslaGlyphs] set, so they are
// authored locally here as 24x24 stroked vectors (the shared atomic glyph set is owned by the P3 component-library
// bundle and is out of scope to extend from a single surface).
//
// CopyButton parity: the web `CopyButton withToast` shows a transient toast on copy; the shared native [CopyButton]
// flips to a "copied" confirmation label for two seconds — the platform-idiomatic equivalent of the same feedback,
// so no separate toast host is wired here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ExportModal) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed because the file's primary export is the
// `ExportModal` composable (matching the filename); the co-located test-tag / glyph declarations are supporting.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.exportmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Test tags for the nodes the UI test selects. */
object ExportModalTestTags {
    const val ROOT: String = "export-modal"
    const val SUMMARY: String = "export-modal-summary"
    const val MINI_GRID: String = "export-modal-mini-grid"
    const val DOWNLOAD: String = "export-modal-download"
    const val COPY_CLIPBOARD: String = "export-modal-copy-clipboard"
    const val COPY_SHARE_URL: String = "export-modal-copy-share-url"
    const val SHARE_WARNING: String = "export-modal-share-warning"
}

/**
 * Stateful entry point — the faithful port of the web `ExportModal({ open, onClose, dashboard, onDownload })`.
 * Composes only while the owner holds the sheet open (web `open`). It records the one-shot, PII-safe
 * `view.opened` diagnostic on first composition (P1/S11), derives every render input via the pure
 * [ExportModalProjection], resolves the localized microcopy + the locale/tz date (web `useTranslation` +
 * `useDateFormat`), and renders the [Modal] shell over the stateless [ExportModalContent].
 *
 * @param dashboard the layout being exported (web `dashboard`); supplied by the owning page, never fetched here.
 * @param onClose dismiss handler (web `onClose`); fired on back / backdrop dismiss and after a download.
 * @param onDownload the JSON-file download trigger (web `onDownload`); fired before [onClose] on the download tap.
 * @param shareOrigin the deployed web-app origin the shareable deep link targets (web `window.location.origin`);
 *   defaults to the build's API base URL, the self-hosted reverse-proxy origin.
 * @param zoneId display zone for the "Updated …" date; defaults to the device zone (test seam).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ExportModal(
    dashboard: SavedDashboard,
    onClose: () -> Unit,
    onDownload: () -> Unit,
    modifier: Modifier = Modifier,
    shareOrigin: String = BuildConfig.API_BASE_URL,
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ExportModalDiagnostics.recordViewOpened(logger) }

    val projection = remember(dashboard, shareOrigin) { ExportModalProjection.project(dashboard, shareOrigin) }
    val dateText = rememberUpdatedDateText(projection.updatedAt, projection.updatedAtRaw, zoneId)

    val shareErrorMessage =
        if (projection.shareUrlTooLong) {
            stringResource(R.string.translation_export_urlTooLong, projection.shareUrlLength)
        } else {
            null
        }

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = stringResource(R.string.translation_export_title),
        closeLabel = stringResource(R.string.translation_a11y_closeDialog),
    ) {
        ExportModalContent(
            dashboardName = dashboard.name,
            widgetCountLabel = stringResource(R.string.translation_export_widgetCount, projection.widgetCount),
            jsonSizeLabel = projection.jsonSize,
            updatedLabel = stringResource(R.string.translation_export_updated, dateText),
            miniGrid = projection.miniGrid,
            downloadLabel = stringResource(R.string.translation_export_downloadFile),
            copyClipboardLabel = stringResource(R.string.translation_export_copyClipboard),
            copiedLabel = stringResource(R.string.translation_export_copied),
            copyShareUrlLabel = stringResource(R.string.translation_export_copyShareUrl),
            urlCopiedLabel = stringResource(R.string.translation_export_urlCopied),
            dashboardJson = projection.dashboardJson,
            shareUrl = projection.shareUrl,
            shareUrlTooLong = projection.shareUrlTooLong,
            shareErrorMessage = shareErrorMessage,
            onDownload = {
                onDownload()
                onClose()
            },
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the dashboard summary (mini-grid
 * preview + name + chips + updated line) and the three stacked export actions, plus the optional too-long warning
 * banner. The "Copy Shareable URL" action disables when [shareUrlTooLong]; the warning [shareErrorMessage] renders
 * only when present (web `shareError && <AlertBanner>`).
 */
@Composable
fun ExportModalContent(
    dashboardName: String,
    widgetCountLabel: String,
    jsonSizeLabel: String,
    updatedLabel: String,
    miniGrid: MiniGrid,
    downloadLabel: String,
    copyClipboardLabel: String,
    copiedLabel: String,
    copyShareUrlLabel: String,
    urlCopiedLabel: String,
    dashboardJson: String,
    shareUrl: String,
    shareUrlTooLong: Boolean,
    shareErrorMessage: String?,
    onDownload: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ExportModalTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        ExportSummary(
            dashboardName = dashboardName,
            widgetCountLabel = widgetCountLabel,
            jsonSizeLabel = jsonSizeLabel,
            updatedLabel = updatedLabel,
            miniGrid = miniGrid,
        )

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = downloadLabel,
                onClick = onDownload,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(ExportModalTestTags.DOWNLOAD),
                variant = ButtonVariant.Primary,
                size = ButtonSize.Md,
                leadingIcon = DownloadGlyph,
            )
            CopyButton(
                text = dashboardJson,
                copyLabel = copyClipboardLabel,
                copiedLabel = copiedLabel,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(ExportModalTestTags.COPY_CLIPBOARD),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Md,
            )
            CopyButton(
                text = shareUrl,
                copyLabel = copyShareUrlLabel,
                copiedLabel = urlCopiedLabel,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(ExportModalTestTags.COPY_SHARE_URL),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Md,
                enabled = !shareUrlTooLong,
            )
        }

        if (shareErrorMessage != null) {
            AlertBanner(
                message = shareErrorMessage,
                modifier = Modifier.testTag(ExportModalTestTags.SHARE_WARNING),
                tone = Tone.Warning,
            )
        }
    }
}

/** The dashboard summary row — the mini-grid preview alongside the name, the count/size chips, and the date. */
@Composable
private fun ExportSummary(
    dashboardName: String,
    widgetCountLabel: String,
    jsonSizeLabel: String,
    updatedLabel: String,
    miniGrid: MiniGrid,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ExportModalTestTags.SUMMARY),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.Top,
    ) {
        MiniGridPreview(
            miniGrid = miniGrid,
            modifier =
                Modifier
                    .width(MINI_GRID_WIDTH)
                    .testTag(ExportModalTestTags.MINI_GRID),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Heading(text = dashboardName, level = HeadingLevel.Panel, maxLines = 1)
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = PackageGlyph,
                        contentDescription = null,
                        size = IconSize.Xs,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Badge(text = widgetCountLabel, variant = BadgeVariant.Neutral)
                }
                Badge(text = jsonSizeLabel, variant = BadgeVariant.Neutral)
            }
            HelperText(text = updatedLabel)
        }
    }
}

/**
 * The mini-grid layout preview — the native analogue of web `MiniGridPreview`. Tiles are absolutely placed inside
 * a fixed-aspect bordered frame ([MiniGrid.aspectRatio]); each [MiniGridBox] is offset + sized by its grid
 * fraction. An empty layout renders a friendly centered grid glyph rather than a blank frame.
 */
@Composable
private fun MiniGridPreview(
    miniGrid: MiniGrid,
    modifier: Modifier = Modifier,
) {
    val frameShape = RoundedCornerShape(Radius.sm)
    val tileShape = RoundedCornerShape(MINI_TILE_RADIUS)
    val tileColor = MaterialTheme.colorScheme.surfaceVariant
    val tileBorder = MaterialTheme.colorScheme.outline
    BoxWithConstraints(
        modifier =
            modifier
                .aspectRatio(miniGrid.aspectRatio)
                .clip(frameShape)
                .background(MaterialTheme.colorScheme.surface)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), frameShape),
    ) {
        if (miniGrid.boxes.isEmpty()) {
            Icon(
                imageVector = GridGlyph,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.Center),
            )
        } else {
            val gridWidth = maxWidth
            val gridHeight = maxHeight
            miniGrid.boxes.forEach { box ->
                Box(
                    modifier =
                        Modifier
                            .offset(x = gridWidth * box.xFraction, y = gridHeight * box.yFraction)
                            .size(width = gridWidth * box.wFraction, height = gridHeight * box.hFraction)
                            .padding(MINI_TILE_GAP)
                            .clip(tileShape)
                            .background(tileColor)
                            .border(BorderStroke(1.dp, tileBorder), tileShape),
                )
            }
        }
    }
}

/**
 * Resolves the localized "Updated …" date string from the parsed [updatedAt] instant (web `useDateFormat`'s
 * locale/zone-aware `formatDate`), falling back to the raw [updatedAtRaw] string — or an em dash when blank — so
 * an unparseable timestamp never blanks the line.
 */
@Composable
private fun rememberUpdatedDateText(
    updatedAt: Instant?,
    updatedAtRaw: String,
    zoneId: ZoneId,
): String {
    val locale = Locale.getDefault()
    val formatter =
        remember(locale, zoneId) {
            DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zoneId)
        }
    return updatedAt?.let { formatter.format(it) } ?: updatedAtRaw.ifBlank { EM_DASH }
}

private const val EM_DASH = "—"
private val MINI_GRID_WIDTH = 128.dp
private val MINI_TILE_GAP = 1.dp
private val MINI_TILE_RADIUS = 2.dp

// ── Local glyphs (lucide Download / Package have no shared TeslaGlyphs entry; Grid backs the empty preview) ──────

/** Lucide `download` — a down arrow over a baseline tray. Decorative; recolored by the [Icon] tint. */
private val DownloadGlyph: ImageVector =
    surfaceGlyph("ExportDownload") {
        moveTo(12f, 3f)
        lineTo(12f, 15f)
        moveTo(7f, 10f)
        lineTo(12f, 15f)
        lineTo(17f, 10f)
        moveTo(5f, 20f)
        lineTo(19f, 20f)
    }

/** Lucide `package` — a 3D box outline with a top fold + vertical seam. Decorative. */
private val PackageGlyph: ImageVector =
    surfaceGlyph("ExportPackage") {
        moveTo(12f, 3f)
        lineTo(20f, 7.5f)
        lineTo(20f, 16.5f)
        lineTo(12f, 21f)
        lineTo(4f, 16.5f)
        lineTo(4f, 7.5f)
        close()
        moveTo(4f, 7.5f)
        lineTo(12f, 12f)
        lineTo(20f, 7.5f)
        moveTo(12f, 12f)
        lineTo(12f, 21f)
    }

/** A 2x2 grid — the friendly empty-layout indicator for the mini-grid preview. Decorative. */
private val GridGlyph: ImageVector =
    surfaceGlyph("ExportGrid") {
        moveTo(4f, 4f)
        lineTo(20f, 4f)
        lineTo(20f, 20f)
        lineTo(4f, 20f)
        close()
        moveTo(12f, 4f)
        lineTo(12f, 20f)
        moveTo(4f, 12f)
        lineTo(20f, 12f)
    }

/** Builds a 24x24 round-capped stroked [ImageVector], mirroring the shared [io.teslasync.android.components.ui.TeslaGlyphs] style. */
private fun surfaceGlyph(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────────

private val PREVIEW_DASHBOARD: SavedDashboard =
    SavedDashboard(
        id = "dash-1",
        name = "Daily Driver Overview",
        widgets =
            listOf(
                WidgetInstance(id = "w-1", widgetId = "battery-health"),
                WidgetInstance(id = "w-2", widgetId = "range-estimate"),
                WidgetInstance(id = "w-3", widgetId = "charging-status"),
                WidgetInstance(id = "w-4", widgetId = "trip-summary"),
            ),
        layouts =
            mapOf(
                "lg" to
                    listOf(
                        LayoutItem(i = "w-1", x = 0, y = 0, w = 2, h = 2),
                        LayoutItem(i = "w-2", x = 2, y = 0, w = 2, h = 1),
                        LayoutItem(i = "w-3", x = 2, y = 1, w = 1, h = 1),
                        LayoutItem(i = "w-4", x = 3, y = 1, w = 1, h = 1),
                    ),
            ),
        updatedAt = "2026-06-12T09:30:00Z",
    )

@Preview(name = "Export — populated", showBackground = true, widthDp = 420)
@Composable
private fun ExportModalPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ExportModalContent(
            dashboardName = PREVIEW_DASHBOARD.name,
            widgetCountLabel = "4 widgets",
            jsonSizeLabel = "1.2 KB",
            updatedLabel = "Updated Jun 12, 2026",
            miniGrid = ExportModalProjection.miniGrid(PREVIEW_DASHBOARD),
            downloadLabel = "Download JSON File",
            copyClipboardLabel = "Copy to Clipboard",
            copiedLabel = "Copied!",
            copyShareUrlLabel = "Copy Shareable URL",
            urlCopiedLabel = "URL Copied!",
            dashboardJson = "{}",
            shareUrl = "https://app.teslasync.io/dashboard#import=eyJ9",
            shareUrlTooLong = false,
            shareErrorMessage = null,
            onDownload = {},
        )
    }
}

@Preview(name = "Export — URL too long", showBackground = true, widthDp = 420)
@Composable
private fun ExportModalTooLongPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ExportModalContent(
            dashboardName = PREVIEW_DASHBOARD.name,
            widgetCountLabel = "24 widgets",
            jsonSizeLabel = "6.4 KB",
            updatedLabel = "Updated Jun 12, 2026",
            miniGrid = ExportModalProjection.miniGrid(PREVIEW_DASHBOARD),
            downloadLabel = "Download JSON File",
            copyClipboardLabel = "Copy to Clipboard",
            copiedLabel = "Copied!",
            copyShareUrlLabel = "Copy Shareable URL",
            urlCopiedLabel = "URL Copied!",
            dashboardJson = "{}",
            shareUrl = "https://app.teslasync.io/dashboard#import=eyJ9",
            shareUrlTooLong = true,
            shareErrorMessage = "Layout too large for URL sharing (2480 chars). Use clipboard or file export instead.",
            onDownload = {},
        )
    }
}

@Preview(name = "Export — empty layout", showBackground = true, widthDp = 420)
@Composable
private fun ExportModalEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ExportModalContent(
            dashboardName = "Empty Dashboard",
            widgetCountLabel = "0 widgets",
            jsonSizeLabel = "64 B",
            updatedLabel = "Updated Jun 12, 2026",
            miniGrid = ExportModalProjection.miniGrid(SavedDashboard(id = "empty", name = "Empty Dashboard")),
            downloadLabel = "Download JSON File",
            copyClipboardLabel = "Copy to Clipboard",
            copiedLabel = "Copied!",
            copyShareUrlLabel = "Copy Shareable URL",
            urlCopiedLabel = "URL Copied!",
            dashboardJson = "{}",
            shareUrl = "https://app.teslasync.io/dashboard#import=eyJ9",
            shareUrlTooLong = false,
            shareErrorMessage = null,
            onDownload = {},
        )
    }
}
