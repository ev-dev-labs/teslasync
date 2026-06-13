// Instrumented Compose UI + accessibility verification of [UsageCardContent] across the branches the web
// UsageCard renders: the empty fallback (the localized `translation_common_noData` message — never a blank
// box), the budget progress bar (its headline + the web `ariaLabel` exposed as the progressbar's
// accessible name), the at-a-glance bands, the key/value detail grid, a top-list breakdown, the callout
// banner, and the footer link row (its label + click affordance). The region layout is delegated to the
// shipped atomic renderer, so these assertions also pin the surface→atomic wiring. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// model + diagnostics.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usagecard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.UsageBand
import io.teslasync.android.components.datadisplay.UsageBanner
import io.teslasync.android.components.datadisplay.UsageBudget
import io.teslasync.android.components.datadisplay.UsageDetail
import io.teslasync.android.components.datadisplay.UsageFooterLink
import io.teslasync.android.components.datadisplay.UsageTopList
import io.teslasync.android.components.datadisplay.UsageTopListItem
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class UsageCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun emptyCardShowsTheLocalizedNoDataMessage() {
        setContent { UsageCardContent() }
        // The en catalog value for translation_common_noData, resolved on-device — never a blank box.
        compose.onNodeWithText(NO_DATA, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun explicitEmptyMessageOverridesTheDefault() {
        setContent { UsageCardContent(emptyMessage = CUSTOM_EMPTY) }
        compose.onNodeWithText(CUSTOM_EMPTY, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun budgetBarShowsHeadlineAndExposesItsAccessibleLabel() {
        setContent {
            UsageCardContent(
                budget =
                    UsageBudget(
                        headline = BUDGET_HEADLINE,
                        pct = 8f,
                        ariaLabel = BUDGET_ARIA,
                        rightLabel = "8% of monthly credit",
                    ),
            )
        }
        compose.onNodeWithText(BUDGET_HEADLINE, useUnmergedTree = true).assertIsDisplayed()
        // The web `ariaLabel` is the progressbar's TalkBack name.
        compose.onNodeWithContentDescription(BUDGET_ARIA).assertIsDisplayed()
    }

    @Test
    fun bandsRenderTheirLabelAndValue() {
        setContent {
            UsageCardContent(
                bands = listOf(UsageBand(label = BAND_LABEL, value = BAND_VALUE, sub = "today")),
            )
        }
        compose.onNodeWithText(BAND_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(BAND_VALUE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun detailsRenderTheirLabelAndValue() {
        setContent {
            UsageCardContent(
                details = listOf(UsageDetail(label = DETAIL_LABEL, value = DETAIL_VALUE)),
            )
        }
        compose.onNodeWithText(DETAIL_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(DETAIL_VALUE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun topListRendersItsTitleAndRows() {
        setContent {
            UsageCardContent(
                topLists =
                    listOf(
                        UsageTopList(
                            key = "endpoints",
                            title = TOPLIST_TITLE,
                            items = listOf(UsageTopListItem(key = "state", label = TOPLIST_ITEM, value = TOPLIST_VALUE)),
                        ),
                    ),
            )
        }
        compose.onNodeWithText(TOPLIST_TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(TOPLIST_ITEM, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(TOPLIST_VALUE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun bannerRendersItsTitleAndDescription() {
        setContent {
            UsageCardContent(
                banner = UsageBanner(title = BANNER_TITLE, description = BANNER_DESC),
            )
        }
        compose.onNodeWithText(BANNER_TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(BANNER_DESC, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun footerLinkIsLabeledAndClickable() {
        var clicked = false
        setContent {
            UsageCardContent(
                footer = listOf(UsageFooterLink(key = "settings", label = FOOTER_LABEL, onClick = { clicked = true }, primary = true)),
            )
        }
        compose.onNodeWithText(FOOTER_LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(FOOTER_LABEL).performClick()
        assertTrue(clicked)
    }

    private fun setContent(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { content() }
            }
        }
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        // en catalog value resolved on-device (translation_common_noData).
        const val NO_DATA = "No data available"
        const val CUSTOM_EMPTY = "Nothing tracked yet"

        const val BUDGET_HEADLINE = "$0.42 of $5.00"
        const val BUDGET_ARIA = "Monthly AI credit usage"

        const val BAND_LABEL = "Requests"
        const val BAND_VALUE = "1,204"

        const val DETAIL_LABEL = "Error rate"
        const val DETAIL_VALUE = "0.2%"

        const val TOPLIST_TITLE = "Top endpoints"
        const val TOPLIST_ITEM = "/vehicle/state"
        const val TOPLIST_VALUE = "642"

        const val BANNER_TITLE = "Over monthly credit"
        const val BANNER_DESC = "Usage paused until the credit resets."

        const val FOOTER_LABEL = "Open settings"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 600.dp
    }
}
