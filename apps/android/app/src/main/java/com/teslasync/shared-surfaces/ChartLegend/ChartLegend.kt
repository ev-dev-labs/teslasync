// The native Jetpack Compose + Material 3 ChartLegend shared surface — a parity port of
// web/src/components/charts/ChartLegend.tsx. The web component is a Recharts `<Legend>` wrapper that
// toggles series visibility on click and persists the hidden set through a resolved toggle source (the
// `state` prop, else the `<ChartContainer chartKey>` context via `useChartHiddenSeries`). Hidden series
// render dimmed (40% opacity + line-through) so a user can find and re-enable them; the component never
// hides the plotted series itself — the chart owner does that with `<Line hide={…} />`.
//
// This surface is the native equivalent. All data flows through the shared [ChartLegendViewModel] over
// the [ChartHiddenSeriesStore] seam (P1/S8) — the view performs NO work and reads no store directly.
// Every derivation flows through the pure [ChartLegendProjection]; the composable is a thin render
// layer. The faithful mapping of the web behaviour:
//   • `useChartHiddenSeries()` / `state` prop → the injected [store], re-shared per `chartKey` by the
//     ViewModel as the [ChartLegendViewModel.hidden] flow (the toggle source, never HTTP).
//   • the `formatter`'s per-entry `<span>` → [LegendChip]: a color swatch + label whose dim (opacity +
//     line-through) and tappability are driven by the projected [LegendItem.hidden] /
//     [LegendItem.interactive].
//   • `onClick → resolved.toggle(key)` → the chip's toggle action calling [ChartLegendViewModel.toggle].
//   • `aria-pressed` (web toggle-button state) → an idiomatic Material checkbox role whose ticked state
//     encodes "series visible" (the inverse one-bit encoding of the web `aria-pressed=hidden`), so
//     TalkBack speaks the platform-localized ticked / not-ticked state with no English literal here.
//
// States reproduced (every one renders a non-blank surface): the empty legend (no series → a friendly
// `EmptyState`, never a blank box), the passive legend (`interactive=false`, the web "no resolved
// source" branch → entries shown, no toggle, no dimming), and the interactive legend with each entry in
// its visible or hidden (dimmed + struck-through) form. The toggle source is a client-side visibility
// store, so there is no loading / error / stale / offline data state to paint (it fetches nothing) — the
// rationale the model header documents in full. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartLegend) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartlegend

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the legend container — used by the instrumented per-state + a11y UI tests. */
const val CHART_LEGEND_TEST_TAG: String = "chart-legend"

/** Per-chip test-tag prefix; the full tag is `chart-legend-chip:{seriesKey}` (one stable node per row). */
const val CHART_LEGEND_CHIP_TAG_PREFIX: String = "chart-legend-chip:"

/** The dimmed opacity a hidden series renders at — the native mirror of the web `opacity: 0.4`. */
private const val DIM_ALPHA: Float = 0.4f

/** The fully-visible opacity a shown series renders at. */
private const val FULL_ALPHA: Float = 1f

/** The legend swatch diameter — a small color dot identifying the series. */
private val SWATCH_SIZE = 10.dp

/**
 * Stateful entry point bound to the shared hidden-series store — the faithful port of the web
 * `ChartLegend` resolving `useChartHiddenSeries()` and rendering a toggling `<Legend>`. Binds the
 * [ChartLegendViewModel] for [chartKey], records the one-shot `view.opened` diagnostic (P1/S11),
 * collects the live hidden set and projects the caller's [series] into the per-entry render states the
 * stateless renderer paints.
 *
 * @param chartKey the stable chart namespace the hidden set is keyed by (web `chartKey`).
 * @param series the legend rows (already-localized labels + swatch colors), in display order.
 * @param modifier optional layout modifier for the legend container.
 * @param interactive whether series are tappable to hide/show — the native analogue of the web "a toggle
 *   source resolved" condition. `false` renders a passive legend (no toggle, no dimming).
 * @param store the shared hidden-series seam; defaults to the process-wide [ProcessChartHiddenSeriesStore].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun ChartLegend(
    chartKey: String,
    series: List<LegendSeries>,
    modifier: Modifier = Modifier,
    interactive: Boolean = true,
    store: ChartHiddenSeriesStore = ProcessChartHiddenSeriesStore,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ChartLegendViewModel =
        viewModel(
            key = ChartLegendRegistration.ID + ":" + chartKey,
            factory = ChartLegendViewModel.factory(chartKey, store, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val hidden by viewModel.hidden.collectAsStateWithLifecycle()
    val items = ChartLegendProjection.project(series, hidden, interactive)
    ChartLegendContent(
        items = items,
        onToggle = if (interactive) viewModel::toggle else null,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the empty legend as a friendly
 * [EmptyState] (web parity: an empty payload shows nothing, but the P3 contract forbids a blank box), and
 * otherwise lays the projected [items] out as wrapping [LegendChip]s. [onToggle] is `null` for a passive
 * legend (the web "no resolved source" branch); a non-null callback makes each chip a toggle.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChartLegendContent(
    items: List<LegendItem>,
    onToggle: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) {
        EmptyState(
            message = stringResource(R.string.translation_chart_noData),
            modifier = modifier.testTag(CHART_LEGEND_TEST_TAG),
        )
        return
    }
    val reduceMotion = rememberReducedMotion()
    FlowRow(
        modifier = modifier.testTag(CHART_LEGEND_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        items.forEach { item ->
            LegendChip(item = item, reduceMotion = reduceMotion, onToggle = onToggle)
        }
    }
}

/**
 * One legend entry — a color swatch + label, dimmed (animated opacity + line-through) when the series is
 * hidden. The whole chip is a single accessibility node: its [LegendItem.label] is the spoken label, and
 * an interactive chip exposes a Material checkbox whose ticked state encodes "series visible" (web
 * `aria-pressed`) plus a toggle action calling [onToggle]. The opacity transition collapses to an
 * instant snap under reduced motion (TalkBack "remove animations" / animator scale off).
 */
@Composable
private fun LegendChip(
    item: LegendItem,
    reduceMotion: Boolean,
    onToggle: ((String) -> Unit)?,
) {
    val targetAlpha = if (item.hidden) DIM_ALPHA else FULL_ALPHA
    val alpha by animateFloatAsState(
        targetValue = targetAlpha,
        animationSpec = if (reduceMotion) snap() else tween(durationMillis = MotionDefaults.TRANSITION_MS),
        label = "legendChipAlpha",
    )
    val clickable = onToggle != null && item.interactive
    val chipModifier =
        Modifier
            .clip(RoundedCornerShape(Radius.sm))
            .then(
                if (clickable) {
                    Modifier.toggleable(
                        value = !item.hidden,
                        role = Role.Checkbox,
                        onValueChange = { onToggle(item.key) },
                    )
                } else {
                    Modifier
                },
            ).semantics { contentDescription = item.label }
            .testTag(CHART_LEGEND_CHIP_TAG_PREFIX + item.key)
            .padding(horizontal = Spacing.xs, vertical = Spacing.xs)
            .alpha(alpha)
    Row(modifier = chipModifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier =
                Modifier
                    .padding(end = Spacing.xs)
                    .size(SWATCH_SIZE)
                    .clip(CircleShape)
                    .background(Color(item.colorArgb)),
        )
        Text(
            text = item.label,
            modifier = Modifier.clearAndSetSemantics { },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textDecoration = if (item.hidden) TextDecoration.LineThrough else TextDecoration.None,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ── Previews (tooling-only; sample labels/colors are never shipped UI) ────────────────────────────────

/** A small palette for the previews — illustrative swatch colors, not part of the surface contract. */
private const val PREVIEW_SPEED_ARGB: Long = 0xFF2DD4BFL
private const val PREVIEW_POWER_ARGB: Long = 0xFFF59E0BL
private const val PREVIEW_RANGE_ARGB: Long = 0xFF818CF8L

private val previewSeries =
    listOf(
        LegendSeries(key = "speed", label = "Speed", colorArgb = PREVIEW_SPEED_ARGB),
        LegendSeries(key = "power", label = "Power", colorArgb = PREVIEW_POWER_ARGB),
        LegendSeries(key = "range", label = "Range", colorArgb = PREVIEW_RANGE_ARGB),
    )

@Preview(name = "Interactive — one series hidden", showBackground = true)
@Composable
private fun ChartLegendInteractivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            ChartLegendContent(
                items = ChartLegendProjection.project(previewSeries, hidden = setOf("power"), interactive = true),
                onToggle = {},
            )
        }
    }
}

@Preview(name = "Passive — no toggling", showBackground = true)
@Composable
private fun ChartLegendPassivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartLegendContent(
            items = ChartLegendProjection.project(previewSeries, hidden = emptySet(), interactive = false),
            onToggle = null,
        )
    }
}

@Preview(name = "Empty — no series", showBackground = true)
@Composable
private fun ChartLegendEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartLegendContent(items = emptyList(), onToggle = null)
    }
}
