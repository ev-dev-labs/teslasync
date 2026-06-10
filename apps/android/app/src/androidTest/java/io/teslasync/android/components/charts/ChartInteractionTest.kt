package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the chart layer's core interactions and accessibility
 * semantics — container states, legend toggling, annotation removal, the popover, and the
 * radial-gauge summary. Like the shared `ComponentInteractionTest`, these run on a device
 * (connectedDebugAndroidTest); the no-device gate's behavioral coverage lives in
 * [ChartLogicTest]/[CursorSyncStoreTest].
 */
class ChartInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    private val series = listOf(ChartSeries("speed", "Speed", listOf(1.0, 2.0, 3.0)))
    private val labels = listOf("A", "B", "C")

    @Test
    fun containerEmptyStateShowsMessage() {
        rule.setContent {
            TeslaSyncTheme {
                ChartContainer(title = "Speed", status = ChartStatus.Empty, emptyMessage = "No data here") {}
            }
        }
        rule.onNodeWithText("No data here").assertIsDisplayed()
    }

    @Test
    fun containerErrorStateRetryFires() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ChartContainer(
                    title = "Speed",
                    status = ChartStatus.Error,
                    errorMessage = "Could not load",
                    retryLabel = "Retry",
                    onRetry = { retried = true },
                ) {}
            }
        }
        rule.onNodeWithText("Could not load").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertEquals(true, retried)
    }

    @Test
    fun legendTapTogglesHiddenSeries() {
        rule.setContent {
            TeslaSyncTheme {
                val legend = rememberChartLegendState()
                Column {
                    ChartLegend(
                        entries = listOf(LegendEntry("speed", "Speed", paletteColor(0))),
                        state = legend,
                    )
                    BodyText("hidden=${legend.hidden}")
                }
            }
        }
        rule.onNodeWithContentDescription("Speed").performClick()
        rule.onNodeWithText("hidden=[speed]").assertIsDisplayed()
    }

    @Test
    fun annotationListRemoveFires() {
        var removedId: String? = null
        rule.setContent {
            TeslaSyncTheme {
                AnnotationList(
                    annotations = listOf(DataAnnotation("a1", 1, "Service", AnnotationCategory.Maintenance)),
                    removeLabel = "Remove annotation",
                    onRemove = { removedId = it },
                )
            }
        }
        rule.onNodeWithContentDescription("Remove annotation").performClick()
        assertEquals("a1", removedId)
    }

    @Test
    fun addAnnotationPopoverShowsFields() {
        rule.setContent {
            TeslaSyncTheme {
                AddAnnotationPopover(open = true, onAdd = { _, _, _ -> }, onDismiss = {})
            }
        }
        rule.onNodeWithText("Add annotation").assertIsDisplayed()
        rule.onNodeWithText("Label").assertIsDisplayed()
    }

    @Test
    fun radialGaugeExposesAccessibleSummary() {
        rule.setContent {
            TeslaSyncTheme {
                RadialGauge(value = 72.0, max = 100.0, label = "Battery", unit = "%")
            }
        }
        rule.onNodeWithContentDescription("Battery: 72 %").assertIsDisplayed()
    }

    @Test
    fun lineChartRendersWithoutCrashing() {
        rule.setContent {
            TeslaSyncTheme {
                ChartContainer(title = "Speed") {
                    LineChartWrapper(series = series, xLabels = labels)
                }
            }
        }
        rule.onNodeWithText("Speed").assertIsDisplayed()
    }
}
