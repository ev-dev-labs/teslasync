// The native Jetpack Compose + Material 3 Fleet Stats Bar dashboard surface — a parity port of
// web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx. It mirrors the web `WidgetShell` (a single
// skeleton while loading, a retry surface on hard error, otherwise a freshness header with the title +
// `Car` icon + refresh) wrapping the web `WidgetStatGrid`: four KPI tiles — Vehicles, Online Now,
// Distance (30d), Energy (30d) — laid out two-up (the web four-up grid's narrow collapse) or stacked when
// compact, plus a friendly empty surface when no fleet data exists. All data flows through the shared
// [FleetStatsBarWidgetViewModel]; the SI distance is unit-converted at this render boundary via the live
// [FleetStatsBarDisplayPrefs]. The view never performs HTTP. Every string resolves through the i18n
// catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FleetStatsBarWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fleetstatsbar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Two-up tile layout — the web four-up `WidgetStatGrid` collapses to two columns at a widget's width. */
private const val GRID_COLUMNS = 2
private val LOADING_HEIGHT = 96.dp

// Title icon accent — the exact web `text-cyan-400` the WidgetShell `Car` icon receives. A specific
// brand accent (the direct analogue of the web utility class), not themed body styling.
private val TITLE_ICON_COLOR = Color(0xFF22D3EE)

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [FleetStatsBarWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A
 * dashboard host supplies [source] (an adapter over the shared S7/S8 data layer) and a unique
 * [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + fleet-analytics + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FleetStatsBarWidget(
    source: FleetStatsBarSource,
    modifier: Modifier = Modifier,
    size: FleetStatsBarSize = FleetStatsBarRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FleetStatsBarRegistration.ID,
) {
    val viewModel: FleetStatsBarWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { FleetStatsBarWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    FleetStatsBarWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header above the stat grid / empty surface. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [prefs] supplies the SI→display distance conversion; [locale] drives number
 * grouping (tests pin a deterministic locale).
 */
@Composable
fun FleetStatsBarWidgetContent(
    state: UiState<FleetStatsBarData>,
    prefs: FleetStatsBarDisplayPrefs,
    size: FleetStatsBarSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberFleetStatsBarStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                FleetStatsBarLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> FleetStatsBarError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        FleetStatsBarProjection.project(state.data ?: FleetStatsBarData.EMPTY, prefs, strings, locale)
                    }
                FleetStatsBarReady(state = state, display = display, title = strings.title, size = size, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun FleetStatsBarReady(
    state: UiState<FleetStatsBarData>,
    display: FleetStatsBarDisplay,
    title: String,
    size: FleetStatsBarSize,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        FleetStatsBarHeader(title = title, state = state, onRefresh = onRefresh)
        if (display.hasData) {
            FleetStatsBarGrid(items = display.items, compact = size.isCompact)
        } else {
            EmptyState(
                message = display.emptyMessage,
                icon = FleetStatsBarGlyphs.Car,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun FleetStatsBarHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = FleetStatsBarGlyphs.Car,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TITLE_ICON_COLOR,
            )
            PanelTitle(title)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
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
}

@Composable
private fun FleetStatsBarGrid(
    items: List<FleetStatItem>,
    compact: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (compact) {
            items.forEach { item -> FleetStatCard(item, Modifier.fillMaxWidth()) }
        } else {
            items.chunked(GRID_COLUMNS).forEach { rowItems -> FleetStatRow(rowItems) }
        }
    }
}

@Composable
private fun FleetStatRow(rowItems: List<FleetStatItem>) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        rowItems.forEach { item -> FleetStatCard(item, Modifier.weight(1f)) }
        // Keep a partial final row left-aligned at the same tile width as a full row.
        repeat(GRID_COLUMNS - rowItems.size) { Spacer(Modifier.weight(1f)) }
    }
}

@Composable
private fun FleetStatCard(
    item: FleetStatItem,
    modifier: Modifier = Modifier,
) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = modifier,
        unit = item.unit,
        icon = fleetStatIcon(item.iconKey),
    )
}

@Composable
private fun FleetStatsBarLoading(label: String) {
    Skeleton(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        widthFraction = 1f,
        height = LOADING_HEIGHT,
        rounded = true,
    )
}

@Composable
private fun FleetStatsBarError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps a [FleetStatIcon] to its rendered glyph (web lucide `Car` / `Wifi` / `Route` / `Zap`). */
private fun fleetStatIcon(key: FleetStatIcon): ImageVector =
    when (key) {
        FleetStatIcon.Vehicles -> FleetStatsBarGlyphs.Car
        FleetStatIcon.Online -> DataDisplayGlyphs.Wifi
        FleetStatIcon.Distance -> FleetStatsBarGlyphs.Route
        FleetStatIcon.Energy -> DataDisplayGlyphs.Bolt
    }

/**
 * Builds the localized [FleetStatsBarStrings] from the i18n catalog (P1/S10) — the seven
 * `widget.fleetStatsBar.*` keys the web component reads via `t(...)`. Remembered against the resolved
 * strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberFleetStatsBarStrings(): FleetStatsBarStrings {
    val title = stringResource(R.string.translation_widget_fleetStatsBar_title)
    val vehicles = stringResource(R.string.translation_widget_fleetStatsBar_vehicles)
    val online = stringResource(R.string.translation_widget_fleetStatsBar_online)
    val onlineNow = stringResource(R.string.translation_widget_fleetStatsBar_onlineNow)
    val distance30d = stringResource(R.string.translation_widget_fleetStatsBar_distance30d)
    val energy30d = stringResource(R.string.translation_widget_fleetStatsBar_energy30d)
    val noData = stringResource(R.string.translation_widget_fleetStatsBar_noData)
    return remember(title, vehicles, online, onlineNow, distance30d, energy30d, noData) {
        FleetStatsBarStrings(
            title = title,
            vehicles = vehicles,
            online = online,
            onlineNow = onlineNow,
            distance30d = distance30d,
            energy30d = energy30d,
            noData = noData,
        )
    }
}

/**
 * The two glyphs this surface needs that the shared `DataDisplayGlyphs` set does not author — `Car`
 * (Vehicles total + widget title, web lucide `Car`) and `Route` (Distance, web lucide `Route`). Drawn as
 * 24×24 stroked vectors, mirroring the in-repo `DataDisplayGlyphs` authoring approach (Android has no
 * bundled `lucide` equivalent). Each is monochrome and recolored at render time by the `Icon`/`StatCard`
 * tint. `Wifi` and `Zap` reuse the shared `DataDisplayGlyphs.Wifi` / `DataDisplayGlyphs.Bolt`.
 */
private object FleetStatsBarGlyphs {
    /** Side-profile car: cabin + body outline over two wheels (web lucide `Car`). */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(2.5f, 14f)
            lineTo(5.5f, 14f)
            lineTo(7.5f, 9f)
            lineTo(15.5f, 9f)
            lineTo(17.5f, 14f)
            lineTo(21.5f, 14f)
            circle(7.5f, 16f, 1.7f)
            circle(16.5f, 16f, 1.7f)
        }

    /** Two route nodes joined by an S-shaped path (web lucide `Route`). */
    val Route: ImageVector =
        stroked("Route") {
            circle(5.5f, 18.5f, 2f)
            moveTo(7.5f, 18.5f)
            lineTo(13f, 18.5f)
            curveTo(15.5f, 18.5f, 15.5f, 13f, 13f, 13f)
            lineTo(9f, 13f)
            curveTo(6.5f, 13f, 6.5f, 7.5f, 9f, 7.5f)
            lineTo(16f, 7.5f)
            circle(16f, 5.5f, 2f)
        }

    /** Appends a full circle of radius [r] centred at ([cx], [cy]) as two semicircular arcs. */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx + r, cy)
        arcTo(r, r, 0f, false, true, cx - r, cy)
        arcTo(r, r, 0f, false, true, cx + r, cy)
    }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}
