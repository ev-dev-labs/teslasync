// The native Jetpack Compose + Material 3 Energy Flow dashboard surface — a parity port of
// web/src/features/dashboard/widgets/EnergyFlowWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, otherwise an Activity-iconed "Energy Flow" title + freshness header)
// wrapping the web `WidgetFlowDiagram`: a live power-flow diagram with a Battery node (left), a Motor node
// (right, labeled Consuming / Regenerating / Standby by the power sign) and — while charging — a Charger
// node (top), connected by directional, magnitude-scaled, animated flow arrows. When no vehicle state has
// resolved it shows a friendly empty state instead of a blank panel. All data flows through the shared
// [EnergyFlowWidgetViewModel] (P1/S8); the view never performs HTTP. Power figures are read verbatim as kW
// the way the web reads them, every string resolves through the i18n catalog (P1/S10), the flow animation
// honors reduced motion (P1/S9), and every node carries a folded TalkBack description.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyFlowWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflow

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Stateful entry point. Binds the shared vehicles + vehicle-state feeds via [source] into an
 * [EnergyFlowWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface. A
 * dashboard host supplies [source] (an adapter over the shared S8 vehicles data layer) and a unique
 * [instanceKey] per placement; an explicit [vehicleId] pins the surface to one vehicle (web
 * `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun EnergyFlowWidget(
    source: EnergyFlowSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = EnergyFlowRegistration.ID,
) {
    val viewModel: EnergyFlowWidgetViewModel =
        viewModel(key = instanceKey, factory = EnergyFlowWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    EnergyFlowWidgetContent(
        state = state,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the Activity title + freshness
 * header over the flow diagram, or the empty state. The web energy-flow widget does not pass
 * `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header freshness chip
 * (offline) + the refresh control (the retry affordance) above the empty body — never a blanked panel —
 * and a stale/offline cached state keeps its diagram visible with the freshness chip flagged.
 */
@Composable
fun EnergyFlowWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> EnergyFlowLoading(modifier)
        else -> EnergyFlowLoaded(state = state, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun EnergyFlowLoaded(
    state: UiState<VehicleStateEnvelope>,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display = remember(state.data) { EnergyFlowProjection.project(state.data?.state) }
    Column(modifier = modifier.fillMaxSize()) {
        EnergyFlowHeader(state = state, onRefresh = onRefresh)
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .heightIn(min = DIAGRAM_MIN_HEIGHT)
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            if (display.hasState) {
                EnergyFlowDiagram(display = display, modifier = Modifier.fillMaxSize())
            } else {
                EnergyFlowEmpty()
            }
        }
    }
}

@Composable
private fun EnergyFlowHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
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
            imageVector = EnergyFlowActivityGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_energyFlow),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
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

/**
 * The native flow diagram (web `WidgetFlowDiagram`): each node is placed at its anchor by a custom
 * [Layout], and the directional arrows are painted behind the nodes via [drawBehind] so their ends are
 * cleanly occluded by the node cards. Active arrows march with an animated dash + arrowhead (honoring
 * [rememberReducedMotion]); inactive directions stay a thin dim line. Stroke width scales with the flow
 * magnitude exactly as the web `strokeForValue` does.
 */
@Composable
private fun EnergyFlowDiagram(
    display: EnergyFlowDisplay,
    modifier: Modifier,
) {
    val reduce = rememberReducedMotion()
    val progress = energyFlowDashProgress(reduce)

    // Hue families resolved from design tokens (no hardcoded colors): cyan for consuming, emerald for
    // regen, amber for charging — matching the web `text-cyan-400` / `text-emerald-400` / `text-amber-400`.
    val cyan = TeslaTokens.chart.regen
    val emerald = TeslaTokens.chart.battery
    val amber = TeslaTokens.chart.energy
    val inactiveColor = MaterialTheme.colorScheme.outlineVariant

    val maxValue = remember(display.arrows) { EnergyFlowProjection.maxArrowValue(display.arrows) }
    val anchorById = remember(display.nodes) { display.nodes.associate { it.node to it.anchor } }

    val density = LocalDensity.current
    val nodeRadiusPx = with(density) { NODE_RADIUS.toPx() }
    val strokeUnitPx = with(density) { ARROW_STROKE_UNIT.toPx() }
    val dashIntervals =
        remember(density) {
            with(density) { floatArrayOf(DASH_ON.toPx(), DASH_OFF.toPx()) }
        }
    val dashPhasePx = -progress * (dashIntervals[0] + dashIntervals[1])

    fun hueColor(hue: EnergyFlowHue): Color =
        when (hue) {
            EnergyFlowHue.Cyan -> cyan
            EnergyFlowHue.Emerald -> emerald
            EnergyFlowHue.Amber -> amber
        }

    Layout(
        modifier =
            modifier.drawBehind {
                display.arrows.forEach { arrow ->
                    val from = anchorById[arrow.from]?.let { anchorOffset(it, size) } ?: return@forEach
                    val to = anchorById[arrow.to]?.let { anchorOffset(it, size) } ?: return@forEach
                    drawFlowArrow(
                        from = from,
                        to = to,
                        strokeScale = EnergyFlowProjection.strokeScale(arrow.value, maxValue),
                        color = if (arrow.active) hueColor(arrow.hue) else inactiveColor,
                        active = arrow.active,
                        strokeUnitPx = strokeUnitPx,
                        nodeRadiusPx = nodeRadiusPx,
                        dashIntervals = dashIntervals,
                        dashPhasePx = dashPhasePx,
                    )
                }
            },
        content = {
            display.nodes.forEach { node ->
                EnergyFlowNodeCard(
                    node = node,
                    tint = nodeTint(node.node, emerald = emerald, purple = TeslaTokens.chart.power, amber = amber),
                    modifier = Modifier.layoutId(node.node),
                )
            }
        },
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val placed =
            display.nodes.mapNotNull { node ->
                measurables
                    .firstOrNull { it.layoutId == node.node }
                    ?.let { node to it.measure(constraints.copy(minWidth = 0, minHeight = 0)) }
            }
        layout(w, h) {
            placed.forEach { (node, placeable) ->
                val center = anchorOffset(node.anchor, Size(w.toFloat(), h.toFloat()))
                placeable.place(
                    x = (center.x - placeable.width / 2f).roundToInt(),
                    y = (center.y - placeable.height / 2f).roundToInt(),
                )
            }
        }
    }
}

@Composable
private fun EnergyFlowNodeCard(
    node: EnergyFlowNodeModel,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    val label = labelText(node.label)
    Column(
        modifier =
            modifier
                .widthIn(min = NODE_MIN_WIDTH)
                .clip(RoundedCornerShape(Radius.lg))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = NODE_BG_ALPHA))
                .border(
                    width = NODE_BORDER,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    shape = RoundedCornerShape(Radius.lg),
                ).padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) { contentDescription = "$label, ${node.formattedValue}" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(
            modifier =
                Modifier
                    .size(NODE_ICON_BADGE)
                    .clip(CircleShape)
                    .background(tint.copy(alpha = ICON_WASH_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(imageVector = nodeGlyph(node.node), contentDescription = null, size = IconSize.Sm, tint = tint)
        }
        // Visible count-up mirrors the web `WidgetFlowDiagram` (`AnimatedNumber value={node.value}
        // decimals={1}`); the unit-qualified value lives in the node's TalkBack description above.
        AnimatedNumber(value = node.value, decimals = EnergyFlowProjection.POWER_PRECISION, locale = Locale.US)
        Caption(label)
    }
}

@Composable
private fun EnergyFlowEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noEnergyData),
        icon = EnergyFlowActivityGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun EnergyFlowLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT, rounded = true)
        Skeleton(modifier = Modifier.weight(1f), height = DIAGRAM_MIN_HEIGHT, rounded = true)
    }
}

// ── arrow drawing ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Paints one flow arrow from [from] to [to], trimmed at both ends by [nodeRadiusPx] (so the line tucks
 * under the node cards), with a width of `strokeScale × strokeUnitPx` (web `strokeForValue`). Active
 * arrows are dashed + animated via [dashPhasePx] and capped with an arrowhead; inactive directions are a
 * thin dim solid line.
 */
@Suppress("LongParameterList")
private fun DrawScope.drawFlowArrow(
    from: Offset,
    to: Offset,
    strokeScale: Float,
    color: Color,
    active: Boolean,
    strokeUnitPx: Float,
    nodeRadiusPx: Float,
    dashIntervals: FloatArray,
    dashPhasePx: Float,
) {
    val dir = to - from
    val dist = dir.getDistance()
    if (dist <= 1f) return
    val unit = Offset(dir.x / dist, dir.y / dist)
    val start = from + unit * nodeRadiusPx
    val end = to - unit * nodeRadiusPx
    if ((end - start).getDistance() <= 1f) return

    val strokeWidth = strokeScale * strokeUnitPx
    val effect = if (active) PathEffect.dashPathEffect(dashIntervals, dashPhasePx) else null
    drawLine(
        color = color,
        start = start,
        end = end,
        strokeWidth = strokeWidth,
        cap = StrokeCap.Round,
        pathEffect = effect,
        alpha = if (active) 1f else INACTIVE_ALPHA,
    )
    if (active) drawArrowHead(tip = end, unit = unit, color = color, strokeWidth = strokeWidth)
}

private fun DrawScope.drawArrowHead(
    tip: Offset,
    unit: Offset,
    color: Color,
    strokeWidth: Float,
) {
    val headLen = strokeWidth * ARROW_HEAD_LENGTH_FACTOR
    val perp = Offset(-unit.y, unit.x)
    val base = tip - unit * headLen
    val wing = headLen * ARROW_HEAD_WING_RATIO
    drawLine(color = color, start = tip, end = base + perp * wing, strokeWidth = strokeWidth, cap = StrokeCap.Round)
    drawLine(color = color, start = tip, end = base - perp * wing, strokeWidth = strokeWidth, cap = StrokeCap.Round)
}

/** Maps an [EnergyFlowAnchor] to a pixel center inside a canvas of [size] (web `POSITION_COORDS`). */
private fun anchorOffset(
    anchor: EnergyFlowAnchor,
    size: Size,
): Offset =
    when (anchor) {
        EnergyFlowAnchor.Left -> Offset(size.width * ANCHOR_SIDE_FRACTION, size.height * ANCHOR_MID_FRACTION)
        EnergyFlowAnchor.Right -> Offset(size.width * (1f - ANCHOR_SIDE_FRACTION), size.height * ANCHOR_MID_FRACTION)
        EnergyFlowAnchor.Top -> Offset(size.width * HALF, size.height * ANCHOR_TOP_FRACTION)
    }

// ── render-boundary mappers (model enum → glyph / tint / localized label) ───────────────────────────────

private fun nodeGlyph(node: EnergyFlowNode): ImageVector =
    when (node) {
        // Web BatteryCharging / Zap; the shared data-display set ships both (Zap → Bolt). The Charger's
        // web Lucide `Plug` has no shared equivalent, so it is hand-authored below.
        EnergyFlowNode.Battery -> DataDisplayGlyphs.BatteryCharging
        EnergyFlowNode.Motor -> DataDisplayGlyphs.Bolt
        EnergyFlowNode.Charger -> EnergyFlowPlugGlyph
    }

private fun nodeTint(
    node: EnergyFlowNode,
    emerald: Color,
    purple: Color,
    amber: Color,
): Color =
    when (node) {
        EnergyFlowNode.Battery -> emerald
        EnergyFlowNode.Motor -> purple
        EnergyFlowNode.Charger -> amber
    }

@Composable
private fun labelText(label: EnergyFlowLabel): String =
    stringResource(
        when (label) {
            EnergyFlowLabel.Battery -> R.string.translation_widget_battery
            EnergyFlowLabel.Consuming -> R.string.translation_widget_consuming
            EnergyFlowLabel.Regenerating -> R.string.translation_widget_regenerating
            EnergyFlowLabel.Standby -> R.string.translation_widget_standby
            EnergyFlowLabel.Charger -> R.string.translation_widget_charger
        },
    )

/**
 * The marching-dash progress (0→1) for active flow arrows, mirroring the web `dashFlow` keyframe. Returns
 * a static `0f` under reduced motion ([rememberReducedMotion]) so the arrowhead still conveys direction
 * with no animation — the same pattern the sibling BatteryRadialGauge's charging pulse uses.
 */
@Composable
private fun energyFlowDashProgress(reduce: Boolean): Float {
    if (reduce) return 0f
    val transition = rememberInfiniteTransition(label = "energy-flow")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = DASH_PERIOD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "energy-flow-dash",
    )
    return progress
}

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

// ── Local glyph — the web `Plug` (lucide), authored as a 24×24 stroked vector. The data-display layer
// ships no plug glyph and this surface's allowed files cannot extend that catalog, so the charger icon is
// hand-authored here, mirroring how the sibling ClimateStatusWidget hand-authors its thermometer. ─────────

private fun energyFlowStroked(
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

/** Web lucide `Activity` — the ECG/pulse line used as the widget title icon. */
private val EnergyFlowActivityGlyph: ImageVector =
    energyFlowStroked("EnergyFlowActivity") {
        moveTo(3f, 12f)
        lineTo(7f, 12f)
        lineTo(10f, 4f)
        lineTo(14f, 20f)
        lineTo(17f, 12f)
        lineTo(21f, 12f)
    }

/** Web lucide `Plug` — the two-prong charger plug used for the Charger node. */
private val EnergyFlowPlugGlyph: ImageVector =
    energyFlowStroked("EnergyFlowPlug") {
        // Two prongs.
        moveTo(9f, 3f)
        lineTo(9f, 8f)
        moveTo(15f, 3f)
        lineTo(15f, 8f)
        // Plug body.
        moveTo(6f, 8f)
        lineTo(18f, 8f)
        lineTo(18f, 11f)
        curveTo(18f, 14.3f, 15.3f, 17f, 12f, 17f)
        curveTo(8.7f, 17f, 6f, 14.3f, 6f, 11f)
        close()
        // Lead to the vehicle.
        moveTo(12f, 17f)
        lineTo(12f, 21f)
    }

// ── dimensions / animation constants ────────────────────────────────────────────────────────────────────

private val DIAGRAM_MIN_HEIGHT = 160.dp
private val NODE_MIN_WIDTH = 64.dp
private val NODE_ICON_BADGE = 34.dp
private val NODE_BORDER = 1.dp
private val NODE_RADIUS = 28.dp
private val ARROW_STROKE_UNIT = 1.3.dp
private val DASH_ON = 5.dp
private val DASH_OFF = 7.dp
private val LOADING_TITLE_HEIGHT = 12.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val DASH_PERIOD_MS = 800
private const val INACTIVE_ALPHA = 0.4f
private const val NODE_BG_ALPHA = 0.55f
private const val ICON_WASH_ALPHA = 0.14f
private const val ARROW_HEAD_LENGTH_FACTOR = 2.6f
private const val ARROW_HEAD_WING_RATIO = 0.6f
private const val ANCHOR_SIDE_FRACTION = 0.2f
private const val ANCHOR_MID_FRACTION = 0.46f
private const val ANCHOR_TOP_FRACTION = 0.17f
private const val HALF = 0.5f

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Previews — one per rendered state (consuming / charging / empty / loading / error / offline). ────────

private fun previewState(
    power: Double = 0.0,
    isCharging: Boolean = false,
    chargerPower: Double = 0.0,
    batteryLevel: Long = 72,
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = 0.0,
        chargerPower = chargerPower,
        idealRange = 300_000.0,
        insideTemp = 21.0,
        isCharging = isCharging,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 10.0,
        power = power,
        ratedRange = 300_000.0,
        sentryMode = false,
        softwareVersion = "2026.4",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )

private fun previewEnvelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = state != null)

@Preview(name = "EnergyFlow · consuming", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowConsumingPreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewEnvelope(previewState(power = 24.6, batteryLevel = 72)),
                    fetchedAt = System.currentTimeMillis(),
                ),
        )
    }
}

@Preview(name = "EnergyFlow · charging", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowChargingPreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewEnvelope(previewState(power = -6.0, isCharging = true, chargerPower = 11.0, batteryLevel = 64)),
                    fetchedAt = System.currentTimeMillis(),
                ),
        )
    }
}

@Preview(name = "EnergyFlow · empty", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowEmptyPreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = previewEnvelope(null), fetchedAt = System.currentTimeMillis()),
        )
    }
}

@Preview(name = "EnergyFlow · loading", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowLoadingPreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(state = UiState.loading())
    }
}

@Preview(name = "EnergyFlow · error", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowErrorPreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = previewEnvelope(null), errorKind = ErrorKind.Network),
        )
    }
}

@Preview(name = "EnergyFlow · offline (cached)", showBackground = true, widthDp = 240, heightDp = 320)
@Composable
private fun EnergyFlowOfflinePreview() {
    TeslaSyncTheme {
        EnergyFlowWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewEnvelope(previewState(power = 18.0, batteryLevel = 58)),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
        )
    }
}
