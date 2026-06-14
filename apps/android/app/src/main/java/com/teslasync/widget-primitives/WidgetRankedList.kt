// The native Jetpack Compose + Material 3 WidgetRankedList widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx. The web surface is a presentational "ranked
// list" shared by many dashboard widgets: it sorts items by value, slices to a row budget, and draws one row per
// item (an optional value-scaled background bar, the rank, the truncating label, an optional status badge, and
// the pre-formatted value), falling back to a shared EmptyState when the slice is empty. It fetches nothing and
// owns no text of its own beyond the empty-state default ("No data available").
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// empty state (web `visible.length === 0`), the populated rows with their value→width bars (web
// `value / maxValue`), the bars-hidden mode (web `compact || !showBars`), the optional per-row badge (web
// `badgeVariantMap`), and the row budget (web `maxItems ?? (compact ? 3 : 5)`) — each selected by the pure
// [widgetRankedListProjection] in WidgetRankedListModel.kt. The list scrolls when it overflows (web
// `overflow-y-auto`).
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook). See
// WidgetRankedListModel.kt for the honesty rationale and why the generic loading/error/stale/offline states do
// not apply to a presentational list. The empty copy resolves through the i18n catalog (P1/S10,
// `translation_common_noData`) so no English literal ships; the chrome is composed from the shared component
// library (feedback EmptyState, ui Badge) over the generated design tokens (P1/S9) so it stays correct across
// light / dark / high-contrast and honours the system font scale. The label truncates rather than overflowing,
// each row is announced to TalkBack as one merged "rank, label, value, badge" node, and a one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition carrying only the surface slug — never a label,
// value, or badge.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetrankedlist

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the list in every state (even when empty). */
const val WIDGET_RANKED_LIST_TEST_TAG: String = WidgetRankedListRegistration.ID

/** Minimum row height (web `min-h-[44px]`) — also the Material 3 minimum touch/read target. */
private val ROW_MIN_HEIGHT: Dp = 44.dp

/** Fixed width of the leading rank column (web rank `w-5` = 1.25rem = 20px). */
private val RANK_COLUMN_WIDTH: Dp = 20.dp

/** Background-bar opacity (web `opacity-15`). */
private const val BAR_ALPHA: Float = 0.15f

/**
 * The faithful port of the web `WidgetRankedList`. Sorts + slices the [items] and renders the ranked rows, or the
 * shared EmptyState when the slice is empty. Records the one-shot PII-safe `view.opened` diagnostic on first
 * composition, then delegates to the stateless [WidgetRankedListContent] so the diagnostics live in exactly one
 * place (the data-container-free renderer is the test/preview entry point).
 *
 * @param items the entries to rank + display (web `items`); sorted by [RankedItem.value] descending.
 * @param maxItems the explicit row budget (web `maxItems`); null uses the compact/non-compact default.
 * @param compact when true, tightens the budget to [RANKED_LIST_COMPACT_LIMIT] and hides the bars (web `compact`).
 * @param showBars when false (and not [compact]), hides the value-scaled background bars (web `showBars`).
 * @param emptyMessage the empty-state copy (web `emptyMessage`); falls back to the i18n "No data available".
 * @param emptyIcon optional icon shown in the empty state (web `emptyIcon`).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun WidgetRankedList(
    items: List<RankedItem>,
    modifier: Modifier = Modifier,
    maxItems: Int? = null,
    compact: Boolean = false,
    showBars: Boolean = true,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetRankedListDiagnostics.recordViewOpened(logger) }
    WidgetRankedListContent(
        items = items,
        modifier = modifier,
        maxItems = maxItems,
        compact = compact,
        showBars = showBars,
        emptyMessage = emptyMessage,
        emptyIcon = emptyIcon,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Reduces the
 * inputs to the [WidgetRankedListProjection] (web `useMemo`) and paints the empty state (web
 * `visible.length === 0`) or the scrollable ranked rows. The empty copy falls back to the localized "No data
 * available" when [emptyMessage] is null.
 */
@Composable
fun WidgetRankedListContent(
    items: List<RankedItem>,
    modifier: Modifier = Modifier,
    maxItems: Int? = null,
    compact: Boolean = false,
    showBars: Boolean = true,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
) {
    val projection =
        remember(items, maxItems, compact, showBars) {
            widgetRankedListProjection(items = items, maxItems = maxItems, compact = compact, showBars = showBars)
        }

    if (projection.isEmpty) {
        EmptyState(
            message = emptyMessage ?: stringResource(R.string.translation_common_noData),
            modifier = modifier.testTag(WIDGET_RANKED_LIST_TEST_TAG),
            icon = emptyIcon,
        )
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(WIDGET_RANKED_LIST_TEST_TAG)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        projection.rows.forEach { row ->
            RankedRowView(row = row, barsVisible = projection.barsVisible)
        }
    }
}

/**
 * One ranked row — the native mirror of the web `<li>`: a value-scaled background bar (drawn only when
 * [barsVisible] and the row has a positive fraction, web `!hideBars && barPct`), then the right-aligned rank, the
 * truncating label, the optional status [Badge], and the semibold tabular value. The whole row collapses to a
 * single merged TalkBack node carrying [RankedRow.contentDescription] so a screen reader announces "rank, label,
 * value, badge" once instead of four disjoint fragments.
 */
@Composable
private fun RankedRowView(
    row: RankedRow,
    barsVisible: Boolean,
) {
    val item = row.item
    val barColor = (item.barColor ?: TeslaTokens.chart.speed).copy(alpha = BAR_ALPHA)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription }
                .drawBehind {
                    if (barsVisible && row.barFraction > 0f) {
                        drawRect(color = barColor, size = Size(size.width * row.barFraction, size.height))
                    }
                },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(
                text = row.rank.toString(),
                modifier = Modifier.width(RANK_COLUMN_WIDTH),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.End,
                maxLines = 1,
            )
            Text(
                text = item.label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            item.badge?.let { badge ->
                Badge(text = badge.text, variant = badge.variant.toBadgeVariant())
            }
            Text(
                text = item.formattedValue,
                style =
                    MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontFeatureSettings = "tnum",
                    ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
        }
    }
}

// ── Previews (tooling-only; the sample rows are never shipped UI) ───────────────────────────────────────────

private val PREVIEW_ITEMS: List<RankedItem> =
    listOf(
        RankedItem(
            id = "1",
            label = "Home",
            value = 128.0,
            formattedValue = "128",
            badge = RankedBadge(text = "Top", variant = RankedBadgeVariant.Success),
            barColor = TeslaTokens.chart.battery,
        ),
        RankedItem(id = "2", label = "Supercharger — Market St", value = 86.0, formattedValue = "86"),
        RankedItem(
            id = "3",
            label = "Office",
            value = 54.0,
            formattedValue = "54",
            badge = RankedBadge(text = "Low", variant = RankedBadgeVariant.Warning),
        ),
        RankedItem(id = "4", label = "Gym", value = 31.0, formattedValue = "31"),
        RankedItem(id = "5", label = "Airport long-term parking", value = 12.0, formattedValue = "12"),
        RankedItem(id = "6", label = "Trailhead", value = 4.0, formattedValue = "4"),
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

@Preview(name = "WidgetRankedList · wide (bars + badges)", showBackground = true)
@Composable
private fun WidgetRankedListWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.width(360.dp).padding(Spacing.md)) {
            WidgetRankedList(items = PREVIEW_ITEMS, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetRankedList · compact (3 rows, no bars)", showBackground = true)
@Composable
private fun WidgetRankedListCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.width(280.dp).padding(Spacing.md)) {
            WidgetRankedList(items = PREVIEW_ITEMS, compact = true, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetRankedList · bars off", showBackground = true)
@Composable
private fun WidgetRankedListNoBarsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.width(360.dp).padding(Spacing.md)) {
            WidgetRankedList(items = PREVIEW_ITEMS, showBars = false, maxItems = 4, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetRankedList · empty", showBackground = true)
@Composable
private fun WidgetRankedListEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.width(360.dp).padding(Spacing.md)) {
            WidgetRankedList(
                items = emptyList(),
                emptyIcon = TeslaGlyphs.Info,
                logger = PreviewLogger,
            )
        }
    }
}
