// The native Jetpack Compose + Material 3 ChartHiddenSeriesContext shared surface — a parity port of the
// web context bridge web/src/components/charts/ChartHiddenSeriesContext.tsx (over its data source
// web/src/hooks/useHiddenSeries.ts). The web source is NOT a visual view: it is the React context plumbing
// that carries a chart's URL-persisted hidden-series state down to its legend without prop-drilling —
// `createContext<HiddenSeriesState | null>(null)`, the `useChartHiddenSeries()` reader, and the
// `ChartHiddenSeriesProvider` render-prop that resolves `useHiddenSeries(chartKey)` only when a chartKey
// is supplied. This file reproduces that plumbing with the idiomatic Compose analogue of a React context —
// a [CompositionLocal] — plus the matching reader and provider, and demonstrates the bridge end-to-end in
// tooling-only previews.
//
// React context -> Compose [CompositionLocal] mapping (the established `LocalDataContainer` /
// `LocalStatusColors` pattern in this app): [LocalChartHiddenSeries] is the context (default `null` = the
// chart did not opt into legend toggling); [useChartHiddenSeries] is `useContext`; [ChartHiddenSeriesProvider]
// is the provider. A `compositionLocalOf` (not `staticCompositionLocalOf`) is used so that when the hidden
// set changes only the legend consumers that read the local recompose — mirroring React re-rendering only
// the context consumers, not the whole subtree.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): a context bridge over URL state has no
// loading / empty / error / stale / offline lifecycle of its own (see ChartHiddenSeriesContextModel.kt for
// the full rationale, shared with the accepted VisuallyHidden / AIChatbotIndicator siblings). Its real
// states — absent (no chartKey), all-visible (empty hidden set), and some-hidden — are reproduced: the
// provider yields `null` to the render-prop when no chartKey is supplied (web `children(null)`), and the
// previews render a legend consumer in both opted-in states. The surface renders no copy of its own (the
// web source renders `children`), so it is anonymous and carries no i18n keys; the preview series names are
// tooling-only, never shipped UI.
//
// `MatchingDeclarationName` / `InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartHiddenSeriesContext) cannot form a valid Kotlin package and the file
// hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The Compose context carrying a chart's URL-persisted hidden-series state to its legend — the native
 * analogue of the web `ChartHiddenSeriesContext = createContext<HiddenSeriesState | null>(null)`. The
 * default `null` means the chart did not opt into legend toggling (no `chartKey`), exactly as the web
 * context default is `null`. A `compositionLocalOf` (not static) so only the consumers that read it
 * recompose when the hidden set changes.
 */
val LocalChartHiddenSeries: ProvidableCompositionLocal<HiddenSeriesState?> = compositionLocalOf { null }

/**
 * Reads the hidden-series state from the nearest [ChartHiddenSeriesProvider], or `null` when the enclosing
 * chart did not opt into toggling — the native analogue of the web `useChartHiddenSeries()`
 * (`useContext(ChartHiddenSeriesContext)`). A legend calls this to drive its click-to-hide UX without
 * prop-drilling.
 */
@Composable
@ReadOnlyComposable
fun useChartHiddenSeries(): HiddenSeriesState? = LocalChartHiddenSeries.current

/**
 * Provides the URL-persisted hidden-series state for [chartKey] to [content] and to any nested
 * [useChartHiddenSeries] reader — the native analogue of the web `ChartHiddenSeriesProvider`.
 *
 * Mirrors the web control flow exactly: when [chartKey] is null/blank the chart has not opted into
 * toggling, so [content] is invoked with `null` and no context is provided (web
 * `return <>{children(null)}</>`); otherwise the per-chart [ChartHiddenSeriesViewModel] is bound, its
 * state is provided through [LocalChartHiddenSeries], and [content] receives the resolved state (web
 * `ChartHiddenSeriesProviderInner`). The render-prop shape lets a caller both read the state via context
 * AND pass it straight into existing function-children, matching the web component.
 *
 * @param chartKey the chart id whose `hidden_{chartKey}` param backs the state; null/blank opts out.
 * @param store the shared param-store seam (defaults to the process-wide URL analogue; injectable for hosts/tests).
 * @param content render-prop receiving the resolved [HiddenSeriesState] (or `null` when opted out).
 */
@Composable
fun ChartHiddenSeriesProvider(
    chartKey: String?,
    store: HiddenSeriesParamStore = ProcessHiddenSeriesParamStore,
    content: @Composable (HiddenSeriesState?) -> Unit,
) {
    if (chartKey.isNullOrBlank()) {
        content(null)
        return
    }
    // Only the opted-in path touches the data layer, mirroring the web inner provider being the sole
    // caller of `useHiddenSeries` — so a chart that never opts in never requires a DataContainer.
    val logger = LocalDataContainer.current.logger
    val viewModel: ChartHiddenSeriesViewModel =
        viewModel(
            key = chartKey,
            factory = ChartHiddenSeriesViewModel.factory(store, chartKey, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    CompositionLocalProvider(LocalChartHiddenSeries provides state) {
        content(state)
    }
}

// ── Previews (tooling-only; sample series names are never shipped UI) ─────────────────────────────────

/** Web `border` on the chip — a 1px hairline. */
private val DEMO_CHIP_BORDER_WIDTH = 1.dp

/** Fill wash applied to a visible series' chip in the demo legend. */
private const val DEMO_FILL_ALPHA = 0.12f

/** Border wash applied to every series' chip in the demo legend. */
private const val DEMO_BORDER_ALPHA = 0.40f

/**
 * A minimal legend consumer used only by the previews: it reads [useChartHiddenSeries] and renders one
 * chip per series, dimmed + struck-through when that series is hidden. This demonstrates the context
 * bridge driving a consumer — the surface itself renders no such legend (that is a separate component);
 * the chip is here purely to make the @Preview states visible.
 */
@Composable
private fun ChartLegendDemo(series: List<String>) {
    val hidden = useChartHiddenSeries()
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        series.forEach { key ->
            val isHidden = hidden?.isHidden(key) == true
            val accent = MaterialTheme.colorScheme.primary
            Surface(
                shape = RoundedCornerShape(Radius.pill),
                color = accent.copy(alpha = if (isHidden) 0f else DEMO_FILL_ALPHA),
                contentColor = if (isHidden) MaterialTheme.colorScheme.onSurfaceVariant else accent,
                border = BorderStroke(DEMO_CHIP_BORDER_WIDTH, accent.copy(alpha = DEMO_BORDER_ALPHA)),
            ) {
                Text(
                    text = key,
                    modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                    style = MaterialTheme.typography.labelMedium,
                    textDecoration = if (isHidden) TextDecoration.LineThrough else TextDecoration.None,
                )
            }
        }
    }
}

private val DEMO_SERIES = listOf("actual", "health", "projected")

@Preview(name = "All series visible", showBackground = true)
@Composable
private fun ChartHiddenSeriesAllVisiblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(
            LocalChartHiddenSeries provides HiddenSeriesState(chartKey = "battery-degradation-trend", hidden = emptySet()),
        ) {
            ChartLegendDemo(series = DEMO_SERIES)
        }
    }
}

@Preview(name = "One series hidden", showBackground = true)
@Composable
private fun ChartHiddenSeriesSomeHiddenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(
            LocalChartHiddenSeries provides
                HiddenSeriesState(chartKey = "battery-degradation-trend", hidden = setOf("projected")),
        ) {
            ChartLegendDemo(series = DEMO_SERIES)
        }
    }
}

@Preview(name = "One series hidden (dark)", showBackground = true)
@Composable
private fun ChartHiddenSeriesSomeHiddenDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        CompositionLocalProvider(
            LocalChartHiddenSeries provides
                HiddenSeriesState(chartKey = "battery-degradation-trend", hidden = setOf("projected")),
        ) {
            ChartLegendDemo(series = DEMO_SERIES)
        }
    }
}
