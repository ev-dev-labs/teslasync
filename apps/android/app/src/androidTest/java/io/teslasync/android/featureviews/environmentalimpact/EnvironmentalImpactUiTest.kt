package io.teslasync.android.featureviews.environmentalimpact

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [EnvironmentalImpactContent] across every state the
 * surface renders: the populated state (the two eco-green hero figures + their captions, the prose sentence
 * with its inline bold figures, and the three white mini-stats) and the empty state ("No data", with the
 * header still shown — never a blank box). Also asserts every figure and label is a readable text node so
 * TalkBack can announce the whole tile (the tile has no interactive elements to label). Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection. Mirrors the web
 * spec (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx).
 */
class EnvironmentalImpactUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val populated =
        EnvironmentalImpactData(
            co2SavedKg = 540.0,
            treeEquiv = 25.7,
            gallonsEquiv = 61.0,
            savings = 318.0,
        )

    private fun setContent(data: EnvironmentalImpactData?) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EnvironmentalImpactContent(data = data, modifier = Modifier.fillMaxWidth())
            }
        }
    }

    @Test
    fun populatedStateRendersBothHeroFiguresAndTheirCaptions() {
        setContent(populated)

        compose.onNodeWithText("540.0").assertIsDisplayed()
        compose.onNodeWithText("kg CO₂ saved").assertIsDisplayed()
        compose.onNodeWithText("25.7").assertIsDisplayed()
        compose.onNodeWithText("tree-years equivalent").assertIsDisplayed()
    }

    @Test
    fun populatedStateRendersAllThreeMiniStats() {
        setContent(populated)

        compose.onNodeWithText("61.0").assertIsDisplayed()
        compose.onNodeWithText("gallons avoided").assertIsDisplayed()
        compose.onNodeWithText("0.54").assertIsDisplayed() // 540 kg / 1000 = 0.54 t
        compose.onNodeWithText("metric tons CO₂").assertIsDisplayed()
        compose.onNodeWithText("318").assertIsDisplayed()
        compose.onNodeWithText("$ saved total").assertIsDisplayed()
    }

    @Test
    fun populatedStateRendersTheProseSentenceWithItsInlineFigures() {
        setContent(populated)

        // The prose is one accessible text node; assert the inline kg figure and the closing clause are present.
        compose.onNodeWithText("540 kg", substring = true).assertIsDisplayed()
        compose.onNodeWithText("trees absorbing carbon for a full year.", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersNoDataAndKeepsTheHeader() {
        setContent(null)

        compose.onNodeWithText("Environmental Impact").assertIsDisplayed() // header always shown
        compose.onNodeWithText("No data").assertIsDisplayed()
        // The data-only surfaces are absent in the empty branch.
        compose.onNodeWithText("kg CO₂ saved").assertDoesNotExist()
        compose.onNodeWithText("$ saved total").assertDoesNotExist()
    }

    @Test
    fun titleAndLabelsAreReadableTextNodesForTalkBack() {
        // No interactive elements exist on this read-out tile, so accessibility is carried by readable text
        // nodes; assert the title and every static label are announced.
        setContent(populated)

        compose.onNodeWithText("Environmental Impact").assertIsDisplayed()
        compose.onNodeWithText("kg CO₂ saved").assertIsDisplayed()
        compose.onNodeWithText("tree-years equivalent").assertIsDisplayed()
        compose.onNodeWithText("gallons avoided").assertIsDisplayed()
        compose.onNodeWithText("metric tons CO₂").assertIsDisplayed()
        compose.onNodeWithText("$ saved total").assertIsDisplayed()
    }
}
