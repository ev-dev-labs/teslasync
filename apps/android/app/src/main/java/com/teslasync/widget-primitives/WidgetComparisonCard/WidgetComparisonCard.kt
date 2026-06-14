// The native Jetpack Compose + Material 3 WidgetComparisonCard widget primitive — a parity port of the web
// shared comparison list web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx, together with
// the `<Delta>` it embeds (web/src/components/data-display/Delta.tsx).
//
// [WidgetComparisonCard] is the stateful entry: it records the one-shot `view.opened` diagnostic (P1/S11),
// projects its render parameters with the pure [WidgetComparisonCardProjection.project], and paints the
// result through the stateless [WidgetComparisonCardContent] (the test / preview entry point). The faithful
// mapping of the web layout:
//   * the empty branch (web `<p class="text-sm text-[var(--text-muted)] py-2">No comparison data</p>`) →
//     [WidgetComparisonCardEmpty], a muted body line resolved from the shared `translation_delta_noComparison`
//     catalog key (never a blank box);
//   * the rows branch (web `<div class="flex flex-col">{visible.map(MetricRow)}</div>`) →
//     [WidgetComparisonCardRows], a column of [ComparisonMetricRow]s separated by hairline dividers (web's
//     per-row `border-b … last:border-b-0`);
//   * each row (web `flex items-center justify-between gap-3 py-2.5`) → a [Row] whose left [Column] holds the
//     muted truncated label (web `text-xs text-muted truncate`) over the semibold value + optional muted unit
//     (web `text-base font-semibold` + the nested `text-xs font-normal text-muted` unit span), and whose
//     right edge is the direction-aware delta. The label column takes the weight so the delta is pushed to
//     the trailing edge exactly as the web `justify-between` does.
// The delta is delegated to the SHIPPED Delta widget surface (web `<Delta metric={{ direction }}
// display="percent" size="sm">`), which binds the user's unit preferences through the shared settings state
// holder (P1/S8) — this primitive performs no work of its own and no HTTP. Because the stateless content can
// be hosted without the Delta view-model (tests / previews), the delta slot is a [renderDelta] parameter
// that defaults to the shipped surface, mirroring the accepted MetricCard pattern.
//
// The only static copy the primitive owns is the empty message, resolved at the render boundary from the
// shared P1/S10 catalog (`translation_delta_noComparison`, whose value is precisely the web string) — no
// English literal lives in this file. The primitive has no interactive elements (it is a read-only list), so
// accessibility is satisfied by every label / value Text being a spoken node and the embedded delta carrying
// its own localized content description.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/widget-primitives/WidgetComparisonCard — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetcomparisoncard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.delta.Delta
import io.teslasync.android.sharedsurfaces.delta.DeltaSize
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered rows column — used by the instrumented per-state + a11y UI tests. */
const val WIDGET_COMPARISON_CARD_TEST_TAG: String = "widget-comparison-card"

/** Test tag identifying the empty-state line (web `<p>No comparison data</p>`). */
const val WIDGET_COMPARISON_CARD_EMPTY_TEST_TAG: String = "widget-comparison-card-empty"

/** Test tag identifying a single comparison row (web `MetricRow`). */
const val WIDGET_COMPARISON_CARD_ROW_TEST_TAG: String = "widget-comparison-card-row"

/** The leading space before the unit suffix — the native mirror of the web `ml-0.5` gap. */
private const val UNIT_SEPARATOR: String = " "

/** Vertical inset of each row (web `py-2.5` ≈ 10px). */
private val ROW_VERTICAL_PADDING: Dp = 10.dp

/** Gap between the stacked label and value (web `gap-0.5` ≈ 2px). */
private val LABEL_VALUE_GAP: Dp = 2.dp

/**
 * Stateful entry point — the faithful port of the web `WidgetComparisonCard`. Records the one-shot
 * `view.opened` diagnostic (P1/S11), projects the caller's parameters with the pure
 * [WidgetComparisonCardProjection.project], and paints the result. Each row's delta is delegated to the
 * shipped Delta widget surface, which resolves the user's unit preferences through the shared settings state
 * holder (P1/S8) — the view performs no work of its own.
 *
 * @param metrics the comparison metrics to render (web `metrics`).
 * @param modifier optional layout modifier for the list.
 * @param compact when true, only the first two metrics are shown (web `compact` → `metrics.slice(0, 2)`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun WidgetComparisonCard(
    metrics: List<ComparisonMetric>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetComparisonCardDiagnostics.recordViewOpened(logger) }
    val projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(metrics = metrics, compact = compact))
    WidgetComparisonCardContent(projection = projection, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected primitive: the empty
 * line or the column of rows. Every branch renders a non-blank surface (never a hidden surface) so the P3
 * "every state renders" contract holds. [renderDelta] is the per-row delta slot — it defaults to the shipped
 * Delta surface and is overridden by tests / previews that cannot host the Delta view-model.
 */
@Composable
fun WidgetComparisonCardContent(
    projection: WidgetComparisonCardProjection,
    modifier: Modifier = Modifier,
    renderDelta: @Composable (ComparisonRow) -> Unit = { DefaultRowDelta(it) },
) {
    when (projection) {
        WidgetComparisonCardProjection.Empty -> WidgetComparisonCardEmpty(modifier)
        is WidgetComparisonCardProjection.Rows ->
            WidgetComparisonCardRows(projection = projection, modifier = modifier, renderDelta = renderDelta)
    }
}

/**
 * The empty branch — a muted body line carrying the localized `translation_delta_noComparison` message (web
 * `<p class="text-sm text-[var(--text-muted)] py-2">No comparison data</p>`). Never a blank box.
 */
@Composable
private fun WidgetComparisonCardEmpty(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.translation_delta_noComparison),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(vertical = Spacing.sm).testTag(WIDGET_COMPARISON_CARD_EMPTY_TEST_TAG),
    )
}

/**
 * The rows branch — a column of [ComparisonMetricRow]s separated by hairline dividers between consecutive
 * rows (web's per-row `border-b … last:border-b-0`, i.e. a divider under every row but the last).
 */
@Composable
private fun WidgetComparisonCardRows(
    projection: WidgetComparisonCardProjection.Rows,
    modifier: Modifier = Modifier,
    renderDelta: @Composable (ComparisonRow) -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth().testTag(WIDGET_COMPARISON_CARD_TEST_TAG)) {
        projection.rows.forEachIndexed { index, row ->
            ComparisonMetricRow(row = row, renderDelta = renderDelta)
            if (index < projection.rows.lastIndex) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = Dp.Hairline)
            }
        }
    }
}

/**
 * A single comparison row (web `MetricRow`): the muted truncated label over the semibold value (+ optional
 * muted unit) on the left, and the direction-aware delta on the right. The label column takes the weight so
 * the delta is pushed to the trailing edge (web `justify-between`); the [Arrangement] gap is the web `gap-3`.
 */
@Composable
private fun ComparisonMetricRow(
    row: ComparisonRow,
    renderDelta: @Composable (ComparisonRow) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = ROW_VERTICAL_PADDING).testTag(WIDGET_COMPARISON_CARD_ROW_TEST_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(LABEL_VALUE_GAP),
        ) {
            Text(
                text = row.label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ComparisonValueText(formattedCurrent = row.formattedCurrent, unit = row.unit)
        }
        renderDelta(row)
    }
}

/**
 * The value line — the semibold formatted current value with an optional smaller, muted, normal-weight unit
 * suffix (web `<span class="text-base font-semibold">{formattedCurrent}<span class="ml-0.5 text-xs
 * font-normal text-muted">{unit}</span></span>`). Rendered as one annotated [Text] so it truncates as a unit.
 */
@Composable
private fun ComparisonValueText(
    formattedCurrent: String,
    unit: String?,
) {
    val valueColor = MaterialTheme.colorScheme.onSurface
    val unitColor = MaterialTheme.colorScheme.onSurfaceVariant
    val unitSize = MaterialTheme.typography.labelMedium.fontSize
    val text =
        buildAnnotatedString {
            withStyle(SpanStyle(color = valueColor, fontWeight = FontWeight.SemiBold)) {
                append(formattedCurrent)
            }
            if (unit != null) {
                append(UNIT_SEPARATOR)
                withStyle(SpanStyle(color = unitColor, fontWeight = FontWeight.Normal, fontSize = unitSize)) {
                    append(unit)
                }
            }
        }
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The shipped per-row delta — delegates to the [io.teslasync.android.sharedsurfaces.delta.Delta] widget
 * surface (web `<Delta metric={{ direction }} current={current} previous={previous} display="percent"
 * size="sm">`). The Delta surface owns its own settings binding + diagnostics, so the user's unit
 * preferences flow in without this primitive knowing how they are stored.
 */
@Composable
private fun DefaultRowDelta(row: ComparisonRow) {
    Delta(
        current = row.current,
        previous = row.previous,
        metric = row.semantic,
        display = DeltaDisplay.Percent,
        size = DeltaSize.Sm,
    )
}

// ── Previews (tooling-only; sample values are never shipped UI) ──────────────────────────────────────

/**
 * A tooling-only stand-in for the embedded delta so the previews render without hosting the Delta
 * view-model (which requires the app [LocalDataContainer]). It paints a plain percent so the row layout is
 * legible; the shipped surface uses the real arrow + tint.
 */
@Composable
private fun PreviewRowDelta(row: ComparisonRow) {
    val pct = if (row.previous == 0.0) "—" else "${((row.current - row.previous) / row.previous * 100).toInt()}%"
    Text(text = pct, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private val previewMetrics: List<ComparisonMetric> =
    listOf(
        ComparisonMetric(label = "Efficiency", current = 248.0, previous = 262.0, formattedCurrent = "248", unit = "Wh/mi"),
        ComparisonMetric(label = "Distance", current = 312.0, previous = 290.0, formattedCurrent = "312", unit = "mi"),
        ComparisonMetric(label = "Cost", current = 41.0, previous = 36.0, formattedCurrent = "$41", higherIsBetter = false),
    )

@Preview(name = "WidgetComparisonCard — rows", showBackground = true)
@Composable
private fun WidgetComparisonCardRowsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetComparisonCardContent(
            projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(previewMetrics)),
            renderDelta = { PreviewRowDelta(it) },
        )
    }
}

@Preview(name = "WidgetComparisonCard — compact (dark)", showBackground = true)
@Composable
private fun WidgetComparisonCardCompactPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        WidgetComparisonCardContent(
            projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(previewMetrics, compact = true)),
            renderDelta = { PreviewRowDelta(it) },
        )
    }
}

@Preview(name = "WidgetComparisonCard — empty", showBackground = true)
@Composable
private fun WidgetComparisonCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetComparisonCardContent(projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(emptyList())))
    }
}
