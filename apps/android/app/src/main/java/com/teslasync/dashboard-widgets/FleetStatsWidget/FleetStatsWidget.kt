// The native Jetpack Compose + Material 3 Fleet Stats dashboard surface — a parity port of
// web/src/features/dashboard/widgets/FleetStatsWidget.tsx (which renders
// web/src/features/dashboard/components/FleetStatsBar.tsx). It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `FleetStatsBar`: a five-card grid — Fleet Size (+ online sub), Distance (30d) with a recent-drives mini
// sparkline, Energy (30d) with a recent-charges mini sparkline, Efficiency (+ "fleet average"), and
// Alerts (+ "unread"). The web component ignores `WidgetProps` and the bar is a single responsive grid,
// so no size branch is threaded. All data flows through the shared [FleetStatsWidgetViewModel]; SI
// distance/efficiency figures are converted at this render boundary via the live [FleetStatsDisplayPrefs].
// The view never performs HTTP. Every string resolves through the i18n catalog and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val CARD_MIN_HEIGHT = 72.dp
private val LOADING_CARD_HEIGHT = 56.dp
private const val LOADING_ROWS = 3
private const val MIN_SPARKLINE_POINTS = 2

// Mini-sparkline stroke colours — the exact web hex the `MiniChart` receives in FleetStatsBar
// (`color="#00f0ff"` for the distance trend, `color="#10b981"` for the energy trend). These are
// data-driven chart colours (the direct analogue of CHART_COLORS), not static theme styling.
private val DISTANCE_SPARK_COLOR = Color(0xFF00F0FF)
private val ENERGY_SPARK_COLOR = Color(0xFF10B981)

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [FleetStatsWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface. A dashboard host supplies [source] (an
 * adapter over the shared S7/S8 data layer) and a unique [instanceKey] per placement; the grid footprint
 * lives on [FleetStatsRegistration] (the web component ignores `WidgetProps`, so no size is threaded).
 *
 * @param source the cache-then-network seam (vehicles + analytics + drives + charges + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FleetStatsWidget(
    source: FleetStatsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FleetStatsRegistration.ID,
) {
    val viewModel: FleetStatsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { FleetStatsWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val bar by viewModel.bar.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    FleetStatsWidgetContent(
        state = state,
        bar = bar,
        prefs = prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (first load → skeleton, hard error with no cache → retry) and otherwise
 * the freshness header above the five-stat bar. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract; offline/stale keeps the cached bar visible (never blanked). [prefs] supplies the
 * SI→display conversion; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun FleetStatsWidgetContent(
    state: UiState<JsonElement>,
    bar: FleetStatsBarData,
    prefs: FleetStatsDisplayPrefs,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberFleetStatsStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> FleetStatsLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> FleetStatsError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, bar, prefs, strings, locale) {
                        FleetStatsProjection.project(parseFleetStats(state.data), bar, prefs, strings, locale)
                    }
                FleetStatsHeader(state = state, onRefresh = onRefresh)
                FleetStatsGrid(display = display, locale = locale)
            }
        }
    }
}

@Composable
private fun FleetStatsHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
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
private fun FleetStatsGrid(
    display: FleetStatsDisplay,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FleetStatsRow {
            FleetMetricCard(metric = display.fleetSize, locale = locale, reduceMotion = reduceMotion)
            FleetMetricCard(metric = display.distance, sparkColor = DISTANCE_SPARK_COLOR, locale = locale, reduceMotion = reduceMotion)
        }
        FleetStatsRow {
            FleetMetricCard(metric = display.energy, sparkColor = ENERGY_SPARK_COLOR, locale = locale, reduceMotion = reduceMotion)
            FleetMetricCard(metric = display.efficiency, locale = locale, reduceMotion = reduceMotion)
        }
        FleetStatsRow {
            FleetMetricCard(metric = display.alerts, locale = locale, reduceMotion = reduceMotion)
            // The fifth card leaves the trailing half-row empty so every card keeps a uniform width.
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun FleetStatsRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        content = content,
    )
}

@Composable
private fun RowScope.FleetMetricCard(
    metric: FleetStatsMetric,
    locale: Locale,
    reduceMotion: Boolean,
    sparkColor: Color? = null,
) {
    GlassPanel(modifier = Modifier.weight(1f), padding = PanelPadding.Sm) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = CARD_MIN_HEIGHT)
                    .clearAndSetSemantics { contentDescription = metric.contentDescription },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
        ) {
            MetricLabel(metric.label)
            val suffix = metric.unit?.let { " $it" } ?: ""
            if (reduceMotion) {
                MetricValue("${ChartFormat.number(metric.value, metric.decimals, locale)}$suffix")
            } else {
                AnimatedNumber(value = metric.value, decimals = metric.decimals, suffix = suffix, locale = locale)
            }
            if (metric.trend.size >= MIN_SPARKLINE_POINTS && sparkColor != null) {
                Sparkline(data = metric.trend, color = sparkColor)
            } else if (metric.sublabel != null) {
                Caption(metric.sublabel)
            }
        }
    }
}

@Composable
private fun FleetStatsLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROWS) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Skeleton(modifier = Modifier.weight(1f), height = LOADING_CARD_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = LOADING_CARD_HEIGHT, rounded = true)
            }
        }
    }
}

@Composable
private fun FleetStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [FleetStatsStrings] from the i18n catalog (P1/S10) — the eight `fleet.*` keys the
 * web `FleetStatsBar` reads via `t('fleet.…')`. Remembered against the resolved strings so a locale
 * change re-projects the surface.
 */
@Composable
private fun rememberFleetStatsStrings(): FleetStatsStrings {
    val size = stringResource(R.string.translation_fleet_size)
    val online = stringResource(R.string.translation_fleet_online)
    val distance = stringResource(R.string.translation_fleet_distance)
    val energy = stringResource(R.string.translation_fleet_energy)
    val efficiency = stringResource(R.string.translation_fleet_efficiency)
    val average = stringResource(R.string.translation_fleet_average)
    val alerts = stringResource(R.string.translation_fleet_alerts)
    val unread = stringResource(R.string.translation_fleet_unread)
    return remember(size, online, distance, energy, efficiency, average, alerts, unread) {
        FleetStatsStrings(
            size = size,
            online = online,
            distance = distance,
            energy = energy,
            efficiency = efficiency,
            average = average,
            alerts = alerts,
            unread = unread,
        )
    }
}
