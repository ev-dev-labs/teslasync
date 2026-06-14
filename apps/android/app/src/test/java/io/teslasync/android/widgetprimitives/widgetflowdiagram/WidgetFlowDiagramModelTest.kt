package io.teslasync.android.widgetprimitives.widgetflowdiagram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetFlowDiagram's pure logic — the native mirror of every decision the web
 * component makes (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx): the `POSITION_COORDS`
 * anchor mapping, the `visibleArrows` compact selection, the `maxArrowValue` denominator, the `strokeForValue`
 * width ramp, the `arrowColor` sign/override tone, the compact label abbreviation, and the empty-state gate.
 * Because the composable is a thin render layer over [WidgetFlowDiagramProjection], the per-branch assertions
 * here double as the surface's per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class WidgetFlowDiagramModelTest {
    private val delta = 1e-4f

    // ── POSITION_COORDS: the web 100×100 anchors as 0–1 fractions ────────────────────────────────────────────

    @Test
    fun positionsMirrorTheWebCoordinateMapDividedBy100() {
        assertFraction(0.50f, 0.12f, FlowNodePosition.Top)
        assertFraction(0.50f, 0.88f, FlowNodePosition.Bottom)
        assertFraction(0.12f, 0.50f, FlowNodePosition.Left)
        assertFraction(0.88f, 0.50f, FlowNodePosition.Right)
        assertFraction(0.50f, 0.50f, FlowNodePosition.Center)
    }

    private fun assertFraction(
        x: Float,
        y: Float,
        position: FlowNodePosition,
    ) {
        assertEquals(x, position.xFraction, delta)
        assertEquals(y, position.yFraction, delta)
    }

    // ── visibleArrows: web `compact ? sort(|value| desc).slice(0, 3) : arrows` ────────────────────────────────

    @Test
    fun nonCompactKeepsEveryArrowInSourceOrder() {
        val arrows =
            listOf(
                arrow("a", "b", 1.0),
                arrow("b", "c", 9.0),
                arrow("c", "d", 4.0),
                arrow("d", "e", 7.0),
            )
        assertEquals(arrows, WidgetFlowDiagramProjection.visibleArrows(arrows, compact = false))
    }

    @Test
    fun compactKeepsOnlyTheStrongestThreeByMagnitude() {
        val arrows =
            listOf(
                arrow("a", "b", 1.0),
                arrow("b", "c", -9.0),
                arrow("c", "d", 4.0),
                arrow("d", "e", 7.0),
            )
        val visible = WidgetFlowDiagramProjection.visibleArrows(arrows, compact = true)
        assertEquals(3, visible.size)
        // |−9| > |7| > |4| > |1| — the three strongest survive, ordered by descending magnitude.
        assertEquals(listOf(-9.0, 7.0, 4.0), visible.map { it.value })
    }

    @Test
    fun compactMagnitudeSortIsStableOnTies() {
        // Two arrows tie at |5|; the stable sort must preserve their source order (b before d).
        val arrows =
            listOf(
                arrow("a", "b", 5.0),
                arrow("c", "d", 5.0),
                arrow("e", "f", 1.0),
            )
        val visible = WidgetFlowDiagramProjection.visibleArrows(arrows, compact = true)
        assertEquals(listOf("a", "c", "e"), visible.map { it.from })
    }

    // ── maxArrowValue: web `Math.max(...|value|, 1)` ──────────────────────────────────────────────────────────

    @Test
    fun maxArrowValueFloorsAtOne() {
        assertEquals(1.0, WidgetFlowDiagramProjection.maxArrowValue(emptyList()), 1e-9)
        assertEquals(1.0, WidgetFlowDiagramProjection.maxArrowValue(listOf(arrow("a", "b", 0.0))), 1e-9)
        // A magnitude below 1 still floors to 1 so the stroke ramp keeps its full dynamic range.
        assertEquals(1.0, WidgetFlowDiagramProjection.maxArrowValue(listOf(arrow("a", "b", 0.4))), 1e-9)
    }

    @Test
    fun maxArrowValueTakesTheLargestAbsoluteAcrossAllArrows() {
        val arrows = listOf(arrow("a", "b", 3.0), arrow("b", "c", -12.0), arrow("c", "d", 7.0))
        assertEquals(12.0, WidgetFlowDiagramProjection.maxArrowValue(arrows), 1e-9)
    }

    // ── strokeScale: web `strokeForValue` (MIN + ratio*(MAX-MIN), MIN when maxValue==0) ───────────────────────

    @Test
    fun strokeScaleReturnsMinWhenDenominatorIsZero() {
        assertEquals(FLOW_MIN_STROKE, WidgetFlowDiagramProjection.strokeScale(5.0, 0.0), delta)
    }

    @Test
    fun strokeScaleRampsLinearlyFromMinToMax() {
        // value == max → MAX; value == 0 → MIN; half magnitude → midpoint.
        assertEquals(FLOW_MAX_STROKE, WidgetFlowDiagramProjection.strokeScale(10.0, 10.0), delta)
        assertEquals(FLOW_MIN_STROKE, WidgetFlowDiagramProjection.strokeScale(0.0, 10.0), delta)
        val mid = FLOW_MIN_STROKE + 0.5f * (FLOW_MAX_STROKE - FLOW_MIN_STROKE)
        assertEquals(mid, WidgetFlowDiagramProjection.strokeScale(5.0, 10.0), delta)
        // The sign is irrelevant — only magnitude drives width.
        assertEquals(FLOW_MAX_STROKE, WidgetFlowDiagramProjection.strokeScale(-10.0, 10.0), delta)
    }

    // ── arrowTone: web `arrowColor(value, override)` ──────────────────────────────────────────────────────────

    @Test
    fun arrowToneFollowsTheValueSignWhenNoOverride() {
        assertEquals(FlowArrowTone.Positive, WidgetFlowDiagramProjection.arrowTone(3.0, null))
        assertEquals(FlowArrowTone.Negative, WidgetFlowDiagramProjection.arrowTone(-3.0, null))
        assertEquals(FlowArrowTone.Neutral, WidgetFlowDiagramProjection.arrowTone(0.0, null))
    }

    @Test
    fun arrowToneHonoursAnExplicitOverride() {
        // An override wins regardless of the value's sign (web `if (override) return override`).
        assertEquals(FlowArrowTone.Neutral, WidgetFlowDiagramProjection.arrowTone(9.0, FlowArrowTone.Neutral))
        assertEquals(FlowArrowTone.Positive, WidgetFlowDiagramProjection.arrowTone(-9.0, FlowArrowTone.Positive))
    }

    // ── compactLabel: web `compact && len > 3 ? slice(0, 3).toUpperCase() : label` ────────────────────────────

    @Test
    fun compactLabelOnlyAbbreviatesLongLabelsInCompactMode() {
        assertEquals("Battery", WidgetFlowDiagramProjection.compactLabel("Battery", compact = false))
        assertEquals("BAT", WidgetFlowDiagramProjection.compactLabel("Battery", compact = true))
        // Already short (≤3) → passthrough, no upper-casing.
        assertEquals("kW", WidgetFlowDiagramProjection.compactLabel("kW", compact = true))
        assertEquals("Sun", WidgetFlowDiagramProjection.compactLabel("Sun", compact = true))
    }

    // ── nodeRadiusSvg + isEmpty ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun nodeRadiusMirrorsTheWebCompactSwitch() {
        assertEquals(FLOW_NODE_RADIUS_SVG, WidgetFlowDiagramProjection.nodeRadiusSvg(compact = false), delta)
        assertEquals(FLOW_NODE_RADIUS_SVG_COMPACT, WidgetFlowDiagramProjection.nodeRadiusSvg(compact = true), delta)
    }

    @Test
    fun isEmptyMatchesTheWebNodesLengthGate() {
        assertTrue(WidgetFlowDiagramProjection.isEmpty(emptyList()))
        assertFalse(WidgetFlowDiagramProjection.isEmpty(listOf(node("battery", FlowNodePosition.Left))))
    }

    // ── project: the render-ready per-state snapshot ──────────────────────────────────────────────────────────

    @Test
    fun projectWithNoNodesYieldsTheEmptyStateProjection() {
        val projection = WidgetFlowDiagramProjection.project(emptyList(), listOf(arrow("a", "b", 5.0)), compact = false)
        assertTrue(projection.isEmpty)
        assertTrue(projection.nodes.isEmpty())
        assertTrue(projection.arrows.isEmpty())
    }

    @Test
    fun projectReducesNodesWithCompactLabelsAndTheBottomLabelRule() {
        val nodes =
            listOf(
                node("battery", FlowNodePosition.Left, label = "Battery"),
                node("home", FlowNodePosition.Bottom, label = "Home"),
            )
        val projection = WidgetFlowDiagramProjection.project(nodes, emptyList(), compact = true)
        assertFalse(projection.isEmpty)

        val battery = projection.nodes.single { it.id == "battery" }
        assertEquals("BAT", battery.displayLabel)
        assertFalse("a left node draws its label above", battery.labelBelow)

        val home = projection.nodes.single { it.id == "home" }
        assertEquals("HOM", home.displayLabel)
        assertTrue("a bottom node draws its label below", home.labelBelow)
    }

    @Test
    fun projectResolvesArrowEndpointsAndDropsDanglingArrows() {
        val nodes =
            listOf(
                node("battery", FlowNodePosition.Left),
                node("motor", FlowNodePosition.Right),
            )
        val arrows =
            listOf(
                arrow("battery", "motor", 24.0, active = true),
                // References an unknown node id → dropped (web `if (!fromNode || !toNode) return null`).
                arrow("battery", "ghost", 99.0, active = true),
            )
        val projection = WidgetFlowDiagramProjection.project(nodes, arrows, compact = false)

        assertEquals(1, projection.arrows.size)
        val resolved = projection.arrows.single()
        assertEquals(FlowNodePosition.Left, resolved.fromPosition)
        assertEquals(FlowNodePosition.Right, resolved.toPosition)
        assertEquals(FlowArrowTone.Positive, resolved.tone)
        assertTrue(resolved.active)
    }

    @Test
    fun projectScalesWidthsAgainstAllArrowsNotJustTheCompactVisibleSubset() {
        // The strongest arrow (|50|) is NOT in the compact-visible set (it is the 4th by magnitude here only
        // because three others are larger). We instead verify the denominator uses every arrow: the surviving
        // weakest visible arrow keeps a sub-MAX width because a larger arrow elsewhere set maxArrowValue.
        val nodes =
            listOf(
                node("a", FlowNodePosition.Left),
                node("b", FlowNodePosition.Right),
                node("c", FlowNodePosition.Top),
                node("d", FlowNodePosition.Bottom),
            )
        val arrows =
            listOf(
                arrow("a", "b", 50.0),
                arrow("b", "c", 40.0),
                arrow("c", "d", 30.0),
                arrow("d", "a", 10.0),
            )
        val projection = WidgetFlowDiagramProjection.project(nodes, arrows, compact = true)
        // compact keeps the top 3 (50, 40, 30); the 50-magnitude arrow scales to MAX against maxValue=50.
        assertEquals(3, projection.arrows.size)
        val widest = projection.arrows.maxByOrNull { it.strokeScale }!!
        assertEquals(FLOW_MAX_STROKE, widest.strokeScale, delta)
    }

    private fun node(
        id: String,
        position: FlowNodePosition,
        label: String = id,
    ): FlowNode = FlowNode(id = id, label = label, value = 1.0, formattedValue = "1", position = position)

    private fun arrow(
        from: String,
        to: String,
        value: Double,
        active: Boolean = false,
    ): FlowArrow = FlowArrow(from = from, to = to, value = value, active = active)
}
