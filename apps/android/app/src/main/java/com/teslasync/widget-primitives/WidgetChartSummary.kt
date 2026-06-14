// The native Jetpack Compose + Material 3 WidgetChartSummary widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx. The web surface is a presentational chart
// "summary frame" shared by many dashboard widgets: an optional stat row above an optional chart, or a shared
// EmptyState when the caller flags the data as empty. It fetches nothing and owns no text of its own beyond the
// empty-state default ("No data available").
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// empty state (web `isEmpty`), the stat row (web `stats.length > 0`) with its 2-column grid that relaxes to a
// horizontal row at the `@sm` container width in non-compact mode, and the chart region (web `!compact`) filling
// the remaining height — each selected by the pure [widgetChartSummaryPlan] / [statRowLayout] in
// WidgetChartSummaryModel.kt. The `chart` is an arbitrary Compose slot (the native analogue of the web
// `ReactNode`), so a caller drops a Vico chart / sparkline / gauge into the same frame the web does.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook). See
// WidgetChartSummaryModel.kt for the honesty rationale and why the generic loading/error/stale/offline states do
// not apply to a presentational frame. The empty copy resolves through the i18n catalog (P1/S10,
// `translation_chart_noData`) so no English literal ships; the chrome is composed from the shared component
// library (feedback EmptyState, ui Typography) over the generated design tokens (P1/S9) so it stays correct
// across light / dark / high-contrast and honours the system font scale. Each stat truncates rather than
// overflowing, the EmptyState announces its message to TalkBack, and a one-shot PII-safe `view.opened`
// diagnostic (P1/S11) fires on first composition carrying only the surface slug — never a label or value.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetchartsummary

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the frame in every state (even when empty). */
const val WIDGET_CHART_SUMMARY_TEST_TAG: String = "widget-chart-summary"

// Gap between a stat's value and its trailing unit — the web `ml-0.5` (2px).
private val UNIT_LEADING_GAP: Dp = 2.dp

/**
 * The faithful port of the web `WidgetChartSummary`. Renders the resolved [stats] row above the [chart] slot, or
 * the shared EmptyState when [isEmpty]. Records the one-shot PII-safe `view.opened` diagnostic on first
 * composition, then delegates to the stateless [WidgetChartSummaryContent] so the diagnostics live in exactly one
 * place (the data-container-free renderer is the test/preview entry point).
 *
 * @param stats the summary statistics shown above the chart (web `stats`); an empty list hides the stat row.
 * @param compact when true, forces the 2-column stat grid and hides the chart (web `compact`).
 * @param emptyMessage the empty-state copy (web `emptyMessage`); falls back to the i18n "No data available".
 * @param emptyIcon optional icon shown in the empty state (web `emptyIcon`).
 * @param isEmpty when true, the shared EmptyState replaces all other content (web `isEmpty`).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 * @param chart the chart slot rendered below the stats in non-compact mode (web `chart: ReactNode`).
 */
@Composable
fun WidgetChartSummary(
    stats: List<ChartSummaryStat>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    isEmpty: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    chart: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { WidgetChartSummaryDiagnostics.recordViewOpened(logger) }
    WidgetChartSummaryContent(
        stats = stats,
        modifier = modifier,
        compact = compact,
        emptyMessage = emptyMessage,
        emptyIcon = emptyIcon,
        isEmpty = isEmpty,
        chart = chart,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Paints the
 * empty state (web `isEmpty`) or the populated frame: the [stats] row (when non-empty) over the [chart] slot
 * (when not [compact]). The empty copy falls back to the localized "No data available" when [emptyMessage] is
 * null. Never blank in a populated state with content — the degenerate compact/no-stats case mirrors the web,
 * which also renders an empty column there.
 */
@Composable
fun WidgetChartSummaryContent(
    stats: List<ChartSummaryStat>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector? = null,
    isEmpty: Boolean = false,
    chart: @Composable () -> Unit,
) {
    if (isEmpty) {
        EmptyState(
            message = emptyMessage ?: stringResource(R.string.translation_chart_noData),
            modifier = modifier.testTag(WIDGET_CHART_SUMMARY_TEST_TAG),
            icon = emptyIcon,
        )
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxHeight()
                .testTag(WIDGET_CHART_SUMMARY_TEST_TAG),
    ) {
        if (stats.isNotEmpty()) {
            StatSummaryRow(stats = stats, compact = compact, modifier = Modifier.fillMaxWidth())
        }
        if (!compact) {
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(top = Spacing.sm),
                content = { chart() },
            )
        }
    }
}

/**
 * The stat row — a [StatRowLayout.Grid2Col] 2-column grid (web `grid grid-cols-2`) that, in non-compact mode,
 * relaxes to a horizontal [StatRowLayout.Row] once the frame reaches [STAT_ROW_BREAKPOINT_DP] (web `@sm:flex`).
 * The width-driven choice is the pure [statRowLayout]; [BoxWithConstraints] supplies the measured width so the
 * responsive branch matches the web container query rather than the viewport.
 */
@Composable
private fun StatSummaryRow(
    stats: List<ChartSummaryStat>,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier) {
        when (statRowLayout(compact = compact, availableWidthDp = maxWidth.value)) {
            StatRowLayout.Row ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    stats.forEach { stat -> StatCell(stat = stat, modifier = Modifier.weight(1f)) }
                }

            StatRowLayout.Grid2Col -> StatGrid(stats = stats)
        }
    }
}

/**
 * The 2-column stat grid (web `grid grid-cols-2 gap-2`). Lays the cells out in rows of two; an odd final cell is
 * balanced with a flexible spacer so the lone value keeps its half-width column rather than stretching across.
 */
@Composable
private fun StatGrid(
    stats: List<ChartSummaryStat>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        stats.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                pair.forEach { stat -> StatCell(stat = stat, modifier = Modifier.weight(1f)) }
                if (pair.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * One stat cell — the native mirror of the web stat `<div>`: a muted truncating [ChartSummaryStat.label] caption
 * above the semibold [ChartSummaryStat.value], with the optional [ChartSummaryStat.unit] as a small muted suffix
 * (web inline unit `<span>`). The whole value+unit line truncates rather than pushing the cell wide.
 */
@Composable
private fun StatCell(
    stat: ChartSummaryStat,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = stat.label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = stat.value,
                modifier = Modifier.weight(1f, fill = false),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            stat.unit?.let { unit ->
                Text(
                    text = unit,
                    modifier = Modifier.padding(start = UNIT_LEADING_GAP),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
    }
}

// ── Previews (tooling-only; the sample stats + bars are never shipped UI) ───────────────────────────────────

private val PREVIEW_STATS =
    listOf(
        ChartSummaryStat(label = "Avg power", value = "42", unit = "kW"),
        ChartSummaryStat(label = "Peak", value = "118", unit = "kW"),
        ChartSummaryStat(label = "Energy", value = "8.4", unit = "kWh"),
        ChartSummaryStat(label = "Duration", value = "26", unit = "min"),
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

/** A tooling-only sample chart (a simple bar spark) so the previews show the chart slot filled, never a void. */
@Composable
private fun SampleSparkBars(modifier: Modifier = Modifier) {
    val bars = listOf(0.45f, 0.7f, 0.55f, 0.9f, 0.62f, 1f, 0.5f)
    Row(
        modifier = modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.Bottom,
    ) {
        bars.forEach { fraction ->
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .fillMaxHeight(fraction)
                        .clip(RoundedCornerShape(2.dp))
                        .background(MaterialTheme.colorScheme.primary),
            )
        }
    }
}

@Preview(name = "WidgetChartSummary · wide (stat row + chart)", showBackground = true)
@Composable
private fun WidgetChartSummaryWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(420.dp)
                    .height(200.dp)
                    .padding(Spacing.md),
            content = { WidgetChartSummary(stats = PREVIEW_STATS, logger = PreviewLogger) { SampleSparkBars() } },
        )
    }
}

@Preview(name = "WidgetChartSummary · compact (stat grid, no chart)", showBackground = true)
@Composable
private fun WidgetChartSummaryCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(260.dp)
                    .height(120.dp)
                    .padding(Spacing.md),
            content = {
                WidgetChartSummary(stats = PREVIEW_STATS, compact = true, logger = PreviewLogger) {
                    SampleSparkBars()
                }
            },
        )
    }
}

@Preview(name = "WidgetChartSummary · chart only (no stats)", showBackground = true)
@Composable
private fun WidgetChartSummaryChartOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(320.dp)
                    .height(160.dp)
                    .padding(Spacing.md),
            content = {
                WidgetChartSummary(stats = emptyList(), logger = PreviewLogger) { SampleSparkBars() }
            },
        )
    }
}

@Preview(name = "WidgetChartSummary · empty", showBackground = true)
@Composable
private fun WidgetChartSummaryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(320.dp)
                    .height(160.dp)
                    .padding(Spacing.md),
            content = {
                WidgetChartSummary(
                    stats = emptyList(),
                    isEmpty = true,
                    emptyIcon = TeslaGlyphs.Info,
                    logger = PreviewLogger,
                ) { SampleSparkBars() }
            },
        )
    }
}
