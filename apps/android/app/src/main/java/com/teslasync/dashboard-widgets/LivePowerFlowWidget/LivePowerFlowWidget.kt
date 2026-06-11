// The native Jetpack Compose + Material 3 Live Power Flow dashboard surface — a parity port of
// web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of: the
// real-time power-routing diagram (Solar / Grid / Home / Battery node circles with count-up kW readouts
// and the flowing solar→home / solar→battery / battery→home / grid→home / home→grid / grid→battery
// arrows), the "No live power data" empty state when a site is linked but no live body resolved, or the
// title-less "No Tesla Energy site linked" surface when no Tesla Energy site is linked. All data flows
// through the shared [LivePowerFlowWidgetViewModel]; the view never performs HTTP. Every string resolves
// through the i18n catalog, every node carries a TalkBack label, and the arrow flow honors the
// reduced-motion preference.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LivePowerFlowWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livepowerflow

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

private const val LOADING_BAR_COUNT = 3
private const val COMPACT_MAX_ARROWS = 3

// Diagram geometry, expressed as fractions of the square diagram side (the web 100-unit viewBox / 100).
private const val NODE_RADIUS_FRACTION = 0.14f
private const val NODE_RADIUS_FRACTION_COMPACT = 0.10f
private const val CIRCLE_FILL_ALPHA = 0.05f
private const val CIRCLE_STROKE_ALPHA = 0.20f
private const val CIRCLE_STROKE_FRACTION = 0.006f
private const val MIN_STROKE_FRACTION = 0.012f
private const val MAX_STROKE_FRACTION = 0.045f
private const val DASH_ON_FRACTION = 0.04f
private const val DASH_OFF_FRACTION = 0.08f
private const val DASH_CYCLE_FRACTION = 0.12f
private const val DASH_PERIOD_MS = 800

/**
 * Stateful entry point. Binds the live power-flow feeds via [source] into a
 * [LivePowerFlowWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8 Energy data
 * layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (energy-sites + live-status adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LivePowerFlowWidget(
    source: LivePowerFlowSource,
    modifier: Modifier = Modifier,
    size: LivePowerFlowSize = LivePowerFlowRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LivePowerFlowRegistration.ID,
) {
    val viewModel: LivePowerFlowWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LivePowerFlowWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    LivePowerFlowWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header over the power-routing diagram, the "No live power data" empty state, or the title-less
 * "No Tesla Energy site linked" surface.
 */
@Composable
fun LivePowerFlowWidgetContent(
    state: UiState<LivePowerFlowSnapshot>,
    size: LivePowerFlowSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberLivePowerFlowStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val snapshot = state.data ?: LivePowerFlowSnapshot.EMPTY
            val display =
                remember(snapshot, size, strings) {
                    LivePowerFlowProjection.project(snapshot, size, strings)
                }
            LoadedChrome(state, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<LivePowerFlowSnapshot>,
    display: LivePowerFlowDisplay,
    onRefresh: () -> Unit,
    strings: LivePowerFlowStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        // Web omits the shell title in the no-site branch; a linked-site surface shows it.
        WidgetHeader(
            title = if (display.hasSites) display.title else null,
            state = state,
            onRefresh = onRefresh,
            strings = strings,
        )
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            when {
                !display.hasSites -> PowerFlowEmpty(display.noSiteMessage, PowerFlowGlyph.Home)
                !display.hasData -> PowerFlowEmpty(display.noDataMessage, PowerFlowGlyph.Solar)
                else -> PowerFlowDiagram(display, Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    title: String?,
    state: UiState<LivePowerFlowSnapshot>,
    onRefresh: () -> Unit,
    strings: LivePowerFlowStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Real-time power-routing diagram (web WidgetFlowDiagram) --
@Composable
private fun PowerFlowDiagram(
    display: LivePowerFlowDisplay,
    modifier: Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    val solarColor = flowTintColor(PowerFlowTint.Solar)
    val gridColor = flowTintColor(PowerFlowTint.Grid)
    val homeColor = flowTintColor(PowerFlowTint.Home)
    val batteryColor = flowTintColor(PowerFlowTint.Battery)
    val neutralColor = flowTintColor(PowerFlowTint.Neutral)
    val circleFill = MaterialTheme.colorScheme.onSurface.copy(alpha = CIRCLE_FILL_ALPHA)
    val circleStroke = MaterialTheme.colorScheme.onSurface.copy(alpha = CIRCLE_STROKE_ALPHA)
    val positions = remember(display.nodes) { display.nodes.associate { it.id to it.position } }
    val radiusFraction = if (display.isCompact) NODE_RADIUS_FRACTION_COMPACT else NODE_RADIUS_FRACTION

    fun colorFor(tint: PowerFlowTint): Color =
        when (tint) {
            PowerFlowTint.Solar -> solarColor
            PowerFlowTint.Grid -> gridColor
            PowerFlowTint.Home -> homeColor
            PowerFlowTint.Battery -> batteryColor
            PowerFlowTint.Neutral -> neutralColor
        }

    val visibleArrows =
        remember(display.arrows, display.isCompact) {
            if (display.isCompact) {
                display.arrows.sortedByDescending { abs(it.magnitude) }.take(COMPACT_MAX_ARROWS)
            } else {
                display.arrows
            }
        }
    val maxMagnitude = display.arrows.maxOfOrNull { abs(it.magnitude) }?.coerceAtLeast(1.0) ?: 1.0

    BoxWithConstraints(modifier = modifier, contentAlignment = Alignment.Center) {
        val side = minOf(maxWidth, maxHeight)
        val sidePx = with(LocalDensity.current) { side.toPx() }
        val phase = if (reduceMotion) 0f else animatedDashPhase(DASH_CYCLE_FRACTION * sidePx)
        Box(modifier = Modifier.size(side)) {
            Canvas(modifier = Modifier.matchParentSize()) {
                val r = this.size.minDimension * radiusFraction
                visibleArrows.forEach { arrow ->
                    drawFlowArrow(
                        from = centerOf(positions.getValue(arrow.fromId), this.size),
                        to = centerOf(positions.getValue(arrow.toId), this.size),
                        radius = r,
                        arrow = arrow,
                        maxMagnitude = maxMagnitude,
                        color = colorFor(arrow.tint),
                        phase = phase,
                    )
                }
                display.nodes.forEach { node ->
                    val center = centerOf(node.position, this.size)
                    drawCircle(circleFill, radius = r, center = center)
                    drawCircle(circleStroke, radius = r, center = center, style = Stroke(width = CIRCLE_STROKE_FRACTION * this.size.width))
                }
            }
            NodeOverlay(display.nodes, reduceMotion, Modifier.matchParentSize())
        }
    }
}

@Composable
private fun NodeOverlay(
    nodes: List<PowerFlowNode>,
    reduceMotion: Boolean,
    modifier: Modifier,
) {
    Layout(
        modifier = modifier,
        content = { nodes.forEach { NodeBadge(it, reduceMotion) } },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val placeables = measurables.map { it.measure(loose) }
        layout(constraints.maxWidth, constraints.maxHeight) {
            placeables.forEachIndexed { index, placeable ->
                val fraction = positionFraction(nodes[index].position)
                val cx = (fraction.x * constraints.maxWidth).roundToInt()
                val cy = (fraction.y * constraints.maxHeight).roundToInt()
                placeable.place(x = cx - placeable.width / 2, y = cy - placeable.height / 2)
            }
        }
    }
}

@Composable
private fun NodeBadge(
    node: PowerFlowNode,
    reduceMotion: Boolean,
) {
    Column(
        modifier = Modifier.clearAndSetSemantics { contentDescription = node.contentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            glyphVector(node.glyph),
            contentDescription = null,
            size = IconSize.Xs,
            tint = flowTintColor(glyphTint(node.glyph)),
        )
        NodeValue(node.value, reduceMotion)
        MetricLabel(node.label)
    }
}

@Composable
private fun NodeValue(
    value: Double,
    reduceMotion: Boolean,
) {
    val target = value.toFloat()
    val animated = remember { Animatable(if (reduceMotion) target else 0f) }
    LaunchedEffect(target, reduceMotion) {
        if (reduceMotion) {
            animated.snapTo(target)
        } else {
            animated.animateTo(target, animationSpec = tween(MotionDurations.slow, easing = FastOutSlowInEasing))
        }
    }
    Subhead(ChartFormat.number(animated.value * 1.0, LivePowerFlowProjection.VALUE_PRECISION, Locale.US))
}

@Composable
private fun animatedDashPhase(cyclePx: Float): Float {
    val transition = rememberInfiniteTransition(label = "livePowerFlow")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = cyclePx,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = DASH_PERIOD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "livePowerFlow-dash",
    )
    return phase
}

@Composable
private fun PowerFlowEmpty(
    message: String,
    glyph: PowerFlowGlyph,
) {
    EmptyState(
        message = message,
        icon = glyphVector(glyph),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/** Fractional center (0..1 of the square side) for each anchor — the native analogue of POSITION_COORDS. */
private fun positionFraction(position: PowerFlowPosition): Offset =
    when (position) {
        PowerFlowPosition.Top -> Offset(0.5f, 0.18f)
        PowerFlowPosition.Bottom -> Offset(0.5f, 0.82f)
        PowerFlowPosition.Left -> Offset(0.18f, 0.5f)
        PowerFlowPosition.Right -> Offset(0.82f, 0.5f)
        PowerFlowPosition.Center -> Offset(0.5f, 0.5f)
    }

private fun centerOf(
    position: PowerFlowPosition,
    size: Size,
): Offset {
    val fraction = positionFraction(position)
    return Offset(fraction.x * size.width, fraction.y * size.height)
}

@Suppress("LongParameterList")
private fun DrawScope.drawFlowArrow(
    from: Offset,
    to: Offset,
    radius: Float,
    arrow: PowerFlowArrow,
    maxMagnitude: Double,
    color: Color,
    phase: Float,
) {
    val delta = to - from
    val distance = delta.getDistance().coerceAtLeast(1f)
    val unit = delta / distance
    val start = from + unit * radius
    val end = to - unit * radius
    val ratio = (abs(arrow.magnitude) / maxMagnitude).toFloat().coerceIn(0f, 1f)
    val strokeWidth = lerp(MIN_STROKE_FRACTION * size.width, MAX_STROKE_FRACTION * size.width, ratio)
    val effect =
        if (arrow.active) {
            PathEffect.dashPathEffect(floatArrayOf(DASH_ON_FRACTION * size.width, DASH_OFF_FRACTION * size.width), -phase)
        } else {
            null
        }
    drawLine(
        color = color,
        start = start,
        end = end,
        strokeWidth = strokeWidth,
        cap = StrokeCap.Round,
        pathEffect = effect,
    )
}

/** The semantic tint of a node's glyph — its own hue (web colors each icon distinctly). */
private fun glyphTint(glyph: PowerFlowGlyph): PowerFlowTint =
    when (glyph) {
        PowerFlowGlyph.Solar -> PowerFlowTint.Solar
        PowerFlowGlyph.Grid -> PowerFlowTint.Grid
        PowerFlowGlyph.Home -> PowerFlowTint.Home
        PowerFlowGlyph.Battery -> PowerFlowTint.Battery
    }

private fun glyphVector(glyph: PowerFlowGlyph): ImageVector =
    when (glyph) {
        PowerFlowGlyph.Solar -> SunGlyph
        // Web uses Lucide `Zap` for the grid node; the shared Bolt glyph is its direct analogue.
        PowerFlowGlyph.Grid -> DataDisplayGlyphs.Bolt
        PowerFlowGlyph.Home -> HomeGlyph
        PowerFlowGlyph.Battery -> DataDisplayGlyphs.Battery
    }

@Composable
private fun flowTintColor(tint: PowerFlowTint): Color =
    when (tint) {
        // Web hue → nearest theme-invariant chart token (only the hue matters for parity).
        PowerFlowTint.Solar -> TeslaTokens.chart.energy // web text-yellow-400 (amber)
        PowerFlowTint.Grid -> TeslaTokens.chart.speed // web text-blue-400
        PowerFlowTint.Home -> TeslaTokens.chart.battery // web text-emerald-400
        PowerFlowTint.Battery -> TeslaTokens.chart.power // web text-purple-400
        PowerFlowTint.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the localized [LivePowerFlowStrings] from the i18n catalog (P1/S10): the title, the two empty
 * messages, the four node labels (Solar / Grid / Home / Battery), the header refresh/refreshing/offline
 * microcopy, and the `translation_freshness_*`-backed relative-time formatter shared with the freshness
 * chip.
 */
@Composable
private fun rememberLivePowerFlowStrings(): LivePowerFlowStrings {
    val title = stringResource(R.string.translation_widget_livePowerFlow_title)
    val noSite = stringResource(R.string.translation_widget_livePowerFlow_noSite)
    val noData = stringResource(R.string.translation_widget_livePowerFlow_noData)
    val solar = stringResource(R.string.translation_widget_livePowerFlow_solar)
    val grid = stringResource(R.string.translation_widget_livePowerFlow_grid)
    val home = stringResource(R.string.translation_widget_livePowerFlow_home)
    val battery = stringResource(R.string.translation_widget_livePowerFlow_battery)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        noSite,
        noData,
        solar,
        grid,
        home,
        battery,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        LivePowerFlowStrings(
            title = title,
            noSite = noSite,
            noData = noData,
            solar = solar,
            grid = grid,
            home = home,
            battery = battery,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> "\u2014"
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

// ── Locally-authored glyphs ──────────────────────────────────────────────────
// The shared DataDisplayGlyphs set has no Sun or Home icon and is out of scope to modify (it belongs to
// the P3 component-library bundle). These two stroked 24×24 vectors mirror the web Lucide `Sun` / `Home`
// for the Solar / Home nodes, authored the same way the shared set authors its glyphs.

private val SunGlyph: ImageVector =
    powerFlowGlyph("Sun") {
        circle(12f, 12f, 4f)
        moveTo(12f, 2f)
        lineTo(12f, 4f)
        moveTo(12f, 20f)
        lineTo(12f, 22f)
        moveTo(2f, 12f)
        lineTo(4f, 12f)
        moveTo(20f, 12f)
        lineTo(22f, 12f)
        moveTo(5f, 5f)
        lineTo(6.4f, 6.4f)
        moveTo(17.6f, 17.6f)
        lineTo(19f, 19f)
        moveTo(19f, 5f)
        lineTo(17.6f, 6.4f)
        moveTo(6.4f, 17.6f)
        lineTo(5f, 19f)
    }

private val HomeGlyph: ImageVector =
    powerFlowGlyph("Home") {
        moveTo(3f, 11f)
        lineTo(12f, 4f)
        lineTo(21f, 11f)
        moveTo(5f, 9.5f)
        lineTo(5f, 20f)
        lineTo(19f, 20f)
        lineTo(19f, 9.5f)
    }

private fun powerFlowGlyph(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
