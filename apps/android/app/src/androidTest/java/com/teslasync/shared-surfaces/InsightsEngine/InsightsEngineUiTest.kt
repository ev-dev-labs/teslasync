// Instrumented Compose UI + accessibility verification of [InsightsEngineContent] across the states
// the web InsightsEngine renders plus the P3 feed chrome: the resolved grid (with a merged
// title-plus-body TalkBack label per card), the stale freshness chip, the friendly empty state, the
// loading skeleton, and the QueryError failure. Runs under `connectedAndroidTest` (a device /
// emulator); the offline gate's `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

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
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class InsightsEngineUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(surface: InsightsSurface) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    InsightsEngineContent(surface = surface)
                }
            }
        }
    }

    @Test
    fun contentStateRendersTheGridAndACardWithAMergedLabel() {
        setContent(InsightsSurface.Content(listOf(batteryInsight()), InsightsFreshness.Fresh))
        compose.onNodeWithTag(INSIGHTS_GRID_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithTag(INSIGHT_CARD_TEST_TAG).assertIsDisplayed()
        // The card's TalkBack label merges the title and the body (web title + description).
        compose.onNodeWithContentDescription(CARD_TITLE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(CARD_TITLE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun staleContentShowsTheStaleChip() {
        setContent(InsightsSurface.Content(listOf(batteryInsight()), InsightsFreshness.Stale))
        compose.onNodeWithText(STALE_LABEL, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheFriendlyTitle() {
        setContent(InsightsSurface.Empty)
        compose.onNodeWithTag(INSIGHTS_EMPTY_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(EMPTY_TITLE, substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingStateShowsTheSkeletonRegion() {
        setContent(InsightsSurface.Loading)
        compose.onNodeWithTag(INSIGHTS_LOADING_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun failureStateShowsTheQueryErrorRegion() {
        setContent(InsightsSurface.Failed(offline = true))
        compose.onNodeWithTag(INSIGHTS_FAILED_TEST_TAG).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun batteryInsight(): Insight =
        Insight(
            id = "battery-health",
            icon = InsightIcon.Battery,
            titleKey = InsightTitleKey.BatteryHealth,
            body =
                listOf(
                    InsightSegment(
                        InsightBodyKey.BatteryHealthBody,
                        listOf(
                            InsightArg.Raw("95.2"),
                            InsightArg.Raw("2.1"),
                            InsightArg.Res(InsightBodyKey.BatteryAgingBetter),
                        ),
                    ),
                ),
            trend = InsightTrend.Up,
            tone = DeltaTone.Good,
            severity = InsightSeverity.Success,
        )

    private companion object {
        // en catalog values resolved on-device (translation_insights_*).
        const val CARD_TITLE = "Battery Health"
        const val STALE_LABEL = "Stale"
        const val EMPTY_TITLE = "No insights yet"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 600.dp
    }
}
