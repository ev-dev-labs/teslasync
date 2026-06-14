// The native Jetpack Compose + Material 3 WidgetStatusGrid widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx. The web surface is a presentational status
// "tile grid" shared by many dashboard widgets: a responsive grid of tone-tinted cells, each with a corner
// status dot, an optional leading icon, a label, and (when not compact) a value — or the shared EmptyState when
// the caller hands it no cells. It fetches nothing and owns no text of its own beyond the empty-state default
// ("No status data available").
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// empty state (web `cells.length === 0`), and the populated grid whose column count collapses with the rendered
// width exactly like the web container queries (`cols = 2` always two; `cols = 3` one → two at `@xs` → three at
// `@sm`; `cols = 4` two → four at `@sm`; `compact` forces two) — each selected by the pure [resolveColumns] /
// [statusGridColumns] / [widgetStatusGridPlan] in WidgetStatusGridModel.kt. Each cell mirrors the web tile:
// `min-h-[44px]` tall, `rounded-lg` corners, the tone bg/border tint, the absolute top-right status dot, the
// optional icon, the truncating label, and the value shown only in non-compact mode.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook). See
// WidgetStatusGridModel.kt for the honesty rationale and why the generic loading/error/stale/offline states do
// not apply to a presentational grid. The five web statuses map onto the per-theme design tokens (P1/S9):
// `ok → status.success` (emerald), `warning → status.warning` (amber), `error → status.danger` (red), and
// `inactive`/`unknown → ` the muted neutral surface — so the tones stay correct across light / dark /
// high-contrast. The empty copy resolves through the i18n catalog (P1/S10, `translation_widgetStatusGrid_noData`)
// so no English literal ships; the chrome is composed from the shared component library (feedback EmptyState, ui
// Icon) over the generated tokens and honours the system font scale. Each label/value truncates rather than
// overflowing, each cell exposes one coherent TalkBack description, the EmptyState announces its message, and a
// one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition carrying only the surface slug —
// never a label, value, or status.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetstatusgrid

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the grid root so on-device UI tests can locate the surface in every state (even when empty). */
const val WIDGET_STATUS_GRID_TEST_TAG: String = "widget-status-grid"

/** Per-cell test-tag prefix; [statusCellTestTag] builds the full tag so a UI test can target a specific cell. */
private const val CELL_TEST_TAG_PREFIX: String = "widget-status-grid-cell-"

/** The on-device test tag for the cell with the given [id] (web `cell.id`). */
fun statusCellTestTag(id: String): String = "$CELL_TEST_TAG_PREFIX$id"

// ── Web pixel constants (Tailwind → dp) ─────────────────────────────────────────────────────────────────────

/** Minimum cell height — web `min-h-[44px]`. */
private val MIN_CELL_HEIGHT: Dp = 44.dp

/** The corner status-dot diameter — web `size-2` (0.5rem = 8px). */
private val STATUS_DOT_SIZE: Dp = 8.dp

/** Cell border thickness — web `border` (1px). */
private val CELL_BORDER_WIDTH: Dp = 1.dp

/** Compact vertical padding — web `py-1.5` (0.375rem = 6px); the non-compact `py-2` uses [Spacing.sm] (8dp). */
private val COMPACT_VERTICAL_PADDING: Dp = 6.dp

// ── Tone tint alphas (web `bg-{tone}/10`, `border-{tone}/20`, neutral `white/[0.03]`, `white/[0.06]`) ────────

/** Tile background alpha for the colored tones — web `bg-{tone}-500/10`. */
private const val TINT_BG_ALPHA: Float = 0.10f

/** Tile border alpha for the colored tones — web `border-{tone}-500/20`. */
private const val TINT_BORDER_ALPHA: Float = 0.20f

/** Tile background alpha for the muted inactive/unknown tones — web `bg-white/[0.03]`. */
private const val NEUTRAL_BG_ALPHA: Float = 0.03f

/** Tile border alpha for the muted inactive/unknown tones — web `border-white/[0.06]`. */
private const val NEUTRAL_BORDER_ALPHA: Float = 0.06f

/**
 * A status tile — the native analogue of the web `StatusCell` ({ id, label, status, value?, icon? }). The web
 * `icon` is an arbitrary `ReactNode`; the native counterpart is an optional [ImageVector] drawn through the
 * shared `Icon` atom. The [value] is already display-formatted by the caller (unit conversion + locale
 * formatting happen at the caller's display boundary, per the SI cutover rules).
 *
 * @param id stable cell key, also the suffix of the cell's test tag (web `cell.id`).
 * @param label the truncating caption (web `cell.label`).
 * @param tone the semantic status that selects the tile tint + dot color (web `cell.status`).
 * @param value the optional value shown below the label in non-compact mode (web `cell.value`).
 * @param icon the optional leading icon (web `cell.icon`).
 */
data class StatusCell(
    val id: String,
    val label: String,
    val tone: StatusTone,
    val value: String? = null,
    val icon: ImageVector? = null,
)

/**
 * A responsive grid of status tiles — the Android port of the web `WidgetStatusGrid`. Renders the shared
 * EmptyState when [cells] is empty, otherwise a [resolveColumns]/[statusGridColumns]-driven grid of [StatusGridCell]
 * tiles. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, then delegates to
 * the stateless [WidgetStatusGridContent] so the diagnostics live in exactly one place (the data-container-free
 * renderer is the test/preview entry point).
 *
 * @param cells the tiles to render; an empty list shows the EmptyState (web `cells`).
 * @param cols the configured column count, 2 / 3 / 4 (web `cols`, default 2); other values clamp to 2.
 * @param compact when true, forces the two-column layout and hides cell values (web `compact`).
 * @param emptyMessage the empty-state copy (web `emptyMessage`); falls back to the i18n "No status data available".
 * @param emptyIcon the optional icon shown in the empty state (web `emptyIcon`).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun WidgetStatusGrid(
    cells: List<StatusCell>,
    modifier: Modifier = Modifier,
    cols: Int = DEFAULT_COLUMNS,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetStatusGridDiagnostics.recordViewOpened(logger) }
    WidgetStatusGridContent(
        cells = cells,
        modifier = modifier,
        cols = cols,
        compact = compact,
        emptyMessage = emptyMessage,
        emptyIcon = emptyIcon,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Paints the
 * empty state (web `cells.length === 0`) or the populated grid. The empty copy falls back to the localized "No
 * status data available" when [emptyMessage] is null. The visible column count is computed from the measured
 * width by [statusGridColumns] so the responsive collapse matches the web container query rather than the
 * viewport; an odd final row is balanced with flexible spacers so every tile keeps its column width.
 */
@Composable
fun WidgetStatusGridContent(
    cells: List<StatusCell>,
    modifier: Modifier = Modifier,
    cols: Int = DEFAULT_COLUMNS,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
) {
    if (cells.isEmpty()) {
        EmptyState(
            message = emptyMessage ?: stringResource(R.string.translation_widgetStatusGrid_noData),
            modifier = modifier.testTag(WIDGET_STATUS_GRID_TEST_TAG),
            icon = emptyIcon,
        )
        return
    }

    val resolvedCols = resolveColumns(cols = cols, compact = compact)
    BoxWithConstraints(modifier = modifier.testTag(WIDGET_STATUS_GRID_TEST_TAG)) {
        val columnCount = statusGridColumns(resolvedCols = resolvedCols, availableWidthDp = maxWidth.value)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            cells.chunked(columnCount).forEach { rowCells ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowCells.forEach { cell ->
                        StatusGridCell(cell = cell, compact = compact, modifier = Modifier.weight(1f))
                    }
                    repeat(columnCount - rowCells.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * One status tile — the native mirror of the web cell `<div>`: a [MIN_CELL_HEIGHT]-tall, tone-tinted, bordered
 * box with the corner status dot, the optional leading [StatusCell.icon], the truncating [StatusCell.label], and
 * — only when not [compact] — the truncating [StatusCell.value]. The whole tile carries one coherent TalkBack
 * description (label + value); the decorative dot and icon are not separately announced.
 */
@Composable
private fun StatusGridCell(
    cell: StatusCell,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = statusCellColors(cell.tone)
    val shape = RoundedCornerShape(Radius.sm)
    val horizontalPadding = if (compact) Spacing.sm else Spacing.md
    val verticalPadding = if (compact) COMPACT_VERTICAL_PADDING else Spacing.sm
    val valueText = if (!compact) cell.value?.takeIf { it.isNotBlank() } else null
    val description = cellContentDescription(cell.label, valueText)

    Box(
        modifier =
            modifier
                .heightIn(min = MIN_CELL_HEIGHT)
                .clip(shape)
                .background(colors.background)
                .border(BorderStroke(CELL_BORDER_WIDTH, colors.border), shape)
                .testTag(statusCellTestTag(cell.id))
                .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(
            modifier =
                Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxWidth()
                    .padding(horizontal = horizontalPadding, vertical = verticalPadding),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            cell.icon?.let { icon ->
                Icon(
                    icon,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = cell.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                valueText?.let { text ->
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        Box(
            modifier =
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = Spacing.sm, end = Spacing.sm)
                    .size(STATUS_DOT_SIZE)
                    .clip(CircleShape)
                    .background(colors.dot),
        )
    }
}

/** The resolved tile tint colors for a [StatusTone] — the native mirror of the web `statusStyles` table. */
private data class StatusCellColors(
    val background: Color,
    val border: Color,
    val dot: Color,
)

/**
 * Map a [tone] onto its tile colors. The colored tones (web `ok`/`warning`/`error`) tint the per-theme status
 * tokens; the muted tones (web `inactive`/`unknown`) use a faint neutral surface fill with a muted dot, so the
 * grid stays correct under light / dark / high-contrast rather than baking in the web's literal translucent
 * white.
 */
@Composable
private fun statusCellColors(tone: StatusTone): StatusCellColors =
    when (tone) {
        StatusTone.Ok -> tintedStatusColors(TeslaTokens.status.success)
        StatusTone.Warning -> tintedStatusColors(TeslaTokens.status.warning)
        StatusTone.Error -> tintedStatusColors(TeslaTokens.status.danger)
        StatusTone.Inactive, StatusTone.Unknown -> neutralStatusColors()
    }

/** Tint a solid status [base] color into a tile fill/border/dot triple (web `bg-{tone}/10`, `border-{tone}/20`). */
private fun tintedStatusColors(base: Color): StatusCellColors =
    StatusCellColors(
        background = base.copy(alpha = TINT_BG_ALPHA),
        border = base.copy(alpha = TINT_BORDER_ALPHA),
        dot = base,
    )

/** The muted inactive/unknown tile colors — a faint neutral fill over the surface with a muted dot. */
@Composable
private fun neutralStatusColors(): StatusCellColors {
    val neutral = MaterialTheme.colorScheme.onSurface
    return StatusCellColors(
        background = neutral.copy(alpha = NEUTRAL_BG_ALPHA),
        border = neutral.copy(alpha = NEUTRAL_BORDER_ALPHA),
        dot = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Compose the single TalkBack description from the visible fragments (label, then value), joined by `, `. */
private fun cellContentDescription(
    label: String,
    valueText: String?,
): String = listOfNotNull(label.takeIf { it.isNotBlank() }, valueText).joinToString(separator = ", ")

// ── Previews (tooling-only; the sample cells are never shipped UI) ───────────────────────────────────────────

private val PREVIEW_CELLS =
    listOf(
        StatusCell(id = "battery", label = "Battery", tone = StatusTone.Ok, value = "Healthy", icon = TeslaGlyphs.Info),
        StatusCell(id = "tires", label = "Tire pressure", tone = StatusTone.Warning, value = "Low (front-left)"),
        StatusCell(id = "charge", label = "Charge port", tone = StatusTone.Error, value = "Fault"),
        StatusCell(id = "sentry", label = "Sentry mode", tone = StatusTone.Inactive, value = "Off"),
        StatusCell(id = "climate", label = "Climate", tone = StatusTone.Unknown, value = "—"),
        StatusCell(id = "locks", label = "Doors", tone = StatusTone.Ok, value = "Locked"),
    )

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Preview(name = "WidgetStatusGrid · 2 columns", showBackground = true, widthDp = 280)
@Composable
private fun WidgetStatusGridTwoColumnPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatusGrid(cells = PREVIEW_CELLS, cols = 2, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatusGrid · 3 columns (wide)", showBackground = true, widthDp = 420)
@Composable
private fun WidgetStatusGridThreeColumnPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatusGrid(cells = PREVIEW_CELLS, cols = 3, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatusGrid · compact (2 cols, no values)", showBackground = true, widthDp = 240)
@Composable
private fun WidgetStatusGridCompactPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatusGrid(cells = PREVIEW_CELLS, cols = 4, compact = true, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatusGrid · empty", showBackground = true, widthDp = 280)
@Composable
private fun WidgetStatusGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatusGrid(cells = emptyList(), emptyIcon = TeslaGlyphs.Info, logger = PreviewLogger)
        }
    }
}
