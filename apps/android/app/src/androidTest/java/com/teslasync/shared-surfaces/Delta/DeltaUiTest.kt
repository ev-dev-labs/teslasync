// Instrumented Compose UI + accessibility verification of [DeltaContent] across the states the web
// Delta renders: the loading skeleton chip, the no-comparison em dash (carrying the localized
// `translation_delta_noComparison` label), and the resolved delta (the always-positive magnitude, the
// trailing compare-window label, and the `translation_delta_title` "{{current}} vs {{previous}}" tooltip
// spoken by TalkBack). Also asserts the arrow-suppressed form still renders its value + title. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class DeltaUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        projection: DeltaProjection,
        size: DeltaSize = DeltaSize.Sm,
        hideArrow: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DeltaContent(projection = projection, size = size, hideArrow = hideArrow)
                }
            }
        }
    }

    @Test
    fun loadingStateShowsSkeletonChip() {
        setContent(DeltaProjection.Loading)
        compose.onNodeWithTag(DELTA_SKELETON_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsEmDashAndNoComparisonLabel() {
        setContent(DeltaProjection.Empty(comparedTo = COMPARED_TO))
        // The localized no-comparison title is the node's TalkBack label (web `title`).
        compose.onNodeWithContentDescription(NO_COMPARISON).assertIsDisplayed()
        // The em dash + the trailing compare-window label are both visible.
        compose.onNodeWithText(EM_DASH, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(COMPARED_TO, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun valueStateShowsMagnitudeComparedToAndTitle() {
        setContent(value())
        // The `{{current}} vs {{previous}}` title is the accessible label (web `title` tooltip).
        compose.onNodeWithContentDescription(TITLE).assertIsDisplayed()
        // The always-positive magnitude + the trailing label are visible.
        compose.onNodeWithText(VALUE_TEXT, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(COMPARED_TO, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun hideArrowStillRendersValueAndTitle() {
        setContent(value(), hideArrow = true)
        compose.onNodeWithContentDescription(TITLE).assertIsDisplayed()
        compose.onNodeWithText(VALUE_TEXT, useUnmergedTree = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun value(): DeltaProjection.Value =
        DeltaProjection.Value(
            arrow = DeltaArrow.Down,
            tone = DeltaTone.Good,
            valueText = VALUE_TEXT,
            comparedTo = COMPARED_TO,
            currentText = "120",
            previousText = "137",
        )

    private companion object {
        const val COMPARED_TO = "vs last week"
        const val VALUE_TEXT = "12.5%"

        // en catalog values resolved on-device (translation_delta_*).
        const val NO_COMPARISON = "No comparison data"
        const val TITLE = "120 vs 137"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 200.dp
    }
}
