// The native Jetpack Compose + Material 3 Energy Flow Animated dashboard surface — a parity port of
// web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + lightning icon + freshness
// header) wrapping one of: the compact battery hero (battery % + per-active-state kW rows, or "Idle"),
// the animated flow diagram (Battery / Drive / Charger node circles with the count-up readouts and the
// flowing battery->drive / drive->battery / charger->battery arrows), or the "No energy data available"
// empty surface when no vehicle state has resolved. All data flows through the shared
// [EnergyFlowAnimatedWidgetViewModel]; the view never performs HTTP. Every string resolves through the
// i18n catalog, every node carries a TalkBack label, and the arrow flow honors the reduced-motion
// preference.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyFlowAnimatedWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflowanimated

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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
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

// Diagram geometry, expressed as fractions of the square diagram side (the web 100-unit viewBox / 100).
private const val NODE_RADIUS_FRACTION = 0.14f
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
 * Stateful entry point. Binds the live energy-flow feed via [source] into an
 * [EnergyFlowAnimatedWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8
 * Vehicles data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network live-state seam (a [StoreEnergyFlowAnimatedSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnergyFlowAnimatedWidget(
    source: EnergyFlowAnimatedSource,
    modifier: Modifier = Modifier,
    size: EnergyFlowAnimatedSize = EnergyFlowAnimatedRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = EnergyFlowAnimatedRegistration.ID,
) {
    val viewModel: EnergyFlowAnimatedWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { EnergyFlowAnimatedWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    EnergyFlowAnimatedWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading -> skeleton, hard error -> retry) and otherwise the title +
 * freshness header over the compact hero / animated diagram body, or the empty surface when no vehicle
 * state resolved.
 */
@Composable
fun EnergyFlowAnimatedWidgetContent(
    state: UiState<EnergyFlowAnimatedSnapshot>,
    size: EnergyFlowAnimatedSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberEnergyFlowAnimatedStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, size, strings) {
                    snapshot?.state?.let { EnergyFlowAnimatedProjection.project(it, size, strings) }
                }
            LoadedChrome(state, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<EnergyFlowAnimatedSnapshot>,
    display: EnergyFlowAnimatedDisplay?,
    onRefresh: () -> Unit,
    strings: EnergyFlowAnimatedStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh, strings = strings)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            when {
                display == null -> EnergyFlowEmpty(strings)
                display.isCompact -> CompactView(display)
                else -> EnergyFlowDiagram(display, Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<EnergyFlowAnimatedSnapshot>,
    onRefresh: () -> Unit,
    strings: EnergyFlowAnimatedStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Sm,
            tint = flowTintColor(EnergyFlowTint.Drive),
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
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

// -- Compact battery hero (web CompactView) --
@Composable
private fun CompactView(display: EnergyFlowAnimatedDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.batteryPercentText)
        display.compactRows.forEach { CompactRow(it) }
        if (display.compactIsIdle) Caption(display.idleText)
    }
}

@Composable
private fun CompactRow(row: EnergyFlowCompactRow) {
    val tint = flowTintColor(row.tint)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(glyphVector(row.glyph), contentDescription = null, size = IconSize.Xs, tint = tint)
        BodyText(row.valueText, color = tint)
    }
}

// -- Animated flow diagram (web WidgetFlowDiagram) --
@Composable
private fun EnergyFlowDiagram(
    display: EnergyFlowAnimatedDisplay,
    modifier: Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    val driveColor = flowTintColor(EnergyFlowTint.Drive)
    val regenColor = flowTintColor(EnergyFlowTint.Regen)
    val chargerColor = flowTintColor(EnergyFlowTint.Charger)
    val neutralColor = flowTintColor(EnergyFlowTint.Neutral)
    val circleFill = MaterialTheme.colorScheme.onSurface.copy(alpha = CIRCLE_FILL_ALPHA)
    val circleStroke = MaterialTheme.colorScheme.onSurface.copy(alpha = CIRCLE_STROKE_ALPHA)
    val positions = remember(display.nodes) { display.nodes.associate { it.id to it.position } }

    fun colorFor(tint: EnergyFlowTint): Color =
        when (tint) {
            EnergyFlowTint.Drive -> driveColor
            EnergyFlowTint.Regen -> regenColor
            EnergyFlowTint.Charger -> chargerColor
            EnergyFlowTint.Neutral -> neutralColor
        }

    BoxWithConstraints(modifier = modifier, contentAlignment = Alignment.Center) {
        val side = minOf(maxWidth, maxHeight)
        val sidePx = with(LocalDensity.current) { side.toPx() }
        val phase = if (reduceMotion) 0f else animatedDashPhase(DASH_CYCLE_FRACTION * sidePx)
        Box(modifier = Modifier.size(side)) {
            Canvas(modifier = Modifier.matchParentSize()) {
                val r = this.size.minDimension * NODE_RADIUS_FRACTION
                val maxMag = display.arrows.maxOf { abs(it.magnitude) }.coerceAtLeast(1.0)
                display.arrows.forEach { arrow ->
                    drawFlowArrow(
                        from = centerOf(positions.getValue(arrow.fromId), this.size),
                        to = centerOf(positions.getValue(arrow.toId), this.size),
                        radius = r,
                        arrow = arrow,
                        maxMagnitude = maxMag,
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
    nodes: List<EnergyFlowNode>,
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
    node: EnergyFlowNode,
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
            tint = MaterialTheme.colorScheme.onSurface,
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
    Subhead(ChartFormat.number(animated.value * 1.0, EnergyFlowAnimatedProjection.VALUE_PRECISION, Locale.US))
}

@Composable
private fun animatedDashPhase(cyclePx: Float): Float {
    val transition = rememberInfiniteTransition(label = "energyFlow")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = cyclePx,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = DASH_PERIOD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "energyFlow-dash",
    )
    return phase
}

@Composable
private fun EnergyFlowEmpty(strings: EnergyFlowAnimatedStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = DataDisplayGlyphs.Bolt,
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
private fun positionFraction(position: EnergyFlowPosition): Offset =
    when (position) {
        EnergyFlowPosition.Top -> Offset(0.5f, 0.2f)
        EnergyFlowPosition.Bottom -> Offset(0.5f, 0.8f)
        EnergyFlowPosition.Left -> Offset(0.22f, 0.62f)
        EnergyFlowPosition.Right -> Offset(0.78f, 0.62f)
        EnergyFlowPosition.Center -> Offset(0.5f, 0.5f)
    }

private fun centerOf(
    position: EnergyFlowPosition,
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
    arrow: EnergyFlowArrow,
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

private fun glyphVector(glyph: EnergyFlowGlyph): ImageVector =
    when (glyph) {
        EnergyFlowGlyph.Battery -> DataDisplayGlyphs.Battery
        EnergyFlowGlyph.Zap -> DataDisplayGlyphs.Bolt
        // No dedicated power-plug glyph in the shared set; BatteryCharging best approximates the web
        // Lucide `Plug` on the charger node / charging compact row.
        EnergyFlowGlyph.Plug -> DataDisplayGlyphs.BatteryCharging
    }

@Composable
private fun flowTintColor(tint: EnergyFlowTint): Color =
    when (tint) {
        // Web hue -> nearest theme-invariant chart token (the chart-token names are unrelated to the
        // flow's own semantics; only the hue matters for parity).
        EnergyFlowTint.Drive -> TeslaTokens.chart.regen // web text-cyan-400
        EnergyFlowTint.Regen -> TeslaTokens.chart.battery // web text-emerald-400
        EnergyFlowTint.Charger -> TeslaTokens.chart.energy // web text-amber-400
        EnergyFlowTint.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the localized [EnergyFlowAnimatedStrings] from the i18n catalog (P1/S10): the title, the empty
 * message, the node / compact-row labels (Battery / Drive / Regen / Charger / Idle), the header
 * refresh/refreshing/offline microcopy, and the `translation_freshness_*`-backed relative-time formatter
 * shared with the freshness chip.
 */
@Composable
private fun rememberEnergyFlowAnimatedStrings(): EnergyFlowAnimatedStrings {
    val title = stringResource(R.string.translation_widget_energyFlowAnimated_title)
    val empty = stringResource(R.string.translation_widget_energyFlowAnimated_noData)
    val battery = stringResource(R.string.translation_widget_energyFlowAnimated_battery)
    val drive = stringResource(R.string.translation_widget_energyFlowAnimated_drive)
    val regen = stringResource(R.string.translation_widget_energyFlowAnimated_regen)
    val charger = stringResource(R.string.translation_widget_energyFlowAnimated_charger)
    val idle = stringResource(R.string.translation_widget_energyFlowAnimated_idle)
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
        empty,
        battery,
        drive,
        regen,
        charger,
        idle,
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
        EnergyFlowAnimatedStrings(
            title = title,
            emptyMessage = empty,
            battery = battery,
            drive = drive,
            regen = regen,
            charger = charger,
            idle = idle,
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
