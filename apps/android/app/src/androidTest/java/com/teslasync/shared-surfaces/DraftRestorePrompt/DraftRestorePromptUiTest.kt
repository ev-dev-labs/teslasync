// Instrumented Compose UI + accessibility verification of the DraftRestorePrompt stateless surfaces across
// the states the web component renders: the compact card (loading skeleton + content title/actions) and the
// review body (the draft list with Resume / Discard, the friendly empty state, the classified error with
// Retry, and the stale / offline freshness chips). Also asserts the merged TalkBack row description and the
// Resume / Discard interactions. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DraftRestorePromptUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun cardContentShowsTitleAndActions() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreCard(display = content(DRAFTS))
            }
        }
        compose.onNodeWithText(PROMPT_TITLE).assertIsDisplayed()
        compose.onNodeWithText(REVIEW).assertIsDisplayed()
        compose.onNodeWithText(DISMISS).assertIsDisplayed()
        compose.onNodeWithContentDescription(CLOSE).assertIsDisplayed()
    }

    @Test
    fun cardLoadingShowsSkeletonWithA11yLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreCard(display = DraftRestoreDisplay(phase = DraftRestorePhase.Loading))
            }
        }
        compose.onNodeWithContentDescription(LOADING).assertIsDisplayed()
    }

    @Test
    fun reviewContentListsDraftsWithResumeAndDiscard() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(display = content(DRAFTS), nowMillis = NOW)
            }
        }
        compose.onNodeWithText(DRAFT_LABEL, substring = true).assertIsDisplayed()
        compose.onNodeWithText(RESUME).assertIsDisplayed()
        compose.onNodeWithText(DISCARD).assertIsDisplayed()
        // The label + relative age merge into one spoken description for the row.
        compose.onNodeWithContentDescription(DRAFT_LABEL, substring = true).assertIsDisplayed()
    }

    @Test
    fun reviewEmptyShowsFriendlyMessage() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(display = DraftRestoreDisplay(phase = DraftRestorePhase.Empty))
            }
        }
        compose.onNodeWithText(EMPTY, substring = true).assertIsDisplayed()
    }

    @Test
    fun reviewErrorShowsRetry() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(
                    display =
                        DraftRestoreDisplay(
                            phase = DraftRestorePhase.Error,
                            errorKind = ErrorKind.Http,
                            httpStatus = HTTP_ERROR,
                        ),
                )
            }
        }
        compose.onNodeWithText(RETRY, substring = true).assertIsDisplayed()
    }

    @Test
    fun reviewStaleShowsStaleChip() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(
                    display = content(DRAFTS).copy(stale = true, refreshing = true),
                    nowMillis = NOW,
                )
            }
        }
        compose.onNodeWithText(STALE, substring = true).assertIsDisplayed()
    }

    @Test
    fun reviewOfflineShowsOfflineChip() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(
                    display = content(DRAFTS).copy(offline = true, errorKind = ErrorKind.Network),
                    nowMillis = NOW,
                )
            }
        }
        compose.onNodeWithText(OFFLINE, substring = true).assertIsDisplayed()
    }

    @Test
    fun resumeInvokesCallbackWithTheDraft() {
        var resumed: DraftRecord? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(
                    display = content(DRAFTS),
                    nowMillis = NOW,
                    onResume = { resumed = it },
                )
            }
        }
        compose.onNodeWithText(RESUME).performClick()
        assertEquals("k1", resumed?.storageKey)
    }

    @Test
    fun discardInvokesCallbackWithTheDraft() {
        var discarded: DraftRecord? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRestoreReviewContent(
                    display = content(DRAFTS),
                    nowMillis = NOW,
                    onDiscard = { discarded = it },
                )
            }
        }
        compose.onNodeWithText(DISCARD).performClick()
        assertEquals("k1", discarded?.storageKey)
    }

    private fun content(drafts: List<DraftRecord>): DraftRestoreDisplay =
        DraftRestoreDisplay(phase = DraftRestorePhase.Content, drafts = drafts)

    private companion object {
        const val NOW = 1_700_000_000_000L
        val DRAFTS =
            listOf(
                DraftRecord(
                    storageKey = "k1",
                    route = "/alerts/new",
                    label = "New alert rule",
                    savedAtEpochMs = NOW - 120_000L,
                ),
            )

        const val HTTP_ERROR = 503

        // English catalog values resolved on-device.
        const val PROMPT_TITLE = "Unsaved drafts restored"
        const val REVIEW = "Review"
        const val DISMISS = "Dismiss"
        const val CLOSE = "Close"
        const val LOADING = "Loading"
        const val DRAFT_LABEL = "New alert rule"
        const val RESUME = "Resume"
        const val DISCARD = "Discard"
        const val EMPTY = "No drafts to restore."
        const val RETRY = "Retry"
        const val STALE = "Stale"
        const val OFFLINE = "Offline"
    }
}
