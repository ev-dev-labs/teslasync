package io.teslasync.android.widgetprimitives.widgetflowdiagram

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the [WidgetFlowDiagram] primitive — the parity port of
 * the web `WidgetFlowDiagram` (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx). Covers what
 * the offline model test cannot: the empty branch renders the shared EmptyState message (web
 * `nodes.length === 0`), the populated branch exposes the diagram's accessible label (web `aria-label`) plus a
 * single folded TalkBack readout per node ("{label}, {formattedValue}"), and compact mode abbreviates that
 * readout's label. Reduced motion is forced so the active-arrow dash animation is deterministic (and the
 * infinite transition never blocks `waitForIdle`). The offline `:app:testReleaseUnitTest` gate covers the pure
 * projection + the diagnostics emitter.
 */
class WidgetFlowDiagramUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val nodes =
        listOf(
            FlowNode(id = "battery", label = "Battery", value = 72.0, formattedValue = "72%", position = FlowNodePosition.Left),
            FlowNode(id = "motor", label = "Motor", value = 24.6, formattedValue = "24.6 kW", position = FlowNodePosition.Right),
        )
    private val arrows =
        listOf(
            FlowArrow(from = "battery", to = "motor", value = 24.6, active = true),
            FlowArrow(from = "motor", to = "battery", value = 0.0, active = false),
        )

    private fun setContent(
        projection: FlowDiagramProjection,
        emptyMessage: String = "No flow data available",
        ariaLabel: String = "Energy flow diagram",
    ) {
        compose.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme(dynamicColor = false) {
                    WidgetFlowDiagramContent(
                        projection = projection,
                        emptyMessage = emptyMessage,
                        ariaLabel = ariaLabel,
                        modifier = Modifier.size(width = 260.dp, height = 260.dp),
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    // ── State: empty (web `nodes.length === 0` → <EmptyState>) ────────────────────────────────────────────────

    @Test
    fun emptyShowsTheEmptyMessage() {
        setContent(WidgetFlowDiagramProjection.project(emptyList(), emptyList(), compact = false))
        compose.onNodeWithText("No flow data available").assertIsDisplayed()
    }

    // ── State: populated diagram exposes the accessible label (web `aria-label`) ──────────────────────────────

    @Test
    fun populatedExposesTheDiagramAccessibleLabel() {
        setContent(WidgetFlowDiagramProjection.project(nodes, arrows, compact = false))
        compose.onNodeWithContentDescription("Energy flow diagram").assertIsDisplayed()
    }

    // ── Accessibility: each node folds into one "{label}, {value}" readout ────────────────────────────────────

    @Test
    fun eachNodeRendersOneFoldedAccessibleReadout() {
        setContent(WidgetFlowDiagramProjection.project(nodes, arrows, compact = false))
        compose.onNodeWithContentDescription("Battery, 72%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Motor, 24.6 kW").assertIsDisplayed()
        // The readout is a single node, not one per descendant (icon/value/label are merged).
        compose.onAllNodesWithContentDescription("Battery, 72%").assertCountEquals(1)
    }

    // ── State: compact abbreviates the label in the readout (web `slice(0, 3).toUpperCase()`) ─────────────────

    @Test
    fun compactAbbreviatesTheNodeLabelInItsReadout() {
        setContent(WidgetFlowDiagramProjection.project(nodes, arrows, compact = true))
        compose.onNodeWithContentDescription("BAT, 72%").assertIsDisplayed()
        // The full label is no longer announced once compact abbreviation applies.
        compose.onAllNodesWithContentDescription("Battery, 72%").assertCountEquals(0)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires on mount ────────────────────────────────

    @Test
    fun mountingTheStatefulSurfaceEmitsThePiiSafeViewOpenedOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme(dynamicColor = false) {
                    WidgetFlowDiagram(
                        nodes = nodes,
                        arrows = arrows,
                        modifier = Modifier.size(width = 260.dp, height = 260.dp),
                        logger = logger,
                    )
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "WidgetFlowDiagram"), record.fields)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
