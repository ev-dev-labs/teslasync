// Instrumented Compose UI + accessibility verification of [HistoryListRowContent] across the states the web
// HistoryListRow renders: the navigable row (every slot — leading badge, primary line, route, metric chips,
// insight — plus the trailing chevron), the onClick (clickable) row, the static row (no click action), the
// hideChevron variant, the selected ring, and the checkbox / actions slots whose taps must NOT activate the
// row (the native analogue of the web `stopPropagation`). Also asserts the interactive row's TalkBack
// contract: it is one Button node carrying the host-supplied accessible name. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model
// (the click adapter, the role + accent projections, and the diagnostics) in HistoryListRowModelTest.
//
// `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction MEMBERS (called on the result, not
// imported); only the matcher form `assert(SemanticsMatcher)` is the real top-level
// `androidx.compose.ui.test.assert` extension, which is imported below. `InvalidPackageDeclaration` is
// suppressed: the mandated surface directory (com/teslasync/shared-surfaces/HistoryListRow) cannot form a
// valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.historylistrow

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HistoryListRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun navigableRowRendersEverySlotAndTheChevron() {
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                leading = { Text(LEADING) },
                route = { Text(ROUTE) },
                metrics = { Text(METRICS) },
                insight = { Text(INSIGHT) },
                href = HREF,
            )
        }
        // The slots are merged into the interactive row node, so read them from the unmerged tree.
        compose.onNodeWithText(PRIMARY, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(LEADING, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(ROUTE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(METRICS, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(INSIGHT, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(HISTORY_LIST_ROW_CHEVRON_TAG, useUnmergedTree = true).assertExists()
    }

    @Test
    fun tappingANavigableRowNavigatesToItsHref() {
        var navigated: String? = null
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                href = HREF,
                onNavigate = { navigated = it },
            )
        }
        compose.onNodeWithTag(HISTORY_LIST_ROW_PANEL_TAG).assertHasClickAction().performClick()
        assertEquals(HREF, navigated)
    }

    @Test
    fun tappingAClickableRowInvokesOnClick() {
        var clicked = false
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                onClick = { clicked = true },
            )
        }
        compose.onNodeWithTag(HISTORY_LIST_ROW_PANEL_TAG).assertHasClickAction().performClick()
        assertTrue(clicked)
    }

    @Test
    fun staticRowExposesNoClickAction() {
        host {
            HistoryListRowContent(primary = { Text(PRIMARY) })
        }
        compose.onNodeWithTag(HISTORY_LIST_ROW_PANEL_TAG).assertHasNoClickAction()
    }

    @Test
    fun hideChevronRemovesTheChevron() {
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                hideChevron = true,
            )
        }
        compose.onNodeWithTag(HISTORY_LIST_ROW_CHEVRON_TAG, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun tappingTheCheckboxDoesNotActivateTheRow() {
        var rowClicked = false
        var checkboxClicked = false
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                checkbox = {
                    Box(modifier = Modifier.testTag(CHECKBOX_TAG).clickable { checkboxClicked = true }) {
                        Text(CHECKBOX)
                    }
                },
                onClick = { rowClicked = true },
            )
        }
        compose.onNodeWithTag(CHECKBOX_TAG).performClick()
        assertTrue(checkboxClicked)
        assertFalse(rowClicked)
    }

    @Test
    fun tappingAnActionDoesNotActivateTheRow() {
        var rowClicked = false
        var actionClicked = false
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                actions = {
                    Box(modifier = Modifier.testTag(ACTION_TAG).clickable { actionClicked = true }) {
                        Text(ACTION)
                    }
                },
                onClick = { rowClicked = true },
            )
        }
        compose.onNodeWithTag(ACTION_TAG).performClick()
        assertTrue(actionClicked)
        assertFalse(rowClicked)
    }

    @Test
    fun interactiveRowIsAButtonCarryingTheAccessibleName() {
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                href = HREF,
                contentDescription = A11Y_NAME,
            )
        }
        compose
            .onNodeWithContentDescription(A11Y_NAME)
            .assertIsDisplayed()
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
    }

    @Test
    fun selectedRowMarksTheSelectedSemantics() {
        host {
            HistoryListRowContent(
                primary = { Text(PRIMARY) },
                onClick = {},
                selected = true,
            )
        }
        compose
            .onNodeWithTag(HISTORY_LIST_ROW_PANEL_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
    }

    private companion object {
        const val PRIMARY = "3:42 PM"
        const val LEADING = "A"
        const val ROUTE = "Home to Office"
        const val METRICS = "avg 29 mph"
        const val INSIGHT = "Low efficiency"
        const val HREF = "/drives/1"
        const val A11Y_NAME = "Open drive at 3:42 PM"
        const val CHECKBOX = "checkbox"
        const val CHECKBOX_TAG = "test-checkbox"
        const val ACTION = "eye"
        const val ACTION_TAG = "test-action"
    }
}
