// File hosts the ChargeCostTracker Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.chargecosttracker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Charge Cost Tracker dashboard surface — a parity
 * port of `web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx`. It mirrors the web
 * `WidgetShell` (skeleton while loading, a retry surface on error, otherwise a title + dollar icon +
 * freshness header) wrapping either the compact big-number total cost or the Total Energy / Total
 * Cost (+ Cost-per-distance / vs-Gas-Savings) metric tiles, or a friendly empty state. All data flows
 * through the [ChargeCostTrackerWidgetViewModel] (P1/S8); the view performs no HTTP. Every string
 * resolves from `strings.xml` (P1/S10) and the refresh control carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared charging / vehicles / settings holders.
 * @param size the grid footprint; controls the compact vs standard vs tall layout (web isCompact/isTall).
 */
@Composable
fun ChargeCostTrackerWidget(
    viewModel: ChargeCostTrackerWidgetViewModel,
    modifier: Modifier = Modifier,
    size: ChargeCostTrackerSize = ChargeCostTrackerRegistration.DEFAULT_SIZE,
) {
    val sessionsState by viewModel.sessions.collectAsStateWithLifecycle()
    val prefs by viewModel.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    val metricsState = remember(sessionsState, prefs) { sessionsState.toMetricsState(prefs) }
    ChargeCostTrackerWidget(
        state = metricsState,
        prefs = prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Charge Cost Tracker panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over cached figures, and the
 * compact 1×1 big-number layout). Hoisted out of the ViewModel so it is preview- and screenshot-
 * testable for each state. Stale (non-error) data auto-refreshes.
 */
@Composable
fun ChargeCostTrackerWidget(
    state: UiState<ChargeCostMetrics>,
    prefs: ChargeCostPrefs,
    size: ChargeCostTrackerSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val metrics = state.data ?: ChargeCostMetrics.EMPTY
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when (chargeCostSurface(state)) {
            ChargeCostSurface.Loading -> ChargeCostLoading(compact = size.isCompact)
            ChargeCostSurface.Error -> ChargeCostError(state = state, onRetry = onRetry)
            ChargeCostSurface.Empty -> {
                if (!size.isCompact) ChargeCostHeader(state = state, onRefresh = onRefresh)
                ChargeCostEmpty()
            }
            ChargeCostSurface.Content ->
                if (size.isCompact) {
                    ChargeCostCompact(metrics = metrics, prefs = prefs, state = state)
                } else {
                    ChargeCostHeader(state = state, onRefresh = onRefresh)
                    ChargeCostBody(metrics = metrics, prefs = prefs, size = size)
                }
        }
    }
}

@Composable
private fun ChargeCostHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = ChargeCostDollarGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_chargeCost_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun ChargeCostLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            StatGridSkeleton(count = 2)
            StatGridSkeleton(count = 2)
        }
    }
}

@Composable
private fun ChargeCostError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = chargeCostErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_chargeCost_title),
        onRetry = onRetry,
    )
}

@Composable
private fun ChargeCostEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_chargeCost_noData),
        icon = ChargeCostDollarGlyph,
    )
}

@Composable
private fun ChargeCostCompact(
    metrics: ChargeCostMetrics,
    prefs: ChargeCostPrefs,
    state: UiState<*>,
) {
    val locale = Locale.getDefault()
    val value =
        ChargeCostTrackerProjection.formatCurrency(
            metrics.totalCost,
            prefs.settings,
            ChargeCostTrackerProjection.COMPACT_DECIMALS,
            locale,
        )
    val label = stringResource(R.string.translation_widget_chargeCost_monthly)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = COMPACT_MIN_HEIGHT)
                .semantics { contentDescription = "$value, $label" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MetricValue(value)
        MetricLabel(label)
    }
}

@Composable
private fun ChargeCostBody(
    metrics: ChargeCostMetrics,
    prefs: ChargeCostPrefs,
    size: ChargeCostTrackerSize,
) {
    val locale = Locale.getDefault()
    val settings = prefs.settings
    val kwhUnit = stringResource(R.string.translation_widget_chargeCost_kwh)
    val energyValue = "${ChargeCostTrackerProjection.formatKwh(metrics.totalKwh, locale)} $kwhUnit"
    val rate = ChargeCostTrackerProjection.formatCurrency(settings.costPerKwh, settings, locale = locale)
    val totalCostValue = ChargeCostTrackerProjection.formatCurrency(metrics.totalCost, settings, locale = locale)
    val sessionsSubtitle = stringResource(R.string.translation_widget_chargeCost_sessions, metrics.sessionCount)

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_widget_chargeCost_totalEnergy),
                value = energyValue,
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                accent = TeslaTokens.status.info,
                subtitle = sessionsSubtitle,
            )
            MetricCard(
                label = stringResource(R.string.translation_widget_chargeCost_totalCost),
                value = totalCostValue,
                modifier = Modifier.weight(1f),
                icon = ChargeCostDollarGlyph,
                accent = TeslaTokens.status.success,
                subtitle = "$rate/$kwhUnit",
            )
        }

        if (size.isTall) {
            ChargeCostExtraTiles(metrics = metrics, prefs = prefs)
        } else {
            ChargeCostFooter(metrics = metrics, prefs = prefs)
        }
    }
}

@Composable
private fun ChargeCostExtraTiles(
    metrics: ChargeCostMetrics,
    prefs: ChargeCostPrefs,
) {
    val locale = Locale.getDefault()
    val settings = prefs.settings
    val costPerDistanceLabel =
        stringResource(R.string.translation_widget_chargeCost_costPerDistance, prefs.units.distance.label)
    val gasSubtitle =
        if (metrics.gasSavings != null) {
            stringResource(R.string.translation_widget_chargeCost_savingsNote)
        } else {
            stringResource(R.string.translation_widget_chargeCost_configureGas)
        }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        MetricCard(
            label = costPerDistanceLabel,
            value = costPerDistanceValue(metrics, settings, locale),
            modifier = Modifier.weight(1f),
            icon = DataDisplayGlyphs.Gauge,
            accent = TeslaTokens.status.warning,
        )
        MetricCard(
            label = stringResource(R.string.translation_widget_chargeCost_gasSavings),
            value = gasSavingsValue(metrics, settings, locale),
            modifier = Modifier.weight(1f),
            icon = DataDisplayGlyphs.TrendingDown,
            accent = TeslaTokens.status.success,
            subtitle = gasSubtitle,
        )
    }
}

@Composable
private fun ChargeCostFooter(
    metrics: ChargeCostMetrics,
    prefs: ChargeCostPrefs,
) {
    val locale = Locale.getDefault()
    val settings = prefs.settings
    val left =
        if (metrics.costPerDistance != null) {
            "${costPerDistanceValue(metrics, settings, locale)}/${prefs.units.distance.label}"
        } else {
            CHARGE_COST_EM_DASH
        }
    val gasSavings = metrics.gasSavings
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(left)
        if (gasSavings != null) {
            val amount = ChargeCostTrackerProjection.formatCurrency(gasSavings, settings, locale = locale)
            Caption(stringResource(R.string.translation_widget_chargeCost_saved, amount))
        }
    }
}

private fun costPerDistanceValue(
    metrics: ChargeCostMetrics,
    settings: ChargeCostSettings,
    locale: Locale,
): String {
    val value = metrics.costPerDistance ?: return CHARGE_COST_EM_DASH
    return ChargeCostTrackerProjection.formatCurrency(
        value,
        settings,
        ChargeCostTrackerProjection.COST_PER_DISTANCE_DECIMALS,
        locale,
    )
}

private fun gasSavingsValue(
    metrics: ChargeCostMetrics,
    settings: ChargeCostSettings,
    locale: Locale,
): String {
    val value = metrics.gasSavings ?: return CHARGE_COST_EM_DASH
    return ChargeCostTrackerProjection.formatCurrency(value, settings, locale = locale)
}

// ── Local glyph — the web `DollarSign`, authored as a 24×24 stroked vector (the data-display layer
// has no money glyph; mirrors the hand-authored approach in components/datadisplay/DataDisplayGlyphs). ──

private fun chargeCostStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val ChargeCostDollarGlyph: ImageVector =
    chargeCostStroked("ChargeCostDollar") {
        moveTo(12f, 3f)
        lineTo(12f, 21f)
        moveTo(16f, 7.5f)
        curveTo(16f, 5.8f, 14.2f, 5f, 12f, 5f)
        curveTo(9.2f, 5f, 8f, 6.4f, 8f, 8.3f)
        curveTo(8f, 12.5f, 16f, 11f, 16f, 15.7f)
        curveTo(16f, 17.6f, 14.8f, 19f, 12f, 19f)
        curveTo(9.8f, 19f, 8f, 18.2f, 8f, 16.5f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val LOADING_TITLE_FRACTION = 0.5f
private const val LOADING_NUMBER_FRACTION = 0.6f
private val LOADING_TITLE_HEIGHT = 12.dp
private val LOADING_NUMBER_HEIGHT = 28.dp
private val COMPACT_MIN_HEIGHT = 56.dp

// ── Previews — one per rendered state (content / empty / loading / error). ────────────────────────

private val previewMetrics =
    ChargeCostMetrics(
        totalKwh = 312.5,
        totalCost = 37.5,
        costPerDistance = 0.034,
        gasSavings = 42.5,
        sessionCount = 12,
        totalDistanceMi = 1093.75,
    )

@Preview(name = "ChargeCost · content", showBackground = true)
@Composable
private fun ChargeCostContentPreview() {
    TeslaSyncTheme {
        ChargeCostTrackerWidget(
            state = UiState(phase = UiPhase.Content, data = previewMetrics, fetchedAt = 1L),
            prefs = ChargeCostPrefs.DEFAULT,
            size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "ChargeCost · empty", showBackground = true)
@Composable
private fun ChargeCostEmptyPreview() {
    TeslaSyncTheme {
        ChargeCostTrackerWidget(
            state = UiState(phase = UiPhase.Empty, data = ChargeCostMetrics.EMPTY, fetchedAt = 1L),
            prefs = ChargeCostPrefs.DEFAULT,
            size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "ChargeCost · loading", showBackground = true)
@Composable
private fun ChargeCostLoadingPreview() {
    TeslaSyncTheme {
        ChargeCostTrackerWidget(
            state = UiState.loading(),
            prefs = ChargeCostPrefs.DEFAULT,
            size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "ChargeCost · error", showBackground = true)
@Composable
private fun ChargeCostErrorPreview() {
    TeslaSyncTheme {
        ChargeCostTrackerWidget(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = ChargeCostPrefs.DEFAULT,
            size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "ChargeCost · compact", showBackground = true)
@Composable
private fun ChargeCostCompactPreview() {
    TeslaSyncTheme {
        ChargeCostTrackerWidget(
            state = UiState(phase = UiPhase.Content, data = previewMetrics, fetchedAt = 1L),
            prefs = ChargeCostPrefs.DEFAULT,
            size = ChargeCostTrackerSize(cols = 1, rows = 1),
        )
    }
}
