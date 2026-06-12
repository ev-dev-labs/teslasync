package io.teslasync.android.featureviews.drivedetailheader

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DriveDetailHeaderContent] across the branches the
 * surface renders: the completed-drive route title + full subtitle (web `start && end ? … : t(...)` plus the
 * `→ endTime` tail), the addressless-drive localized fallback title ("Drive Details"), the back / replay /
 * share affordances (each a focusable control with a click action that fires its callback — web
 * `<Link to="/drives">` / `<Link to="/drives/{id}/replay">` / `onShare`), and the back affordance's TalkBack
 * content description. The offline gate's `testReleaseUnitTest` covers the pure projection + diagnostics; this
 * covers render + a11y. Mirrors the web spec (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx).
 */
class DriveDetailHeaderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone: ZoneId = ZoneId.of("America/Los_Angeles")

    private fun completed(): DriveHeaderUiModel =
        DriveDetailHeaderProjection.project(
            DriveHeaderData(
                driveId = "1024",
                vehicleName = "Model 3",
                startAddress = "Cupertino, CA",
                endAddress = "San Francisco, CA",
                startTsIso = "2026-01-15T18:30:00Z",
                endTsIso = "2026-01-15T19:42:00Z",
            ),
            zone,
            Locale.US,
        )

    private fun addressless(): DriveHeaderUiModel =
        DriveDetailHeaderProjection.project(
            DriveHeaderData(
                driveId = "1025",
                vehicleName = "Model Y",
                startAddress = null,
                endAddress = null,
                startTsIso = "2026-01-15T18:30:00Z",
                endTsIso = null,
            ),
            zone,
            Locale.US,
        )

    private fun setContent(
        model: DriveHeaderUiModel,
        onBack: () -> Unit = {},
        onReplay: () -> Unit = {},
        onShare: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DriveDetailHeaderContent(model = model, onBack = onBack, onReplay = onReplay, onShare = onShare)
            }
        }
    }

    @Test
    fun completedDriveRendersTheRouteTitleAndSubtitle() {
        setContent(completed())
        compose.onNodeWithText("Cupertino, CA → San Francisco, CA").assertIsDisplayed()
        compose.onNodeWithText("Model 3", substring = true).assertIsDisplayed()
        compose.onNodeWithText("PST", substring = true).assertIsDisplayed()
    }

    @Test
    fun addresslessDriveRendersTheLocalizedFallbackTitle() {
        setContent(addressless())
        compose.onNodeWithText("Drive Details").assertIsDisplayed()
    }

    @Test
    fun replayAndShareActionsAreDisplayed() {
        setContent(completed())
        compose.onNodeWithText("Replay").assertIsDisplayed()
        compose.onNodeWithText("Share").assertIsDisplayed()
    }

    @Test
    fun backAffordanceIsLabeledForTalkBackAndInvokesOnBack() {
        var backed = false
        setContent(completed(), onBack = { backed = true })
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(backed)
    }

    @Test
    fun replayIsAClickableControlThatInvokesOnReplay() {
        var replayed = false
        setContent(completed(), onReplay = { replayed = true })
        compose.onNodeWithText("Replay").assertHasClickAction()
        compose.onNodeWithText("Replay").performClick()
        assertTrue(replayed)
    }

    @Test
    fun shareIsAClickableControlThatInvokesOnShare() {
        var shared = false
        setContent(completed(), onShare = { shared = true })
        compose.onNodeWithText("Share").assertHasClickAction()
        compose.onNodeWithText("Share").performClick()
        assertTrue(shared)
    }
}
