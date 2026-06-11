// The native Jetpack Compose + Material 3 Route Efficiency dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise — on the expanded footprint — a
// route-iconed "Route Efficiency" title + freshness header) wrapping the body the web ternary renders:
// the `WidgetRankedList` of recurring routes ranked by energy efficiency (rank, "start → end" label,
// efficiency-band chip, "{eff} {unit} · {trips}×" value, and a relative background bar), or a friendly
// empty state when no route data is available. The compact footprint drops the title (web `isCompact`).
// All data flows through the shared [RouteEfficiencyWidgetViewModel] (P1/S8); the view never performs
// HTTP. The SI Wh/km efficiency is converted to the user's unit at this render boundary via the live
// [UnitFormatter] (web `useUnits()`), every string resolves through the i18n catalog (P1/S10), and the
// refresh control + each ranked row carry TalkBack labels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RouteEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.routeefficiency

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared vehicles + route-efficiency feeds via [source] into a
 * [RouteEfficiencyWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 data layer), the grid [size]
 * (web `WidgetProps.size`), an optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique
 * [instanceKey] per placement.
 */
@Composable
fun RouteEfficiencyWidget(
    source: RouteEfficiencySource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: RouteEfficiencySize = RouteEfficiencyRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = RouteEfficiencyRegistration.ID,
) {
    val viewModel: RouteEfficiencyWidgetViewModel =
        viewModel(key = instanceKey, factory = RouteEfficiencyWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    RouteEfficiencyWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the ranked route
 * list over the freshness header. [prefs] supplies the SI→display efficiency conversion at the render
 * boundary; [size] selects the compact (no title, bars hidden) vs expanded vs wide (per-row best/worst
 * suffix) layout (web `size`).
 */
@Composable
fun RouteEfficiencyWidgetContent(
    state: UiState<RouteEfficiencySnapshot>,
    prefs: UnitPref,
    size: RouteEfficiencySize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    val strings = rememberRouteEfficiencyStrings()
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> RouteEfficiencyLoading()
            state.isError -> RouteEfficiencyError(state = state, resourceName = strings.title, onRetry = onRefresh)
            else -> RouteEfficiencyLoaded(state = state, prefs = prefs, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun RouteEfficiencyLoaded(
    state: UiState<RouteEfficiencySnapshot>,
    prefs: UnitPref,
    size: RouteEfficiencySize,
    strings: RouteEfficiencyStrings,
    onRefresh: () -> Unit,
) {
    val compact = RouteEfficiencyRegistration.isCompact(size)
    val snapshot = state.data ?: RouteEfficiencySnapshot(emptyList())
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RouteEfficiencyHeader(
            title = if (compact) null else strings.title,
            state = state,
            onRefresh = onRefresh,
        )
        if (snapshot.routes.isNotEmpty()) {
            val ranked = remember(snapshot, prefs, size, strings) { RouteEfficiencyProjection.project(snapshot, prefs, strings, size) }
            RouteRankedList(ranked = ranked)
        } else {
            EmptyState(
                message = strings.noData,
                icon = MapsGlyphs.Route,
                modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
            )
        }
    }
}

@Composable
private fun RouteEfficiencyHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = MapsGlyphs.Route,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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

/** The ranked list of recurring routes (web `WidgetRankedList`): sorted, limited rows with a relative bar. */
@Composable
private fun RouteRankedList(ranked: RankedRouteList) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        ranked.items.forEachIndexed { index, item ->
            RouteRow(rank = index + 1, item = item, showBar = ranked.showBars)
        }
    }
}

@Composable
private fun RouteRow(
    rank: Int,
    item: RankedRouteItem,
    showBar: Boolean,
) {
    val rowDescription = "$rank. ${item.label}, ${item.badgeText}, ${item.formattedValue}"
    val barColor = if (item.isBest) TeslaTokens.status.success else TeslaTokens.status.info
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(ROW_CORNER))
                .semantics(mergeDescendants = true) { contentDescription = rowDescription },
    ) {
        if (showBar && item.barFraction > 0.0) {
            Box(modifier = Modifier.matchParentSize()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(item.barFraction.toFloat().coerceIn(0f, 1f))
                            .align(Alignment.CenterStart)
                            .clip(RoundedCornerShape(ROW_CORNER))
                            .background(barColor.copy(alpha = BAR_ALPHA)),
                )
            }
        }
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = ROW_MIN_HEIGHT)
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(text = "$rank", modifier = Modifier.widthIn(min = RANK_WIDTH))
            BodyText(text = item.label, modifier = Modifier.weight(1f), maxLines = 1)
            Badge(text = item.badgeText, variant = item.badgeVariant.toBadgeVariant())
            BodyText(text = item.formattedValue, maxLines = 1)
        }
    }
}

@Composable
private fun RouteEfficiencyLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun RouteEfficiencyError(
    state: UiState<RouteEfficiencySnapshot>,
    resourceName: String,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind =
                classifyQueryError(
                    status = state.httpStatus,
                    online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                    transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
                ),
            resourceName = resourceName,
            onRetry = onRetry,
        )
    }
}

private fun RouteBadgeVariant.toBadgeVariant(): BadgeVariant =
    when (this) {
        RouteBadgeVariant.Success -> BadgeVariant.Success
        RouteBadgeVariant.Warning -> BadgeVariant.Warning
        RouteBadgeVariant.Error -> BadgeVariant.Danger
    }

/**
 * Builds the localized [RouteEfficiencyStrings] from the i18n catalog (P1/S10) — the eight
 * `widget.routeEfficiency.*` keys the web component reads via `t('widget.routeEfficiency.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberRouteEfficiencyStrings(): RouteEfficiencyStrings {
    val title = stringResource(R.string.translation_widget_routeEfficiency_title)
    val excellent = stringResource(R.string.translation_widget_routeEfficiency_excellent)
    val good = stringResource(R.string.translation_widget_routeEfficiency_good)
    val fair = stringResource(R.string.translation_widget_routeEfficiency_fair)
    val poor = stringResource(R.string.translation_widget_routeEfficiency_poor)
    val best = stringResource(R.string.translation_widget_routeEfficiency_best)
    val worst = stringResource(R.string.translation_widget_routeEfficiency_worst)
    val noData = stringResource(R.string.translation_widget_routeEfficiency_noData)
    return remember(title, excellent, good, fair, poor, best, worst, noData) {
        RouteEfficiencyStrings(
            title = title,
            excellent = excellent,
            good = good,
            fair = fair,
            poor = poor,
            best = best,
            worst = worst,
            noData = noData,
        )
    }
}

private val BODY_MIN_HEIGHT: Dp = 88.dp
private val ROW_MIN_HEIGHT: Dp = 44.dp
private val RANK_WIDTH: Dp = 20.dp
private val ROW_CORNER: Dp = 8.dp
private val SKELETON_ROW_HEIGHT: Dp = 28.dp
private const val SKELETON_ROWS: Int = 4
private const val BAR_ALPHA: Float = 0.15f

// ── Previews — one per rendered state (expanded / wide / compact / empty / loading / error / offline). ──

private fun previewSnapshot(): RouteEfficiencySnapshot =
    RouteEfficiencySnapshot(
        routes =
            listOf(
                RouteSummaryRaw(
                    startLocation = "Home",
                    endLocation = "Work",
                    tripCount = 42,
                    avgEfficiencyWhKm = 148.0,
                    bestEfficiencyWhKm = 132.0,
                    worstEfficiencyWhKm = 171.0,
                ),
                RouteSummaryRaw(
                    startLocation = "Home",
                    endLocation = "Gym",
                    tripCount = 18,
                    avgEfficiencyWhKm = 198.0,
                    bestEfficiencyWhKm = 180.0,
                    worstEfficiencyWhKm = 225.0,
                ),
                RouteSummaryRaw(
                    startLocation = "Work",
                    endLocation = "Airport",
                    tripCount = 7,
                    avgEfficiencyWhKm = 252.0,
                    bestEfficiencyWhKm = 240.0,
                    worstEfficiencyWhKm = 268.0,
                ),
            ),
    )

@Preview(name = "RouteEfficiency · expanded", showBackground = true)
@Composable
private fun RouteEfficiencyExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencyRegistration.defaultSize,
        )
    }
}

@Preview(name = "RouteEfficiency · wide", showBackground = true)
@Composable
private fun RouteEfficiencyWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencySize(cols = 3, rows = 4),
        )
    }
}

@Preview(name = "RouteEfficiency · compact", showBackground = true)
@Composable
private fun RouteEfficiencyCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencySize(cols = 1, rows = 4),
        )
    }
}

@Preview(name = "RouteEfficiency · empty", showBackground = true)
@Composable
private fun RouteEfficiencyEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = RouteEfficiencySnapshot(emptyList()), fetchedAt = PREVIEW_NOW),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencyRegistration.defaultSize,
        )
    }
}

@Preview(name = "RouteEfficiency · loading", showBackground = true)
@Composable
private fun RouteEfficiencyLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Loading),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencyRegistration.defaultSize,
        )
    }
}

@Preview(name = "RouteEfficiency · error", showBackground = true)
@Composable
private fun RouteEfficiencyErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencyRegistration.defaultSize,
        )
    }
}

@Preview(name = "RouteEfficiency · offline", showBackground = true)
@Composable
private fun RouteEfficiencyOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteEfficiencyWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            prefs = UnitFormatter.default().prefs,
            size = RouteEfficiencyRegistration.defaultSize,
        )
    }
}

private const val PREVIEW_NOW: Long = 1_780_000_000_000L
