// Instrumented Compose UI + accessibility verification of the SessionExpiringModal surface across the branches
// the web component renders (web/src/components/feedback/SessionExpiringModal.tsx): the live countdown header,
// the unsaved-drafts panel (list + `+N more` overflow), the no-drafts branch, the in-flight "refreshing" state
// (web `disabled={refreshing}` — Stay disables + relabels), the Stay / Sign-out hand-offs, and the `open`
// visibility gate (open mode / not-expiring renders nothing). Every asserted label is the localized copy the
// surface exposes to TalkBack. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers
// the pure projection + derivation.
package io.teslasync.android.modalsdialogs.sessionexpiringmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SessionExpiringModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SessionExpiringStrings(
            title = "Your session is about to expire",
            bodyTemplate = "You will be signed out in %1\$s.",
            unsavedTitle = "Unsaved drafts",
            unsavedBody = "Sign out will keep these drafts in your browser, but you must sign in again to finish them.",
            moreTemplate = "+%1\$s more",
            signOut = "Sign out now",
            stay = "Stay signed in",
            staying = "Refreshing…",
        )

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun display(
        countdownText: String = "0:45",
        drafts: DraftProjection = DraftProjection(emptyList(), 0),
        refreshing: Boolean = false,
    ) = SessionExpiringDisplay(
        open = true,
        countdownText = countdownText,
        drafts = drafts,
        refreshing = refreshing,
    )

    private fun setContent(
        display: SessionExpiringDisplay = display(),
        onStay: () -> Unit = {},
        onSignOut: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SessionExpiringContent(
                        display = display,
                        strings = strings,
                        onStay = onStay,
                        onSignOut = onSignOut,
                    )
                }
            }
        }
    }

    @Test
    fun countdownHeaderAndActionsAllRender() {
        setContent()

        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose
            .onNodeWithTag(SessionExpiringTestTags.COUNTDOWN)
            .assertIsDisplayed()
        compose.onNodeWithText("You will be signed out in 0:45.").assertIsDisplayed()
        // The Sign out / Stay actions expose their accessible names and are actionable (a11y label test).
        compose.onNodeWithText(strings.signOut).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.stay).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun draftsPanelListsTheDraftLabels() {
        setContent(
            display =
                display(
                    drafts =
                        DraftProjection(
                            visible =
                                listOf(
                                    DraftSummary("automation:new", 2L),
                                    DraftSummary("alertstudio:rule:42", 1L),
                                ),
                            overflowCount = 0,
                        ),
                ),
        )

        compose.onNodeWithText(strings.unsavedTitle).assertIsDisplayed()
        compose.onNodeWithTag(SessionExpiringTestTags.DRAFTS).assertIsDisplayed()
        compose
            .onNodeWithText("automation:new", substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
        compose
            .onNodeWithText("alertstudio:rule:42", substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test
    fun draftsOverflowRowRendersWhenOverTheLimit() {
        setContent(
            display =
                display(
                    drafts =
                        DraftProjection(
                            visible = (1..5).map { DraftSummary("draft:$it", it.toLong()) },
                            overflowCount = 3,
                        ),
                ),
        )

        compose
            .onNodeWithText("+3 more", substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test
    fun noDraftsHidesThePanel() {
        setContent(display = display(drafts = DraftProjection(emptyList(), 0)))

        compose.onNodeWithTag(SessionExpiringTestTags.DRAFTS).assertDoesNotExist()
        compose.onNodeWithText(strings.unsavedTitle).assertDoesNotExist()
    }

    @Test
    fun refreshingDisablesStayAndRelabelsIt() {
        setContent(display = display(refreshing = true))

        compose.onNodeWithText(strings.staying).assertIsDisplayed().assertIsNotEnabled()
        // Sign out stays available so the user is never trapped while a renewal is in flight.
        compose.onNodeWithText(strings.signOut).assertHasClickAction()
    }

    @Test
    fun stayInvokesOnStay() {
        var stayed = false
        setContent(onStay = { stayed = true })

        compose.onNodeWithText(strings.stay).performClick()
        assertTrue("tapping Stay signed in must invoke onStay", stayed)
    }

    @Test
    fun signOutInvokesOnSignOut() {
        var signedOut = false
        setContent(onSignOut = { signedOut = true })

        compose.onNodeWithText(strings.signOut).performClick()
        assertTrue("tapping Sign out now must invoke onSignOut", signedOut)
    }

    // ---- Stateful visibility gate (web `open` render guard) -----------------------------------------

    @Test
    fun statefulModalRendersNothingWhenNotExpiring() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SessionExpiringModal(
                    state =
                        SessionExpiryState(
                            mode = SessionMode.Session,
                            expiresInSeconds = 600,
                            isExpiringSoon = false,
                            hasExpired = false,
                        ),
                    onStay = {},
                    onSignOut = {},
                    logger = NoopLogger,
                )
            }
        }

        compose.onNodeWithTag(SessionExpiringTestTags.ROOT).assertDoesNotExist()
    }

    @Test
    fun statefulModalRendersWhenExpiring() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SessionExpiringModal(
                    state =
                        SessionExpiryState(
                            mode = SessionMode.Session,
                            expiresInSeconds = 45,
                            isExpiringSoon = true,
                            hasExpired = false,
                        ),
                    onStay = {},
                    onSignOut = {},
                    logger = NoopLogger,
                )
            }
        }

        compose.onNodeWithTag(SessionExpiringTestTags.ROOT).assertIsDisplayed()
        compose.onNodeWithTag(SessionExpiringTestTags.COUNTDOWN).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
