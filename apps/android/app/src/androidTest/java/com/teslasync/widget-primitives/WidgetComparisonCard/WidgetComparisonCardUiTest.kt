// Instrumented Compose UI + accessibility verification of [WidgetComparisonCardContent] across the branches
// the web WidgetComparisonCard renders: the empty fallback (the localized `translation_delta_noComparison`
// message — never a blank box), and the rows branch (each metric's muted label, its formatted value + unit,
// and a per-row delta slot). The compact projection (web `metrics.slice(0, 2)`) is exercised end-to-end via
// the pure projection feeding the content. The delta is stubbed (the shipped Delta surface needs the app
// DataContainer, which an instrumented content test does not host) so these assertions pin the
// primitive→row wiring + accessibility, exactly as the sibling UsageCard / TreeSelect content tests do. Runs
// under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// model + diagnostics.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetcomparisoncard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class WidgetComparisonCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun emptyProjectionShowsTheLocalizedNoComparisonMessage() {
        setContent(WidgetComparisonCardProjection.project(WidgetComparisonCardInput(emptyList())))
        // The en catalog value for translation_delta_noComparison, resolved on-device — never a blank box.
        compose.onNodeWithText(NO_COMPARISON, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun rowsRenderEachLabelValueAndUnit() {
        setContent(WidgetComparisonCardProjection.project(WidgetComparisonCardInput(METRICS)))
        compose.onNodeWithText(EFFICIENCY_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(EFFICIENCY_VALUE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(DISTANCE_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(DISTANCE_VALUE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun eachRowExposesItsDeltaWithAnAccessibleLabel() {
        setContent(WidgetComparisonCardProjection.project(WidgetComparisonCardInput(METRICS)))
        // The stub delta mirrors how the shipped Delta exposes a TalkBack content description per row.
        compose.onNodeWithContentDescription(deltaDesc(EFFICIENCY_LABEL)).assertIsDisplayed()
        compose.onNodeWithContentDescription(deltaDesc(DISTANCE_LABEL)).assertIsDisplayed()
        compose.onAllNodesWithTag(WIDGET_COMPARISON_CARD_ROW_TEST_TAG).assertCountEquals(METRICS.size)
    }

    @Test
    fun compactProjectionRendersOnlyTheFirstTwoRows() {
        setContent(WidgetComparisonCardProjection.project(WidgetComparisonCardInput(METRICS_3, compact = true)))
        compose.onAllNodesWithTag(WIDGET_COMPARISON_CARD_ROW_TEST_TAG).assertCountEquals(COMPACT_ROWS)
        // The third metric (web `metrics.slice(0, 2)` drops it) must not be rendered.
        compose.onNodeWithText(COST_LABEL, useUnmergedTree = true).assertDoesNotExist()
    }

    private fun setContent(projection: WidgetComparisonCardProjection) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    WidgetComparisonCardContent(projection = projection, renderDelta = { StubDelta(it) })
                }
            }
        }
    }

    @Composable
    private fun StubDelta(row: ComparisonRow) {
        Text(
            text = STUB_DELTA_TEXT,
            modifier = Modifier.semantics { contentDescription = deltaDesc(row.label) },
        )
    }

    private companion object {
        // en catalog value resolved on-device (translation_delta_noComparison).
        const val NO_COMPARISON = "No comparison data"

        const val EFFICIENCY_LABEL = "Efficiency"
        const val EFFICIENCY_VALUE = "248 Wh/mi"
        const val DISTANCE_LABEL = "Distance"
        const val DISTANCE_VALUE = "312 mi"
        const val COST_LABEL = "Cost"
        const val STUB_DELTA_TEXT = "delta"
        const val COMPACT_ROWS = 2

        fun deltaDesc(label: String): String = "delta $label"

        val METRICS =
            listOf(
                ComparisonMetric(label = EFFICIENCY_LABEL, current = 248.0, previous = 262.0, formattedCurrent = "248", unit = "Wh/mi"),
                ComparisonMetric(label = DISTANCE_LABEL, current = 312.0, previous = 290.0, formattedCurrent = "312", unit = "mi"),
            )

        val METRICS_3 =
            METRICS +
                ComparisonMetric(label = COST_LABEL, current = 41.0, previous = 36.0, formattedCurrent = "$41", higherIsBetter = false)

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 600.dp
    }
}
