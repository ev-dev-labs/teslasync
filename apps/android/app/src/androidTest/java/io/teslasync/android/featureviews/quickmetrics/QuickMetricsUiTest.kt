package io.teslasync.android.featureviews.quickmetrics

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [QuickMetricsContent] across the two states the
 * surface renders — the resolved six-cell metrics grid and the friendly empty state. Asserts the rendered
 * labels and values are exposed to TalkBack (every cell label + figure is present in the semantics tree),
 * the count cells render their static figures under reduced motion (the deterministic accessibility path),
 * and the empty message is announced. The surface has no interactive elements, so accessibility coverage is
 * the presence of every label/value node. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest`
 * gate covers the pure projection.
 */
class QuickMetricsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val display =
        QuickMetricsDisplay(
            homeCount = 5,
            scCount = 3,
            dcCount = 2,
            totalTime = "20h 34m",
            monthlyAvg = "$20",
            perSession = "10.00 kWh",
        )

    private fun setContent(display: QuickMetricsDisplay?) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    QuickMetricsContent(display = display, locale = Locale.US, reduceMotion = true)
                }
            }
        }
    }

    @Test
    fun resolvedGridShowsEveryLabelAndValue() {
        setContent(display)

        // Charger-type count cells: label + static count figure (reduced motion) are both readable.
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithText("5").assertIsDisplayed()
        compose.onNodeWithText("Supercharger").assertIsDisplayed()
        compose.onNodeWithText("3").assertIsDisplayed()
        compose.onNodeWithText("DC Fast").assertIsDisplayed()
        compose.onNodeWithText("2").assertIsDisplayed()

        // Derived-value cells: label + formatted figure.
        compose.onNodeWithText("Total Time").assertIsDisplayed()
        compose.onNodeWithText("20h 34m").assertIsDisplayed()
        compose.onNodeWithText("Monthly Avg").assertIsDisplayed()
        compose.onNodeWithText("$20").assertIsDisplayed()
        compose.onNodeWithText("Per Session").assertIsDisplayed()
        compose.onNodeWithText("10.00 kWh").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsAccessibleNoMetricsMessage() {
        setContent(null)

        // The localized empty message is rendered and exposed to TalkBack; no metric cell is shown.
        compose.onNodeWithText("No charging metrics available yet").assertIsDisplayed()
        compose.onNodeWithText("Home").assertDoesNotExist()
        compose.onNodeWithText("Per Session").assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 600.dp
    }
}
