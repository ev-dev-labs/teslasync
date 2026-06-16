// Shared, internal render building-blocks for the AnalyticsPage tabs — the native counterparts of the small
// web helpers the analytics sub-components reuse (the `GlassPanel` + `SectionTitle` wrapper, the responsive
// `MetricCard` grids, the progress-bar leaderboards, and the per-card accent palette). Kept in one file so the
// four tab bodies (Overview / Driving / Charging / Battery) stay focused on data → series mapping. Everything
// here is `internal` (no public surface) and token-based: accents resolve from the design system (A2/ADR-005),
// never a raw hex.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** The bar denominator for a 0–100 normalised leaderboard percent. */
internal const val BAR_MAX: Double = 100.0

/** Web chart `tickFormatter={(v) => v.slice(5)}` — trims an ISO `YYYY-MM-DD` date to `MM-DD`. */
internal fun String.shortDate(): String = if (length > 5) substring(5) else this

/**
 * The four web `MetricCard` accent names (`color="cyan"|"purple"|"green"|"amber"`) the analytics cards cycle
 * through for visual variety. Resolved to theme tokens at render so light / dark / high-contrast stay correct.
 */
enum class MetricAccent { Cyan, Purple, Green, Amber }

/** Resolves a [MetricAccent] to its design-system color (A2 tokens), never a raw hex (ADR-005). */
@Composable
internal fun metricAccentColor(accent: MetricAccent): Color =
    when (accent) {
        MetricAccent.Cyan -> TeslaTokens.status.info
        MetricAccent.Green -> TeslaTokens.status.success
        MetricAccent.Amber -> TeslaTokens.status.warning
        MetricAccent.Purple -> MaterialTheme.colorScheme.tertiary
    }

/**
 * A panel section — the native `GlassPanel` + `SectionTitle` wrapper every analytics region uses. The [title]
 * doubles as the panel's accessibility label (TalkBack reads the section name before its content).
 */
@Composable
internal fun SectionPanel(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = title },
        padding = PanelPadding.Md,
    ) {
        PanelTitle(title)
        Spacer(modifier = Modifier.height(Spacing.sm))
        content()
    }
}

/**
 * A responsive [MetricCard] grid — the native counterpart of the web `grid-cols-2 … lg:grid-cols-6` metric
 * rows. Lays the [cells] out in rows of [columns], each card weighted to an equal share; a short final row is
 * padded with invisible spacers so the cards keep a stable width.
 */
@Composable
internal fun MetricGrid(
    cells: List<@Composable () -> Unit>,
    modifier: Modifier = Modifier,
    columns: Int = 2,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        cells.chunked(columns).forEach { rowCells ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowCells.forEach { cell -> Box(modifier = Modifier.weight(1f)) { cell() } }
                repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/** One analytics metric card — the native `MetricCard` with an analytics [accent] mapped to a theme color. */
@Composable
internal fun AnalyticsMetricCard(
    label: String,
    value: String,
    icon: ImageVector,
    accent: MetricAccent,
    subtitle: String? = null,
) {
    MetricCard(
        label = label,
        value = value,
        modifier = Modifier.fillMaxWidth(),
        icon = icon,
        accent = metricAccentColor(accent),
        subtitle = subtitle,
    )
}

/** One progress-bar leaderboard row's data (web `MetricBar`-style leaderboard entry). */
internal data class BarRow(
    val label: String,
    val valueText: String,
    val percent: Double,
    val color: Color,
)

/**
 * A stacked list of progress bars — the native counterpart of the web leaderboards (efficiency leaderboard,
 * charger brands, cost-by-type) that render `<div class="rounded-full bg-...">` fill bars. Uses the shared
 * animated [MetricBar] so each row fills proportionally to its 0–100 percent.
 */
@Composable
internal fun LeaderboardBars(
    rows: List<BarRow>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(top = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        rows.forEach { row ->
            MetricBar(
                value = row.percent,
                max = BAR_MAX,
                label = row.label,
                valueText = row.valueText,
                color = row.color,
            )
        }
    }
}

/** A panel's empty region — the native `EmptyState`, used wherever a web panel renders `<EmptyState />`. */
@Composable
internal fun EmptyRegion(
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    EmptyState(message = message, modifier = modifier, icon = icon)
}

/**
 * A chart panel — a [SectionPanel] whose body is either the [chart] (when data is present) or an [EmptyRegion]
 * carrying [emptyMessage] (when [isEmpty]). Mirrors every web `<GlassPanel><SectionTitle/>{data ? <Chart/> :
 * <EmptyState/>}</GlassPanel>`: the region is never blank.
 */
@Composable
internal fun ChartSectionPanel(
    title: String,
    isEmpty: Boolean,
    emptyMessage: String,
    modifier: Modifier = Modifier,
    chart: @Composable () -> Unit,
) {
    SectionPanel(title = title, modifier = modifier) {
        if (isEmpty) EmptyRegion(emptyMessage) else chart()
    }
}

/**
 * Builds one [ChartSeries] from SI-converted display [values]. [colorIndex] selects the brand categorical
 * palette slot (web `CHART_COLORS[i]`); a `null` value is a gap the wrapper draws across.
 */
internal fun analyticsSeries(
    key: String,
    label: String,
    values: List<Double>,
    kind: ChartSeriesKind,
    colorIndex: Int,
    unit: String? = null,
): ChartSeries =
    ChartSeries(
        key = key,
        label = label,
        values = values,
        kind = kind,
        color = paletteColor(colorIndex),
        unit = unit,
    )
