// The native Jetpack Compose + Material 3 WidgetStatGrid widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx. The web surface is a presentational grid of KPI
// tiles shared by many dashboard widgets: given a list of stats and two layout flags it renders the shared
// EmptyState when the list is empty, otherwise a responsive grid of `StatCard`s whose column count collapses on
// narrow widgets via container queries keyed to the widget's OWN rendered width (not the viewport). It fetches
// nothing and owns no text of its own beyond the empty-state literal ("No stats available").
//
// This native surface keeps that contract end to end. Every render decision — the empty branch, the resolved
// target column count (web `compact ? 1 : (cols ?? autoCols(count))`), the container-query column collapse, and the
// trend-chip combination — lives in the pure [widgetStatGridPlan] / [gridColumnCount] / [statGridTrend] in
// WidgetStatGridModel.kt and is unit-tested off-device; this file is the thin render layer that measures the
// widget width and paints the tiles.
//
// Each tile mirrors the shared data-display [io.teslasync.android.components.datadisplay.StatCard] composition (the
// web `StatCard`): a muted label with an optional trailing icon, the large value with an optional unit suffix, and
// an optional delta trend chip. The web passes `valueColor` as the card `className`, which (because the value is the
// only un-coloured text in StatCard) tints just the value; four real widgets use it (emerald for good, red for
// errors). The native shared StatCard renders its value through the fixed-colour `MetricValue` atom and exposes no
// colour knob (and StatCard.kt is outside this artifact's allowed files), so — exactly as the sibling WidgetBigNumber
// surface did for the identical `valueColor` problem — [StatGridCell] renders the value at the same MetricValue
// typography token and only diverges to apply the caller colour when present. A null `valueColor` renders the exact
// shared `MetricValue`, so an un-coloured tile is byte-for-byte the shared StatCard.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook). See
// WidgetStatGridModel.kt for why the generic loading/error/stale/offline states do not apply to a presentational
// frame — the empty-list branch is the only data-driven state the web spec has, and it is reproduced exactly. The
// empty copy resolves through the i18n catalog (P1/S10, `translation_No_stats_available`) so no English literal
// ships; the chrome is composed from the shared component library (feedback EmptyState, ui Card/typography/Icon,
// data-display delta glyph + tone) over the generated design tokens (P1/S9) so it stays correct across
// light / dark / high-contrast and honours the system font scale. The trend chip announces a single coherent
// label to TalkBack and the EmptyState announces its message; a one-shot PII-safe `view.opened` diagnostic (P1/S11)
// fires on first composition carrying only the surface slug — never a label, value, or unit.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless renderer,
// supporting type, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetstatgrid

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.datadisplay.deltaArrowGlyph
import io.teslasync.android.components.datadisplay.deltaToneColor
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the grid in every state (even when empty). */
const val WIDGET_STAT_GRID_TEST_TAG: String = "widget-stat-grid"

/**
 * One KPI tile — the native mirror of the web `StatGridItem` ({ label, value: string|number, unit?, icon?, trend?,
 * trendValue?, valueColor? }). The web `value` is `string | number`; React coerces a number to its display string,
 * so the canonical native type is a pre-formatted [value] string (unit conversion + locale formatting happen at the
 * caller's display boundary, per the SI cutover rules). [StatGridItem.of] accepts a [Number] for the common numeric
 * call so the `string | number` union is reproduced without leaking formatting concerns into this frame.
 *
 * @param label the muted caption above the value (web `stat.label`).
 * @param value the already-formatted display value (web `stat.value`).
 * @param unit the optional small trailing unit shown after the value (web `stat.unit`).
 * @param icon the optional leading icon in the tile header (web `stat.icon`).
 * @param trend the optional delta direction (web `stat.trend`); a chip shows only when [trendValue] is also set.
 * @param trendValue the optional pre-formatted change text shown in the trend chip (web `stat.trendValue`).
 * @param valueColor the optional colour applied to the value only (web `stat.valueColor` card class); null keeps the
 *   default metric colour.
 */
data class StatGridItem(
    val label: String,
    val value: String,
    val unit: String? = null,
    val icon: ImageVector? = null,
    val trend: DeltaArrow? = null,
    val trendValue: String? = null,
    val valueColor: Color? = null,
) {
    companion object {
        /** Build a tile from a numeric [value] (web `value: number`); formats via the number's natural string. */
        fun of(
            label: String,
            value: Number,
            unit: String? = null,
        ): StatGridItem = StatGridItem(label = label, value = value.toString(), unit = unit)
    }
}

/**
 * The faithful port of the web `WidgetStatGrid`. Renders the responsive [stats] grid, or the shared EmptyState when
 * the list is empty. Records the one-shot PII-safe `view.opened` diagnostic on first composition, then delegates to
 * the stateless [WidgetStatGridContent] so the diagnostics live in exactly one place (the data-container-free
 * renderer is the test/preview entry point).
 *
 * @param stats the KPI tiles to render (web `stats`); an empty list shows the empty state.
 * @param compact when true, forces a single column and tighter gaps (web `compact`).
 * @param cols an explicit target column count (web `cols: 2 | 3 | 4`); null auto-selects from the tile count.
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun WidgetStatGrid(
    stats: List<StatGridItem>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    cols: Int? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetStatGridDiagnostics.recordViewOpened(logger) }
    WidgetStatGridContent(stats = stats, modifier = modifier, compact = compact, cols = cols)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Paints the empty
 * state (web `stats.length === 0`) or the populated grid: tiles laid out in rows of [gridColumnCount] columns, the
 * actual column count chosen from the resolved target and the measured widget width (web container queries). An odd
 * final row keeps its column widths via flexible spacers, so tiles never stretch to fill a short row.
 */
@Composable
fun WidgetStatGridContent(
    stats: List<StatGridItem>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    cols: Int? = null,
) {
    val plan = widgetStatGridPlan(statCount = stats.size, compact = compact, cols = cols)
    if (plan.showEmptyState) {
        EmptyState(
            message = stringResource(R.string.translation_No_stats_available),
            modifier = modifier.testTag(WIDGET_STAT_GRID_TEST_TAG),
        )
        return
    }

    val gap = if (compact) Spacing.sm else Spacing.md
    BoxWithConstraints(modifier = modifier.testTag(WIDGET_STAT_GRID_TEST_TAG)) {
        val columns = gridColumnCount(resolvedCols = plan.resolvedCols, availableWidthDp = maxWidth.value)
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            stats.chunked(columns).forEach { rowItems ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    rowItems.forEach { stat ->
                        StatGridCell(stat = stat, modifier = Modifier.weight(1f))
                    }
                    repeat(columns - rowItems.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * One KPI tile — the native mirror of the web per-item `StatCard`, reproducing the shared StatCard composition (the
 * Card chrome, the label+icon header row, the value+unit row, and the delta trend chip) so an un-coloured tile is
 * identical to the shared atom, while honouring the web [StatGridItem.valueColor] knob the fixed-colour StatCard
 * cannot express (see file header).
 */
@Composable
private fun StatGridCell(
    stat: StatGridItem,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(stat.label)
            stat.icon?.let { icon ->
                Icon(
                    icon,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            StatGridValue(value = stat.value, valueColor = stat.valueColor)
            stat.unit?.let { unit -> Caption(unit, modifier = Modifier.padding(bottom = Spacing.xs)) }
        }
        statGridTrend(direction = stat.trend, trendValue = stat.trendValue)?.let { trend ->
            StatGridTrend(trend = trend, modifier = Modifier.padding(top = Spacing.xs))
        }
    }
}

/**
 * The tile value. A null [valueColor] renders the exact shared [MetricValue] role (identical to StatCard); a non-null
 * [valueColor] (the web `valueColor`, which tints only the value via CSS inheritance) is honoured by rendering the
 * value at the same MetricValue typography token in the caller's colour — the only way to preserve the web knob
 * without a colour hook on the fixed-colour MetricValue atom, mirroring the WidgetBigNumber sibling.
 */
@Composable
private fun StatGridValue(
    value: String,
    valueColor: Color?,
) {
    if (valueColor == null) {
        MetricValue(value)
    } else {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
            color = valueColor,
        )
    }
}

/**
 * The delta trend chip — reproduces the shared StatCard trend exactly: the arrow glyph + change text tinted by the
 * resolved [DeltaTone] (green for a positive/up change, red for a negative/down change, muted for flat). The whole
 * chip announces a single coherent [StatTrend.text] label to TalkBack.
 */
@Composable
private fun StatGridTrend(
    trend: StatTrend,
    modifier: Modifier = Modifier,
) {
    val tone =
        when {
            trend.positive == true -> DeltaTone.Good
            trend.direction == DeltaArrow.Flat || trend.positive == null -> DeltaTone.Muted
            else -> DeltaTone.Bad
        }
    val color = deltaToneColor(tone)
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = trend.text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(deltaArrowGlyph(trend.direction), contentDescription = null, size = IconSize.Xs, tint = color)
        Caption(trend.text)
    }
}

// ── Previews (tooling-only; the sample tiles are never shipped UI) ──────────────────────────────────────────────

private val PREVIEW_STATS =
    listOf(
        StatGridItem(label = "Trips", value = "128", trend = DeltaArrow.Up, trendValue = "+12%"),
        StatGridItem(label = "Distance", value = "3,420", unit = "km"),
        StatGridItem(label = "Energy", value = "612", unit = "kWh", trend = DeltaArrow.Down, trendValue = "-4%"),
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

@Preview(name = "WidgetStatGrid · wide auto (3-up)", showBackground = true, widthDp = 420)
@Composable
private fun WidgetStatGridWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatGrid(stats = PREVIEW_STATS, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatGrid · compact (1-up)", showBackground = true, widthDp = 260)
@Composable
private fun WidgetStatGridCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatGrid(stats = PREVIEW_STATS, compact = true, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatGrid · four-up + valueColor", showBackground = true, widthDp = 460)
@Composable
private fun WidgetStatGridFourUpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val stats =
            listOf(
                StatGridItem(label = "Requests", value = "1,204"),
                StatGridItem(
                    label = "Error rate",
                    value = "6.2",
                    unit = "%",
                    valueColor = MaterialTheme.colorScheme.error,
                    trend = DeltaArrow.Up,
                    trendValue = "+1.1%",
                ),
                StatGridItem(label = "Avg latency", value = "84", unit = "ms"),
                StatGridItem(
                    label = "Uptime",
                    value = "99.9",
                    unit = "%",
                    valueColor = TeslaTokens.status.success,
                ),
            )
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatGrid(stats = stats, cols = 4, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatGrid · narrow 4-up collapses to 2", showBackground = true, widthDp = 300)
@Composable
private fun WidgetStatGridNarrowFourUpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val stats =
            listOf(
                StatGridItem(label = "Requests", value = "1,204"),
                StatGridItem(label = "Errors", value = "3"),
                StatGridItem(label = "Latency", value = "84", unit = "ms"),
                StatGridItem(label = "Uptime", value = "99.9", unit = "%"),
            )
        Box(modifier = Modifier.width(300.dp).padding(Spacing.md)) {
            WidgetStatGrid(stats = stats, cols = 4, logger = PreviewLogger)
        }
    }
}

@Preview(name = "WidgetStatGrid · empty", showBackground = true, widthDp = 320)
@Composable
private fun WidgetStatGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            WidgetStatGrid(stats = emptyList(), logger = PreviewLogger)
        }
    }
}
