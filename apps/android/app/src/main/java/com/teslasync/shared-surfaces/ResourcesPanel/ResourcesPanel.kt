// The native Jetpack Compose + Material 3 ResourcesPanel shared surface — a parity port of
// web/src/components/status/ResourcesPanel.tsx. The web surface is a "server resources at-a-glance" panel: a
// "Resources" heading inside a GlassPanel over a stack of rows, where each row shows a label, a right-aligned
// value (e.g. "1.8 GB"), an optional meta value (e.g. "of 8 GB"), an optional leading icon, and — only when a
// `percent` is supplied — a horizontal usage bar whose colour follows a status threshold (warn ≥70, critical
// ≥90). An optional footnote sits beneath the rows. It is pure presentational — the parent owns the
// already-formatted rows + footnote, and the component has no data hook.
//
// Every status/colour/bar decision flows through the pure model in ResourcesPanelModel.kt
// (ResourcesPanelModel.projectRow → [ResourceRowProjection]; [ResourceSeverity.barTone] /
// [ResourceSeverity.valueTone]); this composable is a thin render layer that maps the projected tones onto the
// per-theme TeslaTokens status palette (P1/S9), draws the clamped bar fill, and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11) on first composition. It performs NO HTTP and binds NO data state holder.
//
// Faithful mapping of the web behaviour:
//   • the web `<GlassPanel className="p-4">` → the shared [GlassPanel] at [PanelPadding.Lg] (the web 16 dp pad);
//   • the web `<h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">` heading → a [PanelTitle]
//     (the title-small SemiBold role) over a [TITLE_BOTTOM_GAP], rendering the caller-supplied, already-localized
//     [title] (see ResourcesPanelModel.kt for why the heading is hoisted to the caller, not a hard literal);
//   • the web `space-y-3` row stack → a [Column] spaced by [ROW_GAP]; an EMPTY stack renders a friendly
//     [EmptyState] (the prompt's non-blank contract) instead of the web's blank area;
//   • each web row `space-y-1.5` (the label line above its bar) → a per-row [Column] spaced by [ROW_INNER_GAP];
//   • the web `flex items-center gap-3` label line → a [Row]: the optional muted icon, the truncated label
//     (`flex-1 truncate text-sm text-[var(--text-secondary)]`), and the right-aligned value + optional meta
//     (`shrink-0 text-sm font-medium tabular-nums {textColor}` + `ml-1 text-xs text-[var(--text-muted)]`);
//   • the web usage bar `h-1.5 rounded-full bg-white/[0.06]` track with a `{barColor}` fill at
//     `width: max(0,min(100,percent))%` → a pill-clipped track + a fraction-filled pill, the fraction taken from
//     the clamped [ResourceRowProjection.barFraction];
//   • the web footnote `mt-3 text-xs text-[var(--text-muted)]` → a [HelperText] under a [FOOTNOTE_TOP_GAP].
//
// Accessibility: each usage bar exposes `progressBarRangeInfo` so TalkBack announces its percentage (the native
// analogue of the web `role="progressbar" aria-valuenow/min/max`), named by the caller's row label (the web
// `aria-label`). The icon is decorative (web `aria-hidden`). The panel has no interactive elements; the empty
// state carries its own spoken description. The surface owns no copy beyond the caller-supplied [title]/rows and
// the generic empty-state string, so there are no English literals here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ResourcesPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer, the `ResourceRow` data class, the helpers, and the previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.resourcespanel

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the panel root — lets a UI test locate the rendered panel in any state. */
const val RESOURCES_PANEL_ROOT_TAG: String = "resources-panel-root"

/** Test tag on each usage bar track — lets a UI test assert the bar's presence and its progress semantics. */
const val RESOURCES_PANEL_BAR_TAG: String = "resources-panel-bar"

/** Test tag on the empty-state surface — lets a UI test assert the non-blank empty branch. */
const val RESOURCES_PANEL_EMPTY_TAG: String = "resources-panel-empty"

/** Gap under the heading — the web `mb-3` (12 dp). */
private val TITLE_BOTTOM_GAP: Dp = Spacing.md

/** Gap between rows — the web `space-y-3` (12 dp). */
private val ROW_GAP: Dp = Spacing.md

/** Gap between a row's label line and its usage bar — the web `space-y-1.5` (6 dp). */
private val ROW_INNER_GAP: Dp = 6.dp

/** Gap above the footnote — the web `mt-3` (12 dp). */
private val FOOTNOTE_TOP_GAP: Dp = Spacing.md

/** Usage-bar height — the web `h-1.5` (6 dp). */
private val BAR_HEIGHT: Dp = 6.dp

/** Start padding on the meta value — the web `ml-1` (4 dp). */
private val META_START_GAP: Dp = Spacing.xs

/** Faint track fill behind the bar — the web `bg-white/[0.06]`, theme-aware via onSurface. */
private const val BAR_TRACK_ALPHA: Float = 0.06f

/** The accessibility range a usage bar reports — a `0f..1f` fraction (its fill). */
private val PROGRESS_RANGE: ClosedFloatingPointRange<Float> = 0f..1f

/**
 * One resource row the panel renders — the native mirror of the web `ResourceRow` prop. The parent supplies the
 * already-formatted, already-localized [label] / [valueText] / [metaText]; the optional [percent] drives the
 * usage bar + its status colour; the optional [icon] is a decorative leading glyph.
 *
 * @param label the row's left-aligned, truncated label (web `label`).
 * @param valueText the right-aligned display value, e.g. "1.8 GB" (web `valueText`).
 * @param metaText optional smaller, muted sub-value, e.g. "of 8 GB" (web `metaText`).
 * @param percent optional 0-100 usage percent driving the bar + status; null hides the bar (web `percent`).
 * @param icon optional decorative leading icon (web `icon`), rendered in the muted secondary colour.
 */
data class ResourceRow(
    val label: String,
    val valueText: String,
    val metaText: String? = null,
    val percent: Double? = null,
    val icon: ImageVector? = null,
)

/**
 * Stateful entry point — the faithful port of `<ResourcesPanel rows={…} footnote={…} />`. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11) on first composition and renders the panel. Always renders (the web
 * component never returns `null`). Performs no HTTP. For a host that composes many panels and does not want a
 * per-panel diagnostic, [ResourcesPanelContent] is the diagnostics-free render seam.
 *
 * @param title the panel heading, an already-localized caller-supplied string (web hardcoded "Resources"; see
 *   ResourcesPanelModel.kt for why it is hoisted to the caller).
 * @param rows the resource rows to render (web `rows`); an empty list renders the friendly empty state.
 * @param footnote optional muted note beneath the rows (web `footnote`) — already-localized.
 * @param emptyMessage the copy shown when [rows] is empty; defaults to the generic `common.noData` catalog key.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through.
 */
@Composable
fun ResourcesPanel(
    title: String,
    rows: List<ResourceRow>,
    modifier: Modifier = Modifier,
    footnote: String? = null,
    emptyMessage: String = stringResource(R.string.translation_common_noData),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ResourcesPanelDiagnostics.recordViewOpened(logger) }
    ResourcesPanelContent(
        title = title,
        rows = rows,
        modifier = modifier,
        footnote = footnote,
        emptyMessage = emptyMessage,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point (it emits no diagnostics
 * and never touches [LocalDataContainer]). Lays out the heading, the row stack (or the empty state when [rows]
 * is empty), and the optional footnote inside a [GlassPanel].
 */
@Composable
fun ResourcesPanelContent(
    title: String,
    rows: List<ResourceRow>,
    modifier: Modifier = Modifier,
    footnote: String? = null,
    emptyMessage: String = stringResource(R.string.translation_common_noData),
) {
    GlassPanel(
        modifier = modifier.testTag(RESOURCES_PANEL_ROOT_TAG),
        padding = PanelPadding.Lg,
    ) {
        PanelTitle(title)
        Spacer(Modifier.height(TITLE_BOTTOM_GAP))

        if (rows.isEmpty()) {
            EmptyState(
                message = emptyMessage,
                modifier = Modifier.testTag(RESOURCES_PANEL_EMPTY_TAG),
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(ROW_GAP)) {
                rows.forEach { row -> ResourceRowItem(row) }
            }
        }

        if (footnote != null) {
            Spacer(Modifier.height(FOOTNOTE_TOP_GAP))
            HelperText(footnote)
        }
    }
}

/**
 * One rendered row — the label line (optional icon + truncated label + right-aligned value/meta) above the
 * optional usage bar. The value tone + the bar (presence, fill, colour) come from the pure
 * [ResourcesPanelModel.projectRow]; the composable only resolves the tones onto token colours.
 */
@Composable
private fun ResourceRowItem(row: ResourceRow) {
    val projection = remember(row.percent) { ResourcesPanelModel.projectRow(row.percent) }

    Column(verticalArrangement = Arrangement.spacedBy(ROW_INNER_GAP)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (row.icon != null) {
                // Web `text-[var(--text-secondary)]` icon span — decorative (web `aria-hidden`).
                Icon(
                    imageVector = row.icon,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = row.label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ResourceValue(
                valueText = row.valueText,
                metaText = row.metaText,
                tone = projection.severity.valueTone,
            )
        }
        if (projection.hasBar) {
            ResourceUsageBar(fraction = projection.barFraction, tone = projection.severity.barTone, label = row.label)
        }
    }
}

/**
 * The right-aligned value + optional meta — the web `{valueText}{metaText && <span ml-1 …>{metaText}</span>}`.
 * The value carries the status [tone] and tabular figures (web `tabular-nums`); the meta is smaller, muted, and
 * left-padded (web `ml-1 text-xs text-[var(--text-muted)]`).
 */
@Composable
private fun ResourceValue(
    valueText: String,
    metaText: String?,
    tone: ValueTone,
) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(
            text = valueText,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
            color = valueToneColor(tone),
            maxLines = 1,
        )
        if (metaText != null) {
            Text(
                text = metaText,
                modifier = Modifier.padding(start = META_START_GAP),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

/**
 * The usage bar — a pill-clipped track holding a fraction-filled pill, the native mirror of the web
 * `h-1.5 rounded-full bg-white/[0.06]` track + `{barColor}` fill at `width: max(0,min(100,percent))%`. Exposes
 * `progressBarRangeInfo` for TalkBack (the web `role="progressbar"`), named by the row [label] (the web
 * `aria-label="{label} usage"`); the visible value text already states the figure, so the bar only adds the
 * spoken percentage.
 */
@Composable
private fun ResourceUsageBar(
    fraction: Float,
    tone: BarTone,
    label: String,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = BAR_TRACK_ALPHA))
                .testTag(RESOURCES_PANEL_BAR_TAG)
                .semantics {
                    progressBarRangeInfo = ProgressBarRangeInfo(fraction, PROGRESS_RANGE)
                    contentDescription = label
                },
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(barToneColor(tone)),
        )
    }
}

/** Map the projected [BarTone] onto a per-theme status colour (web `barColor` green / amber / red). */
@Composable
@ReadOnlyComposable
private fun barToneColor(tone: BarTone): Color =
    when (tone) {
        BarTone.Success -> TeslaTokens.status.success
        BarTone.Warning -> TeslaTokens.status.warning
        BarTone.Danger -> TeslaTokens.status.danger
    }

/** Map the projected [ValueTone] onto a per-theme colour (web `textColor`: primary / amber / red). */
@Composable
@ReadOnlyComposable
private fun valueToneColor(tone: ValueTone): Color =
    when (tone) {
        ValueTone.Primary -> MaterialTheme.colorScheme.onSurface
        ValueTone.Warning -> TeslaTokens.status.warning
        ValueTone.Danger -> TeslaTokens.status.danger
    }

// ── Previews (tooling-only; the sample title / rows / values are never shipped UI) ─────────────────────────

private const val PREVIEW_TITLE = "Resources"

private fun previewRows(): List<ResourceRow> =
    listOf(
        ResourceRow(label = "Memory", valueText = "1.8 GB", metaText = "of 8 GB", percent = 23.0, icon = TeslaGlyphs.Info),
        ResourceRow(label = "Goroutines", valueText = "412", percent = 74.0, icon = TeslaGlyphs.Info),
        ResourceRow(label = "DB pool", valueText = "23 / 25", metaText = "in use", percent = 92.0, icon = TeslaGlyphs.Warning),
        ResourceRow(label = "Uptime", valueText = "6d 4h"),
    )

private const val PREVIEW_FOOTNOTE = "CPU %, memory bytes, and disk usage need a new /system/resources endpoint."

@Preview(name = "ResourcesPanel · rows (normal / warn / critical + footnote)", showBackground = true)
@Composable
private fun ResourcesPanelRowsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ResourcesPanelContent(title = PREVIEW_TITLE, rows = previewRows(), footnote = PREVIEW_FOOTNOTE)
    }
}

@Preview(name = "ResourcesPanel · no bars (label + value only)", showBackground = true)
@Composable
private fun ResourcesPanelNoBarsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ResourcesPanelContent(
            title = PREVIEW_TITLE,
            rows =
                listOf(
                    ResourceRow(label = "Uptime", valueText = "6d 4h"),
                    ResourceRow(label = "Version", valueText = "v0.1.0", metaText = "build 42"),
                ),
        )
    }
}

@Preview(name = "ResourcesPanel · empty (no rows)", showBackground = true)
@Composable
private fun ResourcesPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ResourcesPanelContent(title = PREVIEW_TITLE, rows = emptyList(), emptyMessage = "No data available")
    }
}

@Preview(name = "ResourcesPanel · dark", showBackground = true)
@Composable
private fun ResourcesPanelDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        ResourcesPanelContent(title = PREVIEW_TITLE, rows = previewRows(), footnote = PREVIEW_FOOTNOTE)
    }
}
