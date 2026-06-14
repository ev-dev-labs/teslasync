// Instrumented Compose UI + accessibility verification of [WidgetDetailCardContent] across the states the web
// WidgetDetailCard renders: the populated list (one merged row node per entry, whose spoken description is the
// original-case "label, value[, badge]"), the null-value em-dash row, the compact cap that shows only the first
// four rows, and the empty state (a friendly message, never a blank box). Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model (the classifier, the compact
// cap, the divider rule, the badge map, the a11y description builder, the `t(key, default)` resolver, and the
// diagnostics) in WidgetDetailCardModelTest.
//
// `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction MEMBERS (called on the result, not
// imported); only `assertIsDisplayed` is the imported top-level `androidx.compose.ui.test` extension.
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetDetailCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetdetailcard

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class WidgetDetailCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun populatedRendersAMergedRowNodePerEntry() {
        host {
            WidgetDetailCardContent(
                render =
                    projectWidgetDetailCard(
                        listOf(
                            DetailEntry("Battery", "82%", badge = DetailBadge("Healthy", DetailBadgeVariant.Success)),
                            DetailEntry("Range", "247 mi"),
                        ),
                        compact = false,
                    ),
            )
        }
        // Each row is one merged node whose spoken description is the original-case "label, value[, badge]"
        // (so TalkBack never spells out the visually-uppercased label).
        compose.onNodeWithContentDescription("Battery: 82%, Healthy").assertIsDisplayed()
        compose.onNodeWithContentDescription("Range: 247 mi").assertIsDisplayed()
    }

    @Test
    fun nullValueRendersTheEmDashInTheRowDescription() {
        host {
            WidgetDetailCardContent(
                render = projectWidgetDetailCard(listOf(DetailEntry("Last seen", null)), compact = false),
            )
        }
        compose.onNodeWithContentDescription("Last seen: \u2014").assertIsDisplayed()
    }

    @Test
    fun compactShowsOnlyTheFirstFourRows() {
        host {
            WidgetDetailCardContent(
                render = projectWidgetDetailCard((1..6).map { DetailEntry("L$it", "V$it") }, compact = true),
            )
        }
        compose.onNodeWithContentDescription("L1: V1").assertExists()
        compose.onNodeWithContentDescription("L4: V4").assertExists()
        // The 5th and 6th rows are capped away (web `entries.slice(0, 4)`).
        compose.onNodeWithContentDescription("L5: V5").assertDoesNotExist()
        compose.onNodeWithContentDescription("L6: V6").assertDoesNotExist()
    }

    @Test
    fun emptyRendersTheFriendlyEmptyStateNeverABlankBox() {
        host {
            WidgetDetailCardContent(
                render = projectWidgetDetailCard(emptyList(), compact = false),
                emptyMessage = EMPTY_MESSAGE,
            )
        }
        compose.onNodeWithTag(WIDGET_DETAIL_CARD_EMPTY_TAG).assertExists()
        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertIsDisplayed()
    }

    private companion object {
        const val EMPTY_MESSAGE = "No details available"
    }
}
