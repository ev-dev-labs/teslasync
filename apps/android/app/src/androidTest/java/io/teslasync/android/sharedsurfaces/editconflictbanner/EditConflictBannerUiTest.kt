package io.teslasync.android.sharedsurfaces.editconflictbanner

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [EditConflictBannerContent] across every state the web
 * component renders (web/src/components/feedback/EditConflictBanner.tsx): the conflict banner with its title,
 * body, ghost "Take over editing" action and switch hint; the resource-labeled body variant; and the two
 * Hidden states (this view owns the lease / no peer observed) where the web returns `null` and nothing renders.
 * It asserts the rendered i18n strings, the take-over callback, and that the banner exposes its title+body as a
 * single TalkBack announcement (web `role="status"` / `aria-live="polite"`). Runs under `connectedAndroidTest`;
 * the `testReleaseUnitTest` gate covers the election + projection logic, this covers the render.
 */
class EditConflictBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        EditConflictStrings(
            title = "Another browser tab is editing this",
            body = "This resource is open in another tab of this browser. Saving here will overwrite changes made there.",
            takeOver = "Take over editing",
            switchHint = "Or switch to your other tab to keep editing there.",
        )

    private val labeledStrings =
        strings.copy(
            body = "Your settings is open in another tab of this browser. Saving here will overwrite changes made there.",
        )

    private fun setContent(
        display: EditConflictDisplay,
        bannerStrings: EditConflictStrings = strings,
        onTakeOver: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EditConflictBannerContent(display = display, strings = bannerStrings, onTakeOver = onTakeOver)
            }
        }
    }

    private val conflict = EditConflictDisplay(phase = EditConflictPhase.Conflict, otherTabId = "peer-tab-aaa")

    @Test
    fun conflictShowsTitleBodyActionAndHint() {
        setContent(conflict)

        compose.onNodeWithTag(EDIT_CONFLICT_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(strings.title, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings.body, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings.takeOver, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings.switchHint, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun conflictExposesAPoliteMergedAnnouncement() {
        setContent(conflict)

        val announcement = "${strings.title}. ${strings.body}"
        compose.onNodeWithContentDescription(announcement).assertIsDisplayed()
    }

    @Test
    fun takeOverInvokesTheCallback() {
        var claimed = false
        setContent(conflict, onTakeOver = { claimed = true })

        compose.onNodeWithTag(EDIT_CONFLICT_TAKE_OVER_TEST_TAG).performClick()

        assertTrue(claimed)
    }

    @Test
    fun labeledConflictShowsTheResourceAwareBody() {
        setContent(conflict, bannerStrings = labeledStrings)

        compose.onNodeWithText(labeledStrings.body, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun ownerRendersNothing() {
        setContent(EditConflictDisplay(phase = EditConflictPhase.Hidden))

        compose.onNodeWithTag(EDIT_CONFLICT_BANNER_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(strings.title, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun noPeerObservedRendersNothing() {
        // The same Hidden render path the web takes for `otherTab === null`.
        setContent(EditConflictDisplay(phase = EditConflictPhase.Hidden, otherTabId = null))

        compose.onNodeWithTag(EDIT_CONFLICT_BANNER_TEST_TAG).assertDoesNotExist()
    }
}
