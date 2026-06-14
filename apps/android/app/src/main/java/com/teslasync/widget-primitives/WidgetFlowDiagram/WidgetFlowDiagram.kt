// The native Jetpack Compose + Material 3 WidgetFlowDiagram shared widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx. The web source is a pure presentational
// 100×100 SVG flow diagram: a set of circular nodes (each carrying an animated value + optional icon + a
// label) placed at fixed anchors (top / bottom / left / right / center), connected by directional flow arrows
// whose width scales with magnitude, whose colour follows the value's sign (or an explicit override), and
// which march with an animated dash while active. When there are no nodes it renders the shared EmptyState
// instead of a blank box. This native port keeps every one of those decisions in the framework-free
// WidgetFlowDiagramModel.kt (projection + diagnostics); the composable below is a thin render layer that
// resolves the per-theme token colours (no raw hex), places nodes with a custom [Layout], paints the arrows
// behind them via [drawBehind], animates active dashes while honouring reduced motion (P1/S9), localizes the
// empty-state + accessibility strings through the i18n catalog (P1/S10), folds each node into a single
// TalkBack readout, and fires the one-shot PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP —
// it is a presentational building block the data-bound consumer widgets (EnergyFlowWidget,
// EnergyFlowAnimatedWidget, LivePowerFlowWidget) feed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetFlowDiagram) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetflowdiagram

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Stateful entry point — the faithful port of `<WidgetFlowDiagram nodes={…} arrows={…} />`. Records the
 * one-shot PII-safe `view.opened` diagnostic, reduces [nodes] + [arrows] to a render-ready
 * [FlowDiagramProjection] (the web `nodeMap` / `visibleArrows` / `maxArrowValue` memos), and renders either the
 * empty state or the diagram. Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param nodes the diagram nodes (web `nodes`); an empty list renders the empty state.
 * @param arrows the directional flow arrows (web `arrows`).
 * @param compact denser layout — fewer arrows + abbreviated labels + smaller nodes (web `compact`).
 * @param emptyMessage the message shown when there are no nodes (web `emptyMessage`); defaults to the
 *   localized catalog string.
 * @param ariaLabel the diagram's accessible label (web `aria-label`); defaults to the localized catalog string.
 * @param nodeIcons optional per-node glyph keyed by node id — the native form of the web `FlowNode.icon`
 *   ReactNode, supplied at the render boundary.
 */
@Composable
fun WidgetFlowDiagram(
    nodes: List<FlowNode>,
    arrows: List<FlowArrow>,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    emptyMessage: String = stringResource(R.string.translation_widget_flowDiagram_noData),
    ariaLabel: String = stringResource(R.string.translation_widget_flowDiagram_aria),
    nodeIcons: Map<String, ImageVector> = emptyMap(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetFlowDiagramDiagnostics.recordViewOpened(logger) }
    val projection = remember(nodes, arrows, compact) { WidgetFlowDiagramProjection.project(nodes, arrows, compact) }
    WidgetFlowDiagramContent(
        projection = projection,
        emptyMessage = emptyMessage,
        ariaLabel = ariaLabel,
        modifier = modifier,
        nodeIcons = nodeIcons,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Draws the web `nodes.length === 0 ?
 * <EmptyState> : <svg>` gate: an empty projection renders the shared [EmptyState] with [emptyMessage]; a
 * populated one renders the flow diagram labelled by [ariaLabel] (web `role="img" aria-label`). Carries no
 * diagnostics, so a host rendering many diagrams never emits per-instance events.
 */
@Composable
fun WidgetFlowDiagramContent(
    projection: FlowDiagramProjection,
    emptyMessage: String,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    nodeIcons: Map<String, ImageVector> = emptyMap(),
) {
    if (projection.isEmpty) {
        EmptyState(message = emptyMessage, modifier = modifier)
        return
    }
    FlowDiagramCanvas(projection = projection, ariaLabel = ariaLabel, nodeIcons = nodeIcons, modifier = modifier)
}

/**
 * The diagram itself: each node is placed at its anchor by a custom [Layout], and the directional arrows are
 * painted behind the nodes via [drawBehind] so their ends tuck cleanly under the node circles. Active arrows
 * march with an animated dash (honouring [rememberReducedMotion]); inactive directions stay a solid line.
 * Stroke width scales with the flow magnitude and the colour follows the resolved tone — exactly as the web
 * `strokeForValue` / `arrowColor` do — both mapped onto per-theme design tokens (no raw hex).
 */
@Composable
private fun FlowDiagramCanvas(
    projection: FlowDiagramProjection,
    ariaLabel: String,
    nodeIcons: Map<String, ImageVector>,
    modifier: Modifier,
) {
    val reduce = rememberReducedMotion()
    val progress = flowDashProgress(reduce)

    val positive = TeslaTokens.status.success
    val negative = TeslaTokens.status.danger
    val neutral = MaterialTheme.colorScheme.onSurfaceVariant

    val density = LocalDensity.current
    val nodeRadiusPx = with(density) { (if (projection.compact) NODE_RADIUS_COMPACT else NODE_RADIUS).toPx() }
    val strokeUnitPx = with(density) { ARROW_STROKE_UNIT.toPx() }
    val dashIntervals =
        remember(density) {
            with(density) { floatArrayOf(DASH_ON.toPx(), DASH_OFF.toPx()) }
        }
    val dashPhasePx = -progress * (dashIntervals[0] + dashIntervals[1])

    fun toneColor(tone: FlowArrowTone): Color =
        when (tone) {
            FlowArrowTone.Positive -> positive
            FlowArrowTone.Negative -> negative
            FlowArrowTone.Neutral -> neutral
        }

    Layout(
        modifier =
            modifier
                .heightIn(min = DIAGRAM_MIN_HEIGHT)
                .semantics { contentDescription = ariaLabel }
                .drawBehind {
                    projection.arrows.forEach { arrow ->
                        drawFlowArrow(
                            from = anchorOffset(arrow.fromPosition, size),
                            to = anchorOffset(arrow.toPosition, size),
                            strokeScale = arrow.strokeScale,
                            color = toneColor(arrow.tone),
                            active = arrow.active,
                            strokeUnitPx = strokeUnitPx,
                            nodeRadiusPx = nodeRadiusPx,
                            dashIntervals = dashIntervals,
                            dashPhasePx = dashPhasePx,
                        )
                    }
                },
        content = {
            projection.nodes.forEach { node ->
                FlowNodeCard(
                    node = node,
                    icon = nodeIcons[node.id],
                    compact = projection.compact,
                    modifier = Modifier.layoutId(node.id),
                )
            }
        },
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val placed =
            projection.nodes.mapNotNull { node ->
                measurables
                    .firstOrNull { it.layoutId == node.id }
                    ?.let { node to it.measure(constraints.copy(minWidth = 0, minHeight = 0)) }
            }
        layout(w, h) {
            placed.forEach { (node, placeable) ->
                val center = anchorOffset(node.position, Size(w.toFloat(), h.toFloat()))
                placeable.place(
                    x = (center.x - placeable.width / 2f).roundToInt(),
                    y = (center.y - placeable.height / 2f).roundToInt(),
                )
            }
        }
    }
}

/**
 * One node: a circular badge holding the optional [icon] above the count-up value (web `foreignObject` with
 * the icon span + `AnimatedNumber`), with the label drawn above the circle, or beneath it for a `bottom` node
 * (web's `y = position === 'bottom' ? cy + r + 5 : cy - r - 2`). The whole node folds into a single TalkBack
 * readout — "{label}, {formattedValue}" — so the visible count-up and the unit-qualified value are announced
 * once, together.
 */
@Composable
private fun FlowNodeCard(
    node: ProjectedFlowNode,
    icon: ImageVector?,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    val badge = if (compact) NODE_BADGE_COMPACT else NODE_BADGE
    Column(
        modifier =
            modifier.semantics(mergeDescendants = true) {
                contentDescription = "${node.displayLabel}, ${node.formattedValue}"
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!node.labelBelow) {
            Caption(node.displayLabel)
        }
        Box(
            modifier =
                Modifier
                    .size(badge)
                    .background(MaterialTheme.colorScheme.onSurface.copy(alpha = CIRCLE_FILL_ALPHA), CircleShape)
                    .border(CIRCLE_BORDER, MaterialTheme.colorScheme.outlineVariant, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                if (icon != null) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                }
                AnimatedNumber(value = node.value, decimals = FLOW_VALUE_DECIMALS, locale = Locale.US)
            }
        }
        if (node.labelBelow) {
            Caption(node.displayLabel)
        }
    }
}

// ── arrow drawing ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Paints one flow arrow from [from] to [to], trimmed at both ends by [nodeRadiusPx] (so the line tucks under
 * the node circles), with a width of `strokeScale × strokeUnitPx` (web `strokeForValue`). Active arrows are
 * dashed and march via [dashPhasePx] (web's animated `stroke-dashoffset`); inactive directions are a solid
 * line of the same tone + width (web simply drops the `stroke-dasharray`).
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

    drawLine(
        color = color,
        start = start,
        end = end,
        strokeWidth = strokeScale * strokeUnitPx,
        cap = StrokeCap.Round,
        pathEffect = if (active) PathEffect.dashPathEffect(dashIntervals, dashPhasePx) else null,
    )
}

/** Maps a [FlowNodePosition] to a pixel center inside a canvas of [size] (web `POSITION_COORDS`). */
private fun anchorOffset(
    position: FlowNodePosition,
    size: Size,
): Offset = Offset(size.width * position.xFraction, size.height * position.yFraction)

/**
 * The marching-dash progress (0→1) for active flow arrows, mirroring the web `dashFlow` keyframe (one full
 * dash period per cycle). Returns a static `0f` under reduced motion ([rememberReducedMotion]) so the dashes
 * hold still — matching the sibling EnergyFlowWidget's reduced-motion contract.
 */
@Composable
private fun flowDashProgress(reduce: Boolean): Float {
    if (reduce) return 0f
    val transition = rememberInfiniteTransition(label = "flow-diagram")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = DASH_PERIOD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "flow-diagram-dash",
    )
    return progress
}

// ── dimensions / animation constants ──────────────────────────────────────────────────────────────────────

private val DIAGRAM_MIN_HEIGHT = 160.dp
private val NODE_BADGE = 64.dp
private val NODE_BADGE_COMPACT = 52.dp
private val CIRCLE_BORDER = 1.dp
private val NODE_RADIUS = 34.dp
private val NODE_RADIUS_COMPACT = 28.dp
private val ARROW_STROKE_UNIT = 1.2.dp
private val DASH_ON = 4.dp
private val DASH_OFF = 8.dp
private const val DASH_PERIOD_MS = 800
private const val CIRCLE_FILL_ALPHA = 0.05f

// ── Previews — empty + populated (default density) + compact + neutral/inactive arrows. ─────────────────────

private val PREVIEW_ENERGY_NODES: List<FlowNode> =
    listOf(
        FlowNode(id = "battery", label = "Battery", value = 72.0, formattedValue = "72%", position = FlowNodePosition.Left),
        FlowNode(id = "motor", label = "Motor", value = 24.6, formattedValue = "24.6 kW", position = FlowNodePosition.Right),
        FlowNode(id = "charger", label = "Charger", value = 11.0, formattedValue = "11.0 kW", position = FlowNodePosition.Top),
    )

private val PREVIEW_ENERGY_ARROWS: List<FlowArrow> =
    listOf(
        FlowArrow(from = "battery", to = "motor", value = 24.6, active = true),
        FlowArrow(from = "motor", to = "battery", value = 0.0, active = false),
        FlowArrow(from = "charger", to = "battery", value = 11.0, active = true),
    )

private val PREVIEW_ICONS: Map<String, ImageVector> =
    mapOf("battery" to TeslaGlyphs.Info, "motor" to TeslaGlyphs.Warning, "charger" to TeslaGlyphs.Check)

@Composable
private fun previewBox(
    compact: Boolean,
    dark: Boolean,
    icons: Map<String, ImageVector>,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        Box(modifier = Modifier.fillMaxSize().padding(Spacing.lg)) {
            WidgetFlowDiagramContent(
                projection = WidgetFlowDiagramProjection.project(PREVIEW_ENERGY_NODES, PREVIEW_ENERGY_ARROWS, compact),
                emptyMessage = "",
                ariaLabel = "Energy flow diagram",
                nodeIcons = icons,
            )
        }
    }
}

@Preview(name = "FlowDiagram · populated", showBackground = true, widthDp = 260, heightDp = 260)
@Composable
private fun WidgetFlowDiagramPopulatedPreview() {
    previewBox(compact = false, dark = false, icons = PREVIEW_ICONS)
}

@Preview(name = "FlowDiagram · compact", showBackground = true, widthDp = 200, heightDp = 200)
@Composable
private fun WidgetFlowDiagramCompactPreview() {
    previewBox(compact = true, dark = false, icons = emptyMap())
}

@Preview(name = "FlowDiagram · empty", showBackground = true, widthDp = 260, heightDp = 200)
@Composable
private fun WidgetFlowDiagramEmptyPreview() {
    TeslaSyncTheme {
        WidgetFlowDiagramContent(
            projection = WidgetFlowDiagramProjection.project(emptyList(), emptyList(), compact = false),
            emptyMessage = "No flow data available",
            ariaLabel = "Energy flow diagram",
        )
    }
}

@Preview(name = "FlowDiagram · dark", showBackground = true, widthDp = 260, heightDp = 260)
@Composable
private fun WidgetFlowDiagramDarkPreview() {
    previewBox(compact = false, dark = true, icons = PREVIEW_ICONS)
}
