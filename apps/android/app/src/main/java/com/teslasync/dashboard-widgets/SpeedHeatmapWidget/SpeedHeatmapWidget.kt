// The native Jetpack Compose + Material 3 Speed Heatmap dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a freshness + refresh header,
// titled with a grid icon for the standard/wide footprint) wrapping the body the web renders. On the
// compact footprint (web `isCompact = size.cols <= 1`) only the centered peak-speed metric shows (web
// `'—'` when no drive resolved); on the standard/wide footprint a `{n} drives · Peak avg {x} {unit}`
// summary sits over the 7 (Mon–Sun) × 24 (0h–23h) speed grid + a Slow→Fast legend, or the friendly
// "No drive data yet" empty state. The web SVG `<rect>` grid is reproduced as a weighted Compose layout
// (so day rows + hour ticks stay aligned and respect font scaling); each cell's cool→hot fill comes from
// the pure [SpeedHeatmapProjection] colour ramp (a data-viz gradient, like CHART_COLORS). All data flows
// through the shared [SpeedHeatmapWidgetViewModel] (P1/S8); SI metres-per-second are converted to the
// user's speed unit at this render boundary via the live [UnitFormatter]. The view never performs HTTP.
// Every string resolves through the i18n catalog and the opaque grid + refresh control carry TalkBack
// labels.
//
// The Lucide `Grid3X3` glyph the web uses has no shared-set equivalent, so it is authored here as a 24×24
// stroked vector (the same approach as the sibling RecentDrivesWidget's `Route` glyph), keeping the
// iconography faithful without a feature-wide icon dependency.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SpeedHeatmapWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.speedheatmap

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId
import java.util.Locale

/** Middle dot separating the two summary clauses (web `·`). */
private const val MIDDLE_DOT = "\u00B7"

/** Faint wash for an empty (no-drive) cell / legend swatch — the theme-aware port of web `rgba(255,255,255,0.03)`. */
private const val EMPTY_CELL_ALPHA = 0.05f

/** Skeleton bars shown during the first load. */
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp

/** Gap inset painted around each grid cell so neighbouring cells read as distinct tiles. */
private val CELL_GAP = 0.5.dp

/** Corner radius for the grid cells + legend swatches (web `rounded-sm`). */
private val CELL_RADIUS = 2.dp

/** Day-label gutter width: narrow for single-letter labels, wider for the full day names (wide footprint). */
private val COMPACT_DAY_GUTTER = 16.dp
private val WIDE_DAY_GUTTER = 32.dp

/** Legend swatch dimensions (web `h-2 w-4` chips). */
private val LEGEND_SWATCH_WIDTH = 16.dp
private val LEGEND_SWATCH_HEIGHT = 8.dp

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [SpeedHeatmapWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement. [units] defaults to the app's
 * `LocalDataContainer` live formatter (web `useUnits`).
 *
 * @param source the cache-then-network seam (vehicles + drives adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SpeedHeatmapWidget(
    source: SpeedHeatmapSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: SpeedHeatmapSize = SpeedHeatmapRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SpeedHeatmapRegistration.ID,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val viewModel: SpeedHeatmapWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SpeedHeatmapWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    SpeedHeatmapWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → `QueryError` retry) and otherwise the
 * freshness header over the compact metric / heatmap body. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [prefs] supplies the SI-mps → display-unit speed conversion; [locale] drives
 * number grouping and [zone] the day/hour bucketing (tests pin deterministic values).
 */
@Composable
fun SpeedHeatmapWidgetContent(
    state: UiState<List<Drive>>,
    prefs: UnitPref,
    size: SpeedHeatmapSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberSpeedHeatmapStrings(locale)
    when {
        state.isLoading ->
            SpeedHeatmapLoading(label = stringResource(R.string.translation_a11y_loading), modifier = modifier)

        state.isError ->
            QueryError(
                kind = state.toQueryErrorKind(),
                resourceName = strings.title,
                onRetry = onRefresh,
                modifier = modifier.fillMaxSize().padding(Spacing.md),
            )

        else -> {
            val display =
                remember(state.data, prefs, strings, size, zone) {
                    SpeedHeatmapProjection.project(state.data ?: emptyList(), prefs, strings, size, zone)
                }
            SpeedHeatmapLoaded(state = state, display = display, onRefresh = onRefresh, modifier = modifier)
        }
    }
}

@Composable
private fun SpeedHeatmapLoaded(
    state: UiState<List<Drive>>,
    display: SpeedHeatmapDisplay,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        SpeedHeatmapHeader(
            display = display,
            fetchedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        SpeedHeatmapBody(display = display, modifier = Modifier.weight(1f).fillMaxWidth())
    }
}

/**
 * The freshness + refresh header — the native port of the web `WidgetShell` chrome. Shows the grid icon +
 * "Speed Heatmap" title for the standard/wide footprint; for the compact footprint only the freshness chip
 * + refresh control remain (web compact `WidgetShell` passes no title). Split out as `internal` so the
 * title + TalkBack labels are asserted in the UI test.
 */
@Composable
internal fun SpeedHeatmapHeader(
    display: SpeedHeatmapDisplay,
    fetchedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberFreshnessFormatter()
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (display.showTitle) {
            Icon(
                SpeedHeatmapGlyphs.Grid,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(display.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = fetchedAtMillis?.takeIf { it > 0 },
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

// -- Body: the compact peak metric, the heatmap grid, or the "No drive data yet" empty surface --
@Composable
private fun SpeedHeatmapBody(
    display: SpeedHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    when {
        display.isCompact -> SpeedHeatmapCompact(display = display, modifier = modifier)
        display.hasData -> SpeedHeatmapChart(display = display, modifier = modifier)
        else ->
            EmptyState(
                message = display.emptyText,
                icon = SpeedHeatmapGlyphs.Grid,
                modifier = modifier.fillMaxWidth(),
            )
    }
}

/** Compact footprint (web `isCompact`): the centered peak-speed metric, "—" when no drive resolved. */
@Composable
private fun SpeedHeatmapCompact(
    display: SpeedHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.sm),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MetricValue(display.peakValueText)
        MetricLabel(display.peakLabelText)
    }
}

/** Standard/wide footprint: the `{n} drives · Peak avg …` summary over the grid + the Slow→Fast legend. */
@Composable
private fun SpeedHeatmapChart(
    display: SpeedHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        SpeedHeatmapSummary(display)
        SpeedHeatmapGrid(display = display, modifier = Modifier.weight(1f).fillMaxWidth())
        SpeedHeatmapLegend(display)
    }
}

@Composable
private fun SpeedHeatmapSummary(display: SpeedHeatmapDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(display.drivesSummaryText)
        Caption(MIDDLE_DOT)
        Caption(display.peakSpeedSummaryText)
    }
}

/**
 * The 7×24 speed grid — the native port of the web SVG `<rect>` heatmap, laid out with weighted rows +
 * columns so the day rows and hour ticks stay aligned at any footprint. The opaque grid carries a single
 * [SpeedHeatmapDisplay.heatmapContentDescription] so TalkBack announces the surface + drive/peak summary.
 */
@Composable
private fun SpeedHeatmapGrid(
    display: SpeedHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    val gutter = if (display.isWide) WIDE_DAY_GUTTER else COMPACT_DAY_GUTTER
    Column(modifier = modifier.clearAndSetSemantics { contentDescription = display.heatmapContentDescription }) {
        HourLabelRow(hourLabels = display.hourLabels, gutter = gutter)
        for (day in 0 until ROWS) {
            Row(
                modifier = Modifier.fillMaxWidth().weight(1f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.width(gutter), contentAlignment = Alignment.CenterStart) {
                    Caption(display.dayLabels.getOrElse(day) { "" })
                }
                Row(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    for (hour in 0 until COLS) {
                        HeatCellBox(cell = display.cells[day * COLS + hour])
                    }
                }
            }
        }
    }
}

@Composable
private fun HourLabelRow(
    hourLabels: List<Int>,
    gutter: Dp,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Spacer(modifier = Modifier.width(gutter))
        Row(modifier = Modifier.weight(1f)) {
            for (hour in 0 until COLS) {
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    if (hour in hourLabels) Caption(hour.toString())
                }
            }
        }
    }
}

@Composable
private fun RowScope.HeatCellBox(cell: HeatCellView) {
    Box(
        modifier =
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(CELL_GAP)
                .background(color = heatColor(cell.paint), shape = RoundedCornerShape(CELL_RADIUS)),
    )
}

/** Slow → swatches → Fast legend (web legend row). */
@Composable
private fun SpeedHeatmapLegend(display: SpeedHeatmapDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(display.slowText)
        Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP)) {
            display.legend.forEach { paint ->
                Box(
                    modifier =
                        Modifier
                            .size(width = LEGEND_SWATCH_WIDTH, height = LEGEND_SWATCH_HEIGHT)
                            .background(color = heatColor(paint), shape = RoundedCornerShape(CELL_RADIUS)),
                )
            }
        }
        Caption(display.fastText)
    }
}

/** Resolve a [HeatPaint] to a Compose [Color]: the gradient RGB when filled, else a faint theme wash. */
@Composable
private fun heatColor(paint: HeatPaint): Color =
    if (paint.filled) {
        Color(paint.red, paint.green, paint.blue)
    } else {
        MaterialTheme.colorScheme.onSurface.copy(alpha = EMPTY_CELL_ALPHA)
    }

@Composable
private fun SpeedHeatmapLoading(
    label: String,
    modifier: Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

/**
 * Builds the localized [SpeedHeatmapStrings] from the P1/S10 i18n catalog — the nine
 * `widget.speedHeatmap.*` keys the web reads via `t(...)`, with `{{count}}` / `{{speed}} {{unit}}`
 * interpolation and a locale-aware speed formatter (web `fmtNumber(..., 0)`).
 */
@Composable
private fun rememberSpeedHeatmapStrings(locale: Locale): SpeedHeatmapStrings {
    val title = stringResource(R.string.translation_widget_speedHeatmap_title)
    val peak = stringResource(R.string.translation_widget_speedHeatmap_peak)
    val drivesTemplate = stringResource(R.string.translation_widget_speedHeatmap_drives)
    val peakSpeedTemplate = stringResource(R.string.translation_widget_speedHeatmap_peakSpeed)
    val slow = stringResource(R.string.translation_widget_speedHeatmap_slow)
    val fast = stringResource(R.string.translation_widget_speedHeatmap_fast)
    val empty = stringResource(R.string.translation_widget_speedHeatmap_empty)
    return remember(title, peak, drivesTemplate, peakSpeedTemplate, slow, fast, empty, locale) {
        SpeedHeatmapStrings(
            title = title,
            peakLabel = peak,
            slow = slow,
            fast = fast,
            empty = empty,
            drivesSummary = { count -> String.format(locale, drivesTemplate, count) },
            peakSpeedSummary = { speed, unit -> String.format(locale, peakSpeedTemplate, speed, unit) },
            formatSpeed = { value -> ChartFormat.number(value, 0, locale) },
        )
    }
}

/**
 * The `translation_freshness_*`-backed relative-time formatter for the freshness chip's TalkBack
 * description, so the header microcopy stays localized (ADR-014).
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Monochrome and recoloured at render time by the
 * [Icon] tint — the same approach as the sibling RecentDrivesWidget.
 */
private object SpeedHeatmapGlyphs {
    /** lucide `grid-3x3` — a bordered 3×3 grid (the title + empty-state icon, web `<Grid3X3 />`). */
    val Grid: ImageVector =
        ImageVector
            .Builder(
                name = "SpeedHeatmapGrid",
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
                    pathBuilder = {
                        // Outer border.
                        moveTo(3f, 3f)
                        lineTo(21f, 3f)
                        lineTo(21f, 21f)
                        lineTo(3f, 21f)
                        close()
                        // Horizontal rules.
                        moveTo(3f, 9f)
                        lineTo(21f, 9f)
                        moveTo(3f, 15f)
                        lineTo(21f, 15f)
                        // Vertical rules.
                        moveTo(9f, 3f)
                        lineTo(9f, 21f)
                        moveTo(15f, 3f)
                        lineTo(15f, 21f)
                    },
                )
            }.build()
}
