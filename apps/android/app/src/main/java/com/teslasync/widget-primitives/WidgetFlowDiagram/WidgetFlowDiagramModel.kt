// Pure, framework-free model + projection + diagnostics for the WidgetFlowDiagram shared widget primitive —
// the native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx) before it paints. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive — a 100×100 SVG flow diagram of [nodes] (circles carrying a value +
//     optional icon + label) connected by directional [arrows] (sign-tinted, magnitude-scaled, animated when
//     active). The parent owns the nodes/arrows and passes them in as props; the component's only imports are
//     the shared AnimatedNumber + EmptyState. So there is NO data port to bind (no P1/S8 state holder, no
//     Source/ViewModel); modelling one would invent a fetch the web spec does not have (honesty covenant: no
//     scope narrowing, no silent drift). The sibling presentational ports ScoreBadge / AnimatedNumber document
//     the same rationale (composable + model, no Source). The generic data-surface states
//     (loading / error / stale / offline) belong to the CONSUMER widgets that bind data and feed this
//     primitive (EnergyFlowWidget, EnergyFlowAnimatedWidget, LivePowerFlowWidget) — they are intentionally
//     absent here because this surface fetches nothing.
//   • The web's two real, fully reproduced states are: the EMPTY branch (`nodes.length === 0` →
//     `<EmptyState message={emptyMessage} />`) and the populated DIAGRAM branch (the SVG), the latter further
//     branching on per-arrow sign/active and the `compact` density (fewer arrows, abbreviated labels, smaller
//     nodes). Each branch is reduced here and asserted in the off-device test.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): this primitive renders numbers the caller has
// ALREADY formatted — [FlowNode.value] is the raw figure the diagram animates and [FlowNode.formattedValue]
// is the caller's unit-qualified string for the accessible readout. Like the web component (which animates
// `node.value` and never converts), this projection performs no display-unit conversion; the SI→display
// boundary lives in the consumer that builds the nodes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives/WidgetFlowDiagram — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ScoreBadge / EnergyFlowWidget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetflowdiagram

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs

/** Minimum/maximum arrow stroke in web SVG units (web `MIN_STROKE` / `MAX_STROKE`). */
const val FLOW_MIN_STROKE: Float = 1f
const val FLOW_MAX_STROKE: Float = 4f

/** Node circle radius in web SVG units (web `NODE_RADIUS` / `NODE_RADIUS_COMPACT`). */
const val FLOW_NODE_RADIUS_SVG: Float = 14f
const val FLOW_NODE_RADIUS_SVG_COMPACT: Float = 10f

/** Compact mode keeps only the strongest few arrows (web `.slice(0, 3)`). */
const val FLOW_COMPACT_ARROW_LIMIT: Int = 3

/** Compact mode abbreviates long labels to their first few chars (web `label.slice(0, 3)`). */
const val FLOW_COMPACT_LABEL_LIMIT: Int = 3

/** Animated-number fraction digits inside each node (web `AnimatedNumber decimals={1}`). */
const val FLOW_VALUE_DECIMALS: Int = 1

/**
 * Where a node sits on the diagram — the native mirror of the web `FlowNode['position']` union and its
 * `POSITION_COORDS` lookup (a 100×100 viewBox). [xFraction]/[yFraction] are the web cx/cy divided by 100, so
 * the render layer multiplies them by the actual canvas size to place each node identically to the web SVG.
 *
 * @property xFraction horizontal center as a 0–1 fraction of the diagram width (web `cx / 100`).
 * @property yFraction vertical center as a 0–1 fraction of the diagram height (web `cy / 100`).
 */
enum class FlowNodePosition(
    val xFraction: Float,
    val yFraction: Float,
) {
    /** Web `top` — `{ cx: 50, cy: 12 }`. */
    Top(0.50f, 0.12f),

    /** Web `bottom` — `{ cx: 50, cy: 88 }`. */
    Bottom(0.50f, 0.88f),

    /** Web `left` — `{ cx: 12, cy: 50 }`. */
    Left(0.12f, 0.50f),

    /** Web `right` — `{ cx: 88, cy: 50 }`. */
    Right(0.88f, 0.50f),

    /** Web `center` — `{ cx: 50, cy: 50 }`. */
    Center(0.50f, 0.50f),
}

/**
 * The render tone an arrow paints with — the native mirror of the web `arrowColor` result. The render
 * boundary maps this onto a per-theme color from the P1/S9 tokens (never a raw hex), keeping it an enum so the
 * off-device test can assert the choice without a Compose host.
 *
 * Web class → token:
 *   - value > 0 `text-emerald-400` → [Positive] (`status.success`)
 *   - value < 0 `text-red-400` → [Negative] (`status.danger`)
 *   - value == 0 `text-[var(--text-muted)]` → [Neutral] (the scheme's muted on-surface color)
 *
 * The web also accepts an arbitrary per-arrow `color` override; native bounds that to this semantic set so
 * every arrow color resolves through a design token. Pass it as [FlowArrow.toneOverride].
 */
enum class FlowArrowTone {
    /** Web `value > 0` → `text-emerald-400`, `status.success`. */
    Positive,

    /** Web `value < 0` → `text-red-400`, `status.danger`. */
    Negative,

    /** Web `value == 0` → `text-[var(--text-muted)]`, the muted on-surface color. */
    Neutral,
}

/**
 * One node on the flow diagram — the native analogue of the web `FlowNode` (minus the `icon` ReactNode,
 * which is a render-layer concern supplied at the Compose boundary, exactly as the web `icon` is JSX).
 *
 * @property id stable identity an [FlowArrow] references (web `FlowNode.id`).
 * @property label the (already-localized) caption shown beside the node (web `FlowNode.label`).
 * @property value the raw figure the node animates (web `AnimatedNumber value={node.value}`).
 * @property formattedValue the caller's unit-qualified value used for the accessible readout
 *   (web `FlowNode.formattedValue`), e.g. "82%" or "12.3 kW".
 * @property position where the node sits on the diagram (web `FlowNode.position`).
 */
data class FlowNode(
    val id: String,
    val label: String,
    val value: Double,
    val formattedValue: String,
    val position: FlowNodePosition,
)

/**
 * One directional flow arrow between two nodes — the native analogue of the web `FlowArrow`.
 *
 * @property from source node id (web `FlowArrow.from`).
 * @property to destination node id (web `FlowArrow.to`).
 * @property value flow magnitude; its sign picks the default tone (web `FlowArrow.value`).
 * @property active whether energy is flowing — animated dashes when true (web `FlowArrow.active`).
 * @property toneOverride optional explicit tone, the native bound form of the web arbitrary `color` override;
 *   `null` derives the tone from [value]'s sign (web `arrowColor(value, color)`).
 */
data class FlowArrow(
    val from: String,
    val to: String,
    val value: Double,
    val active: Boolean,
    val toneOverride: FlowArrowTone? = null,
)

/**
 * A render-ready node — everything the composable needs, derived purely so every branch is covered
 * off-device. [displayLabel] already has the compact abbreviation applied, and [labelBelow] captures the web
 * rule that only a `bottom` node draws its label beneath the circle (every other position draws it above).
 *
 * @property id the source node id (used to look up an optional render-layer icon).
 * @property displayLabel the label as drawn (compact → abbreviated, web `label.slice(0, 3).toUpperCase()`).
 * @property value the figure the node animates (web `node.value`).
 * @property formattedValue the unit-qualified accessible value (web `node.formattedValue`).
 * @property position the node's anchor (web `node.position`).
 * @property labelBelow whether the label draws below the circle (web `position === 'bottom'`).
 */
data class ProjectedFlowNode(
    val id: String,
    val displayLabel: String,
    val value: Double,
    val formattedValue: String,
    val position: FlowNodePosition,
    val labelBelow: Boolean,
)

/**
 * A render-ready arrow with its endpoints already resolved to positions and its width/tone reduced — the
 * native analogue of the per-arrow `useMemo` body the web runs before drawing each `<line>`. Arrows whose
 * `from`/`to` reference an unknown node are dropped during projection (web `if (!fromNode || !toNode) return
 * null`), so every projected arrow is drawable.
 *
 * @property fromPosition resolved source anchor.
 * @property toPosition resolved destination anchor.
 * @property value the flow magnitude (kept for diagnostics/tests).
 * @property active whether the arrow animates its dashes (web `arrow.active`).
 * @property tone the resolved render tone (web `arrowColor`).
 * @property strokeScale the SVG-unit stroke width in [FLOW_MIN_STROKE]..[FLOW_MAX_STROKE] (web
 *   `strokeForValue`); the render layer scales it to dp.
 */
data class ProjectedFlowArrow(
    val fromPosition: FlowNodePosition,
    val toPosition: FlowNodePosition,
    val value: Double,
    val active: Boolean,
    val tone: FlowArrowTone,
    val strokeScale: Float,
)

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs to draw either
 * the empty state or the diagram. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property isEmpty whether the surface renders its empty state (web `nodes.length === 0`).
 * @property compact the requested density (web `compact`); the render layer picks node/label sizes from it.
 * @property nodes the render-ready nodes in source order (empty when [isEmpty]).
 * @property arrows the render-ready, endpoint-resolved arrows (compact → the strongest few).
 */
data class FlowDiagramProjection(
    val isEmpty: Boolean,
    val compact: Boolean,
    val nodes: List<ProjectedFlowNode>,
    val arrows: List<ProjectedFlowArrow>,
)

/**
 * Pure projection from raw [nodes] + [arrows] into the render-ready [FlowDiagramProjection] — the native port
 * of the `nodeMap` / `visibleArrows` / `maxArrowValue` memos plus the inline per-node/per-arrow derivations in
 * `WidgetFlowDiagram.tsx`. An empty [nodes] yields the empty-state projection (web `nodes.length === 0` gate).
 * The arrow width denominator is taken over ALL [arrows] (web `maxArrowValue`), not just the compact-visible
 * subset, so widths stay stable when toggling density.
 */
object WidgetFlowDiagramProjection {
    /** Project the raw inputs into the render-ready shape. */
    fun project(
        nodes: List<FlowNode>,
        arrows: List<FlowArrow>,
        compact: Boolean,
    ): FlowDiagramProjection {
        if (nodes.isEmpty()) {
            return FlowDiagramProjection(isEmpty = true, compact = compact, nodes = emptyList(), arrows = emptyList())
        }
        val byId = nodes.associateBy { it.id }
        val maxValue = maxArrowValue(arrows)
        val projectedArrows =
            visibleArrows(arrows, compact).mapNotNull { arrow ->
                val from = byId[arrow.from] ?: return@mapNotNull null
                val to = byId[arrow.to] ?: return@mapNotNull null
                ProjectedFlowArrow(
                    fromPosition = from.position,
                    toPosition = to.position,
                    value = arrow.value,
                    active = arrow.active,
                    tone = arrowTone(arrow.value, arrow.toneOverride),
                    strokeScale = strokeScale(arrow.value, maxValue),
                )
            }
        val projectedNodes =
            nodes.map { node ->
                ProjectedFlowNode(
                    id = node.id,
                    displayLabel = compactLabel(node.label, compact),
                    value = node.value,
                    formattedValue = node.formattedValue,
                    position = node.position,
                    labelBelow = node.position == FlowNodePosition.Bottom,
                )
            }
        return FlowDiagramProjection(isEmpty = false, compact = compact, nodes = projectedNodes, arrows = projectedArrows)
    }

    /**
     * The arrows to draw — a 1:1 port of the web `visibleArrows` memo. In compact mode the arrows are ordered
     * by descending magnitude (stable on ties) and the strongest [FLOW_COMPACT_ARROW_LIMIT] are kept; otherwise
     * every arrow is drawn in source order.
     */
    fun visibleArrows(
        arrows: List<FlowArrow>,
        compact: Boolean,
    ): List<FlowArrow> =
        if (!compact) {
            arrows
        } else {
            arrows.sortedByDescending { abs(it.value) }.take(FLOW_COMPACT_ARROW_LIMIT)
        }

    /**
     * The stroke-width denominator — a 1:1 port of the web `maxArrowValue` (`Math.max(...|value|, 1)`). Never
     * below 1 so a diagram of only zero-valued arrows still scales to the minimum stroke, and an empty arrow
     * list yields 1.
     */
    fun maxArrowValue(arrows: List<FlowArrow>): Double = (arrows.maxOfOrNull { abs(it.value) } ?: 0.0).coerceAtLeast(1.0)

    /**
     * Map a flow magnitude to an SVG-unit stroke width — a 1:1 port of the web `strokeForValue`:
     * `maxValue == 0 ? MIN : MIN + (|value| / maxValue) * (MAX - MIN)`. Because [maxArrowValue] is always ≥
     * every visible `|value|`, the result stays within [FLOW_MIN_STROKE]..[FLOW_MAX_STROKE].
     */
    fun strokeScale(
        value: Double,
        maxValue: Double,
    ): Float {
        if (maxValue == 0.0) return FLOW_MIN_STROKE
        val ratio = (abs(value) / maxValue).toFloat()
        return FLOW_MIN_STROKE + ratio * (FLOW_MAX_STROKE - FLOW_MIN_STROKE)
    }

    /**
     * Resolve an arrow's render tone — a 1:1 port of the web `arrowColor(value, override)`: an explicit
     * [override] wins, otherwise a positive value is [FlowArrowTone.Positive], a negative value
     * [FlowArrowTone.Negative], and zero [FlowArrowTone.Neutral].
     */
    fun arrowTone(
        value: Double,
        override: FlowArrowTone?,
    ): FlowArrowTone =
        override ?: when {
            value > 0.0 -> FlowArrowTone.Positive
            value < 0.0 -> FlowArrowTone.Negative
            else -> FlowArrowTone.Neutral
        }

    /**
     * The label as drawn — a 1:1 port of the web `compact && node.label.length > 3 ?
     * node.label.slice(0, 3).toUpperCase() : node.label`. Non-compact (or already-short) labels pass through
     * verbatim.
     */
    fun compactLabel(
        label: String,
        compact: Boolean,
    ): String =
        if (compact && label.length > FLOW_COMPACT_LABEL_LIMIT) {
            label.take(FLOW_COMPACT_LABEL_LIMIT).uppercase()
        } else {
            label
        }

    /** The node circle radius in SVG units for the requested density — web `compact ? 10 : 14`. */
    fun nodeRadiusSvg(compact: Boolean): Float = if (compact) FLOW_NODE_RADIUS_SVG_COMPACT else FLOW_NODE_RADIUS_SVG

    /** True when there is nothing to draw — web `nodes.length === 0` → the empty state. */
    fun isEmpty(nodes: List<FlowNode>): Boolean = nodes.isEmpty()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a node
 * value, label or flow magnitude — so a diagnostics line can never leak a vehicle's power/energy figures.
 */
object WidgetFlowDiagramDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "WidgetFlowDiagram"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
